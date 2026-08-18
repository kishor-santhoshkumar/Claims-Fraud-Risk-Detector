"""
Precomputes the 6-tick simulation replay from CMS claim CSVs.

Batch windows (2-month calendar periods, 2009):
  Tick 1: Jan-Feb 2009  ~94 k claims
  Tick 2: Mar-Apr 2009  ~98 k claims
  Tick 3: May-Jun 2009  ~97 k claims
  Tick 4: Jul-Aug 2009  ~96 k claims
  Tick 5: Sep-Oct 2009  ~90 k claims
  Tick 6: Nov-Dec 2009  ~81 k claims
Total: ~555 k (6 Nov-2008 and 2699 Dec-2008 claims excluded).
Range 81k-98k (20% spread) is within acceptable variation; calendar splits used.

Products
--------
  outputs/simulation_base.json   capacity-independent batch stats
  outputs/simulation_narrative.json   cached LLM summary

Called by api_temp GET /simulation/replay?capacity=N.
On Railway (no CSVs) the pre-committed simulation_base.json is served directly.
"""
from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd

OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
DATA = Path(__file__).resolve().parent.parent / "data"

SIMULATION_BASE_PATH = OUTPUTS / "simulation_base.json"
SIMULATION_NARRATIVE_PATH = OUTPUTS / "simulation_narrative.json"

BATCH_WINDOWS: list[tuple[int, str, str, str]] = [
    (1, "Jan – Feb 2009", "2009-01-01", "2009-02-28"),
    (2, "Mar – Apr 2009", "2009-03-01", "2009-04-30"),
    (3, "May – Jun 2009", "2009-05-01", "2009-06-30"),
    (4, "Jul – Aug 2009", "2009-07-01", "2009-08-31"),
    (5, "Sep – Oct 2009", "2009-09-01", "2009-10-31"),
    (6, "Nov – Dec 2009", "2009-11-01", "2009-12-31"),
]

RULE_CATEGORY: dict[str, str] = {
    "DUPLICATE_CLAIM":         "fraud",
    "POST_DEATH_CLAIM":        "fraud",
    "SAME_DAY_MULTI_PROVIDER": "fraud",
    "SHORT_STAY_HIGH_COST":    "waste",
    "DISCHARGE_BEFORE_ADMIT":  "abuse",
    "MISSING_ATTENDING":       "abuse",
}

TOTAL_FRAUD_PROVIDERS = 506
_rng = random.Random(42)


# ── Data loading ──────────────────────────────────────────────────────────────

def _load_claims_and_bene() -> tuple[pd.DataFrame, pd.Series]:
    ip = pd.read_csv(
        DATA / "Train_Inpatientdata-1542865627584.csv",
        parse_dates=["ClaimStartDt", "ClaimEndDt", "AdmissionDt", "DischargeDt"],
    )
    op = pd.read_csv(
        DATA / "Train_Outpatientdata-1542865627584.csv",
        parse_dates=["ClaimStartDt", "ClaimEndDt"],
    )
    bene_raw = pd.read_csv(DATA / "Train_Beneficiarydata-1542865627584.csv")
    bene_dod: pd.Series = pd.to_datetime(bene_raw.set_index("BeneID")["DOD"], errors="coerce")

    ip_c = ip.copy(); ip_c["claim_type"] = "inpatient"
    op_c = op.copy(); op_c["claim_type"] = "outpatient"
    for col in ["AdmissionDt", "DischargeDt"]:
        if col not in op_c.columns:
            op_c[col] = pd.NaT
    if "AttendingPhysician" not in op_c.columns:
        op_c["AttendingPhysician"] = None

    keep = ["ClaimID", "BeneID", "Provider", "ClaimStartDt", "ClaimEndDt",
            "InscClaimAmtReimbursed", "AttendingPhysician",
            "AdmissionDt", "DischargeDt", "claim_type"]

    claims = pd.concat([ip_c[keep], op_c[keep]], ignore_index=True)
    # Filter to 2009 only
    claims = claims[
        (claims["ClaimStartDt"] >= "2009-01-01") &
        (claims["ClaimStartDt"] <= "2009-12-31")
    ].copy()
    claims["InscClaimAmtReimbursed"] = pd.to_numeric(
        claims["InscClaimAmtReimbursed"], errors="coerce"
    ).fillna(0)
    return claims, bene_dod


# ── Rule engine (vectorized) ──────────────────────────────────────────────────

def _apply_rules(claims: pd.DataFrame, bene_dod: pd.Series) -> pd.DataFrame:
    ip = claims["claim_type"] == "inpatient"

    # R1: DUPLICATE_CLAIM
    dup_cols = ["BeneID", "ClaimStartDt", "ClaimEndDt", "InscClaimAmtReimbursed"]
    claims["r_dup"] = claims.duplicated(subset=dup_cols, keep=False)

    # R2: SHORT_STAY_HIGH_COST (inpatient, stay ≤ 2 days, amount > $30k)
    stay_days = (claims["DischargeDt"] - claims["AdmissionDt"]).dt.days.fillna(999)
    claims["r_sshc"] = ip & (stay_days <= 2) & (claims["InscClaimAmtReimbursed"] > 30_000)

    # R3: DISCHARGE_BEFORE_ADMIT (inpatient)
    valid_dates = claims["AdmissionDt"].notna() & claims["DischargeDt"].notna()
    claims["r_dba"] = ip & valid_dates & (claims["DischargeDt"] < claims["AdmissionDt"])

    # R4: MISSING_ATTENDING (inpatient)
    att = claims["AttendingPhysician"].astype(str).str.strip()
    claims["r_mia"] = ip & (claims["AttendingPhysician"].isna() | (att == "") | (att == "nan"))

    # R5: POST_DEATH_CLAIM
    dod_mapped = claims["BeneID"].map(bene_dod)
    claims["r_pdc"] = dod_mapped.notna() & (claims["ClaimStartDt"] > dod_mapped)

    # R6: SAME_DAY_MULTI_PROVIDER
    sdmp = claims.groupby(["BeneID", "ClaimStartDt"])["Provider"].transform("nunique")
    claims["r_sdmp"] = sdmp >= 3

    rule_cols = ["r_dup", "r_sshc", "r_dba", "r_mia", "r_pdc", "r_sdmp"]
    rule_names = ["DUPLICATE_CLAIM", "SHORT_STAY_HIGH_COST", "DISCHARGE_BEFORE_ADMIT",
                  "MISSING_ATTENDING", "POST_DEATH_CLAIM", "SAME_DAY_MULTI_PROVIDER"]

    # Build rule_flags list column
    bool_arr = claims[rule_cols].to_numpy()
    claims["rule_flags"] = [
        [rule_names[j] for j in range(6) if row[j]]
        for row in bool_arr
    ]
    claims.drop(columns=rule_cols, inplace=True)
    return claims


# ── Provider batch assignment ─────────────────────────────────────────────────

def _assign_provider_batches(claims: pd.DataFrame) -> dict[str, int]:
    """Return {provider_id: peak_batch_id} where peak = 2-month window with most claim spend."""
    def batch_id(dt: pd.Timestamp) -> int:
        m = dt.month
        if m <= 2: return 1
        if m <= 4: return 2
        if m <= 6: return 3
        if m <= 8: return 4
        if m <= 10: return 5
        return 6

    claims = claims.copy()
    claims["batch_id"] = claims["ClaimStartDt"].map(batch_id)
    by_batch = (
        claims.groupby(["Provider", "batch_id"])["InscClaimAmtReimbursed"]
        .sum()
        .reset_index()
    )
    peak = by_batch.loc[
        by_batch.groupby("Provider")["InscClaimAmtReimbursed"].idxmax()
    ].set_index("Provider")["batch_id"]
    return peak.to_dict()


# ── Trigger string builder ────────────────────────────────────────────────────

def _build_trigger(evidence: list[dict]) -> str:
    rule_evs = [e for e in evidence if e.get("type") == "rule"]
    peer_evs = [e for e in evidence if e.get("type") == "peer"]
    shap_evs = [e for e in evidence if e.get("type") == "shap" and e.get("direction") == "increases_risk"]

    parts: list[str] = []
    if rule_evs:
        for r in rule_evs[:2]:
            rid = r.get("rule_id", "")
            n = r.get("claims_affected", 0)
            label = rid.replace("_", " ").lower()
            parts.append(f"{n} {label}" if n else label)
    if peer_evs:
        p = peer_evs[0]
        metric = p.get("metric", "").replace("_", " ")
        z = abs(p.get("z_score", 0))
        parts.append(f"{metric} outlier (z={z:.1f})")
    if not parts and shap_evs:
        feat = shap_evs[0].get("feature", "").replace("_", " ")
        parts.append(f"elevated {feat}")

    return " + ".join(parts) if parts else "statistical outlier"


# ── Claims sample builder ─────────────────────────────────────────────────────

def _build_sample(batch_claims: pd.DataFrame, n_flagged: int = 3, n_clean: int = 9) -> list[dict]:
    flagged = batch_claims[batch_claims["rule_flags"].map(len) > 0]
    clean = batch_claims[batch_claims["rule_flags"].map(len) == 0]

    sample_flagged = flagged.sample(min(n_flagged, len(flagged)), random_state=42)
    sample_clean = clean.sample(min(n_clean, len(clean)), random_state=42)
    sample = pd.concat([sample_flagged, sample_clean]).sample(frac=1, random_state=42)

    rows: list[dict] = []
    for _, r in sample.iterrows():
        rows.append({
            "claim_id": str(r["ClaimID"]),
            "bene_id": str(r["BeneID"]),
            "provider_id": str(r["Provider"]),
            "amount": float(r["InscClaimAmtReimbursed"]),
            "claim_start_dt": str(r["ClaimStartDt"])[:10],
            "claim_type": str(r["claim_type"]),
            "rule_flags": list(r["rule_flags"]),
        })
    return rows


# ── Base data builder ─────────────────────────────────────────────────────────

def _build_base_data() -> dict:
    claims, bene_dod = _load_claims_and_bene()
    claims = _apply_rules(claims, bene_dod)

    provider_peak_batch = _assign_provider_batches(claims)

    scored_raw = json.loads((OUTPUTS / "scored_providers.json").read_text())
    features = pd.read_parquet(OUTPUTS / "features_train.parquet")
    fraud_map: dict[str, int] = features.set_index("Provider")["fraud_label"].to_dict()

    # Build provider info list (high + medium tiers for crossing-threshold display,
    # all providers for capacity fraud math)
    provider_info: list[dict] = []
    for p in scored_raw:
        pid = p["provider_id"]
        provider_info.append({
            "provider_id": pid,
            "score": round(float(p["score"]), 6),
            "risk_tier": p["risk_tier"],
            "fraud_label": int(fraud_map.get(pid, 0)),
            "expected_loss": float(p["expected_loss"]),
            "batch_id": int(provider_peak_batch.get(pid, 1)),
            "trigger": _build_trigger(p.get("evidence", [])),
        })

    batches: list[dict] = []
    for tick, label, start, end in BATCH_WINDOWS:
        mask = (claims["ClaimStartDt"] >= start) & (claims["ClaimStartDt"] <= end)
        bc = claims[mask]

        claims_processed = len(bc)

        # rules_fired: count of claims where each rule fired
        rules_fired: dict[str, int] = {}
        for flag_name in RULE_CATEGORY:
            count = int(bc["rule_flags"].map(lambda fl: flag_name in fl).sum())
            if count:
                rules_fired[flag_name] = count

        # flags_by_category
        flags_by_category: dict[str, int] = {"fraud": 0, "waste": 0, "abuse": 0}
        for flag_name, cat in RULE_CATEGORY.items():
            n = rules_fired.get(flag_name, 0)
            if cat in flags_by_category:
                flags_by_category[cat] += n

        # batch money at risk: expected_loss of high+medium providers active in this batch
        active_pids = set(bc["Provider"].unique())
        batch_money = sum(
            p["expected_loss"]
            for p in provider_info
            if p["provider_id"] in active_pids and p["risk_tier"] in ("high", "medium")
        )

        claims_sample = _build_sample(bc, n_flagged=4, n_clean=8)

        batches.append({
            "tick": tick,
            "label": label,
            "date_range": f"{start} to {end}",
            "claims_processed": claims_processed,
            "claims_sample": claims_sample,
            "rules_fired": rules_fired,
            "flags_by_category": flags_by_category,
            "_batch_money_at_risk": batch_money,
        })

    base = {
        "total_claims": int(len(claims)),
        "batches": batches,
        "_providers": provider_info,
    }
    with open(SIMULATION_BASE_PATH, "w", encoding="utf-8") as f:
        json.dump(base, f, separators=(",", ":"))
    return base


# ── Public API ────────────────────────────────────────────────────────────────

def load_base() -> dict:
    """Load or generate the capacity-independent base data."""
    if SIMULATION_BASE_PATH.exists():
        with open(SIMULATION_BASE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return _build_base_data()


def build_replay(capacity: int = 100) -> dict:
    """
    Combine base batch data with capacity-specific provider threshold logic.
    Returns the full JSON-serializable replay payload.
    """
    base = load_base()
    all_providers: list[dict] = base["_providers"]

    # Sort all providers by expected_loss descending for capacity-based review queue
    ranked = sorted(all_providers, key=lambda p: p["expected_loss"], reverse=True)
    top_n = ranked[:capacity]

    fraud_caught = sum(1 for p in top_n if p["fraud_label"] == 1)
    fraud_missed = TOTAL_FRAUD_PROVIDERS - fraud_caught
    false_positives = sum(1 for p in top_n if p["fraud_label"] == 0)
    share_caught = round(fraud_caught / TOTAL_FRAUD_PROVIDERS, 4)

    # Non-low providers assigned to each batch (for threshold crossing display)
    high_med = [p for p in ranked if p["risk_tier"] in ("high", "medium")]
    batch_crossing: dict[int, list[dict]] = defaultdict(list)
    for p in high_med:
        batch_crossing[p["batch_id"]].append(p)

    # Cumulative tier counts: how many providers of each tier have had claims processed
    # We count providers per batch based on peak-batch assignment (first discovery)
    cumul: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
    cumul_money: float = 0.0

    batches_out: list[dict] = []
    for batch in base["batches"]:
        tick = batch["tick"]
        crossing_this_tick = batch_crossing.get(tick, [])

        for p in crossing_this_tick:
            cumul[p["risk_tier"]] = cumul.get(p["risk_tier"], 0) + 1

        cumul_money += batch.get("_batch_money_at_risk", 0)

        # investigator hours: 1.5 h per high+medium provider reviewed so far
        reviewed_so_far = min(cumul["high"] + cumul["medium"], capacity)
        investigator_hours = round(reviewed_so_far * 1.5, 1)

        batches_out.append({
            "tick": tick,
            "label": batch["label"],
            "date_range": batch["date_range"],
            "claims_processed": batch["claims_processed"],
            "claims_sample": batch["claims_sample"],
            "rules_fired": batch["rules_fired"],
            "flags_by_category": batch["flags_by_category"],
            "providers_crossing_threshold": [
                {
                    "provider_id": p["provider_id"],
                    "score": p["score"],
                    "tier": p["risk_tier"],
                    "expected_loss": p["expected_loss"],
                    "trigger": p["trigger"],
                }
                for p in sorted(crossing_this_tick, key=lambda x: x["expected_loss"], reverse=True)[:10]
            ],
            "cumulative": {
                "claims_processed": sum(b["claims_processed"] for b in base["batches"][:tick]),
                "money_at_risk": round(cumul_money),
                "queue_high": cumul["high"],
                "queue_medium": cumul["medium"],
                "queue_low": cumul.get("low", 0),
                "investigator_hours": investigator_hours,
            },
        })

    # Narrative (pre-generated, served from cache)
    narrative = ""
    if SIMULATION_NARRATIVE_PATH.exists():
        with open(SIMULATION_NARRATIVE_PATH, encoding="utf-8") as f:
            narrative = json.load(f).get("narrative", "")

    top_5 = [
        {
            "provider_id": p["provider_id"],
            "score": p["score"],
            "expected_loss": p["expected_loss"],
            "risk_tier": p["risk_tier"],
        }
        for p in ranked[:5]
    ]

    total_flagged = sum(len(batch_crossing.get(t, [])) for t in range(1, 7))

    return {
        "batches": batches_out,
        "final_summary": {
            "total_claims": base["total_claims"],
            "total_flagged": total_flagged,
            "money_at_risk": round(cumul_money),
            "fraud_caught": fraud_caught,
            "fraud_missed": fraud_missed,
            "false_positives": false_positives,
            "share_of_fraud_caught": share_caught,
            "investigator_hours": round(fraud_caught * 1.5, 1),
            "top_providers": top_5,
            "narrative": narrative,
        },
    }


if __name__ == "__main__":
    print("Building simulation base data…")
    base = _build_base_data()
    print(f"Done. Batches: {len(base['batches'])}, Providers: {len(base['_providers'])}")
    for b in base["batches"]:
        print(f"  Tick {b['tick']} {b['label']}: {b['claims_processed']:,} claims | rules_fired={b['rules_fired']}")

    test = build_replay(capacity=100)
    fs = test["final_summary"]
    print(f"\ncapacity=100: fraud_caught={fs['fraud_caught']}, "
          f"fraud_missed={fs['fraud_missed']}, "
          f"false_positives={fs['false_positives']}, "
          f"share={fs['share_of_fraud_caught']:.1%}")

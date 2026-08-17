"""Claim-level scoring pipeline.

Scores every claim independently using:
  1. Rule checks (6 deterministic rules, each has a weight)
  2. Within-provider amount z-score (how anomalous vs that provider's own distribution)
  3. Cross-provider amount z-score using MAD (robust against heavy tails)

Final score = 0.5 * rule_score + 0.3 * within_z_norm + 0.2 * cross_z_norm

Do NOT touch provider-level scoring, features_train.parquet, the notebook, or
any file under src/export.py or src/features.py. Claim-level only.

Usage:
    python -m src.claim_scorer          # scores all claims, writes outputs
    from src.claim_scorer import score_all_claims
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUTPUTS = ROOT / "outputs"

# ── Rule definitions ─────────────────────────────────────────────────────────
# Each rule: id, weight, category, severity, citation
RULES: list[dict[str, Any]] = [
    {
        "id": "POST_DEATH_CLAIM",
        "weight": 0.40,
        "category": "fraud",
        "severity": "high",
        "citation": "Medicare BPM Ch.15 §15.1 — Beneficiary date of death",
    },
    {
        "id": "DUPLICATE_CLAIM",
        "weight": 0.35,
        "category": "fraud",
        "severity": "high",
        "citation": "Medicare PIM Ch.4 §4.3.1 — Duplicate claim submission",
    },
    {
        "id": "DISCHARGE_BEFORE_ADMIT",
        "weight": 0.30,
        "category": "waste",
        "severity": "medium",
        "citation": "Medicare PIM Ch.3 §3.2.4 — Chronological date consistency",
    },
    {
        "id": "SHORT_STAY_HIGH_COST",
        "weight": 0.25,
        "category": "fraud",
        "severity": "medium",
        "citation": "Medicare PIM Ch.6 §6.5.2 — Short inpatient stay anomaly",
    },
    {
        "id": "MISSING_ATTENDING",
        "weight": 0.20,
        "category": "compliance",
        "severity": "medium",
        "citation": "42 CFR §424.22 — Attending physician certification required",
    },
    {
        "id": "SAME_DAY_MULTI_PROVIDER",
        "weight": 0.20,
        "category": "abuse",
        "severity": "low",
        "citation": "Medicare PIM Ch.4 §4.5 — Beneficiary multi-provider same-day billing",
    },
]

RULE_WEIGHTS: dict[str, float] = {r["id"]: r["weight"] for r in RULES}


# ── Data loading ──────────────────────────────────────────────────────────────

def _load_raw() -> pd.DataFrame:
    """Load inpatient + outpatient + beneficiary, merge DOD, return combined claims."""
    ip_files = sorted(DATA_DIR.glob("Train_Inpatientdata*.csv"))
    op_files = sorted(DATA_DIR.glob("Train_Outpatientdata*.csv"))
    bene_files = sorted(DATA_DIR.glob("Train_Beneficiarydata*.csv"))

    if not ip_files or not op_files or not bene_files:
        raise FileNotFoundError(
            f"Training CSVs not found in {DATA_DIR}. "
            "Expected Train_Inpatientdata*.csv, Train_Outpatientdata*.csv, "
            "Train_Beneficiarydata*.csv."
        )

    ip = pd.read_csv(ip_files[0], dtype=str, low_memory=False)
    op = pd.read_csv(op_files[0], dtype=str, low_memory=False)
    bene = pd.read_csv(bene_files[0], dtype=str, low_memory=False)

    ip["claim_type"] = "inpatient"
    op["claim_type"] = "outpatient"
    # Outpatient has no AdmissionDt / DischargeDt — add them as NaN so concat aligns
    for col in ("AdmissionDt", "DischargeDt", "AttendingPhysician"):
        if col not in op.columns:
            op[col] = np.nan

    claims = pd.concat([ip, op], ignore_index=True)

    # Join DOD (and DOB for completeness) from beneficiary
    bene_keep = ["BeneID"]
    for c in ("DOD", "DOB"):
        if c in bene.columns:
            bene_keep.append(c)
    claims = claims.merge(bene[bene_keep], on="BeneID", how="left")

    # Numeric coercions
    claims["InscClaimAmtReimbursed"] = pd.to_numeric(claims["InscClaimAmtReimbursed"], errors="coerce").fillna(0.0)
    claims["DeductibleAmtPaid"] = pd.to_numeric(claims.get("DeductibleAmtPaid", pd.Series(dtype=float)), errors="coerce").fillna(0.0)

    # Date coercions
    for col in ("ClaimStartDt", "ClaimEndDt", "AdmissionDt", "DischargeDt", "DOD", "DOB"):
        if col in claims.columns:
            claims[col] = pd.to_datetime(claims[col], errors="coerce")

    # Drop rows without a ClaimID or Provider (unusable)
    claims = claims.dropna(subset=["ClaimID", "Provider"])
    return claims


# ── Rule evaluation ───────────────────────────────────────────────────────────

def _apply_rules(claims: pd.DataFrame) -> pd.DataFrame:
    """Return claims with columns: rule_flags (list), rule_score (float)."""
    n = len(claims)
    flags: list[set[str]] = [set() for _ in range(n)]
    idx = claims.index

    # 1. POST_DEATH_CLAIM — ClaimStartDt after DOD
    if "DOD" in claims.columns:
        mask = (
            claims["DOD"].notna()
            & claims["ClaimStartDt"].notna()
            & (claims["ClaimStartDt"] > claims["DOD"])
        )
        for i in claims.index[mask]:
            flags[idx.get_loc(i)].add("POST_DEATH_CLAIM")

    # 2. DUPLICATE_CLAIM — exact match on (BeneID, ClaimStartDt, ClaimEndDt, amount)
    dup_key = (
        claims["BeneID"].fillna("") + "|"
        + claims["ClaimStartDt"].astype(str) + "|"
        + claims["ClaimEndDt"].astype(str) + "|"
        + claims["InscClaimAmtReimbursed"].round(2).astype(str)
    )
    dup_counts = dup_key.map(dup_key.value_counts())
    for i in claims.index[dup_counts >= 2]:
        flags[idx.get_loc(i)].add("DUPLICATE_CLAIM")

    # 3. DISCHARGE_BEFORE_ADMIT — ClaimEndDt < ClaimStartDt
    if "ClaimEndDt" in claims.columns and "ClaimStartDt" in claims.columns:
        mask = (
            claims["ClaimEndDt"].notna()
            & claims["ClaimStartDt"].notna()
            & (claims["ClaimEndDt"] < claims["ClaimStartDt"])
        )
        for i in claims.index[mask]:
            flags[idx.get_loc(i)].add("DISCHARGE_BEFORE_ADMIT")

    # 4. SHORT_STAY_HIGH_COST — inpatient, stay ≤ 2 days, amount > $30k
    ip_mask = claims["claim_type"] == "inpatient"
    if ip_mask.any():
        stay_days = (claims["ClaimEndDt"] - claims["ClaimStartDt"]).dt.days
        sshc = (
            ip_mask
            & stay_days.notna()
            & (stay_days <= 2)
            & (claims["InscClaimAmtReimbursed"] > 30_000)
        )
        for i in claims.index[sshc]:
            flags[idx.get_loc(i)].add("SHORT_STAY_HIGH_COST")

    # 5. MISSING_ATTENDING — inpatient only, AttendingPhysician is null/empty
    if "AttendingPhysician" in claims.columns:
        att_null = claims["AttendingPhysician"].isna() | (claims["AttendingPhysician"].astype(str).str.strip() == "")
        missing_att = ip_mask & att_null
        for i in claims.index[missing_att]:
            flags[idx.get_loc(i)].add("MISSING_ATTENDING")

    # 6. SAME_DAY_MULTI_PROVIDER — same BeneID + ClaimStartDt billed by 3+ distinct providers
    day_bene_key = claims["BeneID"].fillna("") + "|" + claims["ClaimStartDt"].astype(str)
    day_bene_providers = claims.groupby(day_bene_key)["Provider"].transform("nunique")
    sdmp_mask = day_bene_providers >= 3
    for i in claims.index[sdmp_mask]:
        flags[idx.get_loc(i)].add("SAME_DAY_MULTI_PROVIDER")

    claims = claims.copy()
    claims["rule_flags"] = [sorted(f) for f in flags]
    claims["rule_score"] = claims["rule_flags"].apply(
        lambda fl: min(sum(RULE_WEIGHTS.get(r, 0) for r in fl), 1.0)
    )
    return claims


# ── Z-score computation ───────────────────────────────────────────────────────

def _sigmoid(x: pd.Series) -> pd.Series:
    """Squash any real-valued z to (0, 1). Clipped for numerical safety."""
    x_clipped = x.clip(-15, 15)
    return 1.0 / (1.0 + np.exp(-x_clipped))


def _within_provider_z(claims: pd.DataFrame) -> pd.Series:
    """Per-claim z = (amount - provider_mean) / provider_std.

    Returns 0.0 for providers with only one claim or zero variance.
    """
    amt = claims["InscClaimAmtReimbursed"]
    prov_mean = amt.groupby(claims["Provider"]).transform("mean")
    prov_std = amt.groupby(claims["Provider"]).transform("std").fillna(0.0)
    z = (amt - prov_mean) / prov_std.where(prov_std > 0, other=np.nan)
    return z.fillna(0.0)


def _cross_provider_z(claims: pd.DataFrame) -> pd.Series:
    """Robust cross-provider z using MAD.

    z = (amount - population_median) / (1.4826 * MAD)
    Uses the full claim population as the reference distribution.
    """
    amt = claims["InscClaimAmtReimbursed"]
    pop_median = amt.median()
    mad = (amt - pop_median).abs().median()
    if mad == 0:
        return pd.Series(0.0, index=claims.index)
    return (amt - pop_median) / (1.4826 * mad)


# ── Scoring ───────────────────────────────────────────────────────────────────

def _score_claims(claims: pd.DataFrame) -> pd.DataFrame:
    """Add claim_risk_score and percentile-based claim_risk_tier to the claims dataframe.

    Tiers are assigned from the actual score distribution:
      high   — top 1%  of all claims by claim_risk_score (p99+)
      medium — next 4% (p95 to p99)
      low    — everything below p95
    """
    within_z = _within_provider_z(claims)
    cross_z = _cross_provider_z(claims)

    within_z_norm = _sigmoid(within_z / 3.0)
    cross_z_norm = _sigmoid(cross_z / 3.0)

    score = (
        0.5 * claims["rule_score"]
        + 0.3 * within_z_norm
        + 0.2 * cross_z_norm
    ).clip(0.0, 1.0)

    claims = claims.copy()
    claims["within_z"] = within_z.round(4)
    claims["cross_z"] = cross_z.round(4)
    claims["claim_risk_score"] = score.round(4)

    # Percentile thresholds from the actual population
    p99 = float(np.percentile(score.values, 99))
    p95 = float(np.percentile(score.values, 95))
    claims["_p99"] = p99
    claims["_p95"] = p95

    def _tier(crs: float) -> str:
        if crs >= p99:
            return "high"
        if crs >= p95:
            return "medium"
        return "low"

    claims["claim_risk_tier"] = score.map(_tier)
    return claims


# ── Validation ────────────────────────────────────────────────────────────────

def _validate(claims: pd.DataFrame) -> None:
    """Halt on bad rule rates, non-finite z, or high tier exceeding 2%."""
    n = len(claims)
    for rule_id in RULE_WEIGHTS:
        fired = claims["rule_flags"].apply(lambda fl: rule_id in fl).sum()
        pct = 100 * fired / n if n else 0
        if pct >= 10:
            raise RuntimeError(
                f"Validation failed: {rule_id} fires on {fired:,}/{n:,} claims ({pct:.1f}%). "
                "Expected < 10%. Check rule logic."
            )

    bad_z = (~np.isfinite(claims["within_z"])).sum()
    if bad_z > 0:
        raise RuntimeError(f"Validation failed: within_z is non-finite for {bad_z} claims.")

    high_n = (claims["claim_risk_tier"] == "high").sum()
    high_pct = 100 * high_n / n if n else 0
    if high_pct > 2.0:
        raise RuntimeError(
            f"Tier gate failed: high-risk tier is {high_pct:.2f}% ({high_n:,} claims). "
            "Expected <= 2%. Thresholds are too loose — investigate before shipping."
        )

    p99 = claims["_p99"].iloc[0]
    p95 = claims["_p95"].iloc[0]
    med_n  = (claims["claim_risk_tier"] == "medium").sum()
    low_n  = (claims["claim_risk_tier"] == "low").sum()

    print(f"[claim_scorer] Validation passed — {n:,} claims scored.")
    print(f"  Score thresholds: p99={p99:.4f} (high), p95={p95:.4f} (medium)")
    print(f"  High:   {high_n:,} ({high_pct:.2f}%)")
    print(f"  Medium: {med_n:,} ({100*med_n/n:.2f}%)")
    print(f"  Low:    {low_n:,} ({100*low_n/n:.2f}%)")
    print()
    for rule_id in RULE_WEIGHTS:
        fired = claims["rule_flags"].apply(lambda fl: rule_id in fl).sum()
        print(f"  {rule_id}: {fired:,} claims ({100 * fired / n:.2f}%)")


# ── Output helpers ────────────────────────────────────────────────────────────

def _codes(row: pd.Series, cols: list[str]) -> list[str]:
    out = []
    for c in cols:
        v = row.get(c)
        if v is not None and not (isinstance(v, float) and np.isnan(v)):
            s = str(v).strip()
            if s and s.lower() not in ("nan", "none", ""):
                out.append(s)
    return out


def _safe_date(val) -> str | None:
    if pd.isna(val):
        return None
    try:
        return pd.Timestamp(val).date().isoformat()
    except Exception:
        return None


def _row_to_record(row: pd.Series) -> dict:
    diag_cols = [f"ClmDiagnosisCode_{i}" for i in range(1, 11)]
    proc_cols = [f"ClmProcedureCode_{i}" for i in range(1, 7)]
    return {
        "claim_id":          str(row.get("ClaimID", "")),
        "provider_id":       str(row.get("Provider", "")),
        "bene_id":           str(row.get("BeneID", "")),
        "claim_start_dt":    _safe_date(row.get("ClaimStartDt")),
        "claim_end_dt":      _safe_date(row.get("ClaimEndDt")),
        "claim_type":        str(row.get("claim_type", "")),
        "amount_reimbursed": float(row.get("InscClaimAmtReimbursed", 0.0)),
        "deductible_paid":   float(row.get("DeductibleAmtPaid", 0.0)),
        "attending_physician": _safe_str_val(row.get("AttendingPhysician")),
        "diagnosis_codes":   _codes(row, diag_cols),
        "procedure_codes":   _codes(row, proc_cols),
        "admission_dt":      _safe_date(row.get("AdmissionDt")) if row.get("claim_type") == "inpatient" else None,
        "discharge_dt":      _safe_date(row.get("DischargeDt")) if row.get("claim_type") == "inpatient" else None,
        "rule_flags":        row.get("rule_flags", []),
        "rule_score":        float(row.get("rule_score", 0.0)),
        "within_z":          float(row.get("within_z", 0.0)),
        "cross_z":           float(row.get("cross_z", 0.0)),
        "claim_risk_score":  float(row.get("claim_risk_score", 0.0)),
        "claim_risk_tier":   str(row.get("claim_risk_tier", "low")),
    }


def _safe_str_val(val) -> str | None:
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except (TypeError, ValueError):
        pass
    s = str(val).strip()
    return None if s.lower() in ("nan", "none", "") else s


# ── Public API ────────────────────────────────────────────────────────────────

def score_all_claims() -> pd.DataFrame:
    """Load, score, validate, and return the full claims dataframe.

    Columns added: rule_flags, rule_score, within_z, cross_z,
                   claim_risk_score, claim_risk_tier.
    """
    print("[claim_scorer] Loading claim data...")
    claims = _load_raw()
    print(f"[claim_scorer] Loaded {len(claims):,} claims from {claims['Provider'].nunique():,} providers.")

    print("[claim_scorer] Applying rules...")
    claims = _apply_rules(claims)

    print("[claim_scorer] Computing scores...")
    claims = _score_claims(claims)

    _validate(claims)
    return claims


def write_outputs(claims: pd.DataFrame) -> None:
    """Write scored_claims.json (top 500) and claim_score_index.json."""
    OUTPUTS.mkdir(exist_ok=True)

    claims = claims.copy()
    claims["_rank_key"] = claims["claim_risk_score"] * claims["InscClaimAmtReimbursed"]
    top500 = claims.nlargest(500, "_rank_key")

    records = [_row_to_record(row) for _, row in top500.iterrows()]
    with open(OUTPUTS / "scored_claims.json", "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
    print(f"[claim_scorer] Wrote {len(records)} claims -> outputs/scored_claims.json")

    # Compact index — all non-low-tier claims; includes within_z and cross_z for the UI
    flagged = claims[claims["claim_risk_tier"] != "low"]
    index: dict[str, dict] = {}
    for _, row in flagged.iterrows():
        index[str(row["ClaimID"])] = {
            "provider_id":       str(row["Provider"]),
            "claim_risk_score":  round(float(row["claim_risk_score"]), 4),
            "claim_risk_tier":   str(row["claim_risk_tier"]),
            "amount_reimbursed": float(row["InscClaimAmtReimbursed"]),
            "rule_flags":        row["rule_flags"],
            "within_z":          round(float(row["within_z"]), 4),
            "cross_z":           round(float(row["cross_z"]), 4),
        }
    with open(OUTPUTS / "claim_score_index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
    print(f"[claim_scorer] Wrote {len(index):,} flagged claims -> outputs/claim_score_index.json")

    # Population stats used by api_temp.py for inline scoring of any claim
    amt = claims["InscClaimAmtReimbursed"].values
    pop_median = float(np.median(amt))
    pop_mad    = float(np.median(np.abs(amt - pop_median)))
    p99 = float(claims["_p99"].iloc[0])
    p95 = float(claims["_p95"].iloc[0])
    pop_stats = dict(pop_median=pop_median, pop_mad=pop_mad, p99=p99, p95=p95)
    with open(OUTPUTS / "claim_pop_stats.json", "w", encoding="utf-8") as f:
        json.dump(pop_stats, f, indent=2)
    print(f"[claim_scorer] Wrote claim_pop_stats.json: median=${pop_median:.0f} p99={p99:.4f}")

    # Verification table - top 10 by rank key
    print("\n[claim_scorer] Top 10 by risk x amount:")
    print(f"{'ClaimID':<22} {'Provider':<12} {'Tier':<8} {'Score':>6} {'Amount':>10}  Flags")
    print("-" * 82)
    for r in records[:10]:
        flags = ", ".join(r["rule_flags"]) if r["rule_flags"] else "-"
        print(
            f"{r['claim_id']:<22} {r['provider_id']:<12} {r['claim_risk_tier']:<8} "
            f"{r['claim_risk_score']:>6.3f} {r['amount_reimbursed']:>10,.0f}  {flags}"
        )

    # Demo-provider distribution
    demo_ids = ["PRV52985", "PRV51005", "PRV52019", "PRV54742"]
    print("\n[claim_scorer] Demo-provider tier distribution:")
    print(f"{'Provider':<12} {'Total':>6} {'High':>6} {'Medium':>8} {'Low':>6}")
    print("-" * 42)
    for pid in demo_ids:
        sub = claims[claims["Provider"] == pid]
        if sub.empty:
            print(f"{pid:<12}   not found")
            continue
        h = (sub["claim_risk_tier"] == "high").sum()
        m = (sub["claim_risk_tier"] == "medium").sum()
        lo = (sub["claim_risk_tier"] == "low").sum()
        print(f"{pid:<12} {len(sub):>6} {h:>6} {m:>8} {lo:>6}")


if __name__ == "__main__":
    claims = score_all_claims()
    write_outputs(claims)
    n = len(claims)
    h = (claims["claim_risk_tier"] == "high").sum()
    m = (claims["claim_risk_tier"] == "medium").sum()
    lo = (claims["claim_risk_tier"] == "low").sum()
    print(f"\n[claim_scorer] Full distribution across {n:,} claims:")
    print(f"  High:   {h:,} ({100*h/n:.2f}%)")
    print(f"  Medium: {m:,} ({100*m/n:.2f}%)")
    print(f"  Low:    {lo:,} ({100*lo/n:.2f}%)")

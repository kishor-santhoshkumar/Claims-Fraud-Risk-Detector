"""
Upload pipeline: score an arbitrary flat CSV of claims against the trained model.

CRITICAL: All percentiles in SHAP evidence use BASELINE feature_stats
(pre-computed from the 5,410 training providers). Never recompute from the
uploaded batch — a 300-provider file would give meaningless percentiles.
Pass feature_stats from _get_model() in api_temp.py.

Cross-entity features (mean_bene_n_providers, mean_phy_n_providers) are
computed WITHIN the uploaded batch — they cannot reference the baseline
because the baseline entities are not in this file.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

# Project root helpers imported from src.export (not re-computed here)
from src.export import (
    OUTPUTS,
    HIGH_THRESHOLD,
    MEDIUM_THRESHOLD,
    _risk_tier,
    _build_shap_evidence,
)
from src.schema import ScoredProvider
from src.features import enrich_claims, compute_cross_entity_spans, aggregate_to_provider

# ---------------------------------------------------------------------------
# Required flat-CSV column names
# ---------------------------------------------------------------------------

REQUIRED_COLS: list[str] = [
    "ClaimID", "BeneID", "Provider", "ClaimType",
    "ClaimStartDt", "ClaimEndDt",
    "InscClaimAmtReimbursed", "DeductibleAmtPaid",
    "AttendingPhysician", "OperatingPhysician", "OtherPhysician",
    "AdmissionDt", "DischargeDt",
    "ClmDiagnosisCode_1", "ClmDiagnosisCode_2", "ClmDiagnosisCode_3",
    "ClmDiagnosisCode_4", "ClmDiagnosisCode_5", "ClmDiagnosisCode_6",
    "ClmDiagnosisCode_7", "ClmDiagnosisCode_8", "ClmDiagnosisCode_9",
    "ClmDiagnosisCode_10",
    "ClmProcedureCode_1", "ClmProcedureCode_2", "ClmProcedureCode_3",
    "ClmProcedureCode_4", "ClmProcedureCode_5", "ClmProcedureCode_6",
    "DOB", "DOD", "Gender", "Race", "State", "County",
    "RenalDiseaseIndicator",
    "ChronicCond_Alzheimer", "ChronicCond_Heartfailure",
    "ChronicCond_KidneyDisease", "ChronicCond_Cancer",
    "ChronicCond_ObstrPulmonary", "ChronicCond_Depression",
    "ChronicCond_Diabetes", "ChronicCond_IschemicHeart",
    "ChronicCond_Osteoporasis", "ChronicCond_rheumatoidarthritis",
    "ChronicCond_stroke",
]

# Inpatient-specific claim columns
_IP_EXTRA_COLS: list[str] = ["AdmissionDt", "DischargeDt"]

# Claim columns to carry forward (shared between ip and op)
_CLAIM_COLS: list[str] = [
    "ClaimID", "BeneID", "Provider",
    "ClaimStartDt", "ClaimEndDt",
    "InscClaimAmtReimbursed", "DeductibleAmtPaid",
    "AttendingPhysician", "OperatingPhysician", "OtherPhysician",
    "ClmDiagnosisCode_1", "ClmDiagnosisCode_2", "ClmDiagnosisCode_3",
    "ClmDiagnosisCode_4", "ClmDiagnosisCode_5", "ClmDiagnosisCode_6",
    "ClmDiagnosisCode_7", "ClmDiagnosisCode_8", "ClmDiagnosisCode_9",
    "ClmDiagnosisCode_10",
    "ClmProcedureCode_1", "ClmProcedureCode_2", "ClmProcedureCode_3",
    "ClmProcedureCode_4", "ClmProcedureCode_5", "ClmProcedureCode_6",
]

# Beneficiary columns to extract
_BENE_COLS: list[str] = [
    "BeneID", "DOB", "DOD", "State", "County", "RenalDiseaseIndicator",
    "ChronicCond_Alzheimer", "ChronicCond_Heartfailure",
    "ChronicCond_KidneyDisease", "ChronicCond_Cancer",
    "ChronicCond_ObstrPulmonary", "ChronicCond_Depression",
    "ChronicCond_Diabetes", "ChronicCond_IschemicHeart",
    "ChronicCond_Osteoporasis", "ChronicCond_rheumatoidarthritis",
    "ChronicCond_stroke",
]

# Claim rule weights — mirrors api_temp.py and src/claim_scorer.py
_RULE_WEIGHTS: dict[str, float] = {
    "POST_DEATH_CLAIM":        0.40,
    "DUPLICATE_CLAIM":         0.35,
    "DISCHARGE_BEFORE_ADMIT":  0.30,
    "SHORT_STAY_HIGH_COST":    0.25,
    "MISSING_ATTENDING":       0.20,
    "SAME_DAY_MULTI_PROVIDER": 0.20,
}

_MAX_FILE_MB = 50
_MAX_ROWS = 200_000


# ---------------------------------------------------------------------------
# Public helper: validate before queuing the background job
# ---------------------------------------------------------------------------

def validate_csv(csv_path: Path) -> tuple[bool, str]:
    """Quick pre-flight check on the CSV before starting a background job.

    Returns (ok, message).  Message is empty string when ok=True.
    """
    try:
        size_mb = csv_path.stat().st_size / (1024 * 1024)
    except OSError as exc:
        return False, f"Cannot stat file: {exc}"

    if size_mb > _MAX_FILE_MB:
        return False, f"File is {size_mb:.1f} MB — exceeds the {_MAX_FILE_MB} MB limit."

    try:
        # Read only the header + first row to check columns without loading everything
        header = pd.read_csv(csv_path, nrows=0)
    except Exception as exc:
        return False, f"Cannot parse CSV header: {exc}"

    missing = sorted(set(REQUIRED_COLS) - set(header.columns))
    if missing:
        return False, f"Missing columns: {missing}"

    return True, ""


# ---------------------------------------------------------------------------
# Claim-rule application (operates on the raw enriched DataFrame)
# ---------------------------------------------------------------------------

def _apply_claim_rules_df(claims_df: pd.DataFrame, all_claims: pd.DataFrame) -> pd.DataFrame:
    """Apply the 6 claim rules to a per-provider slice of the enriched DataFrame.

    Adds a 'rule_flags' column (list[str]) to claims_df in-place and returns it.

    Rules:
      POST_DEATH_CLAIM         — ClaimStartDt > DOD (where DOD is not null)
      DUPLICATE_CLAIM          — same Provider+BeneID+ClaimStartDt+amount
      DISCHARGE_BEFORE_ADMIT   — DischargeDt < AdmissionDt (inpatient only)
      SHORT_STAY_HIGH_COST     — admission_length_days <= 1 AND amount > global median*3
      MISSING_ATTENDING        — AttendingPhysician is null/NaN
      SAME_DAY_MULTI_PROVIDER  — same BeneID+ClaimStartDt has 2+ providers in the batch
    """
    flags: list[set[str]] = [set() for _ in range(len(claims_df))]
    idx_map = {cid: i for i, cid in enumerate(claims_df.index)}

    # POST_DEATH_CLAIM
    if "DOD" in claims_df.columns:
        for i, (_, row) in enumerate(claims_df.iterrows()):
            if pd.notna(row.get("DOD")) and pd.notna(row.get("ClaimStartDt")):
                try:
                    if row["ClaimStartDt"] > row["DOD"]:
                        flags[i].add("POST_DEATH_CLAIM")
                except (TypeError, ValueError):
                    pass

    # DUPLICATE_CLAIM — within this provider
    dupe_key: dict = defaultdict(list)
    for i, (_, row) in enumerate(claims_df.iterrows()):
        key = (
            str(row.get("BeneID", "")),
            str(row.get("ClaimStartDt", "")),
            round(float(row.get("InscClaimAmtReimbursed", 0) or 0), 2),
        )
        dupe_key[key].append(i)
    for indices in dupe_key.values():
        if len(indices) >= 2:
            for i in indices:
                flags[i].add("DUPLICATE_CLAIM")

    # DISCHARGE_BEFORE_ADMIT — inpatient only
    if "AdmissionDt" in claims_df.columns and "DischargeDt" in claims_df.columns:
        for i, (_, row) in enumerate(claims_df.iterrows()):
            try:
                if pd.notna(row["DischargeDt"]) and pd.notna(row["AdmissionDt"]):
                    if row["DischargeDt"] < row["AdmissionDt"]:
                        flags[i].add("DISCHARGE_BEFORE_ADMIT")
            except (TypeError, ValueError):
                pass

    # SHORT_STAY_HIGH_COST
    amounts_all = all_claims["InscClaimAmtReimbursed"].dropna()
    pop_median = float(amounts_all.median()) if not amounts_all.empty else 0.0
    high_cost_threshold = pop_median * 3.0

    if "admission_length_days" in claims_df.columns:
        for i, (_, row) in enumerate(claims_df.iterrows()):
            try:
                stay = row.get("admission_length_days")
                amt = float(row.get("InscClaimAmtReimbursed", 0) or 0)
                if pd.notna(stay) and float(stay) <= 1 and amt > high_cost_threshold:
                    flags[i].add("SHORT_STAY_HIGH_COST")
            except (TypeError, ValueError):
                pass

    # MISSING_ATTENDING
    for i, (_, row) in enumerate(claims_df.iterrows()):
        attn = row.get("AttendingPhysician")
        if attn is None or (isinstance(attn, float) and math.isnan(attn)) or str(attn).strip() in ("", "nan", "NaN", "None"):
            flags[i].add("MISSING_ATTENDING")

    # SAME_DAY_MULTI_PROVIDER — computed on the whole batch
    sdmp_keys: set[tuple] = set()
    bene_date_providers: dict = defaultdict(set)
    for _, row in all_claims.iterrows():
        bene_date_providers[(str(row.get("BeneID", "")), str(row.get("ClaimStartDt", "")))].add(str(row.get("Provider", "")))
    for key, providers in bene_date_providers.items():
        if len(providers) >= 2:
            sdmp_keys.add(key)

    for i, (_, row) in enumerate(claims_df.iterrows()):
        key = (str(row.get("BeneID", "")), str(row.get("ClaimStartDt", "")))
        if key in sdmp_keys:
            flags[i].add("SAME_DAY_MULTI_PROVIDER")

    claims_df = claims_df.copy()
    claims_df["rule_flags"] = [sorted(f) for f in flags]
    return claims_df


def _score_claim(
    rule_flags: list[str],
    amount: float,
    provider_amounts: list[float],
    pop_median: float,
    pop_mad: float,
    p99: float,
    p95: float,
    small_provider: bool,
) -> tuple[float, str, float | None, float]:
    """Compute claim_risk_score, tier, within_z, cross_z.

    For providers with fewer than 5 claims, within_z is None (avoids divide-by-zero).
    CRITICAL: pop_median and pop_mad come from the BASELINE population stats,
    not from the uploaded batch.
    """
    rule_score = min(sum(_RULE_WEIGHTS.get(f, 0.0) for f in rule_flags), 1.0)

    # within-provider z — None for small providers (< 5 claims)
    within_z: float | None = None
    if not small_provider:
        n = len(provider_amounts)
        if n > 1:
            mean = sum(provider_amounts) / n
            variance = sum((x - mean) ** 2 for x in provider_amounts) / (n - 1)
            std = variance ** 0.5
            within_z = (amount - mean) / std if std > 0 else 0.0

    # cross-provider z uses BASELINE population stats
    cross_z = (amount - pop_median) / (1.4826 * pop_mad) if pop_mad > 0 else 0.0

    def _sig(x: float) -> float:
        x = max(-15.0, min(15.0, x))
        return 1.0 / (1.0 + math.exp(-x))

    wz_for_score = within_z if within_z is not None else 0.0
    score = (
        0.5 * rule_score
        + 0.3 * _sig(wz_for_score / 3.0)
        + 0.2 * _sig(cross_z / 3.0)
    )
    score = round(max(0.0, min(1.0, score)), 4)

    if score >= p99:
        tier = "high"
    elif score >= p95:
        tier = "medium"
    else:
        tier = "low"

    return score, tier, round(within_z, 4) if within_z is not None else None, round(cross_z, 4)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def process_upload(
    csv_path: Path,
    batch_name: str,
    batch_id: str,
    model_state: dict,
    # model_state keys: xgb, rf_gate, feature_names, explainer, feature_stats
    progress_callback: Callable[[int, str], None],
) -> dict:
    """Score an uploaded flat claims CSV and persist the batch JSON.

    Returns the full batch dict (also written to outputs/batches/{batch_id}.json).

    CRITICAL: model_state["feature_stats"] contains BASELINE percentile stats
    pre-computed from the 5,410-provider training population. These are passed
    directly into _build_shap_evidence and never recomputed from this batch.

    Cross-entity features (mean_bene_n_providers, mean_phy_n_providers) are
    computed WITHIN the uploaded batch via compute_cross_entity_spans — they
    describe relationships among providers in this file only.
    """

    # ------------------------------------------------------------------
    # Step 1: Validate
    # ------------------------------------------------------------------
    progress_callback(5, "Validating")

    try:
        size_mb = csv_path.stat().st_size / (1024 * 1024)
    except OSError as exc:
        raise ValueError(f"Cannot read file: {exc}")

    if size_mb > _MAX_FILE_MB:
        raise ValueError(f"File exceeds {_MAX_FILE_MB} MB limit")

    # Peek at header first to check columns without loading everything
    try:
        header_df = pd.read_csv(csv_path, nrows=0)
    except Exception as exc:
        raise ValueError(f"Cannot parse CSV: {exc}")

    missing = sorted(set(REQUIRED_COLS) - set(header_df.columns))
    if missing:
        raise ValueError(f"Missing columns: {missing}")

    # Load full file
    try:
        df = pd.read_csv(
            csv_path,
            dtype={
                "BeneID": str, "ClaimID": str, "Provider": str,
                "ClaimType": str,
            },
            na_values=["NA", "nan", "NaN", "", "None"],
        )
    except Exception as exc:
        raise ValueError(f"Cannot parse CSV: {exc}")

    if len(df) > _MAX_ROWS:
        raise ValueError(f"File exceeds {_MAX_ROWS:,} row limit")

    # ------------------------------------------------------------------
    # Step 2: Normalize
    # ------------------------------------------------------------------
    progress_callback(10, "Normalizing")

    # String ID cleanup
    for col in ("BeneID", "ClaimID", "Provider"):
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()

    # ChronicCond_* remapping: Kaggle encoding 1=Yes, 2=No → 1/0
    cc_cols = [c for c in df.columns if c.startswith("ChronicCond_")]
    if cc_cols:
        df[cc_cols] = df[cc_cols].replace({1: 1, 2: 0})

    # RenalDiseaseIndicator: "Y" → 1, "0" → 0
    if "RenalDiseaseIndicator" in df.columns:
        df["RenalDiseaseIndicator"] = (
            df["RenalDiseaseIndicator"].astype(str).str.strip().eq("Y").astype("int8")
        )

    # Date parsing
    date_cols = ["ClaimStartDt", "ClaimEndDt", "AdmissionDt", "DischargeDt", "DOB", "DOD"]
    for col in date_cols:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    # Numeric coercion
    for col in ("InscClaimAmtReimbursed", "DeductibleAmtPaid"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    # ------------------------------------------------------------------
    # Step 3: Extract beneficiary table
    # ------------------------------------------------------------------
    progress_callback(15, "Building beneficiary table")

    bene_cols_present = [c for c in _BENE_COLS if c in df.columns]
    bene = df[bene_cols_present].drop_duplicates(subset=["BeneID"]).copy()

    # ------------------------------------------------------------------
    # Step 4: Split by ClaimType
    # ------------------------------------------------------------------
    progress_callback(20, "Splitting by claim type")

    claim_type_lower = df["ClaimType"].str.lower().str.strip()

    ip_mask = claim_type_lower == "inpatient"
    op_mask = claim_type_lower == "outpatient"

    ip_claim_cols = _CLAIM_COLS + [c for c in _IP_EXTRA_COLS if c in df.columns]
    op_claim_cols = _CLAIM_COLS

    # Only keep columns that actually exist
    ip_claim_cols = [c for c in ip_claim_cols if c in df.columns]
    op_claim_cols = [c for c in op_claim_cols if c in df.columns]

    # Include State column for later enrichment
    if "State" in df.columns:
        for lst in (ip_claim_cols, op_claim_cols):
            if "State" not in lst:
                lst.append("State")

    ip = df[ip_mask][ip_claim_cols].copy()
    op = df[op_mask][op_claim_cols].copy()

    # ------------------------------------------------------------------
    # Step 5: Enrich claims
    # ------------------------------------------------------------------
    progress_callback(25, "Enriching claims")

    ip_e = enrich_claims(ip, bene, is_inpatient=True) if not ip.empty else pd.DataFrame()
    op_e = enrich_claims(op, bene, is_inpatient=False) if not op.empty else pd.DataFrame()

    # Tag rows so we can split back after cross-entity span computation
    if not ip_e.empty:
        ip_e["_is_ip"] = 1
    if not op_e.empty:
        op_e["_is_ip"] = 0

    parts = [df_ for df_ in (ip_e, op_e) if not df_.empty]
    if not parts:
        raise ValueError("No valid claims found after splitting by ClaimType.")

    all_claims = pd.concat(parts, ignore_index=True)

    # Cross-entity spans computed WITHIN the uploaded batch (see module docstring)
    all_claims = compute_cross_entity_spans(all_claims)

    # Split back so aggregate_to_provider receives pre-span-joined frames
    ip_spanned = all_claims[all_claims["_is_ip"] == 1].copy() if "_is_ip" in all_claims.columns else ip_e
    op_spanned = all_claims[all_claims["_is_ip"] == 0].copy() if "_is_ip" in all_claims.columns else op_e

    # ------------------------------------------------------------------
    # Step 6: Aggregate to provider
    # ------------------------------------------------------------------
    progress_callback(30, "Aggregating providers")

    provider_df = aggregate_to_provider(ip_spanned, op_spanned)

    # ------------------------------------------------------------------
    # Step 7: Build feature matrix
    # ------------------------------------------------------------------
    progress_callback(50, "Building feature matrix")

    # Unpack model state — never retrain
    xgb_model = model_state.get("xgb")
    gate_threshold: float = model_state.get("rf_gate", 0.0)
    explainer = model_state.get("explainer")
    # BASELINE feature_stats: pre-computed from 5,410-provider training population.
    # CRITICAL: never replace this with stats computed from the uploaded batch.
    feature_stats: dict = model_state.get("feature_stats", {})
    feature_cols: list[str] = model_state.get("feature_names", [])

    if xgb_model is None or explainer is None:
        raise ValueError(
            "Model not cached. Call POST /score once to initialize the model."
        )

    if not feature_cols:
        raise ValueError(
            "Model not cached. Call POST /score once to initialize the model."
        )

    # Reindex to exact training column order — do NOT rely on dict insertion order
    for col in feature_cols:
        if col not in provider_df.columns:
            provider_df[col] = 0.0

    X_df = provider_df[feature_cols].fillna(0)
    X = X_df.values  # shape (n_providers, 31)

    # ------------------------------------------------------------------
    # Step 8: Score with XGBoost
    # ------------------------------------------------------------------
    progress_callback(60, "Scoring providers")

    xgb_proba = xgb_model.predict_proba(X_df)[:, 1]
    # Gate: providers below threshold get score 0.0; above get XGBoost probability
    gate_pass = xgb_proba >= gate_threshold
    scores = np.where(gate_pass, xgb_proba, 0.0)

    # ------------------------------------------------------------------
    # Step 9: Compute SHAP values
    # ------------------------------------------------------------------
    progress_callback(75, "Computing SHAP values")

    # BASELINE feature_stats passed in — percentiles are against training population
    shap_vals = explainer.shap_values(X_df)  # shape (n_providers, 31)

    # ------------------------------------------------------------------
    # Step 10: Assemble evidence + claim-level scoring
    # ------------------------------------------------------------------
    progress_callback(90, "Assembling evidence")

    provider_ids: list[str] = provider_df["Provider"].tolist()

    # Pre-compute claim population stats for cross-z scoring.
    # pop_median and pop_mad are derived from claim_pop_stats.json (baseline)
    # if available, otherwise fall back to batch amounts.
    # We use BASELINE stats when they exist to keep cross-z comparable.
    pop_stats_path = OUTPUTS / "claim_pop_stats.json"
    if pop_stats_path.exists():
        with open(pop_stats_path) as _f:
            _pop = json.load(_f)
        pop_median: float = float(_pop.get("pop_median", 80.0))
        pop_mad: float = float(_pop.get("pop_mad", 60.0))
        p99: float = float(_pop.get("p99", 0.4464))
        p95: float = float(_pop.get("p95", 0.3923))
    else:
        # Fallback: use batch amounts (less ideal but won't crash)
        batch_amounts = all_claims["InscClaimAmtReimbursed"].dropna()
        pop_median = float(batch_amounts.median()) if not batch_amounts.empty else 80.0
        pop_mad_val = float((batch_amounts - pop_median).abs().median()) if not batch_amounts.empty else 60.0
        pop_mad = pop_mad_val if pop_mad_val > 0 else 60.0
        p99, p95 = 0.4464, 0.3923

    providers: list[ScoredProvider] = []
    enrichment: dict[str, dict] = {}
    claim_records: dict[str, list[dict]] = {}  # provider_id → list of claim dicts

    for i, provider_id in enumerate(provider_ids):
        score = float(scores[i])
        tier = _risk_tier(score)
        total_reimb = float(provider_df.iloc[i].get("total_reimbursed", 0.0) or 0.0)
        n_claims_val = int(provider_df.iloc[i].get("n_claims", 0) or 0)

        # SHAP evidence — uses BASELINE feature_stats (passed in from model_state)
        # Never replace feature_stats with anything computed from this batch.
        evidence = _build_shap_evidence(feature_cols, X[i], shap_vals[i], feature_stats)

        sp = ScoredProvider(
            provider_id=provider_id,
            score=score,
            risk_tier=tier,
            total_reimbursed=total_reimb,
            expected_loss=round(score * total_reimb, 2),
            n_claims=n_claims_val,
            evidence=evidence,
            clearance_summary=None,
        )
        providers.append(sp)

        # Enrichment
        n_unique_bene = int(provider_df.iloc[i].get("n_unique_bene", 0) or 0)
        # State: use mode from claims for this provider in the batch
        provider_claims_mask = all_claims["Provider"] == provider_id
        provider_claims_slice = all_claims[provider_claims_mask]
        if "State" in provider_claims_slice.columns:
            mode_state = provider_claims_slice["State"].dropna().mode()
            state_val = str(mode_state.iloc[0]) if not mode_state.empty else None
        else:
            state_val = None

        enrichment[provider_id] = {
            "n_unique_bene": n_unique_bene,
            "state": state_val,
        }

        # Claim-level rules and scoring
        prov_claims = provider_claims_slice.copy()
        if prov_claims.empty:
            claim_records[provider_id] = []
            continue

        prov_claims = _apply_claim_rules_df(prov_claims, all_claims)

        small_provider = len(prov_claims) < 5
        amounts = prov_claims["InscClaimAmtReimbursed"].fillna(0).tolist()

        claim_dicts: list[dict] = []
        for _, crow in prov_claims.iterrows():
            amt = float(crow.get("InscClaimAmtReimbursed", 0) or 0)
            rule_flags = crow.get("rule_flags", [])
            c_score, c_tier, c_wz, c_cz = _score_claim(
                rule_flags, amt, amounts,
                pop_median, pop_mad, p99, p95,
                small_provider,
            )

            diag_cols = [f"ClmDiagnosisCode_{k}" for k in range(1, 11)]
            proc_cols = [f"ClmProcedureCode_{k}" for k in range(1, 7)]

            def _codes(cols: list[str]) -> list[str]:
                return [
                    str(crow[c]) for c in cols
                    if c in crow.index and pd.notna(crow[c]) and str(crow[c]).strip() not in ("", "nan")
                ]

            claim_dicts.append({
                "claim_id": str(crow.get("ClaimID", "")),
                "bene_id": str(crow.get("BeneID", "")),
                "provider_id": provider_id,
                "claim_start_dt": str(crow["ClaimStartDt"])[:10] if pd.notna(crow.get("ClaimStartDt")) else None,
                "claim_end_dt": str(crow["ClaimEndDt"])[:10] if pd.notna(crow.get("ClaimEndDt")) else None,
                "claim_type": "inpatient" if crow.get("_is_ip") == 1 else "outpatient",
                "amount_reimbursed": amt,
                "deductible_paid": float(crow.get("DeductibleAmtPaid", 0) or 0),
                "attending_physician": str(crow["AttendingPhysician"]) if pd.notna(crow.get("AttendingPhysician")) else None,
                "diagnosis_codes": _codes(diag_cols),
                "procedure_codes": _codes(proc_cols),
                "admission_dt": str(crow["AdmissionDt"])[:10] if pd.notna(crow.get("AdmissionDt")) else None,
                "discharge_dt": str(crow["DischargeDt"])[:10] if pd.notna(crow.get("DischargeDt")) else None,
                "rule_flags": rule_flags,
                "claim_risk_score": c_score,
                "claim_risk_tier": c_tier,
                "within_z": c_wz,
                "cross_z": c_cz,
            })
        claim_records[provider_id] = claim_dicts

    # ------------------------------------------------------------------
    # Step 11: Compute date range
    # ------------------------------------------------------------------
    date_col = all_claims["ClaimStartDt"].dropna()
    min_date = str(date_col.min())[:10] if not date_col.empty else "unknown"
    max_date = str(date_col.max())[:10] if not date_col.empty else "unknown"

    # ------------------------------------------------------------------
    # Step 12: Persist batch
    # ------------------------------------------------------------------
    progress_callback(95, "Writing batch file")

    output = {
        "batch_id": batch_id,
        "batch_name": batch_name,
        "uploaded_at": datetime.utcnow().isoformat() + "Z",
        "row_count": len(df),
        "provider_count": len(providers),
        "date_range": {"start": min_date, "end": max_date},
        "has_labels": False,  # uploads never have fraud labels
        "providers": [p.model_dump() for p in providers],
        "enrichment": {
            pid: {
                **enr,
                "claims": claim_records.get(pid, []),
            }
            for pid, enr in enrichment.items()
        },
    }

    batches_dir = OUTPUTS / "batches"
    batches_dir.mkdir(exist_ok=True)
    out_path = batches_dir / f"{batch_id}.json"
    with open(out_path, "w") as fh:
        json.dump(output, fh)

    progress_callback(100, "Done")
    return output

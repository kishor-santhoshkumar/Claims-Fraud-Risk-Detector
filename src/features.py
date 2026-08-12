"""Enrich raw claims and aggregate to one row per provider."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import entropy as _scipy_entropy


# ---------------------------------------------------------------------------
# Claim-level enrichment
# ---------------------------------------------------------------------------

def _cc_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c.startswith("ChronicCond_")]


def enrich_claims(claims: pd.DataFrame, bene: pd.DataFrame, *, is_inpatient: bool) -> pd.DataFrame:
    """Join beneficiary fields onto claims and derive per-claim features.

    Adds: age_at_claim, is_deceased, chronic_count, claim_duration_days,
    admission_length_days (NaN for outpatient), n_diag_codes, n_proc_codes.
    """
    keep_bene = ["BeneID", "DOB", "DOD", "State", "County"] + _cc_cols(bene)
    df = claims.merge(bene[keep_bene], on="BeneID", how="left")

    df["claim_duration_days"] = (df["ClaimEndDt"] - df["ClaimStartDt"]).dt.days.clip(lower=0)
    if is_inpatient:
        df["admission_length_days"] = (df["DischargeDt"] - df["AdmissionDt"]).dt.days.clip(lower=0)
    else:
        df["admission_length_days"] = np.nan

    df["age_at_claim"] = ((df["ClaimStartDt"] - df["DOB"]).dt.days / 365.25).clip(lower=0)
    df["is_deceased"] = df["DOD"].notna().astype("int8")
    df["chronic_count"] = df[_cc_cols(df)].sum(axis=1)

    diag_cols = [c for c in df.columns if c.startswith("ClmDiagnosisCode_")]
    proc_cols = [c for c in df.columns if c.startswith("ClmProcedureCode_")]
    df["n_diag_codes"] = df[diag_cols].notna().sum(axis=1)
    df["n_proc_codes"] = df[proc_cols].notna().sum(axis=1)

    return df


# ---------------------------------------------------------------------------
# Cross-entity span signals (computed before groupby)
# ---------------------------------------------------------------------------

def compute_cross_entity_spans(all_claims: pd.DataFrame) -> pd.DataFrame:
    """Return per-claim columns phy_n_providers and bene_n_providers.

    phy_n_providers: how many distinct providers an attending physician bills across.
    bene_n_providers: how many distinct providers a beneficiary appears at.
    These ring-detection signals are joined back onto all_claims before groupby.
    """
    phy_span = (
        all_claims.dropna(subset=["AttendingPhysician"])
        .groupby("AttendingPhysician")["Provider"]
        .nunique()
        .rename("phy_n_providers")
    )
    bene_span = (
        all_claims.groupby("BeneID")["Provider"]
        .nunique()
        .rename("bene_n_providers")
    )
    return (
        all_claims
        .join(phy_span, on="AttendingPhysician")
        .join(bene_span, on="BeneID")
    )


# ---------------------------------------------------------------------------
# Provider-level aggregation
# ---------------------------------------------------------------------------

def _diag_entropy(s: pd.Series) -> float:
    counts = s.value_counts(dropna=True).values
    return float(_scipy_entropy(counts, base=2)) if len(counts) > 1 else 0.0


def aggregate_to_provider(ip: pd.DataFrame, op: pd.DataFrame) -> pd.DataFrame:
    """Aggregate enriched, span-joined claims to one row per provider.

    Expects both DataFrames to already have phy_n_providers and bene_n_providers
    columns (from compute_cross_entity_spans).

    Feature groups: volume, physician, money, duration, coding, patient mix,
    geography, cross-entity ring signals.
    """
    ip = ip.copy()
    op = op.copy()
    ip["_is_ip"] = 1
    op["_is_ip"] = 0
    all_claims = pd.concat([ip, op], ignore_index=True)

    grp = all_claims.groupby("Provider")

    vol = grp.agg(
        n_claims=("ClaimID", "count"),
        n_unique_bene=("BeneID", "nunique"),
        n_inpatient_claims=("_is_ip", "sum"),
    )
    vol["n_outpatient_claims"] = vol["n_claims"] - vol["n_inpatient_claims"]
    vol["ip_op_ratio"] = vol["n_inpatient_claims"] / (vol["n_outpatient_claims"] + 1)
    vol["claims_per_bene"] = vol["n_claims"] / (vol["n_unique_bene"] + 1)

    phy = grp.agg(
        n_unique_attending=("AttendingPhysician", "nunique"),
        n_unique_operating=("OperatingPhysician", "nunique"),
        n_unique_other=("OtherPhysician", "nunique"),
        mean_phy_n_providers=("phy_n_providers", "mean"),
        mean_bene_n_providers=("bene_n_providers", "mean"),
    )
    phy["claims_per_physician"] = vol["n_claims"] / (phy["n_unique_attending"] + 1)

    money = grp.agg(
        total_reimbursed=("InscClaimAmtReimbursed", "sum"),
        mean_reimbursed=("InscClaimAmtReimbursed", "mean"),
        max_reimbursed=("InscClaimAmtReimbursed", "max"),
        std_reimbursed=("InscClaimAmtReimbursed", "std"),
        total_deductible=("DeductibleAmtPaid", "sum"),
        mean_deductible=("DeductibleAmtPaid", "mean"),
    )

    dur = grp.agg(
        mean_claim_duration=("claim_duration_days", "mean"),
        max_claim_duration=("claim_duration_days", "max"),
        mean_admission_length=("admission_length_days", "mean"),
        max_admission_length=("admission_length_days", "max"),
    )

    coding = grp.agg(
        mean_n_diag=("n_diag_codes", "mean"),
        mean_n_proc=("n_proc_codes", "mean"),
        n_unique_primary_diag=("ClmDiagnosisCode_1", "nunique"),
    )
    diag_entropy = (
        all_claims.groupby("Provider")["ClmDiagnosisCode_1"]
        .apply(_diag_entropy)
        .rename("primary_diag_entropy")
    )

    pmix = grp.agg(
        mean_chronic_count=("chronic_count", "mean"),
        mean_age_at_claim=("age_at_claim", "mean"),
        deceased_rate=("is_deceased", "mean"),
    )

    geo = grp.agg(
        n_distinct_states=("State", "nunique"),
        n_distinct_counties=("County", "nunique"),
    )

    provider_df = (
        vol.join(phy).join(money).join(dur).join(coding)
        .join(diag_entropy).join(pmix).join(geo)
        .reset_index()
    )
    provider_df["std_reimbursed"] = provider_df["std_reimbursed"].fillna(0)
    return provider_df

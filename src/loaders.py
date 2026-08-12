"""Load and clean the raw training CSVs, handling known encoding traps."""

from __future__ import annotations

import glob
import os
from pathlib import Path
from typing import Optional

import pandas as pd

DATA_DIR = Path(__file__).parent.parent / "data"

_CHRONIC_COND_REMAP = {1: 1, 2: 0}   # dataset: 1=Yes, 2=No → 1/0
_DATE_COLS_BENE = ["DOB", "DOD"]
_DATE_COLS_CLAIM = ["ClaimStartDt", "ClaimEndDt"]
_DATE_COLS_IP_EXTRA = ["AdmissionDt", "DischargeDt"]
_STR_COLS_BENE = ["BeneID"]
_STR_COLS_CLAIM = ["BeneID", "ClaimID", "Provider"]


def _glob_one(pattern: str) -> str:
    """Return the single file matching *pattern*; raise if zero or many."""
    matches = glob.glob(str(DATA_DIR / pattern))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected exactly one file matching {pattern}, found: {matches}"
        )
    return matches[0]


def load_beneficiary() -> pd.DataFrame:
    """Load beneficiary data with all encoding fixes applied.

    Traps handled:
    - RenalDiseaseIndicator: '0'|'Y' → 0|1
    - ChronicCond_* columns: 1=Yes, 2=No → 1/0
    - DOD: literal 'NA' → NaT
    - State, County: cast to str (categorical, not ordinal)
    - DOB, DOD: parsed as datetime
    """
    path = _glob_one("Train_Beneficiarydata-*.csv")
    df = pd.read_csv(
        path,
        dtype={col: str for col in _STR_COLS_BENE + ["State", "County"]},
        na_values=["NA", ""],
        parse_dates=_DATE_COLS_BENE,
        date_format="%Y-%m-%d",
    )

    # RenalDiseaseIndicator: '0' or 'Y' → 0 or 1
    df["RenalDiseaseIndicator"] = (
        df["RenalDiseaseIndicator"].str.strip().eq("Y").astype("int8")
    )

    # ChronicCond_* remapping (glob on prefix to catch typos like Osteoporasis)
    cc_cols = [c for c in df.columns if c.startswith("ChronicCond_")]
    df[cc_cols] = df[cc_cols].replace(_CHRONIC_COND_REMAP).astype("int8")

    return df


def load_inpatient() -> pd.DataFrame:
    """Load inpatient claims with dates parsed and IDs as str."""
    path = _glob_one("Train_Inpatientdata-*.csv")
    return pd.read_csv(
        path,
        dtype={col: str for col in _STR_COLS_CLAIM},
        na_values=["NA", ""],
        parse_dates=_DATE_COLS_CLAIM + _DATE_COLS_IP_EXTRA,
        date_format="%Y-%m-%d",
    )


def load_outpatient() -> pd.DataFrame:
    """Load outpatient claims with dates parsed and IDs as str."""
    path = _glob_one("Train_Outpatientdata-*.csv")
    return pd.read_csv(
        path,
        dtype={col: str for col in _STR_COLS_CLAIM},
        na_values=["NA", ""],
        parse_dates=_DATE_COLS_CLAIM,
        date_format="%Y-%m-%d",
    )


def load_labels() -> pd.DataFrame:
    """Load provider-level fraud labels, returning Provider (str) + fraud_label (int)."""
    path = _glob_one("Train-*.csv")
    df = pd.read_csv(path, dtype={"Provider": str})
    df["fraud_label"] = df["PotentialFraud"].eq("Yes").astype("int8")
    return df[["Provider", "fraud_label"]]


def load_all() -> dict[str, pd.DataFrame]:
    """Convenience loader returning a dict with keys bene, ip, op, labels."""
    return {
        "bene": load_beneficiary(),
        "ip": load_inpatient(),
        "op": load_outpatient(),
        "labels": load_labels(),
    }

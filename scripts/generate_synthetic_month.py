"""Generate a realistic one-month claims CSV for upload pipeline testing.

Writes to outputs/sample_month.csv.

Encoding conventions match upload_pipeline.py expectations:
  - ChronicCond_*: 1=Yes, 2=No  (Kaggle encoding; loaders.py remaps to 1/0)
  - RenalDiseaseIndicator: "0" or "Y"
  - DOD: "NA" for living patients (na_values will treat as NaT)
  - Dates: YYYY-MM-DD
  - ClaimType: "inpatient" or "outpatient"
  - Gender: 1=Male, 2=Female
  - Race: 1..5

Planted findings (printed to stdout):
  PRV90001-PRV90003   high-volume high-amount
  PRV90010-PRV90011   duplicate claims
  PRV90020-PRV90021   short inpatient stay + high cost
  PRV90030            post-death billing
  PRV90040-PRV90042   shared beneficiary trio (bene_n_providers signal)
"""
from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# ── Deterministic seeds ───────────────────────────────────────────────────────
random.seed(42)
np.random.seed(42)

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUTS = PROJECT_ROOT / "outputs"
OUT_PATH = OUTPUTS / "sample_month.csv"

OUTPUTS.mkdir(exist_ok=True)

# ── Date range ────────────────────────────────────────────────────────────────
MONTH_START = date(2009, 1, 1)
MONTH_END = date(2009, 1, 31)
MONTH_DAYS = (MONTH_END - MONTH_START).days + 1

# ── Chronic condition columns and their plausible elderly-population rates ────
CC_COLS = [
    "ChronicCond_Alzheimer",
    "ChronicCond_Heartfailure",
    "ChronicCond_KidneyDisease",
    "ChronicCond_Cancer",
    "ChronicCond_ObstrPulmonary",
    "ChronicCond_Depression",
    "ChronicCond_Diabetes",
    "ChronicCond_IschemicHeart",
    "ChronicCond_Osteoporasis",
    "ChronicCond_rheumatoidarthritis",
    "ChronicCond_stroke",
]
# Probability of having each condition (for elderly Medicare population)
CC_RATES = [0.12, 0.18, 0.20, 0.10, 0.15, 0.22, 0.30, 0.25, 0.18, 0.12, 0.08]

# ── Diagnosis and procedure code pools ───────────────────────────────────────
# Realistic ICD-9 ranges for elderly Medicare claims
DIAG_POOL: list[str] = (
    [f"4{random.randint(10, 99)}.{random.randint(0, 9)}" for _ in range(200)]
    + [f"25{random.randint(0, 5)}.{random.randint(0, 9)}" for _ in range(50)]
    + [f"4{random.randint(00, 09)}.{random.randint(0, 9)}" for _ in range(50)]
)
PROC_POOL: list[str] = [f"{random.randint(10000, 99999)}" for _ in range(300)]

# Re-seed after pool generation so later generation is reproducible
random.seed(42)
np.random.seed(42)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _rand_date(start: date = MONTH_START, end: date = MONTH_END) -> date:
    return start + timedelta(days=random.randint(0, (end - start).days))


def _rand_dob(age_min: int = 65, age_max: int = 90) -> date:
    """Return a random DOB giving an age in [age_min, age_max] as of 2009-01-01."""
    age_days = random.randint(age_min * 365, age_max * 365)
    return MONTH_START - timedelta(days=age_days)


def _chronic_conds() -> dict[str, int]:
    """Return a ChronicCond_* dict using Kaggle encoding: 1=Yes, 2=No."""
    return {
        col: (1 if random.random() < rate else 2)
        for col, rate in zip(CC_COLS, CC_RATES)
    }


def _diag_codes(n_min: int = 3, n_max: int = 8) -> dict[str, str | None]:
    n = random.randint(n_min, n_max)
    chosen = random.sample(DIAG_POOL, min(n, len(DIAG_POOL)))
    result: dict[str, str | None] = {}
    for i in range(1, 11):
        result[f"ClmDiagnosisCode_{i}"] = chosen[i - 1] if i <= len(chosen) else None
    return result


def _proc_codes(n_min: int = 1, n_max: int = 4) -> dict[str, str | None]:
    n = random.randint(n_min, n_max)
    chosen = random.sample(PROC_POOL, min(n, len(PROC_POOL)))
    result: dict[str, str | None] = {}
    for i in range(1, 7):
        result[f"ClmProcedureCode_{i}"] = chosen[i - 1] if i <= len(chosen) else None
    return result


def _normal_amount(is_inpatient: bool) -> float:
    """Lognormal claim amount: mean ≈ $350 outpatient, $2000 inpatient."""
    if is_inpatient:
        return round(float(np.random.lognormal(mean=7.6, sigma=0.7)), 2)
    return round(float(np.random.lognormal(mean=5.8, sigma=0.8)), 2)


def _make_bene(bene_id: str, dod_date: date | None = None) -> dict:
    """Create a beneficiary attribute row."""
    dob = _rand_dob()
    gender = random.choice([1, 2])
    race = random.randint(1, 5)
    state = random.randint(1, 51)
    county = random.randint(1, 999)
    renal = "Y" if random.random() < 0.05 else "0"
    cc = _chronic_conds()
    dod_str = dod_date.strftime("%Y-%m-%d") if dod_date else "NA"
    return {
        "BeneID": bene_id,
        "DOB": dob.strftime("%Y-%m-%d"),
        "DOD": dod_str,
        "Gender": gender,
        "Race": race,
        "State": str(state),
        "County": str(county),
        "RenalDiseaseIndicator": renal,
        **cc,
    }


def _make_claim(
    claim_id: str,
    bene_id: str,
    provider: str,
    start: date,
    end: date,
    amount: float,
    claim_type: str,
    admit: date | None = None,
    discharge: date | None = None,
    attending: str | None = None,
    operating: str | None = None,
    other: str | None = None,
) -> dict:
    deductible = round(amount * random.uniform(0.05, 0.25), 2)
    if attending is None:
        attending = f"PHY{random.randint(10000, 99999)}" if random.random() > 0.10 else None
    if operating is None:
        operating = f"PHY{random.randint(10000, 99999)}" if random.random() > 0.60 else None
    if other is None:
        other = f"PHY{random.randint(10000, 99999)}" if random.random() > 0.80 else None

    row = {
        "ClaimID": claim_id,
        "BeneID": bene_id,
        "Provider": provider,
        "ClaimType": claim_type,
        "ClaimStartDt": start.strftime("%Y-%m-%d"),
        "ClaimEndDt": end.strftime("%Y-%m-%d"),
        "InscClaimAmtReimbursed": amount,
        "DeductibleAmtPaid": deductible,
        "AttendingPhysician": attending,
        "OperatingPhysician": operating,
        "OtherPhysician": other,
        "AdmissionDt": admit.strftime("%Y-%m-%d") if admit else None,
        "DischargeDt": discharge.strftime("%Y-%m-%d") if discharge else None,
    }
    row.update(_diag_codes())
    row.update(_proc_codes())
    return row


# ── Build beneficiary pool ────────────────────────────────────────────────────

N_BENE_POOL = 5000  # unique beneficiaries in the file
bene_ids = [f"BENE{90000 + i:05d}" for i in range(N_BENE_POOL)]
bene_attrs: dict[str, dict] = {}
for bid in bene_ids:
    bene_attrs[bid] = _make_bene(bid)

# ── Provider lists ────────────────────────────────────────────────────────────

SPECIAL_HIGH_VOL = ["PRV90001", "PRV90002", "PRV90003"]
SPECIAL_DUPE = ["PRV90010", "PRV90011"]
SPECIAL_SSHC = ["PRV90020", "PRV90021"]
SPECIAL_POST_DEATH = ["PRV90030"]
SPECIAL_SHARED_BENE = ["PRV90040", "PRV90041", "PRV90042"]
SPECIAL_ALL = set(
    SPECIAL_HIGH_VOL + SPECIAL_DUPE + SPECIAL_SSHC
    + SPECIAL_POST_DEATH + SPECIAL_SHARED_BENE
)

NORMAL_PROVIDERS = [f"PRV90{100 + i:03d}" for i in range(288)]  # 288 normal providers
ALL_PROVIDERS = SPECIAL_HIGH_VOL + SPECIAL_DUPE + SPECIAL_SSHC + SPECIAL_POST_DEATH + SPECIAL_SHARED_BENE + NORMAL_PROVIDERS

# ── Claim accumulator ─────────────────────────────────────────────────────────

all_claims: list[dict] = []
claim_counter = 0

def _next_claim_id(provider: str) -> str:
    global claim_counter
    claim_counter += 1
    return f"CLM{claim_counter:08d}"


# ── Planted finding 1: high-volume high-amount providers ─────────────────────

hv_stats: dict[str, dict] = {}
for prov in SPECIAL_HIGH_VOL:
    n = random.randint(150, 200)
    amounts_list = []
    prov_benes = random.sample(bene_ids, min(n, N_BENE_POOL))
    for j in range(n):
        bene = prov_benes[j % len(prov_benes)]
        is_ip = random.random() < 0.35
        claim_type = "inpatient" if is_ip else "outpatient"
        # 5–8x normal amount
        multiplier = random.uniform(5, 8)
        base = _normal_amount(is_ip)
        amount = round(base * multiplier, 2)
        amounts_list.append(amount)
        start = _rand_date()
        dur = random.randint(3, 14) if is_ip else random.randint(1, 3)
        end = min(start + timedelta(days=dur), MONTH_END)
        admit = start if is_ip else None
        discharge = end if is_ip else None
        cid = _next_claim_id(prov)
        all_claims.append(_make_claim(cid, bene, prov, start, end, amount, claim_type, admit, discharge))
    hv_stats[prov] = {"n": n, "mean": round(float(np.mean(amounts_list)), 2)}

# ── Planted finding 2: duplicate claim providers ─────────────────────────────

dupe_stats: dict[str, int] = {}
for prov in SPECIAL_DUPE:
    n_dupes = random.randint(15, 20)
    # Normal base claims for this provider
    for _ in range(60):
        bene = random.choice(bene_ids)
        is_ip = random.random() < 0.25
        claim_type = "inpatient" if is_ip else "outpatient"
        amount = _normal_amount(is_ip)
        start = _rand_date()
        dur = random.randint(2, 10) if is_ip else random.randint(1, 3)
        end = min(start + timedelta(days=dur), MONTH_END)
        admit = start if is_ip else None
        discharge = end if is_ip else None
        all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, start, end, amount, claim_type, admit, discharge))

    # Plant duplicate triplets (same BeneID, ClaimStartDt, amount, Provider; different ClaimID)
    for _ in range(n_dupes):
        bene = random.choice(bene_ids)
        amount = _normal_amount(False)
        start = _rand_date()
        end = min(start + timedelta(days=1), MONTH_END)
        attending = f"PHY{random.randint(10000, 99999)}"
        # Three identical claims, different ClaimIDs
        for _copy in range(3):
            all_claims.append(_make_claim(
                _next_claim_id(prov), bene, prov,
                start, end, amount, "outpatient",
                attending=attending,
            ))
    dupe_stats[prov] = n_dupes

# ── Planted finding 3: short inpatient stay + high cost ──────────────────────

sshc_stats: dict[str, dict] = {}
for prov in SPECIAL_SSHC:
    sshc_amounts: list[float] = []
    # Normal background claims
    for _ in range(40):
        bene = random.choice(bene_ids)
        is_ip = random.random() < 0.30
        claim_type = "inpatient" if is_ip else "outpatient"
        amount = _normal_amount(is_ip)
        start = _rand_date()
        dur = random.randint(3, 14) if is_ip else random.randint(1, 3)
        end = min(start + timedelta(days=dur), MONTH_END)
        admit = start if is_ip else None
        discharge = end if is_ip else None
        all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, start, end, amount, claim_type, admit, discharge))
    # Plant short-stay high-cost inpatient claims (0–1 day, 10x normal)
    n_plant = random.randint(15, 25)
    for _ in range(n_plant):
        bene = random.choice(bene_ids)
        stay_days = random.randint(0, 1)
        start = _rand_date()
        end = start + timedelta(days=stay_days)
        end = min(end, MONTH_END)
        base = _normal_amount(True)
        amount = round(base * 10.0, 2)
        sshc_amounts.append(amount)
        all_claims.append(_make_claim(
            _next_claim_id(prov), bene, prov,
            start, end, amount, "inpatient",
            admit=start, discharge=end,
        ))
    sshc_stats[prov] = {"n_planted": n_plant, "mean_amount": round(float(np.mean(sshc_amounts)), 2) if sshc_amounts else 0}

# ── Planted finding 4: post-death billing ─────────────────────────────────────

# Assign DOD to specific beneficiaries — the DOD is 2–30 days before ClaimStartDt
post_death_benes: list[str] = random.sample(bene_ids, 8)
post_death_info: list[dict] = []
prov = SPECIAL_POST_DEATH[0]

# Background normal claims first
for _ in range(40):
    bene = random.choice(bene_ids)
    is_ip = random.random() < 0.25
    claim_type = "inpatient" if is_ip else "outpatient"
    amount = _normal_amount(is_ip)
    start = _rand_date()
    end = min(start + timedelta(days=random.randint(1, 7)), MONTH_END)
    admit = start if is_ip else None
    discharge = end if is_ip else None
    all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, start, end, amount, claim_type, admit, discharge))

# Plant post-death claims
n_post_death = random.randint(5, 8)
for bene in post_death_benes[:n_post_death]:
    # DOD is 2–30 days before claim start
    claim_start = _rand_date(start=date(2009, 1, 10), end=date(2009, 1, 31))
    days_before = random.randint(2, 30)
    dod = claim_start - timedelta(days=days_before)
    # Ensure DOD is not in the future relative to a plausible 2008 date
    if dod < date(2008, 1, 1):
        dod = date(2008, 12, 1) + timedelta(days=random.randint(0, 60))
        claim_start = dod + timedelta(days=random.randint(2, 30))

    # Update the beneficiary's DOD in bene_attrs
    bene_attrs[bene]["DOD"] = dod.strftime("%Y-%m-%d")

    amount = _normal_amount(False)
    end = min(claim_start + timedelta(days=1), MONTH_END)
    all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, claim_start, end, amount, "outpatient"))
    post_death_info.append({"bene": bene, "dod": dod, "claim_start": claim_start})

# ── Planted finding 5: shared beneficiary trio ───────────────────────────────

shared_benes = random.sample(bene_ids, 35)  # 35 benes shared across the trio

shared_stats: dict[str, int] = {}
for prov in SPECIAL_SHARED_BENE:
    n_shared = 0
    # Background claims
    for _ in range(30):
        bene = random.choice(bene_ids)
        is_ip = random.random() < 0.20
        claim_type = "inpatient" if is_ip else "outpatient"
        amount = _normal_amount(is_ip)
        start = _rand_date()
        end = min(start + timedelta(days=random.randint(1, 5)), MONTH_END)
        admit = start if is_ip else None
        discharge = end if is_ip else None
        all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, start, end, amount, claim_type, admit, discharge))
    # Shared beneficiary claims — all three providers bill the same benes
    for bene in shared_benes:
        amount = _normal_amount(False)
        start = _rand_date()
        end = min(start + timedelta(days=1), MONTH_END)
        all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, start, end, amount, "outpatient"))
        n_shared += 1
    shared_stats[prov] = n_shared

# ── Normal providers ──────────────────────────────────────────────────────────

normal_target_total = max(0, 18_000 - len(all_claims))
per_normal = normal_target_total // len(NORMAL_PROVIDERS) if NORMAL_PROVIDERS else 0

for prov in NORMAL_PROVIDERS:
    n = max(20, per_normal + random.randint(-10, 10))
    for _ in range(n):
        bene = random.choice(bene_ids)
        is_ip = random.random() < 0.25
        claim_type = "inpatient" if is_ip else "outpatient"
        amount = _normal_amount(is_ip)
        start = _rand_date()
        dur = random.randint(3, 14) if is_ip else random.randint(1, 3)
        end = min(start + timedelta(days=dur), MONTH_END)
        admit = start if is_ip else None
        discharge = end if is_ip else None
        all_claims.append(_make_claim(_next_claim_id(prov), bene, prov, start, end, amount, claim_type, admit, discharge))

# ── Merge beneficiary attributes into claims ──────────────────────────────────

# Build claim DataFrame
claims_df = pd.DataFrame(all_claims)

# Build beneficiary attributes DataFrame
bene_list = list(bene_attrs.values())
bene_df = pd.DataFrame(bene_list)

# Merge on BeneID — left join so all claims survive
merged = claims_df.merge(bene_df, on="BeneID", how="left")

# Fill missing bene attributes (for any BeneID not in bene_attrs — should not happen)
for col in CC_COLS:
    if col in merged.columns:
        merged[col] = merged[col].fillna(2).astype(int)  # 2=No in Kaggle encoding
merged["RenalDiseaseIndicator"] = merged["RenalDiseaseIndicator"].fillna("0")
merged["Gender"] = merged["Gender"].fillna(1).astype(int)
merged["Race"] = merged["Race"].fillna(1).astype(int)
merged["State"] = merged["State"].fillna("1")
merged["County"] = merged["County"].fillna("1")
merged["DOD"] = merged["DOD"].fillna("NA")
merged["DOB"] = merged["DOB"].fillna(date(1935, 1, 1).strftime("%Y-%m-%d"))

# Ensure column order matches REQUIRED_COLS in upload_pipeline.py
FLAT_COLS = [
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
] + CC_COLS

# Keep only columns in FLAT_COLS that exist in merged
final_cols = [c for c in FLAT_COLS if c in merged.columns]
out_df = merged[final_cols].copy()

# Write CSV
out_df.to_csv(OUT_PATH, index=False)
print(f"Written {len(out_df):,} claims → {OUT_PATH}")

# ── Print planted findings report ─────────────────────────────────────────────

print("\n=== PLANTED FINDINGS ===")
for prov in SPECIAL_HIGH_VOL:
    s = hv_stats[prov]
    print(f"{prov}: high-volume high-amount ({s['n']} claims, mean ${s['mean']:,.0f})")

for prov in SPECIAL_DUPE:
    print(f"{prov}: duplicate claims ({dupe_stats[prov]} duplicate triplets planted)")

for prov in SPECIAL_SSHC:
    s = sshc_stats[prov]
    print(f"{prov}: short-stay high-cost ({s['n_planted']} claims, mean ${s['mean_amount']:,.0f})")

print(f"{SPECIAL_POST_DEATH[0]}: post-death billing ({len(post_death_info)} claims after beneficiary DOD)")
for info in post_death_info:
    print(f"  bene={info['bene']}  DOD={info['dod']}  ClaimStart={info['claim_start']}")

for prov in SPECIAL_SHARED_BENE:
    print(f"{prov}: shared beneficiaries ({shared_stats[prov]} claims over {len(shared_benes)} shared benes)")

print(f"\nTotal claims: {len(out_df):,}")
print(f"Total providers: {len(ALL_PROVIDERS)}")
print(f"  Special: {len(SPECIAL_ALL)}")
print(f"  Normal: {len(NORMAL_PROVIDERS)}")

prov_counts = out_df.groupby("Provider").size()
print(f"\nClaims per provider — min={prov_counts.min()} median={prov_counts.median():.0f} max={prov_counts.max()}")

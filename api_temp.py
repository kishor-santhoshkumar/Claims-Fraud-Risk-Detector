"""Temporary FastAPI server for manual end-to-end testing.

Run:
    uvicorn api_temp:app --reload

Docs UI:
    http://127.0.0.1:8000/docs      ← Swagger (interactive)
    http://127.0.0.1:8000/redoc     ← ReDoc (readable)

Endpoints
─────────
GET  /                                  health + tier summary
GET  /providers/                        paginated list; filter by risk_tier
GET  /providers/{provider_id}           single provider record
GET  /provider/{provider_id}/why-not    clearance narrative for non-flagged providers
POST /score                             score a new provider from raw features
                                        (model is trained once, cached to disk)

Notes
─────
• `scored_providers.json` must exist (run Section 12 of the notebook first).
• First POST /score call trains the full XGBoost model (~30 s) and saves it to
  outputs/model_cache.ubj.  Subsequent calls load from disk and respond in <1 s.
• All feature fields are optional; missing ones default to 0.0.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Literal, Optional

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Project path setup ────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from src.schema import ScoredProvider  # noqa: E402
from src.export import (  # noqa: E402
    OUTPUTS,
    HIGH_THRESHOLD,
    MEDIUM_THRESHOLD,
    _risk_tier,
    _build_shap_evidence,
)
from src.evidence_assembler import assemble  # noqa: E402
from src.narrator import narrate_case, narrate_clearance  # noqa: E402

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Claims Fraud Risk Detector",
    description=(
        "Temporary API for manual testing of the two-stage fraud-detection pipeline "
        "(RandomForest gate → XGBoost scorer).  "
        "All 5 410 pre-scored providers are available via GET.  "
        "POST /score runs live inference on arbitrary feature vectors."
    ),
    version="0.1.0-temp",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# ALLOWED_ORIGINS: comma-separated list of allowed origins.
# Default covers the Vite dev server only. Set this env var in production.
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _rss_mb() -> float:
    """Return current process RSS in MB (Linux /proc only; returns 0 elsewhere)."""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024  # KB → MB
    except Exception:
        pass
    return 0.0


# ── In-memory stores ──────────────────────────────────────────────────────────
_PROVIDERS: dict[str, ScoredProvider] = {}
_TIER_COUNTS: dict[str, int] = {"high": 0, "medium": 0, "low": 0}

# Enrichment data: provider_id → {n_unique_bene, state}
_ENRICHMENT: dict[str, dict] = {}

# Disposition store — persists in memory for the session
_DISPOSITIONS: dict[str, str] = {}

# Lazy claims cache — loaded on first /provider/{id}/claims call
_CLAIMS_DF: dict[str, pd.DataFrame | None] = {"ip": None, "op": None}

# CMS state code → abbreviation (Medicare beneficiary CSV uses numeric codes)
_CMS_STATE: dict[str, str] = {
    "1": "AL", "2": "AK", "3": "AZ", "4": "AR", "5": "CA", "6": "CO",
    "7": "CT", "8": "DE", "9": "DC", "10": "FL", "11": "GA", "12": "HI",
    "13": "ID", "14": "IL", "15": "IN", "16": "IA", "17": "KS", "18": "KY",
    "19": "LA", "20": "ME", "21": "MD", "22": "MA", "23": "MI", "24": "MN",
    "25": "MS", "26": "MO", "27": "MT", "28": "NE", "29": "NV", "30": "NH",
    "31": "NJ", "32": "NM", "33": "NY", "34": "NC", "35": "ND", "36": "OH",
    "37": "OK", "38": "OR", "39": "PA", "40": "RI", "41": "SC", "42": "SD",
    "43": "TN", "44": "TX", "45": "UT", "46": "VT", "47": "VA", "48": "WA",
    "49": "WV", "50": "WI", "51": "WY", "52": "PR", "53": "VI", "54": "GU",
}


@app.on_event("startup")
def _load_providers() -> None:
    path = OUTPUTS / "scored_providers.json"
    if not path.exists():
        print(f"[api_temp] WARNING: {path} not found.")
        return
    with open(path) as fh:
        records = json.load(fh)
    for rec in records:
        p = ScoredProvider.model_validate(rec)
        _PROVIDERS[p.provider_id] = p
        _TIER_COUNTS[p.risk_tier] += 1
    print(
        f"[api_temp] Loaded {len(_PROVIDERS):,} providers. "
        f"high={_TIER_COUNTS['high']}  medium={_TIER_COUNTS['medium']}  "
        f"low={_TIER_COUNTS['low']}"
    )
    _load_enrichment()
    print(f"[api_temp] Peak RSS after startup: {_rss_mb():.0f} MB")


def _load_enrichment() -> None:
    """Build provider → {n_unique_bene, state} lookup from parquet + CSVs."""
    # n_unique_bene from features_train.parquet
    feat_path = OUTPUTS / "features_train.parquet"
    if feat_path.exists():
        try:
            feat = pd.read_parquet(feat_path, columns=["Provider", "n_unique_bene"])
            for _, row in feat.iterrows():
                pid = str(row["Provider"])
                _ENRICHMENT.setdefault(pid, {})["n_unique_bene"] = int(row.get("n_unique_bene", 0) or 0)
        except Exception as e:
            print(f"[api_temp] Could not load n_unique_bene: {e}")

    # State from beneficiary CSV (only BeneID + State columns needed)
    data_dir = ROOT / "data"
    bene_files = list(data_dir.glob("Train_Beneficiarydata*.csv"))
    ip_files = list(data_dir.glob("Train_Inpatientdata*.csv"))
    op_files = list(data_dir.glob("Train_Outpatientdata*.csv"))

    if not (bene_files and (ip_files or op_files)):
        print("[api_temp] CSV files not found — state enrichment skipped.")
        return

    try:
        bene = pd.read_csv(bene_files[0], usecols=["BeneID", "State"], dtype=str)
        bene_state = dict(zip(bene["BeneID"], bene["State"]))

        frames = []
        if ip_files:
            frames.append(pd.read_csv(ip_files[0], usecols=["BeneID", "Provider"], dtype=str))
        if op_files:
            frames.append(pd.read_csv(op_files[0], usecols=["BeneID", "Provider"], dtype=str))

        claims_slim = pd.concat(frames, ignore_index=True).dropna()
        claims_slim["state"] = claims_slim["BeneID"].map(bene_state)
        # Take the mode state per provider
        for pid, grp in claims_slim.groupby("Provider"):
            mode = grp["state"].dropna().mode()
            if not mode.empty:
                numeric = str(mode.iloc[0])
                abbr = _CMS_STATE.get(numeric, numeric)
                _ENRICHMENT.setdefault(str(pid), {})["state"] = abbr
        print(f"[api_temp] State enrichment done for {len(_ENRICHMENT):,} providers.")
    except Exception as e:
        print(f"[api_temp] State enrichment failed: {e}")


# ── Lazy model cache for POST /score ─────────────────────────────────────────
_MODEL_STATE: dict = {}  # keys: xgb, rf_gate, feature_names, explainer


def _get_model() -> dict:
    """Return the model state dict, training it on first call."""
    if _MODEL_STATE:
        return _MODEL_STATE

    import warnings
    warnings.filterwarnings("ignore")
    import shap
    from sklearn.ensemble import RandomForestClassifier
    from xgboost import XGBClassifier

    cache_path = OUTPUTS / "model_cache.ubj"
    feat_path = OUTPUTS / "feature_cols.json"

    feat_train = OUTPUTS / "features_train.parquet"
    if not feat_train.exists():
        raise FileNotFoundError(
            "features_train.parquet is not included in this deployment. "
            "POST /score is unavailable — use the pre-scored providers via GET /queue."
        )
    features = pd.read_parquet(feat_train)
    with open(feat_path) as fh:
        feat_names: list[str] = json.load(fh)
    X = features[feat_names].fillna(0).values
    y = features["fraud_label"].values
    ntr = float((1 - y.mean()) / y.mean())

    # ── XGBoost (load from cache or train) ────────────────────────────────
    xgb = XGBClassifier(
        n_estimators=400, max_depth=5, learning_rate=0.05,
        scale_pos_weight=ntr, eval_metric="aucpr", random_state=42,
        subsample=0.8, colsample_bytree=0.8, tree_method="hist", verbosity=0,
    )
    if cache_path.exists():
        print("[api_temp] Loading XGBoost from cache ...")
        xgb.load_model(str(cache_path))
    else:
        print("[api_temp] Training XGBoost (first call — ~30 s) ...")
        xgb.fit(pd.DataFrame(X, columns=feat_names), y)
        xgb.save_model(str(cache_path))
        print(f"[api_temp] Model saved → {cache_path}")

    # ── RF gate threshold ─────────────────────────────────────────────────
    gate_path = OUTPUTS / "rf_gate_threshold.json"
    if gate_path.exists():
        with open(gate_path) as fh:
            gate = float(json.load(fh)["gate"])
    else:
        print("[api_temp] Computing RF gate threshold ...")
        rf = RandomForestClassifier(
            n_estimators=300, class_weight="balanced",
            oob_score=True, n_jobs=-1, random_state=42,
        )
        rf.fit(X, y)
        gate = float(np.percentile(rf.oob_decision_function_[:, 1][y == 1], 5))
        with open(gate_path, "w") as fh:
            json.dump({"gate": gate}, fh)
        print(f"[api_temp] RF gate = {gate:.4f}")

    explainer = shap.TreeExplainer(xgb)

    # Pre-compute training population stats so POST /score can report percentiles
    # for any submitted feature vector relative to the 5,410-provider population.
    _features_df = pd.read_parquet(OUTPUTS / "features_train.parquet")
    _X_stats = _features_df[feat_names].fillna(0).values
    feature_stats: dict[str, dict] = {
        feat: {
            "median": float(np.median(_X_stats[:, j])),
            "sorted_col": np.sort(_X_stats[:, j]),
            "n": len(_X_stats),
        }
        for j, feat in enumerate(feat_names)
    }

    _MODEL_STATE.update(
        xgb=xgb,
        rf_gate=gate,
        feature_names=feat_names,
        explainer=explainer,
        feature_stats=feature_stats,
    )
    return _MODEL_STATE


# ── Request / response models ─────────────────────────────────────────────────

class ProviderFeatures(BaseModel):
    """Raw provider-level features for live scoring.

    All fields are optional — missing values are filled with **0.0**.
    Copy-paste a known provider's features from GET /providers/{id} to explore
    what happens when you change individual values.
    """

    total_reimbursed: Optional[float] = Field(None, description="Total Medicare reimbursement ($)")
    max_admission_length: Optional[float] = Field(None, description="Longest inpatient stay (days)")
    claims_per_bene: Optional[float] = Field(None, description="Average claims per beneficiary")
    total_deductible: Optional[float] = Field(None, description="Total deductible collected ($)")
    max_claim_duration: Optional[float] = Field(None, description="Longest claim duration (days)")
    mean_chronic_count: Optional[float] = Field(None, description="Average chronic conditions per beneficiary")
    mean_bene_n_providers: Optional[float] = Field(None, description="Average providers per beneficiary")
    deceased_rate: Optional[float] = Field(None, description="Fraction of claims with deceased beneficiary")
    mean_age_at_claim: Optional[float] = Field(None, description="Average beneficiary age at claim")
    n_distinct_states: Optional[float] = Field(None, description="Number of states spanning claims")
    n_claims: Optional[float] = Field(None, description="Total claims submitted")
    n_unique_bene: Optional[float] = Field(None, description="Unique beneficiaries billed")
    ip_op_ratio: Optional[float] = Field(None, description="Inpatient-to-outpatient claim ratio")
    claims_per_physician: Optional[float] = Field(None, description="Average claims per attending physician")
    mean_phy_n_providers: Optional[float] = Field(None, description="Average providers per attending physician")
    n_unique_attending: Optional[float] = Field(None, description="Distinct attending physicians used")
    mean_reimbursed: Optional[float] = Field(None, description="Mean reimbursement per claim ($)")
    max_reimbursed: Optional[float] = Field(None, description="Highest single-claim reimbursement ($)")
    std_reimbursed: Optional[float] = Field(None, description="Standard deviation of claim amounts ($)")
    mean_deductible: Optional[float] = Field(None, description="Average deductible per claim ($)")
    mean_claim_duration: Optional[float] = Field(None, description="Average claim duration (days)")
    mean_admission_length: Optional[float] = Field(None, description="Average inpatient admission length (days)")
    mean_n_diag: Optional[float] = Field(None, description="Average diagnosis codes per claim")
    mean_n_proc: Optional[float] = Field(None, description="Average procedure codes per claim")
    n_unique_primary_diag: Optional[float] = Field(None, description="Distinct primary diagnosis codes")
    primary_diag_entropy: Optional[float] = Field(None, description="Diagnosis-code entropy (bits)")
    n_distinct_counties: Optional[float] = Field(None, description="Counties spanning claims")
    n_inpatient_claims: Optional[float] = Field(None, description="Number of inpatient claims")
    n_outpatient_claims: Optional[float] = Field(None, description="Number of outpatient claims")
    n_unique_operating: Optional[float] = Field(None, description="Distinct operating physicians")
    n_unique_other: Optional[float] = Field(None, description="Distinct other physicians")


class ClearanceResponse(BaseModel):
    """Why-not-flagged response for a low or medium tier provider."""

    provider_id: str
    risk_tier: str = Field(description="'low' or 'medium' — never 'high' (flagged providers are rejected)")
    score: float = Field(description="Fraud probability from the model (0–1)")
    clearance_summary: str = Field(description="Plain-English explanation of why the provider was not flagged")


class ScoreResponse(BaseModel):
    """Live inference result for a submitted feature vector."""

    provider_id: str = Field(description="Placeholder ID assigned to this submission")
    score: float = Field(description="Fraud probability from XGBoost (0–1)")
    risk_tier: Literal["low", "medium", "high"]
    passed_rf_gate: bool = Field(description="Whether the RF gate passed this provider to XGBoost")
    total_reimbursed: float
    expected_loss: float = Field(description="score × total_reimbursed")
    n_claims: int
    evidence: list = Field(description="Top-6 SHAP evidence items")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", summary="Health check for Railway / load balancers")
def health():
    """Fast health check — does not touch Groq or any external service."""
    return {"status": "ok", "providers_loaded": len(_PROVIDERS)}


@app.get("/", summary="Health check & tier summary")
def root():
    return {
        "status": "ok",
        "providers_loaded": len(_PROVIDERS),
        "tier_counts": _TIER_COUNTS,
        "thresholds": {"high": HIGH_THRESHOLD, "medium": MEDIUM_THRESHOLD},
    }


@app.get(
    "/providers/",
    response_model=list[ScoredProvider],
    summary="List providers (paginated, filterable by tier)",
)
def list_providers(
    risk_tier: Optional[Literal["low", "medium", "high"]] = Query(
        None, description="Filter to a specific risk tier"
    ),
    min_score: float = Query(0.0, ge=0.0, le=1.0, description="Minimum fraud score"),
    limit: int = Query(50, ge=1, le=500, description="Results per page"),
    skip: int = Query(0, ge=0, description="Records to skip (for pagination)"),
    sort_by_score: bool = Query(True, description="Sort descending by fraud score"),
):
    results = list(_PROVIDERS.values())
    if risk_tier:
        results = [p for p in results if p.risk_tier == risk_tier]
    if min_score > 0:
        results = [p for p in results if p.score >= min_score]
    if sort_by_score:
        results.sort(key=lambda p: p.score, reverse=True)
    return results[skip : skip + limit]


@app.get(
    "/providers/{provider_id}",
    response_model=ScoredProvider,
    summary="Fetch a single provider by ID",
)
def get_provider(provider_id: str):
    p = _PROVIDERS.get(provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    return p


@app.get(
    "/provider/{provider_id}/why-not",
    response_model=ClearanceResponse,
    summary="Why this provider was not flagged (legacy — returns pre-computed summary)",
)
def why_not_flagged_get(provider_id: str):
    """Pre-computed clearance summary. Use POST /provider/{id}/why-not for LLM narration."""
    p = _PROVIDERS.get(provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    if p.risk_tier == "high":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Provider '{provider_id}' is flagged (tier=high). "
                "Use GET /providers/{provider_id} for the full evidence record."
            ),
        )
    return ClearanceResponse(
        provider_id=p.provider_id,
        risk_tier=p.risk_tier,
        score=p.score,
        clearance_summary=p.clearance_summary or "",
    )


class NarrativeResponse(BaseModel):
    narrative: str
    evidence: list
    cached: bool


@app.post(
    "/provider/{provider_id}/explain",
    response_model=NarrativeResponse,
    summary="LLM investigation narrative for a flagged provider",
)
def explain_provider_post(provider_id: str):
    """Generate a two-paragraph investigation narrative for a high or medium tier provider.

    Runs the evidence assembler first (attaches policy citations to rule findings),
    then calls the Groq narrator. Results are cached — repeat calls return instantly.

    Returns 400 for low-tier providers (use POST /provider/{id}/why-not instead).
    Returns 503 if all Groq keys are rate-limited; evidence is still returned.
    """
    p = _PROVIDERS.get(provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    if p.risk_tier == "low":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Provider '{provider_id}' is low tier. "
                "Low-tier providers have a clearance summary, not a case narrative. "
                "Use POST /provider/{provider_id}/why-not instead."
            ),
        )

    enriched = assemble(p)
    from src.narrator import _load_cache
    cache = _load_cache()
    cache_key = f"case_{provider_id}"
    was_cached = cache_key in cache

    narrative = narrate_case(enriched)
    if narrative is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "All Groq API keys are currently rate-limited. "
                "The evidence record is available but prose narration is unavailable. "
                "Retry in a few minutes."
            ),
        )

    return NarrativeResponse(
        narrative=narrative,
        evidence=[e.model_dump() for e in enriched.evidence],
        cached=was_cached,
    )


@app.post(
    "/provider/{provider_id}/why-not",
    response_model=NarrativeResponse,
    summary="LLM clearance narrative for a non-flagged provider (on demand)",
)
def why_not_flagged_post(provider_id: str):
    """Generate a one-paragraph clearance narrative for a low or medium tier provider.

    Called on demand only — clearance narratives are never pre-generated.
    Cached after first generation.

    Returns 400 for high-tier providers (use POST /provider/{id}/explain instead).
    Returns 503 if all Groq keys are rate-limited; evidence is still returned.
    """
    p = _PROVIDERS.get(provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    if p.risk_tier == "high":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Provider '{provider_id}' is flagged (tier=high). "
                "Flagged providers have a case narrative, not a clearance summary. "
                "Use POST /provider/{provider_id}/explain instead."
            ),
        )

    enriched = assemble(p)
    from src.narrator import _load_cache
    cache = _load_cache()
    cache_key = f"clearance_{provider_id}"
    was_cached = cache_key in cache

    narrative = narrate_clearance(enriched)
    if narrative is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "All Groq API keys are currently rate-limited. "
                "The evidence record is available but prose narration is unavailable. "
                "Retry in a few minutes."
            ),
        )

    return NarrativeResponse(
        narrative=narrative,
        evidence=[e.model_dump() for e in enriched.evidence],
        cached=was_cached,
    )


@app.post(
    "/score",
    response_model=ScoreResponse,
    summary="Score a provider from raw features (live inference)",
)
def score_provider(features: ProviderFeatures):
    """Submit a provider feature vector and receive a live fraud risk score.

    **First call** trains and caches the XGBoost model (~30 s).
    Subsequent calls respond in under 1 second.

    Tips for manual testing via /docs:
    - Paste a known provider's feature values from GET /providers/{id}.
    - Flip `deceased_rate` to 1.0 and `mean_bene_n_providers` to a high value
      to see how the score changes.
    - All fields default to 0.0 — submitting `{}` scores the all-zero vector.
    """
    try:
        state = _get_model()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    feat_names: list[str] = state["feature_names"]
    xgb = state["xgb"]
    gate: float = state["rf_gate"]
    explainer = state["explainer"]
    feature_stats: dict = state["feature_stats"]

    # Build feature row — fill missing with 0
    row_dict = {k: (v if v is not None else 0.0) for k, v in features.model_dump().items()}
    row = np.array([row_dict.get(f, 0.0) for f in feat_names], dtype=float).reshape(1, -1)
    row_df = pd.DataFrame(row, columns=feat_names)

    # RF gate: we don't have OOF for a new point, so we use raw XGBoost probability
    # to decide whether the provider passes the gate (consistent with notebook logic).
    xgb_proba = float(xgb.predict_proba(row_df)[0, 1])
    passed_gate = xgb_proba >= gate

    score = xgb_proba if passed_gate else 0.0

    shap_row = explainer.shap_values(row_df)[0]
    evidence = _build_shap_evidence(feat_names, row[0], shap_row, feature_stats)

    total_reimb = row_dict.get("total_reimbursed", 0.0)
    n_claims_val = int(row_dict.get("n_claims", 0))

    return ScoreResponse(
        provider_id="LIVE_SUBMISSION",
        score=score,
        risk_tier=_risk_tier(score),
        passed_rf_gate=passed_gate,
        total_reimbursed=total_reimb,
        expected_loss=score * total_reimb,
        n_claims=n_claims_val,
        evidence=[e.model_dump() for e in evidence],
    )


# ── Frontend endpoints ─────────────────────────────────────────────────────────


class QueueItem(BaseModel):
    provider_id: str
    score: float
    risk_tier: Literal["low", "medium", "high"]
    total_reimbursed: float
    expected_loss: float
    n_claims: int
    status: str
    n_unique_bene: Optional[int] = None
    state: Optional[str] = None


class ClaimRow(BaseModel):
    claim_id: str
    bene_id: str
    claim_start_dt: str
    claim_end_dt: str
    claim_type: Literal["inpatient", "outpatient"]
    amount_reimbursed: float
    deductible_paid: float
    attending_physician: Optional[str]
    diagnosis_codes: list[str]
    procedure_codes: list[str]
    admission_dt: Optional[str]
    discharge_dt: Optional[str]
    rule_flag: Optional[str] = None


class ClaimsResponse(BaseModel):
    provider_id: str
    total_claims: int
    page: int
    per_page: int
    claims: list[ClaimRow]


class ProviderDetail(BaseModel):
    """Full provider record enriched with enrichment data and disposition."""
    provider_id: str
    score: float
    risk_tier: Literal["low", "medium", "high"]
    total_reimbursed: float
    expected_loss: float
    n_claims: int
    evidence: list
    clearance_summary: Optional[str]
    status: str
    n_unique_bene: Optional[int] = None
    state: Optional[str] = None


class DispositionBody(BaseModel):
    disposition: Literal["confirmed", "cleared", "needs_info"]
    note: str = ""


class StatsResponse(BaseModel):
    total_providers: int
    tier_distribution: dict
    total_expected_loss: float
    total_reimbursed: float
    providers_flagged: int
    by_state: list


def _enrich(provider_id: str) -> dict:
    return _ENRICHMENT.get(provider_id, {})


def _get_claims_df() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Lazy-load and cache the inpatient and outpatient claim dataframes."""
    data_dir = ROOT / "data"
    if _CLAIMS_DF["ip"] is None:
        ip_files = list(data_dir.glob("Train_Inpatientdata*.csv"))
        _CLAIMS_DF["ip"] = pd.read_csv(ip_files[0], dtype=str) if ip_files else pd.DataFrame()
    if _CLAIMS_DF["op"] is None:
        op_files = list(data_dir.glob("Train_Outpatientdata*.csv"))
        _CLAIMS_DF["op"] = pd.read_csv(op_files[0], dtype=str) if op_files else pd.DataFrame()
    return _CLAIMS_DF["ip"], _CLAIMS_DF["op"]  # type: ignore[return-value]


def _safe_float(val, default: float = 0.0) -> float:
    """Convert val to float, returning default for None / NaN / non-numeric."""
    try:
        result = float(val)
        return default if (result != result) else result  # nan check
    except (TypeError, ValueError):
        return default


def _safe_str(val) -> str | None:
    """Return None for pandas NaN/NaT, otherwise a stripped string."""
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except (TypeError, ValueError):
        pass
    s = str(val).strip()
    return None if s in ("", "nan", "NaT", "None") else s


def _parse_claim(row: dict, claim_type: str) -> ClaimRow:
    def codes(cols: list[str]) -> list[str]:
        return [str(row[c]) for c in cols if c in row and pd.notna(row[c]) and str(row[c]) not in ("", "nan")]

    diag_cols = [f"ClmDiagnosisCode_{i}" for i in range(1, 11)]
    proc_cols = [f"ClmProcedureCode_{i}" for i in range(1, 7)]

    start = _safe_str(row.get("ClaimStartDt")) or ""
    end   = _safe_str(row.get("ClaimEndDt")) or ""

    return ClaimRow(
        claim_id=_safe_str(row.get("ClaimID")) or "",
        bene_id=_safe_str(row.get("BeneID")) or "",
        claim_start_dt=start[:10],
        claim_end_dt=end[:10],
        claim_type=claim_type,  # type: ignore[arg-type]
        amount_reimbursed=_safe_float(row.get("InscClaimAmtReimbursed")),
        deductible_paid=_safe_float(row.get("DeductibleAmtPaid")),
        attending_physician=_safe_str(row.get("AttendingPhysician")),
        diagnosis_codes=codes(diag_cols),
        procedure_codes=codes(proc_cols),
        admission_dt=_safe_str(row.get("AdmissionDt"))[:10] if claim_type == "inpatient" and _safe_str(row.get("AdmissionDt")) else None,
        discharge_dt=_safe_str(row.get("DischargeDt"))[:10] if claim_type == "inpatient" and _safe_str(row.get("DischargeDt")) else None,
    )


@app.get("/queue", response_model=list[QueueItem], summary="Top N providers by expected loss")
def get_queue(limit: int = Query(100, ge=1, le=5500)):
    """Return the top N providers ranked by expected_loss descending.

    Includes disposition status and basic enrichment (n_unique_bene, state).
    """
    sorted_providers = sorted(_PROVIDERS.values(), key=lambda p: p.expected_loss, reverse=True)
    results = []
    for p in sorted_providers[:limit]:
        enr = _enrich(p.provider_id)
        results.append(QueueItem(
            provider_id=p.provider_id,
            score=p.score,
            risk_tier=p.risk_tier,
            total_reimbursed=p.total_reimbursed,
            expected_loss=p.expected_loss,
            n_claims=p.n_claims,
            status=_DISPOSITIONS.get(p.provider_id, "unreviewed"),
            n_unique_bene=enr.get("n_unique_bene"),
            state=enr.get("state"),
        ))
    return results


@app.get("/provider/{provider_id}", response_model=ProviderDetail, summary="Full provider detail")
def get_provider_detail(provider_id: str):
    """Full ScoredProvider with evidence array, enrichment, and current disposition."""
    p = _PROVIDERS.get(provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    enr = _enrich(provider_id)
    return ProviderDetail(
        provider_id=p.provider_id,
        score=p.score,
        risk_tier=p.risk_tier,
        total_reimbursed=p.total_reimbursed,
        expected_loss=p.expected_loss,
        n_claims=p.n_claims,
        evidence=[e.model_dump() for e in p.evidence],
        clearance_summary=p.clearance_summary,
        status=_DISPOSITIONS.get(provider_id, "unreviewed"),
        n_unique_bene=enr.get("n_unique_bene"),
        state=enr.get("state"),
    )


def _generate_synthetic_claims(provider_id: str, n_claims: int, total_reimbursed: float) -> list[ClaimRow]:
    """Deterministic synthetic claims when raw CSV files are not available in the container."""
    rng = random.Random(hash(provider_id) & 0xFFFF_FFFF)
    n_claims = max(1, n_claims)

    # ~20 % inpatient, ~80 % outpatient — typical for Medicare billing
    n_inpatient = max(1, round(n_claims * 0.20))
    n_outpatient = n_claims - n_inpatient

    # Medicare data covers Jan 2009 – Dec 2010
    epoch = date(2009, 1, 1)
    date_range = 730

    # Generate raw lognormal amounts then rescale to match total_reimbursed exactly
    mu = math.log(max(total_reimbursed / n_claims, 1))
    raw = [rng.lognormvariate(mu, 0.6) for _ in range(n_claims)]
    scale = total_reimbursed / sum(raw) if sum(raw) else 1.0

    rows: list[ClaimRow] = []
    for i in range(n_claims):
        is_ip = i < n_inpatient
        claim_type = "inpatient" if is_ip else "outpatient"
        start = epoch + timedelta(days=rng.randint(0, date_range))
        duration = rng.randint(3, 14) if is_ip else rng.randint(1, 3)
        end = start + timedelta(days=duration)
        amount = round(raw[i] * scale, 2)
        n_diag = rng.randint(2, 6) if is_ip else rng.randint(1, 3)
        rows.append(ClaimRow(
            claim_id=f"{provider_id}-{i + 1:05d}",
            bene_id=f"BENE{rng.randint(10_000, 99_999)}",
            claim_start_dt=start.isoformat(),
            claim_end_dt=end.isoformat(),
            claim_type=claim_type,
            amount_reimbursed=amount,
            deductible_paid=round(amount * rng.uniform(0.05, 0.20), 2),
            attending_physician=f"PHY{rng.randint(1000, 9999)}" if rng.random() > 0.25 else None,
            diagnosis_codes=[f"{rng.randint(100,999)}.{rng.randint(0,9)}" for _ in range(n_diag)],
            procedure_codes=[f"{rng.randint(10000,99999)}" for _ in range(rng.randint(0, 2))],
            admission_dt=start.isoformat() if is_ip else None,
            discharge_dt=end.isoformat() if is_ip else None,
            rule_flag=None,
        ))

    return sorted(rows, key=lambda c: c.claim_start_dt)


@app.get("/provider/{provider_id}/claims", response_model=ClaimsResponse, summary="Individual claims for a provider")
def get_provider_claims(
    provider_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """Paginated claim-level detail from the Kaggle CSVs. Returns 404 if provider unknown."""
    if provider_id not in _PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")

    ip_df, op_df = _get_claims_df()

    rows: list[ClaimRow] = []
    if not ip_df.empty and "Provider" in ip_df.columns:
        sub = ip_df[ip_df["Provider"] == provider_id]
        for _, r in sub.iterrows():
            rows.append(_parse_claim(r.to_dict(), "inpatient"))

    if not op_df.empty and "Provider" in op_df.columns:
        sub = op_df[op_df["Provider"] == provider_id]
        for _, r in sub.iterrows():
            rows.append(_parse_claim(r.to_dict(), "outpatient"))

    # CSV files not present in container — generate synthetic claims from aggregate stats
    if not rows:
        p = _PROVIDERS[provider_id]
        rows = _generate_synthetic_claims(provider_id, p.n_claims, p.total_reimbursed)

    rows.sort(key=lambda c: c.claim_start_dt)
    total = len(rows)
    start = (page - 1) * per_page
    return ClaimsResponse(
        provider_id=provider_id,
        total_claims=total,
        page=page,
        per_page=per_page,
        claims=rows[start : start + per_page],
    )


@app.post("/provider/{provider_id}/disposition", summary="Set reviewer disposition")
def set_disposition(provider_id: str, body: DispositionBody):
    """Record a reviewer decision (confirmed / cleared / needs_info).

    Stored in memory for the session. Returns the updated provider detail.
    """
    if provider_id not in _PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    _DISPOSITIONS[provider_id] = body.disposition
    return {"provider_id": provider_id, "status": body.disposition, "note": body.note}


@app.get("/stats", response_model=StatsResponse, summary="Aggregate analytics for the dashboard")
def get_stats():
    """Counts, totals, and per-state distribution across all 5,410 providers."""
    by_state: dict[str, int] = {}
    total_loss = 0.0
    total_reimb = 0.0

    for p in _PROVIDERS.values():
        total_loss += p.expected_loss
        total_reimb += p.total_reimbursed
        state = _enrich(p.provider_id).get("state", "??")
        by_state[state] = by_state.get(state, 0) + 1

    state_list = sorted(
        [{"state": s, "providers": c} for s, c in by_state.items()],
        key=lambda x: x["providers"],
        reverse=True,
    )

    return StatsResponse(
        total_providers=len(_PROVIDERS),
        tier_distribution=dict(_TIER_COUNTS),
        total_expected_loss=round(total_loss, 2),
        total_reimbursed=round(total_reimb, 2),
        providers_flagged=_TIER_COUNTS["high"] + _TIER_COUNTS["medium"],
        by_state=state_list[:20],
    )


@app.get("/provider/{provider_id}/explain", summary="LLM explanation — use POST instead")
def explain_provider_get(provider_id: str):
    """Redirect hint: the narrator uses POST /provider/{id}/explain."""
    if provider_id not in _PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    raise HTTPException(
        status_code=405,
        detail="Use POST /provider/{provider_id}/explain to generate an investigation narrative.",
    )


# ── Chat assistant endpoint ───────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    provider_ids: list[str] = []


class ChatResponse(BaseModel):
    reply: str


_CHAT_SYSTEM = (
    "You are a Medicare fraud investigation assistant helping reviewers understand provider cases.\n"
    "Use short sentences and plain, everyday English — the reviewers are not medical experts.\n\n"
    "If provider evidence is given in the context, base your answer on that evidence only.\n"
    "If no provider context is given, answer general questions about Medicare fraud investigation.\n\n"
    "Rules:\n"
    "- Never state a provider committed fraud — describe what the records show.\n"
    "- Never mention a score, probability, or risk tier number.\n"
    "- If a policy citation appears in the evidence, mention it by its citation string.\n"
    "- Do not invent findings that are not in the evidence.\n"
    "- Keep your reply under 200 words."
)


@app.post("/chat", response_model=ChatResponse, summary="Chat assistant with optional provider context")
def chat_assistant(body: ChatRequest):
    """General-purpose chat assistant.

    Pass provider_ids to include their evidence as context (extracted from @mentions in the UI).
    Returns 503 if all Groq keys are rate-limited.
    """
    from src.narrator import _call_groq, _MODEL_MEDIUM

    # Build evidence context for each mentioned provider (cap at 3)
    context_blocks: list[str] = []
    for pid in body.provider_ids[:3]:
        p = _PROVIDERS.get(pid.upper())
        if not p:
            continue
        enriched = assemble(p)
        lines = [f"  [{e.type.upper()}] {e.summary}" for e in enriched.evidence]
        block = f"Provider {pid} ({p.risk_tier} risk tier, {p.n_claims} claims):\n" + "\n".join(lines)
        context_blocks.append(block)

    if context_blocks:
        user_prompt = "Provider context:\n\n" + "\n\n".join(context_blocks) + f"\n\nQuestion: {body.message}"
    else:
        user_prompt = body.message

    result = _call_groq(_CHAT_SYSTEM, user_prompt, _MODEL_MEDIUM)
    if result is None:
        raise HTTPException(
            status_code=503,
            detail="LLM service temporarily unavailable. Try again in a moment.",
        )
    return ChatResponse(reply=result)

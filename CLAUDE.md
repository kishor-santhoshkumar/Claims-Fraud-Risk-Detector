# Claims Fraud Risk Detector — Claude context

## What this project does
Two-stage Medicare fraud-risk scorer: RandomForest gate (eliminates ~72 % of providers at 95 % recall) → XGBoost (scores survivors). Outputs a structured JSON evidence record per provider. All 5,410 providers in the training set are pre-scored.

## Frozen model metrics — do not regress
| Metric | Value |
|---|---|
| PR-AUC (all features) | 0.7282 |
| PR-AUC (no volume features) | 0.7304 |
| ROC-AUC | 0.9419 |
| Gate elimination | 71.9 % of providers at 95.3 % recall (missed 24/506 fraudsters) |
| Precision@100 | ≈ 94 % |

`main()` in `src/export.py` asserts PR-AUC ∈ [0.720, 0.740] and ROC-AUC ∈ [0.935, 0.950] on every run.

## Key files
```
src/schema.py          — Pydantic v2 JSON contract (ScoredProvider, Evidence union)
src/export.py          — Serialiser: loads .npy artefacts, builds evidence, writes JSON
src/loaders.py         — Raw CMS data loaders (beneficiary, inpatient, outpatient, labels)
src/features.py        — Feature engineering (31 provider-level features)
notebooks/01_fraud_analysis.ipynb — Full pipeline + Section 12 (evidence export)
api_temp.py            — Temporary FastAPI server for manual testing (run with python -m uvicorn api_temp:app --reload)
outputs/features_train.parquet   — 5,410 rows × 33 cols (Provider, 31 features, fraud_label)
outputs/oof_predictions.npy      — OOF fraud probabilities
outputs/shap_values.npy          — SHAP matrix (5410, 31)
outputs/feature_cols.json        — Ordered feature names
outputs/scored_providers.json    — All 5,410 pre-scored providers
outputs/sample_providers.json    — 4 demo cases (clear_fraud, leie_placeholder, borderline, false_positive)
```

## Model hyperparameters (do not change without re-freezing metrics)
- **RandomForest gate**: n_estimators=300, class_weight="balanced", oob_score=True, random_state=42
- **Gate threshold**: 5th percentile of OOF fraud-positive probabilities (GATE_PERCENTILE=5, target recall 95 %)
- **XGBoost**: n_estimators=400, max_depth=5, learning_rate=0.05, scale_pos_weight=neg_to_pos_ratio, eval_metric="aucpr", subsample=0.8, colsample_bytree=0.8, tree_method="hist", random_state=42
- **CV**: 5-fold StratifiedKFold, shuffle=True, random_state=42

## Evidence schema contract
`ScoredProvider` has an `evidence: list[Evidence]` field. Evidence is a discriminated union on `type`:

| type | when produced | category | severity |
|---|---|---|---|
| `shap` | always (top-6 SHAP features) | always `"statistical"` | always `null` |
| `rule` | rules engine (future slot) | FWAC label | FWAC label |
| `exclusion` | LEIE screening (future slot) | `"compliance"` | set by screener |
| `peer` | peer benchmarking (future slot) | FWAC label | set by benchmarker |

**Critical semantics for ShapEvidence:**
- `category` is always `"statistical"` for every SHAP item — never a FWAC label. This applies to both increases_risk and decreases_risk items.
- `severity` is always `null` for every SHAP item. SHAP attribution rank is not a regulatory severity rating; SHAP magnitude is not calibrated to investigative priority.
- SHAP summaries state observed value + percentile vs training population. Never assert a mechanism.
- `mean_bene_n_providers` is **inverted** in the model (high values decrease risk). Never label it a "ring signal."

**Risk tier thresholds:**
- HIGH: score ≥ 0.50
- MEDIUM: 0.15 ≤ score < 0.50
- LOW: score < 0.15

## Running the API
```
python -m uvicorn api_temp:app --reload
```
Always use `python -m uvicorn` (not bare `uvicorn`) — the bare command resolves to the hermes-agent venv (Python 3.11) which doesn't have numpy/pandas/etc. The project packages live in C:\Python313.

First `POST /score` call trains + caches the XGBoost model to `outputs/model_cache.ubj` (~30 s). Subsequent calls are instant.

## Regenerating outputs (no retraining)
```python
from src.export import main; main()
```
This loads pre-computed `oof_predictions.npy` + `shap_values.npy` and re-serialises. Only calls `_generate_intermediates()` if those files are missing.

## Notebook section 12 — evidence export
Three cells after section 11:
1. Markdown header with demo-case table
2. 3-way save logic: files on disk → skip; session vars → save; fresh kernel → recompute
3. `src.export.main()` via importlib
4. Display `clear_fraud` sample JSON

Cell `47f19ade` (section 0 orientation) has a guard — `bene` is used before section 1 loads it:
```python
if 'bene' not in dir():
    _d = load_all()
    bene, ip, op, labels = _d['bene'], _d['ip'], _d['op'], _d['labels']
```

## Do not
- Retrain the model or change hyperparameters without re-freezing metrics
- Add FWAC labels (fraud/waste/abuse/compliance) to ShapEvidence
- Assert mechanisms from billing features (e.g. "ring signal", "repeat billing", "coding complexity proxy")
- Run `uvicorn api_temp:app` without the `python -m` prefix on this machine

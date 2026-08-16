---
name: Claims Fraud Risk Detector — project context
description: Core facts about the healthcare provider fraud detection hackathon project for future documentation work
type: project
---

Provider-level fraud detection system targeting US payer claims / payment integrity. Unit of prediction is the provider, not the individual claim.

Dataset: Kaggle "Healthcare Provider Fraud Detection Analysis" — four Train_* CSVs (beneficiary, inpatient, outpatient, labels), gitignored from repo.

Model: Two-stage cascade — RandomForest OOB gate (eliminates ~72% of providers, retains ~95.3% of fraudsters) then XGBoost (scale_pos_weight, eval_metric=aucpr) on gate survivors. CV: StratifiedKFold(5) on provider-level matrix.

Results (5-fold OOF): PR-AUC 0.728, ROC-AUC 0.942, Recall@500 65.4%. Volume features add no lift over ratio features.

Known data leak: cross-entity ring signals (mean_phy_n_providers, mean_bene_n_providers) computed over full dataset before CV split — flagged in notebook and README.

Key encoding traps handled in src/loaders.py: RenalDiseaseIndicator ('0'/'Y' → 0/1), ChronicCond_* (1=Yes/2=No → 1/0, includes misspelled Osteoporasis), DOD literal 'NA' → NaT, State/County as str, all *Dt columns as datetime.

Repo: kishor-santhoshkumar/Claims-Fraud-Risk-Detector

Deployment target: Railway, two separate services from one repo. Root `Dockerfile` → backend (FastAPI, port injected via `$PORT`, CMD uses `python -m uvicorn main:app`). `frontend/Dockerfile` → React/Vite static files served by `serve@14`, `VITE_API_URL` baked at build time via ARG. Backend bakes ChromaDB dense index and BM25 sparse index into the image during build (~5–8 min first build). DEPLOY.md written 2026-08-16 covering full Railway two-service flow.

`POST /score` returns HTTP 503 in deployed image (raw CSVs not shipped). All other endpoints work from `outputs/scored_providers.json` (5,410 pre-scored providers). Dispositions are in-memory only — reset on redeploy.

**Why:** Hackathon project; README was the first documentation written.
**How to apply:** When updating docs, cross-reference src/loaders.py and src/features.py directly — they are the ground truth for encoding details and feature definitions. For deployment docs, check root Dockerfile and frontend/Dockerfile directly — they are the ground truth for build steps, ARGs, CMD, and port handling.

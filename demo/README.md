# Demo CSV Files

Three CSV files for testing the Claims Fraud Risk Detector upload feature.

## Files

### `sample_month_jan2009.csv` — Primary demo file (3.5 MB)
17,861 claims · 299 providers · January 2009

Use this to demo the full upload flow. Contains **11 providers with planted fraud patterns**:

| Provider | Pattern | What to expect |
|---|---|---|
| PRV90001–PRV90003 | High-volume / high-amount | HIGH risk score; top SHAP features: claim volume, reimbursement |
| PRV90010–PRV90011 | Duplicate claims | DUPLICATE_CLAIM rule flags |
| PRV90020–PRV90021 | Short-stay high-cost | SHORT_STAY_HIGH_COST rule flags |
| PRV90030 | Post-death billing | POST_DEATH_CLAIM rule flags |
| PRV90040–PRV90042 | Shared beneficiary ring | Elevated bene_n_providers feature |

The remaining 288 providers are normal and should score LOW–MEDIUM.

---

### `sample_clean_no_fraud.csv` — Baseline comparison (3.3 MB)
16,742 claims · 288 providers · January 2009

Same month, normal providers only (fraud-planted providers removed). Upload this first as a "clean month" batch, then upload `sample_month_jan2009.csv` to compare scores side-by-side.

---

### `sample_broken_validation_test.csv` — Validation error demo (32 KB)
200 rows · 41 columns (6 required columns deliberately removed)

**Missing columns:** `ClaimStartDt`, `ClaimEndDt`, `InscClaimAmtReimbursed`, `AttendingPhysician`, `OperatingPhysician`, `DOB`

Upload this to demo the validation error UI — the upload page will show a red error card listing all missing columns.

---

## How to upload

1. Start the backend: `python -m uvicorn api_temp:app --reload --port 8001`
2. Open the app and click **Upload** in the sidebar
3. Drag-and-drop any of these CSV files onto the upload zone
4. Give the batch a name (auto-filled from filename)
5. Click **Upload & Score** — progress bar will update every 1.5 s
6. When complete, click **View Queue** or switch batches using the sidebar dropdown

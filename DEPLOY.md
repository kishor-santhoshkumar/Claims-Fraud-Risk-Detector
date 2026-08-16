# Deploying Claims Fraud Risk Detector to Railway

This guide walks you through deploying the backend (FastAPI/Python) and frontend (React/Vite) as two separate Railway services from the same GitHub repository.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1 — Deploy the Backend Service](#step-1--deploy-the-backend-service)
3. [Step 2 — Deploy the Frontend Service](#step-2--deploy-the-frontend-service)
4. [Step 3 — Wire CORS](#step-3--wire-cors)
5. [Step 4 — Verify the Deployment](#step-4--verify-the-deployment)
6. [Local Docker Test](#local-docker-test-before-pushing)
7. [Endpoints That Require Training Data](#endpoints-that-require-training-data)
8. [Environment Variables Reference](#environment-variables-reference)
9. [Notes and Caveats](#notes-and-caveats)

---

## Prerequisites

Before you begin, have the following ready:

- A [Railway](https://railway.com) account (Hobby plan or higher recommended — see [Notes](#notes-and-caveats))
- This repository pushed to GitHub and connected to your Railway account
- One or more [Groq API keys](https://console.groq.com) for the LLM narrator feature

---

## Step 1 — Deploy the Backend Service

The root `Dockerfile` builds the Python backend. It installs the ML stack, copies pre-scored provider data, and bakes the ChromaDB and BM25 search indexes into the image at build time.

1. Go to [railway.com](https://railway.com) and create a **new project**.

2. Click **Add a Service** → **Deploy from GitHub repo** → select this repository.

3. Railway will auto-detect the `Dockerfile` at the repository root. Leave the following settings at their defaults:
   - **Root Directory**: `/` (leave blank or as default)
   - **Dockerfile Path**: `Dockerfile`

4. Open the service's **Variables** tab and add the following environment variables:

   | Variable | Value |
   |---|---|
   | `GROQ_API_KEYS` | Comma-separated Groq API keys, e.g. `gsk_abc,gsk_def`. **Required.** |
   | `ALLOWED_ORIGINS` | Leave this unset for now. You will add it in [Step 3](#step-3--wire-cors) once you know the frontend URL. |

   > **Do not set `PORT`.** Railway injects it automatically. Setting it manually will cause a port conflict.

5. Click **Deploy**. The first build takes **5–8 minutes** — the image compiles numpy/scipy wheels and builds the ChromaDB dense index and BM25 sparse index.

6. Once the deploy completes, Railway will run a health check against `GET /health`. A successful response looks like:

   ```json
   {"status": "ok", "providers_loaded": 5410}
   ```

7. Copy the backend's public URL from the Railway dashboard. It will look like:

   ```
   https://your-backend.up.railway.app
   ```

   You will need this URL in the next step.

---

## Step 2 — Deploy the Frontend Service

The `frontend/Dockerfile` performs a two-stage build: Vite compiles the React app into static files, then `serve` hosts them. The backend URL is baked into the JavaScript bundle at build time via the `VITE_API_URL` build argument.

1. In the **same Railway project**, click **Add a Service** → **Deploy from GitHub repo** → select the same repository.

2. Set the **Root Directory** to `frontend`.

   > This is the critical setting. It tells Railway to run `frontend/Dockerfile` instead of the root `Dockerfile`.

3. Open the service's **Variables** tab and add the following build-time variable:

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | The backend URL from Step 1, with `/api` appended: `https://your-backend.up.railway.app/api`. **Required.** |

   > **Do not set `PORT`.** Railway injects it automatically.

4. Click **Deploy**. The build takes **2–3 minutes**.

5. Copy the frontend's public URL from the Railway dashboard. It will look like:

   ```
   https://your-frontend.up.railway.app
   ```

   You will need this URL in the next step.

---

## Step 3 — Wire CORS

The backend must be told which origin the frontend is served from. Without this, the browser will block all API requests with a CORS error.

1. Go back to the **backend** service in Railway → **Variables** tab.

2. Add or update `ALLOWED_ORIGINS` with your frontend URL:

   ```
   https://your-frontend.up.railway.app
   ```

   If you need to allow multiple origins (e.g. a custom domain in addition to the Railway URL), use a comma-separated list:

   ```
   https://your-frontend.up.railway.app,https://your-custom-domain.com
   ```

3. Save the variable. Railway will redeploy the backend automatically to pick up the change.

---

## Step 4 — Verify the Deployment

Run through these checks in order to confirm both services are working end to end.

**Backend health check:**

```bash
curl https://your-backend.up.railway.app/health
```

Expected response:

```json
{"status": "ok", "providers_loaded": 5410}
```

**Provider queue:**

```bash
curl "https://your-backend.up.railway.app/api/queue?limit=5"
```

Expected: a JSON array of 5 provider objects with `provider_id`, `score`, `risk_tier`, and `evidence` fields.

**Frontend dashboard:**

Open `https://your-frontend.up.railway.app` in your browser. The provider queue should load without any network errors in the browser console.

**LLM narrator (end-to-end Groq test):**

1. Open any provider detail page in the frontend.
2. Click **Generate Narrative**.
3. A narrative should appear within a few seconds. If it fails, check that `GROQ_API_KEYS` is set correctly on the backend service and that the keys are valid.

---

## Local Docker Test (Before Pushing)

Test both images locally before deploying to Railway to catch build errors early.

### Backend

```bash
docker build -t fraud-backend .

docker run --rm \
  -e GROQ_API_KEYS=gsk_your_key_here \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  -p 8000:8000 \
  fraud-backend
```

Verify:

```bash
curl http://localhost:8000/health
curl "http://localhost:8000/api/queue?limit=5"
```

### Frontend

```bash
cd frontend

docker build \
  --build-arg VITE_API_URL=http://localhost:8000/api \
  -t fraud-frontend .

docker run --rm -p 3000:3000 fraud-frontend
```

Open `http://localhost:3000` in your browser. The dashboard should load and calls to `/api/*` should reach the backend container running on port 8000.

> The frontend and backend containers must both be running at the same time for the full local test to work. The `VITE_API_URL` is baked into the bundle at build time, so if you rebuild the frontend image with a different URL you must restart the container.

---

## Endpoints That Require Training Data

The raw CMS training files (CSV/parquet, several GB) are not included in the Docker image. The following endpoints degrade gracefully when those files are absent:

| Endpoint | Behaviour without training data |
|---|---|
| `GET /provider/{id}/claims` | Returns `total_claims: 0` (graceful fallback) |
| `POST /score` | Returns HTTP 503 with an explanation message |
| `state` field in `/queue` and `/provider/{id}` | Returns `null` (graceful fallback) |
| `n_unique_bene` in `/queue` | Returns `null` (graceful fallback) |

All other endpoints — `/queue`, `/provider/{id}`, `/provider/{id}/explain`, `/chat`, `/stats` — work fully from the pre-scored `outputs/scored_providers.json` file that is baked into the image.

---

## Environment Variables Reference

### Backend service

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEYS` | Yes | Comma-separated Groq API keys used by the LLM narrator. Example: `gsk_abc,gsk_def`. |
| `ALLOWED_ORIGINS` | Yes (production) | Comma-separated list of frontend URLs permitted for CORS. Defaults to localhost only if unset. |
| `PORT` | Auto | Injected by Railway. Do not set manually. |

### Frontend service (build-time)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes (production) | Full backend URL with `/api` suffix. Baked into the JS bundle at build time. Example: `https://your-backend.up.railway.app/api`. |
| `PORT` | Auto | Injected by Railway for the `serve` process. Do not set manually. |

---

## Notes and Caveats

**Railway plan recommendation.** Railway's free tier provides 512 MB RAM. The ML stack (numpy, pandas, scikit-learn, xgboost, shap, chromadb) uses approximately 350–450 MB at startup, leaving very little headroom. Use the **Hobby plan (1 GB RAM)** or higher to avoid OOM crashes during cold starts.

**Backend build time.** The first Railway build takes 5–8 minutes because it compiles C extension wheels for numpy, scipy, and shap, and runs the ChromaDB and BM25 index build steps inside the image. Subsequent builds that only change application code are faster because pip dependencies are cached in a separate Docker layer.

**`VITE_API_URL` is immutable after build.** This value is embedded in the compiled JavaScript bundle. If the backend URL ever changes (e.g. you rename the service or switch to a custom domain), you must trigger a new frontend build and redeploy for the change to take effect.

**Disposition state is not persisted.** Provider dispositions (confirmed fraud / cleared / needs info) are stored in memory on the backend process. They reset on every redeploy. If you need persistence across deploys, add a database (e.g. Railway's Postgres plugin) and wire it into the disposition endpoints in `api_temp.py`.

**`POST /score` is disabled in the deployed image.** The endpoint that retrains the XGBoost model requires the raw CMS CSV files, which are not shipped in the image. It returns HTTP 503 with a clear error message. All 5,410 providers are pre-scored and available immediately via `/queue` and `/provider/{id}`.

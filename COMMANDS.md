# Hosting Commands — Claims Fraud Risk Detector

Run these in order. Each section must complete before moving to the next.

---

## Part 1 — Test locally with Docker

Open **two terminal windows** side by side.

### Terminal 1 — Backend

```bash
# Build the backend image (takes 5–8 min first time)
docker build -t fraud-backend .

# Run the backend
# Replace gsk_... with your real Groq API key
docker run --rm \
  -e GROQ_API_KEYS=gsk_... \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  -p 8000:8000 \
  fraud-backend
```

Leave this terminal running. You will see startup logs including peak RSS.

### Terminal 2 — Verify backend, then build frontend

```bash
# Confirm backend is up (should return {"status":"ok","providers_loaded":5410})
curl http://localhost:8000/health

# Confirm data is accessible
curl "http://localhost:8000/api/queue?limit=3"

# Build the frontend image
# This bakes http://localhost:8000/api into the JS bundle for local testing
docker build \
  --build-arg VITE_API_URL=http://localhost:8000/api \
  -t fraud-frontend \
  frontend/

# Run the frontend
docker run --rm -p 3000:3000 fraud-frontend
```

Open `http://localhost:3000` in your browser. The dashboard should load and show providers.

---

## Part 2 — Deploy to Railway

### Step 1 — Install Railway CLI

```bash
npm install -g @railway/cli
```

### Step 2 — Login

```bash
railway login
```

A browser window will open. Authenticate with your Railway account.

### Step 3 — Create a new Railway project

```bash
railway init
```

When prompted, choose **Create new project** and give it a name like `fraud-detector`.

### Step 4 — Deploy the backend service

Run this from the **repo root**:

```bash
railway up
```

Railway detects the root `Dockerfile` and builds the backend.
This takes 5–8 minutes. Watch the build logs.

### Step 5 — Set backend environment variables

```bash
# Your Groq API key(s) — required for LLM narratives
railway variables set GROQ_API_KEYS=gsk_...

# You will add ALLOWED_ORIGINS after you know the frontend URL (Step 9)
```

### Step 6 — Assign a public domain to the backend

```bash
railway domain
```

Railway prints a URL like `https://fraud-detector-production-xxxx.up.railway.app`.
**Copy this URL — you need it in Step 8.**

### Step 7 — Test the backend is live

```bash
# Replace with your actual backend URL from Step 6
curl https://YOUR_BACKEND_URL.up.railway.app/health
# Expected: {"status":"ok","providers_loaded":5410}

curl "https://YOUR_BACKEND_URL.up.railway.app/api/queue?limit=3"
# Expected: JSON array of 3 providers
```

### Step 8 — Create the frontend service

Railway does not support two services from one repo via `railway up` out of the box.
Do this in the **Railway dashboard** (dashboard.railway.app):

1. Open your project → click **+ New Service** → **GitHub Repo** → select this repo
2. In the service settings → **Root Directory** → set to `frontend`
3. Railway will now use `frontend/Dockerfile`

Then set the frontend's **build-time** environment variable in the dashboard:

```
VITE_API_URL = https://YOUR_BACKEND_URL.up.railway.app/api
```

> The `/api` suffix is required — do not omit it.

Click **Deploy**.

### Step 9 — Get the frontend URL and update backend CORS

After the frontend deploys, Railway assigns it a URL like  
`https://fraud-frontend-xxxx.up.railway.app`.

Go back to the **backend** service and update CORS:

```bash
railway variables set ALLOWED_ORIGINS=https://YOUR_FRONTEND_URL.up.railway.app
```

The backend picks up the new env var and restarts automatically.

### Step 10 — Verify end-to-end

```bash
# Backend health
curl https://YOUR_BACKEND_URL.up.railway.app/health

# API queue
curl "https://YOUR_BACKEND_URL.up.railway.app/api/queue?limit=5"
```

Open `https://YOUR_FRONTEND_URL.up.railway.app` in your browser.
- Dashboard loads → queue is populated → backend is reachable
- Click a high-risk provider → click **Generate Narrative** → Groq LLM path works

---

## Quick reference — useful Railway CLI commands

```bash
# View running services and their URLs
railway status

# Tail live logs for the current service
railway logs

# List all environment variables
railway variables

# Update a variable
railway variables set KEY=new_value

# Redeploy the current service
railway up

# Open the project in the dashboard
railway open
```

---

## Tear down

```bash
# Stop local Docker containers
# Ctrl+C in each terminal window, then:
docker rm -f $(docker ps -aq --filter ancestor=fraud-backend)
docker rm -f $(docker ps -aq --filter ancestor=fraud-frontend)

# Remove local images
docker rmi fraud-backend fraud-frontend
```

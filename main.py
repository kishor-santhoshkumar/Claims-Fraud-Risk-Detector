"""Production entry point.

Mounts the entire API under /api and serves the React SPA from frontend/dist/.
The Vite dev proxy already rewrites /api → backend, so no frontend changes needed.

Run locally:
    python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload

On Railway (PORT is injected automatically):
    python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import api_temp  # registers all routes on api_temp.app


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # FastAPI does not propagate startup events to mounted sub-apps,
    # so we call the loader directly from the parent app's lifespan.
    api_temp._load_providers()
    yield


app = FastAPI(
    title="Claims Fraud Risk Detector",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=_lifespan,
)


@app.get("/health", summary="Health check for Railway / load balancers")
def _health():
    return {"status": "ok", "providers_loaded": len(api_temp._PROVIDERS)}


# ── Mount API sub-app at /api ─────────────────────────────────────────────────
# The api_temp.app routes are defined without /api prefix (e.g. GET /queue).
# Mounting at /api means the parent strips the prefix before forwarding,
# so the frontend's /api/queue calls reach api_temp's GET /queue correctly.
app.mount("/api", api_temp.app)

# ── Serve React SPA ───────────────────────────────────────────────────────────
_DIST = Path(__file__).resolve().parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="frontend")
else:
    @app.get("/")
    def _no_frontend():
        return {"status": "ok", "note": "Frontend not built. Run: cd frontend && npm run build"}

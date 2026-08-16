# ── Backend-only image (Railway backend service) ─────────────────────────────
# The React frontend is deployed as a separate Railway service (frontend/Dockerfile).
#
# Build:   docker build -t fraud-backend .
# Run:     docker run -e GROQ_API_KEYS=gsk_... -e PORT=8000 -p 8000:8000 fraud-backend
FROM python:3.12-slim

# gcc/g++ for shap/xgboost wheel compilation; libgomp for OpenMP parallelism
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps in a separate layer so they cache between code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application source
COPY src/ src/
COPY api_temp.py main.py rules.yaml ./

# ── Runtime data files (no training artefacts, no raw CSVs) ──────────────────
# scored_providers.json  — 5,410 pre-scored providers
# policy_chunks.jsonl    — raw policy text (used to build the indexes below)
# narratives.json        — pre-generated LLM narrative cache
COPY outputs/scored_providers.json outputs/scored_providers.json
COPY outputs/policy_chunks.jsonl   outputs/policy_chunks.jsonl
COPY outputs/narratives.json       outputs/narratives.json

# ── Build ChromaDB dense index ────────────────────────────────────────────────
# This step also downloads and caches the ONNX embedding model inside the image,
# eliminating cold-start download delays on first /explain or /chat request.
RUN python - << 'PYEOF'
import json, chromadb
from pathlib import Path

chunks = [
    json.loads(l)
    for l in Path("outputs/policy_chunks.jsonl").read_text(encoding="utf-8").splitlines()
    if l.strip()
]

client = chromadb.PersistentClient(path="outputs/chroma_db")
try:
    client.delete_collection("policy_chunks")
except Exception:
    pass
col = client.get_or_create_collection("policy_chunks")

batch = 50
for i in range(0, len(chunks), batch):
    b = chunks[i : i + batch]
    col.add(
        ids=[c["chunk_id"] for c in b],
        documents=[c["text"] for c in b],
        metadatas=[{k: v for k, v in c.items() if k != "text"} for c in b],
    )
print(f"[build] Chroma index: {col.count()} chunks indexed")
PYEOF

# ── Build BM25 sparse index ───────────────────────────────────────────────────
RUN python - << 'PYEOF'
import json, pickle
from pathlib import Path
from rank_bm25 import BM25Okapi

chunks = [
    json.loads(l)
    for l in Path("outputs/policy_chunks.jsonl").read_text(encoding="utf-8").splitlines()
    if l.strip()
]
bm25 = BM25Okapi([c["text"].lower().split() for c in chunks])
with open("outputs/bm25_index.pkl", "wb") as f:
    pickle.dump(bm25, f)
print(f"[build] BM25 index: {len(chunks)} chunks")
PYEOF

ENV PYTHONUNBUFFERED=1

# Railway injects $PORT; default to 8000 for local docker run.
EXPOSE 8000
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

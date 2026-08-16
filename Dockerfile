# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.11-slim

# gcc/g++ for shap/xgboost, libgomp for parallelism
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (layer-cached separately)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source and artefacts
COPY src/ src/
COPY outputs/ outputs/
COPY api_temp.py main.py rules.yaml ./

# ── Rebuild chroma index from policy_chunks.jsonl ─────────────────────────────
# This also downloads and caches the 79 MB ONNX embedding model inside the
# image, so the first real request has no cold-start download delay.
RUN python - << 'PYEOF'
import json, chromadb
from pathlib import Path

chunks = [json.loads(l) for l in Path("outputs/policy_chunks.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

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
print(f"Chroma index: {col.count()} chunks indexed")
PYEOF

# ── Rebuild BM25 index ────────────────────────────────────────────────────────
RUN python - << 'PYEOF'
import json, pickle
from pathlib import Path
from rank_bm25 import BM25Okapi

chunks = [json.loads(l) for l in Path("outputs/policy_chunks.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
bm25 = BM25Okapi([c["text"].lower().split() for c in chunks])
with open("outputs/bm25_index.pkl", "wb") as f:
    pickle.dump(bm25, f)
print(f"BM25 index: {len(chunks)} chunks")
PYEOF

# Copy built React SPA from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PYTHONUNBUFFERED=1
EXPOSE 8001

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]

"""Hybrid retrieval: ChromaDB dense + BM25 sparse, fused with Reciprocal Rank Fusion.

Why both retrievers: the corpus is 78 % Program Integrity Manual and only 42 chunks
of NCCI Chapter 1. Dense search (ChromaDB) leans toward PIM by sheer volume. NCCI uses
precise phrases — "medically unlikely edits", "mutually exclusive procedures", "add-on code"
— that keyword matching nails and embeddings blur. BM25 corrects this bias.
"""
from __future__ import annotations

import json
import pickle
from pathlib import Path

import chromadb
import numpy as np
from rank_bm25 import BM25Okapi

OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
_CHUNKS_PATH = OUTPUTS / "policy_chunks.jsonl"
_BM25_PATH = OUTPUTS / "bm25_index.pkl"
_CHROMA_PATH = OUTPUTS / "chroma_db"

# Minimum fused RRF score to return any citation.
# A wrong citation is worse than no citation — this floor enforces silence
# when the query does not map cleanly to a known policy section.
_MIN_RELEVANCE_SCORE = 0.008

_RRF_K = 60  # standard RRF constant; higher k = softer rank weighting

_chunks: list[dict] | None = None
_bm25: BM25Okapi | None = None
_chroma_col = None


def _load_chunks() -> list[dict]:
    global _chunks
    if _chunks is None:
        with open(_CHUNKS_PATH, encoding="utf-8") as f:
            _chunks = [json.loads(line) for line in f]
    return _chunks


def _get_bm25() -> BM25Okapi:
    """Load or build the BM25 index over all policy chunk texts."""
    global _bm25
    if _bm25 is not None:
        return _bm25

    if _BM25_PATH.exists():
        with open(_BM25_PATH, "rb") as f:
            candidate = pickle.load(f)
        if isinstance(candidate, BM25Okapi):
            _bm25 = candidate
            return _bm25
        # Stale index from a different library — rebuild below.

    chunks = _load_chunks()
    tokenized = [c["text"].lower().split() for c in chunks]
    _bm25 = BM25Okapi(tokenized)
    with open(_BM25_PATH, "wb") as f:
        pickle.dump(_bm25, f)
    print(f"[retrieval] BM25 index built ({len(chunks)} chunks) → {_BM25_PATH}")
    return _bm25


def _get_chroma():
    global _chroma_col
    if _chroma_col is None:
        client = chromadb.PersistentClient(path=str(_CHROMA_PATH))
        _chroma_col = client.get_collection("policy_chunks")
    return _chroma_col


def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Hybrid retrieval with Reciprocal Rank Fusion.

    Runs ChromaDB (dense) and BM25 (sparse) in parallel, then fuses their
    ranked lists using RRF(k=60). Returns up to `top_k` chunks ordered by
    fused relevance score.

    Returns an empty list when the top fused score is below _MIN_RELEVANCE_SCORE,
    because a fabricated citation is worse than no citation.
    """
    chunks = _load_chunks()
    n = len(chunks)
    chunk_by_id = {c["chunk_id"]: c for c in chunks}

    # ── Dense retrieval ───────────────────────────────────────────────────
    col = _get_chroma()
    n_candidates = min(top_k * 5, n)
    dense_results = col.query(query_texts=[query], n_results=n_candidates)
    dense_meta = dense_results["metadatas"][0]
    dense_rank: dict[str, int] = {
        meta["chunk_id"]: rank for rank, meta in enumerate(dense_meta)
    }

    # ── Sparse retrieval (BM25) ───────────────────────────────────────────
    bm25 = _get_bm25()
    scores = bm25.get_scores(query.lower().split())
    top_indices = np.argsort(scores)[::-1][:n_candidates]
    bm25_rank: dict[str, int] = {
        chunks[int(i)]["chunk_id"]: rank for rank, i in enumerate(top_indices)
    }

    # ── Reciprocal Rank Fusion ────────────────────────────────────────────
    all_ids = set(dense_rank) | set(bm25_rank)
    fused: dict[str, float] = {}
    for cid in all_ids:
        score = 0.0
        if cid in dense_rank:
            score += 1.0 / (_RRF_K + dense_rank[cid])
        if cid in bm25_rank:
            score += 1.0 / (_RRF_K + bm25_rank[cid])
        fused[cid] = score

    ranked = sorted(fused.items(), key=lambda x: x[1], reverse=True)[:top_k]

    if not ranked or ranked[0][1] < _MIN_RELEVANCE_SCORE:
        return []

    return [chunk_by_id[cid] for cid, _ in ranked if cid in chunk_by_id]


def retrieve_for_rule(rule_id: str, rule_description: str) -> list[dict]:
    """Retrieve policy chunks relevant to a specific rule.

    Called by the evidence assembler. Builds the query from rule text alone —
    no hardcoded rule-to-chunk mapping.
    """
    return retrieve(rule_description, top_k=3)


if __name__ == "__main__":
    print("=== Test 1: medically unlikely edits billing same service twice ===")
    results = retrieve("medically unlikely edits billing same service twice")
    if not results:
        print("  ERROR: no results returned — index may be empty")
    else:
        for r in results:
            print(f"  [{r['source_doc']}] {r['citation_string']}")
        top_src = results[0]["source_doc"]
        if "NCCI" not in top_src:
            print(f"  ERROR: expected NCCI Chapter 1, got '{top_src}' — index is broken")
        else:
            print("  OK: top result is NCCI")

    print()
    print("=== Test 2: provider billing services after beneficiary death ===")
    results = retrieve("provider billing services after beneficiary death")
    if not results:
        print("  ERROR: no results returned")
    else:
        for r in results:
            print(f"  [{r['source_doc']}] {r['citation_string']}")
        top_src = results[0]["source_doc"]
        if "Program Integrity" not in top_src:
            print(f"  ERROR: expected Program Integrity Manual, got '{top_src}' — index is broken")
        else:
            print("  OK: top result is Program Integrity Manual")

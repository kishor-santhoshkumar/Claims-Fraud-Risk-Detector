"""Pre-generate investigation narratives for the top 100 providers by expected_loss.

Run once before the demo so the Explain button never depends on live API calls.

Usage:
    python -m scripts.batch_narratives

Uses the fast 8B model for cache pre-warming to stay comfortably within the
free-tier TPM limit. The live API endpoint still uses the 70B model per the
tier routing in narrator.py — this is only the offline batch step.

Sleeps between Groq calls to respect the free-tier rate limit.
Skips providers already in the cache. Prints progress and cumulative token count.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from src.schema import ScoredProvider
from src.evidence_assembler import assemble
from src.narrator import (
    _load_cache, _save_cache, _call_groq, _build_evidence_prompt,
    _NARRATIVES_PATH, _MODEL_MEDIUM, _SYSTEM_CASE,
)

OUTPUTS = ROOT / "outputs"
_SCORED_PATH = OUTPUTS / "scored_providers.json"
_TOP_N = 100
_SLEEP_SECONDS = 4  # 8B model has higher effective throughput than 70B on free tier


def _count_tokens_rough(text: str) -> int:
    """Rough token estimate: ~1 token per 4 chars."""
    return len(text) // 4


def main() -> None:
    print(f"[batch_narratives] Loading providers from {_SCORED_PATH} ...")
    with open(_SCORED_PATH, encoding="utf-8") as f:
        records = json.load(f)

    providers = [ScoredProvider.model_validate(r) for r in records]
    flagged = [p for p in providers if p.risk_tier in ("high", "medium")]
    flagged.sort(key=lambda p: p.expected_loss, reverse=True)
    top = flagged[:_TOP_N]

    print(f"[batch_narratives] Selected top {len(top)} providers by expected_loss")
    print(f"[batch_narratives] Using model: {_MODEL_MEDIUM} (fast; live API uses 70B for high-tier)")

    cache = _load_cache()
    total_tokens = 0
    generated = 0
    skipped = 0

    for i, provider in enumerate(top, 1):
        cache_key = f"case_{provider.provider_id}"
        if cache_key in cache:
            skipped += 1
            print(f"  [{i:3d}/{len(top)}] {provider.provider_id}  CACHED (skip)")
            continue

        enriched = assemble(provider)
        evidence_text = _build_evidence_prompt(enriched)
        narrative = _call_groq(_SYSTEM_CASE, evidence_text, _MODEL_MEDIUM)

        if narrative is None:
            print(
                f"  [{i:3d}/{len(top)}] {provider.provider_id}  "
                f"RATE-LIMITED — stopping early. Re-run after rate limit resets."
            )
            break

        cache[cache_key] = narrative
        _save_cache()

        tokens = _count_tokens_rough(narrative)
        total_tokens += tokens
        generated += 1
        print(
            f"  [{i:3d}/{len(top)}] {provider.provider_id}  "
            f"tier={provider.risk_tier}  ~{tokens} tokens  total={total_tokens}"
        )

        if i < len(top):
            time.sleep(_SLEEP_SECONDS)

    print(
        f"\n[batch_narratives] Done. Generated={generated}, skipped={skipped}, "
        f"~{total_tokens} total tokens used."
    )
    print(f"[batch_narratives] Cache written to {_NARRATIVES_PATH}")


if __name__ == "__main__":
    main()

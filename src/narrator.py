"""Groq LLM narrator — generates plain-English investigation narratives from evidence.

Design constraints:
- The model receives ONLY evidence summaries. It never sees the raw feature matrix,
  the fraud probability, or any raw claim field.
- Narratives are cached to outputs/narratives.json keyed by provider_id.
- On 429 rate-limit errors, the narrator rotates to the next API key and retries
  with exponential backoff (max 3 attempts per key cycle). If all keys are
  exhausted, it returns None so the UI can degrade gracefully to evidence-only.
- temperature=0 throughout for reproducibility.
"""
from __future__ import annotations

import json
import os
import time
from itertools import cycle
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from groq import Groq

from src.schema import ScoredProvider

load_dotenv()

OUTPUTS = Path(__file__).resolve().parent.parent / "outputs"
_NARRATIVES_PATH = OUTPUTS / "narratives.json"

# Swap these constants when Groq updates its model roster.
_MODEL_HIGH = "openai/gpt-oss-120b"   # large model for high-tier providers
_MODEL_MEDIUM = "openai/gpt-oss-20b"  # fast model for medium-tier providers

# Terms that must never appear in the assembled prompt — their presence means
# the evidence layer is leaking raw ML outputs into the narrator input.
_FORBIDDEN_PROMPT_TERMS = frozenset({"risk_tier", "expected_loss", "probability"})

_narrative_cache: dict[str, str] | None = None
_groq_clients: list[Groq] = []
_key_cycle = None


# ── Initialisation ─────────────────────────────────────────────────────────────

def _init_clients() -> None:
    global _groq_clients, _key_cycle
    if _groq_clients:
        return
    raw = os.getenv("GROQ_API_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if not keys:
        raise RuntimeError(
            "GROQ_API_KEYS is not set. "
            "Add it to .env as a comma-separated list of Groq API keys."
        )
    _groq_clients = [Groq(api_key=k) for k in keys]
    _key_cycle = cycle(range(len(_groq_clients)))


def _load_cache() -> dict[str, str]:
    global _narrative_cache
    if _narrative_cache is None:
        if _NARRATIVES_PATH.exists():
            with open(_NARRATIVES_PATH, encoding="utf-8") as f:
                _narrative_cache = json.load(f)
        else:
            _narrative_cache = {}
    return _narrative_cache


def _save_cache() -> None:
    with open(_NARRATIVES_PATH, "w", encoding="utf-8") as f:
        json.dump(_narrative_cache, f, indent=2, ensure_ascii=False)


# ── Prompt builder (the firewall) ─────────────────────────────────────────────

def _build_evidence_prompt(provider: ScoredProvider) -> str:
    """Build the LLM input from evidence summaries only.

    This is the core firewall. Only evidence[*].summary (and policy citation
    strings) reach the model. No scores, no probabilities, no raw feature values.

    Raises ValueError if a forbidden term is found in the assembled text — that
    indicates a bug in an evidence summary that is leaking model internals.
    """
    lines: list[str] = []
    for ev in provider.evidence:
        line = f"[{ev.type.upper()}] {ev.summary}"
        # For policy citations, append the citation string inline for the LLM to reference.
        if ev.type == "policy" and hasattr(ev, "citation_string"):
            line += f" ({ev.citation_string})"  # type: ignore[union-attr]
        lines.append(line)

    prompt = "\n".join(lines)

    # Firewall assertion: no ML internals must reach the model.
    lower = prompt.lower()
    for term in _FORBIDDEN_PROMPT_TERMS:
        if term in lower:
            raise ValueError(
                f"Prompt firewall triggered: '{term}' found in assembled evidence prompt. "
                "Fix the evidence summary that contains this term before calling the narrator."
            )

    return prompt


# ── Groq call with key rotation and backoff ────────────────────────────────────

def _call_groq(system: str, user: str, model: str) -> Optional[str]:
    """Call Groq with round-robin key rotation and exponential backoff on 429.

    Returns None if all keys are rate-limited after max retries.
    """
    _init_clients()
    n_keys = len(_groq_clients)
    delay = 2.0
    max_attempts = 3 * n_keys

    for _ in range(max_attempts):
        idx = next(_key_cycle)
        client = _groq_clients[idx]
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0,
                max_tokens=400,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            err = str(exc).lower()
            if "429" in err or "rate" in err or "limit" in err:
                time.sleep(delay)
                delay = min(delay * 2, 30.0)
                continue
            raise

    return None


def _call_groq_messages(messages: list[dict], model: str) -> Optional[str]:
    """Call Groq with a pre-built messages array — used for multi-turn chat."""
    _init_clients()
    n_keys = len(_groq_clients)
    delay = 2.0
    for _ in range(3 * n_keys):
        idx = next(_key_cycle)
        client = _groq_clients[idx]
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0,
                max_tokens=400,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            err = str(exc).lower()
            if "429" in err or "rate" in err or "limit" in err:
                time.sleep(delay)
                delay = min(delay * 2, 30.0)
                continue
            raise
    return None


# ── System prompts ─────────────────────────────────────────────────────────────

_SYSTEM_CASE = (
    "You are explaining a Medicare billing review to a panel of judges who are not medical "
    "or technical experts. Use short sentences and everyday words. Avoid jargon.\n\n"
    "You will receive evidence items for a provider that was flagged for review. "
    "Each item is prefixed with its type:\n"
    "  [SHAP]   — a billing pattern that stood out compared to similar providers\n"
    "  [RULE]   — a specific policy check that failed\n"
    "  [POLICY] — the official Medicare rule that the check is based on\n\n"
    "Your task: write exactly two short paragraphs.\n\n"
    "Paragraph 1 — WHY IT WAS FLAGGED\n"
    "Explain each finding in plain English, as if talking to someone with no medical "
    "background. Use concrete numbers from the evidence (e.g. '35-day hospital stay', "
    "'billed the same claim twice'). Start with the most serious finding.\n\n"
    "Paragraph 2 — WHAT TO CHECK NEXT\n"
    "Give three or four specific, actionable things an investigator should look at. "
    "Be concrete — name the type of record, not a vague instruction.\n\n"
    "Rules you must follow:\n"
    "- Use simple, everyday English. A non-expert must be able to understand every sentence.\n"
    "- Describe only the evidence given. Never invent a finding or a motive.\n"
    "- Never say the provider committed fraud — only describe what the records show.\n"
    "- If a policy citation is present (e.g. 'Medicare PIM Ch.4 §...'), mention it by "
    "name so the judges know there is an official rule behind the finding.\n"
    "- Never mention a score, probability, or numeric risk classification.\n"
    "- Keep your response under 200 words total."
)

_SYSTEM_CLEARANCE = (
    "You are explaining to a panel of judges — who are not medical or technical experts — "
    "why a Medicare provider was NOT selected for investigation. "
    "Use short sentences and everyday words. Avoid jargon.\n\n"
    "You will receive evidence items that describe this provider's billing patterns "
    "compared to similar providers, and which policy checks were run.\n\n"
    "Your task: write exactly one short paragraph.\n\n"
    "Explain clearly:\n"
    "1. How this provider's billing compares to others in plain terms "
    "(e.g. 'they billed fewer claims per patient than most providers').\n"
    "2. Which checks were run and found nothing unusual — name them simply "
    "(e.g. 'we checked for duplicate claims and found none').\n\n"
    "Rules you must follow:\n"
    "- Use simple, everyday English. A non-expert must understand every sentence.\n"
    "- Describe only the evidence given. Do not invent facts.\n"
    "- Do not say the provider is innocent — only that the checks found nothing unusual.\n"
    "- Never mention a score, probability, or numeric risk classification.\n"
    "- Keep your response under 150 words."
)


# ── Public API ─────────────────────────────────────────────────────────────────

def narrate_case(provider: ScoredProvider) -> Optional[str]:
    """Generate a two-paragraph investigation narrative for a flagged provider.

    For high-tier providers uses the large model; for medium-tier uses the fast model.
    Results are cached to outputs/narratives.json. Returns None if Groq is unavailable.
    """
    cache = _load_cache()
    cache_key = f"case_{provider.provider_id}"
    if cache_key in cache:
        return cache[cache_key]

    evidence_text = _build_evidence_prompt(provider)
    model = _MODEL_HIGH if provider.risk_tier == "high" else _MODEL_MEDIUM

    result = _call_groq(_SYSTEM_CASE, evidence_text, model)
    if result:
        cache[cache_key] = result
        _save_cache()
    return result


_CLAIM_NARRATIVES_PATH = OUTPUTS / "claim_narratives.json"
_claim_narrative_cache: dict[str, str] | None = None

_SYSTEM_CLAIM = (
    "You are explaining a suspicious Medicare claim to a panel of reviewers who are not medical experts. "
    "Use short sentences and everyday words.\n\n"
    "You will receive a claim record with rule violations and billing amounts. "
    "Write exactly one short paragraph (under 120 words) that:\n"
    "1. States which rule(s) fired and what they mean in plain English.\n"
    "2. Notes the dollar amount and why the combination is concerning.\n"
    "3. Suggests one specific thing the reviewer should check.\n\n"
    "Rules you must follow:\n"
    "- Never say the provider committed fraud — describe what the records show.\n"
    "- Never mention a score, probability, or numeric risk tier.\n"
    "- Use concrete numbers from the claim (dates, amounts).\n"
    "- If a policy citation is provided, mention it by name.\n"
    "- Keep under 120 words."
)


def _load_claim_cache() -> dict[str, str]:
    global _claim_narrative_cache
    if _claim_narrative_cache is None:
        if _CLAIM_NARRATIVES_PATH.exists():
            with open(_CLAIM_NARRATIVES_PATH, encoding="utf-8") as f:
                _claim_narrative_cache = json.load(f)
        else:
            _claim_narrative_cache = {}
    return _claim_narrative_cache


def _save_claim_cache() -> None:
    with open(_CLAIM_NARRATIVES_PATH, "w", encoding="utf-8") as f:
        json.dump(_claim_narrative_cache, f, indent=2, ensure_ascii=False)


def narrate_claim(claim_record: dict) -> Optional[str]:
    """Generate a one-paragraph narrative for a high or medium tier claim.

    claim_record must include: claim_id, claim_type, claim_start_dt, claim_end_dt,
    amount_reimbursed, rule_flags, rule_score, claim_risk_tier.

    Cached to outputs/claim_narratives.json. Returns None if Groq is unavailable.
    Only call for high or medium tier claims.
    """
    claim_id = claim_record.get("claim_id", "")
    cache = _load_claim_cache()
    if claim_id in cache:
        return cache[claim_id]

    # Build a concise user prompt from the claim record
    rule_flags = claim_record.get("rule_flags", [])
    if not rule_flags:
        return None  # no rules fired — narrative not needed

    from src.claim_scorer import RULES
    rule_details = {r["id"]: r for r in RULES}

    lines = [
        f"Claim ID: {claim_id}",
        f"Claim type: {claim_record.get('claim_type', 'unknown')}",
        f"Service dates: {claim_record.get('claim_start_dt')} to {claim_record.get('claim_end_dt')}",
        f"Amount reimbursed: ${claim_record.get('amount_reimbursed', 0):,.2f}",
        "",
        "Rule violations:",
    ]
    for flag in rule_flags:
        rd = rule_details.get(flag, {})
        citation = rd.get("citation", "")
        lines.append(f"  [{flag}] {citation}")

    if claim_record.get("admission_dt"):
        lines.append(f"Admission: {claim_record['admission_dt']}, Discharge: {claim_record.get('discharge_dt')}")

    prompt = "\n".join(lines)
    result = _call_groq(_SYSTEM_CLAIM, prompt, _MODEL_MEDIUM)
    if result:
        cache[claim_id] = result
        _save_claim_cache()
    return result


def narrate_clearance(provider: ScoredProvider) -> Optional[str]:
    """Generate a one-paragraph clearance narrative for a non-flagged provider.

    Generated on demand (never pre-computed). Cached after first generation.
    Returns None if Groq is unavailable.
    """
    cache = _load_cache()
    cache_key = f"clearance_{provider.provider_id}"
    if cache_key in cache:
        return cache[cache_key]

    evidence_text = _build_evidence_prompt(provider)
    result = _call_groq(_SYSTEM_CLEARANCE, evidence_text, _MODEL_MEDIUM)
    if result:
        cache[cache_key] = result
        _save_cache()
    return result

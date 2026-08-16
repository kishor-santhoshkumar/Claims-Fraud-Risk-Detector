"""Evidence assembler — attaches PolicyEvidence citations to RuleEvidence items.

For each RuleEvidence in a provider's evidence list, the assembler calls the
hybrid retrieval layer and appends a PolicyEvidence item if a relevant chunk
is found. ShapEvidence items are left untouched — statistical features have
no policy citation and must never receive one.

No rule-to-chunk mapping is hardcoded here. Retrieval works purely from rule
description text, so new rules added to rules.yaml are covered automatically.
"""
from __future__ import annotations

from src.schema import PolicyEvidence, ScoredProvider
from src.retrieval import retrieve_for_rule


def assemble(provider: ScoredProvider) -> ScoredProvider:
    """Attach PolicyEvidence items after each RuleEvidence. Return enriched provider.

    The original evidence list is preserved in order. After each RuleEvidence,
    one PolicyEvidence is inserted if retrieval returns a relevant chunk.
    If retrieval returns nothing (score below relevance floor), no citation is added —
    silence is correct when no authoritative chunk maps to the rule.
    """
    new_evidence = []

    for item in provider.evidence:
        new_evidence.append(item)

        if item.type != "rule":
            continue

        # Build a descriptive query from the rule's summary text and its existing
        # citation stub (e.g. "PIM Chapter 4, duplicate claims").
        query_parts = [item.summary]
        if item.citation and not item.citation.startswith("TODO"):
            query_parts.append(item.citation)

        chunks = retrieve_for_rule(item.rule_id, " ".join(query_parts))

        if not chunks:
            continue

        chunk = chunks[0]
        policy_ev = PolicyEvidence(
            citation_string=chunk["citation_string"],
            section_title=chunk["section_title"],
            source_doc=chunk["source_doc"],
            excerpt=chunk["text"][:300],
            relates_to=item.rule_id,
            category=item.category,
            severity=None,
            summary=f"Authority: {chunk['citation_string']}",
        )
        new_evidence.append(policy_ev)

    return provider.model_copy(update={"evidence": new_evidence})

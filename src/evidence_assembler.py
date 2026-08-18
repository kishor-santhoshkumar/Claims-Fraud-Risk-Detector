"""Evidence assembler — attaches PolicyEvidence citations to RuleEvidence items.

For each RuleEvidence in a provider's evidence list, the assembler calls the
hybrid retrieval layer and appends a PolicyEvidence item if a relevant chunk
is found. ShapEvidence items are left untouched — statistical features have
no policy citation and must never receive one.

No rule-to-chunk mapping is hardcoded here. Retrieval works purely from rule
description text, so new rules added to rules.yaml are covered automatically.
"""
from __future__ import annotations

from src.schema import PolicyEvidence, ShapEvidence, ScoredProvider
from src.retrieval import retrieve, retrieve_for_rule


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


def assemble_clearance(provider: ScoredProvider) -> ScoredProvider:
    """RAG enrichment for clearance (why-not) narratives.

    Low-risk providers typically have only SHAP evidence and no rule violations,
    so the standard assembler adds no policy citations. This function uses the
    top SHAP feature descriptions to retrieve Medicare billing-standards context
    that grounds the clearance explanation in official policy.

    Steps:
    1. Run the standard assembler (handles any RuleEvidence that exists).
    2. If policy citations were already added (medium-tier with rule hits), done.
    3. Otherwise, build a query from the top SHAP summaries and retrieve up to
       two policy chunks about acceptable Medicare billing standards.
    """
    enriched = assemble(provider)

    if any(e.type == "policy" for e in enriched.evidence):
        return enriched

    shap_items: list[ShapEvidence] = [
        e for e in enriched.evidence if isinstance(e, ShapEvidence)
    ]
    if not shap_items:
        return enriched

    # Use feature names from top 3 SHAP items (by absolute impact) to build query
    top_shap = sorted(shap_items, key=lambda e: abs(e.impact), reverse=True)[:3]
    feature_labels = " ".join(e.feature.replace("_", " ") for e in top_shap)
    query = f"Medicare acceptable billing standards provider compliance {feature_labels}"

    chunks = retrieve(query, top_k=2)
    if not chunks:
        return enriched

    new_evidence = list(enriched.evidence)
    for chunk in chunks:
        policy_ev = PolicyEvidence(
            citation_string=chunk["citation_string"],
            section_title=chunk["section_title"],
            source_doc=chunk["source_doc"],
            excerpt=chunk["text"][:300],
            relates_to="billing_standards",
            category="compliance",
            severity=None,
            summary=f"Medicare billing standard: {chunk['citation_string']} — {chunk['section_title']}",
        )
        new_evidence.append(policy_ev)

    return enriched.model_copy(update={"evidence": new_evidence})

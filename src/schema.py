"""Pydantic v2 contract for the scored-provider evidence layer.

Every downstream component — UI, rules engine, LLM narrator — reads this schema.
The evidence list is a discriminated union so consumers can pattern-match on `type`
without inspecting every field.
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field


class _BaseEvidence(BaseModel):
    """Fields shared by every evidence variant.

    `category` follows the FWAC taxonomy — fraud, waste, abuse, compliance.
    We surface findings by category and let the investigator determine intent;
    we never claim to infer intent from billing data alone.
    """

    category: Literal["fraud", "waste", "abuse", "compliance"]
    severity: Literal["low", "medium", "high"]
    summary: str  # one plain-English sentence, no raw column names


class ShapEvidence(_BaseEvidence):
    """SHAP feature-attribution finding produced by the model layer.

    SHAP items are model drivers, not FWA findings.
    - category is always "statistical" — never a FWAC label — for both
      risk-increasing and exonerating (decreases_risk) items.
    - severity is always null: SHAP attribution rank is not a regulatory
      severity rating, and SHAP magnitude is not calibrated to investigative
      priority.
    """

    type: Literal["shap"] = "shap"
    category: Literal["statistical"] = "statistical"  # overrides _BaseEvidence
    severity: None = None  # overrides _BaseEvidence — always null for SHAP
    feature: str
    value: float
    impact: float  # raw SHAP value; sign encodes direction
    direction: Literal["increases_risk", "decreases_risk"]


class RuleEvidence(_BaseEvidence):
    """Rule-engine finding.

    Examples: post-death claim detected, duplicate claim pair found.
    `citation` is the policy corpus citation string (e.g. "Medicare PIM Ch.4 §4.3.1").
    """

    type: Literal["rule"] = "rule"
    rule_id: str
    citation: str
    claims_affected: int
    relates_to: Optional[str] = None  # linked claim-ID or rule chain


class ExclusionEvidence(_BaseEvidence):
    """LEIE exclusion hit.

    Slot reserved for the exclusion-screening integration that plugs in later.
    When a provider or affiliated individual matches the OIG exclusion list,
    any Medicare billing is a compliance violation regardless of clinical merit.
    """

    type: Literal["exclusion"] = "exclusion"
    source: str          # e.g. "OIG-LEIE"
    excl_type: str       # exclusion type code from the LEIE dataset
    excl_date: Optional[str] = None   # ISO-8601 date of exclusion
    matched_on: str      # which identifier matched (NPI, name, address, …)
    tier: str            # e.g. "mandatory" or "permissive"


class PeerEvidence(_BaseEvidence):
    """Peer-benchmarking outlier finding.

    Slot reserved for the peer-analysis integration that plugs in later.
    Compares a provider's metric against the distribution of similar providers
    (same specialty, same geography, same billing volume tier).
    """

    type: Literal["peer"] = "peer"
    metric: str
    provider_value: float
    peer_median: float
    z_score: float
    peer_group: str  # description of the comparison cohort


class PolicyEvidence(_BaseEvidence):
    """Policy corpus citation attached to a RuleEvidence finding.

    One PolicyEvidence is appended after each RuleEvidence whose rule_id
    retrieves a relevant chunk from the hybrid retrieval layer. It carries
    the policy authority that the rule is grounded in.

    - category mirrors the parent RuleEvidence (same FWAC label).
    - severity is always null — policy citations are not severity ratings.
    - summary is always "Authority: {citation_string}".
    """

    type: Literal["policy"] = "policy"
    severity: None = None  # always null — policy items carry no severity rating
    citation_string: str
    section_title: str
    source_doc: str
    excerpt: str          # first 300 chars of the chunk text
    relates_to: str       # rule_id of the parent RuleEvidence


# Discriminated union — consumers switch on `type` without inspecting every field.
Evidence = Annotated[
    Union[ShapEvidence, RuleEvidence, ExclusionEvidence, PeerEvidence, PolicyEvidence],
    Field(discriminator="type"),
]


class ScoredProvider(BaseModel):
    """Complete fraud-risk record for one provider.

    `expected_loss` = score × total_reimbursed and surfaces providers whose
    monetary exposure warrants investigation even at moderate fraud probability.
    `clearance_summary` is set for low and medium tier providers and gives the
    plain-English explanation of why the provider was not flagged.
    """

    provider_id: str
    score: float = Field(ge=0.0, le=1.0)
    risk_tier: Literal["low", "medium", "high"]
    total_reimbursed: float
    expected_loss: float   # score × total_reimbursed
    n_claims: int
    evidence: list[Evidence]
    clearance_summary: Optional[str] = None  # null for high-tier (flagged) providers

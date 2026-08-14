"""Deterministic tests for the rules engine.

One fire / one not-fire pair for every rule in rules.yaml, plus:
  - clean provider returns empty list (clearance path)
  - 10 post-death claims collapse to ONE finding with claims_affected=10
  - RuleEvidence construction fails when citation is missing
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from src.rules import RulesEngine
from src.schema import RuleEvidence

_RULES_YAML = Path(__file__).resolve().parent.parent / "rules.yaml"
_P = "PRV_TEST"
_B1, _B2 = "B001", "B002"


@pytest.fixture(scope="module")
def engine() -> RulesEngine:
    return RulesEngine(_RULES_YAML)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _claim(
    bene: str = _B1,
    provider: str = _P,
    start: str = "2020-01-01",
    end: str = "2020-01-05",
    amount: float = 1_000.0,
    claim_type: str = "outpatient",
    **extra,
) -> dict:
    row: dict = {
        "BeneID": bene,
        "Provider": provider,
        "ClaimStartDt": pd.Timestamp(start),
        "ClaimEndDt": pd.Timestamp(end),
        "InscClaimAmtReimbursed": amount,
        "claim_type": claim_type,
    }
    row.update(extra)
    return row


def _df(*rows: dict) -> pd.DataFrame:
    return pd.DataFrame(list(rows))


def _rule_ids(findings: list[RuleEvidence]) -> set[str]:
    return {f.rule_id for f in findings}


# ---------------------------------------------------------------------------
# POST_DEATH_SERVICE
# ---------------------------------------------------------------------------

def test_post_death_service_fires(engine):
    claims = _df(
        _claim(start="2020-06-01", DOD=pd.Timestamp("2020-01-15")),
    )
    assert "POST_DEATH_SERVICE" in _rule_ids(engine.evaluate(_P, claims))


def test_post_death_service_does_not_fire(engine):
    claims = _df(
        _claim(start="2020-01-01", DOD=pd.Timestamp("2020-12-31")),
    )
    assert "POST_DEATH_SERVICE" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# DISCHARGE_BEFORE_ADMIT
# ---------------------------------------------------------------------------

def test_discharge_before_admit_fires(engine):
    claims = _df(_claim(start="2020-01-10", end="2020-01-01"))
    assert "DISCHARGE_BEFORE_ADMIT" in _rule_ids(engine.evaluate(_P, claims))


def test_discharge_before_admit_does_not_fire(engine):
    claims = _df(_claim(start="2020-01-01", end="2020-01-10"))
    assert "DISCHARGE_BEFORE_ADMIT" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# SERVICE_BEFORE_BIRTH
# ---------------------------------------------------------------------------

def test_service_before_birth_fires(engine):
    claims = _df(
        _claim(start="2020-01-01", DOB=pd.Timestamp("2025-06-01")),
    )
    assert "SERVICE_BEFORE_BIRTH" in _rule_ids(engine.evaluate(_P, claims))


def test_service_before_birth_does_not_fire(engine):
    claims = _df(
        _claim(start="2020-01-01", DOB=pd.Timestamp("1950-06-01")),
    )
    assert "SERVICE_BEFORE_BIRTH" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# OVERLAPPING_INPATIENT
# ---------------------------------------------------------------------------

def test_overlapping_inpatient_fires(engine):
    # Two inpatient stays for the same bene with overlapping date ranges
    claims = _df(
        _claim(bene=_B1, start="2020-01-01", end="2020-01-10", claim_type="inpatient"),
        _claim(bene=_B1, start="2020-01-05", end="2020-01-15", claim_type="inpatient"),
    )
    assert "OVERLAPPING_INPATIENT" in _rule_ids(engine.evaluate(_P, claims))


def test_overlapping_inpatient_does_not_fire(engine):
    # Two inpatient stays that do not overlap
    claims = _df(
        _claim(bene=_B1, start="2020-01-01", end="2020-01-05", claim_type="inpatient"),
        _claim(bene=_B1, start="2020-01-06", end="2020-01-10", claim_type="inpatient"),
    )
    assert "OVERLAPPING_INPATIENT" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# DUPLICATE_CLAIM
# ---------------------------------------------------------------------------

def test_duplicate_claim_fires(engine):
    row = _claim(bene=_B1, start="2020-01-01", end="2020-01-05", amount=5_000.0)
    claims = _df(row, row)  # identical row twice
    assert "DUPLICATE_CLAIM" in _rule_ids(engine.evaluate(_P, claims))


def test_duplicate_claim_does_not_fire(engine):
    # Same provider/bene/dates but different amount — not a duplicate
    claims = _df(
        _claim(bene=_B1, start="2020-01-01", end="2020-01-05", amount=1_000.0),
        _claim(bene=_B1, start="2020-01-01", end="2020-01-05", amount=2_000.0),
    )
    assert "DUPLICATE_CLAIM" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# SAME_DAY_BENE_MULTI_PROVIDER  (requires all_claims)
# ---------------------------------------------------------------------------

def test_same_day_bene_multi_provider_fires(engine):
    # Two different providers bill the same bene on the same day
    a = _claim(bene=_B1, provider="PRV_A", start="2020-03-01", end="2020-03-01")
    b = _claim(bene=_B1, provider="PRV_B", start="2020-03-01", end="2020-03-01")
    all_claims = _df(a, b)
    provider_a_claims = _df(a)
    findings = engine.evaluate("PRV_A", provider_a_claims, all_claims=all_claims)
    assert "SAME_DAY_BENE_MULTI_PROVIDER" in _rule_ids(findings)


def test_same_day_bene_multi_provider_does_not_fire(engine):
    # Only one provider bills each bene on a given day
    a1 = _claim(bene=_B1, provider="PRV_A", start="2020-03-01", end="2020-03-01")
    a2 = _claim(bene=_B2, provider="PRV_B", start="2020-03-01", end="2020-03-01")
    all_claims = _df(a1, a2)
    provider_a_claims = _df(a1)
    findings = engine.evaluate("PRV_A", provider_a_claims, all_claims=all_claims)
    assert "SAME_DAY_BENE_MULTI_PROVIDER" not in _rule_ids(findings)


def test_same_day_bene_multi_provider_needs_all_claims_to_fire(engine):
    # Without all_claims the rule cannot see other providers and must not fire
    a = _claim(bene=_B1, provider="PRV_A", start="2020-03-01", end="2020-03-01")
    b = _claim(bene=_B1, provider="PRV_B", start="2020-03-01", end="2020-03-01")
    all_claims = _df(a, b)
    provider_a_claims = _df(a)
    # Without all_claims — should not fire (only 1 distinct provider in the slice)
    findings_without = engine.evaluate("PRV_A", provider_a_claims)
    assert "SAME_DAY_BENE_MULTI_PROVIDER" not in _rule_ids(findings_without)
    # With all_claims — should fire
    findings_with = engine.evaluate("PRV_A", provider_a_claims, all_claims=all_claims)
    assert "SAME_DAY_BENE_MULTI_PROVIDER" in _rule_ids(findings_with)


# ---------------------------------------------------------------------------
# SAME_DAY_REPEAT
# ---------------------------------------------------------------------------

def test_same_day_repeat_fires(engine):
    # 5 claims for same provider-bene-day
    claims = _df(*[_claim(bene=_B1, start="2020-01-01", end="2020-01-01") for _ in range(5)])
    assert "SAME_DAY_REPEAT" in _rule_ids(engine.evaluate(_P, claims))


def test_same_day_repeat_does_not_fire(engine):
    # Only 4 claims — one below the threshold of 5
    claims = _df(*[_claim(bene=_B1, start="2020-01-01", end="2020-01-01") for _ in range(4)])
    assert "SAME_DAY_REPEAT" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# SHORT_STAY_HIGH_COST
# ---------------------------------------------------------------------------

def test_short_stay_high_cost_fires(engine):
    # 1-day inpatient stay, amount well above $30,000
    claims = _df(_claim(
        start="2020-01-01", end="2020-01-02",
        amount=50_000.0, claim_type="inpatient",
    ))
    assert "SHORT_STAY_HIGH_COST" in _rule_ids(engine.evaluate(_P, claims))


def test_short_stay_high_cost_does_not_fire_low_amount(engine):
    # Short stay but amount below threshold
    claims = _df(_claim(
        start="2020-01-01", end="2020-01-02",
        amount=10_000.0, claim_type="inpatient",
    ))
    assert "SHORT_STAY_HIGH_COST" not in _rule_ids(engine.evaluate(_P, claims))


def test_short_stay_high_cost_does_not_fire_outpatient(engine):
    # High amount but outpatient — filter excludes it
    claims = _df(_claim(
        start="2020-01-01", end="2020-01-02",
        amount=50_000.0, claim_type="outpatient",
    ))
    assert "SHORT_STAY_HIGH_COST" not in _rule_ids(engine.evaluate(_P, claims))


# ---------------------------------------------------------------------------
# Special behavioural tests
# ---------------------------------------------------------------------------

def test_clean_provider_returns_empty_list(engine):
    # A single unremarkable outpatient claim — no rule should fire
    claims = _df(_claim(
        bene=_B1, start="2020-06-01", end="2020-06-05",
        amount=500.0, claim_type="outpatient",
    ))
    assert engine.evaluate(_P, claims) == []


def test_post_death_aggregate_count(engine):
    # 10 post-death claims must produce ONE RuleEvidence, claims_affected=10
    dead_claims = _df(*[
        _claim(start="2020-06-01", DOD=pd.Timestamp("2020-01-01"))
        for _ in range(10)
    ])
    findings = engine.evaluate(_P, dead_claims)
    death = [f for f in findings if f.rule_id == "POST_DEATH_SERVICE"]
    assert len(death) == 1, f"Expected 1 finding, got {len(death)}"
    assert death[0].claims_affected == 10


def test_rule_evidence_requires_citation():
    with pytest.raises(Exception):
        RuleEvidence(
            category="fraud",
            severity="high",
            summary="test",
            rule_id="FAKE",
            claims_affected=1,
            # citation intentionally omitted
        )

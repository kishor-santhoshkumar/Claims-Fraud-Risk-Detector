"""Tests that SHAP evidence items carry no invented interpretation.

Rules that must hold for every ShapEvidence item:
  - category == "statistical"  (never a FWAC label)
  - severity is None           (SHAP rank is not a regulatory severity rating)
"""
import numpy as np
import pytest

from src.export import _build_shap_evidence
from src.schema import ShapEvidence


FEATURE_NAMES = ["total_reimbursed", "n_claims", "claims_per_bene",
                 "deceased_rate", "mean_bene_n_providers", "mean_chronic_count"]

FEATURE_STATS = {
    feat: {"median": 1.0, "sorted_col": np.array([0.0, 0.5, 1.0, 2.0, 5.0]), "n": 5}
    for feat in FEATURE_NAMES
}


def _make_evidence(shap_row: list[float]) -> list[ShapEvidence]:
    values = np.array([abs(s) * 10 for s in shap_row], dtype=float)
    return _build_shap_evidence(FEATURE_NAMES, values, np.array(shap_row), FEATURE_STATS)


def test_increases_risk_items_have_no_severity():
    shap_row = [0.9, 0.7, 0.5, 0.3, 0.2, 0.1]  # all positive → all increase_risk
    for item in _make_evidence(shap_row):
        assert item.severity is None, (
            f"Feature '{item.feature}' (direction={item.direction}) "
            f"has severity={item.severity!r} — must be null"
        )


def test_decreases_risk_items_have_no_severity():
    shap_row = [-0.9, -0.7, -0.5, -0.3, -0.2, -0.1]  # all negative → all decrease_risk
    for item in _make_evidence(shap_row):
        assert item.severity is None, (
            f"Feature '{item.feature}' (direction={item.direction}) "
            f"has severity={item.severity!r} — must be null"
        )


def test_mixed_direction_items_have_no_severity():
    shap_row = [0.9, -0.7, 0.5, -0.3, 0.2, -0.1]
    for item in _make_evidence(shap_row):
        assert item.severity is None, (
            f"Feature '{item.feature}' (direction={item.direction}) "
            f"has severity={item.severity!r} — must be null"
        )


def test_all_items_have_statistical_category():
    shap_row = [0.9, -0.7, 0.5, -0.3, 0.2, 0.1]
    for item in _make_evidence(shap_row):
        assert item.category == "statistical", (
            f"Feature '{item.feature}' (direction={item.direction}) "
            f"has category={item.category!r} — must be 'statistical'"
        )


def test_schema_rejects_non_null_severity():
    """ShapEvidence should not accept a non-null severity at construction time."""
    with pytest.raises(Exception):
        ShapEvidence(
            feature="total_reimbursed",
            value=100.0,
            impact=0.5,
            direction="increases_risk",
            severity="high",  # must be rejected by the schema
            summary="test",
        )


def test_schema_rejects_non_statistical_category():
    """ShapEvidence should not accept a FWAC category at construction time."""
    with pytest.raises(Exception):
        ShapEvidence(
            feature="total_reimbursed",
            value=100.0,
            impact=0.5,
            direction="increases_risk",
            category="fraud",  # must be rejected by the schema
            summary="test",
        )

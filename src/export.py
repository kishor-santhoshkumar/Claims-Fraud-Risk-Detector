"""Serialise scored providers to the evidence JSON contract.

Reads pre-computed artefacts written by the notebook's section 12:
  outputs/features_train.parquet  — provider features + fraud_label (5 410 rows)
  outputs/oof_predictions.npy     — out-of-fold fraud probabilities, shape (5410,)
  outputs/shap_values.npy         — SHAP attribution matrix, shape (5410, 31)
  outputs/feature_cols.json       — ordered feature names, length 31

Writes:
  outputs/scored_providers.json   — all 5 410 providers (compact JSON)
  outputs/sample_providers.json   — 4 hand-picked demo cases (indented JSON)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

# Ensure the project root is on sys.path so sibling-package imports resolve
# whether this module is run as a script or imported from a notebook.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.schema import Evidence, RuleEvidence, ShapEvidence, ScoredProvider  # noqa: E402

OUTPUTS = _PROJECT_ROOT / "outputs"

# ── Risk tier thresholds ──────────────────────────────────────────────────────
# Probability boundaries from the PR curve (PR-AUC ≈ 0.728, ROC-AUC ≈ 0.942).
# HIGH:   score ≥ 0.50 — at or above the F1-optimal decision boundary;
#         Precision@100 ≈ 94 %, so nearly all high-tier providers are true fraud.
# MEDIUM: 0.15 ≤ score < 0.50 — elevated risk; schedule for targeted review.
#         Corresponds roughly to Recall@500 coverage zone (Precision@500 ≈ 66 %).
# LOW:    score < 0.15 — population-level monitoring only; gate-eliminated by RF.
HIGH_THRESHOLD: float = 0.50
MEDIUM_THRESHOLD: float = 0.15

TOP_N_SHAP: int = 6  # SHAP features surfaced per provider

# ── Feature format specs ──────────────────────────────────────────────────────
# Maps feature name -> (human-readable label, Python format string for the value).
# The label and formatted value are combined with percentile/median stats at
# runtime to produce the full summary sentence.  All SHAP evidence uses
# category="statistical" and severity=null regardless of direction.
_FORMAT_SPECS: dict[str, tuple[str, str]] = {
    "total_reimbursed":      ("Total reimbursement",                    "${value:,.0f}"),
    "max_admission_length":  ("Longest inpatient stay",                 "{value:.0f} days"),
    "claims_per_bene":       ("Avg claims per beneficiary",             "{value:.1f}"),
    "total_deductible":      ("Total deductible collected",             "${value:,.0f}"),
    "max_claim_duration":    ("Longest claim duration",                 "{value:.0f} days"),
    "mean_chronic_count":    ("Avg chronic conditions per beneficiary", "{value:.1f}"),
    "mean_bene_n_providers": ("Avg providers per beneficiary",          "{value:.1f}"),
    "deceased_rate":         ("Deceased beneficiary rate",              "{value:.1%}"),
    "mean_age_at_claim":     ("Avg beneficiary age at claim",           "{value:.0f} years"),
    "n_distinct_states":     ("States spanning claims",                 "{value:.0f}"),
    "n_claims":              ("Total claims submitted",                 "{value:.0f}"),
    "n_unique_bene":         ("Unique beneficiaries billed",            "{value:.0f}"),
    "ip_op_ratio":           ("Inpatient-to-outpatient ratio",          "{value:.2f}"),
    "claims_per_physician":  ("Avg claims per attending physician",     "{value:.1f}"),
    "mean_phy_n_providers":  ("Avg providers per attending physician",  "{value:.1f}"),
    "n_unique_attending":    ("Distinct attending physicians",          "{value:.0f}"),
    "mean_reimbursed":       ("Mean reimbursement per claim",           "${value:,.0f}"),
    "max_reimbursed":        ("Highest single-claim reimbursement",     "${value:,.0f}"),
    "std_reimbursed":        ("Claim-amount standard deviation",        "${value:,.0f}"),
    "mean_deductible":       ("Avg deductible per claim",               "${value:,.0f}"),
    "mean_claim_duration":   ("Avg claim duration",                     "{value:.1f} days"),
    "mean_admission_length": ("Avg admission length",                   "{value:.1f} days"),
    "mean_n_diag":           ("Avg diagnosis codes per claim",          "{value:.1f}"),
    "mean_n_proc":           ("Avg procedure codes per claim",          "{value:.1f}"),
    "n_unique_primary_diag": ("Distinct primary diagnosis codes",       "{value:.0f}"),
    "primary_diag_entropy":  ("Diagnosis-code entropy",                 "{value:.2f} bits"),
    "n_distinct_counties":   ("Counties spanning claims",               "{value:.0f}"),
    "n_inpatient_claims":    ("Inpatient claims submitted",             "{value:.0f}"),
    "n_outpatient_claims":   ("Outpatient claims submitted",            "{value:.0f}"),
    "n_unique_operating":    ("Distinct operating physicians",          "{value:.0f}"),
    "n_unique_other":        ("Distinct other physicians",              "{value:.0f}"),
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _risk_tier(score: float) -> str:
    """Map a fraud probability to a named risk tier."""
    if score >= HIGH_THRESHOLD:
        return "high"
    if score >= MEDIUM_THRESHOLD:
        return "medium"
    return "low"


def _ordinal(n: float) -> str:
    """Return n as an ordinal string, e.g. 1 -> '1st', 12 -> '12th', 93 -> '93rd'."""
    n = int(round(n))
    suffix = "th"
    if n % 100 not in (11, 12, 13):
        if n % 10 == 1:
            suffix = "st"
        elif n % 10 == 2:
            suffix = "nd"
        elif n % 10 == 3:
            suffix = "rd"
    return f"{n}{suffix}"


def _compare_phrase(pct: float) -> str:
    """Return a comparison word based on population percentile rank."""
    if pct < 20:
        return "far below"
    if pct < 40:
        return "below"
    if pct <= 60:
        return "near"
    if pct <= 80:
        return "above"
    return "far above"


def _feature_summary(
    feature: str,
    value: float,
    median: float,
    pct: float,
    direction: str,
) -> str:
    """One sentence stating the observed value, its percentile, and model direction.

    Never asserts a mechanism — only reports the observed value and where it sits
    in the training population, then states whether the model uses it to increase
    or reduce the fraud score.
    """
    entry = _FORMAT_SPECS.get(feature)
    if entry is None:
        label = feature.replace("_", " ").title()
        fmt = "{value:.4g}"
    else:
        label, fmt = entry

    formatted_val = fmt.format(value=value)
    formatted_median = fmt.format(value=median)
    dir_phrase = "Increases risk" if direction == "increases_risk" else "Reduces risk"
    compare = _compare_phrase(pct)

    return (
        f"{label} of {formatted_val} — "
        f"{_ordinal(pct)} percentile, {compare} the median provider of {formatted_median}. "
        f"{dir_phrase}."
    )


def _build_shap_evidence(
    feature_names: list[str],
    feature_values: np.ndarray,
    shap_row: np.ndarray,
    feature_stats: dict[str, dict],
) -> list[ShapEvidence]:
    """Build the top-N SHAP evidence items for one provider.

    feature_stats must contain pre-computed population stats per feature:
      {"sorted_col": np.ndarray, "median": float, "n": int}
    Percentile is computed via binary search on the sorted column (O(log N)).

    Semantics:
    - category is always "statistical" for every item — never a FWAC label.
    - severity is always null — SHAP rank is not a regulatory severity rating.
    """
    top_idx = np.argsort(np.abs(shap_row))[::-1][:TOP_N_SHAP]
    items: list[ShapEvidence] = []
    for rank, idx in enumerate(top_idx, start=1):
        feat = feature_names[int(idx)]
        val = float(feature_values[int(idx)])
        impact = float(shap_row[int(idx)])
        direction = "increases_risk" if impact > 0 else "decreases_risk"

        stats = feature_stats.get(feat, {})
        median = stats.get("median", 0.0)
        sorted_col = stats.get("sorted_col", np.array([val]))
        n = stats.get("n", 1)
        pct = float(np.searchsorted(sorted_col, val, side="right") / n * 100)

        items.append(
            ShapEvidence(
                type="shap",
                feature=feat,
                value=val,
                impact=impact,
                direction=direction,
                summary=_feature_summary(feat, val, median, pct, direction),
            )
        )
    return items


def _build_clearance_summary(
    feature_names: list[str],
    feature_values: np.ndarray,
    shap_row: np.ndarray,
    feature_stats: dict[str, dict],
    score: float,
    n_rules_checked: int = 0,
    n_rules_fired: int = 0,
) -> str:
    """Plain-English explanation of why a low/medium-tier provider was not flagged.

    Uses the same SHAP pipeline as the evidence list — takes the top 5 features
    by most-negative SHAP value (strongest exonerating signals) and states each as
    value + percentile + direction. No mechanism claims.
    """
    # Top 5 features with the most negative SHAP (strongest exonerating push)
    sorted_idx = np.argsort(shap_row)
    top_down = [i for i in sorted_idx if shap_row[i] < 0][:5]

    sentences = ["Not flagged."]
    for idx in top_down:
        feat = feature_names[int(idx)]
        val = float(feature_values[int(idx)])
        stats = feature_stats.get(feat, {})
        median = stats.get("median", 0.0)
        sorted_col = stats.get("sorted_col", np.array([val]))
        n = stats.get("n", 1)
        pct = float(np.searchsorted(sorted_col, val, side="right") / n * 100)
        sentences.append(_feature_summary(feat, val, median, pct, "decreases_risk"))

    margin = HIGH_THRESHOLD - score
    if margin >= 0.35:
        proximity = "well below"
    elif margin >= 0.15:
        proximity = "below"
    else:
        proximity = "just below"

    fired_str = f"{n_rules_fired} fired" if n_rules_fired else "none fired"
    sentences.append(
        f"Score {score:.2f}, {proximity} the review threshold of {HIGH_THRESHOLD:.2f}. "
        f"{n_rules_checked} rules checked, {fired_str}."
    )
    return " ".join(sentences)


# ── Core builders ─────────────────────────────────────────────────────────────

def build_scored_providers(
    features: pd.DataFrame,
    oof: np.ndarray,
    shap_vals: np.ndarray,
    feature_names: list[str],
    engine=None,               # RulesEngine | None
    claims_df: pd.DataFrame | None = None,
) -> list[ScoredProvider]:
    """Build one ScoredProvider per row in *features*.

    Row order must be identical across *features*, *oof*, and *shap_vals*;
    this is guaranteed because all three are produced in the same notebook session
    from the same provider_df without shuffling.

    If `engine` and `claims_df` are supplied, rule findings are computed for
    every provider and appended to the evidence list alongside SHAP items.
    """
    X = features[feature_names].fillna(0).values  # (N, F) — matches SHAP ordering

    # Pre-compute per-feature population stats once; reused for every provider's
    # percentile computation.  Sorted arrays enable O(log N) lookup via searchsorted.
    feature_stats: dict[str, dict] = {
        feat: {
            "median": float(np.median(X[:, j])),
            "sorted_col": np.sort(X[:, j]),
            "n": len(X),
        }
        for j, feat in enumerate(feature_names)
    }

    provider_ids = features["Provider"].to_numpy()
    total_reimbs = features["total_reimbursed"].to_numpy(dtype=float)
    n_claims_arr = features["n_claims"].to_numpy(dtype=int)

    # Build per-provider claims lookup once — O(N) instead of O(N*M)
    provider_claims_map: dict[str, pd.DataFrame] = {}
    if engine is not None and claims_df is not None:
        provider_claims_map = {
            str(pid): grp for pid, grp in claims_df.groupby("Provider")
        }
    n_rules_total = len(engine.rules) if engine is not None else 0

    providers: list[ScoredProvider] = []
    for i in range(len(features)):
        score = float(oof[i])
        pid = str(provider_ids[i])
        total_reimb = float(total_reimbs[i])
        tier = _risk_tier(score)

        shap_evidence: list[Evidence] = _build_shap_evidence(
            feature_names, X[i], shap_vals[i], feature_stats,
        )

        rule_findings: list[RuleEvidence] = []
        if engine is not None and claims_df is not None:
            provider_claims = provider_claims_map.get(pid)
            if provider_claims is not None:
                rule_findings = engine.evaluate(pid, provider_claims, all_claims=claims_df)

        evidence: list[Evidence] = shap_evidence + rule_findings

        clearance = (
            _build_clearance_summary(
                feature_names, X[i], shap_vals[i], feature_stats, score,
                n_rules_checked=n_rules_total,
                n_rules_fired=len(rule_findings),
            )
            if tier != "high"
            else None
        )
        providers.append(
            ScoredProvider(
                provider_id=pid,
                score=score,
                risk_tier=tier,
                total_reimbursed=total_reimb,
                expected_loss=score * total_reimb,
                n_claims=int(n_claims_arr[i]),
                evidence=evidence,
                clearance_summary=clearance,
            )
        )
    return providers


def _pick_samples(
    providers: list[ScoredProvider],
    labels: np.ndarray,
) -> dict[str, ScoredProvider]:
    """Select four illustrative demo cases.

    Returns a dict with keys:
      clear_fraud       — high score, label=1 (textbook fraud signal)
      leie_placeholder  — second high-score fraud (LEIE screening slot)
      borderline        — score near the midpoint between tier thresholds
      false_positive    — high score but label=0 (demonstrates case clearing)
    """
    pid_to_label = {p.provider_id: int(labels[i]) for i, p in enumerate(providers)}
    by_score = sorted(providers, key=lambda p: p.score, reverse=True)

    clear_fraud = next(
        p for p in by_score
        if pid_to_label[p.provider_id] == 1 and p.score >= HIGH_THRESHOLD
    )
    leie_placeholder = next(
        p for p in by_score
        if pid_to_label[p.provider_id] == 1
        and p.score >= HIGH_THRESHOLD
        and p.provider_id != clear_fraud.provider_id
    )
    # Score closest to midpoint between HIGH and MEDIUM thresholds
    midpoint = (HIGH_THRESHOLD + MEDIUM_THRESHOLD) / 2
    borderline = min(providers, key=lambda p: abs(p.score - midpoint))

    # Highest-scoring non-fraud provider; fall back to any non-fraud if none above HIGH
    false_positive = next(
        (p for p in by_score if pid_to_label[p.provider_id] == 0 and p.score >= HIGH_THRESHOLD),
        next(p for p in by_score if pid_to_label[p.provider_id] == 0),
    )
    return {
        "clear_fraud": clear_fraud,
        "leie_placeholder": leie_placeholder,
        "borderline": borderline,
        "false_positive": false_positive,
    }


# ── Validation ────────────────────────────────────────────────────────────────

def _validate_shap_evidence(providers: list[ScoredProvider]) -> None:
    """Assert every SHAP item has category='statistical' and severity=None."""
    for p in providers:
        for ev in p.evidence:
            if not isinstance(ev, ShapEvidence):
                continue
            assert ev.severity is None, (
                f"Provider {p.provider_id}: SHAP item '{ev.feature}' "
                f"has severity={ev.severity!r} — must be null"
            )
            assert ev.category == "statistical", (
                f"Provider {p.provider_id}: SHAP item '{ev.feature}' "
                f"has category={ev.category!r} — must be 'statistical'"
            )


# ── Entry point ───────────────────────────────────────────────────────────────

def _generate_intermediates() -> None:
    """Run the two-stage pipeline and SHAP on features_train.parquet and save results."""
    import warnings
    warnings.filterwarnings("ignore")
    import shap as _shap
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import StratifiedKFold
    from xgboost import XGBClassifier

    print("Generating intermediates from features_train.parquet ...")
    features = pd.read_parquet(OUTPUTS / "features_train.parquet")
    feature_names = [c for c in features.columns if c not in ("Provider", "fraud_label")]
    X = features[feature_names].fillna(0).values
    y = features["fraud_label"].values
    ntr = (1 - y.mean()) / y.mean()
    RNG = 42

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RNG)
    oof_arr = np.zeros(len(y))
    for fold, (tr, te) in enumerate(skf.split(X, y), 1):
        Xtr, Xte, ytr = X[tr], X[te], y[tr]
        rf = RandomForestClassifier(n_estimators=300, class_weight="balanced",
                                    oob_score=True, n_jobs=-1, random_state=RNG)
        rf.fit(Xtr, ytr)
        oob = rf.oob_decision_function_[:, 1]
        rfte = rf.predict_proba(Xte)[:, 1]
        gate = np.percentile(oob[ytr == 1], 5)
        mtr, mte = oob >= gate, rfte >= gate
        if mtr.sum() > 10 and ytr[mtr].sum() > 0 and (ytr[mtr] == 0).sum() > 0:
            xgb = XGBClassifier(n_estimators=400, max_depth=5, learning_rate=0.05,
                                 scale_pos_weight=ntr, eval_metric="aucpr", random_state=RNG,
                                 subsample=0.8, colsample_bytree=0.8,
                                 tree_method="hist", verbosity=0)
            xgb.fit(Xtr[mtr], ytr[mtr])
            if mte.sum() > 0:
                oof_arr[te[mte]] = xgb.predict_proba(Xte[mte])[:, 1]
        print(f"  fold {fold}/5 done")

    print("Computing SHAP values ...")
    Xdf = pd.DataFrame(X, columns=feature_names)
    fxgb = XGBClassifier(n_estimators=400, max_depth=5, learning_rate=0.05,
                          scale_pos_weight=ntr, eval_metric="aucpr", random_state=RNG,
                          subsample=0.8, colsample_bytree=0.8,
                          tree_method="hist", verbosity=0)
    fxgb.fit(Xdf, y)
    shap_arr = _shap.TreeExplainer(fxgb).shap_values(Xdf)

    np.save(OUTPUTS / "oof_predictions.npy", oof_arr)
    np.save(OUTPUTS / "shap_values.npy", shap_arr)
    with open(OUTPUTS / "feature_cols.json", "w") as fh:
        json.dump(feature_names, fh)
    print(f"Saved  oof={oof_arr.shape}  shap={shap_arr.shape}")


def main() -> None:
    """Load artefacts, build evidence records, write JSON outputs, print diagnostics."""
    # Generate intermediates if missing
    if not (OUTPUTS / "oof_predictions.npy").exists():
        _generate_intermediates()

    # Load artefacts
    features = pd.read_parquet(OUTPUTS / "features_train.parquet")
    oof = np.load(OUTPUTS / "oof_predictions.npy")
    shap_vals = np.load(OUTPUTS / "shap_values.npy")
    with open(OUTPUTS / "feature_cols.json") as fh:
        feature_names: list[str] = json.load(fh)
    labels = features["fraud_label"].values

    # Alignment guards
    assert len(features) == len(oof) == len(shap_vals), (
        f"Row count mismatch: features={len(features)}, oof={len(oof)}, shap={len(shap_vals)}"
    )
    assert shap_vals.shape[1] == len(feature_names), (
        f"Feature count mismatch: shap cols={shap_vals.shape[1]}, feature_names={len(feature_names)}"
    )
    feat_cols_from_parquet = [c for c in features.columns if c not in ("Provider", "fraud_label")]
    assert feat_cols_from_parquet == feature_names, (
        "Column order mismatch between features_train.parquet and feature_cols.json"
    )

    # Validate metrics are unchanged
    pr_auc = average_precision_score(labels, oof)
    roc_auc = roc_auc_score(labels, oof)
    print(f"PR-AUC  = {pr_auc:.4f}  (expected ~0.728)")
    print(f"ROC-AUC = {roc_auc:.4f}  (expected ~0.942)")
    assert 0.720 <= pr_auc <= 0.740, f"PR-AUC {pr_auc:.4f} outside expected [0.720, 0.740]"
    assert 0.935 <= roc_auc <= 0.950, f"ROC-AUC {roc_auc:.4f} outside expected [0.935, 0.950]"

    # Load claims data and initialise the rules engine
    from src.loaders import load_all
    from src.rules import RulesEngine, build_claims_for_rules

    print("\nLoading raw claims for rules engine ...")
    raw = load_all()
    claims_df = build_claims_for_rules(raw["bene"], raw["ip"], raw["op"])
    engine = RulesEngine(_PROJECT_ROOT / "rules.yaml")
    print(f"  {len(claims_df):,} claims ready  |  {len(engine.rules)} rules loaded")

    # Build all scored providers (SHAP evidence + rule findings)
    providers = build_scored_providers(
        features, oof, shap_vals, feature_names,
        engine=engine, claims_df=claims_df,
    )

    # Evidence semantics validation
    _validate_shap_evidence(providers)

    # Risk tier distribution
    tier_counts: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
    for p in providers:
        tier_counts[p.risk_tier] += 1
    total = len(providers)
    print(f"\nRisk tier distribution across all {total:,} providers:")
    for tier in ("high", "medium", "low"):
        n = tier_counts[tier]
        print(f"  {tier:8s}: {n:5d}  ({n / total:.1%})")

    # Write full output (compact — downstream parses it, humans read the sample)
    scored_path = OUTPUTS / "scored_providers.json"
    with open(scored_path, "w") as fh:
        json.dump([p.model_dump() for p in providers], fh)
    print(f"\nWrote {len(providers):,} providers -> {scored_path}")

    # Round-trip validation: reload from disk and validate every record
    with open(scored_path) as fh:
        reloaded = json.load(fh)
    for rec in reloaded:
        ScoredProvider.model_validate(rec)
    print(f"Round-trip validation passed: {len(reloaded):,} ScoredProvider records.")

    # Pick and write sample providers
    samples = _pick_samples(providers, labels)
    pid_to_label = {p.provider_id: int(labels[i]) for i, p in enumerate(providers)}
    print("\nSample provider IDs (4 demo cases):")
    for role, p in samples.items():
        print(
            f"  {role:22s}: {p.provider_id}  "
            f"score={p.score:.4f}  label={pid_to_label[p.provider_id]}  tier={p.risk_tier}"
        )

    sample_path = OUTPUTS / "sample_providers.json"
    with open(sample_path, "w") as fh:
        json.dump({role: p.model_dump() for role, p in samples.items()}, fh, indent=2)
    print(f"\nWrote 4 sample providers -> {sample_path}")

    # Print 3 example clearance summaries for spot-checking
    low_ex = next((p for p in providers if p.risk_tier == "low" and p.clearance_summary), None)
    med_ex = next((p for p in providers if p.risk_tier == "medium" and p.clearance_summary), None)
    near_threshold = max(
        (p for p in providers if p.risk_tier == "medium"),
        key=lambda p: p.score,
        default=None,
    )
    print("\nExample clearance summaries:")
    for label, p in [
        ("low tier", low_ex),
        ("medium tier", med_ex),
        ("near threshold (highest medium score)", near_threshold),
    ]:
        if p and p.clearance_summary:
            print(f"\n  [{label}]  {p.provider_id}  score={p.score:.4f}  tier={p.risk_tier}")
            print(f"  {p.clearance_summary}")


if __name__ == "__main__":
    main()

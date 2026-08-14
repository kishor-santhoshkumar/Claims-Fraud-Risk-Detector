"""Rules engine — deterministic policy checks over a provider's claims.

Reads rules.yaml, evaluates every rule against one provider's claims, and
returns a list of RuleEvidence objects.

This module is deliberately dumb. No model, no LLM, no network. Same input
always gives the same output. That reproducibility is why RuleEvidence is
allowed to carry a fraud/waste/abuse label and SHAP evidence is not.

Usage:
    from src.rules import RulesEngine

    engine = RulesEngine("rules.yaml")
    findings = engine.evaluate(provider_id="PRV52985", claims=claims_df)
    # -> list[RuleEvidence], possibly empty
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import pandas as pd
import yaml

from src.schema import RuleEvidence

# Column names — CHECK THESE AGAINST THE REAL TABLES BEFORE RUNNING.
COL_PROVIDER = "Provider"
COL_BENE = "BeneID"
COL_START = "ClaimStartDt"
COL_END = "ClaimEndDt"
COL_AMOUNT = "InscClaimAmtReimbursed"
COL_DOD = "DOD"
COL_DOB = "DOB"
COL_CLAIM_TYPE = "claim_type"  # expected values: "inpatient" / "outpatient"


def build_claims_for_rules(
    bene: pd.DataFrame,
    ip: pd.DataFrame,
    op: pd.DataFrame,
) -> pd.DataFrame:
    """Return a combined claims df ready for the rules engine.

    Adds `claim_type` ("inpatient"/"outpatient") and merges DOB/DOD from
    beneficiary data. This is the canonical input for evaluate() and fire_report().
    Call this once; pass the result (or per-provider slices) to the engine.
    """
    ip = ip.copy()
    op = op.copy()
    ip[COL_CLAIM_TYPE] = "inpatient"
    op[COL_CLAIM_TYPE] = "outpatient"
    all_claims = pd.concat([ip, op], ignore_index=True)

    bene_cols = [COL_BENE]
    for col in (COL_DOB, COL_DOD):
        if col in bene.columns:
            bene_cols.append(col)
    all_claims = all_claims.merge(bene[bene_cols], on=COL_BENE, how="left")
    return all_claims


class RulesEngine:
    """Loads rule definitions and evaluates them against provider claims."""

    def __init__(self, rules_path: str | Path = "rules.yaml") -> None:
        with open(rules_path) as f:
            doc = yaml.safe_load(f)
        self.rules: list[dict[str, Any]] = doc["rules"]
        self._validate_rules()

    # -- public ---------------------------------------------------------

    def evaluate(
        self,
        provider_id: str,
        claims: pd.DataFrame,
        all_claims: pd.DataFrame | None = None,
    ) -> list[RuleEvidence]:
        """Run every rule against one provider's claims.

        `all_claims` should be the full combined claims table (all providers).
        When provided, beneficiary-scoped rules (distinct_count logic) use it
        filtered to this provider's bene IDs so they can detect multi-provider
        patterns. Without it, those rules always see only one provider and can
        never fire.

        Returns zero or more findings. An empty list is a valid result — it
        means the provider passed every check, which is what the clearance
        path needs.
        """
        findings: list[RuleEvidence] = []
        provider_benes: frozenset | None = None
        if all_claims is not None:
            provider_benes = frozenset(claims[COL_BENE].dropna())

        for rule in self.rules:
            # Skip rules whose required columns are absent rather than crashing.
            missing = self._missing_columns(rule, claims)
            if missing:
                continue

            logic = rule["logic"]

            # distinct_count needs claims across all providers for this provider's
            # beneficiaries; other rule types use only this provider's claims.
            if logic["type"] == "distinct_count" and all_claims is not None:
                bene_df = all_claims[all_claims[COL_BENE].isin(provider_benes)]
                n = self._distinct_count_scoped(logic, bene_df, claims)
            else:
                n = self._run_logic(logic, claims)

            if n > 0:
                findings.append(self._build_evidence(rule, n))

        return findings

    def fire_report(self, claims: pd.DataFrame) -> pd.DataFrame:
        """Count how many providers each rule fires on.

        Run this before trusting anything. If a rule fires on more than ~20%
        of providers, either the logic is too loose or the synthetic data is
        inconsistent. Either way you want to know before demo day.
        """
        counts = {r["rule_id"]: 0 for r in self.rules}
        total = 0

        for provider_id, group in claims.groupby(COL_PROVIDER):
            total += 1
            for ev in self.evaluate(str(provider_id), group, all_claims=claims):
                counts[ev.rule_id] += 1

        rows = [
            {
                "rule_id": rid,
                "providers_fired": c,
                "pct": round(100 * c / total, 2) if total else 0.0,
            }
            for rid, c in counts.items()
        ]
        return pd.DataFrame(rows).sort_values("providers_fired", ascending=False)

    # -- evidence construction -------------------------------------------

    def _build_evidence(self, rule: dict[str, Any], n: int) -> RuleEvidence:
        summary = " ".join(rule["summary_template"].format(n=n).split())
        return RuleEvidence(
            rule_id=rule["rule_id"],
            category=rule["category"],
            severity=rule["severity"],
            citation=rule["citation"],
            claims_affected=n,
            summary=summary,
        )

    # -- logic dispatch ---------------------------------------------------

    def _run_logic(self, logic: dict[str, Any], claims: pd.DataFrame) -> int:
        """Return the number of affected claims. 0 means the rule did not fire."""
        df = self._apply_filter(logic.get("filter"), claims)
        if df.empty:
            return 0

        handler: Callable[[dict[str, Any], pd.DataFrame], int] = {
            "date_compare": self._date_compare,
            "date_diff": self._date_diff,
            "numeric": self._numeric,
            "interval_overlap": self._interval_overlap,
            "exact_duplicate": self._exact_duplicate,
            "distinct_count": self._distinct_count,
            "group_count": self._group_count,
            "compound": self._compound,
        }[logic["type"]]

        return handler(logic, df)

    # -- individual evaluators --------------------------------------------

    def _date_compare(self, logic: dict[str, Any], df: pd.DataFrame) -> int:
        left = pd.to_datetime(df[logic["left"]], errors="coerce")
        right = pd.to_datetime(df[logic["right"]], errors="coerce")
        mask = left > right if logic["operator"] == "after" else left < right
        return int(mask.fillna(False).sum())

    def _date_diff(self, logic: dict[str, Any], df: pd.DataFrame) -> pd.Series:
        start = pd.to_datetime(df[logic["start"]], errors="coerce")
        end = pd.to_datetime(df[logic["end"]], errors="coerce")
        days = (end - start).dt.days
        return self._compare(days, logic["operator"], logic["value"])

    def _numeric(self, logic: dict[str, Any], df: pd.DataFrame) -> pd.Series:
        return self._compare(df[logic["field"]], logic["operator"], logic["value"])

    def _interval_overlap(self, logic: dict[str, Any], df: pd.DataFrame) -> int:
        """Count claims whose date range overlaps another in the same group."""
        start = pd.to_datetime(df[logic["start"]], errors="coerce")
        end = pd.to_datetime(df[logic["end"]], errors="coerce")
        work = pd.DataFrame({"s": start, "e": end})
        for col in logic["group_by"]:
            work[col] = df[col].values
        work = work.dropna(subset=["s", "e"])

        affected = 0
        for _, grp in work.groupby(logic["group_by"]):
            grp = grp.sort_values("s")
            s = grp["s"].tolist()
            e = grp["e"].tolist()
            overlapping = set()
            for i in range(len(s)):
                for j in range(i + 1, len(s)):
                    if s[j] > e[i]:
                        break  # sorted by start, no later interval can overlap
                    overlapping.add(i)
                    overlapping.add(j)
            affected += len(overlapping)
        return affected

    def _exact_duplicate(self, logic: dict[str, Any], df: pd.DataFrame) -> int:
        """Count claims that are part of a duplicate group.

        A group of 3 identical claims counts as 3 affected, not 1 — the whole
        group is the finding.
        """
        sizes = df.groupby(logic["match_on"]).transform("size")
        col = sizes.iloc[:, 0] if isinstance(sizes, pd.DataFrame) else sizes
        return int((col >= logic["min_count"]).sum())

    def _distinct_count(self, logic: dict[str, Any], df: pd.DataFrame) -> int:
        """Count claims in groups where a distinct-value count crosses a threshold."""
        n_distinct = df.groupby(logic["group_by"])[logic["count_distinct"]].transform("nunique")
        mask = self._compare(n_distinct, logic["operator"], logic["value"])
        return int(mask.sum())

    def _distinct_count_scoped(
        self,
        logic: dict[str, Any],
        bene_df: pd.DataFrame,
        provider_claims: pd.DataFrame,
    ) -> int:
        """Beneficiary-scoped distinct_count for SAME_DAY_BENE_MULTI_PROVIDER.

        Runs the distinct-count check on `bene_df` (all providers' claims for
        this provider's benes) to find qualifying groups, then counts only this
        provider's claims that fall inside those groups. That way claims_affected
        reflects this provider's exposure, not the full cross-provider population.
        """
        df = self._apply_filter(logic.get("filter"), bene_df)
        if df.empty:
            return 0
        n_distinct = df.groupby(logic["group_by"])[logic["count_distinct"]].transform("nunique")
        mask = self._compare(n_distinct, logic["operator"], logic["value"])
        if not mask.any():
            return 0
        qualifying_keys = df.loc[mask, logic["group_by"]].drop_duplicates()
        matched = provider_claims.merge(qualifying_keys, on=logic["group_by"], how="inner")
        return len(matched)

    def _group_count(self, logic: dict[str, Any], df: pd.DataFrame) -> int:
        sizes = df.groupby(logic["group_by"]).transform("size")
        col = sizes.iloc[:, 0] if isinstance(sizes, pd.DataFrame) else sizes
        mask = self._compare(col, logic["operator"], logic["value"])
        return int(mask.sum())

    def _compound(self, logic: dict[str, Any], df: pd.DataFrame) -> int:
        mask = pd.Series(True, index=df.index)
        for cond in logic["all_of"]:
            sub = {
                "date_diff": self._date_diff,
                "numeric": self._numeric,
            }[cond["type"]](cond, df)
            mask &= sub
        return int(mask.sum())

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _compare(series: pd.Series, operator: str, value: Any) -> pd.Series:
        ops = {
            "gt": series > value,
            "gte": series >= value,
            "lt": series < value,
            "lte": series <= value,
            "eq": series == value,
        }
        return ops[operator].fillna(False)

    @staticmethod
    def _apply_filter(flt: dict[str, Any] | None, df: pd.DataFrame) -> pd.DataFrame:
        if not flt:
            return df
        out = df
        for col, val in flt.items():
            if col not in out.columns:
                return out.iloc[0:0]  # column absent -> rule cannot fire
            out = out[out[col] == val]
        return out

    @staticmethod
    def _missing_columns(rule: dict[str, Any], claims: pd.DataFrame) -> list[str]:
        required = rule["logic"].get("requires", [])
        return [c for c in required if c not in claims.columns]

    def _validate_rules(self) -> None:
        """Fail loudly at load time rather than silently at demo time."""
        seen: set[str] = set()
        for r in self.rules:
            for key in (
                "rule_id",
                "category",
                "severity",
                "citation",
                "description",
                "logic",
                "summary_template",
            ):
                if key not in r:
                    raise ValueError(f"rule missing '{key}': {r.get('rule_id', r)}")
            if r["rule_id"] in seen:
                raise ValueError(f"duplicate rule_id: {r['rule_id']}")
            seen.add(r["rule_id"])
            if r["category"] not in {"fraud", "waste", "abuse", "compliance"}:
                raise ValueError(f"bad category on {r['rule_id']}: {r['category']}")
            if r["severity"] not in {"low", "medium", "high"}:
                raise ValueError(f"bad severity on {r['rule_id']}: {r['severity']}")
            if str(r["citation"]).startswith("TODO"):
                # Warn, do not raise — lets you develop before citations land.
                print(f"[rules] WARNING: {r['rule_id']} has a placeholder citation")

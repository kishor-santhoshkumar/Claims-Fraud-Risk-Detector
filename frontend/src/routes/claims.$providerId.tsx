import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchClaims, type Claim } from "@/lib/api";
import { useCaseStore } from "@/lib/caseStore";
import { useBatch } from "@/lib/batchContext";
import { formatMoneyFull } from "@/lib/mockData";
import { cn } from "@/lib/utils";

// Population stats baked in from outputs/claim_pop_stats.json
const POP_MEDIAN = 80;
const POP_MAD    = 60;
const P99        = 0.4464;
const P95        = 0.3923;

const RULE_WEIGHTS: Record<string, number> = {
  POST_DEATH_CLAIM: 0.40, DUPLICATE_CLAIM: 0.35, DISCHARGE_BEFORE_ADMIT: 0.30,
  SHORT_STAY_HIGH_COST: 0.25, MISSING_ATTENDING: 0.20, SAME_DAY_MULTI_PROVIDER: 0.20,
};

function sig(x: number) { const c = Math.max(-15, Math.min(15, x)); return 1 / (1 + Math.exp(-c)); }

function scoreClaimInline(claim: Claim, allAmounts: number[]): Claim {
  if (claim.claim_risk_tier != null) return claim; // already scored by backend
  const flags = claim.rule_flags?.length ? claim.rule_flags : (claim.rule_flag ? [claim.rule_flag] : []);
  const ruleScore = Math.min(flags.reduce((s, f) => s + (RULE_WEIGHTS[f] ?? 0), 0), 1.0);
  const amt = claim.amount_reimbursed;
  const n = allAmounts.length;
  let wz = 0;
  if (n > 1) {
    const mean = allAmounts.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(allAmounts.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    wz = std > 0 ? (amt - mean) / std : 0;
  }
  const cz = POP_MAD > 0 ? (amt - POP_MEDIAN) / (1.4826 * POP_MAD) : 0;
  const score = Math.round(Math.max(0, Math.min(1, 0.5 * ruleScore + 0.3 * sig(wz / 3) + 0.2 * sig(cz / 3))) * 10000) / 10000;
  const tier: "high" | "medium" | "low" = score >= P99 ? "high" : score >= P95 ? "medium" : "low";
  return { ...claim, claim_risk_score: score, claim_risk_tier: tier, within_z: Math.round(wz * 10000) / 10000, cross_z: Math.round(cz * 10000) / 10000, rule_flags: flags };
}

export const Route = createFileRoute("/claims/$providerId")({
  component: ClaimsPage,
});

type SortKey =
  | "claim_risk_score"
  | "claim_id"
  | "claim_start_dt"
  | "claim_type"
  | "amount_reimbursed"
  | "deductible_paid"
  | "attending_physician";

const PER_PAGE = 200;

const RULE_META: Record<string, { label: string; severity: string; citation: string }> = {
  POST_DEATH_CLAIM:       { label: "Post-death billing",        severity: "high",   citation: "Medicare BPM Ch.15 §15.1" },
  DUPLICATE_CLAIM:        { label: "Duplicate claim",           severity: "high",   citation: "Medicare PIM Ch.4 §4.3.1" },
  DISCHARGE_BEFORE_ADMIT: { label: "Discharge before admit",    severity: "medium", citation: "Medicare PIM Ch.3 §3.2.4" },
  SHORT_STAY_HIGH_COST:   { label: "Short stay / high cost",    severity: "medium", citation: "Medicare PIM Ch.6 §6.5.2" },
  MISSING_ATTENDING:      { label: "Missing attending physician",severity: "medium", citation: "42 CFR §424.22" },
  SAME_DAY_MULTI_PROVIDER:{ label: "Same-day multi-provider",   severity: "low",    citation: "Medicare PIM Ch.4 §4.5" },
};

const SEVERITY_COLORS: Record<string, string> = {
  high:   "#dc2626",
  medium: "#d97706",
  low:    "#6b7280",
};

function TierBadge({ tier }: { tier: "high" | "medium" | "low" | null }) {
  if (!tier || tier === "low") return null;
  const styles: Record<string, React.CSSProperties> = {
    high:   { background: "rgba(220,38,38,0.12)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.35)" },
    medium: { background: "rgba(217,119,6,0.12)",  color: "#d97706", border: "1px solid rgba(217,119,6,0.35)" },
  };
  return (
    <span style={{
      ...styles[tier],
      display: "inline-block",
      padding: "1px 6px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      marginLeft: 6,
      verticalAlign: "middle",
    }}>
      {tier}
    </span>
  );
}

function rowTint(tier: "high" | "medium" | "low" | null): React.CSSProperties {
  if (tier === "high")   return { background: "rgba(220,38,38,0.05)" };
  if (tier === "medium") return { background: "rgba(217,119,6,0.05)" };
  return {};
}

function WhyFlagged({ claim }: { claim: Claim }) {
  const flags = claim.rule_flags ?? [];
  const hasFlags = flags.length > 0;
  const hasZ = (claim.within_z != null && Math.abs(claim.within_z) > 0.5) ||
               (claim.cross_z  != null && Math.abs(claim.cross_z)  > 0.5);

  if (!hasFlags && !hasZ) return null;

  return (
    <div style={{
      marginTop: 12,
      padding: "10px 12px",
      background: "rgba(220,38,38,0.04)",
      border: "1px solid rgba(220,38,38,0.18)",
      borderRadius: 6,
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#dc2626", marginBottom: 8 }}>
        Why flagged
      </p>
      {hasFlags && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: hasZ ? 8 : 0 }}>
          {flags.map((flag) => {
            const meta = RULE_META[flag] ?? { label: flag, severity: "medium", citation: "" };
            return (
              <div key={flag} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                <span style={{
                  padding: "1px 5px",
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  background: SEVERITY_COLORS[meta.severity] + "20",
                  color: SEVERITY_COLORS[meta.severity],
                  border: `1px solid ${SEVERITY_COLORS[meta.severity]}40`,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}>
                  {meta.severity.toUpperCase()}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {meta.label}
                  {meta.citation && (
                    <span style={{ color: "var(--text-faint)", marginLeft: 4 }}>({meta.citation})</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {hasZ && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
          {claim.within_z != null && (
            <div>
              <span style={{ color: "var(--text-faint)" }}>Within-provider z </span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 600, color: Math.abs(claim.within_z) > 2 ? "#dc2626" : "inherit" }}>
                {claim.within_z > 0 ? "+" : ""}{claim.within_z.toFixed(2)}
              </span>
              <span style={{ color: "var(--text-faint)", marginLeft: 4 }}>(vs this provider's mean)</span>
            </div>
          )}
          {claim.cross_z != null && (
            <div>
              <span style={{ color: "var(--text-faint)" }}>Cross-provider z </span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 600, color: Math.abs(claim.cross_z) > 2 ? "#dc2626" : "inherit" }}>
                {claim.cross_z > 0 ? "+" : ""}{claim.cross_z.toFixed(2)}
              </span>
              <span style={{ color: "var(--text-faint)", marginLeft: 4 }}>(vs all-provider median)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClaimsPage() {
  const { providerId } = Route.useParams();
  const navigate = useNavigate();
  const { providers } = useCaseStore();
  const { activeBatch } = useBatch();

  const askAboutClaim = (claimId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      sessionStorage.setItem("chat_prefill", `#${claimId} `);
      // Also seed the session claims so context is already there
      const prev: string[] = JSON.parse(sessionStorage.getItem("chat_session_claims") ?? "[]");
      const next = Array.from(new Set([...prev, claimId]));
      sessionStorage.setItem("chat_session_claims", JSON.stringify(next));
    } catch {}
    navigate({ to: "/assistant" });
  };
  const provider = providers.find((p) => p.provider_id === providerId);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [totalClaims, setTotalClaims] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<"all" | "inpatient" | "outpatient">("all");
  const [riskFilter, setRiskFilter] = useState<"all" | "high" | "medium">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "claim_risk_score", dir: -1 });
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setClaims([]);
    setPage(1);
    fetchClaims(providerId, 1, PER_PAGE, activeBatch)
      .then((res) => {
        const amounts = res.claims.map((c) => c.amount_reimbursed);
        setClaims(res.claims.map((c) => scoreClaimInline(c, amounts)));
        setTotalClaims(res.total_claims);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [providerId, activeBatch]);

  const loadMore = () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    fetchClaims(providerId, nextPage, PER_PAGE, activeBatch)
      .then((res) => {
        setClaims((prev) => {
          const allAmounts = [...prev, ...res.claims].map((c) => c.amount_reimbursed);
          return [...prev, ...res.claims.map((c) => scoreClaimInline(c, allAmounts))];
        });
        setPage(nextPage);
      })
      .finally(() => setLoadingMore(false));
  };

  const hasMore = claims.length < totalClaims;

  const highCount   = useMemo(() => claims.filter((c) => c.claim_risk_tier === "high").length, [claims]);
  const mediumCount = useMemo(() => claims.filter((c) => c.claim_risk_tier === "medium").length, [claims]);

  const rows = useMemo(() => {
    const filtered = claims.filter(
      (c) =>
        (type === "all" || c.claim_type === type) &&
        (riskFilter === "all" || c.claim_risk_tier === riskFilter) &&
        (!from || c.claim_start_dt >= from) &&
        (!to || c.claim_start_dt <= to),
    );
    return filtered.sort((a, b) => {
      const key = sort.key;
      if (key === "claim_risk_score") {
        const av = a.claim_risk_score ?? -1;
        const bv = b.claim_risk_score ?? -1;
        return (av - bv) * sort.dir;
      }
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * sort.dir;
    });
  }, [claims, type, riskFilter, from, to, sort]);

  const totalReimbursed = claims.reduce((s, c) => s + c.amount_reimbursed, 0);

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))}
      className={cn(
        "cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const filterBtn = (value: string, label: string, active: boolean, onClick: () => void) => (
    <button
      key={value}
      onClick={onClick}
      className={cn(
        "border px-2 py-1 capitalize",
        active
          ? "border-foreground/30 bg-muted"
          : "border-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="px-6 pb-16">
      <div className="border-b border-border py-4">
        <Link
          to="/case/$providerId"
          params={{ providerId }}
          className="text-[12px] text-muted-foreground underline underline-offset-4"
        >
          Back to case
        </Link>
        <h1 className="mt-2 font-mono text-[18px]">{providerId}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {(totalClaims > 0 ? totalClaims : provider?.n_claims ?? 0).toLocaleString()} claims
          {highCount > 0 && (
            <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{highCount} high risk</span></>
          )}
          {mediumCount > 0 && (
            <> · <span style={{ color: "#d97706", fontWeight: 600 }}>{mediumCount} medium risk</span></>
          )}
          {" · "}{formatMoneyFull(provider?.total_reimbursed ?? totalReimbursed)} reimbursed
        </p>
      </div>

      {loading ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Loading claims…</p>
      ) : error ? (
        <p className="py-10 text-center text-[13px] text-risk">Failed to load claims: {error}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 py-3 text-[12px]">
            {/* Claim type filter */}
            <div className="flex gap-1">
              {(["all", "inpatient", "outpatient"] as const).map((t) =>
                filterBtn(t, t, type === t, () => setType(t))
              )}
            </div>

            {/* Risk tier filter */}
            <div className="flex gap-1 border-l border-border pl-3">
              {filterBtn("all",    "All risk", riskFilter === "all",    () => setRiskFilter("all"))}
              {filterBtn("high",   "High",     riskFilter === "high",   () => setRiskFilter("high"))}
              {filterBtn("medium", "Medium",   riskFilter === "medium", () => setRiskFilter("medium"))}
            </div>

            {/* Date range */}
            <label className="flex items-center gap-2 text-muted-foreground">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-border px-2 py-1 text-foreground"
              />
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-border px-2 py-1 text-foreground"
              />
            </label>
          </div>

          <table className="w-full border-collapse text-[12px]">
            <thead className="border-y border-border">
              <tr>
                {header("claim_id", "Claim")}
                {header("claim_start_dt", "Dates")}
                {header("claim_type", "Type")}
                {header("amount_reimbursed", "Amount", "right")}
                {header("deductible_paid", "Deductible", "right")}
                {header("attending_physician", "Attending")}
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Dx</th>
                {header("claim_risk_score", "Risk", "right")}
                <th className="px-3 py-2 font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.claim_id}>
                  <tr
                    onClick={() => setExpanded(expanded === c.claim_id ? null : c.claim_id)}
                    style={rowTint(c.claim_risk_tier)}
                    className={cn("cursor-pointer border-b border-border hover:brightness-95")}
                  >
                    <td className="px-3 py-2 font-mono">
                      {c.claim_id}
                      {(c.rule_flags ?? []).map((flag) => (
                        <span key={flag} className="ml-2 text-[11px] text-risk">{flag}</span>
                      ))}
                      {!(c.rule_flags?.length) && c.rule_flag && (
                        <span className="ml-2 text-[11px] text-risk">{c.rule_flag}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {c.claim_start_dt} → {c.claim_end_dt}
                    </td>
                    <td className="px-3 py-2 capitalize">{c.claim_type}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatMoneyFull(c.amount_reimbursed)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                      {formatMoneyFull(c.deductible_paid)}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {c.attending_physician ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.diagnosis_codes.length}</td>
                    <td className="px-3 py-2 text-right">
                      {c.claim_risk_tier ? (
                        <TierBadge tier={c.claim_risk_tier} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={(e) => askAboutClaim(c.claim_id, e)}
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.06)", color: "#1d4ed8", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.14)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.6)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.06)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)"; }}
                      >
                        Ask
                      </button>
                    </td>
                  </tr>
                  {expanded === c.claim_id && (
                    <tr className="border-b border-border bg-muted/40">
                      <td colSpan={9} className="px-3 py-3">
                        <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
                          <div>
                            <dt className="text-muted-foreground">Beneficiary</dt>
                            <dd className="font-mono">{c.bene_id}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Admission / discharge</dt>
                            <dd className="font-mono">
                              {c.admission_dt ?? "—"} / {c.discharge_dt ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Diagnosis codes</dt>
                            <dd className="font-mono">{c.diagnosis_codes.join(", ") || "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Procedure codes</dt>
                            <dd className="font-mono">{c.procedure_codes.join(", ") || "—"}</dd>
                          </div>
                        </dl>
                        {(c.claim_risk_tier === "high" || c.claim_risk_tier === "medium") && (
                          <WhyFlagged claim={c} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && !loading && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              No claims match the current filters.
            </p>
          )}

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="border border-border px-4 py-2 text-[13px] hover:bg-muted disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : `Load more (${totalClaims - claims.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

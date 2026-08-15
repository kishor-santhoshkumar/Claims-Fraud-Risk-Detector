import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchClaims, type Claim } from "@/lib/api";
import { useCaseStore } from "@/lib/caseStore";
import { formatMoneyFull } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/claims/$providerId")({
  component: ClaimsPage,
});

type SortKey = keyof Pick<
  Claim,
  "claim_id" | "claim_start_dt" | "claim_type" | "amount_reimbursed" | "deductible_paid" | "attending_physician"
>;

const PER_PAGE = 200;

function ClaimsPage() {
  const { providerId } = Route.useParams();
  const { providers } = useCaseStore();
  const provider = providers.find((p) => p.provider_id === providerId);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [totalClaims, setTotalClaims] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<"all" | "inpatient" | "outpatient">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "claim_start_dt", dir: 1 });
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setClaims([]);
    setPage(1);
    fetchClaims(providerId, 1, PER_PAGE)
      .then((res) => {
        setClaims(res.claims);
        setTotalClaims(res.total_claims);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [providerId]);

  const loadMore = () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    fetchClaims(providerId, nextPage, PER_PAGE)
      .then((res) => {
        setClaims((prev) => [...prev, ...res.claims]);
        setPage(nextPage);
      })
      .finally(() => setLoadingMore(false));
  };

  const hasMore = claims.length < totalClaims;

  const rows = useMemo(() => {
    const filtered = claims.filter(
      (c) =>
        (type === "all" || c.claim_type === type) &&
        (!from || c.claim_start_dt >= from) &&
        (!to || c.claim_start_dt <= to),
    );
    return filtered.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * sort.dir;
    });
  }, [claims, type, from, to, sort]);

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
          {totalClaims > 0 ? totalClaims.toLocaleString() : provider?.n_claims.toLocaleString() ?? "—"} claims ·{" "}
          showing {claims.length} ·{" "}
          {formatMoneyFull(provider?.total_reimbursed ?? totalReimbursed)} reimbursed
        </p>
      </div>

      {loading ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Loading claims…</p>
      ) : error ? (
        <p className="py-10 text-center text-[13px] text-risk">Failed to load claims: {error}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 py-3 text-[12px]">
            <div className="flex gap-1">
              {(["all", "inpatient", "outpatient"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "border px-2 py-1 capitalize",
                    type === t
                      ? "border-foreground/30 bg-muted"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
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
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Px</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Fragment key={c.claim_id}>
                  <tr
                    onClick={() => setExpanded(expanded === c.claim_id ? null : c.claim_id)}
                    className={cn(
                      "cursor-pointer border-b border-border hover:bg-muted/60",
                      c.rule_flag && "bg-risk/5",
                    )}
                  >
                    <td className="px-3 py-2 font-mono">
                      {c.claim_id}
                      {c.rule_flag && <span className="ml-2 text-[11px] text-risk">{c.rule_flag}</span>}
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
                    <td className="px-3 py-2 text-right tabular-nums">{c.procedure_codes.length}</td>
                  </tr>
                  {expanded === c.claim_id && (
                    <tr className="border-b border-border bg-muted/40">
                      <td colSpan={8} className="px-3 py-3">
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && !loading && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Widen the date range or switch the claim type to see billing activity.
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

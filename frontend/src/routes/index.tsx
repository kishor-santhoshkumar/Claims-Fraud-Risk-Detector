import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCaseStore, type CaseStatus } from "@/lib/caseStore";
import { type CaseProvider } from "@/lib/caseStore";
import { formatMoneyShort } from "@/lib/mockData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Queue,
});

type Tab = "all" | "unreviewed" | "confirmed" | "cleared";

function TierBadge({ tier }: { tier: CaseProvider["risk_tier"] }) {
  const label = tier === "high" ? "High" : tier === "medium" ? "Medium" : "Low";
  return (
    <span
      className={cn(
        "inline-flex w-[62px] justify-center border px-1.5 py-0.5 text-[11px]",
        tier === "high" && "border-risk/40 text-risk",
        tier === "medium" && "border-border text-foreground",
        tier === "low" && "border-cleared/40 text-cleared",
      )}
    >
      {label}
    </span>
  );
}

function Queue() {
  const navigate = useNavigate();
  const { providers, loading, error, counts, setStatus, reset } = useCaseStore();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(0);
  const rowsRef = useRef<HTMLDivElement>(null);

  const queue = useMemo(
    () => [...providers].sort((a, b) => b.expected_loss - a.expected_loss),
    [providers],
  );

  const visible = useMemo(
    () =>
      queue.filter((p) =>
        tab === "all"
          ? true
          : tab === "unreviewed"
            ? p.status === "unreviewed" || p.status === "needs_info"
            : p.status === tab,
      ),
    [queue, tab],
  );

  const openProvider = (p: CaseProvider) =>
    navigate({
      to: p.risk_tier === "low" ? "/clearance/$providerId" : "/case/$providerId",
      params: { providerId: p.provider_id },
    });

  const decide = (p: CaseProvider, status: CaseStatus) => {
    setStatus(p.provider_id, status);
    toast(`${p.provider_id} ${status === "confirmed" ? "confirmed as fraud" : "cleared"}`, {
      action: { label: "Undo", onClick: () => setStatus(p.provider_id, "unreviewed") },
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const current = visible[selected];
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, visible.length - 1));
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter" && current) {
        openProvider(current);
      } else if ((e.key === "c" || e.key === "C") && current) {
        decide(current, "cleared");
      } else if ((e.key === "f" || e.key === "F") && current) {
        decide(current, "confirmed");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected]);

  useEffect(() => {
    const el = rowsRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const id = search.trim().toUpperCase();
    const p = providers.find((x) => x.provider_id === id);
    if (!p) {
      toast(`No provider matches ${id || "that ID"}`);
      return;
    }
    setSearch("");
    openProvider(p);
  };

  const allReviewed = counts.reviewed >= queue.length && queue.length > 0;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-[14px] text-muted-foreground">Loading queue from backend…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-[14px] text-risk">Failed to load queue: {error}</p>
        <p className="text-[12px] text-muted-foreground">
          Make sure the backend is running: <code>python -m uvicorn api_temp:app --reload</code>
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-[15px] font-medium">
            {queue.length} cases · {counts.reviewed} reviewed · {formatMoneyShort(counts.atRisk)} at risk
          </h1>
          <form onSubmit={submitSearch}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Go to provider ID"
              className="w-56 border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground/40"
            />
          </form>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {(["all", "unreviewed", "confirmed", "cleared"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setSelected(0);
                }}
                className={cn(
                  "border px-2.5 py-1 text-[12px] capitalize",
                  tab === t
                    ? "border-foreground/30 bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                {t === "all" ? "All" : t}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            J / K move · Enter opens · F confirms · C clears
          </p>
        </div>
      </header>

      <div ref={rowsRef} className="flex-1 overflow-y-auto">
        {allReviewed ? (
          <div className="mx-auto max-w-md px-6 py-24 text-center">
            <p className="text-[15px]">
              All {queue.length} cases reviewed. {counts.confirmed} confirmed, {counts.cleared} cleared.
            </p>
            <button
              onClick={reset}
              className="mt-4 border border-border px-3 py-1.5 text-[13px] hover:bg-muted"
            >
              Reset queue
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="mx-auto max-w-md px-6 py-24 text-center text-[14px] text-muted-foreground">
            Switch to All to pick up the next case in the queue.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((p, i) => {
              const reviewed = p.status !== "unreviewed";
              return (
                <div
                  key={p.provider_id}
                  data-idx={i}
                  onClick={() => {
                    setSelected(i);
                    openProvider(p);
                  }}
                  className={cn(
                    "grid cursor-pointer grid-cols-[44px_110px_74px_1fr_120px_110px] items-center gap-3 px-6 py-2.5 text-[13px] hover:bg-muted/60",
                    selected === i && "bg-muted",
                    reviewed && "text-muted-foreground",
                  )}
                >
                  <span className="font-mono text-[12px] text-muted-foreground">{i + 1}</span>
                  <span className="font-mono">{p.provider_id}</span>
                  <TierBadge tier={p.risk_tier} />
                  <span className="truncate text-muted-foreground">{p.state ?? "—"}</span>
                  <span className="text-right font-mono tabular-nums">
                    {formatMoneyShort(p.expected_loss)}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {p.n_claims.toLocaleString()} claims
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

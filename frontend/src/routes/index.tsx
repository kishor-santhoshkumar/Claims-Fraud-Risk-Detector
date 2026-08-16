import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCaseStore, type CaseStatus } from "@/lib/caseStore";
import { type CaseProvider } from "@/lib/caseStore";
import { formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/")({
  component: Queue,
});

type Tab = "all" | "unreviewed" | "confirmed" | "cleared";

function TierBadge({ tier }: { tier: CaseProvider["risk_tier"] }) {
  const label = tier === "high" ? "High" : tier === "medium" ? "Medium" : "Low";
  const styles: Record<string, React.CSSProperties> = {
    high:   { background: "rgba(239,68,68,0.12)",  border: "1px solid rgba(239,68,68,0.3)",  color: "#dc2626" },
    medium: { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#b45309" },
    low:    { background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#059669" },
  };
  return (
    <span style={{ display: "inline-flex", width: 62, justifyContent: "center", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 600, ...styles[tier] }}>
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
        <p className="text-[14px]" style={{ color: "#667088" }}>Loading queue from backend…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-[14px] text-risk">Failed to load queue: {error}</p>
        <p className="text-[12px]" style={{ color: "#667088" }}>
          Make sure the backend is running: <code>python -m uvicorn api_temp:app --reload</code>
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      {/* Glass header */}
      <header style={{ padding: "20px 24px 0", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(228,231,253,0.5) 100%)", borderBottom: "1px solid rgba(255,255,255,0.75)" }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "#161b2e", margin: 0 }}>
            Hey CodeCrafters
          </h1>
          <form onSubmit={submitSearch}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Go to provider ID"
              style={{ width: 224, height: 36, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 8, padding: "0 10px", fontSize: 13, fontFamily: "inherit", color: "#161b2e", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.12)"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(100,116,139,0.22)"; e.target.style.boxShadow = "none"; }}
            />
          </form>
        </div>

        {/* Stat squares */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Total cases",   value: queue.length.toLocaleString(),             accent: "#3b82f6", bg: "rgba(59,130,246,0.10)",  border: "rgba(59,130,246,0.25)" },
            { label: "Reviewed",      value: counts.reviewed.toLocaleString(),           accent: "#6366f1", bg: "rgba(99,102,241,0.10)",  border: "rgba(99,102,241,0.25)" },
            { label: "At risk",       value: formatMoneyShort(counts.atRisk),            accent: "#ef4444", bg: "rgba(239,68,68,0.10)",   border: "rgba(239,68,68,0.25)"  },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "12px 16px", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
              <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#667088", margin: "0 0 4px" }}>{s.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, fontFamily: "ui-monospace, monospace", fontVariantNumeric: "tabular-nums", color: s.accent, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingBottom: 14 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "unreviewed", "confirmed", "cleared"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelected(0); }}
                style={{
                  height: 30, padding: "0 13px", borderRadius: 999,
                  border: tab === t ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(100,116,139,0.22)",
                  background: tab === t ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.5)",
                  color: tab === t ? "#1d4ed8" : "#667088",
                  fontSize: 12, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
                  transition: "background 0.15s, color 0.15s, border-color 0.15s",
                  textTransform: "capitalize",
                }}
              >
                {t === "all" ? "All" : t}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#8791a8" }}>
            J / K move · Enter opens · F confirms · C clears
          </p>
        </div>
      </header>

      {/* Provider list inside glass card */}
      <div ref={rowsRef} style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
        {allReviewed ? (
          <div style={{ maxWidth: 480, margin: "96px auto 0", textAlign: "center" }} className="glass-panel">
            <p style={{ fontSize: 15, color: "#232a41", marginBottom: 16 }}>
              All {queue.length} cases reviewed. {counts.confirmed} confirmed, {counts.cleared} cleared.
            </p>
            <button
              onClick={reset}
              style={{ height: 36, padding: "0 16px", borderRadius: 8, border: "1px solid rgba(100,116,139,0.22)", background: "rgba(255,255,255,0.6)", color: "#47516b", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
            >
              Reset queue
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div style={{ maxWidth: 480, margin: "96px auto 0", textAlign: "center", fontSize: 14, color: "#667088" }}>
            Switch to All to pick up the next case in the queue.
          </div>
        ) : (
          <div className="glass-card" style={{ overflow: "hidden" }}>
            {visible.map((p, i) => {
              const reviewed = p.status !== "unreviewed";
              return (
                <div
                  key={p.provider_id}
                  data-idx={i}
                  onClick={() => { setSelected(i); openProvider(p); }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 110px 74px 1fr 120px 110px",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    fontSize: 13,
                    cursor: "pointer",
                    borderBottom: "1px solid rgba(30,41,59,0.06)",
                    background: selected === i ? "rgba(59,130,246,0.08)" : "transparent",
                    color: reviewed ? "#8791a8" : "#232a41",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { if (selected !== i) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.4)"; }}
                  onMouseLeave={(e) => { if (selected !== i) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                >
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "#8791a8" }}>{i + 1}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace" }}>{p.provider_id}</span>
                  <TierBadge tier={p.risk_tier} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8791a8" }}>{p.state ?? "—"}</span>
                  <span style={{ textAlign: "right", fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums" }}>
                    {formatMoneyShort(p.expected_loss)}
                  </span>
                  <span style={{ textAlign: "right", color: "#8791a8", fontVariantNumeric: "tabular-nums" }}>
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

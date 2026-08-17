import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCaseStore, type CaseProvider, type CaseStatus } from "@/lib/caseStore";
import { formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/queue")({
  component: QueuePage,
});

type FilterTab = "flagged" | "high" | "medium" | "all";
type GroupBy = "none" | "risk" | "state" | "reimbursed";
type SortDir = "desc" | "asc";

function TierBadge({ tier }: { tier: CaseProvider["risk_tier"] }) {
  const map = {
    high:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  color: "#dc2626", label: "High" },
    medium: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#b45309", label: "Medium" },
    low:    { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.3)", color: "#059669", label: "Low" },
  }[tier];
  return (
    <span style={{ display: "inline-flex", justifyContent: "center", minWidth: 62, borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 600, background: map.bg, border: `1px solid ${map.border}`, color: map.color }}>
      {map.label}
    </span>
  );
}

function reimbursedLabel(n: number): string {
  if (n >= 1_000_000) return "≥ $1M";
  if (n >= 500_000) return "$500K – $1M";
  if (n >= 100_000) return "$100K – $500K";
  return "< $100K";
}

const REIMBURSED_ORDER: Record<string, number> = {
  "≥ $1M": 0, "$500K – $1M": 1, "$100K – $500K": 2, "< $100K": 3,
};
const REIMBURSED_ACCENT: Record<string, string> = {
  "≥ $1M": "#ef4444", "$500K – $1M": "#f59e0b", "$100K – $500K": "#6366f1", "< $100K": "#10b981",
};

interface Section {
  key: string;
  title: string;
  accent: string;
  providers: CaseProvider[];
}

function buildSections(providers: CaseProvider[], groupBy: GroupBy, sortDir: SortDir): Section[] {
  const flip = sortDir === "asc";

  if (groupBy === "none") {
    return [{ key: "all", title: "All", accent: "#3b82f6", providers }];
  }
  if (groupBy === "risk") {
    const tiers: Array<[CaseProvider["risk_tier"], string, string]> = [
      ["high", "High Risk", "#ef4444"],
      ["medium", "Medium Risk", "#f59e0b"],
      ["low", "Low Risk", "#10b981"],
    ];
    const ordered = flip ? [...tiers].reverse() : tiers;
    return ordered
      .map(([tier, title, accent]) => ({ key: tier, title, accent, providers: providers.filter(p => p.risk_tier === tier) }))
      .filter(s => s.providers.length > 0);
  }
  if (groupBy === "state") {
    const map = new Map<string, CaseProvider[]>();
    for (const p of providers) {
      const s = p.state ?? "Unknown";
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => flip ? a[0].localeCompare(b[0]) : b[1].length - a[1].length)
      .map(([state, ps]) => ({ key: state, title: state, accent: "#3b82f6", providers: ps }));
  }
  if (groupBy === "reimbursed") {
    const map = new Map<string, CaseProvider[]>();
    for (const p of providers) {
      const lbl = reimbursedLabel(p.total_reimbursed);
      if (!map.has(lbl)) map.set(lbl, []);
      map.get(lbl)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const diff = REIMBURSED_ORDER[a[0]]! - REIMBURSED_ORDER[b[0]]!;
        return flip ? -diff : diff;
      })
      .map(([lbl, ps]) => ({ key: lbl, title: lbl, accent: REIMBURSED_ACCENT[lbl] ?? "#3b82f6", providers: ps }));
  }
  return [];
}

const PAGE = 100;

function QueuePage() {
  const navigate = useNavigate();
  const { providers, loading, error, setStatus } = useCaseStore();
  const [filterTab, setFilterTab] = useState<FilterTab>("flagged");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchInput, setSearchInput] = useState("");
  const [searchResult, setSearchResult] = useState<CaseProvider | null>(null);
  const [pageLimits, setPageLimits] = useState<Record<string, number>>({});

  useEffect(() => { setPageLimits({}); }, [filterTab, groupBy, sortDir]);

  const sorted = useMemo(
    () => [...providers].sort((a, b) => sortDir === "desc" ? b.expected_loss - a.expected_loss : a.expected_loss - b.expected_loss),
    [providers, sortDir]
  );

  const filtered = useMemo(() => {
    if (filterTab === "flagged") return sorted.filter(p => p.risk_tier !== "low");
    if (filterTab === "high") return sorted.filter(p => p.risk_tier === "high");
    if (filterTab === "medium") return sorted.filter(p => p.risk_tier === "medium");
    return sorted;
  }, [sorted, filterTab]);

  const sections = useMemo(() => buildSections(filtered, groupBy, sortDir), [filtered, groupBy, sortDir]);

  const counts = useMemo(() => ({
    flagged: sorted.filter(p => p.risk_tier !== "low").length,
    high: sorted.filter(p => p.risk_tier === "high").length,
    medium: sorted.filter(p => p.risk_tier === "medium").length,
    all: sorted.length,
  }), [sorted]);

  const decide = (p: CaseProvider, status: CaseStatus) => {
    setStatus(p.provider_id, status);
    toast(`${p.provider_id} ${status === "confirmed" ? "confirmed as fraud" : "cleared"}`, {
      action: { label: "Undo", onClick: () => setStatus(p.provider_id, "unreviewed") },
    });
  };

  const openProvider = (p: CaseProvider) => {
    navigate({
      to: p.risk_tier === "low" ? "/clearance/$providerId" : "/case/$providerId",
      params: { providerId: p.provider_id },
    });
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const id = searchInput.trim().toUpperCase();
    if (!id) return;
    const found = providers.find(p => p.provider_id === id);
    if (!found) {
      toast(`No provider matches "${id}"`);
      return;
    }
    setSearchResult(found);
    setSearchInput("");
  };

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100svh", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 14, color: "#667088" }}>Loading queue…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", height: "100svh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <p style={{ fontSize: 14, color: "#dc2626" }}>Failed to load: {error}</p>
        <p style={{ fontSize: 12, color: "#667088" }}>Make sure the backend is running: <code>python -m uvicorn api_temp:app --reload</code></p>
      </div>
    );
  }

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "flagged", label: "High + Medium", count: counts.flagged },
    { id: "high",    label: "High Only",     count: counts.high },
    { id: "medium",  label: "Medium Only",   count: counts.medium },
    { id: "all",     label: "All Providers", count: counts.all },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      {/* Header */}
      <header style={{ padding: "20px 24px 0", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(228,231,253,0.5) 100%)", borderBottom: "1px solid rgba(255,255,255,0.75)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: "#161b2e", margin: 0 }}>Review Queue</h1>
            <p style={{ fontSize: 12, color: "#8791a8", margin: "2px 0 0" }}>
              {filtered.length.toLocaleString()} providers · sorted by expected loss
            </p>
          </div>
          <form onSubmit={submitSearch} style={{ display: "flex", gap: 8 }}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by provider ID"
              style={{ width: 220, height: 36, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(100,116,139,0.22)", borderRadius: 8, padding: "0 10px", fontSize: 13, fontFamily: "inherit", color: "#161b2e", outline: "none", transition: "border-color 0.2s, box-shadow 0.2s" }}
              onFocus={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.12)"; }}
              onBlur={(e) => { e.target.style.borderColor = "rgba(100,116,139,0.22)"; e.target.style.boxShadow = "none"; }}
            />
            <button type="submit" style={{ height: 36, padding: "0 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              Find
            </button>
          </form>
        </div>

        {/* Filter tabs + group by */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingBottom: 14 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {filterTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setFilterTab(t.id)}
                style={{
                  height: 30, padding: "0 12px", borderRadius: 999,
                  border: filterTab === t.id ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(100,116,139,0.22)",
                  background: filterTab === t.id ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.5)",
                  color: filterTab === t.id ? "#1d4ed8" : "#667088",
                  fontSize: 12, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {t.label}&nbsp;<span style={{ opacity: 0.65 }}>({t.count.toLocaleString()})</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#8791a8" }}>Group by</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              style={{ height: 30, padding: "0 8px", borderRadius: 8, border: "1px solid rgba(100,116,139,0.22)", background: "rgba(255,255,255,0.7)", color: "#232a41", fontSize: 12, fontFamily: "inherit", cursor: "pointer", outline: "none" }}
            >
              <option value="none">None</option>
              <option value="risk">Risk Tier</option>
              <option value="state">State</option>
              <option value="reimbursed">Total Reimbursed</option>
            </select>
            <button
              onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
              title={sortDir === "desc" ? "Descending — click to switch to ascending" : "Ascending — click to switch to descending"}
              style={{
                height: 30, padding: "0 10px", borderRadius: 8,
                border: "1px solid rgba(100,116,139,0.22)",
                background: "rgba(255,255,255,0.7)",
                color: "#232a41", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
                transition: "background 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = "rgba(59,130,246,0.1)"; b.style.borderColor = "rgba(59,130,246,0.35)"; b.style.color = "#1d4ed8"; }}
              onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = "rgba(255,255,255,0.7)"; b.style.borderColor = "rgba(100,116,139,0.22)"; b.style.color = "#232a41"; }}
            >
              {sortDir === "desc" ? "↓" : "↑"}
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.03em" }}>{sortDir === "desc" ? "Desc" : "Asc"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 32px" }}>
        {/* Search result banner */}
        {searchResult && (
          <div style={{ marginBottom: 20, background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.28)", borderRadius: 14, padding: "14px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Search result
              </span>
              <button
                onClick={() => setSearchResult(null)}
                style={{ fontSize: 12, color: "#8791a8", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                Dismiss ×
              </button>
            </div>
            <div
              onClick={() => openProvider(searchResult)}
              style={{ display: "grid", gridTemplateColumns: "110px 70px 1fr 90px 110px 100px", alignItems: "center", gap: 12, cursor: "pointer", padding: "8px 4px", borderRadius: 8, transition: "background 0.1s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, fontWeight: 600, color: "#232a41" }}>{searchResult.provider_id}</span>
              <TierBadge tier={searchResult.risk_tier} />
              <span style={{ fontSize: 13, color: "#667088" }}>{searchResult.state ?? "—"}</span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, color: "#232a41" }}>{searchResult.score.toFixed(4)}</span>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, color: "#232a41", textAlign: "right" }}>{formatMoneyShort(searchResult.expected_loss)}</span>
              <span style={{ fontSize: 13, color: "#8791a8", textAlign: "right" }}>{searchResult.n_claims.toLocaleString()} claims</span>
            </div>
          </div>
        )}

        {/* Sections */}
        {sections.map((section) => {
          if (section.providers.length === 0) return null;
          const limit = pageLimits[section.key] ?? PAGE;
          const visible = section.providers.slice(0, limit);
          const remaining = section.providers.length - limit;

          return (
            <div key={section.key} style={{ marginBottom: 28 }}>
              {groupBy !== "none" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 3, height: 16, borderRadius: 2, background: section.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#232a41" }}>{section.title}</span>
                  <span style={{ fontSize: 12, color: "#8791a8" }}>({section.providers.length.toLocaleString()} providers)</span>
                </div>
              )}

              <div className="glass-card" style={{ overflow: "hidden" }}>
                {/* Column headers */}
                <div style={{ display: "grid", gridTemplateColumns: "40px 110px 70px 1fr 90px 110px 100px", gap: 10, padding: "7px 16px", background: "rgba(248,250,255,0.5)", borderBottom: "1px solid rgba(30,41,59,0.07)" }}>
                  {["#", "Provider ID", "Tier", "State", "Score", "Exp. Loss", "Claims"].map(h => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8791a8" }}>{h}</span>
                  ))}
                </div>

                {visible.map((p, i) => (
                  <div
                    key={p.provider_id}
                    onClick={() => openProvider(p)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 110px 70px 1fr 90px 110px 100px",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 16px",
                      fontSize: 13,
                      cursor: "pointer",
                      borderBottom: "1px solid rgba(30,41,59,0.05)",
                      color: p.status !== "unreviewed" ? "#8791a8" : "#232a41",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.05)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                  >
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8791a8" }}>{i + 1}</span>
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>{p.provider_id}</span>
                    <TierBadge tier={p.risk_tier} />
                    <span style={{ color: "#8791a8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.state ?? "—"}</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums" }}>{p.score.toFixed(4)}</span>
                    <span style={{ fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{formatMoneyShort(p.expected_loss)}</span>
                    <span style={{ color: "#8791a8", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.n_claims.toLocaleString()}</span>
                  </div>
                ))}

                {remaining > 0 && (
                  <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(30,41,59,0.06)", background: "rgba(248,250,255,0.4)" }}>
                    <button
                      onClick={() => setPageLimits(prev => ({ ...prev, [section.key]: (prev[section.key] ?? PAGE) + PAGE }))}
                      style={{ fontSize: 13, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                    >
                      Show {Math.min(PAGE, remaining).toLocaleString()} more
                      <span style={{ color: "#8791a8" }}> · {remaining.toLocaleString()} remaining</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

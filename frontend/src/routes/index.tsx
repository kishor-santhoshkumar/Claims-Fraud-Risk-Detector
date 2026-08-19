import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, Banknote, CheckCircle2, DollarSign, FileText, LayoutDashboard, Shield, TrendingUp, Users } from "lucide-react";
import { useCaseStore } from "@/lib/caseStore";
import { useBatch } from "@/lib/batchContext";
import { formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const RECENT_TIMES = ["47 min ago", "1 hr 12 min ago", "2 hr 38 min ago"];

function TierBadge({ tier }: { tier: "high" | "medium" | "low" }) {
  const map = {
    high:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  color: "#dc2626", label: "High" },
    medium: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", color: "#b45309", label: "Medium" },
    low:    { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.3)", color: "#059669", label: "Low" },
  }[tier];
  return (
    <span style={{ display: "inline-flex", justifyContent: "center", minWidth: 60, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600, background: map.bg, border: `1px solid ${map.border}`, color: map.color }}>
      {map.label}
    </span>
  );
}

type Provider = ReturnType<typeof useCaseStore>["providers"][number];

function RightPanel({ recentActivity, navigate }: { recentActivity: Provider[]; navigate: ReturnType<typeof useNavigate> }) {
  const [tab, setTab] = useState<"activity" | "actions">("activity");

  const tabs = [
    { id: "activity" as const, label: "Recent Activity" },
    { id: "actions"  as const, label: "Quick Actions"  },
  ];

  return (
    <div style={{
      background: "linear-gradient(160deg, rgba(255,255,255,0.84) 0%, rgba(224,231,255,0.66) 100%)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.82)",
      borderRadius: 18,
      boxShadow: "0 8px 32px rgba(59,130,246,0.08)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(30,41,59,0.07)", padding: "0 4px" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                height: 44,
                fontSize: 12.5,
                fontWeight: active ? 700 : 500,
                fontFamily: "inherit",
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: active ? "#2563eb" : "var(--text-muted)",
                borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
                transition: "color 0.15s, border-color 0.15s",
                letterSpacing: "0.005em",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {tab === "activity" && (
          <>
            <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "0 0 4px", letterSpacing: "0.01em" }}>Newly flagged high-risk providers</p>
            {recentActivity.map((p, i) => (
              <div
                key={p.provider_id}
                onClick={() => navigate({ to: "/case/$providerId", params: { providerId: p.provider_id } })}
                style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.84) 0%, rgba(254,226,226,0.52) 100%)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 14, padding: "14px 16px", cursor: "pointer", transition: "box-shadow 0.2s, transform 0.2s" }}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = "0 8px 28px rgba(239,68,68,0.14)"; el.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = ""; el.style.transform = ""; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 0 2px rgba(239,68,68,0.2)" }} />
                    <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{p.provider_id}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{RECENT_TIMES[i]}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <TierBadge tier={p.risk_tier} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.state ?? "—"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "6px 10px" }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 2px" }}>Expected loss</p>
                    <p style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: "#dc2626", margin: 0 }}>{formatMoneyShort(p.expected_loss)}</p>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "6px 10px" }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 2px" }}>Score</p>
                    <p style={{ fontSize: 14, fontWeight: 700, fontFamily: "ui-monospace,monospace", color: "var(--text-secondary)", margin: 0 }}>{p.score.toFixed(4)}</p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "actions" && (
          <>
            <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "0 0 4px", letterSpacing: "0.01em" }}>Navigate to key sections</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Open Review Queue", to: "/queue",      desc: "Triage flagged providers" },
                { label: "Case Assistant",    to: "/assistant",  desc: "AI-powered investigation" },
                { label: "Run Simulation",    to: "/simulation", desc: "Replay fraud scenarios" },
              ].map((a) => (
                <button
                  key={a.to}
                  onClick={() => navigate({ to: a.to as "/" })}
                  style={{ width: "100%", borderRadius: 11, border: "1px solid rgba(99,102,241,0.2)", background: "rgba(255,255,255,0.65)", color: "#1e1b4b", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: "10px 14px", transition: "background 0.15s, border-color 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(255,255,255,0.92)"; b.style.borderColor = "rgba(99,102,241,0.35)"; }}
                  onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(255,255,255,0.65)"; b.style.borderColor = "rgba(99,102,241,0.2)"; }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#3730a3" }}>{a.label} →</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-faint)" }}>{a.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const { providers, loading, error, counts } = useCaseStore();
  const { activeBatchMeta } = useBatch();
  const hasLabels = activeBatchMeta?.has_labels !== false;

  const stats = useMemo(() => {
    const high   = providers.filter(p => p.risk_tier === "high");
    const medium = providers.filter(p => p.risk_tier === "medium");
    const low    = providers.filter(p => p.risk_tier === "low");
    const flagged = [...high, ...medium];
    return {
      total:            providers.length,
      flagged:          flagged.length,
      highRisk:         high.length,
      mediumRisk:       medium.length,
      lowRisk:          low.length,
      totalClaims:      providers.reduce((s, p) => s + p.n_claims, 0),
      highClaims:       high.reduce((s, p) => s + p.n_claims, 0),
      mediumClaims:     medium.reduce((s, p) => s + p.n_claims, 0),
      lowClaims:        low.reduce((s, p) => s + p.n_claims, 0),
      totalAmount:      providers.reduce((s, p) => s + p.total_reimbursed, 0),
      suspiciousAmount: flagged.reduce((s, p) => s + p.total_reimbursed, 0),
      dollarsAtRisk:    flagged.reduce((s, p) => s + p.expected_loss, 0),
    };
  }, [providers]);

  const top10 = useMemo(
    () => [...providers].filter(p => p.risk_tier === "high").sort((a, b) => b.score - a.score).slice(0, 10),
    [providers]
  );

  const recentActivity = useMemo(() => {
    const sorted = [...providers]
      .filter(p => p.risk_tier === "high")
      .sort((a, b) => b.expected_loss - a.expected_loss);
    return [sorted[2], sorted[5], sorted[9]].filter(Boolean) as typeof providers;
  }, [providers]);

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100svh", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", height: "100svh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <p style={{ fontSize: 14, color: "#dc2626" }}>Failed to load: {error}</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Make sure the backend is running: <code>python -m uvicorn api_temp:app --reload</code></p>
      </div>
    );
  }

  const detectionRate = stats.flagged > 0
    ? ((counts.confirmed / stats.flagged) * 100).toFixed(1)
    : "0.0";

  const claimCards = [
    { label: "Total Claims",        value: stats.totalClaims.toLocaleString(),   icon: FileText,     accent: "#3b82f6", bg: "rgba(59,130,246,0.09)",  border: "rgba(59,130,246,0.22)",  desc: "Across all providers" },
    { label: "High Risk Claims",    value: stats.highClaims.toLocaleString(),    icon: AlertTriangle,accent: "#ef4444", bg: "rgba(239,68,68,0.09)",   border: "rgba(239,68,68,0.22)",   desc: "From high-risk providers" },
    { label: "Medium Risk Claims",  value: stats.mediumClaims.toLocaleString(),  icon: AlertCircle,  accent: "#f59e0b", bg: "rgba(245,158,11,0.09)",  border: "rgba(245,158,11,0.22)",  desc: "From medium-risk providers" },
    { label: "Low Risk Claims",     value: stats.lowClaims.toLocaleString(),     icon: CheckCircle2, accent: "#10b981", bg: "rgba(16,185,129,0.09)",  border: "rgba(16,185,129,0.22)",  desc: "From low-risk providers" },
  ];

  const riskCards = [
    hasLabels
      ? { label: "Fraud Detection Rate", value: `${detectionRate}%`, icon: TrendingUp, accent: "#6366f1", bg: "rgba(99,102,241,0.09)", border: "rgba(99,102,241,0.22)", desc: `${counts.confirmed} confirmed of ${stats.flagged} flagged` }
      : { label: "Fraud Detection Rate", value: "N/A", icon: TrendingUp, accent: "#9ca3af", bg: "rgba(156,163,175,0.07)", border: "rgba(156,163,175,0.18)", desc: "Ground truth not available for uploaded data" },
    { label: "Total Claim Amount",      value: formatMoneyShort(stats.totalAmount),      icon: DollarSign,   accent: "#3b82f6", bg: "rgba(59,130,246,0.09)",  border: "rgba(59,130,246,0.22)",  desc: "Total reimbursed, all providers" },
    { label: "Suspicious Claim Amount", value: formatMoneyShort(stats.suspiciousAmount), icon: Banknote,     accent: "#f59e0b", bg: "rgba(245,158,11,0.09)",  border: "rgba(245,158,11,0.22)",  desc: "Reimbursed from flagged providers" },
    { label: "High Risk Providers",     value: stats.highRisk.toLocaleString(),          icon: Shield,       accent: "#ef4444", bg: "rgba(239,68,68,0.09)",   border: "rgba(239,68,68,0.22)",   desc: "Score ≥ 0.50" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
      {/* Dashboard navbar */}
      <header style={{
        flexShrink: 0,
        background: "linear-gradient(160deg, rgba(255,255,255,0.72) 0%, rgba(214,225,255,0.58) 100%)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        borderBottom: "1px solid rgba(99,102,241,0.13)",
        boxShadow: "0 2px 16px rgba(99,102,241,0.07)",
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 80,
        position: "relative",
        zIndex: 10,
      }}>
        {/* Left — page identity */}
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(59,130,246,0.12) 100%)", border: "1px solid rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LayoutDashboard size={18} color="#4f46e5" strokeWidth={1.75} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>Dashboard</p>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.01em", lineHeight: 1.4 }}>Overview</p>
          </div>
        </div>

        {/* Right — model badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(99,102,241,0.16)", borderRadius: 12, padding: "8px 16px", backdropFilter: "blur(12px)" }}>
          <Shield size={13} color="#6366f1" strokeWidth={2} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.005em" }}>Medicare Provider Fraud Risk Model</span>
          <span style={{ width: 1, height: 14, background: "rgba(100,116,139,0.25)", display: "inline-block", margin: "0 4px" }} />
          <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)" }}>v1.0</span>
          <span style={{ fontSize: 10.5, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.22)", borderRadius: 6, padding: "2px 8px", color: "#4f46e5", fontWeight: 700, letterSpacing: "0.04em" }}>31 features</span>
        </div>
      </header>

      {/* Body */}
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 56px", display: "flex", flexDirection: "column", gap: 24, boxSizing: "border-box" }}>

      {/* Claims row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {claimCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 16, padding: "18px 20px", backdropFilter: "blur(14px) saturate(160%)", WebkitBackdropFilter: "blur(14px) saturate(160%)", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-faint)", margin: 0 }}>{s.label}</p>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: s.bg, border: `1px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={14} style={{ color: s.accent }} />
                </div>
              </div>
              <p style={{ fontSize: 26, fontWeight: 700, fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums", color: s.accent, margin: "0 0 4px" }}>{s.value}</p>
              <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>{s.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Risk / money row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {riskCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 16, padding: "18px 20px", backdropFilter: "blur(14px) saturate(160%)", WebkitBackdropFilter: "blur(14px) saturate(160%)", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-faint)", margin: 0 }}>{s.label}</p>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: s.bg, border: `1px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={14} style={{ color: s.accent }} />
                </div>
              </div>
              <p style={{ fontSize: 26, fontWeight: 700, fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums", color: s.accent, margin: "0 0 4px" }}>{s.value}</p>
              <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0 }}>{s.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Main content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, alignItems: "start" }}>
        {/* Top 10 table */}
        <div style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.84) 0%, rgba(224,231,255,0.66) 100%)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", border: "1px solid rgba(255,255,255,0.82)", borderRadius: 18, boxShadow: "0 8px 32px rgba(59,130,246,0.08)", overflow: "hidden" }}>
          <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid rgba(30,41,59,0.07)" }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Top 10 Highest Risk Providers</h2>
            <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "3px 0 0" }}>Ranked by fraud probability score</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "30px 110px 68px 80px 1fr 115px", gap: 12, padding: "8px 22px", background: "rgba(248,250,255,0.6)" }}>
            {([["#","left"],["Provider","left"],["Tier","left"],["Score","left"],["State","left"],["Exp. Loss","right"]] as [string,string][]).map(([h, align]) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", textAlign: align as "left"|"right" }}>{h}</span>
            ))}
          </div>
          {top10.map((p, i) => (
            <div
              key={p.provider_id}
              onClick={() => navigate({ to: "/case/$providerId", params: { providerId: p.provider_id } })}
              style={{ display: "grid", gridTemplateColumns: "30px 110px 68px 80px 1fr 115px", gap: 12, padding: "11px 22px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid rgba(30,41,59,0.05)", transition: "background 0.1s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.06)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 12, color: i < 3 ? "#ef4444" : "var(--text-faint)", fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</span>
              <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--text-secondary)" }}>{p.provider_id}</span>
              <TierBadge tier={p.risk_tier} />
              <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--text-secondary)" }}>{p.score.toFixed(4)}</span>
              <span style={{ color: "var(--text-faint)" }}>{p.state ?? "—"}</span>
              <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--text-secondary)", textAlign: "right" }}>{formatMoneyShort(p.expected_loss)}</span>
            </div>
          ))}
          <div style={{ padding: "13px 22px" }}>
            <button
              onClick={() => navigate({ to: "/queue" })}
              style={{ fontSize: 13, color: "#3b82f6", fontWeight: 500, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
            >
              View full review queue →
            </button>
          </div>
        </div>

        {/* Right column — tabbed panel */}
        <RightPanel recentActivity={recentActivity} navigate={navigate} />
      </div>
    </div>
    </div>
  );
}

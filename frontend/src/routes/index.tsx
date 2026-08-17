import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, DollarSign, Shield, Users } from "lucide-react";
import { useCaseStore } from "@/lib/caseStore";
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

function Dashboard() {
  const navigate = useNavigate();
  const { providers, loading, error } = useCaseStore();

  const stats = useMemo(() => {
    const high = providers.filter(p => p.risk_tier === "high");
    const flagged = providers.filter(p => p.risk_tier !== "low");
    return {
      total: providers.length,
      flagged: flagged.length,
      highRisk: high.length,
      dollarsAtRisk: flagged.reduce((s, p) => s + p.expected_loss, 0),
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

  const statCards = [
    {
      label: "Providers Scored",
      value: stats.total.toLocaleString(),
      icon: Users,
      accent: "#3b82f6",
      bg: "rgba(59,130,246,0.09)",
      border: "rgba(59,130,246,0.22)",
      desc: "Total in scoring pipeline",
    },
    {
      label: "Flagged for Review",
      value: stats.flagged.toLocaleString(),
      icon: AlertTriangle,
      accent: "#f59e0b",
      bg: "rgba(245,158,11,0.09)",
      border: "rgba(245,158,11,0.22)",
      desc: "High + medium risk tier",
    },
    {
      label: "High Risk",
      value: stats.highRisk.toLocaleString(),
      icon: Shield,
      accent: "#ef4444",
      bg: "rgba(239,68,68,0.09)",
      border: "rgba(239,68,68,0.22)",
      desc: "Score ≥ 0.50",
    },
    {
      label: "Dollars at Risk",
      value: formatMoneyShort(stats.dollarsAtRisk),
      icon: DollarSign,
      accent: "#6366f1",
      bg: "rgba(99,102,241,0.09)",
      border: "rgba(99,102,241,0.22)",
      desc: "Expected loss, flagged cases",
    },
  ];

  return (
    <div style={{ padding: "28px 28px 56px", display: "flex", flexDirection: "column", gap: 28, overflowY: "auto", height: "100svh", boxSizing: "border-box" }}>
      {/* Page header */}
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.02em" }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", margin: "5px 0 0" }}>Medicare provider fraud risk · Model v1.0 · 31 features</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderRadius: 18,
                padding: "20px 22px",
                backdropFilter: "blur(14px) saturate(160%)",
                WebkitBackdropFilter: "blur(14px) saturate(160%)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-faint)", margin: 0 }}>{s.label}</p>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: s.bg, border: `1px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={16} style={{ color: s.accent }} />
                </div>
              </div>
              <p style={{ fontSize: 30, fontWeight: 700, fontFamily: "ui-monospace, monospace", fontVariantNumeric: "tabular-nums", color: s.accent, margin: "0 0 5px" }}>{s.value}</p>
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
            {["#", "Provider", "Tier", "Score", "State", "Exp. Loss"].map((h) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)" }}>{h}</span>
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

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Recent activity header */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Recent High Risk Activity</h2>
            <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "3px 0 0" }}>Newly flagged providers</p>
          </div>

          {/* Recent activity cards */}
          {recentActivity.map((p, i) => (
            <div
              key={p.provider_id}
              onClick={() => navigate({ to: "/case/$providerId", params: { providerId: p.provider_id } })}
              style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.84) 0%, rgba(254,226,226,0.52) 100%)",
                backdropFilter: "blur(16px) saturate(180%)",
                WebkitBackdropFilter: "blur(16px) saturate(180%)",
                border: "1px solid rgba(239,68,68,0.18)",
                borderRadius: 16,
                padding: "16px 18px",
                cursor: "pointer",
                transition: "box-shadow 0.2s, transform 0.2s",
              }}
              onMouseEnter={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = "0 8px 28px rgba(239,68,68,0.14)"; el.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = ""; el.style.transform = ""; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 9 }}>
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

          {/* Quick actions */}
          <div style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(59,130,246,0.1) 100%)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(99,102,241,0.22)", borderRadius: 16, padding: "16px 18px" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#4338ca", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.09em" }}>Quick actions</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "Open Review Queue", to: "/queue" },
                { label: "Case Assistant",    to: "/assistant" },
                { label: "Run Simulation",    to: "/simulation" },
              ].map((a) => (
                <button
                  key={a.to}
                  onClick={() => navigate({ to: a.to as "/" })}
                  style={{ width: "100%", height: 34, borderRadius: 9, border: "1px solid rgba(99,102,241,0.22)", background: "rgba(255,255,255,0.65)", color: "#4338ca", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: "0 12px", transition: "background 0.15s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.9)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.65)"; }}
                >
                  {a.label} →
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

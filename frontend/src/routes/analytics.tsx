import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PieChart,
  Pie,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useCaseStore } from "@/lib/caseStore";
import { fetchFingerprint, type FingerprintResponse } from "@/lib/api";
import { formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
});

const HIGH   = "#ef4444";
const MEDIUM = "#f59e0b";
const LOW    = "#10b981";
const VIOLET = "#8b5cf6";
const AMBER  = "#f59e0b";
const GRID   = "#e5e7eb";
const AXIS   = { stroke: "#9ca3af", fontSize: 11, tickLine: false } as const;

const BAR_PALETTE = [
  "#3b82f6","#06b6d4","#8b5cf6","#ec4899","#f59e0b","#10b981",
  "#f97316","#14b8a6","#a855f7","#ef4444","#84cc16","#0ea5e9",
];

const RADAR_LABELS: Record<string, string> = {
  bene_shared:    "Bene Shared",
  mean_claim:     "Mean Claim",
  unique_diag:    "Unique Diag",
  avg_length:     "Avg Length",
  deductible:     "Deductible",
  inpatient_share:"Inpatient Share",
};
const RADAR_KEYS = Object.keys(RADAR_LABELS);

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass-panel ${className}`}>
      <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {title}
      </h2>
      <div className="h-64">{children}</div>
    </section>
  );
}

function Analytics() {
  const { providers, counts } = useCaseStore();
  const [fingerprint, setFingerprint] = useState<FingerprintResponse | null>(null);

  useEffect(() => {
    fetchFingerprint().then(setFingerprint).catch(() => {});
  }, []);

  const tiers = useMemo(
    () =>
      (["high", "medium", "low"] as const).map((t) => ({
        name: t[0]!.toUpperCase() + t.slice(1),
        value: providers.filter((p) => p.risk_tier === t).length,
      })),
    [providers],
  );

  const months = useMemo(() => {
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return names.map((m, i) => ({
      month: m,
      claims: Math.round(38000 + Math.sin(i / 1.7) * 8000 + i * 900),
    }));
  }, []);

  const states = useMemo(() => {
    const acc = new Map<string, number>();
    providers.forEach((p) => {
      if (p.state) acc.set(p.state, (acc.get(p.state) ?? 0) + 1);
    });
    return [...acc.entries()]
      .map(([state, n]) => ({ state, providers: n }))
      .sort((a, b) => b.providers - a.providers)
      .slice(0, 12);
  }, [providers]);

  const capture = useMemo(() => {
    const sorted = [...providers].sort((a, b) => b.expected_loss - a.expected_loss);
    const totalLoss = sorted.reduce((s, p) => s + p.expected_loss, 0);
    let run = 0;
    return sorted.map((p, i) => {
      run += p.expected_loss;
      return { size: i + 1, captured: Number(((run / totalLoss) * 100).toFixed(1)) };
    });
  }, [providers]);

  // Score vs Expected Loss — split by tier for coloring
  const scatterHigh   = useMemo(() => providers.filter(p => p.risk_tier === "high").map(p => ({ x: p.score, y: p.expected_loss })), [providers]);
  const scatterMedium = useMemo(() => providers.filter(p => p.risk_tier === "medium").map(p => ({ x: p.score, y: p.expected_loss })), [providers]);
  const scatterLow    = useMemo(() => providers.filter(p => p.risk_tier === "low").map(p => ({ x: p.score, y: p.expected_loss })), [providers]);

  // Radar data: one row per axis, values for high and low tiers
  const radarData = useMemo(() => {
    if (!fingerprint) return [];
    return RADAR_KEYS.map((key) => ({
      subject: RADAR_LABELS[key],
      high:    fingerprint.high[key as keyof typeof fingerprint.high] ?? 0,
      low:     fingerprint.low[key as keyof typeof fingerprint.low] ?? 0,
    }));
  }, [fingerprint]);

  const flagged = providers.filter((p) => p.risk_tier !== "low").length;
  const dollarsAtRisk = providers.reduce((s, p) => s + p.expected_loss, 0);

  const metrics = [
    { label: "Providers scored",   value: providers.length.toLocaleString(), color: "border-l-blue-500" },
    { label: "Flagged for review",  value: flagged.toLocaleString(),          color: "border-l-amber-500" },
    { label: "Confirmed fraud",    value: counts.confirmed.toLocaleString(), color: "border-l-red-500" },
    { label: "Dollars at risk",    value: formatMoneyShort(dollarsAtRisk),   color: "border-l-violet-500" },
  ];

  return (
    <div className="px-6 pb-16">
      <header className="py-6">
        <h1 className="text-[22px] font-semibold" style={{ color: "var(--text-primary)" }}>Analytics</h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>Model coverage and review outcomes.</p>
      </header>

      {/* KPI tiles */}
      <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className={`glass-card p-4 border-l-4 ${m.color}`}>
            <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{m.label}</p>
            <p className="mt-1 font-mono text-[22px] tabular-nums" style={{ color: "var(--text-primary)" }}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Pie — risk tier */}
        <Panel title="Risk tier distribution">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={tiers} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={3} stroke="none">
                {tiers.map((_, i) => <Cell key={i} fill={[HIGH, MEDIUM, LOW][i]} />)}
              </Pie>
              <Tooltip formatter={(v: number, name: string) => [v.toLocaleString(), name]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>

        {/* Bar — providers by state */}
        <Panel title="Providers by state">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={states} margin={{ bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={GRID} strokeWidth={0.8} />
              <XAxis dataKey="state" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip cursor={{ fill: "#f3f4f6" }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="providers" barSize={16} radius={[3, 3, 0, 0]}>
                {states.map((_, i) => <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Scatter — score vs expected loss */}
        <Panel title="Score vs expected loss">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={GRID} strokeWidth={0.8} />
              <XAxis
                dataKey="x"
                type="number"
                domain={[0, 1]}
                {...AXIS}
                label={{ value: "fraud score", position: "insideBottom", offset: -2, fontSize: 10, fill: "#9ca3af" }}
              />
              <YAxis
                dataKey="y"
                type="number"
                {...AXIS}
                tickFormatter={(v: number) => formatMoneyShort(v)}
                width={52}
              />
              <ZAxis range={[18, 18]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) =>
                  name === "y" ? [formatMoneyShort(v), "Expected loss"] : [v.toFixed(3), "Score"]
                }
              />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
              <Scatter name="High"   data={scatterHigh}   fill={HIGH}   fillOpacity={0.55} />
              <Scatter name="Medium" data={scatterMedium} fill={MEDIUM} fillOpacity={0.55} />
              <Scatter name="Low"    data={scatterLow}    fill={LOW}    fillOpacity={0.40} />
            </ScatterChart>
          </ResponsiveContainer>
        </Panel>

        {/* Radar — signal fingerprint */}
        <Panel title="Signal fingerprint — high vs low risk">
          {radarData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              Loading fingerprint…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                <PolarGrid stroke={GRID} />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <PolarRadiusAxis angle={90} domain={[0, 1]} tick={{ fontSize: 9, fill: "#9ca3af" }} tickCount={3} />
                <Radar name="High risk" dataKey="high" stroke={HIGH}   fill={HIGH}   fillOpacity={0.25} strokeWidth={2} />
                <Radar name="Low risk"  dataKey="low"  stroke={LOW}    fill={LOW}    fillOpacity={0.20} strokeWidth={2} />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v.toFixed(2), ""]} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        {/* Area — claims volume */}
        <Panel title="Claims volume by month (sampled)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={months}>
              <defs>
                <linearGradient id="claimsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={VIOLET} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={VIOLET} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} strokeWidth={0.8} />
              <XAxis dataKey="month" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="claims" stroke={VIOLET} strokeWidth={2} fill="url(#claimsGrad)" dot={false} activeDot={{ r: 4, fill: VIOLET }} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        {/* Area — fraud capture curve */}
        <section className="glass-panel">
          <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Fraud dollars captured by queue size
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={capture}>
                <defs>
                  <linearGradient id="captureGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={AMBER} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={AMBER} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeWidth={0.8} />
                <XAxis dataKey="size" {...AXIS} label={{ value: "cases reviewed", position: "insideBottom", offset: -2, fontSize: 10, fill: "#9ca3af" }} />
                <YAxis {...AXIS} unit="%" />
                <Tooltip formatter={(v: number) => [`${v}%`, "Captured"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="captured" stroke={AMBER} strokeWidth={2.5} fill="url(#captureGrad)" dot={false} activeDot={{ r: 4, fill: AMBER }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

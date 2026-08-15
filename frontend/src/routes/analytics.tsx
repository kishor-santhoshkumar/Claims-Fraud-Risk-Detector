import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCaseStore } from "@/lib/caseStore";
import { formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/analytics")({
  component: Analytics,
});

// ── Color palette ────────────────────────────────────────────────────────────
const HIGH   = "#ef4444";   // red    — high risk
const MEDIUM = "#f59e0b";   // amber  — medium risk
const LOW    = "#10b981";   // emerald — low risk / safe
const BLUE   = "#3b82f6";
const VIOLET = "#8b5cf6";
const AMBER  = "#f59e0b";
const GRID   = "#e5e7eb";
const AXIS   = { stroke: "#9ca3af", fontSize: 11, tickLine: false } as const;

// Cycling palette for state bars
const BAR_PALETTE = ["#3b82f6","#06b6d4","#8b5cf6","#ec4899","#f59e0b","#10b981",
                     "#f97316","#14b8a6","#a855f7","#ef4444","#84cc16","#0ea5e9"];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="h-64">{children}</div>
    </section>
  );
}

function Analytics() {
  const { providers, counts } = useCaseStore();

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
      .map(([state, providersCount]) => ({ state, providers: providersCount }))
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

  const flagged = providers.filter((p) => p.risk_tier !== "low").length;
  const dollarsAtRisk = providers.reduce((s, p) => s + p.expected_loss, 0);

  const metrics = [
    { label: "Providers scored",  value: providers.length.toLocaleString(), color: "border-l-blue-500" },
    { label: "Flagged for review", value: flagged.toLocaleString(),          color: "border-l-amber-500" },
    { label: "Confirmed fraud",   value: counts.confirmed.toLocaleString(), color: "border-l-red-500" },
    { label: "Dollars at risk",   value: formatMoneyShort(dollarsAtRisk),   color: "border-l-violet-500" },
  ];

  return (
    <div className="px-6 pb-16">
      <header className="border-b border-border py-4">
        <h1 className="text-[15px] font-medium">Analytics</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Model coverage and review outcomes.</p>
      </header>

      {/* KPI tiles */}
      <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className={`rounded-lg border border-border bg-card p-4 shadow-sm border-l-4 ${m.color}`}
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className="mt-1 font-mono text-[22px] tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Pie — risk tier */}
        <Panel title="Risk tier distribution">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={tiers}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={88}
                paddingAngle={3}
                stroke="none"
              >
                {tiers.map((_, i) => (
                  <Cell key={i} fill={[HIGH, MEDIUM, LOW][i]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(v) => <span style={{ fontSize: 12 }}>{v}</span>}
              />
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
              <Tooltip
                cursor={{ fill: "#f3f4f6" }}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="providers" barSize={16} radius={[3, 3, 0, 0]}>
                {states.map((_, i) => (
                  <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Line — claims volume */}
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
              <Area
                type="monotone"
                dataKey="claims"
                stroke={VIOLET}
                strokeWidth={2}
                fill="url(#claimsGrad)"
                dot={false}
                activeDot={{ r: 4, fill: VIOLET }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        {/* Area — fraud capture curve */}
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                <Tooltip
                  formatter={(v: number) => [`${v}%`, "Captured"]}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="captured"
                  stroke={AMBER}
                  strokeWidth={2.5}
                  fill="url(#captureGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: AMBER }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

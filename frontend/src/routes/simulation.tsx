import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Slider } from "@/components/ui/slider";
import { useCaseStore } from "@/lib/caseStore";
import { formatMoneyFull, formatMoneyShort } from "@/lib/mockData";

export const Route = createFileRoute("/simulation")({
  component: Simulation,
});

// ── Colors ───────────────────────────────────────────────────────────────────
const GREEN  = "#10b981";   // recovered / caught
const RED    = "#ef4444";   // missed / lost
const AMBER  = "#f59e0b";   // reference / warning
const GRID   = "#e5e7eb";
const AXIS   = { stroke: "#9ca3af", fontSize: 11, tickLine: false } as const;

const TIER_COLOR: Record<string, string> = {
  high:   "#ef4444",
  medium: "#f59e0b",
  low:    "#10b981",
};

function Simulation() {
  const { providers } = useCaseStore();
  const [capacity, setCapacity] = useState(100);

  const ranked = useMemo(
    () => [...providers].sort((a, b) => b.expected_loss - a.expected_loss),
    [providers],
  );

  const totals = useMemo(() => {
    const totalLoss = ranked.reduce((s, p) => s + p.expected_loss, 0);
    const totalFraud = ranked.filter((p) => p.risk_tier !== "low").length;
    return { totalLoss, totalFraud };
  }, [ranked]);

  const cut = Math.min(ranked.length, Math.round((capacity / 500) * ranked.length));
  const reviewed = ranked.slice(0, cut);
  const recovered = reviewed.reduce((s, p) => s + p.expected_loss, 0);
  const missed = totals.totalLoss - recovered;
  const caught = reviewed.filter((p) => p.risk_tier !== "low").length;
  const falsePositives = reviewed.length - caught;
  const pct = totals.totalFraud ? Math.round((caught / totals.totalFraud) * 100) : 0;
  const hours = Math.round((capacity * 45) / 60);

  const curve = useMemo(() => {
    const points: { capacity: number; recovered: number; missed: number }[] = [];
    for (let c = 25; c <= 500; c += 25) {
      const n = Math.min(ranked.length, Math.round((c / 500) * ranked.length));
      const rec = ranked.slice(0, n).reduce((s, p) => s + p.expected_loss, 0);
      points.push({ capacity: c, recovered: rec, missed: totals.totalLoss - rec });
    }
    return points;
  }, [ranked, totals.totalLoss]);

  const metrics = [
    { label: "Fraud cases caught",          value: caught.toLocaleString(),          accent: "border-l-emerald-500",  text: "text-emerald-600" },
    { label: "Share of fraud caught",        value: `${pct}%`,                        accent: "border-l-blue-500",     text: "text-blue-600" },
    { label: "Dollars recovered",            value: formatMoneyShort(recovered),      accent: "border-l-emerald-500",  text: "text-emerald-600" },
    { label: "Dollars missed",               value: formatMoneyShort(missed),         accent: "border-l-red-500",      text: "text-red-600" },
    { label: "False positives reviewed",     value: falsePositives.toLocaleString(), accent: "border-l-amber-500",    text: "text-amber-600" },
    { label: "Investigator hours per week",  value: `${hours} h`,                    accent: "border-l-violet-500",   text: "text-violet-600" },
  ];

  return (
    <div className="px-6 pb-16">
      <header className="border-b border-border py-4">
        <h1 className="text-[15px] font-medium">Capacity simulation</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Move the slider to see how review capacity changes outcomes.
        </p>
      </header>

      {/* Slider */}
      <div className="py-6">
        <div className="flex items-baseline justify-between">
          <label className="text-[13px]">Cases reviewed per week</label>
          <span className="font-mono text-[22px] tabular-nums">{capacity}</span>
        </div>
        <Slider
          className="mt-4"
          min={25}
          max={500}
          step={5}
          value={[capacity]}
          onValueChange={(v) => setCapacity(v[0] ?? 100)}
        />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {metrics.map((m) => (
          <div
            key={m.label}
            className={`rounded-lg border border-border bg-card p-4 shadow-sm border-l-4 ${m.accent}`}
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className={`mt-1 font-mono text-[18px] tabular-nums font-semibold ${m.text}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[14px]">
        At {capacity} cases per week your team catches{" "}
        <span className="font-semibold text-emerald-600">{pct}% of fraud</span> and recovers{" "}
        <span className="font-semibold text-emerald-600">{formatMoneyShort(recovered)}</span>, leaving{" "}
        <span className="font-semibold text-red-600">{formatMoneyShort(missed)}</span> unrecovered.
      </p>

      {/* Chart */}
      <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recovered vs missed dollars across capacity
        </h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={curve}>
              <CartesianGrid stroke={GRID} strokeWidth={0.8} />
              <XAxis dataKey="capacity" {...AXIS} label={{ value: "cases / week", position: "insideBottom", offset: -2, fontSize: 10, fill: "#9ca3af" }} />
              <YAxis {...AXIS} tickFormatter={(v) => formatMoneyShort(Number(v))} width={68} />
              <Tooltip
                formatter={(v: number, name: string) => [formatMoneyShort(v), name === "recovered" ? "Recovered" : "Missed"]}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(v) => <span style={{ fontSize: 12 }}>{v === "recovered" ? "Recovered" : "Missed"}</span>}
              />
              <Bar dataKey="recovered" fill={GREEN} barSize={10} radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="missed" stroke={RED} strokeWidth={2} dot={false} />
              <ReferenceLine
                x={Math.round(capacity / 25) * 25}
                stroke={AMBER}
                strokeWidth={2}
                strokeDasharray="4 3"
                label={{ value: "current", position: "top", fontSize: 10, fill: AMBER }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Provider list */}
      <section className="mt-6">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Providers inside the cut ({reviewed.length})
        </h2>
        <div className="divide-y divide-border rounded-lg border border-border">
          {reviewed.slice(0, 15).map((p, i) => (
            <div
              key={p.provider_id}
              className="grid grid-cols-[40px_110px_90px_1fr] items-center gap-3 px-3 py-2 text-[13px]"
            >
              <span className="font-mono text-[12px] text-muted-foreground">{i + 1}</span>
              <span className="font-mono">{p.provider_id}</span>
              <span
                className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize"
                style={{
                  color: TIER_COLOR[p.risk_tier],
                  backgroundColor: TIER_COLOR[p.risk_tier] + "18",
                }}
              >
                {p.risk_tier}
              </span>
              <span className="text-right font-mono tabular-nums">{formatMoneyFull(p.expected_loss)}</span>
            </div>
          ))}
        </div>
        {reviewed.length > 15 && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            and {reviewed.length - 15} more inside the cut
          </p>
        )}
      </section>
    </div>
  );
}

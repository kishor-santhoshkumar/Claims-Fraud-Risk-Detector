import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const GREEN  = "#10b981";
const RED    = "#ef4444";
const AMBER  = "#f59e0b";
const GRID   = "rgba(30,41,59,0.08)";
const AXIS   = { stroke: "#9ca3af", fontSize: 11, tickLine: false } as const;

const TIER_COLOR: Record<string, string> = {
  high:   "#ef4444",
  medium: "#f59e0b",
  low:    "#10b981",
};

// ── Simulation overlay animation ─────────────────────────────────────────────
const DOT_CAP = 50;
const PASS_RATE = 0.28;
const STAGGER_MS = 20;
const ENTER_DUR_MS = 200;
const SCREEN_H = 380;
const GRID_COLS = 10;
const GRID_PITCH = 16;
const GRID_BASE_X = 240;
const GRID_BASE_Y = 24;
const RF_ENTER_Y = 250;
const RF_SPLIT_CONTINUE_Y = 300;
const RF_SPLIT_REMOVED_Y = 230;
const XGB_SETTLE_Y = SCREEN_H + 300;

const COLOR_NEUTRAL   = "#e2e8f0";
const COLOR_REMOVED   = "#22c55e";
const COLOR_CONTINUES = "#ef4444";
const COLOR_PULSE     = "#60a5fa";

type SimStage = "intro" | "entering-rf" | "pause" | "split" | "to-xgb" | "scoring" | "done" | "closing" | "closed";

// Only the main pipeline — done/closing/closed handled by separate useEffects
function stageAfter(stage: SimStage): SimStage | null {
  const map: Partial<Record<SimStage, SimStage>> = {
    intro: "entering-rf",
    "entering-rf": "pause",
    pause: "split",
    split: "to-xgb",
    "to-xgb": "scoring",
    scoring: "done",
  };
  return map[stage] ?? null;
}

function stageDuration(stage: SimStage, dotCount: number, keptCount: number): number {
  switch (stage) {
    case "intro":       return 700;
    case "entering-rf": return dotCount * STAGGER_MS + ENTER_DUR_MS + 150;
    case "pause":       return 350;
    case "split":       return 900;
    case "to-xgb":     return Math.max(keptCount * STAGGER_MS + ENTER_DUR_MS + 300, 600);
    case "scoring":     return 500;
    default:            return 0;
  }
}

function stageMeta(stage: SimStage, dotCount: number, keptCount: number) {
  switch (stage) {
    case "intro":
      return { label: "Loading provider data", counter: `${dotCount} providers loaded` };
    case "entering-rf":
    case "pause":
    case "split":
      return { label: "Random Forest gate — filtering", counter: `Evaluating ${dotCount} providers…` };
    case "to-xgb":
      return { label: "Random Forest gate — filtering", counter: `${dotCount} → ${keptCount} passed the gate` };
    case "scoring":
      return { label: "XGBoost — scoring", counter: `${keptCount} providers in progress` };
    case "done":
    case "closing":
      return { label: `Done — ${Math.round(keptCount * 0.7)} flagged`, counter: `${keptCount} providers scored` };
    default:
      return { label: "", counter: "" };
  }
}

interface DotVisual {
  x: number; y: number; opacity: number;
  background: string; delay: number; duration: number;
  pulsing: boolean; settle: boolean;
}

function dotVisual(stage: SimStage, i: number, keptCount: number): DotVisual | null {
  const isKept = i < keptCount;
  const col = i % GRID_COLS;
  const row = Math.floor(i / GRID_COLS);
  const x = GRID_BASE_X + col * GRID_PITCH;
  const baseY = GRID_BASE_Y + row * GRID_PITCH;
  const driftDx = ((i * 53) % 240) - 120;

  switch (stage) {
    case "intro":
      return { x, y: baseY, opacity: 1, background: COLOR_NEUTRAL, delay: i * 4, duration: 350, pulsing: false, settle: false };
    case "entering-rf":
      return { x, y: RF_ENTER_Y, opacity: 1, background: COLOR_NEUTRAL, delay: i * STAGGER_MS, duration: ENTER_DUR_MS, pulsing: false, settle: false };
    case "pause":
      return { x, y: RF_ENTER_Y, opacity: 1, background: COLOR_NEUTRAL, delay: 0, duration: 0, pulsing: false, settle: false };
    case "split":
      if (isKept) return { x, y: RF_SPLIT_CONTINUE_Y, opacity: 1, background: COLOR_CONTINUES, delay: 0, duration: 550, pulsing: false, settle: false };
      return { x: x + driftDx, y: RF_SPLIT_REMOVED_Y, opacity: 0, background: COLOR_REMOVED, delay: 0, duration: 550, pulsing: false, settle: false };
    case "to-xgb":
      if (!isKept) return null;
      return { x, y: XGB_SETTLE_Y, opacity: 1, background: COLOR_CONTINUES, delay: i * STAGGER_MS, duration: ENTER_DUR_MS, pulsing: false, settle: false };
    case "scoring":
      if (!isKept) return null;
      return { x, y: XGB_SETTLE_Y, opacity: 1, background: COLOR_PULSE, delay: 0, duration: 400, pulsing: true, settle: false };
    case "done":
    case "closing": {
      if (!isKept) return null;
      const tierColor = i < Math.round(keptCount * 0.4) ? "#ef4444" : i < Math.round(keptCount * 0.7) ? "#f59e0b" : "#64748b";
      return { x, y: XGB_SETTLE_Y, opacity: 1, background: tierColor, delay: 0, duration: 350, pulsing: false, settle: true };
    }
    default:
      return null;
  }
}

function SimFunnel({ tone, top }: { tone: "rf" | "xgb"; top: number }) {
  const label = tone === "rf" ? "RANDOM FOREST" : "XGBOOST";
  return (
    <div className={`sim-overlay-funnel sim-overlay-funnel--${tone}`} style={{ top }}>
      <span className="sim-overlay-funnel-label">{label}</span>
      <svg viewBox="0 0 320 130" preserveAspectRatio="none" className="sim-overlay-funnel-svg" aria-hidden="true">
        <polygon points="8,8 312,8 210,122 110,122" />
      </svg>
    </div>
  );
}

function SimulationLoadingIntro({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<SimStage>("intro");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const dotCount = DOT_CAP;
  const keptCount = Math.max(1, Math.round(dotCount * PASS_RATE));

  // Main pipeline: intro → entering-rf → pause → split → to-xgb → scoring → done
  useEffect(() => {
    const next = stageAfter(stage);
    if (!next) return;
    const ms = stageDuration(stage, dotCount, keptCount);
    const id = setTimeout(() => setStage(next), ms);
    return () => clearTimeout(id);
  }, [stage, dotCount, keptCount]);

  // Hold the "done" result briefly, then start fade-out
  useEffect(() => {
    if (stage !== "done") return;
    const id = setTimeout(() => setStage("closing"), 700);
    return () => clearTimeout(id);
  }, [stage]);

  // Fade-out completes → notify parent (simulation page can now render)
  useEffect(() => {
    if (stage !== "closing") return;
    const id = setTimeout(() => {
      setStage("closed");
      onDoneRef.current();
    }, 400);
    return () => clearTimeout(id);
  }, [stage]);

  if (stage === "closed") return null;

  const meta = stageMeta(stage, dotCount, keptCount);
  const trackShifted = ["to-xgb", "scoring", "done", "closing"].includes(stage);
  const showTrack = stage !== "intro";

  return (
    <div className={`sim-overlay-backdrop${stage === "closing" ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Simulation loading">
      <div className="sim-overlay-content">
        <p className="sim-overlay-label">{meta.label}</p>
        <p className="sim-overlay-counter">{meta.counter}</p>
        <div className="sim-overlay-stage-area">
          <div className={`sim-overlay-track${trackShifted ? " is-shifted" : ""}`}>
            {showTrack && (
              <>
                <SimFunnel tone="rf" top={170} />
                <SimFunnel tone="xgb" top={SCREEN_H + 170} />
              </>
            )}
            {Array.from({ length: dotCount }, (_, i) => {
              const v = dotVisual(stage, i, keptCount);
              if (!v) return null;
              return (
                <span
                  key={i}
                  className={`sim-overlay-dot2${v.pulsing ? " is-pulsing" : ""}${v.settle ? " is-settling" : ""}`}
                  style={{
                    transform: `translate(${v.x}px, ${v.y}px)`,
                    opacity: v.opacity,
                    background: v.background,
                    transitionDelay: `${v.delay}ms`,
                    transitionDuration: `${v.duration}ms`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Simulation page ──────────────────────────────────────────────────────

function Simulation() {
  const { providers } = useCaseStore();
  const [capacity, setCapacity] = useState(100);
  const [showIntro, setShowIntro] = useState(
    () => !sessionStorage.getItem("sim_intro_shown"),
  );

  const handleIntroDone = useCallback(() => {
    sessionStorage.setItem("sim_intro_shown", "1");
    setShowIntro(false);
  }, []);

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
    { label: "Fraud cases caught",         value: caught.toLocaleString(),         accent: "border-l-emerald-500", text: "#059669" },
    { label: "Share of fraud caught",       value: `${pct}%`,                       accent: "border-l-blue-500",    text: "#2563eb" },
    { label: "Dollars recovered",           value: formatMoneyShort(recovered),     accent: "border-l-emerald-500", text: "#059669" },
    { label: "Dollars missed",              value: formatMoneyShort(missed),         accent: "border-l-red-500",     text: "#dc2626" },
    { label: "False positives reviewed",    value: falsePositives.toLocaleString(), accent: "border-l-amber-500",   text: "#b45309" },
    { label: "Investigator hours per week", value: `${hours} h`,                    accent: "border-l-violet-500",  text: "#7c3aed" },
  ];

  if (showIntro) {
    return <SimulationLoadingIntro onDone={handleIntroDone} />;
  }

  return (
    <div style={{ padding: "0 24px 64px" }}>
        <header style={{ paddingTop: 24, paddingBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#161b2e", margin: 0 }}>Capacity simulation</h1>
          <p style={{ marginTop: 4, fontSize: 13, color: "#667088", marginBottom: 0 }}>
            Move the slider to see how review capacity changes outcomes.
          </p>
        </header>

        {/* Slider — glass panel */}
        <div className="glass-panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: "#232a41" }}>Cases reviewed per week</label>
            <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 22, fontVariantNumeric: "tabular-nums", color: "#161b2e" }}>{capacity}</span>
          </div>
          <Slider
            min={25} max={500} step={5}
            value={[capacity]}
            onValueChange={(v) => setCapacity(v[0] ?? 100)}
          />
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" style={{ marginBottom: 16 }}>
          {metrics.map((m) => (
            <div key={m.label} className={`glass-card p-4 border-l-4 ${m.accent}`}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#667088" }}>{m.label}</p>
              <p style={{ marginTop: 4, fontFamily: "ui-monospace,monospace", fontSize: 18, fontVariantNumeric: "tabular-nums", fontWeight: 600, color: m.text }}>{m.value}</p>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 14, color: "#232a41", marginBottom: 20 }}>
          At {capacity} cases per week your team catches{" "}
          <span style={{ fontWeight: 600, color: "#059669" }}>{pct}% of fraud</span> and recovers{" "}
          <span style={{ fontWeight: 600, color: "#059669" }}>{formatMoneyShort(recovered)}</span>, leaving{" "}
          <span style={{ fontWeight: 600, color: "#dc2626" }}>{formatMoneyShort(missed)}</span> unrecovered.
        </p>

        {/* Chart — glass panel */}
        <div className="glass-panel" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 16 }}>
            Recovered vs missed dollars across capacity
          </h2>
          <div style={{ height: 288 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={curve}>
                <CartesianGrid stroke={GRID} strokeWidth={0.8} />
                <XAxis dataKey="capacity" {...AXIS} label={{ value: "cases / week", position: "insideBottom", offset: -2, fontSize: 10, fill: "#9ca3af" }} />
                <YAxis {...AXIS} tickFormatter={(v) => formatMoneyShort(Number(v))} width={68} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatMoneyShort(v), name === "recovered" ? "Recovered" : "Missed"]}
                  contentStyle={{ borderRadius: 10, fontSize: 12, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.8)" }}
                />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 12 }}>{v === "recovered" ? "Recovered" : "Missed"}</span>} />
                <Bar dataKey="recovered" fill={GREEN} barSize={10} radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="missed" stroke={RED} strokeWidth={2} dot={false} />
                <ReferenceLine
                  x={Math.round(capacity / 25) * 25}
                  stroke={AMBER} strokeWidth={2} strokeDasharray="4 3"
                  label={{ value: "current", position: "top", fontSize: 10, fill: AMBER }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Provider list — glass card */}
        <div>
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 10 }}>
            Providers inside the cut ({reviewed.length})
          </h2>
          <div className="glass-card" style={{ overflow: "hidden" }}>
            {reviewed.slice(0, 15).map((p, i) => (
              <div
                key={p.provider_id}
                style={{ display: "grid", gridTemplateColumns: "40px 110px 90px 1fr", alignItems: "center", gap: 12, padding: "8px 16px", fontSize: 13, borderBottom: "1px solid rgba(30,41,59,0.06)", color: "#232a41" }}
              >
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "#8791a8" }}>{i + 1}</span>
                <span style={{ fontFamily: "ui-monospace,monospace" }}>{p.provider_id}</span>
                <span
                  style={{
                    display: "inline-flex", width: "fit-content", alignItems: "center",
                    borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                    color: TIER_COLOR[p.risk_tier],
                    background: TIER_COLOR[p.risk_tier] + "18",
                    border: `1px solid ${TIER_COLOR[p.risk_tier]}30`,
                    textTransform: "capitalize",
                  }}
                >
                  {p.risk_tier}
                </span>
                <span style={{ textAlign: "right", fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums" }}>{formatMoneyFull(p.expected_loss)}</span>
              </div>
            ))}
          </div>
          {reviewed.length > 15 && (
            <p style={{ marginTop: 8, fontSize: 12, color: "#8791a8" }}>
              and {reviewed.length - 15} more inside the cut
            </p>
          )}
        </div>
    </div>
  );
}


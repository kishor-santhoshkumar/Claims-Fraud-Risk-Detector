import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCaseStore } from "@/lib/caseStore";
import {
  type ProviderCrossing,
  type ReplayBatch,
  type ReplayFinalSummary,
  type ReplayResponse,
  fetchSimulationReplay,
} from "@/lib/api";
import { formatMoneyFull, formatMoneyShort } from "@/lib/mockData";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

export const Route = createFileRoute("/simulation")({
  component: Simulation,
});

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  fraud:  "#ef4444",
  waste:  "#f59e0b",
  abuse:  "#8b5cf6",
  high:   "#ef4444",
  medium: "#f59e0b",
  low:    "#64748b",
  money:  "#10b981",
  claims: "#3b82f6",
  grid:   "rgba(30,41,59,0.08)",
} as const;

const AX = { stroke: "#9ca3af", fontSize: 11, tickLine: false } as const;

// ── Timing ───────────────────────────────────────────────────────────────────
const TICK_MS: Record<number, number> = { 1: 15000, 2: 7500, 4: 3750 };
const TOTAL_TICKS = 6;
const TICKER_PER_TICK = 12;

// ── Types ────────────────────────────────────────────────────────────────────
type Phase = "idle" | "loading" | "error" | "playing" | "paused" | "complete";
type Speed = 1 | 2 | 4;

interface TickerRow {
  id: string;
  claim: ClaimSample;
  isNew: boolean;
}

// ── SimulationLoadingIntro (runs while API fetch is in progress) ──────────────
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

type SimStage = "intro" | "entering-rf" | "pause" | "split" | "to-xgb" | "scoring" | "done" | "closing" | "closed";

function stageAfter(s: SimStage): SimStage | null {
  const map: Partial<Record<SimStage, SimStage>> = {
    intro: "entering-rf", "entering-rf": "pause", pause: "split",
    split: "to-xgb", "to-xgb": "scoring", scoring: "done",
  };
  return map[s] ?? null;
}

function stageDuration(s: SimStage, dots: number, kept: number): number {
  switch (s) {
    case "intro":       return 700;
    case "entering-rf": return dots * STAGGER_MS + ENTER_DUR_MS + 150;
    case "pause":       return 350;
    case "split":       return 900;
    case "to-xgb":     return Math.max(kept * STAGGER_MS + ENTER_DUR_MS + 300, 600);
    case "scoring":     return 500;
    default:            return 0;
  }
}

function SimFunnel({ tone, top }: { tone: "rf" | "xgb"; top: number }) {
  return (
    <div className={`sim-overlay-funnel sim-overlay-funnel--${tone}`} style={{ top }}>
      <span className="sim-overlay-funnel-label">{tone === "rf" ? "RANDOM FOREST" : "XGBOOST"}</span>
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
  const dots = DOT_CAP;
  const kept = Math.max(1, Math.round(dots * PASS_RATE));

  useEffect(() => {
    const next = stageAfter(stage);
    if (!next) return;
    const id = setTimeout(() => setStage(next), stageDuration(stage, dots, kept));
    return () => clearTimeout(id);
  }, [stage, dots, kept]);
  useEffect(() => {
    if (stage !== "done") return;
    const id = setTimeout(() => setStage("closing"), 700);
    return () => clearTimeout(id);
  }, [stage]);
  useEffect(() => {
    if (stage !== "closing") return;
    const id = setTimeout(() => { setStage("closed"); onDoneRef.current(); }, 400);
    return () => clearTimeout(id);
  }, [stage]);

  if (stage === "closed") return null;

  const shifted = ["to-xgb", "scoring", "done", "closing"].includes(stage);
  const showTrack = stage !== "intro";
  const meta = stage === "intro"
    ? { label: "Loading replay data", counter: `${dots} providers loaded` }
    : { label: "Preparing simulation", counter: `${dots} → ${kept} passed the gate` };

  return (
    <div className={`sim-overlay-backdrop${stage === "closing" ? " is-closing" : ""}`} role="dialog" aria-modal="true">
      <div className="sim-overlay-content">
        <p className="sim-overlay-label">{meta.label}</p>
        <p className="sim-overlay-counter">{meta.counter}</p>
        <div className="sim-overlay-stage-area">
          <div className={`sim-overlay-track${shifted ? " is-shifted" : ""}`}>
            {showTrack && (<><SimFunnel tone="rf" top={170} /><SimFunnel tone="xgb" top={SCREEN_H + 170} /></>)}
            {Array.from({ length: dots }, (_, i) => {
              const isKept = i < kept;
              const col = i % GRID_COLS;
              const row = Math.floor(i / GRID_COLS);
              const x = GRID_BASE_X + col * GRID_PITCH;
              const baseY = GRID_BASE_Y + row * GRID_PITCH;
              const driftDx = ((i * 53) % 240) - 120;
              let sx = x, sy = baseY, opacity = 1, bg = "#e2e8f0", delay = i * 4, dur = 350, pulsing = false;

              if (stage === "entering-rf" || stage === "pause") { sy = RF_ENTER_Y; delay = stage === "entering-rf" ? i * STAGGER_MS : 0; dur = stage === "entering-rf" ? ENTER_DUR_MS : 0; }
              else if (stage === "split") { sy = isKept ? RF_SPLIT_CONTINUE_Y : RF_SPLIT_REMOVED_Y; sx = isKept ? x : x + driftDx; opacity = isKept ? 1 : 0; bg = isKept ? "#ef4444" : "#22c55e"; delay = 0; dur = 550; }
              else if (stage === "to-xgb") { if (!isKept) return null; sy = XGB_SETTLE_Y; delay = i * STAGGER_MS; dur = ENTER_DUR_MS; bg = "#ef4444"; }
              else if (stage === "scoring") { if (!isKept) return null; sy = XGB_SETTLE_Y; bg = "#60a5fa"; pulsing = true; delay = 0; dur = 400; }
              else if (stage === "done" || stage === "closing") { if (!isKept) return null; sy = XGB_SETTLE_Y; bg = i < Math.round(kept * 0.4) ? "#ef4444" : i < Math.round(kept * 0.7) ? "#f59e0b" : "#64748b"; delay = 0; dur = 350; }
              return (
                <span key={i} className={`sim-overlay-dot2${pulsing ? " is-pulsing" : ""}`}
                  style={{ transform: `translate(${sx}px, ${sy}px)`, opacity, background: bg, transitionDelay: `${delay}ms`, transitionDuration: `${dur}ms` }} />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Claim ticker ──────────────────────────────────────────────────────────────
function ClaimTicker({ rows }: { rows: TickerRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [rows.length]);

  return (
    <div style={{
      height: 120, overflow: "hidden", position: "relative",
      borderTop: "1px solid rgba(30,41,59,0.08)", borderBottom: "1px solid rgba(30,41,59,0.08)",
      background: "rgba(15,23,42,0.02)",
    }}>
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: "linear-gradient(to bottom, rgba(255,255,255,0.9) 0%, transparent 25%, transparent 75%, rgba(255,255,255,0.9) 100%)",
      }} />
      <div ref={containerRef} style={{ height: "100%", overflowY: "auto", scrollBehavior: "smooth" }}>
        {rows.map((row) => (
          <div key={row.id}
            className={cn("ticker-row", row.isNew && "ticker-row--new", row.claim.rule_flags.length > 0 && "ticker-row--flagged")}
            style={{
              display: "grid", gridTemplateColumns: "120px 90px 90px 1fr",
              alignItems: "center", gap: 8, padding: "3px 16px",
              fontSize: 11, fontFamily: "ui-monospace,monospace",
              borderBottom: "1px solid rgba(30,41,59,0.04)",
              animation: "tickerFadeIn 0.3s ease-out",
              background: row.claim.rule_flags.length > 0 ? "rgba(239,68,68,0.04)" : "transparent",
            }}>
            <span style={{ color: "#8791a8" }}>{row.claim.claim_id.slice(-8)}</span>
            <span style={{ color: "#232a41" }}>{row.claim.provider_id}</span>
            <span style={{ color: "#232a41", textAlign: "right" }}>${row.claim.amount.toLocaleString()}</span>
            <span>
              {row.claim.rule_flags.length > 0 ? (
                <span style={{
                  background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
                  borderRadius: 4, padding: "1px 6px", fontSize: 10,
                }}>
                  {row.claim.rule_flags[0]!.replace(/_/g, " ")}
                </span>
              ) : (
                <span style={{ color: "#9ca3af", fontSize: 10 }}>clean</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────
interface ChartPoint {
  label: string;
  claims: number;
  fraud: number;
  waste: number;
  abuse: number;
  money: number;
  qhigh: number;
  qmedium: number;
  qlow: number;
}

function buildChartData(batches: ReplayBatch[], upToTick: number): ChartPoint[] {
  return batches.filter((b) => b.tick <= upToTick).map((b) => ({
    label: b.label.replace(" 2009", "").replace(" – ", "-"),
    claims: Math.round(b.cumulative.claims_processed / 1000),
    fraud: b.flags_by_category.fraud,
    waste: b.flags_by_category.waste,
    abuse: b.flags_by_category.abuse,
    money: Math.round(b.cumulative.money_at_risk / 1_000_000),
    qhigh: b.cumulative.queue_high,
    qmedium: b.cumulative.queue_medium,
    qlow: b.cumulative.queue_low,
  }));
}

function ChartGrid({ batches, upToTick }: { batches: ReplayBatch[]; upToTick: number }) {
  const data = buildChartData(batches, upToTick);
  const ttStyle = { borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.95)", border: "1px solid rgba(30,41,59,0.12)" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {/* Chart 1 — cumulative claims */}
      <div className="glass-panel" style={{ padding: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 8 }}>Claims Processed (k)</p>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="claimsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.claims} stopOpacity={0.3} />
                <stop offset="95%" stopColor={C.claims} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.grid} strokeWidth={0.8} />
            <XAxis dataKey="label" {...AX} />
            <YAxis {...AX} width={40} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [`${v}k`, "Claims"]} />
            <Area type="monotone" dataKey="claims" stroke={C.claims} fill="url(#claimsGrad)" strokeWidth={2} isAnimationActive animationDuration={400} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2 — flags by category */}
      <div className="glass-panel" style={{ padding: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 8 }}>Flags by Category</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} barSize={20}>
            <CartesianGrid stroke={C.grid} strokeWidth={0.8} />
            <XAxis dataKey="label" {...AX} />
            <YAxis {...AX} width={36} />
            <Tooltip contentStyle={ttStyle} />
            <Bar dataKey="fraud" name="Fraud" stackId="a" fill={C.fraud} isAnimationActive animationDuration={400} />
            <Bar dataKey="waste" name="Waste" stackId="a" fill={C.waste} isAnimationActive animationDuration={400} />
            <Bar dataKey="abuse" name="Abuse" stackId="a" fill={C.abuse} isAnimationActive animationDuration={400} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3 — money at risk */}
      <div className="glass-panel" style={{ padding: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 8 }}>Money at Risk ($M)</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data}>
            <CartesianGrid stroke={C.grid} strokeWidth={0.8} />
            <XAxis dataKey="label" {...AX} />
            <YAxis {...AX} width={44} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [`$${v}M`, "At risk"]} />
            <Line type="monotone" dataKey="money" stroke={C.money} strokeWidth={2} dot={{ r: 3, fill: C.money }} isAnimationActive animationDuration={400} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 4 — queue composition */}
      <div className="glass-panel" style={{ padding: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 8 }}>Review Queue</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} barSize={20}>
            <CartesianGrid stroke={C.grid} strokeWidth={0.8} />
            <XAxis dataKey="label" {...AX} />
            <YAxis {...AX} width={36} />
            <Tooltip contentStyle={ttStyle} />
            <Bar dataKey="qhigh" name="High" stackId="q" fill={C.high} isAnimationActive animationDuration={400} />
            <Bar dataKey="qmedium" name="Medium" stackId="q" fill={C.medium} isAnimationActive animationDuration={400} />
            <Bar dataKey="qlow" name="Low" stackId="q" fill={C.low} isAnimationActive animationDuration={400} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Provider crossing list ────────────────────────────────────────────────────
const TIER_COLOR: Record<string, string> = { high: C.high, medium: C.medium, low: C.low };

function CrossingList({ crossings }: { crossings: ProviderCrossing[] }) {
  if (!crossings.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 6 }}>
        Providers crossing threshold
      </p>
      <div className="glass-card" style={{ overflow: "hidden" }}>
        {crossings.slice(0, 8).map((p, i) => (
          <Link key={p.provider_id} to="/case/$providerId" params={{ providerId: p.provider_id }}
            style={{
              display: "grid", gridTemplateColumns: "110px 70px 120px 1fr",
              alignItems: "center", gap: 10, padding: "7px 14px",
              fontSize: 12, borderBottom: i < Math.min(crossings.length, 8) - 1 ? "1px solid rgba(30,41,59,0.06)" : "none",
              textDecoration: "none", color: "inherit",
              animation: `crossingEntry 0.4s ease-out ${i * 60}ms backwards`,
            }}>
            <span style={{ fontFamily: "ui-monospace,monospace", color: "#232a41" }}>{p.provider_id}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", borderRadius: 5,
              padding: "2px 7px", fontSize: 10, fontWeight: 600,
              color: TIER_COLOR[p.tier] ?? C.low,
              background: (TIER_COLOR[p.tier] ?? C.low) + "18",
              border: `1px solid ${(TIER_COLOR[p.tier] ?? C.low)}30`,
              textTransform: "capitalize",
            }}>{p.tier}</span>
            <span style={{ fontFamily: "ui-monospace,monospace", color: "#232a41" }}>{formatMoneyFull(p.expected_loss)}</span>
            <span style={{ color: "#667088", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.trigger}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Completion panel ──────────────────────────────────────────────────────────
function CompletionPanel({ summary, capacity }: { summary: ReplayFinalSummary; capacity: number }) {
  const items = [
    { label: "Claims processed", value: summary.total_claims.toLocaleString() },
    { label: "Providers flagged", value: summary.total_flagged.toLocaleString() },
    { label: "Money at risk", value: formatMoneyShort(summary.money_at_risk) },
    { label: "Fraud caught", value: summary.fraud_caught.toLocaleString(), accent: "#059669" },
    { label: "Fraud missed", value: summary.fraud_missed.toLocaleString(), accent: "#dc2626" },
    { label: "False positives", value: summary.false_positives.toLocaleString() },
    { label: "Investigator hours", value: `${summary.investigator_hours.toLocaleString()} h` },
  ];

  return (
    <div style={{ marginTop: 16, animation: "completionExpand 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}>
      <div className="glass-panel" style={{ borderLeft: "3px solid #059669" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="9" stroke="#059669" strokeWidth="1.5" />
            <path d="M6 10.5l2.5 2.5 5-5" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#161b2e", margin: 0 }}>Replay complete</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
          {items.map((m) => (
            <div key={m.label} style={{ background: "rgba(30,41,59,0.03)", borderRadius: 6, padding: "8px 12px" }}>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#667088", margin: 0 }}>{m.label}</p>
              <p style={{ margin: "4px 0 0", fontFamily: "ui-monospace,monospace", fontSize: 16, fontWeight: 600, color: m.accent ?? "#161b2e" }}>{m.value}</p>
            </div>
          ))}
        </div>

        <div style={{ background: "rgba(30,41,59,0.03)", borderRadius: 6, padding: "10px 14px", marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 6 }}>Summary</p>
          <p style={{ fontSize: 13, color: "#232a41", lineHeight: 1.6, margin: 0 }}>
            {summary.narrative || `At capacity ${capacity} cases/week, the system caught ${summary.fraud_caught} of ${TOTAL_FRAUD_PROVIDERS} flagged fraudsters (${(summary.share_of_fraud_caught * 100).toFixed(1)}%), with ${summary.false_positives} false positives requiring review.`}
          </p>
        </div>

        {summary.top_providers.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#47516b", marginBottom: 6 }}>Top providers by expected loss</p>
            <div className="glass-card" style={{ overflow: "hidden" }}>
              {summary.top_providers.map((p, i) => (
                <Link key={p.provider_id} to="/case/$providerId" params={{ providerId: p.provider_id }}
                  style={{
                    display: "grid", gridTemplateColumns: "28px 110px 1fr",
                    alignItems: "center", gap: 10, padding: "7px 14px",
                    fontSize: 12, textDecoration: "none", color: "inherit",
                    borderBottom: i < summary.top_providers.length - 1 ? "1px solid rgba(30,41,59,0.06)" : "none",
                  }}>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#8791a8" }}>{i + 1}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: "#232a41" }}>{p.provider_id}</span>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: "#059669", textAlign: "right" }}>{formatMoneyFull(p.expected_loss)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Static capacity fallback ──────────────────────────────────────────────────
function StaticCapacityView({ errorMsg }: { errorMsg: string }) {
  const { providers } = useCaseStore();
  const [capacity, setCapacity] = useState(100);

  const ranked = [...providers].sort((a, b) => b.expected_loss - a.expected_loss);
  const totalFraud = 506;
  const totalLoss = ranked.reduce((s, p) => s + p.expected_loss, 0);
  const cut = Math.min(ranked.length, capacity);
  const reviewed = ranked.slice(0, cut);
  const recovered = reviewed.reduce((s, p) => s + p.expected_loss, 0);
  const missed = totalLoss - recovered;
  const fraudCaught = reviewed.filter((p) => p.risk_tier !== "low").length;
  const falsePositives = reviewed.length - fraudCaught;
  const pct = Math.round((fraudCaught / totalFraud) * 100);
  const hours = Math.round((capacity * 45) / 60);

  return (
    <div style={{ padding: "0 24px 64px" }}>
      <header style={{ paddingTop: 24, paddingBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#161b2e", margin: 0 }}>Capacity simulation</h1>
        <p style={{ marginTop: 4, fontSize: 12, color: "#dc2626", marginBottom: 0 }}>
          Live replay unavailable: {errorMsg}. Showing static capacity view.
        </p>
      </header>
      <div className="glass-panel" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <label style={{ fontSize: 13, color: "#232a41" }}>Cases reviewed per week</label>
          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 22, color: "#161b2e" }}>{capacity}</span>
        </div>
        <Slider min={25} max={500} step={5} value={[capacity]} onValueChange={(v) => setCapacity(v[0] ?? 100)} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          { label: "Fraud caught", value: fraudCaught.toLocaleString(), color: "#059669" },
          { label: "Share caught", value: `${pct}%`, color: "#2563eb" },
          { label: "Recovered", value: formatMoneyShort(recovered), color: "#059669" },
          { label: "Missed", value: formatMoneyShort(missed), color: "#dc2626" },
          { label: "False positives", value: falsePositives.toLocaleString(), color: "#b45309" },
          { label: "Hours / week", value: `${hours} h`, color: "#7c3aed" },
        ].map((m) => (
          <div key={m.label} className="glass-card p-4">
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#667088" }}>{m.label}</p>
            <p style={{ marginTop: 4, fontFamily: "ui-monospace,monospace", fontSize: 18, fontWeight: 600, color: m.color }}>{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main simulation component ─────────────────────────────────────────────────
function Simulation() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [capacity, setCapacity] = useState(100);
  const [speed, setSpeed] = useState<Speed>(1);
  const [replayData, setReplayData] = useState<ReplayResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentTick, setCurrentTick] = useState(0);
  const [tickProgress, setTickProgress] = useState(0); // 0-1 within current tick
  const [tickerRows, setTickerRows] = useState<TickerRow[]>([]);
  const [crossings, setCrossings] = useState<ProviderCrossing[]>([]);
  const [showIntro, setShowIntro] = useState(
    () => !sessionStorage.getItem("sim_intro_shown"),
  );

  const startTimeRef = useRef(0);
  const pausedElapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const tickerClaimIdxRef = useRef(0);
  const lastTickerTimeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const TICK_MS_VAL = TICK_MS[speed];
  const TOTAL_MS = TICK_MS_VAL * TOTAL_TICKS;

  const handleIntroDone = useCallback(() => {
    sessionStorage.setItem("sim_intro_shown", "1");
    setShowIntro(false);
  }, []);

  // Load replay data
  const startReplay = useCallback(async () => {
    if (phase === "playing" || phase === "loading") return;
    setPhase("loading");
    setShowIntro(true);
    try {
      const data = await fetchSimulationReplay(capacity);
      setReplayData(data);
      setPhase("idle"); // intro will transition to playing on done
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setErrorMsg(msg);
      setPhase("error");
      setShowIntro(false);
    }
  }, [capacity, phase]);

  // Begin playing once data is ready and intro is done
  const beginPlaying = useCallback(() => {
    setCurrentTick(0);
    setTickProgress(0);
    setTickerRows([]);
    setCrossings([]);
    lastTickRef.current = 0;
    tickerClaimIdxRef.current = 0;
    lastTickerTimeRef.current = 0;
    pausedElapsedRef.current = 0;
    startTimeRef.current = Date.now();
    setPhase("playing");
  }, []);

  // Auto-start playing after intro if we have data
  const handleIntroDoneWithData = useCallback(() => {
    handleIntroDone();
    if (replayData) {
      beginPlaying();
    }
  }, [handleIntroDone, replayData, beginPlaying]);

  // Main timer loop
  useEffect(() => {
    if (phase !== "playing") {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    if (!replayData) return;

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const totalElapsed = pausedElapsedRef.current + (now - startTimeRef.current);

      if (totalElapsed >= TOTAL_MS) {
        setCurrentTick(TOTAL_TICKS);
        setTickProgress(1);
        setPhase("complete");
        clearInterval(intervalRef.current!);
        return;
      }

      const tickIdx = Math.min(Math.floor(totalElapsed / TICK_MS_VAL), TOTAL_TICKS - 1);
      const timeInTick = totalElapsed - tickIdx * TICK_MS_VAL;
      const progress = timeInTick / TICK_MS_VAL;

      setCurrentTick(tickIdx + 1); // 1-indexed
      setTickProgress(progress);

      const batch = replayData.batches[tickIdx];
      if (!batch) return;

      // Add new providers crossing threshold when tick changes
      if (tickIdx !== lastTickRef.current) {
        lastTickRef.current = tickIdx;
        tickerClaimIdxRef.current = 0;
        lastTickerTimeRef.current = totalElapsed;
        setCrossings((prev) => {
          const newOnes = batch.providers_crossing_threshold;
          const combined = [...newOnes, ...prev];
          return combined.slice(0, 8);
        });
      }

      // Add ticker claim based on time within tick
      const tickerIntervalMs = TICK_MS_VAL / TICKER_PER_TICK;
      const sinceLastTicker = totalElapsed - lastTickerTimeRef.current;
      if (sinceLastTicker >= tickerIntervalMs) {
        lastTickerTimeRef.current = totalElapsed;
        const claims = batch.claims_sample;
        if (claims.length > 0) {
          const idx = tickerClaimIdxRef.current % claims.length;
          tickerClaimIdxRef.current++;
          const claim = claims[idx]!;
          const newRow: TickerRow = {
            id: `${tickIdx}-${idx}-${Date.now()}`,
            claim,
            isNew: true,
          };
          setTickerRows((prev) => {
            const updated = [...prev.slice(-20), newRow];
            return updated;
          });
        }
      }
    }, 80);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase, replayData, TICK_MS_VAL, TOTAL_MS]);

  const pause = useCallback(() => {
    if (phase !== "playing") return;
    pausedElapsedRef.current += Date.now() - startTimeRef.current;
    setPhase("paused");
  }, [phase]);

  const resume = useCallback(() => {
    if (phase !== "paused") return;
    startTimeRef.current = Date.now();
    setPhase("playing");
  }, [phase]);

  const reset = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setPhase("idle");
    setCurrentTick(0);
    setTickProgress(0);
    setTickerRows([]);
    setCrossings([]);
    pausedElapsedRef.current = 0;
    lastTickRef.current = 0;
    tickerClaimIdxRef.current = 0;
    lastTickerTimeRef.current = 0;
  }, []);

  const handleStart = useCallback(() => {
    if (replayData) {
      // Already have data — just start playing
      setShowIntro(false);
      beginPlaying();
    } else {
      startReplay();
    }
  }, [replayData, beginPlaying, startReplay]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); if (phase === "playing") pause(); else if (phase === "paused") resume(); }
      if (e.key === "r" || e.key === "R") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pause, resume, reset]);

  if (phase === "error") return <StaticCapacityView errorMsg={errorMsg} />;

  const overallProgress = replayData
    ? (currentTick - 1 + tickProgress) / TOTAL_TICKS
    : 0;

  const isActive = phase === "playing" || phase === "paused" || phase === "complete";
  const currentBatchLabel = replayData?.batches[currentTick - 1]?.label ?? "";

  return (
    <>
      {/* Intro overlay — shown during loading */}
      {showIntro && (phase === "loading" || (phase === "idle" && !replayData)) && (
        <SimulationLoadingIntro onDone={handleIntroDoneWithData} />
      )}

      <div style={{ padding: "0 24px 64px" }}>
        {/* ── Header ── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10, background: "rgba(248,250,252,0.95)",
          backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(30,41,59,0.08)",
          padding: "10px 0", marginBottom: 16,
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            {/* Control buttons */}
            {phase === "idle" && (
              <button onClick={handleStart}
                style={{ background: "#161b2e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Start replay
              </button>
            )}
            {phase === "playing" && (
              <button onClick={pause}
                style={{ background: "#161b2e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Pause
              </button>
            )}
            {phase === "paused" && (
              <button onClick={resume}
                style={{ background: "#161b2e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Resume
              </button>
            )}
            {phase === "complete" && (
              <button onClick={reset}
                style={{ background: "#161b2e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Run again
              </button>
            )}
            {isActive && phase !== "complete" && (
              <button onClick={reset}
                style={{ background: "transparent", color: "#667088", border: "1px solid rgba(30,41,59,0.2)", borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>
                Reset
              </button>
            )}

            {/* Speed control */}
            <div style={{ display: "flex", gap: 2, border: "1px solid rgba(30,41,59,0.15)", borderRadius: 6, overflow: "hidden" }}>
              {([1, 2, 4] as Speed[]).map((s) => (
                <button key={s} onClick={() => setSpeed(s)}
                  style={{
                    padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                    background: speed === s ? "#161b2e" : "transparent",
                    color: speed === s ? "#fff" : "#667088",
                  }}>{s}x</button>
              ))}
            </div>

            {/* Capacity */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: 12, color: "#667088" }}>Capacity</label>
              <input type="number" min={1} max={5000} value={capacity}
                onChange={(e) => setCapacity(Math.max(1, parseInt(e.target.value) || 100))}
                disabled={phase === "playing" || phase === "paused"}
                style={{
                  width: 64, padding: "5px 8px", fontSize: 12, borderRadius: 5, fontFamily: "ui-monospace,monospace",
                  border: "1px solid rgba(30,41,59,0.2)", background: "white", color: "#161b2e",
                }} />
              <span style={{ fontSize: 12, color: "#667088" }}>/ week</span>
            </div>

            {/* Progress */}
            {isActive && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <span style={{ fontSize: 12, color: "#667088", whiteSpace: "nowrap" }}>
                  {phase === "complete" ? "Complete" : currentBatchLabel || `Tick ${currentTick} of ${TOTAL_TICKS}`}
                </span>
                <div style={{ width: 120, height: 4, background: "rgba(30,41,59,0.1)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2, background: phase === "complete" ? "#059669" : "#3b82f6",
                    width: `${Math.min(100, Math.round((phase === "complete" ? 1 : overallProgress) * 100))}%`,
                    transition: "width 0.1s linear",
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Idle state */}
        {phase === "idle" && !replayData && (
          <div style={{ paddingTop: 40, textAlign: "center" }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: "#161b2e" }}>Claims replay simulation</h1>
            <p style={{ fontSize: 13, color: "#667088", maxWidth: 480, margin: "8px auto 0" }}>
              Replay 555,506 Medicare claims arriving over 2009 in six two-month batches. Four charts update in real time as claims are processed.
            </p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>
              {capacity} cases / week · {speed}x speed · ~{Math.round(TICK_MS[speed] * 6 / 1000)}s total run time
            </p>
          </div>
        )}

        {/* Active replay UI */}
        {isActive && replayData && (
          <>
            <ClaimTicker rows={tickerRows} />
            <div style={{ marginTop: 12 }}>
              <ChartGrid batches={replayData.batches} upToTick={currentTick} />
            </div>
            <CrossingList crossings={crossings} />
            {phase === "complete" && (
              <CompletionPanel summary={replayData.final_summary} capacity={capacity} />
            )}
          </>
        )}

        {/* Post-reset idle when data is already loaded */}
        {phase === "idle" && replayData && (
          <div style={{ paddingTop: 24, textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "#667088" }}>
              Ready to replay {replayData.final_summary.total_claims.toLocaleString()} claims at capacity {capacity}/week.
            </p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              Space to play · R to reset
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes tickerFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes crossingEntry {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes completionExpand {
          from { opacity: 0; transform: scaleY(0.95); transform-origin: top; }
          to { opacity: 1; transform: scaleY(1); }
        }
      `}</style>
    </>
  );
}

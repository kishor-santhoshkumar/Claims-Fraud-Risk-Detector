import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useSimulation } from '../../SimulationContext'
import { useModelInfo } from '../../hooks/useModelInfo'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { formatCurrencyCompact } from '../../utils/format'
import { getRiskTier } from '../../utils/risk'
import './SimulationLoadingOverlay.css'

// Cosmetic pacing ONLY -- these timers advance the pipeline visualization
// through its stages so the full one-by-one-entry -> pause -> split ->
// one-by-one-entry sequence always visibly plays once, even if the real
// response is faster than that. Nothing about the overlay's actual
// close/reveal is ever gated on a timer -- only `status === 'ready'` (see
// the effect below) does that, and only once 'scoring' has been reached.
const INTRO_MS = 900
const PAUSE_MS = 450
const SPLIT_MS = 1200
const DONE_SETTLE_MS = 800
const CLOSE_FADE_MS = 400

// Each dot's own short travel animation into a funnel, and the stagger
// offset between consecutive dots -- this is what makes 100 dots read as
// a fast individual stream ("one by one, rapidly") instead of a single
// group move or an instant static placement.
const STAGGER_MS = 20
const ENTER_DUR_MS = 200

// Visual cap on rendered dots -- illustrative (one dot ~ one provider),
// not a hard requirement that every provider get its own dot if the
// batch were ever much larger than today's 100.
const DOT_CAP = 100

// Used only until GET /model/info resolves (or if it fails) -- overridden
// immediately by the real `pass_rate` field the moment it's available, so
// the gate funnel's split ratio is never silently wrong for long. If
// /model/info's shape ever changes, re-check this field name.
const FALLBACK_PASS_RATE = 0.26

// ---------- scene geometry (shared by JS position math and CSS) ----------
// Two "screens" (Random Forest, then XGBoost) stacked in one tall track;
// the track slides up by one screen's height to transition between them,
// carrying the same surviving dot elements across rather than swapping
// them out for a fresh set.
const SCREEN_H = 380
const GRID_COLS = 10
const GRID_PITCH = 16
const GRID_BASE_X = 240
const GRID_BASE_Y = 24
const RF_ENTER_Y = 250
const RF_SPLIT_CONTINUE_Y = 300
const RF_SPLIT_REMOVED_Y = 230
const XGB_SETTLE_Y = SCREEN_H + 300

const COLOR_NEUTRAL = '#e2e8f0'
// Per spec: GREEN = filtered out / removed by the gate (exits the scene).
// RED = passed the gate, continues on into XGBoost scoring.
const COLOR_REMOVED = '#22c55e'
const COLOR_CONTINUES = '#ef4444'
const COLOR_PULSE = '#60a5fa'

function stageAfter(stage) {
  return { intro: 'entering-rf', 'entering-rf': 'pause', pause: 'split', split: 'to-xgb', 'to-xgb': 'scoring' }[stage]
}

function stageDurationMs(stage, dotCount, keptCount) {
  switch (stage) {
    case 'intro':
      return INTRO_MS
    // All `dotCount` dots stream in one by one -- total time scales with
    // the stagger so it stays readable regardless of batch size.
    case 'entering-rf':
      return dotCount * STAGGER_MS + ENTER_DUR_MS + 150
    case 'pause':
      return PAUSE_MS
    case 'split':
      return SPLIT_MS
    // Only the surviving (kept) dots stream into XGBoost -- a smaller
    // group, so this naturally finishes quickly; also covers the track
    // slide that brings the XGBoost funnel into view alongside it.
    case 'to-xgb':
      return Math.max(keptCount * STAGGER_MS + ENTER_DUR_MS + 300, 700)
    default:
      return null
  }
}

export default function SimulationLoadingOverlay() {
  const { status, error, results, providerCount, startSimulation } = useSimulation()
  const modelInfo = useModelInfo()
  const reducedMotion = useReducedMotion()

  // 'closed' | 'intro' | 'entering-rf' | 'pause' | 'split' | 'to-xgb' |
  // 'scoring' | 'done' | 'closing' | 'error'
  const [stage, setStage] = useState('closed')
  const prevStatusRef = useRef(status)

  const dotCount = Math.min(providerCount, DOT_CAP)
  const passRate = modelInfo.data?.pass_rate ?? FALLBACK_PASS_RATE
  const keptCount = Math.max(1, Math.round(dotCount * passRate))

  // Open a fresh Stage 1 whenever a real run starts -- covers both the
  // first-ever click and "Retry" after a failure (both flip status to
  // 'loading' via the same startSimulation()).
  useEffect(() => {
    if (status === 'loading' && prevStatusRef.current !== 'loading') {
      setStage('intro')
    } else if (status === 'error') {
      setStage('error')
    }
    prevStatusRef.current = status
  }, [status])

  // The fixed pipeline sequence, on local timers -- purely cosmetic
  // pacing for the visualization, independent of backend timing.
  // Interrupted immediately by the status effect above if a real error
  // lands mid-sequence.
  useEffect(() => {
    const next = stageAfter(stage)
    const ms = stageDurationMs(stage, dotCount, keptCount)
    if (!next || ms == null) return undefined
    const id = setTimeout(() => setStage(next), ms)
    return () => clearTimeout(id)
  }, [stage, dotCount, keptCount])

  // The ONLY thing allowed to resolve Stage 4: the real response landing.
  // Fires the instant `status` becomes 'ready' if we're already holding at
  // 'scoring'; if the response beat the cosmetic pacing here, this
  // re-checks the moment `stage` catches up to 'scoring'.
  useEffect(() => {
    if (stage === 'scoring' && status === 'ready') {
      setStage('done')
    }
  }, [stage, status])

  // Hold the resolved state briefly so it's visible, then fade and unmount.
  useEffect(() => {
    if (stage !== 'done') return undefined
    const id = setTimeout(() => setStage('closing'), DONE_SETTLE_MS)
    return () => clearTimeout(id)
  }, [stage])
  useEffect(() => {
    if (stage !== 'closing') return undefined
    const id = setTimeout(() => setStage('closed'), CLOSE_FADE_MS)
    return () => clearTimeout(id)
  }, [stage])

  // Real per-provider results only ever feed the visualization once the
  // real response has landed (stage 'done' or the 'closing' hold right
  // after it) -- never before, so no dot is ever colored by a guess.
  const realSurvivors = useMemo(() => {
    if (stage !== 'done' && stage !== 'closing') return null
    return results.filter((r) => r.gate_passed)
  }, [stage, results])

  const flaggedCount = useMemo(() => results.filter((r) => r.flagged).length, [results])
  const dollarsAtRisk = useMemo(
    () => results.filter((r) => r.flagged).reduce((sum, r) => sum + (r.expectedLoss || 0), 0),
    [results]
  )

  if (stage === 'closed') return null

  return (
    <div className={`sim-overlay-backdrop${stage === 'closing' ? ' is-closing' : ''}`} role="dialog" aria-modal="true">
      <div className="sim-overlay-content">
        {stage === 'error' ? (
          <ErrorPanel error={error} onRetry={startSimulation} />
        ) : reducedMotion ? (
          <ReducedMotionPanel
            stage={stage}
            dotCount={dotCount}
            keptCount={keptCount}
            realSurvivors={realSurvivors}
            flaggedCount={flaggedCount}
            dollarsAtRisk={dollarsAtRisk}
          />
        ) : (
          <AnimatedPanel
            stage={stage}
            dotCount={dotCount}
            keptCount={keptCount}
            realSurvivors={realSurvivors}
            flaggedCount={flaggedCount}
            dollarsAtRisk={dollarsAtRisk}
          />
        )}
      </div>
    </div>
  )
}

// ---------- error ----------

function ErrorPanel({ error, onRetry }) {
  return (
    <div className="sim-overlay-error">
      <div className="sim-overlay-error-icon">
        <AlertTriangle size={26} />
      </div>
      <h2 className="sim-overlay-title">Simulation failed</h2>
      <p className="sim-overlay-error-message">{error || 'The backend did not return a result.'}</p>
      <button type="button" className="sim-overlay-retry" onClick={onRetry}>
        <RotateCcw size={16} />
        Retry
      </button>
    </div>
  )
}

// ---------- shared copy ----------

function stageMeta(stage, { dotCount, keptCount, realSurvivors, flaggedCount, dollarsAtRisk }) {
  switch (stage) {
    case 'intro':
      return { label: 'Loading provider data', counter: `${dotCount} providers loaded` }
    case 'entering-rf':
    case 'pause':
    case 'split':
      return { label: 'Random Forest gate — filtering', counter: `Evaluating ${dotCount} providers…` }
    case 'to-xgb':
      return { label: 'Random Forest gate — filtering', counter: `${dotCount} → ${keptCount} passed the gate` }
    case 'scoring':
      return { label: 'XGBoost — scoring', counter: `${keptCount} providers in progress` }
    case 'done':
    case 'closing':
      return {
        label: `Done — ${flaggedCount} flagged, ${formatCurrencyCompact(dollarsAtRisk)} at risk`,
        counter: `${realSurvivors?.length ?? keptCount} providers scored`,
      }
    default:
      return { label: '', counter: '' }
  }
}

// ---------- reduced-motion fallback ----------

const STAGE_PROGRESS = {
  intro: 8,
  'entering-rf': 30,
  pause: 40,
  split: 52,
  'to-xgb': 65,
  scoring: 80,
  done: 100,
  closing: 100,
}

function ReducedMotionPanel(props) {
  const { stage } = props
  const meta = stageMeta(stage, props)
  return (
    <div className="sim-overlay-reduced">
      <p className="sim-overlay-label">{meta.label}</p>
      <div className="sim-overlay-reduced-track">
        <div className="sim-overlay-reduced-fill" style={{ width: `${STAGE_PROGRESS[stage] || 0}%` }} />
      </div>
      <p className="sim-overlay-counter">{meta.counter}</p>
    </div>
  )
}

// ---------- animated panel ----------

// Per-dot inline style for the current stage. Kept (gate-passed) dots are
// the SAME element (same key, never remounted) all the way from 'intro'
// through 'done', which is what makes the Random Forest -> XGBoost
// transition read as the same providers carrying over rather than a
// fresh set appearing. Removed dots stop being rendered once their
// fade-out completes (return null past 'split').
//
// `delay`/`duration` drive a per-dot CSS transition: during the two
// "entering a funnel" stages every dot gets its own short (ENTER_DUR_MS)
// move with an individual stagger (i * STAGGER_MS), which is what reads
// as a fast one-by-one stream rather than a single synchronized group
// move or an instant jump to the end state.
function dotVisual(stage, i, keptCount, realSurvivors) {
  const isKept = i < keptCount
  const col = i % GRID_COLS
  const row = Math.floor(i / GRID_COLS)
  const x = GRID_BASE_X + col * GRID_PITCH
  const baseY = GRID_BASE_Y + row * GRID_PITCH
  const driftDx = ((i * 53) % 240) - 120

  switch (stage) {
    case 'intro':
      return { x, y: baseY, opacity: 1, background: COLOR_NEUTRAL, delay: i * 4, duration: 350 }
    case 'entering-rf':
      return { x, y: RF_ENTER_Y, opacity: 1, background: COLOR_NEUTRAL, delay: i * STAGGER_MS, duration: ENTER_DUR_MS }
    case 'pause':
      return { x, y: RF_ENTER_Y, opacity: 1, background: COLOR_NEUTRAL, delay: 0, duration: 0 }
    case 'split':
      if (isKept) {
        return { x, y: RF_SPLIT_CONTINUE_Y, opacity: 1, background: COLOR_CONTINUES, delay: 0, duration: 550 }
      }
      return { x: x + driftDx, y: RF_SPLIT_REMOVED_Y, opacity: 0, background: COLOR_REMOVED, delay: 0, duration: 550 }
    case 'to-xgb':
      if (!isKept) return null
      // Re-enters one by one, same stagger pattern as the RF funnel, just
      // over the (smaller) surviving group -- `i` is already 0..keptCount-1
      // for kept dots since "kept" is defined as the first `keptCount` indices.
      return {
        x,
        y: XGB_SETTLE_Y,
        opacity: 1,
        background: COLOR_CONTINUES,
        delay: i * STAGGER_MS,
        duration: ENTER_DUR_MS,
      }
    case 'scoring':
      if (!isKept) return null
      return { x, y: XGB_SETTLE_Y, opacity: 1, background: COLOR_PULSE, delay: 0, duration: 400, pulsing: true }
    case 'done':
    case 'closing': {
      if (!isKept) return null
      const real = realSurvivors?.[i]
      if (!real) return { x, y: XGB_SETTLE_Y, opacity: 0, background: COLOR_PULSE, delay: 0, duration: 300 }
      const tier = getRiskTier(real.fraud_probability)
      const tierColor = tier === 'high' ? '#ef4444' : tier === 'medium' ? '#f59e0b' : '#64748b'
      return { x, y: XGB_SETTLE_Y, opacity: 1, background: tierColor, delay: 0, duration: 350, settle: true }
    }
    default:
      return null
  }
}

function AnimatedPanel(props) {
  const { stage, dotCount, keptCount, realSurvivors } = props
  const meta = stageMeta(stage, props)
  const showTrack = stage !== 'intro'
  const trackShifted = ['to-xgb', 'scoring', 'done', 'closing'].includes(stage)

  return (
    <div className="sim-overlay-animated">
      <p className="sim-overlay-label">{meta.label}</p>
      <p className="sim-overlay-counter">{meta.counter}</p>

      <div className="sim-overlay-stage-area">
        <div className={`sim-overlay-track${trackShifted ? ' is-shifted' : ''}`}>
          {showTrack && (
            <>
              <Funnel label="RANDOM FOREST" tone="rf" top={170} />
              <Funnel label="XGBOOST" tone="xgb" top={SCREEN_H + 170} />
            </>
          )}
          {Array.from({ length: dotCount }, (_, i) => {
            const v = dotVisual(stage, i, keptCount, realSurvivors)
            if (!v) return null
            return (
              <span
                key={i}
                className={`sim-overlay-dot2${v.pulsing ? ' is-pulsing' : ''}${v.settle ? ' is-settling' : ''}`}
                style={{
                  transform: `translate(${v.x}px, ${v.y}px)`,
                  opacity: v.opacity,
                  background: v.background,
                  transitionDelay: `${v.delay}ms`,
                  transitionDuration: `${v.duration}ms`,
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Funnel({ label, tone, top }) {
  return (
    <div className={`sim-overlay-funnel sim-overlay-funnel--${tone}`} style={{ top }}>
      <span className="sim-overlay-funnel-label">{label}</span>
      <svg viewBox="0 0 320 130" preserveAspectRatio="none" className="sim-overlay-funnel-svg" aria-hidden="true">
        <polygon points="8,8 312,8 210,122 110,122" />
      </svg>
    </div>
  )
}

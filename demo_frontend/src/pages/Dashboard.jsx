import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BarChart3, Clock, DollarSign, ListChecks, RotateCcw } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import { getModelInfo } from '../api'
import StatCard from '../components/StatCard'
import ProviderRow from '../components/ProviderRow'
import SimulationGate from '../components/simulation/SimulationGate'
import { formatCurrencyCompact, formatRelativeTime, getGreeting, getTodayLong } from '../utils/format'
import { DECISION_META, DECISION_TYPES } from '../utils/decisions'
import './Dashboard.css'

export default function Dashboard() {
  const { user } = useAuth()
  const { status, results, lastRunAt, startSimulation } = useSimulation()

  const firstName = user?.name?.split(' ')[0] || 'there'

  // Real model/training metadata (GET /model/info) -- independent of
  // whether a simulation has been run, so it can ground the page even
  // before "Start simulation" is clicked. Non-critical: any failure just
  // hides the footer rather than showing an error (see ModelInfoFooter).
  const [modelInfo, setModelInfo] = useState(null)
  useEffect(() => {
    let cancelled = false
    getModelInfo()
      .then((data) => {
        if (!cancelled) setModelInfo(data)
      })
      .catch(() => {
        if (!cancelled) setModelInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="dashboard-page">
      <header className="dashboard-header-row">
        <div>
          <h1 className="dashboard-greeting">
            {getGreeting()}, {firstName}
          </h1>
          <p className="dashboard-date">{getTodayLong()}</p>
        </div>
        <div className="dashboard-header-actions">
          {status !== 'idle' && (
            <button
              type="button"
              className="sim-rerun-button"
              onClick={startSimulation}
              disabled={status === 'loading'}
            >
              <RotateCcw size={15} />
              Re-run simulation
            </button>
          )}
          <Link to="/queue" className="dashboard-cta">
            Open queue
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <SimulationGate emptyDescription="Run the two-stage cascade against real provider feature data to populate this dashboard. Until then, no stats or lists below are shown.">
        <DashboardReady results={results} lastRunAt={lastRunAt} />
      </SimulationGate>

      <ModelInfoFooter modelInfo={modelInfo} />
    </div>
  )
}

function DashboardReady({ results, lastRunAt }) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const flaggedResults = results.filter((r) => r.flagged)
  const highRiskCount = results.filter((r) => r.riskTier === 'high').length
  const dollarsAtRisk = flaggedResults.reduce(
    (sum, r) => sum + (r.expectedLoss || 0),
    0
  )
  const topProviders = [...results]
    .sort((a, b) => b.fraud_probability - a.fraud_probability)
    .slice(0, 5)

  // Shared aggregate for the new review-progress bar and escalated callout
  // below -- computed independently from (and identically to) the Run
  // info card's own decision counts, so that existing card's logic is
  // left completely untouched while these two new features stay correct.
  const decisionStats = useMemo(() => {
    const counts = { confirmed: 0, cleared: 0, escalated: 0 }
    for (const r of results) {
      const d = decisionsByProviderId[r.provider_id]
      if (d && d.decision in counts) counts[d.decision] += 1
    }
    const decided = counts.confirmed + counts.cleared + counts.escalated
    return { ...counts, decided, total: results.length }
  }, [results, decisionsByProviderId])

  return (
    <>
      {decisionStats.escalated > 0 && (
        <div className="dashboard-escalated-callout">
          <AlertTriangle size={17} />
          <span>
            <strong>{decisionStats.escalated}</strong> case{decisionStats.escalated === 1 ? '' : 's'} escalated for
            review
          </span>
          <Link to="/queue" className="dashboard-escalated-link">
            View queue
            <ArrowRight size={13} />
          </Link>
        </div>
      )}

      <div className="dashboard-stats">
        <StatCard label="Providers scored" value={results.length} icon={ListChecks} tone="blue" />
        <StatCard
          label="Flagged"
          value={flaggedResults.length}
          sublabel={`of ${results.length} scored`}
          icon={AlertTriangle}
          tone="amber"
        />
        <StatCard
          label="High risk providers"
          value={highRiskCount}
          sublabel="fraud_probability ≥ 0.7"
          icon={AlertTriangle}
          tone="red"
        />
        <StatCard
          label="Dollars at risk"
          value={formatCurrencyCompact(dollarsAtRisk)}
          sublabel="Σ (fraud_probability × billed), flagged only"
          icon={DollarSign}
          tone="blue"
        />
      </div>

      <div className="dashboard-below-stats">
        <div className="dashboard-progress">
          <div className="dashboard-progress-label">
            <span>Review progress</span>
            <span>
              {decisionStats.decided} of {decisionStats.total} reviewed
            </span>
          </div>
          <div className="dashboard-progress-track">
            <div
              className="dashboard-progress-fill"
              style={{ width: `${decisionStats.total ? (decisionStats.decided / decisionStats.total) * 100 : 0}%` }}
            />
          </div>
        </div>
        <Link to="/analytics" className="dashboard-analytics-link">
          <BarChart3 size={13} />
          View analytics
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-card">
          <h2 className="dashboard-card-title">Top risk providers</h2>
          <div className="dashboard-provider-list">
            {topProviders.map((result, i) => (
              <ProviderRow key={result.provider_id} rank={i + 1} result={result} />
            ))}
          </div>
          <Link to="/queue" className="dashboard-card-link">
            View full queue
            <ArrowRight size={14} />
          </Link>
        </section>

        <div className="dashboard-side-column">
          <section className="dashboard-card">
            <h2 className="dashboard-card-title">Run info</h2>
            <dl className="dashboard-run-info">
              <div className="dashboard-run-info-row">
                <dt>Last run</dt>
                <dd>{lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : '—'}</dd>
              </div>
              <div className="dashboard-run-info-row">
                <dt>Providers scored</dt>
                <dd>{results.length}</dd>
              </div>
              <div className="dashboard-run-info-row">
                <dt>Flagged</dt>
                <dd>{flaggedResults.length}</dd>
              </div>
            </dl>
            <p className="dashboard-run-info-divider">Investigator decisions</p>
            <DecisionCounts results={results} decisionsByProviderId={decisionsByProviderId} />
          </section>

          <RecentActivity decisionsByProviderId={decisionsByProviderId} />
        </div>
      </div>
    </>
  )
}

function DecisionCounts({ results, decisionsByProviderId }) {
  const counts = { confirmed: 0, cleared: 0, escalated: 0 }
  for (const r of results) {
    const d = decisionsByProviderId[r.provider_id]
    if (d && d.decision in counts) counts[d.decision] += 1
  }
  const decidedCount = counts.confirmed + counts.cleared + counts.escalated
  const unreviewedCount = results.length - decidedCount

  return (
    <dl className="dashboard-run-info">
      {DECISION_TYPES.map((type) => (
        <div className="dashboard-run-info-row" key={type}>
          <dt>{DECISION_META[type].badgeLabel}</dt>
          <dd className={`dashboard-decision-count dashboard-decision-count--${DECISION_META[type].tone}`}>
            {counts[type]}
          </dd>
        </div>
      ))}
      <div className="dashboard-run-info-row">
        <dt>Unreviewed</dt>
        <dd>
          {unreviewedCount} of {results.length}
        </dd>
      </div>
    </dl>
  )
}

// Most recent investigator decisions, real data from the same GET /decisions
// response DecisionsContext already fetches after every simulation run (see
// layout/AppShell.jsx) -- reading it here avoids a second, redundant fetch
// of the same endpoint and keeps this feed in lockstep with the Run info
// card's counts and the Queue page's badges (all read from the same map).
function RecentActivity({ decisionsByProviderId }) {
  const allDecisions = useMemo(
    () =>
      Object.values(decisionsByProviderId).sort(
        (a, b) => new Date(b.decided_at) - new Date(a.decided_at)
      ),
    [decisionsByProviderId]
  )
  const recent = allDecisions.slice(0, 5)

  return (
    <section className="dashboard-card">
      <h2 className="dashboard-card-title">Recent activity</h2>
      {recent.length === 0 ? (
        <div className="dashboard-activity-empty">
          <p>No decisions recorded yet.</p>
          <Link to="/queue" className="dashboard-card-link">
            Open queue
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          <ul className="dashboard-activity-list">
            {recent.map((decision) => {
              const meta = DECISION_META[decision.decision]
              const Icon = meta.icon
              return (
                <li className="dashboard-activity-row" key={`${decision.provider_id}-${decision.decided_at}`}>
                  <span className={`dashboard-activity-icon dashboard-activity-icon--${meta.tone}`}>
                    <Icon size={14} />
                  </span>
                  <span className="dashboard-activity-id">{decision.provider_id}</span>
                  <span className={`dashboard-activity-label dashboard-activity-label--${meta.tone}`}>
                    {meta.badgeLabel}
                  </span>
                  <span className="dashboard-activity-time">
                    <Clock size={11} />
                    {formatRelativeTime(new Date(decision.decided_at).getTime())}
                  </span>
                </li>
              )
            })}
          </ul>
          {allDecisions.length > 5 && (
            <Link to="/queue" className="dashboard-card-link">
              View all
              <ArrowRight size={14} />
            </Link>
          )}
        </>
      )}
    </section>
  )
}

// Grounds the numbers above in the real deployed model artifact (GET
// /model/info). Non-critical supplementary info -- renders nothing at all
// if the fetch hasn't resolved yet or failed, rather than an error state.
function ModelInfoFooter({ modelInfo }) {
  if (!modelInfo) return null
  return (
    <p className="dashboard-model-footer">
      Model: {modelInfo.architecture} · {modelInfo.feature_count} features · gate target recall{' '}
      {Math.round(modelInfo.gate_target_recall * 100)}% · last trained on{' '}
      {modelInfo.trained_rows.toLocaleString()} providers
    </p>
  )
}

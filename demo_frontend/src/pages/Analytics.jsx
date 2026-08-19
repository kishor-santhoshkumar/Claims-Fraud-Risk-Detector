import { useMemo } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, DollarSign, ListChecks, Percent, RotateCcw } from 'lucide-react'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import { useRuleFireRates } from '../hooks/useRuleFireRates'
import { useShapImportance } from '../hooks/useShapImportance'
import StatCard from '../components/StatCard'
import SeverityBadge from '../components/SeverityBadge'
import SimulationGate from '../components/simulation/SimulationGate'
import { formatCurrencyCompact } from '../utils/format'
import './Analytics.css'

// Same status-color tokens used everywhere else in the app (rule
// severity badges, decision buttons, risk badges) -- not a new palette.
const RISK_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' }
const DECISION_COLORS = { confirmed: '#ef4444', cleared: '#10b981', escalated: '#f59e0b', unreviewed: '#64748b' }
const CHART_TEXT = '#64748b'
const CHART_GRID = 'rgba(15,23,42,0.08)'

export default function Analytics() {
  const { results } = useSimulation()

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <h1>Analytics</h1>
        <p>Batch-wide view — how the whole scored set looks, not any one provider.</p>
      </header>

      <SimulationGate emptyDescription="Run a simulation to see batch-wide analytics — rule fire rates, model feature importance, and decision progress across every scored provider.">
        <AnalyticsReady results={results} />
      </SimulationGate>
    </div>
  )
}

function AnalyticsReady({ results }) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const providerIds = useMemo(() => results.map((r) => r.provider_id), [results])

  const ruleFireRates = useRuleFireRates(providerIds)
  const shapImportance = useShapImportance(providerIds)

  // ---- metrics computed from data already held client-side (no fetch) ----
  const flaggedResults = results.filter((r) => r.flagged)
  const highRiskCount = results.filter((r) => r.fraud_probability >= 0.7).length
  // Same formula as Dashboard.jsx's Run info card: Σ fraud_probability × billed, flagged only.
  const dollarsAtRisk = flaggedResults.reduce((sum, r) => sum + (r.expectedLoss || 0), 0)

  const decisionCounts = { confirmed: 0, cleared: 0, escalated: 0 }
  for (const r of results) {
    const d = decisionsByProviderId[r.provider_id]
    if (d && d.decision in decisionCounts) decisionCounts[d.decision] += 1
  }
  const decisionsMade = decisionCounts.confirmed + decisionCounts.cleared + decisionCounts.escalated
  const unreviewedCount = results.length - decisionsMade
  const confirmClearTotal = decisionCounts.confirmed + decisionCounts.cleared
  const confirmationRate = confirmClearTotal > 0 ? (decisionCounts.confirmed / confirmClearTotal) * 100 : null

  const riskTierCounts = { high: 0, medium: 0, low: 0 }
  for (const r of results) {
    if (r.riskTier in riskTierCounts) riskTierCounts[r.riskTier] += 1
  }
  const riskTierData = ['high', 'medium', 'low'].map((tier) => ({
    name: tier === 'high' ? 'High' : tier === 'medium' ? 'Medium' : 'Low',
    tier,
    value: riskTierCounts[tier],
    pct: results.length ? (riskTierCounts[tier] / results.length) * 100 : 0,
  }))

  const decisionChartData = [
    { name: 'Confirmed', key: 'confirmed', value: decisionCounts.confirmed },
    { name: 'Cleared', key: 'cleared', value: decisionCounts.cleared },
    { name: 'Escalated', key: 'escalated', value: decisionCounts.escalated },
    { name: 'Unreviewed', key: 'unreviewed', value: unreviewedCount },
  ]

  return (
    <>
      <div className="analytics-metrics">
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
        <StatCard label="Dollars at risk" value={formatCurrencyCompact(dollarsAtRisk)} icon={DollarSign} tone="blue" />
        <StatCard
          label="Decisions made"
          value={decisionsMade}
          sublabel={`of ${results.length} scored`}
          icon={CheckCircle2}
          tone="blue"
        />
        <StatCard
          label="Confirmation rate"
          value={confirmationRate != null ? `${confirmationRate.toFixed(0)}%` : '—'}
          sublabel="confirmed / (confirmed + cleared)"
          icon={Percent}
          tone="blue"
        />
      </div>

      <div className="analytics-grid">
        <section className="analytics-card">
          <h2 className="analytics-card-title">Risk tier distribution</h2>
          <p className="analytics-card-subtitle">
            High / medium / low, from each provider's fraud_probability
          </p>
          <div className="analytics-donut-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={riskTierData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {riskTierData.map((entry) => (
                    <Cell key={entry.tier} fill={RISK_COLORS[entry.tier]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name, item) => [`${value} (${item.payload.pct.toFixed(0)}%)`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <ul className="analytics-legend">
              {riskTierData.map((entry) => (
                <li key={entry.tier} className="analytics-legend-item">
                  <span className="analytics-legend-swatch" style={{ background: RISK_COLORS[entry.tier] }} />
                  <span className="analytics-legend-label">{entry.name}</span>
                  <span className="analytics-legend-value">
                    {entry.value} ({entry.pct.toFixed(0)}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="analytics-card">
          <h2 className="analytics-card-title">Investigator decisions</h2>
          <p className="analytics-card-subtitle">Confirmed / cleared / escalated / unreviewed</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={decisionChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: CHART_TEXT, fontSize: 11 }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: CHART_TEXT, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {decisionChartData.map((entry) => (
                  <Cell key={entry.key} fill={DECISION_COLORS[entry.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        <RuleFireRatesSection state={ruleFireRates} />
        <ShapImportanceSection state={shapImportance} />
      </div>
    </>
  )
}

function RuleFireRatesSection({ state }) {
  return (
    <section className="analytics-card analytics-card--wide">
      <h2 className="analytics-card-title">Rule fire rates</h2>
      <p className="analytics-card-subtitle">Share of scored providers each rule fired on</p>
      {state.status === 'loading' && <ChartSkeleton />}
      {state.status === 'error' && <ChartError message={state.error} onRetry={state.retry} />}
      {state.status === 'ready' && (
        <ResponsiveContainer width="100%" height={Math.max(160, state.data.rules.length * 44)}>
          <BarChart
            data={state.data.rules}
            layout="vertical"
            margin={{ top: 4, right: 24, left: 12, bottom: 4 }}
            barCategoryGap={10}
          >
            <XAxis
              type="number"
              domain={[0, Math.max(0.1, ...state.data.rules.map((r) => r.fire_rate))]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fill: CHART_TEXT, fontSize: 11 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={180}
              tick={<RuleTick rules={state.data.rules} />}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              formatter={(value, _name, item) => [
                `${item.payload.providers_fired} of ${state.data.total_providers} providers (${Math.round(value * 100)}%)`,
                'Fired',
              ]}
            />
            <Bar dataKey="fire_rate" fill="#3b82f6" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  )
}

// Custom Y-axis tick: rule name + its real severity badge, side by side --
// reuses SeverityBadge, the same component/colors as Rule findings on
// Case file (see components/SeverityBadge.jsx for why it's a standalone
// copy rather than an import from that page).
function RuleTick({ x, y, payload, rules }) {
  const rule = rules.find((r) => r.name === payload.value)
  if (!rule) return null
  return (
    <foreignObject x={x - 176} y={y - 12} width={172} height={24}>
      <div className="analytics-rule-tick">
        <SeverityBadge severity={rule.severity} />
        <span className="analytics-rule-tick-label">{rule.name}</span>
      </div>
    </foreignObject>
  )
}

function ShapImportanceSection({ state }) {
  return (
    <section className="analytics-card analytics-card--wide">
      <h2 className="analytics-card-title">Model-wide feature importance</h2>
      <p className="analytics-card-subtitle">
        What the model weighs most, across all providers — distinct from the per-provider
        Model signals on a Case file
      </p>
      {state.status === 'loading' && <ChartSkeleton />}
      {state.status === 'error' && <ChartError message={state.error} onRetry={state.retry} />}
      {state.status === 'ready' && (
        <ResponsiveContainer width="100%" height={Math.max(160, state.data.features.length * 34)}>
          <BarChart
            data={state.data.features}
            layout="vertical"
            margin={{ top: 4, right: 24, left: 12, bottom: 4 }}
            barCategoryGap={8}
          >
            <XAxis type="number" tick={{ fill: CHART_TEXT, fontSize: 11 }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
            <YAxis
              type="category"
              dataKey="display_name"
              width={190}
              tick={{ fill: '#334155', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              formatter={(value) => [value.toFixed(3), 'Avg |SHAP|']}
            />
            <Bar dataKey="avg_abs_shap" fill="#6366f1" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  )
}

function ChartSkeleton() {
  return (
    <div className="analytics-chart-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="analytics-chart-skeleton-row" />
      ))}
    </div>
  )
}

function ChartError({ message, onRetry }) {
  return (
    <div className="analytics-chart-error">
      <AlertTriangle size={15} />
      <span>{message || 'Unavailable'}</span>
      <button type="button" className="analytics-chart-retry" onClick={onRetry}>
        <RotateCcw size={13} />
        Retry
      </button>
    </div>
  )
}

const tooltipStyle = {
  background: 'rgba(255,255,255,0.95)',
  border: '1px solid rgba(15,23,42,0.1)',
  borderRadius: 8,
  fontSize: 12.5,
  color: '#1f2937',
  boxShadow: '0 8px 24px rgba(76,81,219,0.15)',
}

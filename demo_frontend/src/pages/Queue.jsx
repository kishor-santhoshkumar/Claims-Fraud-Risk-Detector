import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import ProviderRow from '../components/ProviderRow'
import SimulationGate from '../components/simulation/SimulationGate'
import { DECISION_META, DECISION_TYPES } from '../utils/decisions'
import './Queue.css'

const STATUS_FILTERS = ['all', 'unreviewed', ...DECISION_TYPES]

export default function Queue() {
  const { results } = useSimulation()
  const location = useLocation()
  // Set by DecisionBar's navigate() when there's no next unreviewed provider.
  const allReviewedMessage = location.state?.message

  return (
    <div className="queue-page">
      <header className="queue-header">
        <h1>Provider queue</h1>
      </header>

      {allReviewedMessage && (
        <div className="queue-banner">
          <CheckCircle2 size={15} />
          {allReviewedMessage}
        </div>
      )}

      <SimulationGate
        emptyTitle="No simulation has been run yet"
        emptyDescription="The queue is empty until a simulation is run — real results appear here the moment the backend responds."
      >
        <QueueReady results={results} />
      </SimulationGate>
    </div>
  )
}

function QueueReady({ results }) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const [statusFilter, setStatusFilter] = useState('all')

  const sorted = useMemo(
    () => [...results].sort((a, b) => b.fraud_probability - a.fraud_probability),
    [results]
  )

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return sorted
    if (statusFilter === 'unreviewed') {
      return sorted.filter((r) => !decisionsByProviderId[r.provider_id])
    }
    return sorted.filter((r) => decisionsByProviderId[r.provider_id]?.decision === statusFilter)
  }, [sorted, statusFilter, decisionsByProviderId])

  return (
    <>
      <div className="queue-toolbar">
        <div className="queue-status-filter">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`queue-status-chip${statusFilter === filter ? ' is-active' : ''}`}
              onClick={() => setStatusFilter(filter)}
            >
              {filter === 'all' ? 'All' : filter === 'unreviewed' ? 'Unreviewed' : DECISION_META[filter].badgeLabel}
            </button>
          ))}
        </div>
        <p className="queue-subheader">
          {filtered.length} of {sorted.length} providers, sorted by fraud_probability (descending)
        </p>
      </div>
      <div className="queue-card">
        {filtered.length === 0 ? (
          <p className="queue-empty">No providers match this filter.</p>
        ) : (
          filtered.map((result, i) => (
            <ProviderRow
              key={result.provider_id}
              rank={i + 1}
              result={result}
              decision={decisionsByProviderId[result.provider_id] || null}
            />
          ))
        )}
      </div>
    </>
  )
}

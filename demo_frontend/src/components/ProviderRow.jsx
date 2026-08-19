import { useNavigate } from 'react-router-dom'
import { RISK_TIER_LABEL } from '../utils/risk'
import { formatCurrencyCompact } from '../utils/format'
import { DECISION_META } from '../utils/decisions'
import './ProviderRow.css'

// `result` is an entry from the global simulation state (SimulationContext):
// real backend fields (provider_id, fraud_probability, flagged, ...) plus
// riskTier/expectedLoss computed once in the context from real inputs.
// Used on the Dashboard "Top risk providers" preview and the full Queue page.
//
// `decision` is optional and only used by the Queue page: pass a real
// decision record to show its badge, or `null` to show "Unreviewed".
// Omit entirely (Dashboard's usage) to hide the decision column altogether.
export default function ProviderRow({ rank, result, decision }) {
  const navigate = useNavigate()
  const showDecisionColumn = decision !== undefined

  return (
    <button
      type="button"
      className={`provider-row${showDecisionColumn ? ' provider-row--with-decision' : ''}`}
      onClick={() => navigate(`/case/${result.provider_id}`)}
    >
      <span className="provider-row-rank">{rank}</span>
      <span className="provider-row-id">{result.provider_id}</span>
      {showDecisionColumn && (
        <span
          className={`provider-row-decision provider-row-decision--${
            decision ? DECISION_META[decision.decision].tone : 'unreviewed'
          }`}
        >
          {decision ? DECISION_META[decision.decision].badgeLabel : 'Unreviewed'}
        </span>
      )}
      <span className={`provider-row-badge provider-row-badge--${result.riskTier}`}>
        {RISK_TIER_LABEL[result.riskTier]}
      </span>
      <span className="provider-row-score">{(result.fraud_probability * 100).toFixed(1)}%</span>
      <span className="provider-row-loss">
        {result.expectedLoss != null ? formatCurrencyCompact(result.expectedLoss) : '—'}
      </span>
    </button>
  )
}

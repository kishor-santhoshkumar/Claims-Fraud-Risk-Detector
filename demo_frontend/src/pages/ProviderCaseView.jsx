import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useSimulation } from '../SimulationContext'
import { useProviderClaims } from '../hooks/useProviderClaims'
import { useProviderEvidence } from '../hooks/useProviderEvidence'
import { useProviderShap } from '../hooks/useProviderShap'
import { RISK_TIER_LABEL } from '../utils/risk'
import { formatCurrencyCompact, formatOrdinal, formatRuleId } from '../utils/format'
import EvidenceNotAvailable from '../components/EvidenceNotAvailable'
import DecisionBar from '../components/decision/DecisionBar'
import SimulationEmptyState from '../components/simulation/SimulationEmptyState'
import SimulationLoadingState from '../components/simulation/SimulationLoadingState'
import SimulationErrorState from '../components/simulation/SimulationErrorState'
import './ProviderCaseView.css'

// Shared by CaseFile / Clearance: both show the same real fields
// (fraud_probability, flagged, gate_passed, provider_id) from the global
// simulation state. `evidenceLabel` is the fallback "not available yet"
// copy, still used as-is on Clearance (no clearance-rationale backend
// exists). `showClaimsLink`/`showRuleEvidence`/`showDecisionBar` opt a
// page into the real claims-count link, rule engine findings, SHAP model
// signals, and investigator decision actions respectively (CaseFile
// only, per spec) -- all wait for their own real data before rendering
// anything, and fetch independently/in parallel (a SHAP failure doesn't
// block Rule findings or vice versa).
export default function ProviderCaseView({
  title,
  evidenceLabel,
  showClaimsLink = false,
  showRuleEvidence = false,
  showModelSignals = false,
  showDecisionBar = false,
}) {
  const { providerId } = useParams()
  const navigate = useNavigate()
  const { status, getResultFor } = useSimulation()
  const claimsCount = useProviderClaims(providerId, { limit: 1, enabled: showClaimsLink })
  const evidence = useProviderEvidence(providerId, { enabled: showRuleEvidence })
  const shap = useProviderShap(providerId, { enabled: showModelSignals })

  return (
    <div className="case-view">
      <button type="button" className="case-view-back" onClick={() => navigate('/queue')}>
        <ArrowLeft size={15} />
        Back to queue
      </button>

      <h1 className="case-view-title">{title}</h1>
      <p className="case-view-id">{providerId}</p>

      {showClaimsLink && claimsCount.status === 'ready' && (
        <Link to={`/claims/${providerId}`} className="case-view-claims-link">
          View all {claimsCount.data.total_claims.toLocaleString()} claims
          <ArrowRight size={14} />
        </Link>
      )}

      {status === 'idle' && <SimulationEmptyState />}
      {status === 'loading' && <SimulationLoadingState />}
      {status === 'error' && <SimulationErrorState />}
      {status === 'ready' && (
        <CaseViewReady
          providerId={providerId}
          result={getResultFor(providerId)}
          evidenceLabel={evidenceLabel}
          showRuleEvidence={showRuleEvidence}
          evidence={evidence}
          showModelSignals={showModelSignals}
          shap={shap}
          showDecisionBar={showDecisionBar}
        />
      )}
    </div>
  )
}

function CaseViewReady({
  providerId,
  result,
  evidenceLabel,
  showRuleEvidence,
  evidence,
  showModelSignals,
  shap,
  showDecisionBar,
}) {
  if (!result) {
    return (
      <p className="case-view-missing">
        No result for provider <code>{providerId}</code> in the most recent simulation run.
      </p>
    )
  }

  return (
    <>
      <div className="case-view-summary">
        <div className="case-view-metric">
          <span className="case-view-metric-label">Fraud probability</span>
          <span className="case-view-metric-value">
            {(result.fraud_probability * 100).toFixed(1)}%
          </span>
        </div>
        <div className="case-view-metric">
          <span className="case-view-metric-label">Risk tier</span>
          <span className={`case-view-badge case-view-badge--${result.riskTier}`}>
            {RISK_TIER_LABEL[result.riskTier]}
          </span>
        </div>
        <div className="case-view-metric">
          <span className="case-view-metric-label">Flagged</span>
          <span className="case-view-flag">
            {result.flagged ? (
              <CheckCircle2 size={15} color="#dc2626" />
            ) : (
              <XCircle size={15} color="#059669" />
            )}
            {result.flagged ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="case-view-metric">
          <span className="case-view-metric-label">Gate passed</span>
          <span className="case-view-metric-value case-view-metric-value--small">
            {result.gate_passed ? 'Yes' : 'No'}
          </span>
        </div>
        {result.expectedLoss != null && (
          <div className="case-view-metric">
            <span className="case-view-metric-label">Expected loss</span>
            <span className="case-view-metric-value case-view-metric-value--small">
              {formatCurrencyCompact(result.expectedLoss)}
            </span>
          </div>
        )}
      </div>

      {showModelSignals && <ModelSignalsSection shap={shap} />}

      {showRuleEvidence ? (
        <RuleEvidenceSection providerId={providerId} evidence={evidence} />
      ) : (
        <EvidenceNotAvailable label={evidenceLabel} />
      )}

      {showDecisionBar && <DecisionBar providerId={providerId} />}
    </>
  )
}

function buildClaimFilterParams(finding) {
  return new URLSearchParams({
    claimIds: finding.matching_claim_ids.join(','),
    ruleLabel: formatRuleId(finding.rule_id),
  })
}

function RuleEvidenceSection({ providerId, evidence }) {
  const { status, data, error, retry } = evidence

  if (status === 'loading') {
    return <p className="case-evidence-loading">Loading rule findings…</p>
  }

  if (status === 'error') {
    return (
      <div className="case-evidence-error">
        <AlertTriangle size={15} />
        <span>{error}</span>
        <button type="button" className="case-evidence-retry" onClick={retry}>
          <RotateCcw size={13} />
          Retry
        </button>
      </div>
    )
  }

  if (status !== 'ready') return null

  if (data.rules_fired === 0) {
    return (
      <div className="case-evidence-clean">
        <ShieldCheck size={16} />
        <span>
          No rule findings — passed all {data.rules_evaluated} checks.
        </span>
      </div>
    )
  }

  return (
    <div className="case-evidence-section">
      <h2 className="case-evidence-title">
        Rule findings
        <span className="case-evidence-count">
          {data.rules_fired} of {data.rules_evaluated} checks fired
        </span>
      </h2>
      <div className="case-evidence-list">
        {data.findings.map((finding) => (
          <div key={finding.rule_id} className={`case-evidence-card case-evidence-card--${finding.severity}`}>
            <div className="case-evidence-card-header">
              <span className="case-evidence-rule-name">{formatRuleId(finding.rule_id)}</span>
              <span className={`case-evidence-severity case-evidence-severity--${finding.severity}`}>
                {finding.severity}
              </span>
            </div>
            <p className="case-evidence-summary">{finding.summary}</p>
            <div className="case-evidence-footer">
              <span className="case-evidence-citation">
                {finding.citation || 'Citation pending'}
              </span>
              <Link
                to={`/claims/${providerId}?${buildClaimFilterParams(finding).toString()}`}
                className="case-evidence-claims-link"
              >
                {finding.matching_claim_ids.length} claim
                {finding.matching_claim_ids.length === 1 ? '' : 's'}
                <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ModelSignalsSection({ shap }) {
  const { status, data, error, retry } = shap

  if (status === 'loading') {
    return (
      <div className="case-signals-section">
        <h2 className="case-evidence-title">Model signals</h2>
        <div className="case-signals-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="case-signals-skeleton-row" />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="case-signals-section">
        <h2 className="case-evidence-title">Model signals</h2>
        <div className="case-evidence-error">
          <AlertTriangle size={15} />
          <span>Model signals unavailable{error ? ` — ${error}` : ''}</span>
          <button type="button" className="case-evidence-retry" onClick={retry}>
            <RotateCcw size={13} />
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (status !== 'ready') return null

  // Don't trust the backend's ordering blindly, even though it's already
  // sorted this way (verified) -- bar width MUST be driven by shap_value
  // magnitude, never by percentile, which is a different fact (how
  // unusual a value is, not how much it moved this prediction). Sorting
  // explicitly here also protects the summary sentence below, which
  // depends on "top by impact" being correct.
  const sortedFeatures = [...data.top_features].sort(
    (a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)
  )
  const maxAbsShap = Math.max(...sortedFeatures.map((f) => Math.abs(f.shap_value)), 0)

  return (
    <div className="case-signals-section">
      <h2 className="case-evidence-title">Model signals</h2>
      <p className="case-signals-subheading">
        Top {sortedFeatures.length} features driving this score
      </p>
      <p className="case-signals-summary">{buildSignalsSummary(sortedFeatures)}</p>
      <div className="case-signals-list">
        {sortedFeatures.map((f) => {
          // Bar width = impact on THIS prediction (shap_value), never
          // percentile = how unusual the value is vs. other providers.
          // Percentile stays as the muted label text next to the bar only.
          const widthPct = maxAbsShap > 0 ? (Math.abs(f.shap_value) / maxAbsShap) * 100 : 0
          const tone = f.direction === 'increases_risk' ? 'danger' : 'success'
          return (
            <div key={f.feature} className="case-signal-row">
              <div className="case-signal-row-top">
                <span className="case-signal-label">{f.display_name}</span>
                <span className="case-signal-value">{f.value_formatted}</span>
              </div>
              <div className="case-signal-bar-track">
                <div className={`case-signal-bar case-signal-bar--${tone}`} style={{ width: `${widthPct}%` }} />
                {f.percentile != null && (
                  <span className="case-signal-percentile">{formatOrdinal(f.percentile)} percentile</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Deterministic, template-generated -- no LLM call, no new API call. Built
// entirely from top_features already returned by GET /providers/{id}/shap,
// which the caller has already sorted by abs(shap_value) descending.
function buildSignalsSummary(sortedFeatures) {
  const top = sortedFeatures.slice(0, 3)
  if (top.length === 0) return null

  const describe = (f) => {
    const pctPart = f.percentile != null ? `, ${formatOrdinal(f.percentile)} percentile` : ''
    return `${f.display_name} (${f.value_formatted}${pctPart})`
  }
  const parts = top.map(describe)

  let joined
  if (parts.length === 1) {
    joined = parts[0]
  } else if (parts.length === 2) {
    joined = `${parts[0]} and ${parts[1]}`
  } else {
    joined = `${parts[0]}, ${parts[1]}, and ${parts[2]}`
  }

  const isPlural = parts.length > 1
  return `${joined} ${isPlural ? 'are' : 'is'} the largest ${isPlural ? 'contributors' : 'contributor'} to this score.`
}

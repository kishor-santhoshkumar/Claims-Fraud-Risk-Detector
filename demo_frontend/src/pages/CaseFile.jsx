import ProviderCaseView from './ProviderCaseView'

export default function CaseFile() {
  return (
    <ProviderCaseView
      title="Case file"
      evidenceLabel="Evidence detail"
      showClaimsLink
      showModelSignals
      showRuleEvidence
      showDecisionBar
    />
  )
}

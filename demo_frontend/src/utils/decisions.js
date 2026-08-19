import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'

export const DECISION_TYPES = ['confirmed', 'cleared', 'escalated']

// Single source of truth for decision labels/colors/copy -- used by the
// Case file decision bar, Queue badges + filter, and the Dashboard's
// Run info counts, so they can never drift out of sync with each other.
export const DECISION_META = {
  confirmed: {
    value: 'confirmed',
    actionLabel: 'Confirm fraud',
    badgeLabel: 'Confirmed',
    toastVerb: 'confirmed as fraud',
    tone: 'danger',
    icon: ShieldAlert,
  },
  cleared: {
    value: 'cleared',
    actionLabel: 'Clear provider',
    badgeLabel: 'Cleared',
    toastVerb: 'cleared',
    tone: 'success',
    icon: CheckCircle2,
  },
  escalated: {
    value: 'escalated',
    actionLabel: 'Escalate for review',
    badgeLabel: 'Escalated',
    toastVerb: 'escalated for review',
    tone: 'warning',
    icon: AlertTriangle,
  },
}

export function formatDecidedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${datePart}, ${timePart}`
}

// Queue ordering (fraud_probability descending) -> first result after
// `currentProviderId` that has no recorded decision yet. Null if none
// (caller should navigate back to the queue instead).
export function findNextUnreviewedProviderId(results, decisionsByProviderId, currentProviderId) {
  const sorted = [...results].sort((a, b) => b.fraud_probability - a.fraud_probability)
  const idx = sorted.findIndex((r) => r.provider_id === currentProviderId)
  if (idx === -1) return null
  for (let i = idx + 1; i < sorted.length; i++) {
    if (!decisionsByProviderId[sorted[i].provider_id]) return sorted[i].provider_id
  }
  return null
}

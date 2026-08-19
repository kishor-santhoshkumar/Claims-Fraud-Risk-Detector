// Risk-tier display convention. This is a FRONTEND-ONLY convention for
// grouping/coloring providers in the UI -- the backend never returns a
// tier, only a continuous fraud_probability. These thresholds are not a
// backend contract and can be changed here without touching the API.
export const RISK_TIER_THRESHOLDS = { high: 0.7, medium: 0.4 }

export function getRiskTier(fraudProbability) {
  if (fraudProbability >= RISK_TIER_THRESHOLDS.high) return 'high'
  if (fraudProbability >= RISK_TIER_THRESHOLDS.medium) return 'medium'
  return 'low'
}

export const RISK_TIER_LABEL = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
}

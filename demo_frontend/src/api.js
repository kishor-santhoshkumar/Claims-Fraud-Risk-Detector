// Thin fetch wrapper for the Claims Fraud Risk Detector backend.
// Backend runs on http://localhost:8000 by default (see RUN_BACKEND.md).
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

async function parseJsonSafe(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    throw new Error(data?.detail || 'Login failed')
  }
  return data // { success, token, user: { username, name } }
}

export async function fetchCurrentUser(token) {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    throw new Error(data?.detail || 'Session invalid')
  }
  return data // { username, name }
}

// rawProviders: [{ provider_id, ...31 feature fields }] (see src/data/providers_raw.json)
// Returns the backend's real results array, one entry per provider, verbatim:
// [{ provider_id, fraud_probability, gate_passed, gate_score, gate_threshold, flagged, decision_threshold }]
export async function predictBatch(rawProviders) {
  const body = {
    providers: rawProviders.map(({ provider_id, ...features }) => ({ provider_id, features })),
  }
  const response = await fetch(`${API_BASE_URL}/predict/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    throw new Error(data?.detail || `Simulation request failed (HTTP ${response.status})`)
  }
  return data.results
}

// Real claim-level lookup: GET /providers/{provider_id}/claims?page=&limit=
// Returns the backend's response verbatim:
// { provider_id, total_claims, page, limit, total_pages, claims: [...] }
// Throws an Error with `.status` set to the HTTP status code (404, 503, ...)
// so callers can distinguish "no claims" from "backend temporarily down"
// from a plain network failure (status stays null in that case).
export async function getProviderClaims(providerId, { page = 1, limit = 50 } = {}) {
  const url = `${API_BASE_URL}/providers/${encodeURIComponent(providerId)}/claims?page=${page}&limit=${limit}`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data
}

// Real investigator decision, single provider: GET /providers/{provider_id}/decision
// A 404 here means "no decision recorded yet" -- a normal state, not a
// failure. Callers should check err.status === 404 and treat it as
// "undecided" rather than an error.
export async function getProviderDecision(providerId) {
  const url = `${API_BASE_URL}/providers/${encodeURIComponent(providerId)}/decision`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data // { provider_id, decision, decided_by, decided_at, notes }
}

// Record a real investigator decision: POST /providers/{provider_id}/decision
// Requires a valid auth token (the caller who made the decision).
export async function postProviderDecision(providerId, decision, notes, token) {
  const url = `${API_BASE_URL}/providers/${encodeURIComponent(providerId)}/decision`
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ decision, notes: notes || null }),
    })
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data // { provider_id, decision, decided_by, decided_at, notes }
}

// All recorded decisions in one call: GET /decisions
export async function getAllDecisions() {
  const url = `${API_BASE_URL}/decisions`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data // [{ provider_id, decision, decided_at }, ...]
}

// Real rule-engine findings: GET /providers/{provider_id}/evidence
// Returns the backend's response verbatim:
// { provider_id, rules_evaluated, rules_fired, findings: [{ rule_id, category, severity, citation, summary, matching_claim_ids }] }
export async function getProviderEvidence(providerId) {
  const url = `${API_BASE_URL}/providers/${encodeURIComponent(providerId)}/evidence`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data
}

// Real SHAP feature attribution: GET /providers/{provider_id}/shap
// Returns the backend's response verbatim:
// { provider_id, base_value, fraud_probability, top_features: [{ feature, display_name, value, value_formatted, shap_value, direction, percentile }] }
export async function getProviderShap(providerId) {
  const url = `${API_BASE_URL}/providers/${encodeURIComponent(providerId)}/shap`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data
}

// Model/training metadata: GET /model/info -- static per deployed artifact,
// used to ground the Dashboard's numbers in the real model behind them.
// Returns the backend's response verbatim:
// { architecture, feature_count, feature_cols, gate_threshold, gate_target_recall,
//   actual_gate_recall, providers_passed, pass_rate, rf_gate_params, gate_eval_full,
//   gate_eval_cv, trained_rows, positive_rate, notes }
export async function getModelInfo() {
  const url = `${API_BASE_URL}/model/info`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data
}

// Batch aggregate: GET /analytics/rule-fire-rates?provider_ids=A,B,C
// Returns the backend's response verbatim:
// { total_providers, rules: [{ rule_id, name, severity, providers_fired, fire_rate }] }
export async function getRuleFireRates(providerIds) {
  const url = `${API_BASE_URL}/analytics/rule-fire-rates?provider_ids=${encodeURIComponent(providerIds.join(','))}`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data
}

// Batch aggregate: GET /analytics/shap-importance?provider_ids=A,B,C
// Returns the backend's response verbatim:
// { total_providers, features: [{ feature, display_name, avg_abs_shap }] }
export async function getShapImportance(providerIds) {
  const url = `${API_BASE_URL}/analytics/shap-importance?provider_ids=${encodeURIComponent(providerIds.join(','))}`
  let response
  try {
    response = await fetch(url)
  } catch {
    const err = new Error('Could not reach the backend. Check your connection and try again.')
    err.status = null
    throw err
  }
  const data = await parseJsonSafe(response)
  if (!response.ok) {
    const err = new Error(data?.detail || `Request failed (HTTP ${response.status})`)
    err.status = response.status
    throw err
  }
  return data
}

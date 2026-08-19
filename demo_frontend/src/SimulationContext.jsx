import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { predictBatch } from './api'
import providersRaw from './data/providers_raw.json'
import { getRiskTier } from './utils/risk'

const SimulationContext = createContext(null)

const INITIAL_STATE = {
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  results: [],
  lastRunAt: null,
  error: null,
}

// providers_raw.json is the ONLY local data in this app: real 31-feature
// rows (see backend README -> Feature Engineering) with no score, tier, or
// dollar-risk field attached. Every number derived from it below is either
// (a) copied verbatim from a POST /predict/batch response, or (b) a
// transparent client-side computation combining a real backend number
// (fraud_probability) with a real input number (total_reimbursed) -- never
// invented. See utils/risk.js for the tier-threshold convention.
const rawById = new Map(providersRaw.map((p) => [p.provider_id, p]))

function augmentResult(result) {
  const raw = rawById.get(result.provider_id)
  const totalReimbursed = raw ? raw.total_reimbursed : null
  // expected loss = fraud_probability * billed amount, per the same
  // methodology described in the backend README's "Expected-loss ranking"
  // section -- not a value the backend returns directly.
  const expectedLoss = totalReimbursed != null ? result.fraud_probability * totalReimbursed : null
  return {
    ...result,
    totalReimbursed,
    expectedLoss,
    riskTier: getRiskTier(result.fraud_probability),
  }
}

export function SimulationProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE)
  const runningRef = useRef(false)

  const startSimulation = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try {
      const rawResults = await predictBatch(providersRaw)
      setState({
        status: 'ready',
        results: rawResults.map(augmentResult),
        lastRunAt: Date.now(),
        error: null,
      })
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err.message || 'Simulation failed',
      }))
    } finally {
      runningRef.current = false
    }
  }, [])

  const resultByProviderId = useMemo(() => {
    const map = new Map()
    for (const r of state.results) map.set(r.provider_id, r)
    return map
  }, [state.results])

  const value = useMemo(
    () => ({
      ...state,
      startSimulation,
      providerCount: providersRaw.length,
      getResultFor: (providerId) => resultByProviderId.get(providerId) || null,
    }),
    [state, startSimulation, resultByProviderId]
  )

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>
}

export function useSimulation() {
  const ctx = useContext(SimulationContext)
  if (!ctx) throw new Error('useSimulation must be used inside <SimulationProvider>')
  return ctx
}

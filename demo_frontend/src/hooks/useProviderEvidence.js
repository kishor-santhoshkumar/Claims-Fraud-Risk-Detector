import { useCallback, useEffect, useState } from 'react'
import { getProviderEvidence } from '../api'

// Fetches a provider's real rule-engine findings. `enabled: false` skips
// the fetch entirely (status stays 'idle').
export function useProviderEvidence(providerId, { enabled = true } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
    errorStatus: null,
  })

  const fetchEvidence = useCallback(() => {
    if (!enabled) return undefined
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading', error: null, errorStatus: null }))
    getProviderEvidence(providerId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null, errorStatus: null })
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', data: null, error: err.message, errorStatus: err.status ?? null })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, enabled])

  useEffect(() => fetchEvidence(), [fetchEvidence])

  return { ...state, retry: fetchEvidence }
}

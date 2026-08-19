import { useCallback, useEffect, useState } from 'react'
import { getProviderClaims } from '../api'

// Fetches one page of a provider's real claims. `enabled: false` skips the
// fetch entirely (status stays 'idle') -- used where we only conditionally
// need this (e.g. the Case file page's claim-count link).
export function useProviderClaims(providerId, { page = 1, limit = 50, enabled = true } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
    errorStatus: null,
  })

  const fetchClaims = useCallback(() => {
    if (!enabled) return
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading', error: null, errorStatus: null }))
    getProviderClaims(providerId, { page, limit })
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
  }, [providerId, page, limit, enabled])

  useEffect(() => fetchClaims(), [fetchClaims])

  return { ...state, retry: fetchClaims }
}

import { useCallback, useEffect, useState } from 'react'
import { getProviderShap } from '../api'

// Fetches a provider's real SHAP feature attribution. `enabled: false`
// skips the fetch entirely (status stays 'idle'). Loads independently of
// evidence/claims -- a SHAP failure never blocks the rest of the Case
// file page.
export function useProviderShap(providerId, { enabled = true } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
    errorStatus: null,
  })

  const fetchShap = useCallback(() => {
    if (!enabled) return undefined
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading', error: null, errorStatus: null }))
    getProviderShap(providerId)
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

  useEffect(() => fetchShap(), [fetchShap])

  return { ...state, retry: fetchShap }
}

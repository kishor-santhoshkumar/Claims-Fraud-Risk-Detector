import { useCallback, useEffect, useState } from 'react'
import { getShapImportance } from '../api'

// Fetches real batch-level average |SHAP| feature importance for the
// given provider_ids. `enabled: false` skips the fetch (status stays 'idle').
export function useShapImportance(providerIds, { enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null })

  const fetchData = useCallback(() => {
    if (!enabled || providerIds.length === 0) return undefined
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading', error: null }))
    getShapImportance(providerIds)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, providerIds.join(',')])

  useEffect(() => fetchData(), [fetchData])

  return { ...state, retry: fetchData }
}

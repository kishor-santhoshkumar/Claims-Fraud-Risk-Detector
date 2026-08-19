import { useEffect, useState } from 'react'
import { getModelInfo } from '../api'

// Model/training metadata (GET /model/info) is static for the whole
// session -- the deployed artifact doesn't change between simulation runs
// -- so this is fetched once and cached at module scope rather than
// re-fetched every time a component using it mounts (e.g. every time the
// loading overlay opens for a re-run).
let cache = null
let inflight = null

export function useModelInfo() {
  const [state, setState] = useState(() =>
    cache ? { status: 'ready', data: cache, error: null } : { status: 'loading', data: null, error: null }
  )

  useEffect(() => {
    if (cache) return undefined
    let cancelled = false
    inflight ??= getModelInfo()
    inflight
      .then((data) => {
        cache = data
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((err) => {
        inflight = null
        if (!cancelled) setState({ status: 'error', data: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

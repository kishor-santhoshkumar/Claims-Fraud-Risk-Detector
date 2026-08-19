import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { getAllDecisions } from './api'

const DecisionsContext = createContext(null)

// Global cache of investigator decisions, keyed by provider_id -- single
// source of truth so Queue badges, the Dashboard's Run info counts, and
// the Case file page's decision status all agree with each other the
// moment a decision is made, without each page re-fetching independently.
export function DecisionsProvider({ children }) {
  const [byProviderId, setByProviderId] = useState({})
  const [status, setStatus] = useState('idle') // 'idle' | 'loading' | 'ready' | 'error'

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const list = await getAllDecisions()
      const map = {}
      for (const d of list) map[d.provider_id] = d
      setByProviderId(map)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  // Optimistic local update right after a successful POST -- avoids
  // waiting on a full re-fetch for the decision to show up everywhere.
  const recordLocal = useCallback((record) => {
    setByProviderId((prev) => ({ ...prev, [record.provider_id]: record }))
  }, [])

  // Used by the Case file page's "Undo" action (see ProviderCaseView.jsx):
  // reverts the LOCAL view of this provider back to undecided. The backend
  // still has the record it was given -- there's no delete/undo endpoint,
  // by design (no audit-trail requirement yet) -- so this only holds until
  // a new decision is made for the same provider, which overwrites it.
  const clearLocal = useCallback((providerId) => {
    setByProviderId((prev) => {
      if (!(providerId in prev)) return prev
      const next = { ...prev }
      delete next[providerId]
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ byProviderId, status, refresh, recordLocal, clearLocal }),
    [byProviderId, status, refresh, recordLocal, clearLocal]
  )

  return <DecisionsContext.Provider value={value}>{children}</DecisionsContext.Provider>
}

export function useDecisions() {
  const ctx = useContext(DecisionsContext)
  if (!ctx) throw new Error('useDecisions must be used inside <DecisionsProvider>')
  return ctx
}

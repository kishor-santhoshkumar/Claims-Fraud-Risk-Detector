import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { useDecisions } from '../DecisionsContext'
import { getProviderDecision, postProviderDecision } from '../api'

// Per-provider decision status for the Case file page. Fetches the real
// decision on mount (404 = undecided, not an error) and keeps the shared
// DecisionsContext (Queue badges, Dashboard counts) in sync whenever a
// decision is made or undone here.
export function useProviderDecision(providerId) {
  const { token } = useAuth()
  const { recordLocal, clearLocal } = useDecisions()
  const [state, setState] = useState({ status: 'loading', decision: null, error: null })

  const fetchDecision = useCallback(() => {
    let cancelled = false
    setState({ status: 'loading', decision: null, error: null })
    getProviderDecision(providerId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', decision: data, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        if (err.status === 404) {
          setState({ status: 'ready', decision: null, error: null }) // undecided -- a valid, expected state
        } else {
          setState({ status: 'error', decision: null, error: err.message })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  useEffect(() => fetchDecision(), [fetchDecision])

  const submit = useCallback(
    async (decisionValue, notes) => {
      const record = await postProviderDecision(providerId, decisionValue, notes, token)
      setState({ status: 'ready', decision: record, error: null })
      recordLocal(record)
      return record
    },
    [providerId, token, recordLocal]
  )

  // "Undo" in the toast: local-only revert, no backend call (see
  // DecisionsContext.clearLocal's comment -- confirmed acceptable given no
  // audit-trail requirement). The just-made decision stays stored on the
  // backend until a new one overwrites it.
  const undoLocal = useCallback(() => {
    setState((s) => ({ ...s, decision: null }))
    clearLocal(providerId)
  }, [providerId, clearLocal])

  return { ...state, submit, undoLocal, retry: fetchDecision }
}

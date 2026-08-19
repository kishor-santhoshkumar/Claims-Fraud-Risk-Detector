import { useCallback, useEffect, useState } from 'react'
import { getProviderClaims } from '../api'

const FETCH_LIMIT = 500 // backend MAX_LIMIT

// Fetches only the claims matching a specific set of claim_ids for one
// provider -- used by the "N claims →" link on a rule finding, which must
// show exactly that rule's matching_claim_ids, not a generic paginated
// view. The backend has no "fetch by ID" endpoint, so this walks pages at
// the max page size and stops as soon as every requested ID has been
// found (rather than always fetching the provider's entire claim set).
export function useProviderClaimsByIds(providerId, claimIds, { enabled = true } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    claims: null,
    totalClaims: null,
    error: null,
    errorStatus: null,
  })

  const idSet = claimIds && claimIds.length > 0 ? new Set(claimIds) : null

  const fetchAll = useCallback(() => {
    if (!enabled || !idSet) return undefined
    let cancelled = false

    async function run() {
      setState((s) => ({ ...s, status: 'loading', error: null, errorStatus: null }))
      try {
        const found = []
        const remaining = new Set(idSet)
        let page = 1
        let totalPages = 1
        let totalClaims = null

        while (page <= totalPages && remaining.size > 0) {
          const data = await getProviderClaims(providerId, { page, limit: FETCH_LIMIT })
          if (totalClaims === null) {
            totalClaims = data.total_claims
            totalPages = data.total_pages
          }
          for (const claim of data.claims) {
            if (remaining.has(claim.claim_id)) {
              found.push(claim)
              remaining.delete(claim.claim_id)
            }
          }
          page += 1
        }

        if (!cancelled) {
          setState({ status: 'ready', claims: found, totalClaims, error: null, errorStatus: null })
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            claims: null,
            totalClaims: null,
            error: err.message,
            errorStatus: err.status ?? null,
          })
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, enabled, claimIds && claimIds.join(',')])

  useEffect(() => fetchAll(), [fetchAll])

  return { ...state, retry: fetchAll }
}

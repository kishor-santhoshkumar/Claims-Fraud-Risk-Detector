import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
} from 'lucide-react'
import { useProviderClaims } from '../hooks/useProviderClaims'
import { useProviderClaimsByIds } from '../hooks/useProviderClaimsByIds'
import { formatCode, formatCurrency, formatDateReadable, formatRuleId } from '../utils/format'
import './ClaimsDetail.css'

const PAGE_LIMIT = 50

export default function ClaimsDetail() {
  const { providerId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [page, setPage] = useState(1)

  // Reached via a rule finding's "N claims →" link (see ProviderCaseView.jsx):
  // ?claimIds=CLM1,CLM2,...&ruleLabel=Overlapping+inpatient. When present,
  // this page shows exactly those claims instead of the normal paginated view.
  const claimIdsParam = searchParams.get('claimIds')
  const ruleLabel = searchParams.get('ruleLabel')
  const claimIds = useMemo(
    () => (claimIdsParam ? claimIdsParam.split(',').filter(Boolean) : null),
    [claimIdsParam]
  )
  const isFiltered = Boolean(claimIds && claimIds.length > 0)

  const paginated = useProviderClaims(providerId, { page, limit: PAGE_LIMIT, enabled: !isFiltered })
  const byIds = useProviderClaimsByIds(providerId, claimIds, { enabled: isFiltered })

  const status = isFiltered ? byIds.status : paginated.status
  const error = isFiltered ? byIds.error : paginated.error
  const errorStatus = isFiltered ? byIds.errorStatus : paginated.errorStatus
  const retry = isFiltered ? byIds.retry : paginated.retry
  const headingTotal = isFiltered ? byIds.totalClaims : paginated.data?.total_claims

  return (
    <div className="claims-detail-page">
      <button type="button" className="claims-back" onClick={() => navigate(`/case/${providerId}`)}>
        <ArrowLeft size={15} />
        Back to case
      </button>

      <h1 className="claims-heading">{providerId}</h1>
      <p className="claims-subheading">
        {status === 'ready' && headingTotal != null ? `${headingTotal.toLocaleString()} claims` : ' '}
      </p>

      {isFiltered && status === 'ready' && (
        <ClaimsFilterBanner
          providerId={providerId}
          count={byIds.claims.length}
          totalClaims={byIds.totalClaims}
          ruleLabel={ruleLabel}
        />
      )}

      {status === 'loading' && <ClaimsSkeleton />}

      {status === 'error' && (
        <ClaimsErrorState
          providerId={providerId}
          error={error}
          errorStatus={errorStatus}
          onRetry={retry}
        />
      )}

      {status === 'ready' && isFiltered && <ClaimsReady claims={byIds.claims} paginated={false} />}

      {status === 'ready' && !isFiltered && (
        <ClaimsReady
          claims={paginated.data.claims}
          paginated
          page={page}
          totalPages={paginated.data.total_pages}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}

function ClaimsFilterBanner({ providerId, count, totalClaims, ruleLabel }) {
  return (
    <div className="claims-filter-banner">
      <span className="claims-filter-banner-text">
        Showing {count} claim{count === 1 ? '' : 's'}
        {ruleLabel ? (
          <>
            {' '}matching <strong>{ruleLabel}</strong>
          </>
        ) : null}
      </span>
      <Link to={`/claims/${providerId}`} className="claims-filter-clear">
        <X size={13} />
        Clear filter — view all {totalClaims != null ? totalClaims.toLocaleString() : ''} claims
      </Link>
    </div>
  )
}

function ClaimsErrorState({ providerId, error, errorStatus, onRetry }) {
  if (errorStatus === 404) {
    return (
      <div className="claims-state-card">
        <p className="claims-state-title">No claims found for this provider</p>
        <Link to={`/case/${providerId}`} className="claims-inline-link">
          Back to case file
        </Link>
      </div>
    )
  }

  // 503 or network/other error -- same visible-error-with-retry pattern.
  return (
    <div className="claims-state-card claims-state-card--error">
      <AlertTriangle size={22} />
      <p className="claims-state-title">
        {errorStatus === 503
          ? 'Claims data is temporarily unavailable, try again'
          : 'Could not load claims'}
      </p>
      <p className="claims-state-detail">{error}</p>
      <button type="button" className="claims-retry-btn" onClick={onRetry}>
        <RotateCcw size={15} />
        Retry
      </button>
    </div>
  )
}

function ClaimsSkeleton() {
  return (
    <div className="claims-skeleton" aria-hidden="true">
      <div className="claims-skeleton-toolbar" />
      <div className="claims-skeleton-table">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="claims-skeleton-row" />
        ))}
      </div>
    </div>
  )
}

function ClaimsReady({ claims, paginated, page, totalPages, onPageChange }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      if (typeFilter !== 'all' && c.claim_type !== typeFilter) return false
      if (dateFrom && c.claim_start_dt && c.claim_start_dt < dateFrom) return false
      if (dateTo && c.claim_start_dt && c.claim_start_dt > dateTo) return false
      return true
    })
  }, [claims, typeFilter, dateFrom, dateTo])

  function toggleExpand(claimId) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(claimId)) next.delete(claimId)
      else next.add(claimId)
      return next
    })
  }

  return (
    <>
      <div className="claims-toolbar">
        <div className="claims-filter-group">
          <label className="claims-filter-label" htmlFor="type-filter">
            Type
          </label>
          <select
            id="type-filter"
            className="claims-filter-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="inpatient">Inpatient</option>
            <option value="outpatient">Outpatient</option>
          </select>
        </div>
        <div className="claims-filter-group">
          <label className="claims-filter-label" htmlFor="date-from">
            From
          </label>
          <input
            id="date-from"
            type="date"
            className="claims-filter-date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="claims-filter-group">
          <label className="claims-filter-label" htmlFor="date-to">
            To
          </label>
          <input
            id="date-to"
            type="date"
            className="claims-filter-date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <span className="claims-toolbar-note">
          {paginated
            ? `Filtering ${claims.length} claims loaded on this page — change page to see more.`
            : `Filtering ${claims.length} matching claim${claims.length === 1 ? '' : 's'}.`}
        </span>
      </div>

      <ClaimsTable claims={filteredClaims} expandedIds={expandedIds} onToggle={toggleExpand} />

      {paginated && (
        <ClaimsPagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </>
  )
}

function ClaimsTable({ claims, expandedIds, onToggle }) {
  if (claims.length === 0) {
    return <p className="claims-empty-filtered">No claims on this page match the current filters.</p>
  }

  return (
    <div className="claims-table-wrap">
      <table className="claims-table">
        <thead>
          <tr>
            <th />
            <th>Claim ID</th>
            <th>Dates</th>
            <th>Type</th>
            <th>Reimbursed</th>
            <th>Deductible</th>
            <th>Attending physician</th>
            <th>Diagnoses</th>
            <th>Procedures</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => {
            const expanded = expandedIds.has(claim.claim_id)
            const flagged = claim.rule_flags.length > 0
            return (
              <ClaimRowGroup
                key={claim.claim_id}
                claim={claim}
                expanded={expanded}
                flagged={flagged}
                onToggle={() => onToggle(claim.claim_id)}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ClaimRowGroup({ claim, expanded, flagged, onToggle }) {
  return (
    <>
      <tr
        className={`claims-row${flagged ? ' claims-row--flagged' : ''}`}
        onClick={onToggle}
      >
        <td className="claims-cell-chevron">
          <ChevronDown size={15} className={`claims-chevron${expanded ? ' is-open' : ''}`} />
        </td>
        <td className="claims-cell-id">
          {claim.claim_id}
          {flagged && (
            <span className="claims-flag-tags">
              {claim.rule_flags.map((flag) => (
                <span
                  key={flag.rule_id}
                  className={`claims-flag-tag claims-flag-tag--${flag.severity}`}
                  title={`${flag.rule_id} (${flag.severity} severity)`}
                >
                  {formatRuleId(flag.rule_id)}
                </span>
              ))}
            </span>
          )}
        </td>
        <td>
          {formatDateReadable(claim.claim_start_dt)} – {formatDateReadable(claim.claim_end_dt)}
        </td>
        <td>
          <span className={`claims-type-badge claims-type-badge--${claim.claim_type}`}>
            {claim.claim_type}
          </span>
        </td>
        <td className="claims-cell-amount">{formatCurrency(claim.amount_reimbursed)}</td>
        <td className="claims-cell-amount">{formatCurrency(claim.deductible_paid)}</td>
        <td>{claim.attending_physician || '—'}</td>
        <td className="claims-cell-count">{claim.diagnosis_codes.length}</td>
        <td className="claims-cell-count">{claim.procedure_codes.length}</td>
      </tr>
      {expanded && (
        <tr className="claims-detail-row">
          <td colSpan={9}>
            <div className="claims-detail-grid">
              <div>
                <span className="claims-detail-label">Beneficiary ID</span>
                <span className="claims-detail-value">{claim.bene_id}</span>
              </div>
              <div>
                <span className="claims-detail-label">Admission date</span>
                <span className="claims-detail-value">{formatDateReadable(claim.admission_dt)}</span>
              </div>
              <div>
                <span className="claims-detail-label">Discharge date</span>
                <span className="claims-detail-value">{formatDateReadable(claim.discharge_dt)}</span>
              </div>
              <div className="claims-detail-codes">
                <span className="claims-detail-label">Diagnosis codes ({claim.diagnosis_codes.length})</span>
                <span className="claims-detail-value">
                  {claim.diagnosis_codes.length > 0
                    ? claim.diagnosis_codes.map(formatCode).join(', ')
                    : '—'}
                </span>
              </div>
              <div className="claims-detail-codes">
                <span className="claims-detail-label">Procedure codes ({claim.procedure_codes.length})</span>
                <span className="claims-detail-value">
                  {claim.procedure_codes.length > 0
                    ? claim.procedure_codes.map(formatCode).join(', ')
                    : '—'}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ClaimsPagination({ page, totalPages, onPageChange }) {
  const [jumpValue, setJumpValue] = useState('')

  function submitJump(e) {
    e.preventDefault()
    const n = Number(jumpValue)
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) {
      onPageChange(n)
      setJumpValue('')
    }
  }

  return (
    <div className="claims-pagination">
      <button
        type="button"
        className="claims-page-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft size={15} />
        Previous
      </button>

      <span className="claims-page-indicator">
        Page {page} of {totalPages}
      </span>

      <button
        type="button"
        className="claims-page-btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
        <ChevronRight size={15} />
      </button>

      {totalPages > 3 && (
        <form className="claims-jump-form" onSubmit={submitJump}>
          <label htmlFor="jump-page" className="claims-jump-label">
            Jump to
          </label>
          <input
            id="jump-page"
            type="number"
            min={1}
            max={totalPages}
            className="claims-jump-input"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            placeholder={String(page)}
          />
          <button type="submit" className="claims-jump-go">
            Go
          </button>
        </form>
      )}
    </div>
  )
}

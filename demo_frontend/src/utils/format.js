export function formatCurrencyCompact(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`
  return `$${amount.toFixed(0)}`
}

export function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function getTodayLong() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Full precision currency for per-claim amounts (unlike formatCurrencyCompact,
// which abbreviates to K/M for dashboard-scale totals).
export function formatCurrency(amount) {
  if (amount == null) return '—'
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// "2009-01-04" -> "Jan 4, 2009". Null/invalid -> "—", never "Invalid Date".
export function formatDateReadable(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Diagnosis/procedure codes sometimes arrive as numeric-looking strings with
// a trailing ".0" (e.g. "9738.0") since the source columns are float-typed.
// Strips that generically -- not a hardcoded ".0" replace -- so it's
// correct for any numeric code, and passes non-numeric codes through as-is.
export function formatCode(code) {
  const num = Number(code)
  return Number.isFinite(num) ? String(Math.trunc(num)) : String(code)
}

// "OVERLAPPING_INPATIENT" -> "Overlapping inpatient"
export function formatRuleId(ruleId) {
  if (!ruleId) return ''
  const words = ruleId.toLowerCase().split('_')
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + ' ' + words.slice(1).join(' ')
}

// 98 -> "98th", 1 -> "1st", 22 -> "22nd", 13 -> "13th"
export function formatOrdinal(n) {
  const rounded = Math.round(n)
  const mod100 = rounded % 100
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`
    case 2:
      return `${rounded}nd`
    case 3:
      return `${rounded}rd`
    default:
      return `${rounded}th`
  }
}

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

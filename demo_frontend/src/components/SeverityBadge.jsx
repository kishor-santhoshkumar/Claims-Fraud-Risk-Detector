import './SeverityBadge.css'

// Same visual language as the Rule findings section's severity badge on
// the Case file page (identical color values) -- built as its own
// component here rather than importing from ProviderCaseView.jsx, since
// that page is explicitly off-limits to edit for this task.
export default function SeverityBadge({ severity }) {
  return <span className={`severity-badge severity-badge--${severity}`}>{severity}</span>
}

import './EmptyState.css'

export default function EmptyState({ icon: Icon, label }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-state-icon">
          <Icon size={26} />
        </div>
      )}
      <p className="empty-state-label">{label}</p>
    </div>
  )
}

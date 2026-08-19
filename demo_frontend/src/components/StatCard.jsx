import './StatCard.css'

// tone controls the icon-circle tint: 'blue' | 'red' | 'green' | 'amber'
export default function StatCard({ label, value, sublabel, icon: Icon, tone = 'blue' }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {Icon && (
          <span className={`stat-card-icon stat-card-icon--${tone}`}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className={`stat-card-value stat-card-value--${tone}`}>{value}</div>
      {sublabel && <div className="stat-card-sublabel">{sublabel}</div>}
    </div>
  )
}

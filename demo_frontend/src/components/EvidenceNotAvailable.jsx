import { FlaskConical } from 'lucide-react'
import './EvidenceNotAvailable.css'

export default function EvidenceNotAvailable({ label = 'Evidence detail' }) {
  return (
    <div className="evidence-unavailable">
      <FlaskConical size={18} className="evidence-unavailable-icon" />
      <p>
        {label} is not available yet — this section will populate once the explanation
        backend (SHAP, rules, narrative) is live.
      </p>
    </div>
  )
}

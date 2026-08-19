import { PlayCircle } from 'lucide-react'
import { useSimulation } from '../../SimulationContext'
import './SimulationStates.css'

export default function SimulationEmptyState({
  title = 'No simulation has been run yet',
  description,
}) {
  const { startSimulation, providerCount } = useSimulation()

  return (
    <div className="sim-state-card">
      <div className="sim-state-icon sim-state-icon--idle">
        <PlayCircle size={26} />
      </div>
      <h2 className="sim-state-title">{title}</h2>
      <p className="sim-state-description">
        {description ||
          `Run the two-stage cascade (RandomForest gate → XGBoost) against ${providerCount} providers' real feature data. Nothing on this page shows a number until it comes back from the backend.`}
      </p>
      <button type="button" className="sim-state-cta" onClick={startSimulation}>
        <PlayCircle size={17} />
        Start simulation
      </button>
    </div>
  )
}

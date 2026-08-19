import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useSimulation } from '../../SimulationContext'
import './SimulationStates.css'

export default function SimulationErrorState() {
  const { error, startSimulation } = useSimulation()

  return (
    <div className="sim-state-card sim-state-card--error">
      <div className="sim-state-icon sim-state-icon--error">
        <AlertTriangle size={26} />
      </div>
      <h2 className="sim-state-title">Simulation failed</h2>
      <p className="sim-state-description sim-state-description--error">
        {error || 'The backend did not return a result.'}
      </p>
      <button type="button" className="sim-state-cta sim-state-cta--retry" onClick={startSimulation}>
        <RotateCcw size={16} />
        Retry
      </button>
    </div>
  )
}

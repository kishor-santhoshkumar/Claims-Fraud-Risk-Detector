import { Loader2 } from 'lucide-react'
import { useLoadingMessages } from '../../hooks/useLoadingMessages'
import './SimulationStates.css'

export default function SimulationLoadingState() {
  const message = useLoadingMessages(true)

  return (
    <div className="sim-state-card">
      <Loader2 size={26} className="sim-state-spinner" />
      <p className="sim-state-loading-message">{message}</p>
    </div>
  )
}

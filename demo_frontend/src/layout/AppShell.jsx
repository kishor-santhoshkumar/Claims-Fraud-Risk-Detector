import { useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import AmbientBackground from '../components/AmbientBackground'
import Sidebar from './Sidebar'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import './AppShell.css'

// Persistent shell for every authenticated route: sidebar + ambient
// backdrop (same visual language as the login page) + page content.
export default function AppShell() {
  const { status: simulationStatus } = useSimulation()
  const { refresh: refreshDecisions } = useDecisions()
  const hasFetchedForThisRun = useRef(false)

  // Per spec: fetch GET /decisions once after a simulation run, not on
  // every render/page visit. Re-fires if a fresh simulation run happens
  // (status cycles back through 'loading').
  useEffect(() => {
    if (simulationStatus === 'ready' && !hasFetchedForThisRun.current) {
      hasFetchedForThisRun.current = true
      refreshDecisions()
    }
    if (simulationStatus === 'loading') {
      hasFetchedForThisRun.current = false
    }
  }, [simulationStatus, refreshDecisions])

  return (
    <div className="app-shell">
      <AmbientBackground variant="subtle" />
      <Sidebar />
      <main className="app-shell-content">
        <Outlet />
      </main>
    </div>
  )
}

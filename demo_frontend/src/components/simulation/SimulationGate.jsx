import { useSimulation } from '../../SimulationContext'
import SimulationEmptyState from './SimulationEmptyState'
import SimulationLoadingOverlay from './SimulationLoadingOverlay'

// Shared status-branch used by both Dashboard and Queue so they trigger the
// same startSimulation() (same context, same request) and render identical
// idle/loading/error experiences. Only renders `children` once real results
// exist -- ready-state layout differs per page, so that part stays local.
//
// The loading/error experience is a full-screen overlay (see
// SimulationLoadingOverlay) that layers on TOP of whatever's already
// rendered underneath, rather than replacing it -- so a re-run keeps the
// previous real dashboard/queue content mounted (dimmed/blurred behind the
// overlay) instead of yanking it away mid-animation. The overlay manages
// its own open/close timing internally, keyed off the real `status`
// transitions, not off whether SimulationGate keeps rendering it.
export default function SimulationGate({ emptyTitle, emptyDescription, children }) {
  const { status, results } = useSimulation()

  return (
    <>
      <SimulationLoadingOverlay />
      {status === 'idle' && <SimulationEmptyState title={emptyTitle} description={emptyDescription} />}
      {results.length > 0 && children}
    </>
  )
}

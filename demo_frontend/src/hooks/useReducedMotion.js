import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// Live-tracks the OS/browser reduced-motion preference (not just a one-time
// read) so a component already open re-renders if the user flips the
// setting mid-session. Used by the simulation loading overlay to swap its
// dot/funnel animation for a plain progress bar -- never to skip rendering
// the overlay itself, only its motion.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = (e) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}

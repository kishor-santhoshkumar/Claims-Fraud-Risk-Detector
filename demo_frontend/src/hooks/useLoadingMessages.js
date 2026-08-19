import { useEffect, useState } from 'react'

// Reflects the real pipeline stages (RF gate -> XGBoost -> response), timed
// client-side since the backend doesn't stream progress. Advances forward
// only and holds on the final message if the real call runs long -- never
// loops back around a fixed fake timer. The moment `active` goes false
// (the real response arrived, success or error), this stops immediately.
const DEFAULT_MESSAGES = [
  'Sending provider data…',
  'Running Random Forest gate…',
  'Scoring with XGBoost…',
  'Compiling results…',
]

export function useLoadingMessages(active, messages = DEFAULT_MESSAGES, intervalMs = 1100) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      return undefined
    }
    const id = setInterval(() => {
      setIndex((i) => Math.min(i + 1, messages.length - 1))
    }, intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs])

  return messages[index]
}

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { useProviderDecision } from '../../hooks/useProviderDecision'
import { useSimulation } from '../../SimulationContext'
import { useDecisions } from '../../DecisionsContext'
import { DECISION_META, DECISION_TYPES, findNextUnreviewedProviderId, formatDecidedAt } from '../../utils/decisions'
import './DecisionBar.css'

const TOAST_DURATION_MS = 5000

export default function DecisionBar({ providerId }) {
  const { status, decision, error, submit, undoLocal, retry } = useProviderDecision(providerId)
  const { results } = useSimulation()
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const navigate = useNavigate()

  const [showButtons, setShowButtons] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // 'confirmed' | 'cleared' | 'escalated' | null
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toastAction, setToastAction] = useState(null)
  const toastTimerRef = useRef(null)

  if (status === 'loading') {
    return <p className="decision-loading">Checking decision status…</p>
  }

  if (status === 'error') {
    return (
      <div className="decision-error">
        <span>{error}</span>
        <button type="button" className="decision-retry" onClick={retry}>
          <RotateCcw size={13} />
          Retry
        </button>
      </div>
    )
  }

  function openConfirm(actionValue) {
    setPendingAction(actionValue)
    setNotes('')
  }

  function cancelConfirm() {
    setPendingAction(null)
    setNotes('')
  }

  async function confirmSubmit() {
    setSubmitting(true)
    try {
      await submit(pendingAction, notes.trim())
      setPendingAction(null)
      setShowButtons(false)
      setToastAction(pendingAction)
      toastTimerRef.current = setTimeout(() => {
        setToastAction(null)
        goToNext()
      }, TOAST_DURATION_MS)
    } catch (err) {
      // pendingAction is untouched here, so the dialog stays open for a retry.
      window.alert(err.message || 'Could not save this decision. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function undoToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastAction(null)
    undoLocal()
    setShowButtons(true)
  }

  function goToNext() {
    const nextId = findNextUnreviewedProviderId(results, decisionsByProviderId, providerId)
    if (nextId) {
      navigate(`/case/${nextId}`)
    } else {
      navigate('/queue', { state: { message: 'All providers reviewed.' } })
    }
  }

  const showStatus = decision && !showButtons

  return (
    <div className="decision-bar">
      {showStatus ? (
        <div className="decision-status">
          <span className={`decision-status-badge decision-status-badge--${DECISION_META[decision.decision].tone}`}>
            {DECISION_META[decision.decision].badgeLabel}
          </span>
          <span className="decision-status-text">
            by {decision.decided_by} on {formatDecidedAt(decision.decided_at)}
          </span>
          <button type="button" className="decision-change-link" onClick={() => setShowButtons(true)}>
            Change decision
          </button>
        </div>
      ) : (
        <div className="decision-buttons">
          {DECISION_TYPES.map((type) => {
            const meta = DECISION_META[type]
            const Icon = meta.icon
            return (
              <button
                key={type}
                type="button"
                className={`decision-action-btn decision-action-btn--${meta.tone}`}
                onClick={() => openConfirm(type)}
              >
                <Icon size={16} />
                {meta.actionLabel}
              </button>
            )
          })}
        </div>
      )}

      {pendingAction && (
        <ConfirmDialog
          action={pendingAction}
          notes={notes}
          onNotesChange={setNotes}
          onCancel={cancelConfirm}
          onConfirm={confirmSubmit}
          submitting={submitting}
        />
      )}

      {toastAction && <DecisionToast action={toastAction} onUndo={undoToast} />}
    </div>
  )
}

function ConfirmDialog({ action, notes, onNotesChange, onCancel, onConfirm, submitting }) {
  const meta = DECISION_META[action]
  const Icon = meta.icon

  return (
    <div className="decision-dialog-overlay" onClick={onCancel}>
      <div className="decision-dialog" onClick={(e) => e.stopPropagation()}>
        <div className={`decision-dialog-header decision-dialog-header--${meta.tone}`}>
          <Icon size={18} />
          <span>{meta.actionLabel}</span>
        </div>
        <p className="decision-dialog-copy">
          This will record your decision for this provider. You can change it later.
        </p>
        <label className="decision-dialog-label" htmlFor="decision-notes">
          Notes <span className="decision-dialog-optional">(optional)</span>
        </label>
        <textarea
          id="decision-notes"
          className="decision-dialog-textarea"
          rows={3}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Add context for this decision…"
          disabled={submitting}
        />
        <div className="decision-dialog-actions">
          <button type="button" className="decision-dialog-cancel" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={`decision-dialog-confirm decision-dialog-confirm--${meta.tone}`}
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DecisionToast({ action, onUndo }) {
  const meta = DECISION_META[action]

  return (
    <div className="decision-toast">
      <CheckCircle2 size={16} className="decision-toast-icon" />
      <span className="decision-toast-text">Marked as {meta.toastVerb}</span>
      <button type="button" className="decision-toast-undo" onClick={onUndo}>
        Undo
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../AuthContext'
import AmbientBackground from '../components/AmbientBackground'
import './Login.css'

const QUOTES = [
  {
    text: 'A flagged claim is not an accusation — it is a question the data is asking an investigator to answer.',
    attribution: 'Claims Investigation Notes',
  },
  {
    text: 'A risk score sorts attention, it does not assign guilt. That judgment stays with the reviewer.',
    attribution: 'Fraud Analytics Field Notes',
  },
  {
    text: 'One claim can look ordinary. A provider’s pattern of claims rarely lies as well.',
    attribution: null,
  },
  {
    text: 'The gate exists to protect a reviewer’s time, not to replace their judgment.',
    attribution: 'Claims Investigation Notes',
  },
  {
    text: 'Every claim that slips through unflagged costs more, eventually, than the one that was reviewed and cleared.',
    attribution: 'Risk Scoring Field Notes',
  },
]

const QUOTE_ROTATE_MS = 7000

function useQuoteRotation() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return undefined

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % QUOTES.length)
    }, QUOTE_ROTATE_MS)
    return () => clearInterval(id)
  }, [])

  return QUOTES[index]
}

export default function Login() {
  // --- auth logic: unchanged from the previous version -------------------
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = location.state?.from?.pathname || '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(username, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err.message || 'Invalid username or password')
    } finally {
      setSubmitting(false)
    }
  }
  // --- end auth logic ------------------------------------------------------

  // Presentation-only state below: password visibility, shake-on-error, quote rotation.
  const [showPassword, setShowPassword] = useState(false)
  const [shaking, setShaking] = useState(false)

  useEffect(() => {
    if (!error) return
    setShaking(false)
    const raf = requestAnimationFrame(() => setShaking(true))
    return () => cancelAnimationFrame(raf)
  }, [error])

  const quote = useQuoteRotation()

  return (
    <div className="login-page">
      <AmbientBackground />

      <div className="login-content">
        <form
          className={`login-card${shaking ? ' is-shaking' : ''}`}
          onSubmit={handleSubmit}
          onAnimationEnd={() => setShaking(false)}
        >
          <div className="login-header">
            <div className="login-icon-circle">
              <ShieldCheck size={26} color="#f8fafc" strokeWidth={2} />
            </div>
            <h1 className="login-title">Claims fraud risk detector</h1>
            <p className="login-subtitle">Investigator sign-in</p>
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="username">
              Username
            </label>
            <div className="login-input-wrap">
              <input
                id="username"
                className="login-input"
                type="text"
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                required
              />
            </div>
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="password">
              Password
            </label>
            <div className="login-input-wrap">
              <input
                id="password"
                className="login-input login-input--password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
              <button
                type="button"
                className="login-toggle-visibility"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? (
              <Loader2 size={18} className="login-spinner" />
            ) : (
              'Sign in'
            )}
          </button>

          <div className="login-inline-quote">
            <div className="login-quote-divider" />
            <p className="login-quote-text" key={quote.text}>
              “{quote.text}”
            </p>
            <p className="login-quote-attribution">
              — {quote.attribution || 'Unattributed'}
            </p>
          </div>
        </form>
      </div>

      <div className="login-footer">
        Claims Fraud Risk Detector · Internal use only · v1.0
      </div>
    </div>
  )
}

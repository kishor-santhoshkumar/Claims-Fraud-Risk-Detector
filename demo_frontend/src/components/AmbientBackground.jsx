import './AmbientBackground.css'

// Shared drifting-blob + dot-grid backdrop used on the login page and behind
// the authenticated app shell, so both read as one continuous product.
// variant="subtle" is the same visual, just much lower opacity, for use
// behind real content instead of a hero screen.
export default function AmbientBackground({ variant = 'default' }) {
  return (
    <div className={`ambient-bg ambient-bg--${variant}`} aria-hidden="true">
      <div className="ambient-blob ambient-blob--a" />
      <div className="ambient-blob ambient-blob--b" />
      <div className="ambient-blob ambient-blob--c" />
      <div className="ambient-grid-overlay" />
    </div>
  )
}

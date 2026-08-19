import './SkeletonRows.css'

export default function SkeletonRows({ count = 8 }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  )
}

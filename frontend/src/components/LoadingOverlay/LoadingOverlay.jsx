import styles from './LoadingOverlay.module.css'

// A large centered spinner + message that briefly covers the whole page
// during an async transition (e.g. "Get my team ready" while the workspace
// is created). Same ring visual as DrugMaker's launch spinner (DrugMaker.jsx),
// sized up for a full-page moment. No opaque background -- like every other
// page in the app, it lets the fixed ShaderBackground show through.
// `exiting` swaps the entrance fade for a matching fade-out, driven by the
// caller's own transition state.
function LoadingOverlay({ message, exiting = false }) {
  return (
    <div
      className={`${styles.overlay} ${exiting ? styles.exiting : ''}`}
      role="status"
      aria-live="polite"
    >
      <svg className={styles.ringSvg} viewBox="0 0 64 64" aria-hidden="true">
        <circle className={styles.track} cx="32" cy="32" r="28" />
        <circle
          className={styles.arc}
          cx="32"
          cy="32"
          r="28"
          pathLength="1"
          style={{ strokeDashoffset: 0.3 }}
        />
      </svg>
      <p className={styles.message}>{message}</p>
    </div>
  )
}

export default LoadingOverlay

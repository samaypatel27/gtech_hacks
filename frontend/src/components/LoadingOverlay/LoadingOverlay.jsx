import Spinner from '../Spinner/Spinner.jsx'
import styles from './LoadingOverlay.module.css'

// Full-page cover during an async transition (e.g. "Get my team ready"
// while the workspace is created). `exiting` fades it out, driven by the
// caller's own transition state.
function LoadingOverlay({ message, exiting = false }) {
  return (
    <div className={`${styles.overlay} ${exiting ? styles.exiting : ''}`} aria-live="polite">
      <div className={styles.box}>
        <Spinner size={24} />
        <p className={styles.message}>{message}</p>
      </div>
    </div>
  )
}

export default LoadingOverlay

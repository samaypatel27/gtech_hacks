import { useNavigate } from 'react-router-dom'
import styles from './BackButton.module.css'

function LeftArrowIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  )
}

/**
 * Universal circular back arrow button with no text.
 * Muted grey in default state, turns crisp white on hover.
 */
function BackButton({ to = '/', inline = false, title = 'Back', className = '', ...props }) {
  const navigate = useNavigate()
  const cls = inline ? styles.inline : styles.back

  return (
    <button
      type="button"
      className={`${styles.button} ${cls} ${className}`.trim()}
      onClick={() => navigate(to)}
      title={title}
      aria-label={title}
      {...props}
    >
      <LeftArrowIcon />
    </button>
  )
}

export default BackButton

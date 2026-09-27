import styles from './Badge.module.css'

// tone: neutral | brand | success | warning | danger. `dot` adds a leading
// status dot; `mono` sets the text in the code font (for billing codes).
function Badge({ tone = 'neutral', dot = false, mono = false, className = '', children, ...props }) {
  return (
    <span
      className={`${styles.badge} ${styles[tone]} ${mono ? styles.mono : ''} ${className}`.trim()}
      {...props}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  )
}

export default Badge

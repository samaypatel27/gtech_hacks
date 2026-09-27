import styles from './Spinner.module.css'

function Spinner({ size = 16, label, className = '' }) {
  return (
    <span className={`${styles.wrap} ${className}`.trim()} role="status">
      <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
      {label ? <span className={styles.label}>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  )
}

export default Spinner

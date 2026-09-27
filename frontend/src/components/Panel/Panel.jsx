import styles from './Panel.module.css'

// A white bordered surface for summaries and forms. `flush` drops the body
// padding so a table can run edge to edge.
function Panel({ title, description, actions, flush = false, className = '', children, ...props }) {
  const hasHeader = title || actions
  return (
    <section className={`${styles.panel} ${className}`.trim()} {...props}>
      {hasHeader && (
        <header className={styles.header}>
          <div className={styles.headings}>
            {title && <h2 className={styles.title}>{title}</h2>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={flush ? styles.flush : styles.body}>{children}</div>
    </section>
  )
}

export default Panel

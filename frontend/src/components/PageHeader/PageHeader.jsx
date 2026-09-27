import styles from './PageHeader.module.css'

// Title row at the top of every page inside the app shell: title, an
// optional line of meta, badges beside the title, and actions on the right.
function PageHeader({ title, meta, badges, actions }) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {badges}
        </div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}

export default PageHeader

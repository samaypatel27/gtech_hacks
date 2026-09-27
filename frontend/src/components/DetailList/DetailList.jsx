import styles from './DetailList.module.css'

function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

// Label / value rows. Empty values render as a muted dash, never "null".
function DetailList({ items }) {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div key={item.label} className={styles.row}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={`${styles.value} ${item.mono ? 'mono' : ''}`}>
            {isEmpty(item.value) ? <span className={styles.empty}>—</span> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default DetailList

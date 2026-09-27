import styles from './Table.module.css'

// A dense data table. Cells take data-align="end" for numbers and
// data-mono for codes; rows take data-clickable for a hover highlight.
function Table({ className = '', children, ...props }) {
  return (
    <div className={styles.wrap}>
      <table className={`${styles.table} ${className}`.trim()} {...props}>
        {children}
      </table>
    </div>
  )
}

export default Table

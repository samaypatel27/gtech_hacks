import { Link } from 'react-router-dom'
import { PRODUCT_NAME } from '../../lib/roles.js'
import styles from './Brand.module.css'

// Product mark + name. Renders as a link home unless `link` is false.
function Brand({ link = true }) {
  const content = (
    <>
      <span className={styles.mark} aria-hidden="true">
        LR
      </span>
      {PRODUCT_NAME}
    </>
  )
  return link ? (
    <Link to="/" className={styles.brand}>
      {content}
    </Link>
  ) : (
    <span className={styles.brand}>{content}</span>
  )
}

export default Brand

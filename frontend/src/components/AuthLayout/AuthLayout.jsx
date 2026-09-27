import { Link } from 'react-router-dom'
import Icon from '../Icon/Icon.jsx'
import Brand from '../Brand/Brand.jsx'
import styles from './AuthLayout.module.css'

// Frame for pages outside the app shell (sign-in, sign-up, OAuth callback):
// product name on top, one narrow card, an optional back link.
function AuthLayout({ backTo, backLabel = 'Back', title, description, width = 420, children }) {
  return (
    <div className={styles.page}>
      <div className={styles.column} style={{ maxWidth: width }}>
        <div className={styles.top}>
          <Brand />
          {backTo && (
            <Link to={backTo} className={styles.back}>
              <Icon name="arrowLeft" size={14} />
              {backLabel}
            </Link>
          )}
        </div>
        <div className={styles.card}>
          {(title || description) && (
            <div className={styles.heading}>
              {title && <h1 className={styles.title}>{title}</h1>}
              {description && <p className={styles.description}>{description}</p>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

export default AuthLayout

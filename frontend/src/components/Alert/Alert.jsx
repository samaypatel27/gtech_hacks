import Icon from '../Icon/Icon.jsx'
import styles from './Alert.module.css'

const ICONS = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' }

// Inline message. tone: info | success | warning | danger.
function Alert({ tone = 'info', title, className = '', children, ...props }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={`${styles.alert} ${styles[tone]} ${className}`.trim()}
      {...props}
    >
      <Icon name={ICONS[tone]} className={styles.icon} />
      <div className={styles.content}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.body}>{children}</div>}
      </div>
    </div>
  )
}

export default Alert

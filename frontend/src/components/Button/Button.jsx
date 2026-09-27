import { Link } from 'react-router-dom'
import styles from './Button.module.css'

// variant: primary (one per view), secondary, ghost, danger. size: sm | md.
// Pass `to` to render a router link styled as a button. `className` is for
// layout only (width, margin), never the button's own skin.
function Button({
  variant = 'secondary',
  size = 'md',
  to,
  className = '',
  type = 'button',
  children,
  ...props
}) {
  const cls = `${styles.button} ${styles[variant]} ${styles[size]} ${className}`.trim()

  if (to) {
    return (
      <Link to={to} className={cls} {...props}>
        {children}
      </Link>
    )
  }

  return (
    <button type={type} className={cls} {...props}>
      {children}
    </button>
  )
}

export default Button

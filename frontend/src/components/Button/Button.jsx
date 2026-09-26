import styles from './Button.module.css'

// The single button component for the whole app -- see Button.module.css
// for why there are no primary/secondary variants. `className` is for
// layout only (width, margin, flex-grow); it never overrides the button's
// own skin since it's appended after `styles.button`.
function Button({ className = '', type = 'button', ...props }) {
  return <button type={type} className={`${styles.button} ${className}`.trim()} {...props} />
}

export default Button

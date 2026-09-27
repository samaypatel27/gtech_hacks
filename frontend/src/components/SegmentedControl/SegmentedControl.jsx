import styles from './SegmentedControl.module.css'

// Reusable segmented control that renders N options inside a single rounded
// rectangle with thin vertical dividers between them. Props:
//
//   options  — Array of { value: string, label: string }
//   value    — The currently active value
//   onChange — Called with the new value when a segment is pressed
//   className — Optional layout class (width, margin) appended to the root
//
// The active segment is highlighted; inactive segments are muted. Keyboard
// accessible — each segment is a <button> with aria-pressed.
function SegmentedControl({ options, value, onChange, className = '' }) {
  return (
    <div
      className={`${styles.control} ${className}`.trim()}
      role="group"
    >
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            className={`${styles.segment} ${isActive ? styles.active : ''}`.trim()}
            aria-pressed={isActive}
            onClick={() => {
              if (!isActive) onChange(opt.value)
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl

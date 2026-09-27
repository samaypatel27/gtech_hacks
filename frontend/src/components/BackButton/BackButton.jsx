import { useNavigate } from 'react-router-dom'
import Button from '../Button/Button.jsx'
import styles from './BackButton.module.css'

// Pinned to the top-left of the page by default (scrolls away with it).
// Pages that render it reserve top padding so their content doesn't sit
// underneath. Pass `inline` to disable the absolute positioning (e.g.
// when placing it inside a flex navbar).
function BackButton({ to = '/', children = 'Back', inline = false }) {
  const navigate = useNavigate()
  const cls = inline ? styles.inline : styles.back

  return (
    <Button className={cls} onClick={() => navigate(to)}>
      &larr; {children}
    </Button>
  )
}

export default BackButton

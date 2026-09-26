import { useNavigate } from 'react-router-dom'
import Button from '../Button/Button.jsx'
import styles from './BackButton.module.css'

// Pinned to the top-left of the page (scrolls away with it). Pages that
// render it reserve top padding so their content doesn't sit underneath.
function BackButton({ to = '/', children = 'Back' }) {
  const navigate = useNavigate()

  return (
    <Button className={styles.back} onClick={() => navigate(to)}>
      &larr; {children}
    </Button>
  )
}

export default BackButton

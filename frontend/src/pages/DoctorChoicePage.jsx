import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import Button from '../components/Button/Button.jsx'
import styles from './DoctorChoicePage.module.css'

// Landing page for the Doctor role: either browse drugs directly, or sign
// up with an NPI first (Phase 2 -- personalizes the Considering page).
function DoctorChoicePage() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <BackButton />
      <div className={styles.choices}>
        <Button onClick={() => navigate('/doctor/drugs')}>View Drugs</Button>
        <Button onClick={() => navigate('/sign-up')}>Sign Up</Button>
      </div>
    </div>
  )
}

export default DoctorChoicePage

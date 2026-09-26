import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import AuthStatus from '../components/AuthStatus/AuthStatus.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'
import styles from './DoctorPage.module.css'

// The dashboard is not public -- anonymous visitors are bounced back to the
// /doctor gate, which offers Sign In / Sign Up.
function DoctorPage() {
  const navigate = useNavigate()
  const { email, loading } = useAuthSession()

  useEffect(() => {
    if (!loading && !email) navigate('/doctor', { replace: true })
  }, [loading, email, navigate])

  if (loading || !email) return null

  return (
    <div className={styles.page}>
      <BackButton />
      <AuthStatus />
      <DrugSearchGrid />
    </div>
  )
}

export default DoctorPage

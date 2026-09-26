import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import AuthStatus from '../components/AuthStatus/AuthStatus.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import Button from '../components/Button/Button.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'
import styles from './DoctorPage.module.css'
import '../tailwind.css'

// The dashboard is not public -- anonymous visitors are bounced back to the
// /doctor gate, which offers Sign In / Sign Up.
function DoctorPage() {
  const navigate = useNavigate()
  const { email, loading } = useAuthSession()
  const [view, setView] = useState('drugs') // 'drugs' | 'tasks'

  useEffect(() => {
    if (!loading && !email) navigate('/doctor', { replace: true })
  }, [loading, email, navigate])

  if (loading || !email) return null

  return (
    <div className={styles.page}>
      <BackButton />
      <AuthStatus />

      {/* Two-button toggle: "View Drugs" / "View Tasks".
          Uses the shared Button component for visual consistency.
          Disabled state shows which view is active without extra styling. */}
      <div className="mx-auto w-full max-w-6xl px-6 pt-4 sm:px-11 flex gap-3">
        <Button
          onClick={() => setView('drugs')}
          disabled={view === 'drugs'}
          aria-pressed={view === 'drugs'}
        >
          View Drugs
        </Button>
        <Button
          onClick={() => setView('tasks')}
          disabled={view === 'tasks'}
          aria-pressed={view === 'tasks'}
        >
          View Tasks
        </Button>
      </div>

      <DrugSearchGrid view={view} email={email} />
    </div>
  )
}

export default DoctorPage

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import AuthStatus from '../components/AuthStatus/AuthStatus.jsx'
import SegmentedControl from '../components/SegmentedControl/SegmentedControl.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'
import styles from './DoctorPage.module.css'

const VIEW_OPTIONS = [
  { value: 'drugs', label: 'Drugs' },
  { value: 'tasks', label: 'Workspaces' },
]

// The dashboard is not public -- anonymous visitors are bounced back to the
// /doctor gate, which offers Sign In / Sign Up. (Nurse/Biller/Front Desk have
// their own unauthenticated entry points from Home -- see StaffWorkspacesPage.)
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
      <div className="w-full px-4 sm:px-8">
        <div className="mx-auto w-full max-w-6xl p-2 sm:p-3">
          <nav className={styles.navbar}>
            <div className={styles.navLeft}>
              <BackButton inline />
            </div>

            <div className={styles.navCenter}>
              <SegmentedControl
                options={VIEW_OPTIONS}
                value={view}
                onChange={setView}
              />
            </div>

            <div className={styles.navRight}>
              <AuthStatus inline />
            </div>
          </nav>
        </div>
      </div>

      <DrugSearchGrid view={view} email={email} />
    </div>
  )
}

export default DoctorPage

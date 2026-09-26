import { useParams, Navigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import styles from './DoctorPage.module.css'
import '../tailwind.css'

const ROLE_LABELS = { nurse: 'Nurse', biller: 'Biller', front_desk: 'Front Desk' }

// Unauthenticated entry point for Nurse/Biller/Front Desk from Home: lists
// every practice's workspace that has a task for this role (see
// GET /api/workspaces/by-role/{role}), reusing the same WorkspaceCard grid
// as the doctor's own "View Tasks" tab. No sign-in, no practice scoping --
// clicking a card lands on /staff/:role/workspace/:practiceDrugId, this role's
// own route over the same workspace data the doctor's route serves.
function StaffWorkspacesPage() {
  const { role } = useParams()
  const label = ROLE_LABELS[role]

  if (!label) return <Navigate to="/" replace />

  return (
    <div className={styles.page}>
      <BackButton />
      <h1 className="mx-auto w-full max-w-6xl px-6 pt-4 text-xl font-semibold text-[#f0f0f5] sm:px-11">
        {label} workspaces
      </h1>
      <DrugSearchGrid view={role} />
    </div>
  )
}

export default StaffWorkspacesPage

import { useParams, Navigate } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import { ROLES, STAFF_ROLES } from '../lib/roles.js'

// Unauthenticated entry point for Nurse/Biller/Front Desk from Home: lists
// every practice's workspace that has a task for this role (see
// GET /api/workspaces/by-role/{role}). No sign-in, no practice scoping --
// clicking a row lands on /staff/:role/workspace/:practiceDrugId, this role's
// own route over the same workspace data the doctor's route serves.
function StaffWorkspacesPage() {
  const { role } = useParams()

  if (!STAFF_ROLES.includes(role)) return <Navigate to="/" replace />

  return (
    <AppShell role={role} breadcrumbs={[{ label: 'Workspaces' }]}>
      <PageHeader
        title={`${ROLES[role].label} workspaces`}
        meta="Every drug workspace with tasks assigned to your role."
      />
      <DrugSearchGrid view={role} />
    </AppShell>
  )
}

export default StaffWorkspacesPage

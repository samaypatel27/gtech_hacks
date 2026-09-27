import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'

// The dashboard is not public -- anonymous visitors are bounced back to the
// /doctor gate, which offers Sign In / Sign Up. (Nurse/Biller/Front Desk have
// their own unauthenticated entry points from Home -- see StaffWorkspacesPage.)
// `?view=workspaces` switches from the drug list to the practice's workspaces;
// the sidebar links to both.
function DoctorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { email, loading } = useAuthSession()
  const showWorkspaces = searchParams.get('view') === 'workspaces'

  useEffect(() => {
    if (!loading && !email) navigate('/doctor', { replace: true })
  }, [loading, email, navigate])

  if (loading || !email) return null

  return (
    <AppShell role="doctor" breadcrumbs={[{ label: showWorkspaces ? 'Workspaces' : 'Drugs' }]}>
      {showWorkspaces ? (
        <PageHeader title="Workspaces" meta="Drugs your team is preparing to use, and how far along each one is." />
      ) : (
        <PageHeader
          title="Drugs"
          meta="Newly approved drugs, the billing code each bills under today, and when that code changes."
        />
      )}
      <DrugSearchGrid view={showWorkspaces ? 'tasks' : 'drugs'} email={email} />
    </AppShell>
  )
}

export default DoctorPage

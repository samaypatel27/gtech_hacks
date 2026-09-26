import { useParams } from 'react-router-dom'
import DrugProfileDashboard from '../components/DoctorDashboard/DrugProfileDashboard.jsx'

// The "Considering" detail view for a specific drug -- fetches the full
// profile for :applicationId and renders it as a bento grid.
function DrugDetailPage() {
  const { applicationId } = useParams()

  // Keying on applicationId forces a remount (and fresh initial state)
  // instead of needing to manually reset state inside the fetch effect.
  return <DrugProfileDashboard key={applicationId} applicationId={applicationId} />
}

export default DrugDetailPage

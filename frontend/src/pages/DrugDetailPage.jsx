import { Link, useParams } from 'react-router-dom'
import '../tailwind.css'

// Placeholder destination for drug search cards. The real detail page
// (the "Considering" view for this specific drug) is built separately.
function DrugDetailPage() {
  const { applicationId } = useParams()

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 px-6 text-center text-[#f0f0f5]">
      <p className="text-sm text-white/40">Drug detail page — coming soon</p>
      <p className="font-mono text-lg">{applicationId}</p>
      <Link to="/doctor" className="mt-4 text-sm text-indigo-300 hover:text-indigo-200">
        ← Back to search
      </Link>
    </div>
  )
}

export default DrugDetailPage

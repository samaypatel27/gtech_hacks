import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DrugCard from './DrugCard.jsx'
import '../../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL

function SkeletonCard() {
  return (
    <div className="flex aspect-[4/5] w-full flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="space-y-2">
        <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
      </div>
      <div className="h-3 w-2/5 animate-pulse rounded bg-white/10" />
    </div>
  )
}

// A workspace rectangle: drug name + done/total count, linking to the
// workspace page. Styled consistently with DrugCard (same grid slot size,
// border, rounded corners, hover lift) but no vial thumbnail -- just text.
function WorkspaceCard({ workspace }) {
  const { practice_drug_id, brand_name, tasks_done, tasks_total } = workspace
  const allDone = tasks_done === tasks_total && tasks_total > 0
  const label = `${brand_name || 'Unknown drug'} workspace, ${tasks_done} of ${tasks_total} tasks done`

  return (
    <Link
      to={`/doctor/workspace/${practice_drug_id}`}
      title={label}
      aria-label={label}
      className="drug-card group relative isolate flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/25 bg-white/[0.03] p-5 no-underline transition-[transform,box-shadow,border-color,opacity] duration-200 ease-out will-change-transform hover:border-white/80 hover:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.25)] focus-visible:border-white/80 focus-visible:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.25)] focus-visible:outline-none motion-safe:hover:z-10 motion-safe:hover:scale-[1.04] motion-safe:hover:-translate-y-1.5 motion-safe:focus-visible:z-10 motion-safe:focus-visible:scale-[1.04] motion-safe:focus-visible:-translate-y-1.5"
    >
      <p className="line-clamp-2 shrink-0 text-lg leading-snug font-semibold text-[#f0f0f5] sm:text-xl">
        {brand_name || 'Unknown drug'}
      </p>

      {/* Spacer so the count sits at the bottom like the application_id in DrugCard. */}
      <div className="flex-1" />

      <p className={`shrink-0 text-[13px] ${allDone ? 'text-white/60' : 'text-white/40'}`}>
        {tasks_done} / {tasks_total} tasks done
      </p>
    </Link>
  )
}

// Fetches every drug once on mount and renders the full set as a grid of
// link cards. When `view` is 'tasks', fetches workspaces instead and renders
// WorkspaceCards. The toggle itself lives in DoctorPage.
function DrugSearchGrid({ view = 'drugs', email = null }) {
  const [drugs, setDrugs] = useState([])
  const [drugsLoading, setDrugsLoading] = useState(true)

  const [workspaces, setWorkspaces] = useState([])
  const [workspacesFetched, setWorkspacesFetched] = useState(false)

  // Fetch drugs once on mount -- always needed (shown in 'drugs' view).
  useEffect(() => {
    let cancelled = false

    fetch(`${API_URL}/api/drugs/search`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return
        const seen = new Set()
        const deduped = (Array.isArray(data) ? data : []).filter((drug) => {
          if (seen.has(drug.application_id)) return false
          seen.add(drug.application_id)
          return true
        })
        setDrugs(deduped)
      })
      .catch(() => {
        if (!cancelled) setDrugs([])
      })
      .finally(() => {
        if (!cancelled) setDrugsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Fetch workspaces when the 'tasks' view is first activated.
  useEffect(() => {
    if (view !== 'tasks' || workspacesFetched || !email) return
    let cancelled = false

    fetch(`${API_URL}/api/practices/${encodeURIComponent(email)}/workspaces`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return
        setWorkspaces(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([])
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspacesFetched(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [view, email, workspacesFetched])

  // ── Tasks view ──────────────────────────────────────────────────────────
  if (view === 'tasks') {
    const isLoading = !workspacesFetched

    return (
      <div className="min-h-screen w-full px-4 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-6xl p-2 sm:p-3">
          {!isLoading && (
            <p className="mb-3 text-xs font-medium tracking-wide text-white/40">
              {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
            </p>
          )}

          {isLoading && (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {!isLoading && workspaces.length === 0 && (
            <div className="mt-16 flex flex-col items-center gap-1.5 text-center">
              <p className="text-sm font-medium text-white/60">
                No workspaces yet — adopt a drug to create one.
              </p>
            </div>
          )}

          {!isLoading && workspaces.length > 0 && (
            <div className="drug-grid grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
              {workspaces.map((ws) => (
                <WorkspaceCard key={ws.practice_drug_id} workspace={ws} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Drugs view (default) ────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-6xl p-2 sm:p-3">
        {!drugsLoading && (
          <p className="mb-3 text-xs font-medium tracking-wide text-white/40">
            {drugs.length} drug{drugs.length === 1 ? '' : 's'}
          </p>
        )}

        {drugsLoading && (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!drugsLoading && drugs.length === 0 && (
          <div className="mt-16 flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-medium text-white/60">No drugs found.</p>
          </div>
        )}

        {!drugsLoading && drugs.length > 0 && (
          <div className="drug-grid grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {drugs.map((drug) => (
              <DrugCard key={drug.application_id} drug={drug} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DrugSearchGrid

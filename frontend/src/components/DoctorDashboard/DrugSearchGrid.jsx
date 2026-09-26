import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DrugCard from './DrugCard.jsx'
import { fetchPins, pinDrug, unpinDrug } from '../../api/pins.js'
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

// Fetches every drug (plus this practice's pins) once on mount and renders
// the full set as a grid of link cards, pinned ones first -- no search. When
// `view` is 'tasks', fetches workspaces instead and renders WorkspaceCards.
// The toggle itself lives in DoctorPage.
function DrugSearchGrid({ view = 'drugs', email = null }) {
  const [drugs, setDrugs] = useState([])
  const [drugsLoading, setDrugsLoading] = useState(true)
  // null = pins unavailable (e.g. signed in but sign-up not finished), so
  // the pin buttons are hidden rather than shown and failing on click.
  const [pinnedIds, setPinnedIds] = useState(null)
  const [pendingIds, setPendingIds] = useState(() => new Set())

  const [workspaces, setWorkspaces] = useState([])
  const [workspacesFetched, setWorkspacesFetched] = useState(false)

  // Fetch drugs and pins once on mount -- always needed (shown in 'drugs' view).
  useEffect(() => {
    let cancelled = false

    const drugsRequest = fetch(`${API_URL}/api/drugs/search`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const seen = new Set()
        return (Array.isArray(data) ? data : []).filter((drug) => {
          if (seen.has(drug.application_id)) return false
          seen.add(drug.application_id)
          return true
        })
      })
      .catch(() => [])
    const pinsRequest = fetchPins()
      .then((ids) => new Set(ids))
      .catch(() => null)

    // Wait for both so pinned cards don't jump to the top after first paint.
    Promise.all([drugsRequest, pinsRequest]).then(([drugList, pins]) => {
      if (cancelled) return
      setDrugs(drugList)
      setPinnedIds(pins)
      setDrugsLoading(false)
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

  // The backend already sorts by brand name, so a stable partition keeps
  // both groups alphabetical.
  const sortedDrugs = useMemo(() => {
    if (!pinnedIds || pinnedIds.size === 0) return drugs
    return [
      ...drugs.filter((drug) => pinnedIds.has(drug.application_id)),
      ...drugs.filter((drug) => !pinnedIds.has(drug.application_id)),
    ]
  }, [drugs, pinnedIds])

  // Optimistic: flip the pin immediately, then revert if the request fails.
  // Clicks on a card with a request still in flight are ignored so two
  // opposite requests can't race each other.
  const togglePin = async (applicationId) => {
    if (pendingIds.has(applicationId)) return
    const wasPinned = pinnedIds.has(applicationId)
    const withPin = (pinned) => (set) => {
      const next = new Set(set)
      if (pinned) next.add(applicationId)
      else next.delete(applicationId)
      return next
    }

    setPinnedIds(withPin(!wasPinned))
    setPendingIds(withPin(true))
    try {
      await (wasPinned ? unpinDrug(applicationId) : pinDrug(applicationId))
    } catch {
      setPinnedIds(withPin(wasPinned))
    } finally {
      setPendingIds(withPin(false))
    }
  }

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
            {sortedDrugs.map((drug) => (
              <DrugCard
                key={drug.application_id}
                drug={drug}
                isPinned={Boolean(pinnedIds?.has(drug.application_id))}
                onTogglePin={pinnedIds ? () => togglePin(drug.application_id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DrugSearchGrid

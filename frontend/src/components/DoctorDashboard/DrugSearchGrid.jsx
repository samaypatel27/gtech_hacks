import { useEffect, useMemo, useState } from 'react'
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

// Fetches every drug (plus this practice's pins) once on mount and renders
// the full set as a grid of link cards, pinned ones first -- no search.
function DrugSearchGrid() {
  const [drugs, setDrugs] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  // null = pins unavailable (e.g. signed in but sign-up not finished), so
  // the pin buttons are hidden rather than shown and failing on click.
  const [pinnedIds, setPinnedIds] = useState(null)
  const [pendingIds, setPendingIds] = useState(() => new Set())

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
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

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

  return (
    <div className="min-h-screen w-full px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-6xl p-2 sm:p-3">
        {!isLoading && (
          <p className="mb-3 text-xs font-medium tracking-wide text-white/40">
            {drugs.length} drug{drugs.length === 1 ? '' : 's'}
          </p>
        )}

        {isLoading && (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!isLoading && drugs.length === 0 && (
          <div className="mt-16 flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-medium text-white/60">No drugs found.</p>
          </div>
        )}

        {!isLoading && drugs.length > 0 && (
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

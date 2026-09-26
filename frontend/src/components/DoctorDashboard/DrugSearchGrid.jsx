import { useEffect, useState } from 'react'
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

// Fetches every drug once on mount and renders the full set as a grid of
// link cards -- no search.
function DrugSearchGrid() {
  const [drugs, setDrugs] = useState([])
  const [isLoading, setIsLoading] = useState(true)

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
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

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

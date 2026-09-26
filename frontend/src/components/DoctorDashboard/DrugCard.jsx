import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL

function initials(name) {
  return (name || '').slice(0, 2).toUpperCase()
}

function PillIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-8 w-8 text-slate-400 dark:text-slate-600"
      aria-hidden="true"
    >
      <rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="9" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function DrugCard({ drug, onSelectDrug }) {
  const [images, setImages] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setImages(null)

    fetch(`${API_URL}/api/drugs/${encodeURIComponent(drug.brand_name)}/images`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setImages(data?.images ?? []))
      .catch(() => setImages([]))
      .finally(() => setIsLoading(false))

    return () => controller.abort()
  }, [drug.brand_name])

  const badge = drug.has_permanent_code
    ? {
        text: drug.permanent_hcpcs_code || 'Permanent code',
        tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
      }
    : {
        text: drug.generic_billing_code || 'Generic code',
        tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
      }

  const hasImage = !isLoading && images && images.length > 0
  const showFallback = !isLoading && (!images || images.length === 0)

  return (
    <button
      type="button"
      onClick={() => onSelectDrug(drug)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {isLoading && <div className="absolute inset-0 animate-pulse bg-slate-200 dark:bg-slate-700" />}

        {hasImage && (
          <img
            src={images[0]}
            alt={drug.brand_name}
            className="h-full w-full rounded-lg object-cover"
          />
        )}

        {showFallback && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-600">
            <PillIcon />
            <span className="text-lg font-semibold tracking-wide">{initials(drug.brand_name)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {drug.brand_name}
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-slate-500 dark:text-slate-400">
            {drug.application_id}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.tone}`}>
            {badge.text}
          </span>
        </div>
      </div>
    </button>
  )
}

export default DrugCard

import { useEffect, useState } from 'react'
import DrugCard from './DrugCard.jsx'
import '../../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="14" y1="14" x2="18" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <div className="aspect-square w-full animate-pulse bg-slate-200 dark:bg-slate-700" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  )
}

// Debounced live search against GET /api/drugs/search, rendered as a
// results grid. Route-agnostic — the parent decides what happens on
// selection via onSelectDrug.
function DrugSearchGrid({ onSelectDrug }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setHasSearched(false)
      setIsSearching(false)
      return
    }

    const controller = new AbortController()
    setIsSearching(true)

    const timer = setTimeout(() => {
      fetch(`${API_URL}/api/drugs/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setResults(Array.isArray(data) ? data : []))
        .catch(() => setResults([]))
        .finally(() => {
          setIsSearching(false)
          setHasSearched(true)
        })
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const handleClear = () => {
    setQuery('')
    setResults([])
    setHasSearched(false)
    setIsSearching(false)
  }

  return (
    <div className="min-h-screen w-full px-4 pb-16">
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-6">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-blue-500 dark:border-slate-800 dark:bg-slate-900">
          <span className="sr-only">Search newly launched drugs by brand name</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search newly launched drugs by brand name..."
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="shrink-0 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <ClearIcon />
            </button>
          )}
          <SearchIcon />
        </label>
      </div>

      {isSearching && (
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!isSearching && hasSearched && results.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center text-slate-400">
          <p className="text-sm font-medium">No drugs match "{query}"</p>
          <p className="text-xs">Try a different brand name.</p>
        </div>
      )}

      {!isSearching && results.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
          {results.map((drug) => (
            <DrugCard key={drug.application_id} drug={drug} onSelectDrug={onSelectDrug} />
          ))}
        </div>
      )}
    </div>
  )
}

export default DrugSearchGrid

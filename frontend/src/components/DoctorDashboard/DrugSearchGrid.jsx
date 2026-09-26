import { useEffect, useRef, useState } from 'react'
import DrugCard from './DrugCard.jsx'
import '../../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="14" y1="14" x2="18" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SkeletonCard() {
  return (
    <div className="flex aspect-[4/5] w-full flex-col justify-between rounded-2xl border-[1.5px] border-white/10 bg-white/[0.03] p-5">
      <div className="space-y-2">
        <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
      </div>
      <div className="h-3 w-2/5 animate-pulse rounded bg-white/10" />
    </div>
  )
}

// Debounced live search against GET /api/drugs/search, rendered as a
// results grid. Each card links directly to its drug detail route.
function DrugSearchGrid() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)

  const runSearch = (term) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsSearching(true)

    fetch(`${API_URL}/api/drugs/search?q=${encodeURIComponent(term)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setResults(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== 'AbortError') setResults([])
      })
      .finally(() => {
        setIsSearching(false)
        setHasSearched(true)
      })
  }

  useEffect(() => {
    const trimmed = query.trim()
    clearTimeout(debounceRef.current)

    if (!trimmed) {
      abortRef.current?.abort()
      setResults([])
      setHasSearched(false)
      setIsSearching(false)
      return
    }

    debounceRef.current = setTimeout(() => runSearch(trimmed), 300)

    return () => clearTimeout(debounceRef.current)
  }, [query])

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return
    const trimmed = query.trim()
    if (!trimmed) return
    clearTimeout(debounceRef.current)
    runSearch(trimmed)
  }

  const handleClear = () => {
    abortRef.current?.abort()
    clearTimeout(debounceRef.current)
    setQuery('')
    setResults([])
    setHasSearched(false)
    setIsSearching(false)
  }

  const showCount = !isSearching && hasSearched && results.length > 0
  const showEmpty = !isSearching && hasSearched && results.length === 0

  return (
    <div className="min-h-screen w-full px-4 pb-16 sm:px-8">
      <div className="mx-auto w-full max-w-[640px] pt-8 pb-6">
        {/* This container owns the border/background/focus state; the
            input and button below are reset to appearance:none so the
            browser never draws its own native chrome over them. */}
        <label className="flex h-12 items-center gap-2.5 rounded-xl border border-slate-400/15 bg-white/5 px-4 backdrop-blur-sm transition-all duration-200 focus-within:border-indigo-400/40 focus-within:shadow-[0_0_0_3px_rgba(129,140,248,0.15)]">
          <SearchIcon />
          <span className="sr-only">Search by drug name or application number</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by drug name or application number"
            className="w-full min-w-0 appearance-none border-0 bg-transparent p-0 text-sm text-[#f0f0f5] outline-none [-webkit-appearance:none] [font:inherit] placeholder:text-white/35"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-white/40 outline-none transition-colors duration-150 hover:bg-white/10 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            >
              <ClearIcon />
            </button>
          )}
        </label>
      </div>

      <div className="mx-auto w-full max-w-6xl p-2 sm:p-3">
        {showCount && (
          <p className="mb-3 text-xs font-medium tracking-wide text-white/40">
            {results.length} drug{results.length === 1 ? '' : 's'}
          </p>
        )}

        {isSearching && (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {showEmpty && (
          <div className="mt-16 flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-medium text-white/60">No drugs match "{query}"</p>
            <p className="text-xs text-white/35">Try a different brand name or application number.</p>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <div className="drug-grid grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {results.map((drug) => (
              <DrugCard key={drug.application_id} drug={drug} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DrugSearchGrid

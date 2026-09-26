import { useState, type FormEvent } from 'react'
import '../../tailwind.css'

type StatusLevel = 'yellow' | 'green'

type StatusCard = {
  title: string
  level: StatusLevel
  message: string
  className: string
}

const STATUS_CARDS: StatusCard[] = [
  {
    title: 'Billing Path',
    level: 'yellow',
    message:
      'No permanent HCPCS code yet — claims will need a miscellaneous (generic) code, which carries a higher risk of denial or manual review.',
    className: 'md:col-span-2 md:row-span-1',
  },
  {
    title: 'Payment Timing',
    level: 'yellow',
    message:
      'Estimated $42,000 in cash tied up per patient while awaiting reimbursement under the generic code pathway.',
    className: 'md:col-span-1 md:row-span-2',
  },
  {
    title: 'Workflow',
    level: 'green',
    message:
      "Clinic capabilities match this therapy's infusion, storage, and monitoring requirements.",
    className: 'md:col-span-2 md:row-span-1',
  },
]

const INDICATOR_STYLES: Record<StatusLevel, string> = {
  yellow: 'bg-yellow-400 shadow-[0_0_10px_2px] shadow-yellow-400/40',
  green: 'bg-green-400 shadow-[0_0_10px_2px] shadow-green-400/40',
}

function ConsideringDashboard() {
  const [query, setQuery] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (query.trim()) {
      setHasSearched(true)
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center px-6 py-16 text-[#f0f0f5]">
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-xl transition-all duration-500 ${
          hasSearched ? 'mt-0' : 'mt-[30vh]'
        }`}
      >
        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-sm focus-within:border-white/20">
          <span className="sr-only">Search for a newly launched drug</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a newly launched drug (e.g., DrugX)"
            className="w-full bg-transparent text-base text-[#f0f0f5] placeholder-white/40 outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/15"
          >
            Search
          </button>
        </label>
      </form>

      {hasSearched && (
        <div className="mt-10 grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-3 md:grid-rows-2">
          {STATUS_CARDS.map((card, index) => (
            <div
              key={card.title}
              className={`animate-[fade-in-up_0.5s_ease-out_forwards] rounded-2xl border border-white/10 bg-white/5 p-6 opacity-0 backdrop-blur-sm ${card.className}`}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${INDICATOR_STYLES[card.level]}`} />
                <h3 className="text-sm font-semibold uppercase tracking-wide text-white/70">
                  {card.title}
                </h3>
              </div>
              <p className="text-base leading-relaxed">{card.message}</p>
            </div>
          ))}

          <div
            className="animate-[fade-in-up_0.5s_ease-out_forwards] flex flex-col gap-3 opacity-0 sm:flex-row md:col-span-3"
            style={{ animationDelay: `${STATUS_CARDS.length * 120}ms` }}
          >
            <button
              type="button"
              className="flex-1 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
            >
              Get my team ready
            </button>
            <button
              type="button"
              className="flex-1 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white/90 transition-colors hover:border-white/40 hover:bg-white/5"
            >
              Add patients to hold list
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConsideringDashboard

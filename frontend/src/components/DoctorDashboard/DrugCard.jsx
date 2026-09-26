import { Link } from 'react-router-dom'

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M6 14L14 6M14 6H8M14 6V12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Simple card: just the brand name and application id, linking to the
// drug's detail route.
function DrugCard({ drug }) {
  const ariaLabel = `${drug.brand_name}, ${drug.application_id}`

  return (
    <Link
      to={`/drugs/${encodeURIComponent(drug.application_id)}`}
      title={ariaLabel}
      aria-label={ariaLabel}
      className="drug-card group relative isolate flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/25 bg-white/[0.03] p-5 no-underline transition-[transform,box-shadow,border-color,opacity] duration-200 ease-out will-change-transform hover:border-white/80 hover:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.25)] focus-visible:border-white/80 focus-visible:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.25)] focus-visible:outline-none motion-safe:hover:z-10 motion-safe:hover:scale-[1.04] motion-safe:hover:-translate-y-1.5 motion-safe:focus-visible:z-10 motion-safe:focus-visible:scale-[1.04] motion-safe:focus-visible:-translate-y-1.5"
    >
      <span className="pointer-events-none absolute top-4 right-4 text-white/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <ArrowIcon />
      </span>

      <p className="line-clamp-2 text-lg leading-snug font-semibold text-[#f0f0f5] sm:text-xl">
        {drug.brand_name}
      </p>

      <p className="font-mono text-[13px] text-white/40">{drug.application_id}</p>
    </Link>
  )
}

export default DrugCard

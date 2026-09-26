import { Link } from 'react-router-dom'

// Billing status is derived entirely from fields already on the row
// (has_permanent_code / generic_billing_code / permanent_hcpcs_code) —
// no new data, just an accent color for what's already there.
function getStatusAccent(drug) {
  const isClassified = Boolean(drug.has_permanent_code)
  return {
    isClassified,
    code: (isClassified ? drug.permanent_hcpcs_code : drug.generic_billing_code) || '—',
    statusLabel: isClassified ? 'permanent billing code' : 'unclassified billing code',
    accent: isClassified ? '#34D399' : '#FBBF24',
    accentSoft: isClassified ? 'rgba(52,211,153,0.5)' : 'rgba(251,191,36,0.5)',
    accentFaint: isClassified ? 'rgba(52,211,153,0.14)' : 'rgba(251,191,36,0.14)',
  }
}

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

function DrugCard({ drug }) {
  const status = getStatusAccent(drug)
  const ariaLabel = `${drug.brand_name}, ${drug.application_id}, ${status.statusLabel} ${status.code}`

  return (
    <Link
      to={`/drugs/${encodeURIComponent(drug.application_id)}`}
      title={ariaLabel}
      aria-label={ariaLabel}
      style={{ '--accent': status.accent, '--accent-soft': status.accentSoft }}
      className="drug-card group relative isolate flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-2xl border-[1.5px] border-[color:var(--accent-soft)] bg-white/[0.03] p-5 no-underline transition-[transform,box-shadow,border-color,opacity] duration-200 ease-out will-change-transform hover:border-[color:var(--accent)] hover:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_var(--accent-soft)] focus-visible:border-[color:var(--accent)] focus-visible:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_var(--accent-soft)] focus-visible:outline-none motion-safe:hover:z-10 motion-safe:hover:scale-[1.04] motion-safe:hover:-translate-y-1.5 motion-safe:focus-visible:z-10 motion-safe:focus-visible:scale-[1.04] motion-safe:focus-visible:-translate-y-1.5"
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
        style={{ background: `linear-gradient(to top, ${status.accentFaint}, transparent)` }}
      />

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

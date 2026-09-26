import { useState } from 'react'
import { Link } from 'react-router-dom'
import { renderVialSnapshot } from './vialRenderer.js'
import StaticVialSvg from './StaticVialSvg.jsx'

const STATUS_COLORS = {
  permanent: { css: '#34D399', hex: 0x34d399 },
  generic: { css: '#FBBF24', hex: 0xfbbf24 },
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

// A still (non-spinning) snapshot of the same glass vial used on the detail
// page, rendered once via a shared offscreen WebGL context (vialRenderer.js)
// and cached by application id -- cheap even with a full grid of cards.
function CardVialThumb({ drug, statusColor, statusColorHex }) {
  const [dataUrl] = useState(() =>
    renderVialSnapshot({
      applicationId: drug.application_id,
      statusColor,
      statusColorHex,
      width: 240,
      height: 300,
    }),
  )

  return (
    <div className="flex h-full w-full items-center justify-center">
      {dataUrl ? (
        <img src={dataUrl} alt="" aria-hidden="true" className="h-full w-full object-contain opacity-90" />
      ) : (
        <StaticVialSvg statusColor={statusColor} className="h-full max-h-[70%] w-auto opacity-80" />
      )}
    </div>
  )
}

// Simple card: brand name, a still vial thumbnail, and the application id,
// linking to the drug's detail route.
function DrugCard({ drug }) {
  const isPermanent = Boolean(drug.has_permanent_code)
  const status = isPermanent ? STATUS_COLORS.permanent : STATUS_COLORS.generic
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

      <p className="line-clamp-2 shrink-0 text-lg leading-snug font-semibold text-[#f0f0f5] sm:text-xl">
        {drug.brand_name}
      </p>

      <div className="min-h-0 flex-1 py-2">
        <CardVialThumb drug={drug} statusColor={status.css} statusColorHex={status.hex} />
      </div>

      <p className="shrink-0 font-mono text-[13px] text-white/40">{drug.application_id}</p>
    </Link>
  )
}

export default DrugCard

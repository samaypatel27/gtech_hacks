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

function PinIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} className="h-4 w-4" aria-hidden="true">
      <path d="M12 17v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Simple card: brand name, a still vial thumbnail, and the application id,
// linking to the drug's detail route. The pin button is a sibling of the
// link rather than a child (a <button> inside an <a> is invalid and the
// link would swallow its click), so the hover lift lives on the wrapper
// to move both together. The pin is omitted when `onTogglePin` isn't given.
function DrugCard({ drug, isPinned = false, onTogglePin }) {
  const isPermanent = Boolean(drug.has_permanent_code)
  const status = isPermanent ? STATUS_COLORS.permanent : STATUS_COLORS.generic
  const ariaLabel = `${drug.brand_name}, ${drug.application_id}`

  return (
    <div className="drug-card group relative isolate aspect-[4/5] w-full transition-[transform,opacity] duration-200 ease-out will-change-transform motion-safe:hover:z-10 motion-safe:hover:scale-[1.04] motion-safe:hover:-translate-y-1.5 motion-safe:has-[:focus-visible]:z-10 motion-safe:has-[:focus-visible]:scale-[1.04] motion-safe:has-[:focus-visible]:-translate-y-1.5">
      <Link
        to={`/drugs/${encodeURIComponent(drug.application_id)}`}
        title={ariaLabel}
        aria-label={ariaLabel}
        className="flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/25 bg-white/[0.03] p-5 no-underline transition-[box-shadow,border-color] duration-200 ease-out group-hover:border-white/80 group-hover:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.25)] focus-visible:border-white/80 focus-visible:shadow-[0_18px_40px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.25)] focus-visible:outline-none"
      >
        <p className="line-clamp-2 shrink-0 pr-7 text-lg leading-snug font-semibold text-[#f0f0f5] sm:text-xl">
          {drug.brand_name}
        </p>

        <div className="min-h-0 flex-1 py-2">
          <CardVialThumb drug={drug} statusColor={status.css} statusColorHex={status.hex} />
        </div>

        <div className="flex shrink-0 items-center justify-between">
          <p className="font-mono text-[13px] text-white/40">{drug.application_id}</p>
          <span className="pointer-events-none text-white/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
            <ArrowIcon />
          </span>
        </div>
      </Link>

      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-pressed={isPinned}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${drug.brand_name}`}
          title={isPinned ? 'Unpin' : 'Pin to top'}
          className={`absolute top-3.5 right-3.5 z-10 flex cursor-pointer appearance-none items-center justify-center rounded-full border-0 bg-transparent p-1.5 transition-colors duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white/70 ${
            isPinned ? 'text-white' : 'text-white/30 hover:text-white/70'
          }`}
        >
          <PinIcon filled={isPinned} />
        </button>
      )}
    </div>
  )
}

export default DrugCard

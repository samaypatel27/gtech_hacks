// Flat vial silhouette used when WebGL isn't available (detail page and
// card thumbnails both fall back to this) or prefers-reduced-motion is set
// on the detail page. Callers already render brand/generic/NDA text
// separately, so this only needs to read as "a vial" in the status color.
function StaticVialSvg({ statusColor, className = 'h-full max-h-[280px] w-auto' }) {
  return (
    <svg viewBox="0 0 120 220" className={className} role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id="glassFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
        </linearGradient>
      </defs>
      <path
        d="M45 10 H75 V30 Q95 45 95 70 V190 Q95 205 80 205 H40 Q25 205 25 190 V70 Q25 45 45 30 Z"
        fill="url(#glassFill)"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="2"
      />
      <path
        d="M28 130 Q28 150 40 150 H80 Q92 150 92 130 V188 Q92 200 80 200 H40 Q28 200 28 188 Z"
        fill={statusColor}
        opacity="0.5"
      />
      <rect x="42" y="6" width="36" height="10" rx="3" fill="#b8bcc4" />
      <rect x="46" y="0" width="28" height="8" rx="3" fill={statusColor} />
    </svg>
  )
}

export default StaticVialSvg

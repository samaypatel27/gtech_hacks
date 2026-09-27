// One 16px, 1.5-stroke icon set for the whole app.
const PATHS = {
  drugs: (
    <>
      <path d="M10.5 3.5 3.5 10.5a3.5 3.5 0 0 0 5 5l7-7a3.5 3.5 0 0 0-5-5Z" />
      <path d="m7 7 5 5" />
    </>
  ),
  workspaces: (
    <>
      <rect x="2.5" y="3" width="4" height="10" rx="1" />
      <rect x="9.5" y="3" width="4" height="6.5" rx="1" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  arrowLeft: <path d="M13 8H3m4-4L3 8l4 4" />,
  arrowRight: <path d="M3 8h10M9 4l4 4-4 4" />,
  switch: <path d="M3 5.5h9.5L10 3M13 10.5H3.5L6 13" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  alert: (
    <>
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <path d="M8 6.5v3M8 11.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.25v3.5M8 5.2v.1" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  pin: (
    <>
      <path d="M8 10.5V14" />
      <path d="M4.5 10.5h7v-1l-1.5-1.25V3.5h.75V2h-5.5v1.5H6v4.75L4.5 9.5Z" />
    </>
  ),
  grip: (
    <>
      <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" strokeWidth="2.2" />
    </>
  ),
  patients: (
    <>
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 13.5a5.25 5.25 0 0 1 10.5 0" />
    </>
  ),
  bell: (
    <>
      <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3l1-1Z" />
      <path d="M6.75 13.5a1.25 1.25 0 0 0 2.5 0" />
    </>
  ),
  external: <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5H7" />,
}

function Icon({ name, size = 16, className = '', filled = false, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}

export default Icon

const DAY_MS = 24 * 60 * 60 * 1000

// "2026-10-01" -> a local-midnight Date, so date-only strings don't shift a
// day in timezones west of UTC.
function parseDate(value) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value) {
  const date = parseDate(value)
  if (!date) return value ?? ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(value) {
  const date = parseDate(value)
  if (!date) return value ?? ''
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatMoney(amount) {
  if (amount == null || amount === '') return ''
  const n = Number(amount)
  if (Number.isNaN(n)) return String(amount)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// Which billing code a drug bills under today, and the next scheduled change
// (from the effective-dated `codes` list, general entries only -- payer-specific
// overrides are a claim-time detail). Falls back to the flat code columns for
// drugs that have no `codes` list.
export function codeTimeline(drug) {
  const today = startOfToday()
  const general = (Array.isArray(drug?.codes) ? drug.codes : []).filter((c) => !c.payer && c.from)

  const current = general.find((c) => {
    const from = parseDate(c.from)
    const to = parseDate(c.to)
    return from && from <= today && (!to || today <= to)
  })

  const upcoming = general
    .map((c) => ({ ...c, fromDate: parseDate(c.from) }))
    .filter((c) => c.fromDate && c.fromDate > today)
    .sort((a, b) => a.fromDate - b.fromDate)[0]

  const fallbackPermanent = Boolean(drug?.has_permanent_code)
  return {
    current: current
      ? { code: current.code, type: current.type }
      : {
          code: fallbackPermanent ? drug?.permanent_hcpcs_code : drug?.generic_billing_code,
          type: fallbackPermanent ? 'permanent' : 'generic',
        },
    upcoming: upcoming
      ? {
          code: upcoming.code,
          type: upcoming.type,
          from: upcoming.from,
          daysUntil: Math.round((upcoming.fromDate - today) / DAY_MS),
        }
      : null,
  }
}

export function daysLabel(days) {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

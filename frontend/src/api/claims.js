const API_URL = import.meta.env.VITE_API_URL

// The claim page has no login of its own (same as the rest of /staff/*), so
// this follows the plain fetch pattern (api/drugMaker.js, api/practices.js),
// not the token-attaching one in api/pins.js.
async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, options)
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.detail ?? `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return body
}

// GET .../claim: the built CMS-1500 fields, the 8 pre-submission checks, and
// export status -- see ProductSpec2 Step 11.
export const fetchClaim = (treatmentId) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/claim`)

// POST .../export: "ready for your clearinghouse" -- nothing is auto-submitted
// (ProductSpec2 Step 12). Printing to PDF is a separate, purely-frontend step
// (window.print()) that the claim page triggers after this succeeds.
export const exportClaim = (treatmentId) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/export`, { method: 'POST' })

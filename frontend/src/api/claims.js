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

// POST .../recode: "Build corrected claim" for a claim Switch flagged as
// exported with an outdated code. Returns the rebuilt claim, marked as a
// replacement of the original (Box 22, resubmission code 7).
export const recodeClaim = (treatmentId) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/recode`, { method: 'POST' })

// GET .../code-status: the billing-code change notice for a drug's workspace
// (countdown before a change, "since <date>" after it). Opening it also runs
// the once-per-change reactions: flagging claims to recode and the biller's
// and doctor's code-change cards.
export const fetchCodeStatus = (practiceDrugId) =>
  request(`/api/practice-drugs/${encodeURIComponent(practiceDrugId)}/code-status`)

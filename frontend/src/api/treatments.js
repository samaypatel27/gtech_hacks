const API_URL = import.meta.env.VITE_API_URL

// The nurse's treatment record has no login of its own (same as the rest of
// /staff/*), so this follows the plain fetch pattern, not the token-attaching
// one in api/pins.js.
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

const jsonBody = (payload) => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

// GET a single treatment row -- the same row moves through
// ordered -> signed -> administered -> claim_ready -> exported.
export const fetchTreatment = (treatmentId) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}`)

// PATCH .../preparation: vials used, lot number, waste -> the backend runs
// waste_modifier (billing_rules.py) and returns which JW/JZ applies.
export const savePreparation = (treatmentId, payload) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/preparation`, jsonBody(payload))

// PATCH .../administration: date of service + start/stop times -> the
// backend runs admin_codes (billing_rules.py) and returns which code applies.
// The date of service is what Switch reads later to pick the billing code.
export const saveAdministration = (treatmentId, payload) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/administration`, jsonBody(payload))

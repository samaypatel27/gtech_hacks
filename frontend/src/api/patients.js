import { supabase } from '../lib/supabaseClient.js'

const API_URL = import.meta.env.VITE_API_URL

// The patient chart lives under /doctor/*, which is gated behind sign-in, so
// every call here attaches the Supabase session token -- same pattern as
// api/pins.js. The backend verifies it via the current_practice dependency;
// the frontend never sends an email or practice id directly.
async function request(path, options = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.detail ?? `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return body
}

const jsonHeaders = { 'Content-Type': 'application/json' }

// GET one patient: demographics, weight (for dose_for), insurance/member id
// (for coverage and the claim), diagnosis, and the current visit note the
// documentation check reads.
export const fetchPatient = (patientId) =>
  request(`/api/patients/${encodeURIComponent(patientId)}`)

// GET every patient of the signed-in practice -- the workspace's "Start first
// patient" list.
export const fetchPatients = () => request('/api/patients')

// PATCH the visit note. Called on every edit (debounced by the page) so the
// documentation check can be re-run live -- deleting a line should flip a
// check to ✗, per ProductSpec2's demo note.
export const savePatientNote = (patientId, note) =>
  request(`/api/patients/${encodeURIComponent(patientId)}/note`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ note }),
  })

// POST a new order: "New Order -> DrugX" (ProductSpec2 Step 8). Creates the
// treatments row and returns the calculated dose + vial mix (dose_for,
// vial_mix in billing_rules.py).
export const createTreatment = ({ patientId, applicationId, practiceDrugId }) =>
  request('/api/treatments', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      patient_id: patientId,
      application_id: applicationId,
      practice_drug_id: practiceDrugId,
    }),
  })

// POST the documentation check: reads the note against the label's approved
// -use requirements, quoting the note per item, and can draft missing text
// (ProductSpec2 Step 9).
export const runDocCheck = (treatmentId) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/doc-check`, { method: 'POST' })

// POST sign: locks in the order (dose, vial mix, doc-check results, a copy
// of the note) and moves the treatment to 'signed'.
export const signTreatment = (treatmentId) =>
  request(`/api/treatments/${encodeURIComponent(treatmentId)}/sign`, { method: 'POST' })

import { supabase } from '../lib/supabaseClient.js'

const API_URL = import.meta.env.VITE_API_URL

// The doctor's decisions on a drug's page (planned patients, hold list) and
// the notification bell. Both are per practice, so every call attaches the
// Supabase session token -- same pattern as api/pins.js.
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

// Returns the updated practice_drugs row, with its lights recomputed (the
// payment-timing estimate uses the planned patients).
export const savePlan = (practiceDrugId, plannedPatientsPerMonth) =>
  request(`/api/practice-drugs/${practiceDrugId}/plan`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ planned_patients_per_month: plannedPatientsPerMonth }),
  })

// Hold-list calls all return { status, hold_list: [{patient_id, name, payer, note, added_at}] }.
export const fetchHoldList = (practiceDrugId) => request(`/api/practice-drugs/${practiceDrugId}/hold-list`)

export const holdPatient = (practiceDrugId, patientId, note) =>
  request(`/api/practice-drugs/${practiceDrugId}/hold-list`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ patient_id: patientId, note: note || null }),
  })

export const unholdPatient = (practiceDrugId, patientId) =>
  request(`/api/practice-drugs/${practiceDrugId}/hold-list/${patientId}`, { method: 'DELETE' })

// { notifications: [...], unread_count }
export const fetchNotifications = () => request('/api/notifications')

export const markNotificationRead = (id) => request(`/api/notifications/${id}/read`, { method: 'POST' })

export const markAllNotificationsRead = () => request('/api/notifications/read-all', { method: 'POST' })

import { supabase } from '../lib/supabaseClient.js'

const API_URL = import.meta.env.VITE_API_URL

// Pins are per practice, and the backend identifies the practice from the
// verified Supabase session token -- never from an email we send it.
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

export const fetchPins = () => request('/api/pins')

export const pinDrug = (applicationId) =>
  request(`/api/pins/${encodeURIComponent(applicationId)}`, { method: 'PUT' })

export const unpinDrug = (applicationId) =>
  request(`/api/pins/${encodeURIComponent(applicationId)}`, { method: 'DELETE' })

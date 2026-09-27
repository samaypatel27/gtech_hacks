const API_URL = import.meta.env.VITE_API_URL

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.detail ?? `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return body
}

export const fetchNpi = (number) => request(`/api/npi/${encodeURIComponent(number)}`)

export const savePractice = (practice) =>
  request('/api/practices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(practice),
  })

// The practice's workspaces (drugs it has set up with "Get my team ready"):
// [{practice_drug_id, application_id, status, brand_name, tasks_done, tasks_total}].
export const fetchWorkspaces = (email) => request(`/api/practices/${encodeURIComponent(email)}/workspaces`)

// Returns null on a 404 (no account for this email yet) instead of
// throwing, since that's an expected, non-error outcome for callers.
export const fetchPracticeByEmail = async (email) => {
  try {
    return await request(`/api/practices/by-email/${encodeURIComponent(email)}`)
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

const API_URL = import.meta.env.VITE_API_URL

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.detail ?? `Request failed (${response.status})`)
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

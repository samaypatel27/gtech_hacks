const API_URL = import.meta.env.VITE_API_URL

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.detail ?? `Request failed (${response.status})`)
  }
  return body
}

const encode = encodeURIComponent

export const fetchFdaLabel = (applicationId) =>
  request(`/api/fda/label/${encode(applicationId)}`)

export const fetchFdaLabelExtraction = (applicationId) =>
  request(`/api/fda/label-extraction/${encode(applicationId)}`)

export const fetchFdaNdc = (applicationId) =>
  request(`/api/fda/ndc/${encode(applicationId)}`)

export const fetchCmsHcpcsStatus = (drugName) =>
  request(`/api/cms/hcpcs-status/${encode(drugName)}`)

export const fetchCmsApplicationStatus = (drugName) =>
  request(`/api/cms/application-status/${encode(drugName)}`)

export const saveDrug = (drug) =>
  request('/api/drugs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(drug),
  })

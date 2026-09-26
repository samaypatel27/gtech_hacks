import { useState } from 'react'
import DrugMaker from '../components/DrugMaker/DrugMaker.jsx'
import {
  fetchFdaLabel,
  fetchFdaNdc,
  fetchCmsHcpcsStatus,
  fetchCmsApplicationStatus,
  saveDrug,
} from '../api/drugMaker.js'
import styles from './DrugMakerPage.module.css'

// Each source maps its API response onto `drugs` columns. Values the API
// doesn't return (empty strings / empty lists) are stored as null.
const SOURCES = [
  {
    key: 'label',
    label: 'openFDA label',
    fetch: ({ applicationId }) => fetchFdaLabel(applicationId),
    summarize: (data) => data.brand_name || 'No brand name on label',
    toColumns: (data) => ({
      brand_name: data.brand_name || null,
      route_of_administration: data.route || null,
      storage_requirements: data.storage_requirements?.value || null,
    }),
  },
  {
    key: 'ndc',
    label: 'openFDA NDC',
    fetch: ({ applicationId }) => fetchFdaNdc(applicationId),
    summarize: (data) => `${data.ndcs.length} package(s) found`,
    toColumns: (data) => ({
      ndcs: data.ndcs.length ? data.ndcs : null,
    }),
  },
  {
    key: 'hcpcs',
    label: 'CMS HCPCS status',
    fetch: ({ drugName }) => fetchCmsHcpcsStatus(drugName),
    summarize: (data) => data.message,
    toColumns: (data) => ({
      has_permanent_code: data.has_permanent_code ?? null,
      permanent_hcpcs_code: data.permanent_hcpcs_code || null,
    }),
  },
  {
    key: 'application',
    label: 'CMS application status',
    fetch: ({ drugName }) => fetchCmsApplicationStatus(drugName),
    summarize: (data) =>
      `${data.application_status}, expected ${data.expected_permanent_code_date}`,
    toColumns: (data) => ({
      expected_permanent_code_date: data.expected_permanent_code_date || null,
    }),
  },
]

const FDA_KEYS = ['label', 'ndc']

const initialResults = () =>
  SOURCES.map(({ key, label }) => ({ key, label, status: 'idle', message: '' }))

function DrugMakerPage() {
  const [results, setResults] = useState(initialResults)
  const [saveResult, setSaveResult] = useState({ status: 'idle', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateResult = (key, patch) =>
    setResults((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleSubmit = async ({ drugName, applicationId }) => {
    setIsSubmitting(true)
    setResults(initialResults().map((r) => ({ ...r, status: 'loading' })))
    setSaveResult({ status: 'idle', message: '' })

    const settled = await Promise.allSettled(
      SOURCES.map(async (source) => {
        try {
          const data = await source.fetch({ drugName, applicationId })
          updateResult(source.key, { status: 'success', message: source.summarize(data) })
          return source.toColumns(data)
        } catch (err) {
          updateResult(source.key, { status: 'error', message: err.message })
          throw err
        }
      }),
    )

    // A bad application ID 404s on both FDA calls; don't create a row for it.
    const fdaFound = settled.some(
      (outcome, i) => outcome.status === 'fulfilled' && FDA_KEYS.includes(SOURCES[i].key),
    )
    if (!fdaFound) {
      setSaveResult({
        status: 'error',
        message: `Not saved: no FDA data found for ${applicationId}`,
      })
      setIsSubmitting(false)
      return
    }

    // Columns from failed calls are omitted (not nulled) so a transient
    // failure doesn't wipe values already saved for this drug.
    const drug = { application_id: applicationId }
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') Object.assign(drug, outcome.value)
    }

    setSaveResult({ status: 'loading', message: '' })
    try {
      await saveDrug(drug)
      setSaveResult({ status: 'success', message: `Saved ${applicationId} to drugs` })
    } catch (err) {
      setSaveResult({ status: 'error', message: err.message })
    }
    setIsSubmitting(false)
  }

  return (
    <div className={styles.page}>
      <DrugMaker
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        results={results}
        saveResult={saveResult}
      />
    </div>
  )
}

export default DrugMakerPage

import { useState } from 'react'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import DrugMaker from '../components/DrugMaker/DrugMaker.jsx'
import {
  fetchFdaLabel,
  fetchFdaLabelExtraction,
  fetchFdaNdc,
  fetchCmsHcpcsStatus,
  saveDrug,
} from '../api/drugMaker.js'

const cite = (field, citation) => ({ field, citation })

// Each source maps its API response onto `drugs` columns. Values the API
// doesn't return (empty strings / empty lists) are stored as null. When two
// sources map the same column, the earlier source's non-null value wins,
// except `citations`, which is concatenated across sources.
const SOURCES = [
  {
    key: 'label',
    label: 'openFDA label',
    fetch: ({ applicationId }) => fetchFdaLabel(applicationId),
    summarize: (data) => data.brand_name || 'No brand name on label',
    toColumns: (data) => ({
      brand_name: data.brand_name || null,
      generic_name: data.generic_name || null,
      route_of_administration: data.route || null,
      storage_requirements: data.storage_requirements?.value || null,
      citations: data.storage_requirements?.value
        ? [cite('storage_requirements', data.storage_requirements.citation)]
        : [],
    }),
  },
  {
    key: 'extraction',
    label: 'Label extraction (Claude)',
    fetch: ({ applicationId }) => fetchFdaLabelExtraction(applicationId),
    summarize: (data) =>
      `${data.approved_uses_and_conditions.length} approved use(s), dosing: ${data.dosing_formula ?? 'not stated'}`,
    toColumns: (data) => ({
      dosing_formula: data.dosing_formula,
      infusion_time_minutes: data.infusion_time_minutes,
      preparation_instructions: data.preparation_instructions,
      is_single_dose_vial: data.is_single_dose_vial,
      typical_adult_dose: data.typical_adult_dose,
      is_antineoplastic: data.is_antineoplastic,
      approved_uses_and_conditions: data.approved_uses_and_conditions.length
        ? data.approved_uses_and_conditions
        : null,
      citations: data.citations,
    }),
  },
  {
    key: 'ndc',
    label: 'openFDA NDC',
    fetch: ({ applicationId }) => fetchFdaNdc(applicationId),
    summarize: (data) => `${data.ndcs.length} package(s) found`,
    toColumns: (data) => ({
      // Fallback for labels whose openfda block has no route.
      route_of_administration: data.route || null,
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
      citations: [cite('has_permanent_code', data.citation)],
    }),
  },
]

// Generic "not otherwise classified" code a drug bills under until it gets
// its own: cancer drugs → J9999, other biologics (BLA) → J3590, else J3490.
function genericBillingCode(applicationId, isAntineoplastic) {
  if (isAntineoplastic) return 'J9999'
  return applicationId.toUpperCase().startsWith('BLA') ? 'J3590' : 'J3490'
}

// "1 MG" → { quantity: 1, unit: 'mg' }; null for units like "Per Therapeutic Dose".
function parseBillingUnit(billingUnit) {
  const match = /^([\d.,]+)\s*([a-z]+)$/i.exec(billingUnit.trim())
  if (!match) return null
  return { quantity: Number(match[1].replace(/,/g, '')), unit: match[2].toLowerCase() }
}

// Columns that combine more than one source. Each is omitted (left as-is in
// the DB) when a source it depends on failed.
function deriveColumns(applicationId, { hcpcs, extraction }) {
  const columns = {}
  const citations = []
  if (!hcpcs) return { columns, citations }

  if (hcpcs.has_permanent_code) {
    // Standard billing applies; no generic code needed.
    columns.generic_billing_code = null
  } else if (extraction) {
    columns.generic_billing_code = genericBillingCode(
      applicationId,
      extraction.is_antineoplastic,
    )
    citations.push(cite('generic_billing_code', 'Generic code rule: cancer → J9999, BLA → J3590, else J3490'))
  }

  // Medicare's payment limit is only published once a drug has its own code;
  // before that, cost per dose has to come from the drug maker or an invoice.
  const [code] = hcpcs.codes
  const dose = extraction?.typical_adult_dose
  const limitCitation = `${hcpcs.payment_limit_citation}: ${code?.code} $${code?.payment_limit} per ${code?.billing_unit.replace(/^per /i, '')}`
  if (code?.payment_limit != null && /per therapeutic dose/i.test(code.billing_unit)) {
    columns.cost_per_dose = code.payment_limit
    citations.push(cite('cost_per_dose', limitCitation))
  } else if (code?.payment_limit != null && dose) {
    const billingUnit = parseBillingUnit(code.billing_unit)
    if (billingUnit?.unit === dose.unit.toLowerCase()) {
      const units = dose.amount / billingUnit.quantity
      columns.cost_per_dose = Math.round(units * code.payment_limit * 100) / 100
      citations.push(
        cite(
          'cost_per_dose',
          `${limitCitation} × ${dose.amount} ${dose.unit} typical adult dose`,
        ),
      )
    }
  }
  return { columns, citations }
}

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
          return data
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
    const dataByKey = {}
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') dataByKey[SOURCES[i].key] = outcome.value
    })

    const drug = { application_id: applicationId }
    const citations = []
    for (const source of SOURCES) {
      if (!(source.key in dataByKey)) continue
      const { citations: sourceCitations = [], ...columns } = source.toColumns(
        dataByKey[source.key],
      )
      citations.push(...sourceCitations)
      for (const [column, value] of Object.entries(columns)) {
        if (drug[column] == null) drug[column] = value
      }
    }
    const derived = deriveColumns(applicationId, dataByKey)
    Object.assign(drug, derived.columns)
    citations.push(...derived.citations)
    drug.citations = citations.length ? citations : null

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
    <AppShell role="drug_maker" breadcrumbs={[{ label: 'Add drug' }]}>
      <PageHeader
        title="Add a drug"
        meta="Pulls the FDA label, NDC packages and CMS billing status for a newly approved drug, then publishes it to practices."
      />
      <DrugMaker onSubmit={handleSubmit} isSubmitting={isSubmitting} results={results} saveResult={saveResult} />
    </AppShell>
  )
}

export default DrugMakerPage

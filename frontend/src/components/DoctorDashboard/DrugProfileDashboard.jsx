import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import '../../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL

function isEmptyValue(value) {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

function NullValue() {
  return <span className="font-mono text-sm text-slate-400 italic">null</span>
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-white/40 uppercase">{label}</span>
      {isEmptyValue(value) ? <NullValue /> : <span className="text-sm break-words text-white/90">{String(value)}</span>}
    </div>
  )
}

function JsonField({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-white/40 uppercase">{label}</span>
      {isEmptyValue(value) ? (
        <NullValue />
      ) : (
        <pre className="max-h-40 overflow-auto rounded-lg bg-black/20 p-3 font-mono text-xs whitespace-pre-wrap break-words text-white/70">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

const INDICATOR_STYLES = {
  green: 'bg-green-400 shadow-[0_0_10px_2px] shadow-green-400/40',
  yellow: 'bg-yellow-400 shadow-[0_0_10px_2px] shadow-yellow-400/40',
}

function Indicator({ color }) {
  return <span className={`h-3 w-3 shrink-0 rounded-full ${INDICATOR_STYLES[color]}`} />
}

function BentoCard({ title, indicatorColor, className = '', children }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        {indicatorColor && <Indicator color={indicatorColor} />}
        <h3 className="text-sm font-semibold tracking-wide text-white/70 uppercase">{title}</h3>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}

function SkeletonBlock({ className = '' }) {
  return <div className={`animate-pulse rounded-2xl border border-white/10 bg-white/5 ${className}`} />
}

function BentoSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 p-6 md:grid-cols-3">
      <SkeletonBlock className="h-28 md:col-span-3" />
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-40 md:col-span-2" />
      <SkeletonBlock className="h-40" />
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/doctor"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
    >
      ← Back to search
    </Link>
  )
}

// Fetches the full drug profile for `applicationId` and renders it as a
// bento grid. Owns its own data-fetching (like DrugSearchGrid) rather than
// receiving `drug` as a prop, so the page component just wires the route
// param through.
function DrugProfileDashboard({ applicationId }) {
  const [drug, setDrug] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [image, setImage] = useState(null)

  useEffect(() => {
    let cancelled = false

    fetch(`${API_URL}/api/drugs/profile/${encodeURIComponent(applicationId)}`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true)
          return null
        }
        if (!res.ok) throw new Error('profile fetch failed')
        return res.json()
      })
      .then((data) => {
        if (cancelled || !data) return
        setDrug(data)

        if (data.brand_name) {
          fetch(`${API_URL}/api/drugs/${encodeURIComponent(data.brand_name)}/images`)
            .then((res) => (res.ok ? res.json() : null))
            .then((imgData) => {
              if (!cancelled && imgData?.images?.length) setImage(imgData.images[0])
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [applicationId])

  if (isLoading) {
    return (
      <div className="min-h-screen w-full px-4 py-8 text-[#f0f0f5] sm:px-8">
        <div className="mx-auto mb-6 max-w-6xl">
          <BackLink />
        </div>
        <BentoSkeleton />
      </div>
    )
  }

  if (notFound || !drug) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 px-6 text-center text-[#f0f0f5]">
        <p className="text-sm text-white/40">No drug found for</p>
        <p className="font-mono text-lg">{applicationId}</p>
        <div className="mt-4">
          <BackLink />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full px-4 py-8 text-[#f0f0f5] sm:px-8">
      <div className="mx-auto mb-6 max-w-6xl">
        <BackLink />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 p-6 md:grid-cols-3">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm sm:flex-row sm:items-center md:col-span-3">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5">
            {image ? (
              <img src={image} alt={`${drug.brand_name} packaging`} className="h-full w-full object-contain" />
            ) : (
              <NullValue />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">
              {isEmptyValue(drug.brand_name) ? <NullValue /> : drug.brand_name}
            </h1>
            <p className="mt-1 font-mono text-sm text-white/40">{drug.application_id}</p>
          </div>
        </div>

        <BentoCard title="Billing Path" indicatorColor={drug.has_permanent_code ? 'green' : 'yellow'}>
          <Field label="Has Permanent Code" value={drug.has_permanent_code} />
          <Field label="Generic Billing Code" value={drug.generic_billing_code} />
          <Field label="Expected Permanent Code Date" value={drug.expected_permanent_code_date} />
          <Field label="Permanent HCPCS Code" value={drug.permanent_hcpcs_code} />
        </BentoCard>

        <BentoCard title="Payment Timing" indicatorColor="yellow">
          <Field label="Cost Per Dose" value={drug.cost_per_dose} />
        </BentoCard>

        <BentoCard title="Workflow Feasibility" indicatorColor="green">
          <Field label="Storage Requirements" value={drug.storage_requirements} />
          <Field label="Route of Administration" value={drug.route_of_administration} />
          <Field label="Infusion Time (minutes)" value={drug.infusion_time_minutes} />
        </BentoCard>

        <BentoCard title="Clinical Specifications" className="md:col-span-2">
          <Field label="Dosing Formula" value={drug.dosing_formula} />
          <Field label="Preparation Instructions" value={drug.preparation_instructions} />
          <Field label="Is Single Dose Vial" value={drug.is_single_dose_vial} />
        </BentoCard>

        <BentoCard title="Data References">
          <JsonField label="Approved Uses & Conditions" value={drug.approved_uses_and_conditions} />
          <JsonField label="NDCs" value={drug.ndcs} />
          <JsonField label="Citations" value={drug.citations} />
        </BentoCard>
      </div>
    </div>
  )
}

export default DrugProfileDashboard

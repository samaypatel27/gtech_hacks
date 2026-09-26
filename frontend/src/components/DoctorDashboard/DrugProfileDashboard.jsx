import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../Button/Button.jsx'
import DrugVial from './DrugVial.jsx'
import '../../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL

const STATUS_COLORS = {
  permanent: { css: '#34D399', hex: 0x34d399 },
  generic: { css: '#FBBF24', hex: 0xfbbf24 },
}

// Shared outer measurements so the loading, not-found, and real states all
// line up: centered, max 1280px, with responsive edge padding so nothing
// ever touches the screen edge (20px mobile / 32px default / 48px wide).
const PAGE_CONTAINER = 'mx-auto w-full max-w-[1280px] px-5 sm:px-8 xl:px-12'

function usesReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function isEmptyValue(value) {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

// Never render the raw word "null" -- a muted em dash instead.
function DashValue() {
  return (
    <span className="text-white/30" title="Not yet available">
      &mdash;
    </span>
  )
}

function FieldValue({ value }) {
  if (isEmptyValue(value)) return <DashValue />
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  if (Array.isArray(value)) {
    const links = value.filter((item) => item && typeof item === 'object' && item.url)
    if (links.length) {
      return (
        <span className="flex flex-wrap gap-3">
          {links.map((item, i) => (
            <a
              key={item.url + i}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline decoration-indigo-300/40 underline-offset-2 hover:text-indigo-200"
            >
              {item.title || item.description || `Source ${i + 1}`}
            </a>
          ))}
        </span>
      )
    }
    return (
      <span>
        {value.length} item{value.length === 1 ? '' : 's'}
      </span>
    )
  }
  if (typeof value === 'object') {
    return (
      <span>
        {Object.keys(value).length} field{Object.keys(value).length === 1 ? '' : 's'}
      </span>
    )
  }
  return <span className="break-words">{String(value)}</span>
}

// A plain two-column table: label column fixed width, value column takes
// the rest and wraps instead of overflowing. Stacks to one column on
// narrow screens. If every field in the group is empty, the whole table
// collapses to a single muted line instead of a wall of em dashes.
function FieldGroup({ fields }) {
  const allEmpty = fields.every((f) => isEmptyValue(f.value))
  if (allEmpty) {
    return <p className="text-[15px] text-white/40">Not yet available</p>
  }

  return (
    <div className="flex flex-col divide-y divide-white/[0.06]">
      {fields.map((f) => (
        <div
          key={f.label}
          className="grid grid-cols-1 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(180px,32%)_1fr] sm:gap-6"
        >
          <span className="text-[14px] leading-[1.5] text-white/55">{f.label}</span>
          <span
            className={`min-w-0 text-[16px] leading-[1.5] break-words text-white/90 ${f.mono ? 'font-mono' : ''}`}
          >
            <FieldValue value={f.value} />
          </span>
        </div>
      ))}
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/doctor/drugs"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
    >
      &larr; Back to all drugs
    </Link>
  )
}

function HeroPanel({ drug, image, entranceOn }) {
  const isPermanent = Boolean(drug.has_permanent_code)
  const status = isPermanent ? STATUS_COLORS.permanent : STATUS_COLORS.generic
  const summary = `${drug.brand_name || 'Unknown drug'}, ${drug.generic_name || 'generic name not yet available'}, ${
    drug.application_id
  }, ${isPermanent ? 'permanent billing code' : 'awaiting permanent billing code'}`

  return (
    <section
      aria-label={summary}
      className={`sticky top-4 flex h-[min(70vh,560px)] min-h-0 min-w-0 max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm min-[900px]:h-full min-[900px]:max-h-none ${
        entranceOn ? 'animate-[slide-in-left_320ms_ease-out_forwards]' : ''
      }`}
      style={{ opacity: entranceOn ? 0 : 1 }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(circle at 50% 40%, ${status.css}33, transparent 65%)` }}
        aria-hidden="true"
      />

      <div className="relative min-h-0 flex-1">
        <DrugVial statusColor={status.css} statusColorHex={status.hex} />
      </div>

      <div className="relative flex shrink-0 flex-col items-center gap-2 text-center">
        <h1 className="text-[clamp(22px,3vw,40px)] leading-tight font-semibold text-white">
          {isEmptyValue(drug.brand_name) ? <DashValue /> : drug.brand_name}
        </h1>
        <p className="text-sm text-white/50">
          {isEmptyValue(drug.generic_name) ? <DashValue /> : drug.generic_name}
        </p>
        <p className="font-mono text-xs text-white/40">{drug.application_id}</p>
        {image && (
          <img
            src={image}
            alt=""
            title="Packaging image"
            className="mt-1 h-5 w-5 rounded object-cover opacity-80"
          />
        )}
      </div>
    </section>
  )
}

// Full-width underline directly under the heading text, spanning the
// column edge to edge -- not a short underline hugging the text.
function SectionHeading({ children }) {
  return (
    <h2 className="block border-b border-white/15 pb-3 text-[18px] font-semibold tracking-[0.04em] text-white uppercase">
      {children}
    </h2>
  )
}

// One section of the continuous document: a heading with its one rule,
// an optional plain-text headline sentence, and a field table. Sections
// are spaced apart (not boxed or separately bordered) -- see
// `space-y-10` on the container that renders these.
function DocumentSection({ title, headline, fields, delayMs, entranceOn }) {
  return (
    <section
      className={entranceOn ? 'animate-[fade-in-up_280ms_ease-out_forwards]' : ''}
      style={{ opacity: entranceOn ? 0 : 1, animationDelay: entranceOn ? `${delayMs}ms` : undefined }}
    >
      <SectionHeading>{title}</SectionHeading>
      <div className="mt-4">
        {headline && <p className="mb-3 text-[17px] leading-[1.5] font-medium text-white/90">{headline}</p>}
        <FieldGroup fields={fields} />
      </div>
    </section>
  )
}

// Same two actions as the orphaned ConsideringDashboard.tsx mock -- the
// only ones of the four spec'd actions that already exist anywhere in the
// app. Uses the shared Button component, like every other button in the app.
function ActionsSection({ delayMs, entranceOn }) {
  return (
    <section
      className={entranceOn ? 'animate-[fade-in-up_280ms_ease-out_forwards]' : ''}
      style={{ opacity: entranceOn ? 0 : 1, animationDelay: entranceOn ? `${delayMs}ms` : undefined }}
    >
      <SectionHeading>Actions</SectionHeading>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button className="flex-1">Get my team ready</Button>
        <Button className="flex-1">Add patients to hold list</Button>
      </div>
    </section>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-6 min-[900px]:grid-cols-[38%_62%]">
      <div className="min-h-[280px] animate-pulse rounded-3xl border border-white/10 bg-white/5" />
      <div className="flex min-h-0 min-w-0 flex-col gap-4 divide-y divide-white/10">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 py-4 first:pt-0">
            <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-full max-w-sm animate-pulse rounded bg-white/5" />
            <div className="h-3 w-2/3 max-w-xs animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Fetches the full drug profile for `applicationId` and renders it as a
// single-screen hero (3D vial) + scrolling document layout. Owns its own
// data-fetching (like DrugSearchGrid) rather than receiving `drug` as a
// prop, so the page component just wires the route param through.
function DrugProfileDashboard({ applicationId }) {
  const [drug, setDrug] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [image, setImage] = useState(null)
  const reducedMotion = useMemo(() => usesReducedMotion(), [])

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
      <div className={`flex h-dvh w-full flex-col overflow-hidden py-6 text-[#f0f0f5] ${PAGE_CONTAINER}`}>
        <BackLink />
        <div className="mt-4 min-h-0 flex-1">
          <DashboardSkeleton />
        </div>
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

  const isPermanent = Boolean(drug.has_permanent_code)
  const entranceOn = !reducedMotion

  return (
    <div
      className={`flex min-h-screen w-full flex-col overflow-visible py-4 text-[#f0f0f5] min-[900px]:h-dvh min-[900px]:overflow-hidden min-[900px]:py-6 ${PAGE_CONTAINER}`}
    >
      <BackLink />

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-6 min-[900px]:grid-cols-[38%_62%]">
        <HeroPanel drug={drug} image={image} entranceOn={entranceOn} />

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2 sm:pr-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-16px),transparent)]">
          <div className="flex flex-col space-y-10">
            <DocumentSection
              title="Billing Path"
              headline={
                isPermanent
                  ? `Permanent code ${drug.permanent_hcpcs_code || '—'}`
                  : `Generic code ${drug.generic_billing_code || '—'}`
              }
              fields={[
                { label: 'Has Permanent Code', value: drug.has_permanent_code },
                { label: 'Generic Billing Code', value: drug.generic_billing_code, mono: true },
                { label: 'Permanent HCPCS Code', value: drug.permanent_hcpcs_code, mono: true },
              ]}
              delayMs={0}
              entranceOn={entranceOn}
            />
            <DocumentSection
              title="Payment Timing"
              headline={
                isEmptyValue(drug.cost_per_dose)
                  ? 'Cost per dose not yet available'
                  : `$${drug.cost_per_dose} per dose`
              }
              fields={[{ label: 'Cost Per Dose', value: drug.cost_per_dose }]}
              delayMs={60}
              entranceOn={entranceOn}
            />
            <DocumentSection
              title="Workflow Feasibility"
              headline={
                [
                  drug.route_of_administration,
                  drug.infusion_time_minutes ? `${drug.infusion_time_minutes} min infusion` : null,
                ]
                  .filter((part) => !isEmptyValue(part))
                  .join(', ') || 'Workflow details not yet available'
              }
              fields={[
                { label: 'Storage Requirements', value: drug.storage_requirements },
                { label: 'Route of Administration', value: drug.route_of_administration },
                { label: 'Infusion Time (minutes)', value: drug.infusion_time_minutes },
              ]}
              delayMs={120}
              entranceOn={entranceOn}
            />
            <DocumentSection
              title="Clinical Specifications"
              fields={[
                { label: 'Dosing Formula', value: drug.dosing_formula },
                { label: 'Preparation Instructions', value: drug.preparation_instructions },
                { label: 'Is Single Dose Vial', value: drug.is_single_dose_vial },
              ]}
              delayMs={180}
              entranceOn={entranceOn}
            />
            <DocumentSection
              title="Data References"
              fields={[
                { label: 'Approved Uses & Conditions', value: drug.approved_uses_and_conditions },
                { label: 'NDCs', value: drug.ndcs },
                { label: 'Citations', value: drug.citations },
              ]}
              delayMs={240}
              entranceOn={entranceOn}
            />

            <ActionsSection delayMs={300} entranceOn={entranceOn} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default DrugProfileDashboard

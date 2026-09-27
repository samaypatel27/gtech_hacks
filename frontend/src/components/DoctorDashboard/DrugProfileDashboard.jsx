import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../AppShell/AppShell.jsx'
import PageHeader from '../PageHeader/PageHeader.jsx'
import Panel from '../Panel/Panel.jsx'
import Button from '../Button/Button.jsx'
import Badge from '../Badge/Badge.jsx'
import Alert from '../Alert/Alert.jsx'
import Spinner from '../Spinner/Spinner.jsx'
import EmptyState from '../EmptyState/EmptyState.jsx'
import DetailList from '../DetailList/DetailList.jsx'
import Table from '../Table/Table.jsx'
import LoadingOverlay from '../LoadingOverlay/LoadingOverlay.jsx'
import { useAuthSession } from '../../lib/useAuthSession.js'
import { fetchHoldList, holdPatient, savePlan, unholdPatient } from '../../api/consider.js'
import { fetchPatients } from '../../api/patients.js'
import { codeTimeline, daysLabel, formatDate, formatMoney } from '../../lib/format.js'
import styles from './DrugProfileDashboard.module.css'

const API_URL = import.meta.env.VITE_API_URL

// "Get my team ready" transition timings: the page fades out over EXIT_MS,
// then the loading overlay holds for at least WORKSPACE_LOADING_MS however
// fast the real request settles, then fades out before the workspace route.
const EXIT_MS = 200
const WORKSPACE_LOADING_MS = 3000

const LIGHT_TONES = { green: 'success', yellow: 'warning', red: 'danger', gray: 'neutral' }
const LIGHT_LABELS = { green: 'Ready', yellow: 'Needs attention', red: 'Blocked', gray: 'Unknown' }

const LIGHTS = [
  { key: 'coverage', title: 'Coverage' },
  { key: 'billing_path', title: 'Billing path' },
  { key: 'payment_timing', title: 'Payment timing' },
  { key: 'workflow', title: 'Workflow' },
]

function usesReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function yesNo(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return null
}

function humanize(field) {
  return (field || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function ReadinessPanel({ lights }) {
  return (
    <Panel title="Can my practice use this?" description="Checked against your practice's payers and capabilities.">
      {!lights ? (
        <p className={styles.muted}>Sign in with a practice account to see your practice's readiness.</p>
      ) : (
        <ul className={styles.lights}>
          {LIGHTS.map(({ key, title }) => {
            const light = lights[key]
            if (!light) return null
            return (
              <li key={key} className={styles.light}>
                <div className={styles.lightHead}>
                  <span className={styles.lightTitle}>{title}</span>
                  <Badge tone={LIGHT_TONES[light.color] ?? 'neutral'} dot>
                    {LIGHT_LABELS[light.color] ?? 'Unknown'}
                  </Badge>
                </div>
                <p className={styles.lightText}>{light.text}</p>
                {light.sources?.length > 0 && (
                  <p className={styles.lightSources}>Source: {light.sources.join(' · ')}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// The doctor's own decisions, before the team gets involved: how many
// patients they expect to treat (feeds the payment-timing estimate) and the
// hold list (patients to start later, reviewed when the billing code changes).
function PlanPanel({ practiceDrug, brand, onChange, holdSelectRef }) {
  const [planned, setPlanned] = useState(practiceDrug.planned_patients_per_month ?? '')
  const [savingPlan, setSavingPlan] = useState(false)
  const [holdList, setHoldList] = useState([])
  const [patients, setPatients] = useState([])
  const [patientId, setPatientId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const practiceDrugId = practiceDrug.id

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchHoldList(practiceDrugId), fetchPatients()])
      .then(([hold, list]) => {
        if (cancelled) return
        setHoldList(hold.hold_list)
        setPatients(list)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [practiceDrugId])

  const savedPlanned = practiceDrug.planned_patients_per_month ?? ''
  const planChanged = String(planned) !== String(savedPlanned)

  async function handleSavePlan(e) {
    e.preventDefault()
    if (!planChanged) return
    setSavingPlan(true)
    setError('')
    try {
      onChange(await savePlan(practiceDrugId, planned === '' ? null : Number(planned)))
    } catch (err) {
      setError(err.message)
    }
    setSavingPlan(false)
  }

  async function updateHoldList(call) {
    setBusy(true)
    setError('')
    try {
      const result = await call()
      setHoldList(result.hold_list)
      onChange((current) => ({ ...current, status: result.status }))
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleHold(e) {
    e.preventDefault()
    if (!patientId) return
    if (await updateHoldList(() => holdPatient(practiceDrugId, Number(patientId), note.trim()))) {
      setPatientId('')
      setNote('')
    }
  }

  const held = new Set(holdList.map((h) => h.patient_id))
  const choices = patients.filter((p) => !held.has(p.id))

  return (
    <Panel title="Your plan" description="Just for you for now. Your team isn't involved until you click “Get my team ready.”">
      <form className={styles.planRow} onSubmit={handleSavePlan}>
        <label className={styles.planField}>
          <span className={styles.planLabel}>Patients a month you expect to treat</span>
          <input
            type="number"
            min="0"
            max="1000"
            step="1"
            inputMode="numeric"
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            className={styles.planInput}
          />
        </label>
        <Button type="submit" size="sm" disabled={!planChanged || savingPlan}>
          {savingPlan ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <p className={styles.planHint}>Used for the payment-timing estimate above.</p>

      <h3 className={styles.holdTitle}>Hold list</h3>
      <p className={styles.planHint}>
        Patients you want to start later, for example once {brand} has its own billing code. When the code changes,
        you'll get a reminder to review them.
      </p>

      {holdList.length > 0 && (
        <ul className={styles.holdList}>
          {holdList.map((h) => (
            <li key={h.patient_id} className={styles.holdItem}>
              <div className={styles.holdText}>
                <Link to={`/doctor/patients/${h.patient_id}`} className={styles.holdName}>
                  {h.name}
                </Link>
                <span className={styles.holdMeta}>
                  {[h.payer, `added ${formatDate(h.added_at)}`].filter(Boolean).join(' · ')}
                </span>
                {h.note && <span className={styles.holdNote}>{h.note}</span>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => updateHoldList(() => unholdPatient(practiceDrugId, h.patient_id))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.holdForm} onSubmit={handleHold}>
        <select
          ref={holdSelectRef}
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          aria-label="Patient to add to the hold list"
          disabled={busy || choices.length === 0}
        >
          <option value="">{choices.length ? 'Choose a patient…' : 'No other patients to add'}</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.payer ? ` (${p.payer})` : ''}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Note (optional), e.g. start after the J-code"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={!patientId || busy}>
          Add to hold list
        </Button>
      </form>

      {error && (
        <Alert tone="danger" className={styles.planError}>
          {error}
        </Alert>
      )}
    </Panel>
  )
}

function BillingCodePanel({ drug }) {
  const { current, upcoming } = codeTimeline(drug)
  const codes = [...(Array.isArray(drug.codes) ? drug.codes : [])].sort((a, b) =>
    String(a.from).localeCompare(String(b.from)),
  )

  return (
    <Panel title="Billing code">
      <div className={styles.codeNow}>
        {current.code ? (
          <Badge tone={current.type === 'generic' ? 'warning' : 'success'} mono className={styles.codeBadge}>
            {current.code}
          </Badge>
        ) : (
          <span className={styles.muted}>Not yet available</span>
        )}
        <span className={styles.muted}>
          {{ permanent: 'Permanent HCPCS code', temporary: 'Temporary product-specific code' }[current.type] ??
            'Generic, not otherwise classified'}
        </span>
      </div>

      {upcoming && (
        <Alert tone="info" className={styles.upcoming} title={`Switches to ${upcoming.code} ${daysLabel(upcoming.daysUntil)}`}>
          Claims with a date of service on or after {formatDate(upcoming.from)} bill under{' '}
          <span className="mono">{upcoming.code}</span>.
        </Alert>
      )}

      {codes.length > 0 && (
        <ol className={styles.timeline}>
          {codes.map((c) => (
            <li key={`${c.code}-${c.from}-${c.payer ?? 'all'}`} className={styles.timelineItem}>
              <span className="mono">{c.code}</span>
              <span className={styles.timelineMeta}>
                {{ permanent: 'Permanent', temporary: 'Temporary' }[c.type] ?? 'Generic'}
                {c.payer ? ` · ${c.payer}` : ''} · {formatDate(c.from)}
                {c.to ? ` – ${formatDate(c.to)}` : ' onward'}
              </span>
            </li>
          ))}
        </ol>
      )}

      <DetailList
        items={[
          { label: 'Cost per dose', value: drug.cost_per_dose != null ? formatMoney(drug.cost_per_dose) : null },
          { label: 'Permanent code', value: drug.permanent_hcpcs_code, mono: true },
          { label: 'Generic code', value: drug.generic_billing_code, mono: true },
        ]}
      />
    </Panel>
  )
}

function ClinicalPanel({ drug }) {
  const dose = drug.typical_adult_dose
  return (
    <Panel title="Clinical details">
      <DetailList
        items={[
          { label: 'Dosing', value: drug.dosing_formula },
          { label: 'Typical adult dose', value: dose?.amount != null ? `${dose.amount} ${dose.unit ?? ''}`.trim() : null },
          {
            label: 'Infusion time',
            value: drug.infusion_time_minutes != null ? `${drug.infusion_time_minutes} min` : null,
          },
          { label: 'Route', value: drug.route_of_administration },
          { label: 'Storage', value: drug.storage_requirements },
          { label: 'Preparation', value: drug.preparation_instructions },
          { label: 'Single-dose vial', value: yesNo(drug.is_single_dose_vial) },
          { label: 'Antineoplastic', value: yesNo(drug.is_antineoplastic) },
        ]}
      />
    </Panel>
  )
}

function ApprovedUsesPanel({ uses }) {
  return (
    <Panel title="Approved uses">
      {!uses?.length ? (
        <p className={styles.muted}>Not yet available.</p>
      ) : (
        <ul className={styles.uses}>
          {uses.map((use, i) => (
            <li key={i} className={styles.use}>
              <p className={styles.useTitle}>{typeof use === 'string' ? use : use.approved_diagnosis}</p>
              {use.prior_therapy && <p className={styles.useMeta}>Prior therapy: {use.prior_therapy}</p>}
              {use.required_test_method && <p className={styles.useMeta}>Required test: {use.required_test_method}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function PackagesPanel({ ndcs }) {
  if (!ndcs?.length) return null
  return (
    <Panel title="Packages" flush>
      <Table>
        <thead>
          <tr>
            <th>NDC (11-digit)</th>
            <th>NDC (10-digit)</th>
            <th>Description</th>
            <th data-align="end">Strength</th>
          </tr>
        </thead>
        <tbody>
          {ndcs.map((ndc, i) => (
            <tr key={ndc.ndc_11 ?? ndc.ndc_10 ?? i}>
              <td data-mono>{ndc.ndc_11 ?? '—'}</td>
              <td data-mono>{ndc.ndc_10 ?? '—'}</td>
              <td className={styles.muted}>{ndc.description || '—'}</td>
              <td data-align="end" data-mono>
                {ndc.strength_mg != null ? `${ndc.strength_mg} mg` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  )
}

function SourcesPanel({ citations }) {
  if (!citations?.length) return null
  return (
    <Panel title="Sources">
      <ul className={styles.sources}>
        {citations.map((c, i) => (
          <li key={i}>
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer">
                {c.title || c.description || c.url}
              </a>
            ) : (
              <>
                {c.field && <span className={styles.sourceField}>{humanize(c.field)}</span>}
                <span>{c.citation ?? String(c)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// Fetches the full drug profile for `applicationId` (plus the practice's
// readiness "lights") and renders it inside the doctor's app shell. Owns its
// own data-fetching so the page component just wires the route param through.
function DrugProfileDashboard({ applicationId }) {
  const [drug, setDrug] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // The practice_drugs row: lights, planned patients, status.
  const [practiceDrug, setPracticeDrug] = useState(null)
  const holdSelectRef = useRef(null)
  const reducedMotion = useMemo(() => usesReducedMotion(), [])
  const { email } = useAuthSession()
  const navigate = useNavigate()

  // "Get my team ready" transition: 'idle' -> 'exiting' (page fading out) ->
  // 'loading' (overlay, request running) -> 'overlay-exiting' -> navigate.
  const [phase, setPhase] = useState('idle')
  const [teamError, setTeamError] = useState(null)
  const loadingStartRef = useRef(0)

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

  // The personalized "can my practice use this?" answer, computed per
  // practice, so it waits for the signed-in email.
  useEffect(() => {
    if (!email) return
    let cancelled = false

    fetch(`${API_URL}/api/practice-drugs/considering`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, application_id: applicationId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setPracticeDrug(data)
      })
      .catch(() => {
        // No practice record yet, or the request failed -- the panel shows
        // its signed-out message rather than a broken state.
      })

    return () => {
      cancelled = true
    }
  }, [applicationId, email])

  function handleShowHoldList() {
    const select = holdSelectRef.current
    if (!select) return
    select.scrollIntoView({ behavior: usesReducedMotion() ? 'auto' : 'smooth', block: 'center' })
    select.focus({ preventScroll: true })
  }

  function handleGetTeamReady() {
    if (phase !== 'idle' || !email || !drug) return
    setTeamError(null)
    setPhase('exiting')
    setTimeout(
      () => {
        setPhase('loading')
        loadingStartRef.current = Date.now()
        runTeamReady()
      },
      reducedMotion ? 0 : EXIT_MS,
    )
  }

  async function runTeamReady() {
    try {
      // Step 1: get or create the practice_drugs row and read its id.
      const consideringRes = await fetch(`${API_URL}/api/practice-drugs/considering`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, application_id: drug.application_id }),
      })
      if (!consideringRes.ok) throw new Error('Could not find your practice record.')
      const pd = await consideringRes.json()

      // Step 2: create the four tasks and advance status to adopting.
      const teamRes = await fetch(`${API_URL}/api/practice-drugs/${pd.id}/team-ready`, { method: 'POST' })
      if (!teamRes.ok) throw new Error('Could not create the team workspace.')

      const remaining = Math.max(0, WORKSPACE_LOADING_MS - (Date.now() - loadingStartRef.current))
      setTimeout(() => {
        setPhase('overlay-exiting')
        setTimeout(() => navigate(`/doctor/workspace/${pd.id}`), reducedMotion ? 0 : EXIT_MS)
      }, remaining)
    } catch (err) {
      setTeamError(`${err.message} Please try again.`)
      setPhase('idle')
    }
  }

  const breadcrumbs = [{ label: 'Drugs', to: '/doctor/drugs' }, { label: drug?.brand_name ?? applicationId }]

  if (phase === 'loading' || phase === 'overlay-exiting') {
    return <LoadingOverlay message="Creating workspace…" exiting={phase === 'overlay-exiting'} />
  }

  if (isLoading) {
    return (
      <AppShell role="doctor" breadcrumbs={breadcrumbs}>
        <Spinner label="Loading drug…" />
      </AppShell>
    )
  }

  if (notFound || !drug) {
    return (
      <AppShell role="doctor" breadcrumbs={breadcrumbs}>
        <Panel>
          <EmptyState
            title="Drug not found"
            description={`No drug matches application ${applicationId}.`}
            action={<Button to="/doctor/drugs">Back to drugs</Button>}
          />
        </Panel>
      </AppShell>
    )
  }

  const meta = [drug.generic_name, drug.route_of_administration].filter(Boolean)

  return (
    <AppShell role="doctor" breadcrumbs={breadcrumbs}>
      <div className={phase === 'exiting' ? styles.exiting : undefined}>
        <PageHeader
          title={drug.brand_name || 'Unknown drug'}
          meta={
            <>
              <span className="mono">{drug.application_id}</span>
              {meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </>
          }
          actions={
            <>
              <Button
                variant="secondary"
                onClick={handleShowHoldList}
                disabled={!practiceDrug}
                title={practiceDrug ? undefined : 'Sign in to keep a hold list'}
              >
                Add patients to hold list
              </Button>
              <Button
                variant="primary"
                onClick={handleGetTeamReady}
                disabled={phase !== 'idle' || !email}
                title={email ? undefined : 'Sign in to create a team workspace'}
              >
                Get my team ready
              </Button>
            </>
          }
        />

        {teamError && (
          <Alert tone="danger" className={styles.teamError}>
            {teamError}
          </Alert>
        )}

        <div className={styles.grid}>
          <div className={styles.mainCol}>
            <ReadinessPanel lights={practiceDrug?.lights} />
            {practiceDrug && (
              <PlanPanel
                practiceDrug={practiceDrug}
                brand={drug.brand_name || 'this drug'}
                onChange={setPracticeDrug}
                holdSelectRef={holdSelectRef}
              />
            )}
            <ClinicalPanel drug={drug} />
            <ApprovedUsesPanel uses={drug.approved_uses_and_conditions} />
            <PackagesPanel ndcs={drug.ndcs} />
            <SourcesPanel citations={drug.citations} />
          </div>
          <div className={styles.sideCol}>
            <BillingCodePanel drug={drug} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export default DrugProfileDashboard

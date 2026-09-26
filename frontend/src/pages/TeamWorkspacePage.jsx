import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom'
import Button from '../components/Button/Button.jsx'
import '../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL
const POLL_MS = 3000

// ─── Constants ───────────────────────────────────────────────────────────────

// Valid :role segments on /staff/:role/workspace/:practiceDrugId.
const ROLE_LABEL = {
  front_desk: 'Front Desk',
  nurse: 'Nurse',
  biller: 'Biller',
}

// Everyone who appears on the board. The doctor route has no :role, so the
// viewer is 'doctor' there; kept out of ROLE_LABEL so /staff/doctor/... isn't valid.
const BOARD_ROLE_LABEL = { doctor: 'Doctor', ...ROLE_LABEL }

// ─── Small helpers ────────────────────────────────────────────────────────────

/** Format a date string as "Mon DD YYYY" for the code window. */
function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Status pill — plain bracketed text, no colour. */
function StatusPill({ status }) {
  const label =
    status === 'active'
      ? 'Active'
      : status === 'adopting'
        ? 'Adopting'
        : status === 'considering'
          ? 'Considering'
          : status ?? '—'
  return (
    <span className="ml-3 inline-block rounded border border-white/25 px-2.5 py-0.5 text-[13px] font-medium tracking-wide text-white/60 uppercase">
      {label}
    </span>
  )
}

// ─── Readiness strip ──────────────────────────────────────────────────────────

function ReadinessBar({ label, filled }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[12px] text-white/40">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-white/10">
        <div
          className="h-1.5 rounded-full bg-white/70 transition-all duration-500"
          style={{ width: filled ? '100%' : '0%' }}
        />
      </div>
    </div>
  )
}

function ReadinessStrip({ tasks, stock }) {
  const byKind = Object.fromEntries(tasks.map((t) => [t.kind, t]))
  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length || 4

  const stockQty = (stock || []).reduce(
    (sum, s) => sum + (typeof s === 'object' ? s.quantity ?? 0 : 0),
    0,
  )
  const stockFilled = byKind.receiving?.status === 'done' && stockQty > 0
  const nurseFilled = byKind.nurse_setup?.status === 'done'
  const billerFilled = byKind.billing_setup?.status === 'done'

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
      <p className="mb-4 text-[13px] font-medium text-white/70">
        <span className="text-[22px] font-semibold text-white">{done}</span>
        <span className="ml-1.5 text-white/40">of {total} tasks complete</span>
      </p>
      <div className="flex flex-col gap-2.5">
        <ReadinessBar label="Stock" filled={stockFilled} />
        <ReadinessBar label="Nurse" filled={nurseFilled} />
        <ReadinessBar label="Billing" filled={billerFilled} />
      </div>
    </div>
  )
}

// ─── Generic-code window ──────────────────────────────────────────────────────

function CodeWindow({ codes, approvalDate }) {
  const generic = codes?.find((c) => c.type === 'generic')
  const permanent = codes?.find((c) => c.type === 'permanent')

  if (!generic && !permanent) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <p className="mb-2 text-[11px] font-semibold tracking-widest text-white/40 uppercase">
          Billing code window
        </p>
        <p className="text-[13px] text-white/40">Billing code details not yet available.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
      <p className="mb-3 text-[11px] font-semibold tracking-widest text-white/40 uppercase">
        Billing code window
      </p>
      <div className="space-y-2">
        {generic && (
          <div className="flex items-baseline gap-2">
            <span className="w-20 shrink-0 text-[11px] text-white/35">Now</span>
            <span className="font-mono text-[14px] font-medium text-white/80">{generic.code}</span>
            <span className="text-[12px] text-white/35">generic</span>
          </div>
        )}
        {permanent && (
          <div className="flex items-baseline gap-2">
            <span className="w-20 shrink-0 text-[11px] text-white/35">
              {fmtDate(permanent.from) ?? 'Expected'}
            </span>
            <span className="font-mono text-[14px] font-medium text-white/80">
              {permanent.code}
            </span>
            <span className="text-[12px] text-white/35">permanent — we will switch for you</span>
          </div>
        )}
        {approvalDate && (
          <p className="pt-1 text-[11px] text-white/25">
            FDA approval: {fmtDate(approvalDate)}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Doctor strip (read-only placeholder — interactive in Layer 2) ────────────

function DoctorStrip({ practiceDrug }) {
  const patients = practiceDrug?.planned_patients_per_month
  const holdCount = practiceDrug?.hold_list_count ?? 0

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4">
      <span className="text-[11px] font-semibold tracking-widest text-white/40 uppercase">
        Doctor
      </span>
      <span className="text-[14px] text-white/70">
        Planned patients / month:{' '}
        <span className="font-semibold text-white">{patients ?? '—'}</span>
      </span>
      <span className="text-[14px] text-white/70">
        Hold list:{' '}
        <span className="font-semibold text-white">
          {holdCount} {holdCount === 1 ? 'patient' : 'patients'} waiting
        </span>
      </span>
    </div>
  )
}

// ─── Task board ───────────────────────────────────────────────────────────────

/** One board column: header + an empty card lane. Cards aren't built yet. */
function BoardColumn({ title, subtitle }) {
  return (
    <div className="flex min-h-[420px] flex-col rounded-xl border border-white/10 bg-white/[0.025] px-5 py-5">
      <p className="text-[11px] font-semibold tracking-widest text-white/40 uppercase">{title}</p>
      <p className="mt-1 text-[12px] text-white/30">{subtitle}</p>
      <div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/10">
        <p className="text-[13px] text-white/25">No cards yet</p>
      </div>
    </div>
  )
}

/**
 * Jira-style board from `viewer`'s point of view: their own tasks in To do,
 * everyone else's open tasks in Awaiting, and all finished tasks in Complete.
 * Shell only -- the columns don't render task cards yet.
 */
function TaskBoard({ viewer }) {
  const others = Object.keys(BOARD_ROLE_LABEL)
    .filter((r) => r !== viewer)
    .map((r) => BOARD_ROLE_LABEL[r])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <BoardColumn title="To do" subtitle={`Assigned to ${BOARD_ROLE_LABEL[viewer]}`} />
      <BoardColumn title="Awaiting" subtitle={`Assigned to ${others.join(', ')}`} />
      <BoardColumn title="Complete" subtitle="Finished by anyone on the team" />
    </div>
  )
}

// ─── Ready banner ─────────────────────────────────────────────────────────────

function ReadyBanner({ drugName, holdCount, navigate, backTo, backLabel }) {
  return (
    <div className="mt-10 rounded-lg border border-white/20 bg-white/[0.04] px-7 py-6">
      <p className="text-[18px] font-semibold text-white">
        {drugName} is ready at your practice.
      </p>
      {holdCount > 0 && (
        <p className="mt-1 text-[14px] text-white/55">
          {holdCount} {holdCount === 1 ? 'patient is' : 'patients are'} waiting on the hold list.
        </p>
      )}
      <div className="mt-4">
        <Button onClick={() => navigate(backTo)} className="text-[13px]">
          {backLabel}
        </Button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

// Serves two routes over the same workspace data (same practice_drugs row,
// same tasks): /doctor/workspace/:practiceDrugId for the practice's own doctor,
// and /staff/:role/workspace/:practiceDrugId for nurse/biller/front desk, who
// each get their own URL. `role` is undefined on the doctor route. It decides
// where "back" goes and whose tasks land in the board's To do column.
function TeamWorkspacePage() {
  const { practiceDrugId, role } = useParams()
  const navigate = useNavigate()

  const [data, setData] = useState(null) // full GET response
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const lastJsonRef = useRef(null)

  function applyData(raw) {
    const json = JSON.stringify(raw)
    if (json === lastJsonRef.current) return // no flicker if unchanged
    lastJsonRef.current = json
    setData(raw)
  }

  useEffect(() => {
    let cancelled = false

    function fetchWorkspace() {
      fetch(`${API_URL}/api/practice-drugs/${encodeURIComponent(practiceDrugId)}/tasks`)
        .then((res) => {
          if (!res.ok) throw new Error(`Server error ${res.status}`)
          return res.json()
        })
        .then((raw) => {
          if (cancelled) return
          applyData(raw)
          setIsLoading(false)
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err.message)
            setIsLoading(false)
          }
        })
    }

    fetchWorkspace()
    const interval = setInterval(fetchWorkspace, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [practiceDrugId])

  const PAGE = 'mx-auto w-full max-w-[1320px] px-5 sm:px-8 xl:px-14'

  // An unrecognized :role -- same treatment as StaffWorkspacesPage: send them
  // home rather than render a page whose back link points nowhere.
  if (role && !ROLE_LABEL[role]) return <Navigate to="/" replace />

  // Staff came from their own role listing; the doctor came from the drug grid.
  const backTo = role ? `/staff/${role}` : '/doctor/drugs'
  const backLabel = role ? `Back to ${ROLE_LABEL[role]} workspaces` : 'Back to all drugs'

  if (isLoading) {
    return (
      <div className={`flex min-h-screen w-full flex-col py-8 text-[#f0f0f5] ${PAGE}`}>
        <Link
          to={backTo}
          className="text-sm font-medium text-white/50 transition-colors hover:text-white"
        >
          &larr; {backLabel}
        </Link>
        <p className="mt-10 text-[14px] text-white/35">Loading workspace&hellip;</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex min-h-screen w-full flex-col py-8 text-[#f0f0f5] ${PAGE}`}>
        <Link
          to={backTo}
          className="text-sm font-medium text-white/50 transition-colors hover:text-white"
        >
          &larr; {backLabel}
        </Link>
        <p className="mt-10 text-[14px] text-white/35">Could not load workspace: {error}</p>
      </div>
    )
  }

  const { drug, practice_drug: pd, tasks } = data
  const isActive = pd?.status === 'active'

  return (
    <div className={`flex min-h-screen w-full flex-col py-8 text-[#f0f0f5] ${PAGE}`}>
      {/* Back link */}
      <Link
        to={backTo}
        className="text-sm font-medium text-white/50 transition-colors hover:text-white"
      >
        &larr; {backLabel}
      </Link>

      {/* Header */}
      <div className="mt-6 flex flex-wrap items-baseline gap-2">
        <h1 className="text-[clamp(22px,2.8vw,34px)] font-semibold leading-tight text-white">
          {drug?.brand_name ?? 'Team workspace'}
        </h1>
        <StatusPill status={pd?.status} />
      </div>
      <p className="mt-1.5 text-[14px] text-white/40">
        Prepare-stage checklist — complete each section before treating patients.
      </p>

      {/* Info strip: readiness + code window */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReadinessStrip tasks={tasks ?? []} stock={pd?.stock_on_hand} />
        <CodeWindow codes={drug?.codes} approvalDate={drug?.approval_date} />
      </div>

      {/* Doctor strip */}
      <div className="mt-4">
        <DoctorStrip practiceDrug={pd} />
      </div>

      {/* Task board, from this viewer's point of view */}
      <div className="mt-8">
        <TaskBoard viewer={role ?? 'doctor'} />
      </div>

      {/* Ready banner — only when active */}
      {isActive && (
        <ReadyBanner
          drugName={drug?.brand_name ?? 'This drug'}
          holdCount={pd?.hold_list_count ?? 0}
          navigate={navigate}
          backTo={backTo}
          backLabel={backLabel}
        />
      )}
    </div>
  )
}

export default TeamWorkspacePage

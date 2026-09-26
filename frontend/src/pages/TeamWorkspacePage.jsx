import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom'
import Button from '../components/Button/Button.jsx'
import '../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL
const POLL_MS = 3000

// ─── Constants ───────────────────────────────────────────────────────────────

const KIND_ORDER = ['purchasing', 'receiving', 'nurse_setup', 'billing_setup']

const ROLE_LABEL = {
  front_desk: 'Front Desk',
  nurse: 'Nurse',
  biller: 'Biller',
}

// Roles displayed left to right.
const ROLE_COLUMNS = [
  { role: 'front_desk', kinds: ['purchasing', 'receiving'] },
  { role: 'nurse', kinds: ['nurse_setup'] },
  { role: 'biller', kinds: ['billing_setup'] },
]

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

/** Compact section label — uppercase, small, muted. */
function ColumnHeader({ children }) {
  return (
    <p className="mb-4 text-[11px] font-semibold tracking-widest text-white/40 uppercase">
      {children}
    </p>
  )
}

/** Divider line used inside card area. */
function Divider() {
  return <div className="my-4 border-t border-white/[0.07]" />
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

// ─── Task card ────────────────────────────────────────────────────────────────

/**
 * Badge for a card's state — plain text, no colour treatment.
 * locked | todo | in_progress | done
 */
function StateBadge({ state }) {
  const map = {
    locked: 'Locked',
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
  }
  return (
    <span
      className={`text-[11px] font-semibold tracking-wider uppercase ${
        state === 'done' ? 'text-white/30' : state === 'locked' ? 'text-white/25' : 'text-white/50'
      }`}
    >
      {map[state] ?? state}
    </span>
  )
}

function TaskCard({ task, locked, onMarkDone }) {
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)

  const state = locked ? 'locked' : task.status === 'done' ? 'done' : task.status === 'in_progress' ? 'in_progress' : 'todo'
  const collapsed = state === 'done'

  async function handleMarkDone() {
    if (saving || locked) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: task.status === 'done' ? 'todo' : 'done' }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const updated = await res.json()
      onMarkDone(updated)
    } catch {
      setSaveError('Save failed — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={`border-b border-white/[0.06] py-5 last:border-b-0 last:pb-0 first:pt-0 transition-opacity ${
        state === 'locked' ? 'opacity-40' : ''
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <p
          className={`text-[15px] font-semibold leading-snug ${
            state === 'done' ? 'text-white/35' : 'text-white/90'
          }`}
        >
          {task.title}
        </p>
        <StateBadge state={state} />
      </div>

      {/* Body — hidden when done */}
      {!collapsed && (
        <div className="mt-3">
          {locked ? (
            <p className="text-[13px] text-white/35">
              Waiting on: Purchasing
            </p>
          ) : (
            <>
              <p className="text-[13px] leading-[1.7] text-white/50">{task.instruction}</p>
              <Divider />
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleMarkDone}
                  disabled={saving}
                  className="text-[13px]"
                >
                  {saving ? 'Saving…' : task.status === 'done' ? 'Mark incomplete' : 'Mark complete'}
                </Button>
                {saveError && (
                  <span className="text-[12px] text-white/40">{saveError}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
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
// each get their own URL. `role` is undefined on the doctor route; so far it
// only decides where "back" goes -- role-specific card ordering comes later.
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

  // When a card's PATCH responds, merge the updated task into local state
  // so the UI updates immediately without waiting for the next poll.
  function handleTaskUpdate(updatedTask) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
      }
    })
  }

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
  const byKind = Object.fromEntries((tasks || []).map((t) => [t.kind, t]))
  const purchasingDone = byKind.purchasing?.status === 'done'
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

      {/* Three role columns */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {ROLE_COLUMNS.map(({ role, kinds }) => {
          const roleTasks = kinds
            .map((k) => byKind[k])
            .filter(Boolean)
            .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

          return (
            <div
              key={role}
              className="rounded-xl border border-white/10 bg-white/[0.025] px-5 py-5"
            >
              <ColumnHeader>{ROLE_LABEL[role] ?? role}</ColumnHeader>
              {roleTasks.length === 0 ? (
                <p className="text-[13px] text-white/30">No tasks.</p>
              ) : (
                roleTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    locked={task.kind === 'receiving' && !purchasingDone}
                    onMarkDone={handleTaskUpdate}
                  />
                ))
              )}
            </div>
          )
        })}
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Navigate, Link } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import Button from '../components/Button/Button.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import CodeChangeNotice from '../components/CodeChangeNotice/CodeChangeNotice.jsx'
import Badge from '../components/Badge/Badge.jsx'
import Alert from '../components/Alert/Alert.jsx'
import Spinner from '../components/Spinner/Spinner.jsx'
import Icon from '../components/Icon/Icon.jsx'
import { ROLES } from '../lib/roles.js'
import { fetchPatients } from '../api/patients.js'
import '../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL
const POLL_MS = 3000

// How far (px) a pressed card must travel before it counts as a drag, so a
// plain click (e.g. to focus it for arrow-key moves) doesn't pick it up.
const DRAG_THRESHOLD = 5

// ─── Constants ───────────────────────────────────────────────────────────────

// Valid :role segments on /staff/:role/workspace/:practiceDrugId.
const ROLE_LABEL = {
  front_desk: 'Front Desk',
  nurse: 'Nurse',
  biller: 'Biller',
}

// Doctor's overview board: one column per staff role, in this order.
const ROLE_COLUMNS = ['front_desk', 'nurse', 'biller']

// Setup tasks in DataContract.md order, then each patient's chain in the
// order it happens, then Switch cards. Anything unknown sorts last.
const KIND_ORDER = [
  'plan_patients',
  'purchasing',
  'receiving',
  'nurse_setup',
  'payer_review',
  'billing_setup',
  'order_sign',
  'prior_auth',
  'buy_for_patient',
  'prep_dose',
  'give_infusion',
  'claim_review',
  'recode_claims',
  'review_hold_list',
]

// Setup tasks (no treatment) first, then one group per patient treatment,
// each in KIND_ORDER.
function sortTasks(tasks) {
  const rank = (kind) => {
    const i = KIND_ORDER.indexOf(kind)
    return i === -1 ? KIND_ORDER.length : i
  }
  return [...tasks].sort(
    (a, b) => (a.treatment_id ?? 0) - (b.treatment_id ?? 0) || rank(a.kind) - rank(b.kind),
  )
}

// Per-patient cards finished on their own page, never by moving the card
// (mirrors PAGE_COMPLETED_KINDS in backend/core/task_rules.py, which refuses
// such moves). They get an "Open" link instead of a drag handle.
const PAGE_COMPLETED_KINDS = ['order_sign', 'prep_dose', 'give_infusion', 'claim_review']

// The page a per-patient card opens, or null.
function pageLinkFor(task, practiceDrugId) {
  switch (task.kind) {
    case 'order_sign':
      return task.patient_id ? `/doctor/patients/${task.patient_id}?pd=${practiceDrugId}` : null
    case 'prep_dose':
    case 'give_infusion':
      return task.treatment_id ? `/staff/nurse/treatments/${task.treatment_id}` : null
    case 'claim_review':
      return task.treatment_id ? `/staff/biller/claims/${task.treatment_id}` : null
    default:
      return null
  }
}

// The backend works out what each task is waiting for (tasks.waits_on) and
// returns it as readable labels in `waiting_on`; empty means workable now.
function isWaiting(task) {
  return task.status !== 'done' && (task.waiting_on?.length ?? 0) > 0
}

// A staff member's own board: 3 lifecycle columns a card moves through.
// 'done' is persisted as tasks.status = 'done' (the DB's tasks_status_check
// constraint only allows 'todo'/'done'); 'awaiting' is calculated from the
// backend's `waiting_on` (DataContract.md §7), so a card sits there exactly
// while something it depends on is unfinished and moves to To Do by itself
// once that's done.
// Green is reserved for the drop-target highlight -- columns have no color
// identity of their own otherwise.
//
// `droppable` is what staff are allowed to move a card INTO: To Do and
// Complete only. Awaiting is frozen in both directions -- nothing can be
// dropped into it, and a card already sitting there can't be dragged or
// keyboard-moved out either. Only To Do <-> Complete is ever staff-movable.
const BOARD_COLUMNS = [
  { key: 'todo', label: 'To Do', droppable: true },
  { key: 'awaiting', label: 'Awaiting', droppable: false },
  { key: 'done', label: 'Complete', droppable: true },
]

function columnOf(key) {
  return BOARD_COLUMNS.find((c) => c.key === key)
}

function boardStatusOf(task) {
  if (task.status === 'done') return 'done'
  if (isWaiting(task)) return 'awaiting'
  return 'todo'
}

// ─── Card parts ───────────────────────────────────────────────────────────────

const COLUMN_BADGE = {
  todo: { tone: 'neutral', label: 'To do' },
  awaiting: { tone: 'brand', label: 'Awaiting' },
  done: { tone: 'success', label: 'Done' },
}

// Doctor board filter: 'all' keeps the default order (not-completed above,
// completed at the bottom); the other two hide one group instead of reordering.
const TASK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Not completed' },
  { id: 'completed', label: 'Completed' },
]

const WORKSPACE_STATUS = {
  considering: { label: 'Considering', tone: 'neutral' },
  holding: { label: 'Holding', tone: 'neutral' },
  adopting: { label: 'Setting up', tone: 'brand' },
  active: { label: 'Ready to treat', tone: 'success' },
}

function ColumnHeading({ label, count, active = false, to }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-1">
      {to ? (
        <Link
          to={to}
          className="group inline-flex items-center gap-1 text-xs font-medium tracking-[0.04em] uppercase text-fg-muted transition-colors duration-150 hover:text-brand"
        >
          {label}
          <Icon name="arrowRight" size={12} className="text-fg-subtle transition-colors duration-150 group-hover:text-brand" />
        </Link>
      ) : (
        <p className={`text-xs font-medium tracking-[0.04em] uppercase ${active ? 'text-brand' : 'text-fg-muted'}`}>
          {label}
        </p>
      )}
      <span className="ml-auto rounded-sm border border-line bg-surface px-1.5 font-mono text-xs leading-5 text-fg-muted">
        {count}
      </span>
    </div>
  )
}

/**
 * What's printed inside every card on both boards -- the staff card in its
 * column, the copy that follows the pointer during a drag, and the doctor's
 * read-only card. `column` drives the struck-through "done" title, so a
 * dragged copy can preview the column it's hovering over. `accessory` is the
 * top-right slot: a drag grip or lock for staff, a completion seal for the
 * doctor.
 */
function CardFace({ task, column, locked, accessory, strikeDone = true }) {
  const done = column === 'done'

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-sm leading-5 font-medium ${
            done && strikeDone ? 'text-fg-subtle line-through decoration-line-strong' : 'text-fg'
          }`}
        >
          {task.title}
        </p>
        <div className="mt-0.5 shrink-0">{accessory}</div>
      </div>

      {/* Long instructions scroll inside the card instead of stretching it. */}
      <div
        data-card-scroll
        className="card-scroll mt-1.5 max-h-28 touch-pan-y overflow-auto pr-1 text-[13px] leading-5 text-fg-muted"
      >
        {locked ? `Waiting on ${task.waiting_on.join(', ')}.` : task.instruction}
      </div>
    </>
  )
}

const CARD_BASE = 'relative rounded-md border p-3 select-none outline-none'

const CARD_SKIN = 'border-line bg-surface'

/**
 * A staff card in its column. `state` is 'idle', 'ghost' (it's the card being
 * dragged, so its slot shows a dashed outline) or 'landing' (just dropped here).
 * `locked` means the card is waiting on another task (shows "Waiting on …"
 * from the backend); `frozen` is the broader "this card can't be moved right
 * now" state -- locked cards are always frozen. `pinned` cards (finished on
 * their own page, PAGE_COMPLETED_KINDS) can't be moved either, but aren't
 * dimmed: they're workable, just through their Open link. `extra` renders
 * below the card text (invoice form, Open link, prior-auth number).
 */
function BoardCard({ task, column, locked, frozen, pinned, state, onPressStart, onKeyMove, onLanded, extra }) {
  const label = columnOf(column).label
  const movable = !frozen && !pinned

  function handleKeyDown(e) {
    // Arrow keys inside the card's form (e.g. the invoice fields) edit text,
    // they don't move the card.
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onKeyMove(task, column, e.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  let skin
  if (state === 'ghost') {
    skin = 'border-dashed border-line-strong bg-subtle'
  } else if (frozen) {
    skin = `${CARD_SKIN} cursor-not-allowed opacity-60`
  } else if (pinned) {
    skin = CARD_SKIN
  } else {
    skin =
      `${CARD_SKIN} cursor-grab touch-none transition-colors duration-150 ease-out ` +
      'hover:border-line-strong focus-visible:border-brand focus-visible:shadow-[0_0_0_2px_rgba(11,92,107,0.25)] ' +
      (state === 'landing' ? 'card-land' : '')
  }

  return (
    <div
      data-task-id={task.id}
      tabIndex={movable ? 0 : -1}
      aria-disabled={frozen || undefined}
      aria-label={
        locked
          ? `${task.title}, in ${label}. Waiting on ${task.waiting_on.join(', ')}.`
          : frozen
            ? `${task.title}, in ${label}. Awaiting is read-only and can't be moved.`
            : pinned
              ? `${task.title}, in ${label}. Completed from its own page: use Open.`
              : `${task.title}, in ${label}. Drag to another column, or press left or right arrow to move.`
      }
      onPointerDown={movable ? (e) => onPressStart(e, task, column) : undefined}
      onKeyDown={movable ? handleKeyDown : undefined}
      onAnimationEnd={state === 'landing' ? onLanded : undefined}
      className={`${CARD_BASE} ${skin}`}
    >
      <div className={state === 'ghost' ? 'invisible' : ''}>
        <CardFace
          task={task}
          column={column}
          locked={locked}
          accessory={pinned && !frozen ? null : <Icon name={frozen ? 'lock' : 'grip'} className="text-fg-subtle" />}
        />
        {extra}
      </div>
    </div>
  )
}

/**
 * The same card, on the doctor's overview: no drag, no focus, no keyboard
 * move -- the doctor reads the board rather than working it. The completion
 * seal stands in for the column position the staff board gets for free.
 */
function DoctorCard({ task, locked }) {
  const column = boardStatusOf(task)
  const done = column === 'done'
  const awaiting = column === 'awaiting'

  return (
    <div className={`${CARD_BASE} ${done ? 'border-success bg-success-bg' : CARD_SKIN} ${locked ? 'opacity-60' : ''}`}>
      <CardFace
        task={task}
        column={column}
        locked={locked}
        strikeDone={false}
        accessory={
          done ? (
            <Icon name="check" className="text-success" />
          ) : awaiting ? (
            <Badge tone={COLUMN_BADGE.awaiting.tone}>{COLUMN_BADGE.awaiting.label}</Badge>
          ) : null
        }
      />
    </div>
  )
}

// ─── Card forms (kept out of drag: data-no-drag) ──────────────────────────────

// Cards whose work is recording an invoice (POST /api/practice-drugs/{id}/invoices).
const INVOICE_KINDS = ['receiving', 'buy_for_patient']

const FIELD =
  'w-full appearance-none rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-fg ' +
  'outline-none focus:border-brand focus:shadow-[0_0_0_2px_rgba(11,92,107,0.25)]'
const FIELD_LABEL = 'text-xs text-fg-muted'

/**
 * Typed-in invoice lines -- the plan's fallback for invoice upload + AI
 * reading (WorkspacePlan.md Layer 4). One line per submit; the backend checks
 * the NDC against the drug's packages and adds the vials to stock.
 */
function InvoiceForm({ drug, onSubmit }) {
  const distributors = drug?.distributors ?? []
  const packages = drug?.packages ?? []
  const [form, setForm] = useState({
    distributor: distributors[0] ?? '',
    ndc_11: packages[0]?.ndc_11 ?? '',
    lot: '',
    quantity: '',
    cost_per_vial: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        distributor: form.distributor,
        ndc_11: form.ndc_11,
        lot: form.lot,
        quantity: Number.parseInt(form.quantity, 10) || 0,
        cost_per_vial: Number.parseFloat(form.cost_per_vial) || 0,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form data-no-drag onSubmit={handleSubmit} className="mt-3 grid select-text grid-cols-2 gap-2">
      <label className={`${FIELD_LABEL} col-span-2`}>
        Distributor
        <select value={form.distributor} onChange={set('distributor')} className={`${FIELD} mt-1`}>
          {distributors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${FIELD_LABEL} col-span-2`}>
        NDC
        <select value={form.ndc_11} onChange={set('ndc_11')} className={`${FIELD} mt-1 font-mono`}>
          {packages.map((p) => (
            <option key={p.ndc_11} value={p.ndc_11}>
              {p.ndc_11}
              {p.strength_mg ? ` · ${p.strength_mg} mg` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className={`${FIELD_LABEL} col-span-2`}>
        Lot
        <input value={form.lot} onChange={set('lot')} className={`${FIELD} mt-1 font-mono`} />
      </label>
      <label className={FIELD_LABEL}>
        Vials
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={form.quantity}
          onChange={set('quantity')}
          className={`${FIELD} mt-1`}
        />
      </label>
      <label className={FIELD_LABEL}>
        $ / vial
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={form.cost_per_vial}
          onChange={set('cost_per_vial')}
          className={`${FIELD} mt-1`}
        />
      </label>
      {error && <p className="col-span-2 text-[12px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="sm" disabled={submitting} className="col-span-2">
        {submitting ? 'Recording…' : 'Record invoice'}
      </Button>
    </form>
  )
}

/**
 * What an invoice card shows in To Do: the form, or -- once Receive & store
 * has an invoice -- the stock it added and "Mark stored" (completing the card,
 * the plan's "stored" step; a Buy card completes itself on its invoice).
 */
function ReceivingPanel({ task, drug, stockVials, onRecordInvoice, onMarkStored }) {
  const [addingAnother, setAddingAnother] = useState(false)
  const recorded = Boolean(task.inputs?.invoice_recorded_at)

  if (task.kind === 'receiving' && recorded && !addingAnother) {
    return (
      <div data-no-drag className="mt-3 flex select-text flex-wrap items-center gap-2">
        <p className="flex w-full items-center gap-1.5 text-[13px] text-success">
          <Icon name="check" /> Invoice recorded · {stockVials} vial{stockVials === 1 ? '' : 's'} in stock
        </p>
        <Button variant="primary" size="sm" onClick={onMarkStored}>
          Mark stored
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAddingAnother(true)}>
          Record another invoice
        </Button>
      </div>
    )
  }

  return (
    <InvoiceForm
      drug={drug}
      onSubmit={async (line) => {
        await onRecordInvoice(task, line)
        setAddingAnother(false)
      }}
    />
  )
}

/** "Open →" on a card whose work happens on its own page. */
function OpenLink({ to }) {
  return (
    <div data-no-drag className="mt-3">
      <Button to={to} size="sm">
        Open <Icon name="arrowRight" />
      </Button>
    </div>
  )
}

/**
 * The biller's prior-auth card: the authorization number goes in the card's
 * inputs (the claim's Box 23 reads it) and completes the card, which unlocks
 * the patient's prep.
 */
function PriorAuthPanel({ onComplete }) {
  const [number, setNumber] = useState('')
  const [error, setError] = useState(null)

  function handleSubmit(e) {
    e.preventDefault()
    if (!number.trim()) {
      setError('Enter the authorization number')
      return
    }
    onComplete(number.trim())
  }

  return (
    <form data-no-drag onSubmit={handleSubmit} className="mt-3 grid select-text gap-2">
      <label className={FIELD_LABEL}>
        Authorization number
        <input
          value={number}
          onChange={(e) => {
            setNumber(e.target.value)
            setError(null)
          }}
          className={`${FIELD} mt-1 font-mono`}
        />
      </label>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="sm">
        Save &amp; complete
      </Button>
    </form>
  )
}

// ─── Doctor lane ──────────────────────────────────────────────────────────────

const PLANNED_SAVE_DEBOUNCE_MS = 600

/**
 * A doctor task as a small status chip: title plus done / to do. With `to`
 * (a patient's "Order + sign") the chip opens that patient's chart.
 */
function DoctorTaskChip({ task, to }) {
  const done = task.status === 'done'
  const className = `inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[13px] no-underline ${
    done ? 'border-line bg-success-bg text-success' : 'border-line bg-surface text-fg'
  } ${to ? 'transition-colors hover:border-line-strong' : ''}`
  const content = (
    <>
      {task.title}
      {done ? <Icon name="check" /> : to ? <Icon name="arrowRight" className="text-fg-subtle" /> : (
        <span className="text-fg-subtle">to do</span>
      )}
    </>
  )
  return to ? (
    <Link to={to} className={className}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  )
}

/**
 * The doctor's lane (WorkspacePlan.md Layer 1/2): planned patients per month,
 * saved on change to practice_drugs -- which completes the "Set planned
 * patients" task and unlocks Purchasing -- plus the doctor's own task cards.
 * `draft` holds what the doctor is typing; while it's null the field shows the
 * server's value, so the 3-second poll never overwrites an edit in progress.
 */
function DoctorStrip({ planned, tasks, onSavePlanned, practiceDrugId }) {
  const [draft, setDraft] = useState(null)
  const [saveState, setSaveState] = useState({ kind: 'idle' }) // idle | saving | saved | error
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const planTask = tasks.find((t) => t.kind === 'plan_patients')
  const otherTasks = sortTasks(tasks.filter((t) => t.kind !== 'plan_patients'))
  const shown = draft ?? (planned != null ? String(planned) : '')

  async function save(value) {
    clearTimeout(timerRef.current)
    const n = Number(value)
    if (value.trim() === '' || !Number.isInteger(n)) return
    setSaveState({ kind: 'saving' })
    try {
      await onSavePlanned(n)
      setSaveState({ kind: 'saved' })
      // Hand the field back to the server value unless they've typed more since.
      setDraft((current) => (current === value ? null : current))
    } catch (err) {
      setSaveState({ kind: 'error', message: err.message })
    }
  }

  function handleChange(e) {
    const value = e.target.value
    setDraft(value)
    setSaveState({ kind: 'idle' })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => save(value), PLANNED_SAVE_DEBOUNCE_MS)
  }

  return (
    <section className="mb-4 rounded-md border border-line bg-subtle p-3">
      <ColumnHeading label="Doctor" count={tasks.length} dotColor={ROLES.doctor.color} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <label className="flex items-center gap-3 text-[13px] text-fg">
          Planned patients / month
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={shown}
            onChange={handleChange}
            onKeyDown={(e) => e.key === 'Enter' && save(e.currentTarget.value)}
            className={`${FIELD} w-20`}
          />
        </label>
        <span aria-live="polite" className="text-[12px]">
          {saveState.kind === 'saving' && <span className="text-fg-subtle">Saving…</span>}
          {saveState.kind === 'saved' && <span className="text-success">Saved</span>}
          {saveState.kind === 'error' && <span className="text-danger">{saveState.message}</span>}
        </span>
        {planTask && (
          <span className="ml-auto">
            <DoctorTaskChip task={planTask} />
          </span>
        )}
      </div>
      {otherTasks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 px-1">
          {otherTasks.map((task) => (
            <DoctorTaskChip key={task.id} task={task} to={pageLinkFor(task, practiceDrugId)} />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Shown to the doctor once the drug is Ready to treat (status `active`,
 * WorkspacePlan.md Layer 1/2's Ready banner): "Start first patient" opens the
 * practice's patient list, each with a link to their chart for this drug.
 * Patients who already have an order here are marked.
 */
function ReadyBanner({ drugName, practiceDrugId, orderedPatientIds }) {
  const [open, setOpen] = useState(false)
  const [patients, setPatients] = useState(null)
  const [error, setError] = useState(null)

  async function handleOpen() {
    setOpen(true)
    if (patients) return
    setError(null)
    try {
      setPatients(await fetchPatients())
    } catch (err) {
      setError(err.status === 401 ? 'Sign in as the practice’s doctor to see patients.' : err.message)
    }
  }

  const started = orderedPatientIds.size > 0

  return (
    <section className="mb-4 rounded-md border border-line bg-success-bg p-3">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <Icon name="check" /> {drugName} is ready to treat.
        </p>
        {!open && (
          <Button variant="primary" size="sm" onClick={handleOpen} className="ml-auto">
            {started ? 'Start next patient' : 'Start first patient'} <Icon name="arrowRight" />
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-md border border-line bg-surface p-2">
          {error ? (
            <p className="px-1 text-[13px] text-danger">{error}</p>
          ) : !patients ? (
            <Spinner label="Loading patients…" />
          ) : patients.length === 0 ? (
            <p className="px-1 text-[13px] text-fg-muted">No patients yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {patients.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-1 py-2">
                  <span className="text-sm font-medium text-fg">{p.name}</span>
                  <span className="text-[13px] text-fg-muted">
                    {[p.insurance, p.weight_kg != null && `${p.weight_kg} kg`].filter(Boolean).join(' · ')}
                  </span>
                  {orderedPatientIds.has(p.id) && <Badge tone="brand">Order started</Badge>}
                  <Button to={`/doctor/patients/${p.id}?pd=${practiceDrugId}`} size="sm" className="ml-auto">
                    Open chart <Icon name="arrowRight" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Boards ───────────────────────────────────────────────────────────────────

/**
 * Doctor's overarching view of the staff: every staff task, grouped into one
 * column per staff role, read-only. The doctor's own tasks are in DoctorStrip.
 */
function DoctorBoard({ tasks, practiceDrugId, filter }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {ROLE_COLUMNS.map((role) => {
        const ordered = sortTasks(tasks.filter((t) => t.role === role))
        const notDone = ordered.filter((t) => boardStatusOf(t) !== 'done')
        const done = ordered.filter((t) => boardStatusOf(t) === 'done')

        // Default ('all'): not-completed above, completed at the bottom.
        // The other two filters hide one group instead of reordering.
        const roleTasks =
          filter === 'active' ? notDone : filter === 'completed' ? done : [...notDone, ...done]

        return (
          <div key={role} className="flex min-h-32 flex-col lg:min-h-[380px] rounded-md border border-line bg-subtle p-3">
            <ColumnHeading
              label={ROLE_LABEL[role]}
              count={roleTasks.length}
              to={`/staff/${role}/workspace/${practiceDrugId}`}
            />

            <div className="flex flex-1 flex-col gap-2">
              {roleTasks.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong text-[13px] text-fg-subtle">
                  No tasks
                </div>
              ) : (
                roleTasks.map((task) => (
                  <DoctorCard key={task.id} task={task} locked={isWaiting(task)} />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A staff role's own board: their tasks only, grouped by lifecycle column.
 * Cards are moved by pressing and dragging them onto another column (pointer
 * events, so mouse, pen and touch all work), or with the arrow keys.
 */
function StaffBoard({ role, tasks, onMove, drug, stockVials, onRecordInvoice, practiceDrugId }) {
  // The press/drag in progress, or null. `active` flips true once the pointer
  // has moved past DRAG_THRESHOLD; `over` is the column key under the pointer.
  // Mirrored into a ref so the window listeners always read the latest value.
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const [landingId, setLandingId] = useState(null)
  const [announcement, setAnnouncement] = useState('')

  const pressing = drag !== null
  const dragging = Boolean(drag?.active)

  function setDragState(next) {
    dragRef.current = next
    setDrag(next)
  }

  const commitMove = useCallback(
    (task, from, to, extraInputs) => {
      // Awaiting is frozen on both sides: nothing can be dropped into it
      // (checked via `to`), and a card already sitting there can't leave it
      // by drag or keyboard either (checked via `from`) -- BoardCard already
      // keeps a frozen card from starting a drag or a keyboard move, but this
      // guard keeps the invariant true even if something else calls in.
      if (!to || to === from || from === 'awaiting' || !columnOf(to).droppable) return
      onMove(task, to, extraInputs)
      setLandingId(task.id)
      setAnnouncement(`Moved ${task.title} to ${columnOf(to).label}.`)
    },
    [onMove],
  )

  function handlePressStart(e, task, column) {
    if (e.button !== 0) return
    // Pressing a form field or button inside the card works that control.
    if (e.target.closest('[data-no-drag]')) return
    // Grabbing the text area's scrollbar should scroll, not pick up the card.
    const scroller = e.target.closest('[data-card-scroll]')
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      if (e.clientX >= r.left + scroller.clientWidth || e.clientY >= r.top + scroller.clientHeight) {
        return
      }
    }
    // Capture so the release still reaches us if it happens outside the window.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer already gone -- the drag just won't be captured.
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setDragState({
      task,
      from: column,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      x: e.clientX,
      y: e.clientY,
      active: false,
      over: null,
    })
  }

  function handleKeyMove(task, column, dir) {
    // Step over any column that can't be dropped into, so To Do <-> Complete
    // is one keypress in each direction rather than stopping at Awaiting.
    let i = BOARD_COLUMNS.findIndex((c) => c.key === column) + dir
    while (BOARD_COLUMNS[i] && !BOARD_COLUMNS[i].droppable) i += dir
    const target = BOARD_COLUMNS[i]
    if (!target) return
    commitMove(task, column, target.key)
    // The card re-mounts in its new column; keep keyboard focus on it.
    requestAnimationFrame(() => {
      document.querySelector(`[data-task-id="${task.id}"]`)?.focus()
    })
  }

  useEffect(() => {
    if (!pressing) return

    function handleMove(e) {
      const d = dragRef.current
      if (!d) return
      const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      if (!d.active && moved <= DRAG_THRESHOLD) return
      // The floating copy is pointer-events-none, so this hits the column beneath it.
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      const under = hit?.closest('[data-board-column]')?.getAttribute('data-board-column') ?? null
      // Hovering a column staff can't drop into reads the same as hovering
      // nothing: no highlight, and releasing there leaves the card put.
      const over = under && columnOf(under)?.droppable ? under : null
      setDragState({ ...d, active: true, x: e.clientX, y: e.clientY, over })
    }

    function handleUp() {
      const d = dragRef.current
      setDragState(null)
      if (d?.active) commitMove(d.task, d.from, d.over)
    }

    function handleCancel() {
      setDragState(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
    }
  }, [pressing, commitMove])

  // Keep the closed-hand cursor wherever the pointer goes mid-drag.
  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [dragging])

  const myTasks = sortTasks(tasks.filter((t) => t.role === role))

  const grouped = { todo: [], awaiting: [], done: [] }
  myTasks.forEach((t) => grouped[boardStatusOf(t)].push(t))

  // While hovering a valid column, the dragged copy previews that column.
  const previewColumn =
    dragging && drag.over && drag.over !== drag.from ? drag.over : drag?.from

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {BOARD_COLUMNS.map(({ key, label, droppable }) => {
          const isTarget = dragging && drag.over === key && key !== drag.from
          // Mid-drag, a column that can't take the card recedes so the two
          // that can are the only live targets on screen.
          const isInert = dragging && !droppable && key !== drag.from
          const cards = grouped[key]

          return (
            <div
              key={key}
              data-board-column={key}
              className={`flex min-h-32 flex-col lg:min-h-[380px] rounded-md border p-3 transition-[background-color,border-color,opacity] duration-150 ${
                isTarget ? 'border-brand bg-brand-subtle' : 'border-line bg-subtle'
              } ${isInert ? 'opacity-50' : ''}`}
            >
              <ColumnHeading label={label} count={cards.length} active={isTarget} />

              <div className="flex flex-1 flex-col gap-2">
                {cards.map((task) => {
                  const locked = isWaiting(task)
                  // Every card rendered in the Awaiting column is frozen --
                  // see the BOARD_COLUMNS comment above.
                  const frozen = locked || key === 'awaiting'
                  const pinned = PAGE_COMPLETED_KINDS.includes(task.kind)
                  const link = pageLinkFor(task, practiceDrugId)
                  // What a card carries below its text while it's workable:
                  // the invoice form, an Open link to its page, or the
                  // prior-auth number.
                  let extra = null
                  if (!frozen && key === 'todo' && INVOICE_KINDS.includes(task.kind)) {
                    extra = (
                      <ReceivingPanel
                        task={task}
                        drug={drug}
                        stockVials={stockVials}
                        onRecordInvoice={onRecordInvoice}
                        onMarkStored={() => commitMove(task, 'todo', 'done')}
                      />
                    )
                  } else if (pinned && link && !frozen) {
                    extra = <OpenLink to={link} />
                  } else if (!frozen && key === 'todo' && task.kind === 'prior_auth') {
                    extra = (
                      <PriorAuthPanel
                        onComplete={(authNumber) =>
                          commitMove(task, 'todo', 'done', { auth_number: authNumber })
                        }
                      />
                    )
                  }
                  return (
                    <BoardCard
                      key={task.id}
                      task={task}
                      column={key}
                      locked={locked}
                      frozen={frozen}
                      pinned={pinned}
                      extra={extra}
                      state={
                        dragging && drag.task.id === task.id
                          ? 'ghost'
                          : landingId === task.id
                            ? 'landing'
                            : 'idle'
                      }
                      onPressStart={handlePressStart}
                      onKeyMove={handleKeyMove}
                      onLanded={() => setLandingId(null)}
                    />
                  )
                })}

                {isTarget ? (
                  <div className="flex min-h-20 items-center justify-center rounded-md border-2 border-dashed border-brand p-4 text-center text-[13px] font-medium text-brand">
                    Drop to move to {label}
                  </div>
                ) : (
                  cards.length === 0 && (
                    <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong text-[13px] text-fg-subtle">
                      No tasks
                    </div>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Screen-reader confirmation of the last move. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* The card following the pointer. Portaled to <body> so no ancestor's
          backdrop-filter/transform can turn position:fixed into a local frame. */}
      {dragging &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50"
            style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          >
            <div
              className={`${CARD_BASE} border-brand bg-surface shadow-overlay`}
            >
              <CardFace task={drag.task} column={previewColumn} locked={false} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

// Serves two routes over the same workspace data (same practice_drugs row,
// same tasks): /doctor/workspace/:practiceDrugId for the practice's own doctor,
// and /staff/:role/workspace/:practiceDrugId for nurse/biller/front desk, who
// each get their own URL. `role` is undefined on the doctor route, whose board
// is a read-only overview across all 3 role columns; a staff role instead gets
// their own To Do/Awaiting/Complete board, filtered to just that role's tasks,
// with cards they can drag between columns.
function TeamWorkspacePage() {
  const { practiceDrugId, role } = useParams()

  const [data, setData] = useState(null) // full GET response
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [taskFilter, setTaskFilter] = useState('all') // doctor board only: all | active | completed
  const [moveError, setMoveError] = useState(null)
  const lastJsonRef = useRef(null)
  // `pending` = moves whose PATCH hasn't answered; `version` bumps on every
  // move. A poll that was sent before a move (or lands while one is in
  // flight) may predate it, so it's dropped rather than snapping the card back.
  const movesRef = useRef({ pending: 0, version: 0 })

  function applyData(raw) {
    const json = JSON.stringify(raw)
    if (json === lastJsonRef.current) return // no flicker if unchanged
    lastJsonRef.current = json
    setData(raw)
  }

  useEffect(() => {
    let cancelled = false

    function fetchWorkspace() {
      const version = movesRef.current.version
      fetch(`${API_URL}/api/practice-drugs/${encodeURIComponent(practiceDrugId)}/tasks`)
        .then((res) => {
          if (!res.ok) throw new Error(`Server error ${res.status}`)
          return res.json()
        })
        .then((raw) => {
          if (cancelled) return
          if (movesRef.current.pending > 0 || movesRef.current.version !== version) return
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

  function replaceTask(updatedTask) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
      }
    })
  }

  // Optimistic: the card jumps to its new column immediately, then the PATCH
  // response replaces it with the server's row, or it goes back on failure.
  // `extraInputs` carries a card's own entries with the move (e.g. the
  // prior-auth card's auth_number, which the backend requires to complete it).
  async function moveTask(task, target, extraInputs = {}) {
    const status = target === 'done' ? 'done' : 'todo'
    const optimistic = {
      ...task,
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      inputs: { ...(task.inputs ?? {}), board_status: target, ...extraInputs },
    }

    movesRef.current.pending += 1
    movesRef.current.version += 1
    setMoveError(null)
    replaceTask(optimistic)

    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, inputs: { board_status: target, ...extraInputs } }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        // The backend says why a move is refused ("Record the invoice before
        // marking the drug stored", "Waiting on: …") -- show that, not a guess.
        throw new Error(typeof body?.detail === 'string' ? body.detail : `Server error ${res.status}`)
      }
      // The PATCH returns the bare row; keep the computed fields (waiting_on,
      // patient_name) until the next poll refreshes them.
      replaceTask({ ...optimistic, ...body })
    } catch (err) {
      replaceTask(task)
      setMoveError(`Couldn't move "${task.title}": ${err.message}`)
    } finally {
      movesRef.current.pending -= 1
    }
  }

  // The doctor's planned patients per month (PATCH /api/practice-drugs/{id}).
  // Guarded like a card move so a poll sent before the save can't show the
  // old value; throws the backend's message for DoctorStrip to display.
  async function savePlanned(n) {
    movesRef.current.pending += 1
    movesRef.current.version += 1
    try {
      const res = await fetch(`${API_URL}/api/practice-drugs/${encodeURIComponent(practiceDrugId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planned_patients_per_month: n }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(typeof body?.detail === 'string' ? body.detail : `Server error ${res.status}`)
      }
      setData((prev) =>
        prev && {
          ...prev,
          practice_drug: {
            ...prev.practice_drug,
            planned_patients_per_month: body.planned_patients_per_month,
            status: body.status,
          },
          tasks: prev.tasks.map((t) =>
            t.kind === 'plan_patients'
              ? { ...t, status: body.planned_patients_per_month > 0 ? 'done' : 'todo' }
              : t,
          ),
        },
      )
    } finally {
      movesRef.current.pending -= 1
    }
  }

  // Front desk records an invoice on a Receive & store / Buy card (POST
  // /api/practice-drugs/{id}/invoices). Guarded like a move; the new stock
  // and card state are applied right away, the next poll confirms them.
  async function recordInvoice(task, line) {
    movesRef.current.pending += 1
    movesRef.current.version += 1
    try {
      const { distributor, ...invoiceLine } = line
      const res = await fetch(
        `${API_URL}/api/practice-drugs/${encodeURIComponent(practiceDrugId)}/invoices`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ distributor, task_id: task.id, lines: [invoiceLine] }),
        },
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          typeof body?.detail === 'string' ? body.detail : 'Check the invoice fields and try again',
        )
      }
      const recordedAt = new Date().toISOString()
      setData((prev) =>
        prev && {
          ...prev,
          practice_drug: { ...prev.practice_drug, stock_on_hand: body.stock_on_hand, status: body.status },
          tasks: prev.tasks.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  inputs: { ...(t.inputs ?? {}), invoice_recorded_at: recordedAt },
                  status: t.kind === 'buy_for_patient' ? 'done' : t.status,
                }
              : t,
          ),
        },
      )
    } finally {
      movesRef.current.pending -= 1
    }
  }

  // An unrecognized :role -- same treatment as StaffWorkspacesPage: send them
  // home rather than render a page whose back link points nowhere.
  if (role && !ROLE_LABEL[role]) return <Navigate to="/" replace />

  // Staff came from their own role listing; the doctor came from the drug list.
  const listCrumb = role
    ? { label: 'Workspaces', to: `/staff/${role}` }
    : { label: 'Workspaces', to: '/doctor/drugs?view=workspaces' }
  const shellRole = role ?? 'doctor'

  if (isLoading) {
    return (
      <AppShell role={shellRole} breadcrumbs={[listCrumb, { label: 'Loading…' }]}>
        <Spinner label="Loading workspace…" />
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell role={shellRole} breadcrumbs={[listCrumb, { label: 'Error' }]}>
        <Alert tone="danger" title="Could not load workspace">
          {error}
        </Alert>
      </AppShell>
    )
  }

  const { drug, tasks, practice_drug: practiceDrug } = data
  const allTasks = tasks ?? []
  const stockVials = (practiceDrug?.stock_on_hand ?? []).reduce((sum, s) => sum + (s.quantity ?? 0), 0)
  const drugName = drug?.brand_name ?? 'Team workspace'
  const status = WORKSPACE_STATUS[practiceDrug?.status]

  return (
    <AppShell role={shellRole} breadcrumbs={[listCrumb, { label: drugName }]}>
      <PageHeader
        title={drugName}
        badges={status && <Badge tone={status.tone}>{status.label}</Badge>}
        meta={
          role
            ? `Your ${ROLE_LABEL[role]} tasks. Drag a card between To Do and Complete, or focus it and use the arrow keys.`
            : "Your planned patients and patient orders are in the Doctor lane; your team's tasks are below, read-only."
        }
        actions={
          !role && (
            <div className="flex gap-1">
              {TASK_FILTERS.map((f) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant={taskFilter === f.id ? 'primary' : 'secondary'}
                  onClick={() => setTaskFilter(f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          )
        }
      />

      <CodeChangeNotice practiceDrugId={practiceDrugId} className="mb-4" />

      {role ? (
        <>
          {moveError && (
            <Alert tone="warning" className="mb-4">
              {moveError}
            </Alert>
          )}
          <StaffBoard
            role={role}
            tasks={allTasks}
            onMove={moveTask}
            drug={drug}
            stockVials={stockVials}
            onRecordInvoice={recordInvoice}
            practiceDrugId={practiceDrugId}
          />
        </>
      ) : (
        <>
          {practiceDrug?.status === 'active' && (
            <ReadyBanner
              drugName={drugName}
              practiceDrugId={practiceDrugId}
              orderedPatientIds={
                new Set(allTasks.filter((t) => t.kind === 'order_sign' && t.patient_id).map((t) => t.patient_id))
              }
            />
          )}
          <DoctorStrip
            planned={practiceDrug?.planned_patients_per_month}
            tasks={allTasks.filter((t) => t.role === 'doctor')}
            onSavePlanned={savePlanned}
            practiceDrugId={practiceDrugId}
          />
          <DoctorBoard tasks={allTasks} practiceDrugId={practiceDrugId} filter={taskFilter} />
        </>
      )}
    </AppShell>
  )
}

export default TeamWorkspacePage

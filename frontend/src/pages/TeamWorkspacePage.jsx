import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link, Navigate } from 'react-router-dom'
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
const ROLE_COLUMNS = [
  { role: 'front_desk', kinds: ['purchasing', 'receiving'] },
  { role: 'nurse', kinds: ['nurse_setup'] },
  { role: 'biller', kinds: ['billing_setup'] },
]

const KIND_ORDER = ['purchasing', 'receiving', 'nurse_setup', 'billing_setup']

// A staff member's own board: 3 lifecycle columns a card moves through.
// 'done' is persisted as tasks.status = 'done' (the DB's tasks_status_check
// constraint only allows 'todo'/'done'); 'awaiting' is a waypoint that only
// exists on the frontend, stored in the existing tasks.inputs jsonb column
// (inputs.board_status) instead of status, so it never touches that constraint.
// Green is reserved for the drop-target highlight -- columns have no color
// identity of their own otherwise.
const BOARD_COLUMNS = [
  { key: 'todo', label: 'To Do' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'done', label: 'Complete' },
]

function columnOf(key) {
  return BOARD_COLUMNS.find((c) => c.key === key)
}

function boardStatusOf(task) {
  if (task.status === 'done') return 'done'
  if (task.inputs?.board_status === 'awaiting') return 'awaiting'
  return 'todo'
}

// ─── Column header ────────────────────────────────────────────────────────────

function ColumnHeader({ children }) {
  return (
    <p className="mb-4 text-[11px] font-semibold tracking-widest text-white/40 uppercase">
      {children}
    </p>
  )
}

// ─── Doctor's read-only task card ─────────────────────────────────────────────

/**
 * A single task on the doctor's overview. Read-only: shows the task's current
 * board column as a label. `locked` (front desk's Receiving, before
 * Purchasing is done) dims it and replaces the instruction text with why.
 */
function TaskCard({ task, locked }) {
  return (
    <div
      className={`rounded-lg border border-white/10 bg-white/[0.03] p-4 ${locked ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold leading-snug text-white/90">{task.title}</p>
        <span className="shrink-0 text-[11px] font-semibold tracking-wide text-white/40 uppercase">
          {columnOf(boardStatusOf(task)).label}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-[1.6] text-white/50">
        {locked ? 'Waiting on: Purchasing' : task.instruction}
      </p>
    </div>
  )
}

// ─── Staff board card ─────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 16"
      className="h-4 w-2.5 fill-current text-white/30 transition-colors group-hover:text-violet-200"
    >
      {[3, 8, 13].map((cy) => (
        <g key={cy}>
          <circle cx="2" cy={cy} r="1.4" />
          <circle cx="8" cy={cy} r="1.4" />
        </g>
      ))}
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current text-white/50"
      strokeWidth="1.6"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}

/**
 * What's printed on a staff card -- shared by the card in its column and the
 * copy that follows the pointer during a drag. `column` drives the edge color
 * and the struck-through "done" title, so the dragged copy can preview the
 * column it's hovering over.
 */
function CardFace({ task, column, locked }) {
  const done = column === 'done'

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-[15px] leading-snug font-semibold ${
            done ? 'text-white/55 line-through decoration-white/30' : 'text-white'
          }`}
        >
          {task.title}
        </p>
        <div className="mt-0.5 shrink-0">{locked ? <LockIcon /> : <GripIcon />}</div>
      </div>

      {/* Long instructions scroll inside the card instead of stretching it. */}
      <div
        data-card-scroll
        className="card-scroll mt-2 max-h-28 touch-pan-y overflow-auto pr-1 text-[12.5px] leading-[1.6] text-white/60"
      >
        {locked ? 'Waiting on: Purchasing' : task.instruction}
      </div>
    </>
  )
}

const CARD_BASE = 'relative rounded-2xl border p-4 select-none outline-none'

const CARD_GLASS =
  'border-white/15 bg-linear-to-br from-violet-400/[0.16] via-white/[0.05] to-indigo-500/[0.10] backdrop-blur-xl ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_24px_-12px_rgba(0,0,0,0.6)]'

/**
 * A staff card in its column. `state` is 'idle', 'ghost' (it's the card being
 * dragged, so its slot shows a dashed outline) or 'landing' (just dropped here).
 */
function BoardCard({ task, column, locked, state, onPressStart, onKeyMove, onLanded }) {
  const label = columnOf(column).label

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onKeyMove(task, column, e.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  let skin
  if (state === 'ghost') {
    skin = 'border-dashed border-white/25 bg-white/[0.02]'
  } else if (locked) {
    skin = `${CARD_GLASS} cursor-not-allowed opacity-50`
  } else {
    skin =
      `${CARD_GLASS} group cursor-grab touch-none transition-[transform,box-shadow,border-color] duration-200 ease-out ` +
      'hover:border-violet-200/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_36px_-12px_rgba(167,139,250,0.55)] ' +
      'motion-safe:hover:-translate-y-0.5 focus-visible:border-violet-200/60 focus-visible:ring-2 focus-visible:ring-violet-300/60 ' +
      (state === 'landing' ? 'card-land' : '')
  }

  return (
    <div
      data-task-id={task.id}
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked || undefined}
      aria-label={
        locked
          ? `${task.title}, in ${label}. Locked until Purchasing is complete.`
          : `${task.title}, in ${label}. Drag to another column, or press left or right arrow to move.`
      }
      onPointerDown={locked ? undefined : (e) => onPressStart(e, task, column)}
      onKeyDown={locked ? undefined : handleKeyDown}
      onAnimationEnd={state === 'landing' ? onLanded : undefined}
      className={`${CARD_BASE} ${skin}`}
    >
      <div className={state === 'ghost' ? 'invisible' : ''}>
        <CardFace task={task} column={column} locked={locked} />
      </div>
    </div>
  )
}

// ─── Boards ───────────────────────────────────────────────────────────────────

/** Doctor's overarching view: every role's tasks, read-only, side by side. */
function DoctorBoard({ byKind, purchasingDone }) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
      {ROLE_COLUMNS.map(({ role, kinds }) => {
        const roleTasks = kinds
          .map((k) => byKind[k])
          .filter(Boolean)
          .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

        return (
          <div key={role} className="rounded-xl border border-white/10 bg-white/[0.025] px-5 py-5">
            <ColumnHeader>{ROLE_LABEL[role]}</ColumnHeader>
            {roleTasks.length === 0 ? (
              <p className="text-[13px] text-white/30">No tasks.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {roleTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    locked={task.kind === 'receiving' && !purchasingDone}
                  />
                ))}
              </div>
            )}
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
function StaffBoard({ role, tasks, purchasingDone, onMove }) {
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
    (task, from, to) => {
      if (!to || to === from) return
      onMove(task, to)
      setLandingId(task.id)
      setAnnouncement(`Moved ${task.title} to ${columnOf(to).label}.`)
    },
    [onMove],
  )

  function handlePressStart(e, task, column) {
    if (e.button !== 0) return
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
    const idx = BOARD_COLUMNS.findIndex((c) => c.key === column)
    const target = BOARD_COLUMNS[idx + dir]
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
      const over = hit?.closest('[data-board-column]')?.getAttribute('data-board-column') ?? null
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

  const myTasks = tasks
    .filter((t) => t.role === role)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

  const grouped = { todo: [], awaiting: [], done: [] }
  myTasks.forEach((t) => grouped[boardStatusOf(t)].push(t))

  // While hovering a valid column, the dragged copy previews that column.
  const previewColumn =
    dragging && drag.over && drag.over !== drag.from ? drag.over : drag?.from

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {BOARD_COLUMNS.map(({ key, label }) => {
          const isTarget = dragging && drag.over === key && key !== drag.from
          const cards = grouped[key]

          return (
            <div
              key={key}
              data-board-column={key}
              className={`flex min-h-[380px] flex-col rounded-2xl border p-4 backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-200 ${
                isTarget
                  ? 'border-emerald-400/70 bg-emerald-500/20 shadow-[0_0_0_1px_rgba(52,211,153,0.45),0_0_48px_-12px_rgba(52,211,153,0.55)]'
                  : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <div className="mb-4 flex items-center gap-2">
                <p
                  className={`text-[11px] font-semibold tracking-widest uppercase ${
                    isTarget ? 'text-emerald-100' : 'text-white/60'
                  }`}
                >
                  {label}
                </p>
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/60">
                  {cards.length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-3">
                {cards.map((task) => (
                  <BoardCard
                    key={task.id}
                    task={task}
                    column={key}
                    locked={task.kind === 'receiving' && !purchasingDone}
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
                ))}

                {isTarget ? (
                  <div className="flex min-h-20 items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300/60 p-4 text-center text-[12px] font-medium text-emerald-100/90">
                    Drop to move to {label}
                  </div>
                ) : (
                  cards.length === 0 && (
                    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 text-[12px] text-white/30">
                      Nothing here
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
              className={`${CARD_BASE} ${CARD_GLASS} border-violet-200/50 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8),0_0_0_1px_rgba(196,181,253,0.35)] motion-safe:scale-[1.04] motion-safe:rotate-[3deg]`}
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
  async function moveTask(task, target) {
    const status = target === 'done' ? 'done' : 'todo'
    const optimistic = {
      ...task,
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      inputs: { ...(task.inputs ?? {}), board_status: target },
    }

    movesRef.current.pending += 1
    movesRef.current.version += 1
    setMoveError(null)
    replaceTask(optimistic)

    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, inputs: { board_status: target } }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      replaceTask(await res.json())
    } catch {
      replaceTask(task)
      setMoveError(`Couldn't move "${task.title}" — it's back where it was. Try again.`)
    } finally {
      movesRef.current.pending -= 1
    }
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
        <Link to={backTo} className="text-sm font-medium text-white/50 transition-colors hover:text-white">
          &larr; {backLabel}
        </Link>
        <p className="mt-10 text-[14px] text-white/35">Loading workspace&hellip;</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex min-h-screen w-full flex-col py-8 text-[#f0f0f5] ${PAGE}`}>
        <Link to={backTo} className="text-sm font-medium text-white/50 transition-colors hover:text-white">
          &larr; {backLabel}
        </Link>
        <p className="mt-10 text-[14px] text-white/35">Could not load workspace: {error}</p>
      </div>
    )
  }

  const { drug, tasks } = data
  const allTasks = tasks ?? []
  const byKind = Object.fromEntries(allTasks.map((t) => [t.kind, t]))
  const purchasingDone = byKind.purchasing?.status === 'done'

  return (
    <div className={`flex min-h-screen w-full flex-col py-8 text-[#f0f0f5] ${PAGE}`}>
      <Link to={backTo} className="text-sm font-medium text-white/50 transition-colors hover:text-white">
        &larr; {backLabel}
      </Link>

      <div className="mt-6 flex flex-wrap items-baseline gap-2">
        <h1 className="text-[clamp(22px,2.8vw,34px)] font-semibold leading-tight text-white">
          {drug?.brand_name ?? 'Team workspace'}
        </h1>
        {role && <span className="text-[13px] font-medium text-white/40">{ROLE_LABEL[role]} board</span>}
      </div>

      {role ? (
        <>
          <p className="mt-1.5 text-[13px] text-white/40">
            Drag a card to another column to move it. A focused card also moves with the ← → keys.
          </p>
          {moveError && (
            <p role="alert" className="mt-3 text-[13px] text-amber-200/90">
              {moveError}
            </p>
          )}
          <StaffBoard role={role} tasks={allTasks} purchasingDone={purchasingDone} onMove={moveTask} />
        </>
      ) : (
        <DoctorBoard byKind={byKind} purchasingDone={purchasingDone} />
      )}
    </div>
  )
}

export default TeamWorkspacePage

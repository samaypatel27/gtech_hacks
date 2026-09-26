import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import '../tailwind.css'

const API_URL = import.meta.env.VITE_API_URL

// Role display labels matching the BuildPlan role names.
const ROLE_LABELS = {
  front_desk: 'Front Desk',
  nurse: 'Nurse',
  biller: 'Biller',
}

// Ordered so the workspace page presents them in workflow order.
const ROLE_ORDER = ['front_desk', 'nurse', 'biller']

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

function SectionHeading({ children }) {
  return (
    <h2 className="block border-b border-white/15 pb-3 text-[18px] font-semibold tracking-[0.04em] text-white uppercase">
      {children}
    </h2>
  )
}

// A single task card rendered in the plain document style -- no colored dots,
// no card borders. The checkbox toggles status between 'todo' and 'done'.
function TaskCard({ task, onToggle }) {
  const isDone = task.status === 'done'

  return (
    <div className="grid grid-cols-1 gap-1 py-4 first:pt-0 last:pb-0 border-b border-white/[0.06] last:border-b-0">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id={`task-${task.id}`}
          checked={isDone}
          onChange={() => onToggle(task)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-white/40 bg-transparent checked:border-white checked:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          aria-label={`Mark "${task.title}" as ${isDone ? 'to do' : 'done'}`}
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={`task-${task.id}`}
            className={`block cursor-pointer text-[16px] font-semibold leading-snug ${isDone ? 'text-white/40 line-through' : 'text-white/90'}`}
          >
            {task.title}
          </label>
          <p
            className={`mt-1.5 text-[14px] leading-[1.6] ${isDone ? 'text-white/25' : 'text-white/55'}`}
          >
            {task.instruction}
          </p>
        </div>
      </div>
    </div>
  )
}

// One role group: a heading and the tasks for that role.
function RoleSection({ role, tasks, onToggle }) {
  return (
    <section>
      <SectionHeading>{ROLE_LABELS[role] ?? role}</SectionHeading>
      <div className="mt-4 flex flex-col">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onToggle={onToggle} />
        ))}
      </div>
    </section>
  )
}

// Fetches tasks for the given practiceDrugId, groups them by role, and
// renders the workspace. Checkbox toggles PATCH /api/tasks/:id/status.
function TeamWorkspacePage() {
  const { practiceDrugId } = useParams()
  const [tasks, setTasks] = useState([])
  const [drugName, setDrugName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    fetch(`${API_URL}/api/practice-drugs/${encodeURIComponent(practiceDrugId)}/tasks`)
      .then((res) => {
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setTasks(data.tasks ?? [])
        setDrugName(data.drug_name ?? '')
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [practiceDrugId])

  function handleToggle(task) {
    const nextStatus = task.status === 'done' ? 'todo' : 'done'

    // Optimistic update.
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)),
    )

    fetch(`${API_URL}/api/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    }).catch(() => {
      // Roll back on failure.
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)),
      )
    })
  }

  const PAGE_CONTAINER =
    'mx-auto w-full max-w-[1280px] px-5 sm:px-8 xl:px-12'

  if (isLoading) {
    return (
      <div
        className={`flex min-h-screen w-full flex-col py-6 text-[#f0f0f5] ${PAGE_CONTAINER}`}
      >
        <BackLink />
        <p className="mt-8 text-white/40">Loading workspace&hellip;</p>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={`flex min-h-screen w-full flex-col py-6 text-[#f0f0f5] ${PAGE_CONTAINER}`}
      >
        <BackLink />
        <p className="mt-8 text-white/40">Could not load workspace: {error}</p>
      </div>
    )
  }

  // Group tasks by role, preserving ROLE_ORDER.
  const byRole = {}
  for (const task of tasks) {
    if (!byRole[task.role]) byRole[task.role] = []
    byRole[task.role].push(task)
  }

  return (
    <div
      className={`flex min-h-screen w-full flex-col py-6 text-[#f0f0f5] ${PAGE_CONTAINER}`}
    >
      <BackLink />

      <div className="mt-6 mb-10">
        <h1 className="text-[clamp(22px,3vw,36px)] font-semibold leading-tight text-white">
          {drugName ? `${drugName} — Team workspace` : 'Team workspace'}
        </h1>
        <p className="mt-2 text-[15px] text-white/50">
          Prepare-stage tasks for your team. Check each off as it&rsquo;s
          completed.
        </p>
      </div>

      <div className="flex flex-col space-y-10">
        {ROLE_ORDER.filter((r) => byRole[r]).map((role) => (
          <RoleSection
            key={role}
            role={role}
            tasks={byRole[role]}
            onToggle={handleToggle}
          />
        ))}
        {ROLE_ORDER.every((r) => !byRole[r]) && (
          <p className="text-[15px] text-white/40">No tasks found.</p>
        )}
      </div>
    </div>
  )
}

export default TeamWorkspacePage

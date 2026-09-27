import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Panel from '../Panel/Panel.jsx'
import Table from '../Table/Table.jsx'
import Badge from '../Badge/Badge.jsx'
import Icon from '../Icon/Icon.jsx'
import Spinner from '../Spinner/Spinner.jsx'
import EmptyState from '../EmptyState/EmptyState.jsx'
import { fetchPins, pinDrug, unpinDrug } from '../../api/pins.js'
import { codeTimeline, daysLabel, formatDate } from '../../lib/format.js'
import { ROLES } from '../../lib/roles.js'
import styles from './DrugSearchGrid.module.css'

const API_URL = import.meta.env.VITE_API_URL

// Unauthenticated, cross-practice workspace views (see /api/workspaces/by-role/{role}),
// as opposed to 'tasks' which is the signed-in doctor's own practice.
const ROLE_VIEWS = ['nurse', 'biller', 'front_desk']

const WORKSPACE_STATUS = {
  considering: { label: 'Considering', tone: 'neutral' },
  holding: { label: 'Holding', tone: 'neutral' },
  adopting: { label: 'Setting up', tone: 'brand' },
  active: { label: 'Ready to treat', tone: 'success' },
}

function CodeCell({ drug }) {
  const { current } = codeTimeline(drug)
  if (!current.code) return <span className={styles.muted}>—</span>
  const permanent = current.type === 'permanent'
  return (
    <span className={styles.codeCell}>
      <Badge tone={permanent ? 'success' : 'warning'} mono>
        {current.code}
      </Badge>
      <span className={styles.muted}>{permanent ? 'Permanent' : 'Generic'}</span>
    </span>
  )
}

function CodeChangeCell({ drug }) {
  const { upcoming } = codeTimeline(drug)
  if (!upcoming) return <span className={styles.muted}>—</span>
  return (
    <span className={styles.codeCell}>
      <span>
        <span className="mono">{upcoming.code}</span> from {formatDate(upcoming.from)}
      </span>
      <Badge tone="brand">{daysLabel(upcoming.daysUntil)}</Badge>
    </span>
  )
}

function DrugsTable({ drugs, pinnedIds, pendingIds, onTogglePin }) {
  const navigate = useNavigate()
  const canPin = Boolean(pinnedIds)

  return (
    <Table>
      <thead>
        <tr>
          {canPin && (
            <th data-shrink>
              <span className="sr-only">Pinned</span>
            </th>
          )}
          <th>Drug</th>
          <th>Application</th>
          <th>Billing code</th>
          <th>Code change</th>
          <th>Route</th>
        </tr>
      </thead>
      <tbody>
        {drugs.map((drug) => {
          const pinned = Boolean(pinnedIds?.has(drug.application_id))
          const href = `/drugs/${encodeURIComponent(drug.application_id)}`
          return (
            <tr key={drug.application_id} data-clickable onClick={() => navigate(href)}>
              {canPin && (
                <td data-shrink>
                  <button
                    type="button"
                    className={`${styles.pin} ${pinned ? styles.pinned : ''}`}
                    aria-pressed={pinned}
                    aria-label={`${pinned ? 'Unpin' : 'Pin'} ${drug.brand_name}`}
                    title={pinned ? 'Unpin' : 'Pin to top'}
                    disabled={pendingIds.has(drug.application_id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin(drug.application_id)
                    }}
                  >
                    <Icon name="pin" filled={pinned} />
                  </button>
                </td>
              )}
              <td>
                <Link to={href} className={styles.primaryLink} onClick={(e) => e.stopPropagation()}>
                  {drug.brand_name}
                </Link>
                {drug.generic_name && <div className={styles.secondary}>{drug.generic_name}</div>}
              </td>
              <td data-mono>{drug.application_id}</td>
              <td>
                <CodeCell drug={drug} />
              </td>
              <td>
                <CodeChangeCell drug={drug} />
              </td>
              <td className={styles.route}>{drug.route_of_administration || <span className={styles.muted}>—</span>}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

function WorkspacesTable({ workspaces, basePath, showPractice }) {
  const navigate = useNavigate()

  return (
    <Table>
      <thead>
        <tr>
          <th>Drug</th>
          {showPractice && <th>Practice</th>}
          <th>Status</th>
          <th>Tasks</th>
          <th data-shrink>
            <span className="sr-only">Open</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {workspaces.map((ws) => {
          const href = `${basePath}/${ws.practice_drug_id}`
          const status = WORKSPACE_STATUS[ws.status]
          const pct = ws.tasks_total > 0 ? Math.round((ws.tasks_done / ws.tasks_total) * 100) : 0
          return (
            <tr key={ws.practice_drug_id} data-clickable onClick={() => navigate(href)}>
              <td>
                <Link to={href} className={styles.primaryLink} onClick={(e) => e.stopPropagation()}>
                  {ws.brand_name || 'Unknown drug'}
                </Link>
              </td>
              {showPractice && <td className={styles.secondaryCell}>{ws.practice_name || '—'}</td>}
              <td>{status ? <Badge tone={status.tone}>{status.label}</Badge> : <span className={styles.muted}>—</span>}</td>
              <td>
                <span className={styles.progress}>
                  <span className={styles.progressTrack} aria-hidden="true">
                    <span className={styles.progressFill} style={{ width: `${pct}%` }} />
                  </span>
                  <span className={styles.progressText}>
                    {ws.tasks_done} / {ws.tasks_total}
                  </span>
                </span>
              </td>
              <td data-shrink>
                <Icon name="arrowRight" className={styles.muted} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

// Fetches every drug (plus this practice's pins) once on mount and renders
// the set as a table, pinned ones first. When `view` is 'tasks' or a role
// view (nurse/biller/front_desk), fetches workspaces instead. The page
// around this (DoctorPage / StaffWorkspacesPage) owns the heading.
function DrugSearchGrid({ view = 'drugs', email = null }) {
  const [drugs, setDrugs] = useState([])
  const [drugsLoading, setDrugsLoading] = useState(true)
  // null = pins unavailable (e.g. signed in but sign-up not finished), so
  // the pin buttons are hidden rather than shown and failing on click.
  const [pinnedIds, setPinnedIds] = useState(null)
  const [pendingIds, setPendingIds] = useState(() => new Set())

  const [workspaces, setWorkspaces] = useState([])
  // Which view's workspaces are loaded, so switching views re-fetches the
  // right feed while revisiting the same one doesn't.
  const [workspacesFetchedFor, setWorkspacesFetchedFor] = useState(null)

  const isWorkspaceView = view === 'tasks' || ROLE_VIEWS.includes(view)

  useEffect(() => {
    if (isWorkspaceView) return
    let cancelled = false

    const drugsRequest = fetch(`${API_URL}/api/drugs/search`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const seen = new Set()
        return (Array.isArray(data) ? data : []).filter((drug) => {
          if (seen.has(drug.application_id)) return false
          seen.add(drug.application_id)
          return true
        })
      })
      .catch(() => [])
    const pinsRequest = fetchPins()
      .then((ids) => new Set(ids))
      .catch(() => null)

    // Wait for both so pinned rows don't jump to the top after first paint.
    Promise.all([drugsRequest, pinsRequest]).then(([drugList, pins]) => {
      if (cancelled) return
      setDrugs(drugList)
      setPinnedIds(pins)
      setDrugsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [isWorkspaceView])

  useEffect(() => {
    if (!isWorkspaceView || workspacesFetchedFor === view) return
    if (view === 'tasks' && !email) return

    let cancelled = false
    const url =
      view === 'tasks'
        ? `${API_URL}/api/practices/${encodeURIComponent(email)}/workspaces`
        : `${API_URL}/api/workspaces/by-role/${view}`

    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setWorkspaces(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([])
      })
      .finally(() => {
        if (!cancelled) setWorkspacesFetchedFor(view)
      })

    return () => {
      cancelled = true
    }
  }, [view, email, isWorkspaceView, workspacesFetchedFor])

  // The backend already sorts by brand name, so a stable partition keeps
  // both groups alphabetical.
  const sortedDrugs = useMemo(() => {
    if (!pinnedIds || pinnedIds.size === 0) return drugs
    return [
      ...drugs.filter((drug) => pinnedIds.has(drug.application_id)),
      ...drugs.filter((drug) => !pinnedIds.has(drug.application_id)),
    ]
  }, [drugs, pinnedIds])

  // Optimistic: flip the pin immediately, then revert if the request fails.
  // Clicks on a row with a request still in flight are ignored so two
  // opposite requests can't race each other.
  const togglePin = async (applicationId) => {
    if (pendingIds.has(applicationId)) return
    const wasPinned = pinnedIds.has(applicationId)
    const withPin = (pinned) => (set) => {
      const next = new Set(set)
      if (pinned) next.add(applicationId)
      else next.delete(applicationId)
      return next
    }

    setPinnedIds(withPin(!wasPinned))
    setPendingIds(withPin(true))
    try {
      await (wasPinned ? unpinDrug(applicationId) : pinDrug(applicationId))
    } catch {
      setPinnedIds(withPin(wasPinned))
    } finally {
      setPendingIds(withPin(false))
    }
  }

  if (isWorkspaceView) {
    const isLoading = workspacesFetchedFor !== view
    const basePath = view === 'tasks' ? '/doctor/workspace' : `/staff/${view}/workspace`
    const count = `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}`

    return (
      <Panel title={isLoading ? 'Workspaces' : count} flush>
        {isLoading && (
          <div className={styles.loading}>
            <Spinner label="Loading workspaces…" />
          </div>
        )}
        {!isLoading && workspaces.length === 0 && (
          <EmptyState
            title="No workspaces yet"
            description={
              view === 'tasks'
                ? 'Open a drug and choose “Get my team ready” to create one.'
                : `No practice has assigned ${ROLES[view]?.label ?? view} tasks yet.`
            }
          />
        )}
        {!isLoading && workspaces.length > 0 && (
          <WorkspacesTable workspaces={workspaces} basePath={basePath} showPractice={view !== 'tasks'} />
        )}
      </Panel>
    )
  }

  return (
    <Panel title={drugsLoading ? 'Drugs' : `${drugs.length} drug${drugs.length === 1 ? '' : 's'}`} flush>
      {drugsLoading && (
        <div className={styles.loading}>
          <Spinner label="Loading drugs…" />
        </div>
      )}
      {!drugsLoading && drugs.length === 0 && (
        <EmptyState title="No drugs yet" description="Drugs appear here once a drug maker adds them." />
      )}
      {!drugsLoading && drugs.length > 0 && (
        <DrugsTable drugs={sortedDrugs} pinnedIds={pinnedIds} pendingIds={pendingIds} onTogglePin={togglePin} />
      )}
    </Panel>
  )
}

export default DrugSearchGrid

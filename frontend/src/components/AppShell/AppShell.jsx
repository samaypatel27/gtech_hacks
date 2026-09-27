import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from '../Icon/Icon.jsx'
import AuthStatus from '../AuthStatus/AuthStatus.jsx'
import NotificationBell from '../NotificationBell/NotificationBell.jsx'
import Brand from '../Brand/Brand.jsx'
import { getCurrentPractice } from '../../lib/practiceSession.js'
import { ROLES, STAFF_ROLES } from '../../lib/roles.js'
import styles from './AppShell.module.css'

function isWorkspacesView(location) {
  return new URLSearchParams(location.search).get('view') === 'workspaces'
}

function navFor(role) {
  if (role === 'doctor') {
    return [
      {
        label: 'Drugs',
        icon: 'drugs',
        to: '/doctor/drugs',
        isActive: (loc) =>
          (loc.pathname === '/doctor/drugs' && !isWorkspacesView(loc)) || loc.pathname.startsWith('/drugs/'),
      },
      {
        label: 'Workspaces',
        icon: 'workspaces',
        to: '/doctor/drugs?view=workspaces',
        isActive: (loc) => isWorkspacesView(loc) || loc.pathname.startsWith('/doctor/workspace'),
      },
      {
        label: 'Patients',
        icon: 'patients',
        to: '/doctor/patients',
        isActive: (loc) => loc.pathname.startsWith('/doctor/patients'),
      },
    ]
  }
  if (STAFF_ROLES.includes(role)) {
    return [
      {
        label: 'Workspaces',
        icon: 'workspaces',
        to: `/staff/${role}`,
        isActive: (loc) => loc.pathname.startsWith(`/staff/${role}`),
      },
    ]
  }
  if (role === 'drug_maker') {
    return [{ label: 'Add drug', icon: 'plus', to: '/drug-maker', isActive: () => true }]
  }
  return []
}

function Breadcrumbs({ items }) {
  if (!items?.length) return null
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`}>
              {last || !item.to ? (
                <span aria-current={last ? 'page' : undefined} className={last ? styles.crumbCurrent : ''}>
                  {item.label}
                </span>
              ) : (
                <Link to={item.to}>{item.label}</Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// The frame around every signed-in / role page: a left sidebar with the
// product name, who you are and your sections, and a top bar with
// breadcrumbs and the user menu. Below 900px the sidebar becomes a drawer.
function AppShell({ role, breadcrumbs, children }) {
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const roleMeta = ROLES[role]
  const practice = role === 'doctor' ? getCurrentPractice() : null
  const nav = navFor(role)

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ''}`} aria-label="Primary">
        <div className={styles.brandRow}>
          <Brand />
          <button
            type="button"
            className={styles.drawerClose}
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" />
          </button>
        </div>

        {roleMeta && (
          <div className={styles.context}>
            <span className={styles.roleLine}>
              <span className={styles.roleDot} style={{ background: roleMeta.color }} aria-hidden="true" />
              {roleMeta.label}
            </span>
            {practice?.name && <span className={styles.practiceName}>{practice.name}</span>}
          </div>
        )}

        <nav className={styles.nav}>
          {nav.map((item) => {
            const active = item.isActive(location)
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setNavOpen(false)}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link to="/" className={styles.navItem} onClick={() => setNavOpen(false)}>
            <Icon name="switch" />
            Switch role
          </Link>
        </div>
      </aside>

      {navOpen && <div className={styles.scrim} onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className={styles.column}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>
          <Breadcrumbs items={breadcrumbs} />
          <div className={styles.topbarRight}>
            {role === 'doctor' && <NotificationBell />}
            {role === 'doctor' && <AuthStatus />}
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}

export default AppShell

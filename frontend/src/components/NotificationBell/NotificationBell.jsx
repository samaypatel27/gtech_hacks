import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../Icon/Icon.jsx'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../api/consider.js'
import { useAuthSession } from '../../lib/useAuthSession.js'
import { formatDate } from '../../lib/format.js'
import styles from './NotificationBell.module.css'

// How often the bell checks for new messages while the page is open.
const POLL_MS = 30000

// The doctor's notifications (new drug launches, billing-code changes, prior
// auth needed, ready to treat). Each one links to the page where the work
// happens; opening it marks it read. Hidden when signed out.
function NotificationBell() {
  const { email } = useAuthSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  const wrapRef = useRef(null)

  const load = useCallback(() => {
    fetchNotifications()
      .then((data) => {
        setItems(data.notifications)
        setUnread(data.unread_count)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!email) return
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [email, load])

  useEffect(() => {
    if (!open) return
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!email) return null

  const handleOpen = (item) => {
    setOpen(false)
    if (!item.read_at) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)))
      setUnread((n) => Math.max(0, n - 1))
      markNotificationRead(item.id).catch(load)
    }
    if (item.link) navigate(item.link)
  }

  const handleReadAll = () => {
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    setUnread(0)
    markAllNotificationsRead().catch(load)
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bell}
        onClick={() => {
          setOpen((o) => !o)
          if (!open) load()
        }}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon name="bell" />
        {unread > 0 && <span className={styles.count}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>Notifications</span>
            {unread > 0 && (
              <button type="button" className={styles.readAll} onClick={handleReadAll}>
                Mark all read
              </button>
            )}
          </div>
          {error && <p className={styles.empty}>Couldn't load notifications: {error}</p>}
          {!error && items.length === 0 && <p className={styles.empty}>Nothing new. New drugs and billing-code changes show up here.</p>}
          {items.length > 0 && (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`${styles.item} ${item.read_at ? '' : styles.unread}`.trim()}
                    onClick={() => handleOpen(item)}
                  >
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.body && <span className={styles.itemBody}>{item.body}</span>}
                    <span className={styles.itemDate}>{formatDate(item.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell

import { useEffect, useState } from 'react'
import { fetchCodeStatus } from '../../api/claims.js'
import styles from './CodeChangeNotice.module.css'

// The billing-code change banner for a drug's workspace (Switch): a countdown
// before the drug's code changes, and a "since <date>" note for a while after.
// Loading it is also what triggers the once-per-change reactions on the
// backend (flagging claims to recode, the biller's and doctor's cards), so it
// sits on every workspace view. Renders nothing when there's no change to show.
function CodeChangeNotice({ practiceDrugId }) {
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchCodeStatus(practiceDrugId)
      .then((data) => {
        if (!cancelled) setNotice(data)
      })
      .catch(() => {
        // A notice is extra context; the board works without it.
      })
    return () => {
      cancelled = true
    }
  }, [practiceDrugId])

  if (!notice || notice.state === 'none' || !notice.message) return null

  const upcoming = notice.state === 'upcoming'
  return (
    <div role="status" className={upcoming ? styles.notice : `${styles.notice} ${styles.switched}`}>
      <span className={styles.label}>
        {upcoming ? `Code change in ${notice.days_until_next} day${notice.days_until_next === 1 ? '' : 's'}` : 'Code changed'}
      </span>
      <p className={styles.message}>{notice.message}</p>
    </div>
  )
}

export default CodeChangeNotice

import { useEffect, useState } from 'react'
import { fetchCodeStatus } from '../../api/claims.js'
import Alert from '../Alert/Alert.jsx'

// The billing-code change banner for a drug's workspace (Switch): a countdown
// before the drug's code changes, and a "since <date>" note for a while after.
// Loading it is also what triggers the once-per-change reactions on the
// backend (flagging claims to recode, the biller's and doctor's cards), so it
// sits on every workspace view. Renders nothing when there's no change to show.
function CodeChangeNotice({ practiceDrugId, className = '' }) {
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
    <Alert
      tone={upcoming ? 'warning' : 'success'}
      title={upcoming ? `Code change in ${notice.days_until_next} day${notice.days_until_next === 1 ? '' : 's'}` : 'Code changed'}
      className={className}
    >
      {notice.message}
    </Alert>
  )
}

export default CodeChangeNotice

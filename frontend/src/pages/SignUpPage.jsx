import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import Button from '../components/Button/Button.jsx'
import AuthStatus from '../components/AuthStatus/AuthStatus.jsx'
import { fetchNpi, savePractice } from '../api/practices.js'
import { setCurrentPractice } from '../lib/practiceSession.js'
import { stashPendingSignUp } from '../lib/pendingSignUp.js'
import { signInWithGoogle } from '../lib/supabaseClient.js'
import { useAuthSession } from '../lib/useAuthSession.js'
import styles from './SignUpPage.module.css'

// The small set of payers this demo supports (real reference data would
// live in its own `payers` table -- kept as a flat list for now since
// there's no other payer-specific logic yet to justify the join).
const PAYER_OPTIONS = ['Medicare', 'Aetna', 'BCBS']

function SignUpPage() {
  const navigate = useNavigate()
  const [npi, setNpi] = useState('')
  const [lookup, setLookup] = useState(null)
  const [capabilities, setCapabilities] = useState({ infusion_chairs: false, refrigeration: false })
  const [payers, setPayers] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  // If someone arrives here via "Sign In -> no account found yet" (see
  // AuthCallbackPage.jsx), their email is already verified -- finishing
  // sign-up shouldn't send them through Google a second time.
  const { email: sessionEmail } = useAuthSession()

  const showLookupForm = status === 'idle' || status === 'looking-up' || status === 'error'
  const showConfirmForm = (status === 'found' || status === 'saving') && lookup

  const handleLookup = async (e) => {
    e.preventDefault()
    const trimmed = npi.trim()
    if (!trimmed) return

    setStatus('looking-up')
    setError('')
    try {
      const data = await fetchNpi(trimmed)
      setLookup(data)
      setStatus('found')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const togglePayer = (payer) => {
    setPayers((prev) => (prev.includes(payer) ? prev.filter((p) => p !== payer) : [...prev, payer]))
  }

  const practiceFields = () => ({
    npi: lookup.npi,
    name: lookup.name,
    specialty: lookup.specialty,
    state: lookup.state,
    medicare_contractor: lookup.medicare_contractor,
    capabilities,
    payers,
  })

  const handleConfirm = async () => {
    setStatus('saving')
    setError('')

    // Already signed in with Google (arrived via the sign-in path) --
    // finish saving directly, no OAuth redirect needed.
    if (sessionEmail) {
      try {
        const practice = await savePractice({ ...practiceFields(), email: sessionEmail })
        setCurrentPractice(practice)
        navigate('/doctor/drugs')
      } catch (err) {
        setError(err.message)
        setStatus('found')
      }
      return
    }

    // Not signed in yet -- stash this form's data and send them to Google.
    // AuthCallbackPage picks it back up once the email is verified.
    stashPendingSignUp(practiceFields())
    const { error: oauthError } = await signInWithGoogle()
    if (oauthError) {
      setError(oauthError.message)
      setStatus('found')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <BackButton to="/doctor" inline />
          <AuthStatus inline />
        </div>
        <div className={styles.panel}>
          <h1 className={styles.title}>Sign up with your NPI</h1>

        {showLookupForm && (
          <form className={styles.field} onSubmit={handleLookup}>
            <span className={styles.label}>NPI Number</span>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. 1881942746"
              value={npi}
              onChange={(e) => setNpi(e.target.value)}
            />
            <Button
              type="submit"
              className={styles.submitButton}
              disabled={!npi.trim() || status === 'looking-up'}
            >
              {status === 'looking-up' ? 'Looking up…' : 'Look up NPI'}
            </Button>
          </form>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {showConfirmForm && (
          <div className={styles.confirm}>
            <p className={styles.confirmName}>{lookup.name}</p>
            <p className={styles.confirmMeta}>{lookup.specialty || 'Specialty not on file'}</p>
            <p className={styles.confirmMeta}>{lookup.state}</p>
            <p className={styles.confirmMeta}>Medicare contractor: {lookup.medicare_contractor}</p>

            <div className={styles.group}>
              <span className={styles.label}>Capabilities</span>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={capabilities.infusion_chairs}
                  onChange={(e) =>
                    setCapabilities((c) => ({ ...c, infusion_chairs: e.target.checked }))
                  }
                />
                Infusion chairs
              </label>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={capabilities.refrigeration}
                  onChange={(e) =>
                    setCapabilities((c) => ({ ...c, refrigeration: e.target.checked }))
                  }
                />
                Refrigeration (2–8°C)
              </label>
            </div>

            <div className={styles.group}>
              <span className={styles.label}>Payers</span>
              {PAYER_OPTIONS.map((payer) => (
                <label key={payer} className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={payers.includes(payer)}
                    onChange={() => togglePayer(payer)}
                  />
                  {payer}
                </label>
              ))}
            </div>

            <Button className={styles.submitButton} onClick={handleConfirm} disabled={status === 'saving'}>
              {status === 'saving'
                ? 'Saving…'
                : sessionEmail
                  ? 'Finish sign up'
                  : 'Complete with Google'}
            </Button>
          </div>
        )}
      </div>
    </div>
  </div>
)
}

export default SignUpPage

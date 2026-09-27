import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout/AuthLayout.jsx'
import Button from '../components/Button/Button.jsx'
import Alert from '../components/Alert/Alert.jsx'
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
    <AuthLayout
      backTo="/doctor"
      backLabel="Sign in instead"
      width={480}
      title="Create practice account"
      description={showConfirmForm ? 'Step 2 of 2 · Confirm your practice' : 'Step 1 of 2 · Verify your NPI'}
    >
      {sessionEmail && (
        <p className={styles.signedIn}>
          Signed in as <strong>{sessionEmail}</strong>
        </p>
      )}

      {showLookupForm && (
        <form className={styles.form} onSubmit={handleLookup}>
          <label className={styles.field}>
            <span className={styles.label}>NPI number</span>
            <input
              type="text"
              inputMode="numeric"
              className="mono"
              placeholder="10 digits, e.g. 1881942746"
              value={npi}
              onChange={(e) => setNpi(e.target.value)}
            />
            <span className={styles.help}>We look it up in the national NPPES registry.</span>
          </label>
          <Button
            type="submit"
            variant="primary"
            className={styles.full}
            disabled={!npi.trim() || status === 'looking-up'}
          >
            {status === 'looking-up' ? 'Looking up…' : 'Look up NPI'}
          </Button>
        </form>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {showConfirmForm && (
        <div className={styles.form}>
          <dl className={styles.details}>
            <div>
              <dt>Practice</dt>
              <dd>{lookup.name}</dd>
            </div>
            <div>
              <dt>NPI</dt>
              <dd className="mono">{lookup.npi}</dd>
            </div>
            <div>
              <dt>Specialty</dt>
              <dd>{lookup.specialty || 'Not on file'}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{lookup.state}</dd>
            </div>
            <div>
              <dt>Medicare contractor</dt>
              <dd>{lookup.medicare_contractor}</dd>
            </div>
          </dl>

          <fieldset className={styles.group}>
            <legend className={styles.label}>Capabilities</legend>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={capabilities.infusion_chairs}
                onChange={(e) => setCapabilities((c) => ({ ...c, infusion_chairs: e.target.checked }))}
              />
              Infusion chairs
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={capabilities.refrigeration}
                onChange={(e) => setCapabilities((c) => ({ ...c, refrigeration: e.target.checked }))}
              />
              Refrigeration (2–8°C)
            </label>
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={styles.label}>Payers you bill</legend>
            {PAYER_OPTIONS.map((payer) => (
              <label key={payer} className={styles.checkboxRow}>
                <input type="checkbox" checked={payers.includes(payer)} onChange={() => togglePayer(payer)} />
                {payer}
              </label>
            ))}
          </fieldset>

          <Button variant="primary" className={styles.full} onClick={handleConfirm} disabled={status === 'saving'}>
            {status === 'saving' ? 'Saving…' : sessionEmail ? 'Finish sign up' : 'Continue with Google'}
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}

export default SignUpPage

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import { signInWithGoogle } from '../lib/supabaseClient.js'
import { useAuthSession } from '../lib/useAuthSession.js'
import styles from './DoctorChoicePage.module.css'

// Gate for the Doctor role, not a neutral landing page: already signed in
// (a session token is present) -> skip straight to the dashboard. Not
// signed in -> Sign In or Sign Up are the only two entry points. There is
// no anonymous "browse without an account" option.
function DoctorChoicePage() {
  const navigate = useNavigate()
  const { email, loading } = useAuthSession()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && email) navigate('/doctor/drugs', { replace: true })
  }, [loading, email, navigate])

  const handleSignIn = async () => {
    setIsSigningIn(true)
    setError('')
    const { error: oauthError } = await signInWithGoogle()
    if (oauthError) {
      setError(oauthError.message)
      setIsSigningIn(false)
    }
    // On success the browser navigates away to Google, so nothing else to do here.
  }

  // Loading (session not yet known) or already signed in (redirect effect
  // above is about to fire) -- render nothing rather than flash the cards.
  if (loading || email) return null

  return (
    <div className={styles.page}>
      <BackButton />
      <h1 className={styles.title}>Doctor sign-in</h1>
      <div className={styles.cards}>
        <button
          type="button"
          className={styles.card}
          onClick={handleSignIn}
          disabled={isSigningIn}
        >
          <span className={styles.cardTitle}>{isSigningIn ? 'Redirecting…' : 'Sign In'}</span>
          <span className={styles.cardBody}>Already registered? Continue with Google.</span>
        </button>
        <button type="button" className={styles.card} onClick={() => navigate('/sign-up')}>
          <span className={styles.cardTitle}>Sign Up</span>
          <span className={styles.cardBody}>New practice? Verify your NPI to get started.</span>
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

export default DoctorChoicePage

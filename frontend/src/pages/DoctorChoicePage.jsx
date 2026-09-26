import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import Button from '../components/Button/Button.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { clearCurrentPractice } from '../lib/practiceSession.js'
import styles from './DoctorChoicePage.module.css'

// Landing page for the Doctor role: browse drugs directly, sign up with an
// NPI (Phase 2 -- personalizes the Considering page), or sign in directly
// with Google if already registered.
function DoctorChoicePage() {
  const navigate = useNavigate()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState('')
  const [signedInEmail, setSignedInEmail] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedInEmail(data.session?.user?.email ?? null)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user?.email ?? null)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  const handleSignIn = async () => {
    setIsSigningIn(true)
    setError('')
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (oauthError) {
      setError(oauthError.message)
      setIsSigningIn(false)
    }
    // On success the browser navigates away to Google, so nothing else to do here.
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    clearCurrentPractice()
  }

  return (
    <div className={styles.page}>
      <BackButton />
      <div className={styles.choices}>
        <Button onClick={() => navigate('/doctor/drugs')}>View Drugs</Button>
        <Button onClick={() => navigate('/sign-up')}>Sign Up</Button>
        <Button onClick={handleSignIn} disabled={isSigningIn}>
          {isSigningIn ? 'Redirecting…' : 'Sign In'}
        </Button>
      </div>

      {signedInEmail && (
        <p className={styles.session}>
          Signed in with Google as {signedInEmail} —{' '}
          <button type="button" className={styles.signOutLink} onClick={handleSignOut}>
            sign out
          </button>
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}

export default DoctorChoicePage

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout/AuthLayout.jsx'
import Button from '../components/Button/Button.jsx'
import Alert from '../components/Alert/Alert.jsx'
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
  // above is about to fire) -- render nothing rather than flash the form.
  if (loading || email) return null

  return (
    <AuthLayout
      backTo="/"
      backLabel="All roles"
      title="Sign in to your practice"
      description="Doctors sign in with the Google account registered to their practice."
    >
      <div className={styles.actions}>
        <Button variant="primary" onClick={handleSignIn} disabled={isSigningIn} className={styles.full}>
          {isSigningIn ? 'Redirecting to Google…' : 'Continue with Google'}
        </Button>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>

      <div className={styles.divider} />

      <div className={styles.signUp}>
        <p className={styles.signUpText}>New practice? Verify your NPI to create an account.</p>
        <Button variant="secondary" to="/sign-up" className={styles.full}>
          Create practice account
        </Button>
      </div>
    </AuthLayout>
  )
}

export default DoctorChoicePage

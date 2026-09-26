import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../Button/Button.jsx'
import { supabase, signInWithGoogle } from '../../lib/supabaseClient.js'
import { clearCurrentPractice } from '../../lib/practiceSession.js'
import { useAuthSession } from '../../lib/useAuthSession.js'
import styles from './AuthStatus.module.css'

// Pinned to the top-right of every doctor-facing page so sign-in state is
// always visible. Fully self-contained (no props, owns its own state) so
// "signed in" and "signed out" can never both render at once -- it's a
// single if/else branch in one place rather than a rule each page has to
// separately maintain.
function AuthStatus() {
  const navigate = useNavigate()
  const { email, loading } = useAuthSession()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState('')

  if (loading) return null

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

  const handleSignOut = async () => {
    setIsSigningOut(true)
    await supabase.auth.signOut()
    clearCurrentPractice()
    navigate('/doctor')
  }

  return (
    <div className={styles.wrap}>
      {email ? (
        <>
          <span className={styles.email} title={email}>
            {email}
          </span>
          <Button onClick={handleSignOut} disabled={isSigningOut}>
            {isSigningOut ? 'Signing out…' : 'Sign Out'}
          </Button>
        </>
      ) : (
        <Button onClick={handleSignIn} disabled={isSigningIn}>
          {isSigningIn ? 'Redirecting…' : 'Sign In'}
        </Button>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}

export default AuthStatus

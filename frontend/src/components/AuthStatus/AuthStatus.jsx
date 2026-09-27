import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../Button/Button.jsx'
import { supabase, signInWithGoogle } from '../../lib/supabaseClient.js'
import { clearCurrentPractice } from '../../lib/practiceSession.js'
import { useAuthSession } from '../../lib/useAuthSession.js'
import styles from './AuthStatus.module.css'

// The user menu in the app shell's top bar. Self-contained (owns its own
// session state) so "signed in" and "signed out" can never both render.
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
      {error && <span className={styles.error}>{error}</span>}
      {email ? (
        <>
          <span className={styles.avatar} aria-hidden="true">
            {email.charAt(0).toUpperCase()}
          </span>
          <span className={styles.email} title={email}>
            {email}
          </span>
          <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" onClick={handleSignIn} disabled={isSigningIn}>
          {isSigningIn ? 'Redirecting…' : 'Sign in'}
        </Button>
      )}
    </div>
  )
}

export default AuthStatus

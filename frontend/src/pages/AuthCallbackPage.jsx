import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { fetchPracticeByEmail, savePractice } from '../api/practices.js'
import { setCurrentPractice } from '../lib/practiceSession.js'
import { takePendingSignUp } from '../lib/pendingSignUp.js'
import styles from './AuthCallbackPage.module.css'

// Where Google sends the browser back to after Supabase completes the
// OAuth exchange. Two cases, distinguished by whether a sign-up was in
// progress (see pendingSignUp.js):
//   - Pending sign-up data exists -> this was "Complete with Google" from
//     SignUpPage; finish creating the practice now that we have a real
//     verified email, then go straight into the app.
//   - No pending data -> this was a plain "Sign In"; look the email up.
//     Found -> log in. Not found -> send them to finish signing up (their
//     email is already verified, SignUpPage will skip the Google step).
function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) {
        setError('Google sign-in did not complete. Please try again.')
        return
      }

      const email = data.session.user.email
      const pending = takePendingSignUp()

      try {
        if (pending) {
          const practice = await savePractice({ ...pending, email })
          setCurrentPractice(practice)
          navigate('/doctor/drugs')
          return
        }

        const practice = await fetchPracticeByEmail(email)
        if (practice) {
          setCurrentPractice(practice)
          navigate('/doctor/drugs')
        } else {
          navigate('/sign-up')
        }
      } catch (err) {
        setError(err.message)
      }
    }

    run()
  }, [navigate])

  return (
    <div className={styles.page}>
      {error ? <p className={styles.error}>{error}</p> : <p className={styles.status}>Signing you in…</p>}
    </div>
  )
}

export default AuthCallbackPage

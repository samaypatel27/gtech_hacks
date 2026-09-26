import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

// Single source of truth for "am I signed in" -- wraps the initial session
// read plus live updates so every consumer sees the same state instead of
// each page running its own getSession()/onAuthStateChange pair.
export function useAuthSession() {
  const [email, setEmail] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null)
      setLoading(false)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  return { email, loading }
}

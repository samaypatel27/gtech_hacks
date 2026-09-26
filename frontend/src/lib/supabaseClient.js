import { createClient } from '@supabase/supabase-js'

// Used only for Google sign-in (Supabase Auth). All app data still goes
// through the FastAPI backend with its service-role key -- this client
// only ever sees the public/publishable key and the auth session.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

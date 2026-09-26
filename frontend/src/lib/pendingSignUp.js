// Sign-up collects the NPI lookup result + capabilities/payers *before*
// the Google redirect, but the whole page navigates away to Google and
// back -- so that in-progress data has to survive the round trip somehow.
// sessionStorage (not localStorage) is deliberate: this is scoped to one
// sign-up attempt, not something that should linger across visits.
const STORAGE_KEY = 'launchready_pending_signup'

export function stashPendingSignUp(data) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Private browsing / storage disabled -- the post-redirect step will
    // just fail to find pending data and fall back to the sign-in path.
  }
}

export function takePendingSignUp() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Real identity now comes from Supabase Auth (Google sign-in) -- this is
// just a local cache of the *practice profile* for that signed-in email,
// so pages can personalize without re-fetching it from the backend on
// every render. See pendingSignUp.js for the separate stash used to carry
// in-progress sign-up form data across the Google OAuth redirect.
const STORAGE_KEY = 'launchready_practice'

export function getCurrentPractice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setCurrentPractice(practice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(practice))
  } catch {
    // Private browsing / storage disabled -- personalization just won't persist.
  }
}

export function clearCurrentPractice() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

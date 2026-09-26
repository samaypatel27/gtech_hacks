// No real auth yet -- the signed-up practice is remembered in this browser
// only, so the doctor's pages can personalize without a login system.
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

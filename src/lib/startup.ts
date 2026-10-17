export type StartupPage = 'last-session' | 'new-session'

const STARTUP_PAGE_KEY = 'oc-startup-page'
const LAST_SESSION_KEY = 'oc-last-session'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The app still works when browser storage is unavailable.
  }
}

export function getStartupPage(): StartupPage {
  return read(STARTUP_PAGE_KEY) === 'new-session'
    ? 'new-session'
    : 'last-session'
}

export function setStartupPage(page: StartupPage) {
  write(STARTUP_PAGE_KEY, page)
}

export function rememberSession(sessionId: string) {
  write(LAST_SESSION_KEY, sessionId)
}

export function startupSession(pathname: string, search: string): string | null {
  // Preserve deep links and explicit project selections.
  if (pathname !== '/' || search || getStartupPage() === 'new-session') {
    return null
  }
  return read(LAST_SESSION_KEY) || null
}

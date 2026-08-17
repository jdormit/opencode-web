import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AUTH_COOKIE,
  DEFAULT_SERVER_URL,
  SERVER_URL_COOKIE,
  THEME_STORAGE_KEY,
  encodeBasicAuth,
  normalizeServerUrl,
  readClientCookie,
  writeClientCookie,
} from '~/lib/settings'
import { ArrowLeftIcon } from '~/components/icons'
import styles from './settings.module.css'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

type Theme = 'system' | 'light' | 'dark'
type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok' }
  | { state: 'error'; message: string }

function SettingsPage() {
  const [url, setUrl] = React.useState('')
  const [username, setUsername] = React.useState('opencode')
  const [password, setPassword] = React.useState('')
  const [hasSavedAuth, setHasSavedAuth] = React.useState(false)
  const [theme, setTheme] = React.useState<Theme>('system')
  const [test, setTest] = React.useState<TestState>({ state: 'idle' })

  React.useEffect(() => {
    setUrl(readClientCookie(SERVER_URL_COOKIE) ?? DEFAULT_SERVER_URL)
    setHasSavedAuth(!!readClientCookie(AUTH_COOKIE))
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme)
  }, [])

  const applyTheme = (next: Theme) => {
    setTheme(next)
    if (next === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
      delete document.documentElement.dataset.theme
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
      document.documentElement.dataset.theme = next
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeServerUrl(url)
    writeClientCookie(SERVER_URL_COOKIE, normalized)
    // Leave a previously saved password alone unless a new one was entered.
    if (password) {
      writeClientCookie(
        AUTH_COOKIE,
        encodeBasicAuth(username || 'opencode', password),
      )
      setHasSavedAuth(true)
    }
    setUrl(normalized)

    setTest({ state: 'testing' })
    try {
      const res = await fetch('/api/proxy/project')
      if (!res.ok) {
        const body = await res.json().catch(() => undefined)
        throw new Error(
          body?.message ?? `Server responded with ${res.status}`,
        )
      }
      setTest({ state: 'ok' })
      // Reload so SSR, queries, and the event stream pick up the new server.
      setTimeout(() => {
        window.location.href = '/'
      }, 600)
    } catch (err) {
      setTest({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back} aria-label="Back">
          <ArrowLeftIcon size={18} />
        </Link>
        <h1 className={styles.heading}>Settings</h1>
        <span className={styles.spacer} />
      </header>

      <form className={styles.form} onSubmit={handleSave}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>OpenCode server</h2>
          <label className={styles.field}>
            <span className={styles.label}>Server URL</span>
            <input
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={DEFAULT_SERVER_URL}
            />
            <span className={styles.help}>
              Where <code>opencode serve</code> is running. The default port is
              4096.
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Password (optional)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                hasSavedAuth
                  ? 'Saved — enter a new one to replace it'
                  : 'Leave empty if the server has no password'
              }
            />
            <span className={styles.help}>
              Only needed when the server sets{' '}
              <code>OPENCODE_SERVER_PASSWORD</code>.
            </span>
            {hasSavedAuth && !password && (
              <button
                type="button"
                className={styles.clearAuth}
                onClick={() => {
                  writeClientCookie(AUTH_COOKIE, undefined)
                  setHasSavedAuth(false)
                }}
              >
                Remove saved password
              </button>
            )}
          </label>
          {password && (
            <label className={styles.field}>
              <span className={styles.label}>Username</span>
              <input
                type="text"
                autoCapitalize="off"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.themeRow}>
            {(['system', 'light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={
                  theme === option ? styles.themeActive : styles.themeOption
                }
                onClick={() => applyTheme(option)}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <button
          type="submit"
          className={styles.save}
          disabled={test.state === 'testing'}
        >
          {test.state === 'testing' ? 'Connecting…' : 'Save & connect'}
        </button>

        {test.state === 'ok' && (
          <p className={styles.ok}>Connected. Taking you home…</p>
        )}
        {test.state === 'error' && (
          <p className={styles.error}>
            Saved, but the server isn't reachable: {test.message}
          </p>
        )}
      </form>
    </div>
  )
}

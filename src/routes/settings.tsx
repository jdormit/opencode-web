import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from '~/components/icons'
import { ProviderSettings } from '~/components/ProviderSettings'
import { getStartupPage, setStartupPage, type StartupPage } from '~/lib/startup'
import styles from './settings.module.css'

export const Route = createFileRoute('/settings')({ component: SettingsPage })
type Theme = 'system' | 'light' | 'dark'
function SettingsPage() {
  const [theme, setTheme] = React.useState<Theme>('system')
  const [startupPage, updateStartupPage] =
    React.useState<StartupPage>('last-session')
  React.useEffect(() => {
    updateStartupPage(getStartupPage())
    const saved = window.localStorage.getItem('oc-theme')
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])
  const applyTheme = (next: Theme) => {
    setTheme(next)
    if (next === 'system') {
      window.localStorage.removeItem('oc-theme')
      delete document.documentElement.dataset.theme
    } else {
      window.localStorage.setItem('oc-theme', next)
      document.documentElement.dataset.theme = next
    }
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back} aria-label="Back">
          <ArrowLeftIcon size={18} />
        </Link>
        <h1 className={styles.heading}>Settings</h1>
        <div className={styles.spacer} aria-hidden="true" />
      </header>
      <div className={styles.form}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Open app to</h2>
          <div className={styles.themeRow}>
            {([
              ['last-session', 'Last visited session'],
              ['new-session', 'New session'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  startupPage === value ? styles.themeActive : styles.themeOption
                }
                aria-pressed={startupPage === value}
                onClick={() => {
                  updateStartupPage(value)
                  setStartupPage(value)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={styles.help}>
            Applies when you launch the app. If the last session is unavailable,
            a new session opens.
          </p>
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
                aria-pressed={theme === option}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Providers</h2>
          <ProviderSettings />
        </section>
      </div>
    </div>
  )
}

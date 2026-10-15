import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from '~/components/icons'
import styles from './settings.module.css'

export const Route = createFileRoute('/settings')({ component: SettingsPage })
type Theme = 'system' | 'light' | 'dark'
function SettingsPage() {
  const [theme, setTheme] = React.useState<Theme>('system')
  React.useEffect(() => {
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
      </header>
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
    </div>
  )
}

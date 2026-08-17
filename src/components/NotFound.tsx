import { Link } from '@tanstack/react-router'
import styles from './boundary.module.css'

export function NotFound({ children }: { children?: React.ReactNode }) {
  return (
    <div className={styles.wrap}>
      <p className={styles.muted}>
        {children ?? "This page doesn't exist."}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => window.history.back()}
        >
          Go back
        </button>
        <Link to="/" className={styles.button}>
          Home
        </Link>
      </div>
    </div>
  )
}

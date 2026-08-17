import {
  ErrorComponent,
  Link,
  rootRouteId,
  useMatch,
  useRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import styles from './boundary.module.css'

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  })

  console.error(error)

  return (
    <div className={styles.wrap}>
      <ErrorComponent error={error} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            void router.invalidate()
          }}
        >
          Try again
        </button>
        {isRoot ? (
          <Link to="/" className={styles.button}>
            Home
          </Link>
        ) : (
          <Link
            to="/"
            className={styles.button}
            onClick={(e) => {
              e.preventDefault()
              window.history.back()
            }}
          >
            Go back
          </Link>
        )}
      </div>
    </div>
  )
}

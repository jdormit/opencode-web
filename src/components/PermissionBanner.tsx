import { useQueries, useQueryClient } from '@tanstack/react-query'
import { permissionsQuery, respondPermission } from '~/lib/oc'
import type { PendingPermission } from '~/lib/oc'
import styles from './PermissionBanner.module.css'

export function PermissionBanner({
  sessionIds,
  directory,
}: {
  sessionIds: Array<string>
  directory: string
}) {
  const queryClient = useQueryClient()
  const [error, setError] = React.useState<string>()
  const [sending, setSending] = React.useState(false)
  const permissionQueries = useQueries({
    queries: sessionIds.map((sessionId) =>
      permissionsQuery(sessionId, directory),
    ),
  })

  const permission = permissionQueries.flatMap((query) => query.data ?? [])[0]
  if (!permission) return null

  const respond = async (response: 'once' | 'always' | 'reject') => {
    if (sending) return
    setSending(true)
    setError(undefined)
    try {
      await respondPermission(
        permission.sessionID,
        directory,
        permission.id,
        response,
      )
      queryClient.setQueryData<Array<PendingPermission>>(
        ['permissions', permission.sessionID],
        (prev) => prev?.filter((p) => p.id !== permission.id),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <span className={styles.label}>Permission requested</span>
        <span className={styles.title}>{permission.action}</span>
        {typeof permission.metadata?.command === 'string' && (
          <code className={styles.command}>{permission.metadata.command}</code>
        )}
        {typeof permission.metadata?.command !== 'string' &&
          permission.resources.map((pattern) => (
            <code key={pattern} className={styles.command}>
              {pattern}
            </code>
          ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.deny}
          disabled={sending}
          onClick={() => void respond('reject')}
        >
          Deny
        </button>
        <button
          type="button"
          className={styles.allow}
          disabled={sending}
          onClick={() => void respond('once')}
        >
          Allow once
        </button>
        <button
          type="button"
          className={styles.allowAlways}
          disabled={sending || !permission.save?.length}
          onClick={() => void respond('always')}
        >
          Always
        </button>
      </div>
    </div>
  )
}
import * as React from 'react'

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
  const permissionQueries = useQueries({
    queries: sessionIds.map((sessionId) =>
      permissionsQuery(sessionId, directory),
    ),
  })

  const permission = permissionQueries.flatMap((query) => query.data ?? [])[0]
  if (!permission) return null

  const respond = async (response: 'once' | 'always' | 'reject') => {
    queryClient.setQueryData<Array<PendingPermission>>(
      ['permissions', permission.sessionID],
      (prev) => prev?.filter((p) => p.id !== permission.id),
    )
    try {
      await respondPermission(
        permission.sessionID,
        directory,
        permission.id,
        response,
      )
    } catch (err) {
      console.error('Failed to respond to permission', err)
    }
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <span className={styles.label}>Permission requested</span>
        <span className={styles.title}>
          {permission.title ?? permission.permission ?? 'Permission request'}
        </span>
        {typeof permission.metadata?.command === 'string' && (
          <code className={styles.command}>
            {permission.metadata.command}
          </code>
        )}
        {typeof permission.metadata?.command !== 'string' &&
          permission.patterns?.map((pattern) => (
            <code key={pattern} className={styles.command}>
              {pattern}
            </code>
          ))}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.deny}
          onClick={() => void respond('reject')}
        >
          Deny
        </button>
        <button
          type="button"
          className={styles.allow}
          onClick={() => void respond('once')}
        >
          Allow once
        </button>
        <button
          type="button"
          className={styles.allowAlways}
          onClick={() => void respond('always')}
        >
          Always
        </button>
      </div>
    </div>
  )
}

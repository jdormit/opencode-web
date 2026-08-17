import { useQuery, useQueryClient } from '@tanstack/react-query'
import { respondPermission } from '~/lib/oc'
import type { Permission } from '~/lib/oc'
import styles from './PermissionBanner.module.css'

export function PermissionBanner({
  sessionId,
  directory,
}: {
  sessionId: string
  directory: string
}) {
  const queryClient = useQueryClient()
  const { data: permissions } = useQuery<Array<Permission>>({
    queryKey: ['permissions', sessionId],
    queryFn: () => [],
    initialData: [],
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const permission = permissions[0]
  if (!permission) return null

  const respond = async (response: 'once' | 'always' | 'reject') => {
    queryClient.setQueryData<Array<Permission>>(
      ['permissions', sessionId],
      (prev) => prev?.filter((p) => p.id !== permission.id),
    )
    try {
      await respondPermission(sessionId, directory, permission.id, response)
    } catch (err) {
      console.error('Failed to respond to permission', err)
    }
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <span className={styles.label}>Permission requested</span>
        <span className={styles.title}>{permission.title}</span>
        {typeof permission.metadata?.command === 'string' && (
          <code className={styles.command}>
            {permission.metadata.command}
          </code>
        )}
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

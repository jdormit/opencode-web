import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  directoryQuery,
  openProject,
  projectsQuery,
  serverPathQuery,
} from '~/lib/oc'
import type { Project } from '~/lib/oc'
import { normalizeDirectory, parentDirectory } from '~/lib/directory'
import { Sheet } from './Sheet'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
} from './icons'
import styles from './OpenProjectSheet.module.css'

export function OpenProjectSheet({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (project: Project, directory: string) => void
}) {
  const queryClient = useQueryClient()
  const serverPath = useQuery({ ...serverPathQuery(), enabled: open })
  const home = serverPath.data?.home ?? serverPath.data?.directory ?? '/'
  const [directory, setDirectory] = React.useState('')
  const [draft, setDraft] = React.useState('')
  const [pathError, setPathError] = React.useState<string>()
  const [openError, setOpenError] = React.useState<string>()
  const [opening, setOpening] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setDirectory('')
      setDraft('')
      setPathError(undefined)
      setOpenError(undefined)
      return
    }
    if (!directory && serverPath.data) {
      setDirectory(home)
      setDraft(home)
    }
  }, [directory, home, open, serverPath.data])

  const entries = useQuery({
    ...directoryQuery(directory),
    enabled: open && !!directory,
  })

  const navigate = (next: string) => {
    setDirectory(next)
    setDraft(next)
    setPathError(undefined)
    setOpenError(undefined)
  }

  const navigateToDraft = () => {
    const next = normalizeDirectory(draft, home)
    if (!next) {
      setPathError('Enter an absolute path, such as /home/user/project.')
      return
    }
    navigate(next)
  }

  const handleOpen = async () => {
    if (!directory || !entries.isSuccess) return
    setOpening(true)
    setOpenError(undefined)
    try {
      const project = await openProject(directory)
      queryClient.setQueryData<Array<Project>>(
        projectsQuery().queryKey,
        (projects) => {
          const index = projects?.findIndex(
            (item) =>
              item.id === project.id || item.worktree === project.worktree,
          )
          if (index === undefined || index < 0) {
            return [...(projects ?? []), project]
          }
          const next = [...(projects ?? [])]
          next[index] = project
          return next
        },
      )
      onSelect(project, directory)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpening(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Open project">
      <div className={styles.browser}>
        <form
          className={styles.pathForm}
          onSubmit={(event) => {
            event.preventDefault()
            navigateToDraft()
          }}
        >
          <input
            className={styles.pathInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="/path/to/project"
            aria-label="Directory path"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className={styles.goButton}>
            Go
          </button>
        </form>

        <div className={styles.navigation}>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => navigate(parentDirectory(directory || home))}
            aria-label="Parent directory"
          >
            <ArrowLeftIcon size={16} />
            Parent
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => navigate(home)}
            aria-label="Home directory"
          >
            ~ Home
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => navigate('/')}
            aria-label="Filesystem root"
          >
            / Root
          </button>
        </div>

        {(pathError || openError) && (
          <p className={styles.error}>{pathError ?? openError}</p>
        )}

        <div className={styles.list} aria-live="polite">
          {(serverPath.isPending || entries.isPending) && (
            <p className={styles.state}>Loading folders…</p>
          )}
          {(serverPath.isError || entries.isError) && (
            <p className={styles.state}>
              This directory could not be opened. Check the path and server
              permissions.
            </p>
          )}
          {entries.isSuccess && entries.data.length === 0 && (
            <p className={styles.state}>This directory has no subfolders.</p>
          )}
          {entries.data?.map((entry) => (
            <button
              type="button"
              className={styles.folder}
              key={entry.absolute}
              onClick={() => navigate(entry.absolute)}
            >
              <FolderIcon size={18} className={styles.folderIcon} />
              <span>{entry.name}</span>
              <ChevronRightIcon size={16} className={styles.chevron} />
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.current} title={directory}>
            {directory || 'Loading…'}
          </span>
          <button
            type="button"
            className={styles.openButton}
            onClick={() => void handleOpen()}
            disabled={!entries.isSuccess || opening}
          >
            {opening ? 'Opening…' : 'Open this folder'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

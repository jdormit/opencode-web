import * as React from 'react'
import { Drawer } from 'vaul'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  abortSession,
  client,
  commandsQuery,
  deleteSession,
  forkSession,
  messagesQuery,
  projectName,
  projectsQuery,
  promptSession,
  renameSession,
  revertSession,
  selectSession,
  sendCommand,
  sessionDescendantIdsQuery,
  sessionQuery,
  sessionStatusQuery,
  skillsQuery,
  summarizeSession,
  unrevertSession,
} from '~/lib/oc'
import type { Message, Session } from '~/lib/oc'
import type { MessageAttachment } from '~/lib/attachments'
import {
  commandSlashItems,
  parseCommandInput,
  sessionBuiltins,
  sessionExportFilename,
} from '~/lib/commands'
import type { ModelRef } from '~/lib/model-usage'
import { recordModelUse } from '~/lib/model-usage'
import { Composer, type ComposerHandle } from '~/components/Composer'
import {
  MessageView,
  endsAssistantTurn,
  forkPoint,
  taskChildSessionIds,
} from '~/components/MessageView'
import { ConfirmDialog, PromptDialog } from '~/components/Dialog'
import { PermissionBanner } from '~/components/PermissionBanner'
import { QuestionSheet } from '~/components/QuestionSheet'
import { useShell } from '~/components/shell'
import { useSessionDiff } from '~/lib/session-diff-client'
import SessionDiffPanel from '~/components/SessionDiffPanel'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  DiffIcon,
  MenuIcon,
  PencilIcon,
  TrashIcon,
} from '~/components/icons'
import styles from './session.module.css'

export const Route = createFileRoute('/session/$sessionId')({
  loader: async ({ context, params }) => {
    try {
      const session = await context.queryClient.ensureQueryData(
        sessionQuery(params.sessionId),
      )
      await context.queryClient.ensureQueryData(
        messagesQuery(session.id, session.directory),
      )
    } catch {}
  },
  component: SessionPage,
})

function SessionPage() {
  const { sessionId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { openDrawer } = useShell()
  const sessionQ = useQuery(sessionQuery(sessionId))
  const session = sessionQ.data
  const directory = session?.directory ?? ''
  const projects = useQuery(projectsQuery())
  const project = projects.data?.find((p) => p.id === session?.projectID)
  const messages = useQuery({
    ...messagesQuery(sessionId, directory),
    enabled: !!session,
  })
  const commands = useQuery(commandsQuery(directory))
  const skills = useQuery(skillsQuery(directory))
  const status = useQuery(sessionStatusQuery())
  const busy = status.data?.[sessionId]?.type === 'busy'
  const descendants = useQuery({
    ...sessionDescendantIdsQuery(sessionId, directory),
    enabled: !!session && !session.parentID,
  })
  const requestIds = [
    ...new Set([
      sessionId,
      ...(descendants.data ?? []),
      ...taskChildSessionIds(messages.data ?? []),
    ]),
  ]
  const boundary = session?.revert?.messageID
  const visible = (messages.data ?? []).filter(
    (m) => !boundary || m.id < boundary,
  )
  const modelRef: ModelRef | undefined = session?.model
    ? {
        providerID: session.model.providerID,
        modelID: session.model.id,
        variant: session.model.variant,
      }
    : undefined
  const [error, setError] = React.useState<string>()
  const [notice, setNotice] = React.useState<string>()
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [forkPending, setForkPending] = React.useState(false)
  const forkLock = React.useRef(false)
  const composer = React.useRef<ComposerHandle>(null)
  const scroll = React.useRef<HTMLDivElement>(null)
  const stick = React.useRef(true)
  const [diffOpen, setDiffOpen] = React.useState(false)
  const diff = useSessionDiff(sessionId, directory, undefined, [], diffOpen)
  const [desktop, setDesktop] = React.useState(false)
  React.useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  React.useLayoutEffect(() => {
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages.data])
  React.useEffect(() => {
    setError(undefined)
    setNotice(undefined)
    stick.current = true
  }, [sessionId])
  const sessionError = useQuery<{ message?: string } | null>({
    queryKey: ['session-error', sessionId],
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
  })

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['session', sessionId] }),
      qc.invalidateQueries({ queryKey: ['messages', sessionId] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
      qc.invalidateQueries({ queryKey: ['sessions-all'] }),
    ])
  }
  const run = (action: () => Promise<unknown>) => {
    setError(undefined)
    void action().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
  }
  const changeSelection = (input: Parameters<typeof selectSession>[1]) =>
    run(async () => {
      await selectSession(sessionId, input)
      await refresh()
    })
  const handleSend = async (text: string, attachments: MessageAttachment[]) => {
    if (!session) return
    setError(undefined)
    qc.setQueryData(['session-error', sessionId], null)
    if (modelRef) recordModelUse(modelRef)
    stick.current = true
    const parsed = parseCommandInput(text)
    try {
      if (
        parsed &&
        [...(commands.data ?? []), ...(skills.data ?? [])].some(
          (c) => c.name === parsed.name,
        )
      ) {
        await sendCommand(sessionId, directory, {
          command: parsed.name,
          args: parsed.args,
          attachments,
        })
      } else {
        await promptSession(sessionId, directory, { text, attachments })
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }
  const handleFork = async (id?: string) => {
    if (forkLock.current) return
    forkLock.current = true
    setForkPending(true)
    try {
      const point = id ? forkPoint(messages.data ?? [], id) : {}
      if (!point) throw new Error('The session is still syncing. Try again.')
      const forked = await forkSession(sessionId, directory, point.messageID)
      qc.setQueryData(['session', forked.id], forked)
      await qc.invalidateQueries({ queryKey: ['sessions'] })
      await navigate({
        to: '/session/$sessionId',
        params: { sessionId: forked.id },
      })
    } finally {
      forkLock.current = false
      setForkPending(false)
    }
  }
  const handleAction = (name: string) =>
    run(async () => {
      if (!session) return
      switch (name) {
        case 'new':
          await navigate({
            to: '/',
            search: project ? { project: project.id, directory } : {},
          })
          break
        case 'fork':
          await handleFork()
          break
        case 'compact':
          await summarizeSession(sessionId, directory)
          setNotice('Compaction requested')
          break
        case 'undo': {
          if (busy) await abortSession(sessionId, directory)
          const target = visible.findLast((m) => m.type === 'user')
          if (target?.type === 'user') {
            const updated = await revertSession(sessionId, directory, target.id)
            qc.setQueryData(['session', sessionId], updated)
            composer.current?.setDraft(target.text ?? '')
          }
          break
        }
        case 'redo':
          {
            const next = boundary
              ? (messages.data ?? []).find(
                  (m) => m.type === 'user' && m.id > boundary,
                )
              : undefined
            if (next) await revertSession(sessionId, directory, next.id)
            else await unrevertSession(sessionId, directory)
          }
          await refresh()
          break
        case 'export': {
          const data = await (
            await client()
          ).session.export({ sessionID: sessionId })
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(data, null, 2)], {
              type: 'application/json',
            }),
          )
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = sessionExportFilename(session)
          anchor.click()
          URL.revokeObjectURL(url)
          setNotice('Session exported')
          break
        }
      }
    })
  const slashItems = [
    ...commandSlashItems(commands.data ?? []),
    ...sessionBuiltins({
      shareEnabled: false,
      shared: false,
      hasUserMessages: visible.some((m) => m.type === 'user'),
      reverted: !!boundary,
    }),
  ]
  if (sessionQ.isError)
    return (
      <div className={styles.missing}>
        <p>Session not found or service unavailable.</p>
        <Link to="/">Start a new one</Link>
      </div>
    )
  const diffPanel = (
    <SessionDiffPanel diff={diff} onClose={() => setDiffOpen(false)} />
  )

  return (
    <div className={styles.sessionLayout}>
      <div className={styles.page}>
        <header className={styles.header}>
          {session?.parentID ? (
            <Link
              className={styles.iconButton}
              to="/session/$sessionId"
              params={{ sessionId: session.parentID }}
              aria-label="Back to parent session"
            >
              <ArrowLeftIcon size={18} />
            </Link>
          ) : (
            <button
              type="button"
              className={`${styles.iconButton} ${styles.menuButton}`}
              onClick={openDrawer}
              aria-label="Open sessions"
            >
              <MenuIcon size={18} />
            </button>
          )}
          <div className={styles.headerText}>
            <div className={styles.titleRow}>
              <span className={styles.title}>
                {session?.title || 'Untitled session'}
              </span>
              {session && !session.parentID && (
                <details className={styles.titleMenu}>
                  <summary aria-label="Session actions">
                    <ChevronDownIcon size={14} />
                  </summary>
                  <div className={styles.titleMenuPanel}>
                    <button type="button" onClick={() => setRenameOpen(true)}>
                      <PencilIcon size={15} />
                      Rename session
                    </button>
                    <button
                      type="button"
                      className={styles.titleMenuDanger}
                      onClick={() => setDeleteOpen(true)}
                    >
                      <TrashIcon size={15} />
                      Delete session
                    </button>
                  </div>
                </details>
              )}
            </div>
            <span className={styles.subtitle}>
              {session?.parentID
                ? 'Read-only subagent session'
                : project
                  ? projectName(project)
                  : directory}
            </span>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setDiffOpen((open) => !open)}
            aria-label="Open session changes"
          >
            <DiffIcon size={17} />
          </button>
        </header>
        <div
          className={styles.scroll}
          ref={scroll}
          onScroll={() => {
            const el = scroll.current
            if (el)
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100
          }}
        >
          <div className={styles.messages}>
            {visible.map((message, i) => (
              <MessageView
                key={message.id}
                message={message}
                directory={directory}
                onFork={
                  !session?.parentID && endsAssistantTurn(visible, i)
                    ? (id) => run(() => handleFork(id))
                    : undefined
                }
                forkDisabled={forkPending}
              />
            ))}
            {boundary && (
              <div className={styles.revertNotice}>
                <span>Messages reverted</span>
                <button type="button" onClick={() => handleAction('redo')}>
                  Restore
                </button>
              </div>
            )}
            {busy && (
              <div className={styles.typing}>
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
        {session && !session.parentID && (
          <div className={styles.composerWrap}>
            <PermissionBanner sessionIds={requestIds} directory={directory} />
            {notice && (
              <div className={styles.noticeBanner}>
                {notice}
                <button
                  type="button"
                  onClick={() => setNotice(undefined)}
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}
            {(error || sessionError.data) && (
              <div className={styles.errorBanner}>
                {error ?? sessionError.data?.message}
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => {
                    setError(undefined)
                    qc.setQueryData(['session-error', sessionId], null)
                  }}
                >
                  ✕
                </button>
              </div>
            )}
            <Composer
              placeholder="Reply…"
              onSend={handleSend}
              busy={busy}
              onAbort={() => run(() => abortSession(sessionId, directory))}
              directory={directory}
              modelRef={modelRef}
              onModelChange={(model) => changeSelection({ model })}
              agentName={session.agent}
              onAgentChange={(agent) => changeSelection({ agent })}
              commands={slashItems}
              onCommandAction={handleAction}
              handleRef={composer}
            />
            <QuestionSheet sessionIds={requestIds} directory={directory} />
          </div>
        )}
        <PromptDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title="Rename session"
          label="Session title"
          initialValue={session?.title}
          confirmLabel={pending ? 'Saving…' : 'Save'}
          busy={pending}
          onSubmit={(title) =>
            run(async () => {
              setPending(true)
              try {
                await renameSession(sessionId, directory, title)
                await refresh()
                setRenameOpen(false)
              } finally {
                setPending(false)
              }
            })
          }
        />
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete session?"
          message="This permanently removes the session and its messages."
          confirmLabel={pending ? 'Deleting…' : 'Delete'}
          busy={pending}
          danger
          onConfirm={() =>
            run(async () => {
              setPending(true)
              try {
                await deleteSession(sessionId, directory)
                await qc.invalidateQueries({ queryKey: ['sessions'] })
                await qc.invalidateQueries({ queryKey: ['sessions-all'] })
                await navigate({ to: '/' })
              } finally {
                setPending(false)
              }
            })
          }
        />
      </div>
      {desktop && diffOpen && (
        <aside className={styles.diffSidebar}>{diffPanel}</aside>
      )}
      {!desktop && (
        <Drawer.Root
          open={diffOpen}
          onOpenChange={setDiffOpen}
          direction="right"
        >
          <Drawer.Portal>
            <Drawer.Overlay className={styles.diffDrawerOverlay} />
            <Drawer.Content
              className={styles.diffDrawer}
              aria-describedby={undefined}
            >
              <Drawer.Title className={styles.srOnly}>
                Session changes
              </Drawer.Title>
              {diffPanel}
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </div>
  )
}

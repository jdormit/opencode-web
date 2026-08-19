import * as React from 'react'
import { Drawer } from 'vaul'
import {
  Link,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  abortSession,
  agentsQuery,
  commandsQuery,
  configQuery,
  deleteSession,
  forkSession,
  messagesQuery,
  permissionsQuery,
  projectName,
  projectsQuery,
  promptSession,
  questionsQuery,
  renameSession,
  revertSession,
  sendCommand,
  sessionDescendantIdsQuery,
  sessionQuery,
  sessionStatusQuery,
  shareSession,
  summarizeSession,
  unrevertSession,
  unshareSession,
} from '~/lib/oc'
import type { MessageWithParts, Part, Project, Session } from '~/lib/oc'
import type { MessageAttachment } from '~/lib/attachments'
import {
  commandSlashItems,
  parseCommandInput,
  revertBoundary,
  sessionBuiltins,
  sessionExportFilename,
} from '~/lib/commands'
import type { SlashItem } from '~/lib/commands'
import { recordModelUse } from '~/lib/model-usage'
import type { ModelRef } from '~/lib/model-usage'
import { Composer } from '~/components/Composer'
import type { ComposerHandle } from '~/components/Composer'
import {
  MessageView,
  endsAssistantTurn,
  forkPoint,
  taskChildSessionIds,
} from '~/components/MessageView'
import { PermissionBanner } from '~/components/PermissionBanner'
import { QuestionSheet } from '~/components/QuestionSheet'
import { useShell } from '~/components/shell'
import { useSessionDiff } from '~/lib/session-diff-client'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  DiffIcon,
  MenuIcon,
  PencilIcon,
  TrashIcon,
} from '~/components/icons'
import styles from './session.module.css'

interface SessionErrorInfo {
  name: string
  data?: { message?: string }
}

const SessionDiffPanel = React.lazy(
  () => import('~/components/SessionDiffPanel'),
)

function useDesktopLayout() {
  const [desktop, setDesktop] = React.useState(false)
  React.useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return desktop
}

function defaultAgent(agents: Array<{ name: string }> | undefined): string {
  if (!agents || agents.length === 0) return 'build'
  return agents.some((a) => a.name === 'build') ? 'build' : agents[0].name
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export const Route = createFileRoute('/session/$sessionId')({
  loader: async ({ context, params }) => {
    const { queryClient } = context
    try {
      const session = await queryClient.ensureQueryData(
        sessionQuery(params.sessionId),
      )
      await queryClient.ensureQueryData(
        messagesQuery(session.id, session.directory),
      )
      if (!session.parentID) {
        await queryClient.ensureQueryData(
          permissionsQuery(session.id, session.directory),
        )
        await queryClient.ensureQueryData(
          questionsQuery(session.id, session.directory),
        )
      }
    } catch {
      // Not found or server unreachable; the page renders its own states.
    }
  },
  component: SessionPage,
})

function SessionPage() {
  const { sessionId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openDrawer } = useShell()

  const projects = useQuery(projectsQuery())
  const sessionQ = useQuery(sessionQuery(sessionId))
  const session = sessionQ.data
  const parentSessionId = session?.parentID
  const desktopLayout = useDesktopLayout()
  const [diffOpen, setDiffOpen] = React.useState(false)
  const titleMenuRef = React.useRef<HTMLDetailsElement>(null)

  React.useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = titleMenuRef.current
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = titleMenuRef.current
      if (event.key !== 'Escape' || !menu?.open) return
      menu.open = false
      menu.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const project = projects.data?.find(
    (p) => p.worktree === session?.directory || p.id === session?.projectID,
  )

  const messages = useQuery({
    ...messagesQuery(sessionId, session?.directory ?? ''),
    enabled: !!session,
  })
  const commands = useQuery({
    ...commandsQuery(session?.directory),
    enabled: !!session && !session.parentID,
  })
  const config = useQuery({
    ...configQuery(session?.directory),
    enabled: !!session && !session.parentID,
  })
  // An active revert hides the tail of the transcript until it is cleared
  // (via /redo) or committed by sending a new message.
  const boundary = revertBoundary(
    messages.data ?? [],
    session?.revert?.messageID,
  )
  const visibleMessages = boundary
    ? (messages.data ?? []).slice(0, boundary.index)
    : messages.data
  const diffMessageIds = (messages.data ?? [])
    .filter(
      (message) =>
        message.info.role === 'user' &&
        (message.info.summary?.diffs.length ?? 0) > 0,
    )
    .map((message) => message.info.id)
  const diff = useSessionDiff(
    sessionId,
    session?.directory,
    session?.summary?.files,
    diffMessageIds,
    diffOpen,
  )
  React.useEffect(() => {
    if (!diff.hasDiff) setDiffOpen(false)
  }, [diff.hasDiff])
  const descendants = useQuery({
    ...sessionDescendantIdsQuery(sessionId, session?.directory ?? ''),
    enabled: !!session && !session.parentID,
  })

  const status = useQuery(sessionStatusQuery())
  const statusEntry = status.data?.[sessionId]
  const lastAssistant = [...(messages.data ?? [])]
    .reverse()
    .find((m) => m.info.role === 'assistant')
  const busy = statusEntry
    ? statusEntry.type !== 'idle'
    : lastAssistant?.info.role === 'assistant' &&
      !lastAssistant.info.time.completed &&
      !lastAssistant.info.error
  const requestSessionIds = [
    ...new Set([
      sessionId,
      ...(descendants.data ?? []),
      ...taskChildSessionIds(messages.data ?? []),
    ]),
  ]

  // Composer defaults follow the last thing the user sent.
  const lastUser = [...(messages.data ?? [])]
    .reverse()
    .find((m) => m.info.role === 'user')
  const agents = useQuery(agentsQuery())
  const [modelOverride, setModelOverride] = React.useState<ModelRef>()
  const [agentOverride, setAgentOverride] = React.useState<string>()
  const [sendError, setSendError] = React.useState<string>()
  const modelRef =
    modelOverride ??
    (lastUser?.info.role === 'user' ? lastUser.info.model : undefined)
  const agentName =
    agentOverride ??
    (lastUser?.info.role === 'user' ? lastUser.info.agent : undefined) ??
    defaultAgent(agents.data)

  const [notice, setNotice] = React.useState<string>()
  const noticeTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const showNotice = React.useCallback((message: string) => {
    setNotice(message)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(undefined), 5000)
  }, [])
  React.useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const composerRef = React.useRef<ComposerHandle>(null)

  const slashItems = React.useMemo<Array<SlashItem>>(() => {
    const templates = commandSlashItems(commands.data ?? [])
    const builtins = sessionBuiltins({
      shareEnabled: config.data?.share !== 'disabled',
      shared: !!session?.share?.url,
      hasUserMessages: (visibleMessages ?? []).some(
        (m) => m.info.role === 'user',
      ),
      reverted: !!boundary,
    })
    return [...templates, ...builtins]
  }, [
    commands.data,
    config.data?.share,
    session?.share?.url,
    visibleMessages,
    boundary,
  ])
  const commandNames = React.useMemo(
    () => new Set((commands.data ?? []).map((command) => command.name)),
    [commands.data],
  )

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const stickToBottom = React.useRef(true)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.data])

  // Session-level errors (e.g. provider auth failures) arrive via SSE.
  const { data: sessionError } = useQuery<SessionErrorInfo | null>({
    queryKey: ['session-error', sessionId],
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  // Optimistic user message so the input feels instant.
  const addOptimisticMessage = (
    text: string,
    attachments: Array<MessageAttachment>,
  ) => {
    const optimisticId = `optimistic-${Date.now()}`
    queryClient.setQueryData<Array<MessageWithParts>>(
      ['messages', sessionId],
      (prev) => [
        ...(prev ?? []),
        {
          info: {
            id: optimisticId,
            sessionID: sessionId,
            role: 'user',
            time: { created: Date.now() },
            agent: agentName,
            model: modelRef ?? { providerID: '', modelID: '' },
          },
          parts: [
            ...(text
              ? [
                  {
                    id: `${optimisticId}-text`,
                    sessionID: sessionId,
                    messageID: optimisticId,
                    type: 'text' as const,
                    text,
                  },
                ]
              : []),
            ...attachments.map(
              (attachment, index): Part => ({
                id: `${optimisticId}-file-${index}`,
                sessionID: sessionId,
                messageID: optimisticId,
                type: 'file',
                mime: attachment.mime,
                filename: attachment.filename,
                url: attachment.url,
              }),
            ),
          ],
        },
      ],
    )
    return optimisticId
  }

  const removeOptimisticMessage = (optimisticId: string) => {
    queryClient.setQueryData<Array<MessageWithParts>>(
      ['messages', sessionId],
      (prev) => prev?.filter((m) => m.info.id !== optimisticId),
    )
  }

  const handleSend = async (
    text: string,
    attachments: Array<MessageAttachment>,
  ) => {
    if (!session || session.parentID) return
    setSendError(undefined)
    queryClient.setQueryData(['session-error', sessionId], null)
    if (modelRef) recordModelUse(modelRef)
    // Sending commits an active revert server-side; clear it locally so the
    // optimistic message isn't hidden behind the revert boundary.
    if (session.revert) {
      queryClient.setQueryData<Session>(['session', sessionId], (prev) =>
        prev ? { ...prev, revert: undefined } : prev,
      )
    }
    const optimisticId = addOptimisticMessage(text, attachments)
    stickToBottom.current = true

    const parsed = parseCommandInput(text)
    if (parsed && commandNames.has(parsed.name)) {
      // The command endpoint resolves only when the whole turn finishes;
      // don't block the composer on it. SSE streams the transcript.
      sendCommand(sessionId, session.directory, {
        command: parsed.name,
        args: parsed.args,
        agent: agentName,
        model: modelRef
          ? `${modelRef.providerID}/${modelRef.modelID}`
          : undefined,
        attachments,
      }).catch((err: unknown) => {
        removeOptimisticMessage(optimisticId)
        setSendError(err instanceof Error ? err.message : String(err))
        composerRef.current?.setDraft(text)
      })
      return
    }

    try {
      await promptSession(sessionId, session.directory, {
        model: modelRef,
        agent: agentName,
        text,
        attachments,
      })
    } catch (err) {
      removeOptimisticMessage(optimisticId)
      setSendError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  const handleAbort = () => {
    if (session && !session.parentID) {
      void abortSession(sessionId, session.directory)
    }
  }

  // Session lists are cached per project worktree; fall back to the
  // session's own directory if the project is unknown.
  const listCacheKeys = [
    ['sessions', project?.worktree ?? session?.directory],
    ['sessions-all', project?.worktree ?? session?.directory],
  ]

  const handleRename = async () => {
    if (!session || session.parentID) return
    const title = window.prompt('Rename session', session.title)
    if (!title || title === session.title) return
    try {
      await renameSession(sessionId, session.directory, title)
      queryClient.setQueryData<Session>(['session', sessionId], (prev) =>
        prev ? { ...prev, title } : prev,
      )
      for (const key of listCacheKeys) {
        queryClient.setQueryData<Array<Session>>(key, (sessions) =>
          sessions?.map((s) => (s.id === sessionId ? { ...s, title } : s)),
        )
      }
    } catch (err) {
      window.alert(
        `Rename failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Reads session/messages from the query cache so the callback stays
  // stable and doesn't defeat MessageView memoization while streaming.
  const [forkPending, setForkPending] = React.useState(false)
  const forkPendingRef = React.useRef(false)
  const handleFork = React.useCallback(
    async (messageId?: string) => {
      if (forkPendingRef.current) return
      const current = queryClient.getQueryData<Session>(['session', sessionId])
      if (!current || current.parentID) return
      const transcript =
        queryClient.getQueryData<Array<MessageWithParts>>([
          'messages',
          sessionId,
        ]) ?? []
      // Without a message the whole session is forked (the /fork command).
      const point = messageId ? forkPoint(transcript, messageId) : {}
      if (!point) {
        window.alert('The session is still syncing. Try again in a moment.')
        return
      }
      forkPendingRef.current = true
      setForkPending(true)
      try {
        const forked = await forkSession(
          sessionId,
          current.directory,
          point.messageID,
        )
        // Make the fork visible to the sidebar and the session route
        // immediately, without waiting for the SSE event.
        const worktree =
          queryClient
            .getQueryData<Array<Project>>(['projects'])
            ?.find(
              (p) =>
                p.worktree === current.directory ||
                p.id === current.projectID,
            )?.worktree ?? current.directory
        // Dedupe: the session.created SSE event may land before the fork
        // response does.
        const prepend = (sessions: Array<Session> | undefined) => [
          forked,
          ...(sessions ?? []).filter((s) => s.id !== forked.id),
        ]
        queryClient.setQueryData<Array<Session>>(
          ['sessions', worktree],
          (sessions) => (sessions ? prepend(sessions) : undefined),
        )
        queryClient.setQueryData<Array<Session>>(
          ['sessions-all', worktree],
          (sessions) => (sessions ? prepend(sessions) : undefined),
        )
        queryClient.setQueryData(['session', forked.id], forked)
        await navigate({
          to: '/session/$sessionId',
          params: { sessionId: forked.id },
        })
      } catch (err) {
        window.alert(
          `Fork failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        forkPendingRef.current = false
        setForkPending(false)
      }
    },
    [queryClient, sessionId, navigate],
  )

  const handleCommandAction = (name: string) => {
    if (!session || session.parentID) return
    void (async () => {
      try {
        switch (name) {
          case 'new':
            // The home route only honors directory alongside a known project.
            await navigate({
              to: '/',
              search: project
                ? { project: project.id, directory: session.directory }
                : {},
            })
            break
          case 'fork':
            await handleFork()
            break
          case 'share': {
            let url = session.share?.url
            if (!url) {
              const updated = await shareSession(sessionId, session.directory)
              queryClient.setQueryData(['session', sessionId], updated)
              url = updated.share?.url
            }
            if (!url) {
              setSendError('The server did not return a share link')
              break
            }
            const copied = await copyText(url)
            showNotice(
              copied ? 'Share link copied to clipboard' : `Shared at ${url}`,
            )
            break
          }
          case 'unshare': {
            const updated = await unshareSession(sessionId, session.directory)
            // Some server versions echo the stale share info back.
            queryClient.setQueryData(['session', sessionId], {
              ...updated,
              share: undefined,
            })
            showNotice('Session unshared')
            break
          }
          case 'compact': {
            if (!modelRef) {
              setSendError('Pick a model before compacting')
              break
            }
            showNotice('Compacting session…')
            await summarizeSession(sessionId, session.directory, modelRef)
            break
          }
          case 'undo': {
            if (busy) {
              await abortSession(sessionId, session.directory).catch(() => {})
            }
            const target = [...(visibleMessages ?? [])]
              .reverse()
              .find(
                (m) =>
                  m.info.role === 'user' &&
                  !m.info.id.startsWith('optimistic-'),
              )
            if (!target) break
            const updated = await revertSession(
              sessionId,
              session.directory,
              target.info.id,
            )
            queryClient.setQueryData(['session', sessionId], updated)
            // Put the reverted message back in the composer, like the
            // official clients do.
            const draft = target.parts
              .filter(
                (part): part is Extract<Part, { type: 'text' }> =>
                  part.type === 'text' && !part.synthetic,
              )
              .map((part) => part.text)
              .join('\n')
            if (draft) composerRef.current?.setDraft(draft)
            break
          }
          case 'redo': {
            const revertId = session.revert?.messageID
            if (!revertId) break
            // Step forward one user message; clear the revert entirely once
            // there is nothing left to restore.
            const next = (messages.data ?? []).find(
              (m) =>
                m.info.role === 'user' &&
                !m.info.id.startsWith('optimistic-') &&
                m.info.id > revertId,
            )
            const updated = next
              ? await revertSession(sessionId, session.directory, next.info.id)
              : await unrevertSession(sessionId, session.directory)
            queryClient.setQueryData(['session', sessionId], updated)
            break
          }
          case 'export': {
            const transcript =
              queryClient.getQueryData<Array<MessageWithParts>>([
                'messages',
                sessionId,
              ]) ?? []
            const filename = sessionExportFilename(session)
            downloadJson(filename, { info: session, messages: transcript })
            showNotice(`Exported ${filename}`)
            break
          }
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : String(err))
      }
    })()
  }

  const handleDelete = async () => {
    if (!session || session.parentID) return
    if (!window.confirm('Delete this session?')) return
    try {
      await deleteSession(sessionId, session.directory)
      for (const key of listCacheKeys) {
        queryClient.setQueryData<Array<Session>>(key, (sessions) =>
          sessions?.filter((s) => s.id !== sessionId),
        )
      }
      queryClient.removeQueries({ queryKey: ['session', sessionId] })
      void navigate({ to: '/' })
    } catch (err) {
      window.alert(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (sessionQ.isError) {
    return (
      <div className={styles.missing}>
        <p>Session not found.</p>
        <Link to="/">Start a new one</Link>
      </div>
    )
  }

  const diffPanel = (
    <React.Suspense fallback={<div className={styles.diffLoading}>Loading changes…</div>}>
      <SessionDiffPanel diff={diff} onClose={() => setDiffOpen(false)} />
    </React.Suspense>
  )

  return (
    <div className={styles.sessionLayout}>
      <div className={styles.page}>
      <header className={styles.header}>
        {parentSessionId ? (
          <Link
            className={styles.iconButton}
            to="/session/$sessionId"
            params={{ sessionId: parentSessionId }}
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
            {session && !parentSessionId && (
              <details className={styles.titleMenu} ref={titleMenuRef}>
                <summary aria-label="Session actions">
                  <ChevronDownIcon size={14} />
                </summary>
                <div className={styles.titleMenuPanel}>
                  <button
                    type="button"
                    onClick={() => {
                      if (titleMenuRef.current) titleMenuRef.current.open = false
                      titleMenuRef.current?.querySelector<HTMLElement>('summary')?.focus()
                      void handleRename()
                    }}
                  >
                    <PencilIcon size={15} />
                    Rename session
                  </button>
                  <button
                    type="button"
                    className={styles.titleMenuDanger}
                    onClick={() => {
                      if (titleMenuRef.current) titleMenuRef.current.open = false
                      titleMenuRef.current?.querySelector<HTMLElement>('summary')?.focus()
                      void handleDelete()
                    }}
                  >
                    <TrashIcon size={15} />
                    Delete session
                  </button>
                </div>
              </details>
            )}
          </div>
          <span className={styles.subtitle}>
            {parentSessionId
              ? 'Read-only subagent session'
              : project
                ? projectName(project)
                : ''}
          </span>
        </div>
        {session ? (
          <div className={styles.headerActions}>
            {diff.hasDiff && (
              <button
                type="button"
                className={`${styles.iconButton} ${diffOpen ? styles.iconButtonActive : ''}`}
                onClick={() => setDiffOpen((open) => !open)}
                aria-label={diffOpen ? 'Close session changes' : 'Open session changes'}
                aria-expanded={diffOpen}
              >
                <DiffIcon size={17} />
              </button>
            )}
          </div>
        ) : (
          <div className={styles.headerSpacer} />
        )}
      </header>

      <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll}>
        <div className={styles.messages}>
          {visibleMessages?.map((message, index) => (
            <MessageView
              key={message.info.id}
              message={message}
              directory={session?.directory ?? ''}
              onFork={
                !parentSessionId && endsAssistantTurn(visibleMessages, index)
                  ? handleFork
                  : undefined
              }
              forkDisabled={forkPending}
            />
          ))}
          {boundary && (
            <div className={styles.revertNotice}>
              <span>
                {boundary.revertedUserCount === 1
                  ? '1 message reverted'
                  : `${boundary.revertedUserCount} messages reverted`}
              </span>
              <button
                type="button"
                onClick={() => handleCommandAction('redo')}
              >
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

      {!parentSessionId && session && (
        <div className={styles.composerWrap}>
          <PermissionBanner
            sessionIds={requestSessionIds}
            directory={session.directory}
          />
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
          {(sendError || sessionError) && (
            <div className={styles.errorBanner}>
              {sendError ??
                sessionError?.data?.message ??
                sessionError?.name ??
                'Something went wrong'}
              <button
                type="button"
                onClick={() => {
                  setSendError(undefined)
                  queryClient.setQueryData(['session-error', sessionId], null)
                }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          <Composer
            placeholder="Reply…"
            onSend={handleSend}
            busy={busy}
            onAbort={handleAbort}
            modelRef={modelRef}
            directory={session.directory}
            onModelChange={setModelOverride}
            agentName={agentName}
            onAgentChange={setAgentOverride}
            commands={slashItems}
            onCommandAction={handleCommandAction}
            handleRef={composerRef}
          />
          <QuestionSheet
            sessionIds={requestSessionIds}
            directory={session.directory}
          />
        </div>
      )}
      </div>

      {desktopLayout && diffOpen && diff.hasDiff && (
        <aside className={styles.diffSidebar}>{diffPanel}</aside>
      )}

      {!desktopLayout && (
        <Drawer.Root open={diffOpen && diff.hasDiff} onOpenChange={setDiffOpen} direction="right">
          <Drawer.Portal>
            <Drawer.Overlay className={styles.diffDrawerOverlay} />
            <Drawer.Content className={styles.diffDrawer} aria-describedby={undefined}>
              <Drawer.Title className={styles.srOnly}>Session changes</Drawer.Title>
              {diffPanel}
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </div>
  )
}

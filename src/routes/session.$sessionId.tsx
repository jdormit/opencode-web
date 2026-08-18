import * as React from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  abortSession,
  agentsQuery,
  deleteSession,
  messagesQuery,
  permissionsQuery,
  projectName,
  projectsQuery,
  promptSession,
  questionsQuery,
  renameSession,
  sessionDescendantIdsQuery,
  sessionQuery,
  sessionStatusQuery,
} from '~/lib/oc'
import type { MessageWithParts, Part, Session } from '~/lib/oc'
import type { MessageAttachment } from '~/lib/attachments'
import { recordModelUse } from '~/lib/model-usage'
import type { ModelRef } from '~/lib/model-usage'
import { Composer } from '~/components/Composer'
import {
  MessageView,
  taskChildSessionIds,
} from '~/components/MessageView'
import { PermissionBanner } from '~/components/PermissionBanner'
import { QuestionSheet } from '~/components/QuestionSheet'
import { useShell } from '~/components/shell'
import {
  ArrowLeftIcon,
  MenuIcon,
  PencilIcon,
  TrashIcon,
} from '~/components/icons'
import styles from './session.module.css'

interface SessionErrorInfo {
  name: string
  data?: { message?: string }
}

function defaultAgent(agents: Array<{ name: string }> | undefined): string {
  if (!agents || agents.length === 0) return 'build'
  return agents.some((a) => a.name === 'build') ? 'build' : agents[0].name
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

  const project = projects.data?.find(
    (p) => p.worktree === session?.directory || p.id === session?.projectID,
  )

  const messages = useQuery({
    ...messagesQuery(sessionId, session?.directory ?? ''),
    enabled: !!session,
  })
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

  const handleSend = async (
    text: string,
    attachments: Array<MessageAttachment>,
  ) => {
    if (!session || session.parentID) return
    setSendError(undefined)
    queryClient.setQueryData(['session-error', sessionId], null)
    if (modelRef) recordModelUse(modelRef)
    // Optimistic user message so the input feels instant.
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
    stickToBottom.current = true
    try {
      await promptSession(sessionId, session.directory, {
        model: modelRef,
        agent: agentName,
        text,
        attachments,
      })
    } catch (err) {
      queryClient.setQueryData<Array<MessageWithParts>>(
        ['messages', sessionId],
        (prev) => prev?.filter((m) => m.info.id !== optimisticId),
      )
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

  return (
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
          <span className={styles.title}>
            {session?.title || 'Untitled session'}
          </span>
          <span className={styles.subtitle}>
            {parentSessionId
              ? 'Read-only subagent session'
              : project
                ? projectName(project)
                : ''}
          </span>
        </div>
        {session && !parentSessionId ? (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void handleRename()}
              aria-label="Rename session"
            >
              <PencilIcon size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void handleDelete()}
              aria-label="Delete session"
            >
              <TrashIcon size={16} />
            </button>
          </div>
        ) : (
          <div className={styles.headerSpacer} />
        )}
      </header>

      <div className={styles.scroll} ref={scrollRef} onScroll={handleScroll}>
        <div className={styles.messages}>
          {messages.data?.map((message) => (
            <MessageView
              key={message.info.id}
              message={message}
              directory={session?.directory ?? ''}
            />
          ))}
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
          />
          <QuestionSheet
            sessionIds={requestSessionIds}
            directory={session.directory}
          />
        </div>
      )}
    </div>
  )
}

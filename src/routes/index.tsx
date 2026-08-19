import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import {
  agentsQuery,
  commandsQuery,
  configQuery,
  createSession,
  deleteSession,
  LAST_PROJECT_DIRECTORY_KEY,
  LAST_PROJECT_KEY,
  projectsQuery,
  promptSession,
  providersQuery,
  sendCommand,
  sessionsQuery,
} from '~/lib/oc'
import type { Session } from '~/lib/oc'
import type { MessageAttachment } from '~/lib/attachments'
import { commandSlashItems, parseCommandInput } from '~/lib/commands'
import type { SlashItem } from '~/lib/commands'
import {
  configuredModel,
  defaultModel,
  recordModelUse,
} from '~/lib/model-usage'
import type { ModelRef } from '~/lib/model-usage'
import { greeting } from '~/lib/format'
import { Composer } from '~/components/Composer'
import { useShell } from '~/components/shell'
import { MenuIcon } from '~/components/icons'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { project?: string; directory?: string } => ({
    ...(typeof search.project === 'string' ? { project: search.project } : {}),
    ...(typeof search.directory === 'string'
      ? { directory: search.directory }
      : {}),
  }),
  component: NewSessionPage,
})

function NewSessionPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const { openDrawer } = useShell()

  const projects = useQuery(projectsQuery())
  const sessionQueries = useQueries({
    queries: (projects.data ?? []).map((p) => sessionsQuery(p.worktree)),
  })

  // Default to the most recently active project.
  const defaultProject = React.useMemo(() => {
    const list = projects.data ?? []
    if (list.length === 0) return undefined
    let best = list[0]
    let bestTime = -1
    list.forEach((project, i) => {
      const latest = sessionQueries[i]?.data?.[0]?.time.updated ?? 0
      if (latest > bestTime) {
        bestTime = latest
        best = project
      }
    })
    return best
  }, [projects.data, sessionQueries])

  const [projectId, setProjectId] = React.useState<string>()
  const [projectDirectory, setProjectDirectory] = React.useState<string>()
  React.useEffect(() => {
    if (
      search.project &&
      projects.data?.some((project) => project.id === search.project)
    ) {
      setProjectId(search.project)
      setProjectDirectory(
        search.directory ??
          projects.data.find((project) => project.id === search.project)
            ?.worktree,
      )
    }
  }, [projects.data, search.directory, search.project])
  // Prefer the project the user last picked on this device.
  React.useEffect(() => {
    if (projectId) return
    const stored = window.localStorage.getItem(LAST_PROJECT_KEY)
    if (stored && projects.data?.some((p) => p.id === stored)) {
      setProjectId(stored)
      setProjectDirectory(
        window.localStorage.getItem(LAST_PROJECT_DIRECTORY_KEY) ??
          projects.data.find((p) => p.id === stored)?.worktree,
      )
    }
  }, [projectId, projects.data])
  const project =
    projects.data?.find((p) => p.id === projectId) ?? defaultProject
  const directory = projectDirectory ?? project?.worktree

  const providers = useQuery(providersQuery(directory))
  const config = useQuery(configQuery(directory))
  const [modelOverride, setModelOverride] = React.useState<ModelRef>()
  const modelRef =
    modelOverride ??
    configuredModel(config.data?.model, providers.data) ??
    (!config.isPending && providers.data
      ? defaultModel(providers.data)
      : undefined)

  const agents = useQuery(agentsQuery())
  const [agentOverride, setAgentOverride] = React.useState<string>()
  const agentName =
    agentOverride ??
    (agents.data?.some((a) => a.name === 'build')
      ? 'build'
      : agents.data?.[0]?.name) ??
    'build'
  const [error, setError] = React.useState<string>()
  const [sending, setSending] = React.useState(false)

  const commands = useQuery(commandsQuery(directory))
  const slashItems = React.useMemo<Array<SlashItem>>(
    () => commandSlashItems(commands.data ?? []),
    [commands.data],
  )

  const handleSend = async (
    text: string,
    attachments: Array<MessageAttachment>,
  ) => {
    if (!project) return
    setSending(true)
    setError(undefined)
    window.localStorage.setItem(LAST_PROJECT_KEY, project.id)
    window.localStorage.setItem(
      LAST_PROJECT_DIRECTORY_KEY,
      directory ?? project.worktree,
    )
    let session: Session | undefined
    try {
      session = await createSession(directory ?? project.worktree)
      // Make the session visible to the sidebar and the session route
      // immediately, without waiting for the SSE event.
      const created = session
      // Dedupe: the session.created SSE event may land before this does.
      queryClient.setQueryData<Array<Session>>(
        ['sessions', directory ?? project.worktree],
        (sessions) => [
          created,
          ...(sessions ?? []).filter((s) => s.id !== created.id),
        ],
      )
      queryClient.setQueryData(['session', created.id], created)
      if (modelRef) recordModelUse(modelRef)
      const parsed = parseCommandInput(text)
      if (parsed && commands.data?.some((c) => c.name === parsed.name)) {
        // The command endpoint blocks until the turn completes; fire it and
        // let the session page stream the transcript over SSE.
        const created = session
        sendCommand(session.id, directory ?? project.worktree, {
          command: parsed.name,
          args: parsed.args,
          agent: agentName,
          model: modelRef
            ? `${modelRef.providerID}/${modelRef.modelID}`
            : undefined,
          attachments,
        }).catch((err: unknown) => {
          // Surface HTTP-level failures on the session page we navigated to.
          queryClient.setQueryData(['session-error', created.id], {
            name: 'CommandError',
            data: {
              message: err instanceof Error ? err.message : String(err),
            },
          })
        })
      } else {
        await promptSession(session.id, directory ?? project.worktree, {
          model: modelRef,
          agent: agentName,
          text,
          attachments,
        })
      }
      await navigate({
        to: '/session/$sessionId',
        params: { sessionId: session.id },
      })
    } catch (err) {
      // Don't leave an orphaned empty session behind if the prompt failed.
      if (session) {
        const orphanId = session.id
        void deleteSession(
          orphanId,
          directory ?? project.worktree,
        ).catch(() => {})
        queryClient.setQueryData<Array<Session>>(
          ['sessions', directory ?? project.worktree],
          (sessions) => sessions?.filter((s) => s.id !== orphanId),
        )
      }
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={openDrawer}
          aria-label="Open sessions"
        >
          <MenuIcon size={20} />
        </button>
      </header>

      <div className={styles.hero}>
        <div className={styles.logo} aria-hidden="true">
          &gt;_
        </div>
        <h1 className={styles.greeting} suppressHydrationWarning>
          {greeting()}
        </h1>
        {projects.isError && (
          <p className={styles.connectError}>
            Can't reach the OpenCode server. Check your{' '}
            <a href="/settings">server settings</a>.
          </p>
        )}
      </div>

      <div className={styles.composerWrap}>
        {error && <p className={styles.sendError}>{error}</p>}
        <Composer
          placeholder="Start a new session…"
          onSend={handleSend}
          sending={sending}
          project={project}
          directory={directory}
          onProjectChange={(p, selectedDirectory = p.worktree) => {
            setProjectId(p.id)
            setProjectDirectory(selectedDirectory)
            window.localStorage.setItem(LAST_PROJECT_KEY, p.id)
            window.localStorage.setItem(
              LAST_PROJECT_DIRECTORY_KEY,
              selectedDirectory,
            )
            void navigate({
              to: '/',
              search: {
                project: p.id,
                directory:
                  selectedDirectory === p.worktree
                    ? undefined
                    : selectedDirectory,
              },
              replace: true,
            })
          }}
          modelRef={modelRef}
          onModelChange={setModelOverride}
          agentName={agentName}
          onAgentChange={setAgentOverride}
          commands={slashItems}
          autoFocus
        />
      </div>
    </div>
  )
}

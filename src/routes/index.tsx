import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import {
  agentsQuery,
  createSession,
  deleteSession,
  projectsQuery,
  promptSession,
  providersQuery,
  sessionsQuery,
} from '~/lib/oc'
import type { Session } from '~/lib/oc'
import { defaultModel, recordModelUse } from '~/lib/model-usage'
import type { ModelRef } from '~/lib/model-usage'
import { greeting } from '~/lib/format'
import { Composer } from '~/components/Composer'
import { useShell } from '~/components/shell'
import { MenuIcon } from '~/components/icons'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  component: NewSessionPage,
})

const LAST_PROJECT_KEY = 'oc-last-project'

function NewSessionPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openDrawer } = useShell()

  const projects = useQuery(projectsQuery())
  const providers = useQuery(providersQuery())
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
  // Prefer the project the user last picked on this device.
  React.useEffect(() => {
    if (projectId) return
    const stored = window.localStorage.getItem(LAST_PROJECT_KEY)
    if (stored && projects.data?.some((p) => p.id === stored)) {
      setProjectId(stored)
    }
  }, [projectId, projects.data])
  const project =
    projects.data?.find((p) => p.id === projectId) ?? defaultProject

  const [modelRef, setModelRef] = React.useState<ModelRef>()
  React.useEffect(() => {
    if (!modelRef && providers.data) {
      setModelRef(defaultModel(providers.data))
    }
  }, [modelRef, providers.data])

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

  const handleSend = async (text: string) => {
    if (!project) return
    setSending(true)
    setError(undefined)
    window.localStorage.setItem(LAST_PROJECT_KEY, project.id)
    let session: Session | undefined
    try {
      session = await createSession(project.worktree)
      // Make the session visible to the sidebar and the session route
      // immediately, without waiting for the SSE event.
      const created = session
      queryClient.setQueryData<Array<Session>>(
        ['sessions', project.worktree],
        (sessions) => [created, ...(sessions ?? [])],
      )
      queryClient.setQueryData(['session', created.id], created)
      if (modelRef) recordModelUse(modelRef)
      await promptSession(session.id, project.worktree, {
        model: modelRef,
        agent: agentName,
        text,
      })
      await navigate({
        to: '/session/$sessionId',
        params: { sessionId: session.id },
      })
    } catch (err) {
      // Don't leave an orphaned empty session behind if the prompt failed.
      if (session) {
        const orphanId = session.id
        void deleteSession(orphanId, project.worktree).catch(() => {})
        queryClient.setQueryData<Array<Session>>(
          ['sessions', project.worktree],
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
          onProjectChange={(p) => {
            setProjectId(p.id)
            window.localStorage.setItem(LAST_PROJECT_KEY, p.id)
          }}
          modelRef={modelRef}
          onModelChange={setModelRef}
          agentName={agentName}
          onAgentChange={setAgentOverride}
          autoFocus
        />
      </div>
    </div>
  )
}

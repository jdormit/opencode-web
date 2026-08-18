import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import {
  SESSION_LIST_LIMIT,
  LAST_PROJECT_DIRECTORY_KEY,
  LAST_PROJECT_KEY,
  projectName,
  projectsQuery,
  sessionsAllQuery,
  sessionsQuery,
  sessionStatusQuery,
} from '~/lib/oc'
import type { Project, Session } from '~/lib/oc'
import { relativeTime } from '~/lib/format'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
} from './icons'
import styles from './SessionList.module.css'
import { OpenProjectSheet } from './OpenProjectSheet'

const COLLAPSE_KEY = 'oc-collapsed-projects'

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function SessionListPanel({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const projects = useQuery(projectsQuery())
  const status = useQuery(sessionStatusQuery())
  const [openProject, setOpenProject] = React.useState(false)

  const sessionQueries = useQueries({
    queries: (projects.data ?? []).map((p) => sessionsQuery(p.worktree)),
  })

  const [search, setSearch] = React.useState('')
  const query = search.trim().toLowerCase()

  const groups = React.useMemo(() => {
    const list = (projects.data ?? []).map((project, i) => ({
      project,
      sessions: sessionQueries[i]?.data ?? [],
    }))
    const latest = (g: { sessions: Array<Session> }) =>
      g.sessions[0]?.time.updated ?? 0
    const all = list
      .filter((g) => g.sessions.length > 0)
      .sort((a, b) => latest(b) - latest(a))
    if (!query) return all
    // A project-name match keeps the whole group; otherwise keep only the
    // sessions whose titles match.
    return all.flatMap((group) => {
      if (projectName(group.project).toLowerCase().includes(query)) {
        return [group]
      }
      const sessions = group.sessions.filter((s) =>
        s.title.toLowerCase().includes(query),
      )
      return sessions.length > 0 ? [{ ...group, sessions }] : []
    })
  }, [projects.data, sessionQueries, query])

  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    setCollapsed(readCollapsed())
  }, [])

  const toggle = (projectId: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [projectId]: !prev[projectId] }
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.wordmark}>opencode</span>
      </header>

      <Link to="/" className={styles.newSession} onClick={onNavigate}>
        <PlusIcon size={18} />
        New session
      </Link>

      <button
        type="button"
        className={styles.openProject}
        onClick={() => setOpenProject(true)}
      >
        <PlusIcon size={17} />
        Open project
      </button>

      <div className={styles.search}>
        <SearchIcon size={15} />
        <input
          type="text"
          placeholder="Search projects & sessions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      <nav className={styles.list}>
        {projects.isError && (
          <p className={styles.hint}>
            Can't reach the OpenCode server.{' '}
            <Link to="/settings" onClick={onNavigate}>
              Check settings
            </Link>
          </p>
        )}
        {projects.isSuccess && groups.length === 0 && (
          <p className={styles.hint}>
            {query ? 'No matches.' : 'No sessions yet.'}
          </p>
        )}
        {groups.map(({ project, sessions }) => (
          <ProjectGroup
            key={project.id}
            project={project}
            sessions={sessions}
            collapsed={!query && !!collapsed[project.id]}
            onToggle={() => toggle(project.id)}
            statusMap={status.data}
            onNavigate={onNavigate}
            forceShowAll={!!query}
          />
        ))}
      </nav>

      <footer className={styles.footer}>
        <Link to="/settings" className={styles.settingsLink} onClick={onNavigate}>
          <GearIcon size={17} />
          Settings
        </Link>
      </footer>

      <OpenProjectSheet
        open={openProject}
        onOpenChange={setOpenProject}
        onSelect={(project, directory) => {
          window.localStorage.setItem(LAST_PROJECT_KEY, project.id)
          window.localStorage.setItem(LAST_PROJECT_DIRECTORY_KEY, directory)
          void queryClient.prefetchQuery(sessionsQuery(directory))
          void navigate({
            to: '/',
            search: { project: project.id, directory },
          })
          setOpenProject(false)
          onNavigate?.()
        }}
      />
    </div>
  )
}

const GROUP_LIMIT = 8

function ProjectGroup({
  project,
  sessions,
  collapsed,
  onToggle,
  statusMap,
  onNavigate,
  forceShowAll,
}: {
  project: Project
  sessions: Array<Session>
  collapsed: boolean
  onToggle: () => void
  statusMap: Record<string, { type: string }> | undefined
  onNavigate?: () => void
  forceShowAll?: boolean
}) {
  const [showAll, setShowAll] = React.useState(false)
  const expanded = showAll || forceShowAll
  // The main list is windowed to the most recent sessions; fetch the full
  // history only once the user expands the group.
  const maybeTruncated = sessions.length >= SESSION_LIST_LIMIT
  const all = useQuery({
    ...sessionsAllQuery(project.worktree),
    enabled: showAll && maybeTruncated,
  })
  const fullSessions = React.useMemo(() => {
    if (!expanded || !all.data) return sessions
    // The windowed cache receives live SSE updates; prefer its entries.
    const byId = new Map(all.data.map((s) => [s.id, s]))
    for (const s of sessions) byId.set(s.id, s)
    return [...byId.values()].sort((a, b) => b.time.updated - a.time.updated)
  }, [expanded, all.data, sessions])

  const visible = expanded ? fullSessions : sessions.slice(0, GROUP_LIMIT)
  const count =
    expanded && all.data
      ? fullSessions.length
      : maybeTruncated
        ? `${SESSION_LIST_LIMIT}+`
        : sessions.length

  return (
    <section className={styles.group}>
      <button type="button" className={styles.groupHeader} onClick={onToggle}>
        {collapsed ? (
          <ChevronRightIcon size={14} />
        ) : (
          <ChevronDownIcon size={14} />
        )}
        <span className={styles.groupName}>{projectName(project)}</span>
        <span className={styles.groupCount}>{count}</span>
      </button>
      {!collapsed && (
        <ul className={styles.sessions}>
          {visible.map((session) => {
            const busy =
              statusMap?.[session.id] &&
              statusMap[session.id].type !== 'idle'
            return (
              <li key={session.id}>
                <Link
                  to="/session/$sessionId"
                  params={{ sessionId: session.id }}
                  className={styles.session}
                  activeProps={{ className: styles.sessionActive }}
                  onClick={onNavigate}
                >
                  {busy && <span className={styles.busyDot} />}
                  <span className={styles.sessionTitle}>
                    {session.title || 'Untitled session'}
                  </span>
                  <span
                    className={styles.sessionTime}
                    suppressHydrationWarning
                  >
                    {relativeTime(session.time.updated)}
                  </span>
                </Link>
              </li>
            )
          })}
          {!expanded && sessions.length > GROUP_LIMIT && (
            <li>
              <button
                type="button"
                className={styles.showAll}
                onClick={() => setShowAll(true)}
              >
                {maybeTruncated
                  ? 'Show all'
                  : `Show all ${sessions.length}`}
              </button>
            </li>
          )}
          {expanded && all.isLoading && (
            <li className={styles.loadingMore}>Loading full history…</li>
          )}
        </ul>
      )}
    </section>
  )
}

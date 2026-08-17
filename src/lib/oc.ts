import { createIsomorphicFn } from '@tanstack/react-start'
import { queryOptions } from '@tanstack/react-query'
import { getServerConfigFromRequest } from './settings.server'
import type {
  Agent,
  ConfigProvidersResponse,
  Message,
  Part,
  Project,
  Session,
  SessionStatus,
} from '@opencode-ai/sdk'

export type {
  Agent,
  ConfigProvidersResponse,
  Event,
  Message,
  Model,
  Part,
  Permission,
  Project,
  Provider,
  Session,
  SessionStatus,
  ToolPart,
} from '@opencode-ai/sdk'

export interface MessageWithParts {
  info: Message
  parts: Array<Part>
}

/**
 * Resolve a request against the OpenCode server. On the client everything
 * goes through the local proxy (avoids CORS); during SSR we talk to the
 * OpenCode server directly using the cookie-configured URL.
 */
const resolveRequest = createIsomorphicFn()
  .server((path: string) => {
    const config = getServerConfigFromRequest()
    return {
      url: `${config.url}${path}`,
      headers: config.auth
        ? { Authorization: `Basic ${config.auth}` }
        : undefined,
    }
  })
  .client((path: string) => ({
    url: `/api/proxy${path}`,
    headers: undefined,
  }))

export class OcError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface OcFetchOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined>
}

export async function ocFetch<T>(
  path: string,
  options: OcFetchOptions = {},
): Promise<T> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.size > 0 ? `?${search.toString()}` : ''
  const { url, headers } = resolveRequest(`${path}${qs}`)

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
      ...headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    let detail = ''
    try {
      detail = await res.text()
    } catch {
      // ignore
    }
    throw new OcError(
      res.status,
      `OpenCode request failed (${res.status} ${res.statusText})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    )
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ---- Queries ---- */

export const projectsQuery = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: async () => {
      const projects = await ocFetch<Array<Project>>('/project')
      // The server can report the same worktree under multiple project ids
      // (e.g. the special "global" project); keep one entry per worktree.
      const byWorktree = new Map<string, Project>()
      for (const project of projects) {
        if (!byWorktree.has(project.worktree)) {
          byWorktree.set(project.worktree, project)
        }
      }
      return [...byWorktree.values()]
    },
    staleTime: 30_000,
  })

/**
 * The server caps session lists at 100 by default (and offers no backward
 * pagination cursor), so we window the sidebar to the most recent sessions
 * and lazy-load full history per project via sessionsAllQuery.
 */
export const SESSION_LIST_LIMIT = 100

function sortSessions(sessions: Array<Session>) {
  return sessions
    .filter((s) => !s.parentID)
    .sort((a, b) => b.time.updated - a.time.updated)
}

export const sessionsQuery = (directory: string) =>
  queryOptions({
    queryKey: ['sessions', directory],
    queryFn: async () => {
      const sessions = await ocFetch<Array<Session>>('/session', {
        // roots=true excludes subagent child sessions so they don't count
        // against the limit (sortSessions filters them as a fallback).
        query: { directory, roots: 'true', limit: SESSION_LIST_LIMIT },
      })
      return sortSessions(sessions)
    },
    staleTime: 30_000,
  })

/** Full session history for one project; only fetched on demand. */
export const sessionsAllQuery = (directory: string) =>
  queryOptions({
    queryKey: ['sessions-all', directory],
    queryFn: async () => {
      const sessions = await ocFetch<Array<Session>>('/session', {
        query: { directory, roots: 'true', limit: 100_000 },
      })
      return sortSessions(sessions)
    },
    staleTime: 60_000,
  })

/** Canonical session lookup; the server resolves the id globally. */
export const sessionQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ['session', sessionId],
    queryFn: () => ocFetch<Session>(`/session/${sessionId}`),
    staleTime: 30_000,
  })

export const messagesQuery = (sessionId: string, directory: string) =>
  queryOptions({
    queryKey: ['messages', sessionId],
    queryFn: () =>
      ocFetch<Array<MessageWithParts>>(`/session/${sessionId}/message`, {
        query: { directory },
      }),
    staleTime: 30_000,
  })

export const agentsQuery = () =>
  queryOptions({
    queryKey: ['agents'],
    queryFn: async () => {
      // `hidden` marks internal agents (title, summary, compaction); it is
      // not in the published SDK types yet but newer servers send it.
      const agents =
        await ocFetch<Array<Agent & { hidden?: boolean }>>('/agent')
      return agents.filter((a) => a.mode !== 'subagent' && !a.hidden)
    },
    staleTime: 5 * 60_000,
  })

export const providersQuery = () =>
  queryOptions({
    queryKey: ['providers'],
    queryFn: () => ocFetch<ConfigProvidersResponse>('/config/providers'),
    staleTime: 5 * 60_000,
  })

export const sessionStatusQuery = () =>
  queryOptions({
    queryKey: ['session-status'],
    // /session/status is scoped to a single project directory, so gather
    // and merge across every known project.
    queryFn: async () => {
      try {
        const projects = await ocFetch<Array<Project>>('/project')
        const directories = [...new Set(projects.map((p) => p.worktree))]
        const maps = await Promise.all(
          directories.map((directory) =>
            ocFetch<Record<string, SessionStatus>>('/session/status', {
              query: { directory },
            }).catch(() => ({}) as Record<string, SessionStatus>),
          ),
        )
        return Object.assign({}, ...maps) as Record<string, SessionStatus>
      } catch {
        return {} as Record<string, SessionStatus>
      }
    },
    staleTime: 30_000,
  })

/* ---- Mutations ---- */

export function createSession(directory: string, title?: string) {
  return ocFetch<Session>('/session', {
    method: 'POST',
    query: { directory },
    body: title ? { title } : {},
  })
}

export interface PromptInput {
  model?: { providerID: string; modelID: string }
  agent?: string
  text: string
}

export function promptSession(
  sessionId: string,
  directory: string,
  input: PromptInput,
) {
  return ocFetch<void>(`/session/${sessionId}/prompt_async`, {
    method: 'POST',
    query: { directory },
    body: {
      model: input.model,
      agent: input.agent,
      parts: [{ type: 'text' as const, text: input.text }],
    },
  })
}

export function abortSession(sessionId: string, directory: string) {
  return ocFetch<boolean>(`/session/${sessionId}/abort`, {
    method: 'POST',
    query: { directory },
  })
}

export function deleteSession(sessionId: string, directory: string) {
  return ocFetch<boolean>(`/session/${sessionId}`, {
    method: 'DELETE',
    query: { directory },
  })
}

export function renameSession(
  sessionId: string,
  directory: string,
  title: string,
) {
  return ocFetch<Session>(`/session/${sessionId}`, {
    method: 'PATCH',
    query: { directory },
    body: { title },
  })
}

export function respondPermission(
  sessionId: string,
  directory: string,
  permissionId: string,
  response: 'once' | 'always' | 'reject',
) {
  return ocFetch<boolean>(
    `/session/${sessionId}/permissions/${permissionId}`,
    {
      method: 'POST',
      query: { directory },
      body: { response },
    },
  )
}

/* ---- Helpers ---- */

export function projectName(project: Project): string {
  const parts = project.worktree.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || project.worktree
}

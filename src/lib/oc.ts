import { createIsomorphicFn } from '@tanstack/react-start'
import { queryOptions } from '@tanstack/react-query'
import { OpenCode } from '@opencode/client'
import type {
  OpenCodeClient,
  Project as ApiProject,
  SessionInfo,
  ModelInfo,
  ProviderInfo,
  SessionMessageInfo,
  AgentInfo,
  CommandInfo,
  SkillInfo,
  PermissionRequest,
  FormInfo,
  SessionMessageAssistantTool,
  SessionMessageAssistantReasoning,
} from '@opencode/client'
import type { MessageAttachment } from './attachments'

export type {
  OpenCodeEvent as Event,
  FormInfo,
  FormAnswer,
  FormField,
} from '@opencode/client'
export type Message = SessionMessageInfo
export type Agent = AgentInfo
export type Command = CommandInfo
export type Skill = SkillInfo
export type ToolPart = SessionMessageAssistantTool
export type ReasoningPart = SessionMessageAssistantReasoning
export type Part = Extract<Message, { type: 'assistant' }>['content'][number]
export type Project = ApiProject & { worktree: string }
export type Session = SessionInfo & { directory: string }
export type PendingPermission = PermissionRequest
export type SessionStatus = { type: 'busy' | 'idle' }
export type Model = ModelInfo
export type Provider = ProviderInfo & { models: Record<string, Model> }
export type ConfigProvidersResponse = {
  providers: Provider[]
  default: Record<string, string>
}

const apiFactory = createIsomorphicFn()
  .server(async () => {
    const { serviceFetch } = await import('./service.server')
    return OpenCode.make({
      baseUrl: 'http://service.local',
      fetch: ((url, init) => {
        const parsed = new URL(String(url))
        return serviceFetch(parsed.pathname + parsed.search, init)
      }) as typeof fetch,
    })
  })
  .client(async () =>
    OpenCode.make({ baseUrl: `${window.location.origin}/api/proxy` }),
  )

export const client = () => apiFactory()
export const toProject = (p: ApiProject): Project => ({
  ...p,
  worktree: p.canonical,
})
export const toSession = (s: SessionInfo): Session => ({
  ...s,
  directory: s.location.directory,
})
const location = (directory?: string) => (directory ? { directory } : undefined)
export const SESSION_LIST_LIMIT = 100
export const LAST_PROJECT_KEY = 'oc-last-project'
export const LAST_PROJECT_DIRECTORY_KEY = 'oc-last-project-directory'

export async function listSessions(
  api: OpenCodeClient,
  directory: string,
  all = false,
) {
  const resolved = await api.location.get({ location: { directory } })
  const sessions: SessionInfo[] = []
  let cursor: string | undefined
  do {
    const page = await api.session.list(
      cursor
        ? { cursor, limit: SESSION_LIST_LIMIT }
        : {
            project: resolved.project.id,
            parentID: null,
            order: 'desc',
            limit: SESSION_LIST_LIMIT,
          },
    )
    sessions.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (all && cursor)
  return sessions.map(toSession)
}

export const projectsQuery = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: async () => (await (await client()).project.list()).map(toProject),
    staleTime: 30_000,
  })
export const serverPathQuery = () =>
  queryOptions({
    queryKey: ['server-path'],
    queryFn: async () => (await client()).location.get(),
    staleTime: 300_000,
  })
export const directoryQuery = (directory: string) =>
  queryOptions({
    queryKey: ['directory', directory],
    queryFn: async () => {
      const { data } = await (
        await client()
      ).file.list({ location: { directory }, path: '' })
      return data
        .filter((e) => e.type === 'directory')
        .map((e) => ({
          ...e,
          name: e.path.replace(/\/$/, '').split('/').pop()!,
          absolute: `${directory.replace(/\/$/, '')}/${e.path.replace(/\/$/, '')}`,
        }))
        .sort(
          (a, b) =>
            Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) ||
            a.name.localeCompare(b.name),
        )
    },
    staleTime: 60_000,
  })
export const sessionsQuery = (directory: string) =>
  queryOptions({
    queryKey: ['sessions', directory],
    queryFn: async () => listSessions(await client(), directory),
    staleTime: 30_000,
  })
export const sessionsAllQuery = (directory: string) =>
  queryOptions({
    queryKey: ['sessions-all', directory],
    queryFn: async () => listSessions(await client(), directory, true),
    staleTime: 60_000,
  })
export const sessionQuery = (sessionID: string) =>
  queryOptions({
    queryKey: ['session', sessionID],
    queryFn: async () =>
      toSession(await (await client()).session.get({ sessionID })),
    staleTime: 30_000,
  })
export const sessionDescendantIdsQuery = (
  sessionID: string,
  _directory: string,
) =>
  queryOptions({
    queryKey: ['session-descendants', sessionID],
    queryFn: async () => {
      const api = await client()
      const seen = new Set([sessionID])
      const parents = [sessionID]
      for (const parentID of parents) {
        let cursor: string | undefined
        do {
          const page = await api.session.list(
            cursor ? { cursor, limit: 200 } : { parentID, limit: 200 },
          )
          for (const child of page.data)
            if (!seen.has(child.id)) {
              seen.add(child.id)
              parents.push(child.id)
            }
          cursor = page.cursor.next ?? undefined
        } while (cursor)
      }
      return parents.slice(1)
    },
    staleTime: 30_000,
  })

const revisions = new Map<string, number>()
export function markSessionEvent(id: string) {
  revisions.set(id, (revisions.get(id) ?? 0) + 1)
}
async function snapshot<T>(id: string, load: () => Promise<T>): Promise<T> {
  while (true) {
    const revision = revisions.get(id)
    const value = await load()
    if (revision === revisions.get(id)) return value
  }
}

export const messagesQuery = (sessionID: string, _directory: string) =>
  queryOptions({
    queryKey: ['messages', sessionID],
    queryFn: async () =>
      snapshot(sessionID, async () => {
        const api = await client()
        const messages: Message[] = []
        let cursor: string | undefined
        do {
          const page = await api.message.list({
            sessionID,
            limit: 200,
            ...(cursor ? { cursor } : { order: 'asc' }),
          })
          messages.push(...page.data)
          cursor = page.cursor.next ?? undefined
        } while (cursor)
        const pending = await api.session.inbox.list({ sessionID })
        const ids = new Set(messages.map((m) => m.id))
        for (const item of pending) {
          if (
            (item.type === 'user' || item.type === 'synthetic') &&
            !ids.has(item.id)
          ) {
            messages.push({
              id: item.id,
              type: item.type,
              ...item.payload,
              time: { created: item.time.created },
            } as Message)
          }
        }
        return messages
      }),
    staleTime: 30_000,
  })
export const agentsQuery = (directory?: string) =>
  queryOptions({
    queryKey: ['agents', directory],
    queryFn: async () =>
      (
        await (await client()).agent.list({ location: location(directory) })
      ).data.filter((a) => a.mode !== 'subagent' && !a.hidden),
    staleTime: 300_000,
  })
export const commandsQuery = (directory?: string) =>
  queryOptions({
    queryKey: ['commands', directory],
    queryFn: async () =>
      (await (await client()).command.list({ location: location(directory) }))
        .data,
    staleTime: 300_000,
  })
export const skillsQuery = (directory?: string) =>
  queryOptions({
    queryKey: ['skills', directory],
    queryFn: async () =>
      (await (await client()).skill.list({ location: location(directory) }))
        .data,
    staleTime: 300_000,
  })
export const providersQuery = (directory?: string) =>
  queryOptions({
    queryKey: ['providers', directory],
    queryFn: async (): Promise<ConfigProvidersResponse> => {
      const api = await client()
      const input = { location: location(directory) }
      await api.location.get(input)
      const [providers, models, preferred] = await Promise.all([
        api.provider.list(input),
        api.model.list(input),
        api.model.default(input),
      ])
      return {
        providers: providers.data.map((p) => ({
          ...p,
          models: Object.fromEntries(
            models.data
              .filter((m) => m.providerID === p.id && m.enabled)
              .map((m) => [m.id, m]),
          ),
        })),
        default: preferred.data
          ? { [preferred.data.providerID]: preferred.data.id }
          : {},
      }
    },
    staleTime: 300_000,
  })
export const configQuery = (directory?: string) =>
  queryOptions({
    queryKey: ['config', directory],
    queryFn: async () => {
      const { data } = await (
        await client()
      ).model.default({ location: location(directory) })
      return { model: data ? `${data.providerID}/${data.id}` : undefined }
    },
    staleTime: 30_000,
  })
export const sessionStatusQuery = () =>
  queryOptions({
    queryKey: ['session-status'],
    queryFn: async (): Promise<Record<string, SessionStatus>> => {
      const active = await (await client()).session.active()
      return Object.fromEntries(
        Object.keys(active).map((id) => [id, { type: 'busy' }]),
      )
    },
    staleTime: 30_000,
  })
export const permissionsQuery = (sessionID: string, _directory: string) =>
  queryOptions({
    queryKey: ['permissions', sessionID],
    queryFn: async () =>
      snapshot(sessionID, async () =>
        (await client()).permission.list({ sessionID }),
      ),
    staleTime: 0,
  })
export const questionsQuery = (sessionID: string, _directory: string) =>
  queryOptions({
    queryKey: ['questions', sessionID],
    queryFn: async () =>
      snapshot(sessionID, async () =>
        (await client()).session.form.list({ sessionID }),
      ),
    staleTime: 0,
  })
export async function openProject(directory: string) {
  const api = await client()
  const resolved = await api.location.get({ location: { directory } })
  const projects = await api.project.list()
  const project = projects.find((p) => p.id === resolved.project.id)
  if (!project) throw new Error('Project was not registered')
  return toProject(project)
}
export async function createSession(directory: string, title?: string) {
  return toSession(
    await (await client()).session.create({ location: { directory }, title }),
  )
}
export interface PromptInput {
  id?: string
  model?: { providerID: string; modelID: string; variant?: string }
  agent?: string
  text: string
  attachments?: MessageAttachment[]
}
export function promptFiles(attachments: MessageAttachment[] = []) {
  return attachments.map((a) => ({ uri: a.url, name: a.filename }))
}
export async function selectSession(
  sessionID: string,
  input: Pick<PromptInput, 'model' | 'agent'>,
) {
  const api = await client()
  const current = await api.session.get({ sessionID })
  if (input.agent && current.agent !== input.agent)
    await api.session.switchAgent({ sessionID, agent: input.agent })
  if (
    input.model &&
    (current.model?.id !== input.model.modelID ||
      current.model.providerID !== input.model.providerID ||
      current.model.variant !== input.model.variant)
  ) {
    await api.session.switchModel({
      sessionID,
      model: {
        id: input.model.modelID,
        providerID: input.model.providerID,
        variant: input.model.variant,
      },
    })
  }
}
export async function promptSession(
  sessionID: string,
  _directory: string,
  input: PromptInput,
) {
  const api = await client()
  await selectSession(sessionID, input)
  const current = await api.session.get({ sessionID })
  if (current.revert) await api.session.revert.commit({ sessionID })
  return api.session.prompt({
    sessionID,
    id: input.id,
    text: input.text,
    files: promptFiles(input.attachments),
  })
}
export interface CommandInput {
  command: string
  args: string
  agent?: string
  model?: string
  attachments?: MessageAttachment[]
}
export async function sendCommand(
  sessionID: string,
  directory: string,
  input: CommandInput,
) {
  const api = await client()
  const [providerID, ...model] = input.model?.split('/') ?? []
  await selectSession(sessionID, {
    agent: input.agent,
    model: providerID ? { providerID, modelID: model.join('/') } : undefined,
  })
  const current = await api.session.get({ sessionID })
  if (current.revert) await api.session.revert.commit({ sessionID })
  const skills = await api.skill.list({ location: { directory } })
  const skill = skills.data.find((s) => s.name === input.command)
  if (skill)
    return api.session.prompt({
      sessionID,
      text: input.args,
      skills: [{ id: skill.id }],
      files: promptFiles(input.attachments),
    })
  return api.session.command({
    sessionID,
    name: input.command,
    text: input.args,
    files: promptFiles(input.attachments),
  })
}
export async function summarizeSession(
  sessionID: string,
  _directory: string,
  _model?: unknown,
) {
  return (await client()).session.compact({ sessionID })
}
export async function revertSession(
  sessionID: string,
  _directory: string,
  messageID: string,
) {
  const api = await client()
  await api.session.revert.stage({ sessionID, messageID })
  return toSession(await api.session.get({ sessionID }))
}
export async function unrevertSession(sessionID: string, _directory: string) {
  const api = await client()
  await api.session.revert.clear({ sessionID })
  return toSession(await api.session.get({ sessionID }))
}
export async function abortSession(sessionID: string, _directory: string) {
  return (await client()).session.interrupt({ sessionID })
}
export async function forkSession(
  sessionID: string,
  _directory: string,
  messageID?: string,
) {
  return toSession(
    await (await client()).session.fork({ sessionID, before: messageID }),
  )
}
export async function deleteSession(sessionID: string, _directory: string) {
  return (await client()).session.remove({ sessionID })
}
export async function renameSession(
  sessionID: string,
  _directory: string,
  title: string,
) {
  return (await client()).session.update({ sessionID, title })
}
export async function respondPermission(
  sessionID: string,
  _directory: string,
  requestID: string,
  response: 'once' | 'always' | 'reject',
) {
  return (await client()).permission.reply({
    sessionID,
    requestID,
    decision: response,
  })
}
export async function replyQuestion(
  sessionID: string,
  formID: string,
  answer: import('@opencode/client').FormAnswer,
) {
  return (await client()).session.form.reply({ sessionID, formID, answer })
}
export async function rejectQuestion(sessionID: string, formID: string) {
  return (await client()).session.form.cancel({ sessionID, formID })
}
export function projectName(project: Project) {
  return (
    project.name ||
    project.canonical.replace(/\/+$/, '').split('/').pop() ||
    project.canonical
  )
}

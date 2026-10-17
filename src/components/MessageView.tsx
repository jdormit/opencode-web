import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { backgroundSession, messagesQuery } from '~/lib/oc'
import type { Message, Part, ReasoningPart, ToolPart } from '~/lib/oc'
import { duration } from '~/lib/format'
import { Markdown } from './Markdown'
import { CheckIcon, ChevronRightIcon, ForkIcon, XIcon } from './icons'
import styles from './MessageView.module.css'

export function isFinishedAssistantTurn(message: Message) {
  return (
    message.type === 'assistant' &&
    Boolean(message.time.completed || message.error)
  )
}
export function endsAssistantTurn(messages: Message[], index: number) {
  return (
    messages[index]?.type === 'assistant' &&
    (!messages[index + 1] ||
      ['idle', 'user'].includes(messages[index + 1].type))
  )
}
export function forkPoint(
  messages: Message[],
  id: string,
): { messageID?: string } | null {
  const index = messages.findIndex((m) => m.id === id)
  if (index < 0) return null
  return messages[index + 1] ? { messageID: messages[index + 1].id } : {}
}
export type PartGroup =
  | { kind: 'part'; part: Exclude<Part, ReasoningPart> }
  | { kind: 'reasoning'; parts: ReasoningPart[] }
export function groupParts(parts: Part[]): PartGroup[] {
  const groups: PartGroup[] = []
  for (const part of parts) {
    if (part.type !== 'tool' && !part.text.trim()) continue
    const previous = groups.at(-1)
    if (part.type === 'reasoning') {
      if (previous?.kind === 'reasoning') previous.parts.push(part)
      else groups.push({ kind: 'reasoning', parts: [part] })
    } else groups.push({ kind: 'part', part })
  }
  return groups
}
export function reasoningLabel(parts: ReasoningPart[]) {
  const start = parts[0]?.time?.created
  const end = parts.at(-1)?.time?.completed
  return start !== undefined && end !== undefined
    ? `Thought for ${duration(start, end)}`
    : 'Thinking…'
}
export function taskSessionId(part: ToolPart): string | undefined {
  if (
    !['subagent', 'task', 'agent'].includes(part.name) ||
    !('metadata' in part.state)
  )
    return
  const id = part.state.metadata?.sessionID ?? part.state.metadata?.sessionId
  return typeof id === 'string' ? id : undefined
}
export function taskChildSessionIds(messages: Message[]) {
  return [
    ...new Set(
      messages.flatMap((m) =>
        m.type === 'assistant'
          ? m.content.flatMap((p) =>
              p.type === 'tool' ? (taskSessionId(p) ?? []) : [],
            )
          : [],
      ),
    ),
  ]
}
export const MessageView = React.memo(function MessageView({
  message,
  directory,
  onFork,
  forkDisabled,
  sessionId,
}: {
  message: Message
  directory: string
  onFork?: (id: string) => void
  forkDisabled?: boolean
  sessionId?: string
}) {
  if (message.type === 'synthetic') return null
  if (message.type === 'user')
    return (
      <div className={styles.userRow}>
        <div className={styles.userMessage}>
          {(message.files?.length ?? 0) > 0 && (
            <div className={styles.userAttachments}>
              {message.files?.map((file, i) => {
                const uri = `data:${file.mime};base64,${file.data}`
                return (
                  <a
                    key={i}
                    href={uri}
                    download={file.name}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {file.mime.startsWith('image/') ? (
                      <img
                        className={styles.userAttachmentImage}
                        src={uri}
                        alt={file.name ?? 'Attached image'}
                      />
                    ) : (
                      <span className={styles.userAttachmentFile}>
                        {file.name ?? file.mime}
                      </span>
                    )}
                  </a>
                )
              })}
            </div>
          )}
          {message.text && (
            <div className={styles.userBubble}>{message.text}</div>
          )}
        </div>
      </div>
    )
  if (message.type === 'idle')
    return message.error ? (
      <div className={styles.error}>{message.error.message}</div>
    ) : null
  if (message.type === 'assistant')
    return (
      <div className={styles.assistant}>
        {groupParts(message.content).map((group, index) =>
          group.kind === 'reasoning' ? (
            <details key={index} className={styles.reasoning}>
              <summary>
                <ChevronRightIcon size={13} />
                {reasoningLabel(group.parts)}
              </summary>
              <div className={styles.reasoningBody}>
                {group.parts.map((p, i) => (
                  <Markdown key={i}>{p.text}</Markdown>
                ))}
              </div>
            </details>
          ) : group.part.type === 'text' ? (
            <Markdown key={index}>{group.part.text}</Markdown>
          ) : (
            <ToolRow
              key={index}
              part={group.part}
              directory={directory}
              sessionId={sessionId}
            />
          ),
        )}
        {message.retry && (
          <div className={styles.aborted}>
            Retrying (attempt {message.retry.attempt})…{' '}
            {message.retry.error.message}
          </div>
        )}
        {message.error && (
          <div className={styles.error}>{message.error.message}</div>
        )}
        {onFork && isFinishedAssistantTurn(message) && (
          <div className={styles.turnActions}>
            <button
              type="button"
              className={styles.turnActionButton}
              onClick={() => onFork(message.id)}
              disabled={forkDisabled}
              aria-label="Fork session from here"
            >
              <ForkIcon size={16} />
            </button>
          </div>
        )}
      </div>
    )
  if (message.type === 'compaction')
    return (
      <details className={styles.reasoning}>
        <summary>Compaction {message.status}</summary>
        {message.status === 'failed' ? (
          message.error.message
        ) : (
          <Markdown>{message.summary}</Markdown>
        )}
      </details>
    )
  if (message.type === 'shell')
    return (
      <details className={styles.tool}>
        <summary>
          {message.command} · {message.status}
        </summary>
        <pre>{JSON.stringify(message.output, null, 2)}</pre>
      </details>
    )
  if (message.type === 'agent-switched')
    return <div className={styles.aborted}>Agent: {message.agent}</div>
  if (message.type === 'model-switched')
    return (
      <div className={styles.aborted}>
        Model: {message.model.providerID}/{message.model.id}
        {message.model.variant ? ` (${message.model.variant})` : ''}
      </div>
    )
  if (message.type === 'location-switched')
    return (
      <div className={styles.aborted}>
        Directory: {message.location.directory}
      </div>
    )
  return (
    <details className={styles.reasoning}>
      <summary>
        {message.type === 'skill'
          ? `Skill: ${message.name}`
          : (message.description ?? message.type)}
      </summary>
      <Markdown>{message.text}</Markdown>
    </details>
  )
})

export function backgroundableToolStart(part: ToolPart): number | undefined {
  if (
    !['shell', 'subagent'].includes(part.name) ||
    part.state.status !== 'running' ||
    part.state.input.background === true ||
    part.state.metadata.background === true
  )
    return undefined
  return part.time.ran ?? part.time.created
}

export function backgroundButtonDelay(start: number, now = Date.now()) {
  return Math.max(0, start + 2001 - now)
}

export function toolElapsed(part: ToolPart, now = Date.now()): string | undefined {
  if (!['shell', 'subagent'].includes(part.name) || part.state.status === 'streaming')
    return undefined
  const start = part.time.ran ?? part.time.created
  const end = part.state.status === 'running' ? now : part.time.completed
  if (end === undefined) return undefined
  return duration(start, Math.max(start, end))
}

function ToolElapsed({ part }: { part: ToolPart }) {
  const [now, setNow] = React.useState(Date.now)
  const running = part.state.status === 'running'
  React.useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, part.id])
  const elapsed = toolElapsed(part, now)
  if (elapsed === undefined) return null
  return (
    <span className={styles.toolElapsed} title="Elapsed time">
      {elapsed}
    </span>
  )
}

export function toolSummary(
  input: unknown,
  metadata?: unknown,
): string | undefined {
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const fields = input as Record<string, unknown>
    for (const key of [
      'command',
      'filePath',
      'path',
      'pattern',
      'query',
      'url',
      'description',
      'title',
      'name',
      'id',
      'code',
      'prompt',
    ]) {
      const value = text(fields[key])
      if (value) return value
    }
    const patch = text(fields.patchText)
    if (patch) {
      const files = [
        ...patch.matchAll(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm),
      ].map((match) => {
        const action =
          match[1] === 'Move to' ? 'Move to' : match[1].replace(' File', '')
        return `${action} ${match[2].trim()}`
      })
      if (files.length) return files.join(' · ')
    }
  }
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return text((metadata as Record<string, unknown>).title)
  }
  return undefined
}

function BackgroundToolButton({
  part,
  sessionId,
}: {
  part: ToolPart
  sessionId: string
}) {
  const start = backgroundableToolStart(part)
  const [ready, setReady] = React.useState(false)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => backgroundSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
    },
  })
  React.useEffect(() => {
    setReady(false)
    if (start === undefined) return
    const timer = setTimeout(() => setReady(true), backgroundButtonDelay(start))
    return () => clearTimeout(timer)
  }, [start])
  if (start === undefined || !ready || mutation.isSuccess) return null
  return (
    <div className={styles.toolActions}>
      <button
        type="button"
        className={styles.backgroundButton}
        disabled={mutation.isPending}
        title="Background all eligible foreground tools in this session"
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Sending to background…' : 'Send to background'}
      </button>
      {mutation.isError && (
        <span role="alert" className={styles.toolError}>
          {mutation.error.message}
        </span>
      )}
    </div>
  )
}

function ToolRow({
  part,
  directory,
  sessionId,
}: {
  part: ToolPart
  directory: string
  sessionId?: string
}) {
  const { state } = part
  const child = taskSessionId(part)
  const summary = toolSummary(
    state.input,
    'metadata' in state ? state.metadata : undefined,
  )
  const output =
    'content' in state
      ? state.content
          ?.map((item) =>
            item.type === 'text' ? item.text : JSON.stringify(item),
          )
          .join('\n')
      : undefined
  return (
    <div>
      <details className={styles.tool}>
        <summary>
          <ChevronRightIcon size={13} className={styles.disclosure} />
          <span className={styles.toolName}>{part.name}</span>
          {summary && (
            <span className={styles.toolTitle} title={summary}>
              {summary}
            </span>
          )}
          {['shell', 'subagent'].includes(part.name) && <ToolElapsed part={part} />}
          <span className={styles.toolStatus}>
            {['streaming', 'running'].includes(state.status) && (
              <span className={styles.spinner} />
            )}
            {state.status === 'completed' && (
              <CheckIcon size={13} className={styles.ok} />
            )}
            {state.status === 'error' && (
              <XIcon size={13} className={styles.bad} />
            )}
          </span>
        </summary>
        <div className={styles.toolBody}>
          <pre className={styles.toolIo}>
            {typeof state.input === 'string'
              ? state.input
              : JSON.stringify(state.input, null, 2)}
          </pre>
          {nestedToolCalls(part).map((call, index) => {
            const summary = toolSummary(call.input)
            return (
              <details
                key={index}
                className={styles.tool}
                open={call.status === 'running'}
              >
                <summary>
                  <span className={styles.toolName}>{call.tool}</span>
                  {summary && (
                    <span className={styles.toolTitle} title={summary}>
                      {summary}
                    </span>
                  )}
                  <span>{call.status}</span>
                </summary>
                {call.input !== undefined && (
                  <pre className={styles.toolIo}>
                    {JSON.stringify(call.input, null, 2)}
                  </pre>
                )}
                {call.result !== undefined && (
                  <pre className={styles.toolIo}>
                    {typeof call.result === 'string'
                      ? call.result
                      : JSON.stringify(call.result, null, 2)}
                  </pre>
                )}
              </details>
            )
          })}
          {output && (
            <pre className={styles.toolIo}>{output.slice(0, 8000)}</pre>
          )}
          {state.status === 'error' && (
            <pre className={styles.toolError}>{state.error.message}</pre>
          )}
          {child && (
            <SubagentActivity sessionId={child} directory={directory} />
          )}
        </div>
      </details>
      {sessionId && backgroundableToolStart(part) !== undefined && (
        <BackgroundToolButton key={part.id} part={part} sessionId={sessionId} />
      )}
    </div>
  )
}

function SubagentActivity({
  sessionId,
  directory,
}: {
  sessionId: string
  directory: string
}) {
  const messages = useQuery(messagesQuery(sessionId, directory))
  const tools = (messages.data ?? []).flatMap((m) =>
    m.type === 'assistant' ? m.content.filter((p) => p.type === 'tool') : [],
  )
  return (
    <Link to="/session/$sessionId" params={{ sessionId }}>
      Open subagent session · {tools.length} tool calls
      {tools.at(-1) ? ` · Last: ${tools.at(-1)!.name}` : ''}
    </Link>
  )
}

export interface NestedToolCall {
  tool: string
  status: 'running' | 'completed' | 'error'
  input?: unknown
  result?: unknown
}
export function nestedToolCalls(part: ToolPart): NestedToolCall[] {
  if (part.name !== 'execute' || !('metadata' in part.state)) return []
  const calls = part.state.metadata?.toolCalls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call) => {
    if (!call || typeof call !== 'object' || Array.isArray(call)) return []
    if (
      typeof call.tool !== 'string' ||
      !['running', 'completed', 'error'].includes(String(call.status))
    )
      return []
    return [
      {
        tool: call.tool,
        status: call.status as NestedToolCall['status'],
        ...('input' in call ? { input: call.input } : {}),
        ...('result' in call ? { result: call.result } : {}),
      },
    ]
  })
}

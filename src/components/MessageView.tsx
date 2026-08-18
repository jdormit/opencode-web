import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { MessageWithParts, Part, ToolPart } from '~/lib/oc'
import { messagesQuery } from '~/lib/oc'
import { duration } from '~/lib/format'
import { Markdown } from './Markdown'
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  XIcon,
} from './icons'
import styles from './MessageView.module.css'

export const MessageView = React.memo(function MessageView({
  message,
  directory,
}: {
  message: MessageWithParts
  directory: string
}) {
  if (message.info.role === 'user') {
    const text = message.parts
      .filter((p) => p.type === 'text' && !p.synthetic)
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n')
    const attachments = message.parts.filter(
      (part): part is Extract<Part, { type: 'file' }> =>
        part.type === 'file' && part.url.startsWith('data:'),
    )
    if (!text.trim() && attachments.length === 0) return null
    return (
      <div className={styles.userRow}>
        <div className={styles.userMessage}>
          {attachments.length > 0 && (
            <div className={styles.userAttachments}>
              {attachments.map((attachment) => (
                <UserAttachment key={attachment.id} part={attachment} />
              ))}
            </div>
          )}
          {text.trim() && <div className={styles.userBubble}>{text}</div>}
        </div>
      </div>
    )
  }

  const error = message.info.error
  return (
    <div className={styles.assistant}>
      {message.parts.map((part) => (
        <PartView key={part.id} part={part} directory={directory} />
      ))}
      {error && error.name !== 'MessageAbortedError' && (
        <div className={styles.error}>
          {'message' in error.data && typeof error.data.message === 'string'
            ? error.data.message
            : error.name}
        </div>
      )}
      {error?.name === 'MessageAbortedError' && (
        <div className={styles.aborted}>Stopped</div>
      )}
    </div>
  )
})

function UserAttachment({
  part,
}: {
  part: Extract<Part, { type: 'file' }>
}) {
  if (part.mime.startsWith('image/')) {
    return (
      <a href={part.url} target="_blank" rel="noreferrer">
        <img
          className={styles.userAttachmentImage}
          src={part.url}
          alt={part.filename ?? 'Attached image'}
        />
      </a>
    )
  }
  return (
    <a
      className={styles.userAttachmentFile}
      href={part.url}
      target="_blank"
      rel="noreferrer"
    >
      <span className={styles.userAttachmentType}>
        {part.mime === 'application/pdf' ? 'PDF' : 'FILE'}
      </span>
      <span>{part.filename ?? 'Attachment'}</span>
    </a>
  )
}

function PartView({ part, directory }: { part: Part; directory: string }) {
  switch (part.type) {
    case 'text':
      if (part.ignored || !part.text.trim()) return null
      return <Markdown>{part.text}</Markdown>
    case 'reasoning':
      if (!part.text.trim()) return null
      return (
        <details className={styles.reasoning}>
          <summary>
            <ChevronRightIcon size={13} className={styles.disclosure} />
            {part.time.end
              ? `Thought for ${duration(part.time.start, part.time.end)}`
              : 'Thinking…'}
          </summary>
          <div className={styles.reasoningBody}>
            <Markdown>{part.text}</Markdown>
          </div>
        </details>
      )
    case 'tool':
      return part.tool === 'task' ? (
        <TaskToolRow part={part} directory={directory} />
      ) : (
        <ToolRow part={part} />
      )
    case 'subtask':
      return (
        <div className={styles.toolChip}>
          <span className={styles.toolName}>subtask</span>
          <span className={styles.toolTitle}>{part.description}</span>
        </div>
      )
    case 'patch':
      return (
        <div className={styles.toolChip}>
          <span className={styles.toolName}>edited</span>
          <span className={styles.toolTitle}>
            {part.files.length === 1
              ? part.files[0].split('/').pop()
              : `${part.files.length} files`}
          </span>
        </div>
      )
    case 'retry':
      return <div className={styles.aborted}>Retrying (attempt {part.attempt})…</div>
    default:
      return null
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function taskSessionId(part: ToolPart): string | undefined {
  if (part.tool !== 'task' || !('metadata' in part.state)) return undefined
  return stringValue(recordValue(part.state.metadata)?.sessionId)
}

export function taskChildSessionIds(
  messages: Array<MessageWithParts>,
): Array<string> {
  return [
    ...new Set(
      messages.flatMap((message) =>
        message.parts.flatMap((part) => {
          if (part.type !== 'tool') return []
          const sessionId = taskSessionId(part)
          return sessionId ? [sessionId] : []
        }),
      ),
    ),
  ]
}

export interface SubagentActivity {
  toolCalls: number
  lastTool?: string
}

export function subagentActivity(
  messages: Array<MessageWithParts>,
): SubagentActivity {
  const tools = messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type === 'tool'),
  )
  const last = tools.at(-1)
  if (!last) return { toolCalls: 0 }

  const title =
    (last.state.status === 'running' || last.state.status === 'completed'
      ? stringValue(last.state.title)
      : undefined) ?? toolInputSummary(last)
  return {
    toolCalls: tools.length,
    lastTool: title ? `${last.tool} ${title}` : last.tool,
  }
}

function TaskToolRow({
  part,
  directory,
}: {
  part: ToolPart
  directory: string
}) {
  const childSessionId = taskSessionId(part)
  const childMessages = useQuery({
    ...messagesQuery(childSessionId ?? '', directory),
    enabled: !!childSessionId && !!directory,
  })
  const activity = subagentActivity(childMessages.data ?? [])
  const input = recordValue(part.state.input)
  const agent = stringValue(input?.subagent_type) ?? 'subagent'
  const description = stringValue(input?.description) ?? 'Delegated task'
  const callCount = `${activity.toolCalls} tool call${activity.toolCalls === 1 ? '' : 's'}`
  const status = part.state.status

  const content = (
    <>
      <span className={styles.taskIcon}>
        {(status === 'pending' || status === 'running') && (
          <span className={styles.spinner} />
        )}
        {status === 'completed' && <BotIcon size={16} />}
        {status === 'error' && <XIcon size={15} className={styles.bad} />}
      </span>
      <span className={styles.taskText}>
        <span className={styles.taskHeading}>
          <span className={styles.taskAgent}>{agent}</span>
          <span className={styles.taskDescription}>{description}</span>
        </span>
        <span className={styles.taskActivity}>
          {childSessionId && childMessages.isLoading
            ? 'Loading activity…'
            : callCount}
          {activity.lastTool && ` · Last: ${activity.lastTool}`}
        </span>
      </span>
      {childSessionId && (
        <ChevronRightIcon size={16} className={styles.taskArrow} />
      )}
    </>
  )

  if (!childSessionId) {
    return <div className={styles.taskCard}>{content}</div>
  }

  return (
    <Link
      className={`${styles.taskCard} ${styles.taskLink}`}
      to="/session/$sessionId"
      params={{ sessionId: childSessionId }}
      aria-label={`Open ${description} subagent session`}
    >
      {content}
    </Link>
  )
}

function toolInputSummary(part: ToolPart): string | undefined {
  const input = part.state.input
  if (!input) return undefined
  const candidates = ['command', 'pattern', 'filePath', 'path', 'query', 'url', 'description']
  for (const key of candidates) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function ToolRow({ part }: { part: ToolPart }) {
  const { state } = part
  const title =
    (state.status === 'running' || state.status === 'completed'
      ? state.title
      : undefined) || toolInputSummary(part)

  return (
    <details className={styles.tool}>
      <summary>
        <ChevronRightIcon size={13} className={styles.disclosure} />
        <span className={styles.toolName}>{part.tool}</span>
        {title && <span className={styles.toolTitle}>{title}</span>}
        <span className={styles.toolStatus}>
          {(state.status === 'pending' || state.status === 'running') && (
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
        {state.status !== 'pending' && Object.keys(state.input).length > 0 && (
          <pre className={styles.toolIo}>
            {JSON.stringify(state.input, null, 2)}
          </pre>
        )}
        {state.status === 'completed' && state.output.trim() && (
          <pre className={styles.toolIo}>{truncate(state.output, 4000)}</pre>
        )}
        {state.status === 'error' && (
          <pre className={`${styles.toolIo} ${styles.toolError}`}>
            {truncate(state.error, 4000)}
          </pre>
        )}
      </div>
    </details>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text
}

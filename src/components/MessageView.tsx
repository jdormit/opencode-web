import * as React from 'react'
import type { MessageWithParts, Part, ToolPart } from '~/lib/oc'
import { duration } from '~/lib/format'
import { Markdown } from './Markdown'
import { CheckIcon, ChevronRightIcon, XIcon } from './icons'
import styles from './MessageView.module.css'

export const MessageView = React.memo(function MessageView({
  message,
}: {
  message: MessageWithParts
}) {
  if (message.info.role === 'user') {
    const text = message.parts
      .filter((p) => p.type === 'text' && !p.synthetic)
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n')
    if (!text.trim()) return null
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>{text}</div>
      </div>
    )
  }

  const error = message.info.error
  return (
    <div className={styles.assistant}>
      {message.parts.map((part) => (
        <PartView key={part.id} part={part} />
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

function PartView({ part }: { part: Part }) {
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
      return <ToolRow part={part} />
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

function toolInputSummary(part: ToolPart): string | undefined {
  const input = part.state.status !== 'pending' ? part.state.input : undefined
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

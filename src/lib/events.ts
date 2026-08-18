import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { markQuestionEvent } from './oc'
import type {
  Event,
  Message,
  MessageWithParts,
  Part,
  PendingPermission,
  QuestionRequest,
  Session,
  SessionStatus,
} from './oc'

interface GlobalEventEnvelope {
  directory?: string
  payload?: Event
  // some server versions send the event at the top level
  type?: string
  properties?: unknown
}

/**
 * Session lists are cached per project worktree, but events can carry a
 * session directory that is a subdirectory of the worktree. Find the cached
 * list the session belongs to.
 */
function findSessionsCacheKeys(
  queryClient: QueryClient,
  directory: string | undefined,
  info: Session,
): Array<ReadonlyArray<unknown>> {
  const keys = ['sessions', 'sessions-all'].flatMap((base) =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: [base] })
      .map((q) => q.queryKey),
  )
  const candidates = [directory, info.directory].filter(
    (d): d is string => !!d,
  )
  return keys.filter((key) => {
    const keyDir = key[1]
    if (typeof keyDir !== 'string') return false
    return candidates.some((d) => d === keyDir || d.startsWith(`${keyDir}/`))
  })
}

function upsertSession(
  queryClient: QueryClient,
  directory: string | undefined,
  info: Session,
) {
  if (info.parentID) return
  const keys = findSessionsCacheKeys(queryClient, directory, info)
  if (keys.length === 0) {
    // Probably a session in a project we have not seen yet.
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    return
  }
  for (const key of keys) {
    queryClient.setQueryData<Array<Session>>(key, (sessions) => {
      if (!sessions) return sessions
      const rest = sessions.filter((s) => s.id !== info.id)
      return [...rest, info].sort((a, b) => b.time.updated - a.time.updated)
    })
  }
}

function updateMessages(
  queryClient: QueryClient,
  sessionId: string,
  updater: (messages: Array<MessageWithParts>) => Array<MessageWithParts>,
) {
  queryClient.setQueryData<Array<MessageWithParts>>(
    ['messages', sessionId],
    (messages) => (messages ? updater(messages) : messages),
  )
}

function upsertQuestion(queryClient: QueryClient, question: QuestionRequest) {
  queryClient.setQueryData<Array<QuestionRequest>>(
    ['questions', question.sessionID],
    (questions) => {
      const rest = (questions ?? []).filter((item) => item.id !== question.id)
      return [...rest, question].sort((a, b) => a.id.localeCompare(b.id))
    },
  )
}

export function applyEvent(
  queryClient: QueryClient,
  directory: string | undefined,
  event: Event,
) {
  switch (event.type) {
    case 'session.created':
    case 'session.updated': {
      const info = event.properties.info
      upsertSession(queryClient, directory ?? info.directory, info)
      queryClient.setQueryData<Session>(['session', info.id], info)
      if (event.type === 'session.created' && info.parentID) {
        void queryClient.invalidateQueries({
          queryKey: ['session-descendants'],
        })
      }
      break
    }
    case 'session.deleted': {
      const info = event.properties.info
      for (const key of findSessionsCacheKeys(queryClient, directory, info)) {
        queryClient.setQueryData<Array<Session>>(key, (sessions) =>
          sessions?.filter((s) => s.id !== info.id),
        )
      }
      queryClient.removeQueries({ queryKey: ['messages', info.id] })
      queryClient.removeQueries({ queryKey: ['session', info.id] })
      if (info.parentID) {
        void queryClient.invalidateQueries({
          queryKey: ['session-descendants'],
        })
      }
      break
    }
    case 'message.updated': {
      const info: Message = event.properties.info
      updateMessages(queryClient, info.sessionID, (current) => {
        // A real user message replaces any optimistic placeholder, but we
        // keep the placeholder's parts until real parts stream in so the
        // bubble doesn't flash out.
        let optimisticParts: Array<Part> = []
        let messages = current
        if (info.role === 'user') {
          optimisticParts = current
            .filter((m) => m.info.id.startsWith('optimistic-'))
            .flatMap((m) => m.parts)
          messages = current.filter(
            (m) => !m.info.id.startsWith('optimistic-'),
          )
        }
        const index = messages.findIndex((m) => m.info.id === info.id)
        if (index === -1) {
          return [...messages, { info, parts: optimisticParts }]
        }
        const next = [...messages]
        next[index] = { ...next[index], info }
        return next
      })
      break
    }
    case 'message.removed': {
      const { sessionID, messageID } = event.properties
      updateMessages(queryClient, sessionID, (messages) =>
        messages.filter((m) => m.info.id !== messageID),
      )
      break
    }
    case 'message.part.updated': {
      const part: Part = event.properties.part
      updateMessages(queryClient, part.sessionID, (messages) => {
        const index = messages.findIndex((m) => m.info.id === part.messageID)
        if (index === -1) return messages
        const message = messages[index]
        const partIndex = message.parts.findIndex((p) => p.id === part.id)
        const parts =
          partIndex === -1
            ? [
                // Real parts supersede optimistic placeholders.
                ...message.parts.filter(
                  (p) => !p.id.startsWith('optimistic-'),
                ),
                part,
              ]
            : message.parts.map((p, i) => (i === partIndex ? part : p))
        const next = [...messages]
        next[index] = { ...message, parts }
        return next
      })
      break
    }
    case 'message.part.removed': {
      const { sessionID, messageID, partID } = event.properties
      updateMessages(queryClient, sessionID, (messages) =>
        messages.map((m) =>
          m.info.id === messageID
            ? { ...m, parts: m.parts.filter((p) => p.id !== partID) }
            : m,
        ),
      )
      break
    }
    case 'session.status': {
      const { sessionID, status } = event.properties
      queryClient.setQueryData<Record<string, SessionStatus>>(
        ['session-status'],
        (map) => ({ ...map, [sessionID]: status }),
      )
      break
    }
    case 'session.idle': {
      const { sessionID } = event.properties
      queryClient.setQueryData<Record<string, SessionStatus>>(
        ['session-status'],
        (map) => ({ ...map, [sessionID]: { type: 'idle' } }),
      )
      break
    }
    case 'permission.updated': {
      const permission = event.properties as PendingPermission
      queryClient.setQueryData<Array<PendingPermission>>(
        ['permissions', permission.sessionID],
        (permissions) => {
          const rest = (permissions ?? []).filter(
            (p) => p.id !== permission.id,
          )
          return [...rest, permission]
        },
      )
      break
    }
    case 'permission.replied': {
      const properties = event.properties as {
        sessionID: string
        permissionID?: string
        requestID?: string
      }
      const permissionID = properties.permissionID ?? properties.requestID
      queryClient.setQueryData<Array<PendingPermission>>(
        ['permissions', properties.sessionID],
        (permissions) => permissions?.filter((p) => p.id !== permissionID),
      )
      break
    }
    case 'session.error': {
      const { sessionID, error } = event.properties
      if (sessionID && error) {
        queryClient.setQueryData(['session-error', sessionID], error)
      }
      break
    }
    default: {
      // Forward-compat: newer servers stream text via message.part.delta.
      const unknown = event as { type: string; properties?: any }
      if (unknown.type === 'permission.asked' && unknown.properties) {
        const permission = unknown.properties as PendingPermission
        queryClient.setQueryData<Array<PendingPermission>>(
          ['permissions', permission.sessionID],
          (permissions) => {
            const rest = (permissions ?? []).filter(
              (item) => item.id !== permission.id,
            )
            return [...rest, permission]
          },
        )
        break
      }
      if (unknown.type === 'question.asked' && unknown.properties) {
        const question = unknown.properties as QuestionRequest
        markQuestionEvent(question.sessionID)
        upsertQuestion(queryClient, question)
        break
      }
      if (
        (unknown.type === 'question.replied' ||
          unknown.type === 'question.rejected') &&
        unknown.properties
      ) {
        const properties = unknown.properties as {
          sessionID: string
          requestID: string
        }
        markQuestionEvent(properties.sessionID)
        queryClient.setQueryData<Array<QuestionRequest>>(
          ['questions', properties.sessionID],
          (questions) =>
            questions?.filter((item) => item.id !== properties.requestID),
        )
        break
      }
      if (unknown.type === 'message.part.delta' && unknown.properties) {
        const { sessionID, messageID, partID, field, delta } =
          unknown.properties
        if (field !== 'text' || typeof delta !== 'string') break
        updateMessages(queryClient, sessionID, (messages) =>
          messages.map((m) =>
            m.info.id === messageID
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.id === partID && 'text' in p
                      ? { ...p, text: (p.text ?? '') + delta }
                      : p,
                  ),
                }
              : m,
          ),
        )
      }
      break
    }
  }
}

/**
 * Subscribe to the OpenCode global event stream and mirror events into the
 * query cache. Mount once at the app root (client only).
 */
export function useGlobalEvents() {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    let closed = false
    let source: EventSource | null = null
    let hadError = false

    function connect() {
      if (closed) return
      source = new EventSource('/api/proxy/global/event')

      source.onopen = () => {
        // Close the gap between request snapshots and the SSE connection.
        void queryClient.invalidateQueries({ queryKey: ['permissions'] })
        void queryClient.invalidateQueries({ queryKey: ['questions'] })
        if (hadError) {
          // We may have missed events while disconnected; resync.
          void queryClient.invalidateQueries({ queryKey: ['sessions'] })
          void queryClient.invalidateQueries({ queryKey: ['messages'] })
          void queryClient.invalidateQueries({ queryKey: ['session-status'] })
          hadError = false
        }
      }

      source.onerror = () => {
        hadError = true
        // EventSource reconnects automatically unless closed.
        if (source?.readyState === EventSource.CLOSED && !closed) {
          source.close()
          setTimeout(connect, 3000)
        }
      }

      source.onmessage = (msg) => {
        let envelope: GlobalEventEnvelope
        try {
          envelope = JSON.parse(msg.data)
        } catch {
          return
        }
        const event =
          envelope.payload ??
          (envelope.type
            ? ({
                type: envelope.type,
                properties: envelope.properties,
              } as Event)
            : undefined)
        if (!event) return
        try {
          applyEvent(queryClient, envelope.directory, event)
        } catch (err) {
          console.error('Failed to apply event', event.type, err)
        }
      }
    }

    connect()
    return () => {
      closed = true
      source?.close()
    }
  }, [queryClient])
}

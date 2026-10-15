import * as React from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  OpenCodeEvent,
  SessionMessageInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageAssistantReasoning,
  SessionMessageContentUpdated,
  SessionInfo,
} from '@opencode/client'
import {
  markSessionEvent,
  type Session,
  type SessionStatus,
  type PendingPermission,
  type FormInfo,
} from './oc'

const messageID = (id: string) => id.replace(/^evt_/, 'msg_')
export type TranscriptEvent = OpenCodeEvent | SessionMessageContentUpdated

export function projectMessageEvent(
  current: SessionMessageInfo[],
  event: TranscriptEvent,
  session?: SessionInfo,
): SessionMessageInfo[] {
  const messages = structuredClone(current)
  const append = (item: SessionMessageInfo) => {
    const at = messages.findIndex((m) => m.id === item.id)
    if (at < 0) messages.push(item)
    else messages[at] = item
  }
  const data = event.data
  const assistant =
    'assistantMessageID' in data
      ? messages.find(
          (m): m is SessionMessageAssistant =>
            m.type === 'assistant' && m.id === data.assistantMessageID,
        )
      : undefined
  const tool =
    assistant && 'id' in data
      ? assistant.content.findLast(
          (p): p is SessionMessageAssistantTool =>
            p.type === 'tool' && p.id === data.id,
        )
      : undefined
  const text = assistant?.content.findLast((p) => p.type === 'text')
  const reasoning = assistant?.content.findLast(
    (p): p is SessionMessageAssistantReasoning =>
      p.type === 'reasoning' && !p.time?.completed,
  )
  const compaction = messages.findLast(
    (m) => m.type === 'compaction' && m.status === 'running',
  )
  switch (event.type) {
    case 'session.message.content.updated': {
      const message = messages.find((m) => m.id === event.data.messageID)
      if (message?.type === 'assistant') message.content = event.data.content
      break
    }
    case 'session.moved':
      append({
        id: messageID(event.id),
        type: 'location-switched',
        location: event.data.location,
        projectID: event.data.projectID,
        subpath: event.data.subpath,
        ...(session
          ? {
              previous: {
                location: session.location,
                projectID: session.projectID,
                subpath: session.subpath,
              },
            }
          : {}),
        time: { created: event.created },
      })
      break
    case 'session.inbox.enqueued': {
      const item = event.data.item
      if (item.type === 'user' || item.type === 'synthetic')
        append({
          id: event.data.inboxID,
          type: item.type,
          ...item.payload,
          time: { created: event.created },
        } as SessionMessageInfo)
      break
    }
    case 'session.inbox.delivered': {
      const at = messages.findIndex((m) => m.id === event.data.inboxID)
      if (at >= 0) {
        const [item] = messages.splice(at, 1)
        item.time.created = event.created
        messages.push(item)
      }
      break
    }
    case 'session.inbox.cancelled':
      return messages.filter((m) => m.id !== event.data.inboxID)
    case 'session.agent.selected':
      append({
        id: messageID(event.id),
        type: 'agent-switched',
        agent: event.data.agent,
        previous: event.data.previous,
        time: { created: event.created },
      })
      break
    case 'session.model.selected':
      append({
        id: messageID(event.id),
        type: 'model-switched',
        model: event.data.model,
        previous: event.data.previous,
        time: { created: event.created },
      })
      break
    case 'session.synthetic':
      append({
        id: messageID(event.id),
        type: 'synthetic',
        text: event.data.text,
        description: event.data.description,
        metadata: event.data.metadata,
        time: { created: event.created },
      })
      break
    case 'session.instructions.updated':
      if (event.data.text !== undefined)
        append({
          id: messageID(event.id),
          type: 'system',
          text: event.data.text,
          description: `Instructions updated: ${Object.keys(event.data.delta).join(', ')}`,
          metadata: event.metadata,
          time: { created: event.created },
        })
      break
    case 'session.skill.activated':
      append({
        id: messageID(event.id),
        type: 'skill',
        skill: event.data.id,
        name: event.data.name,
        text: event.data.text,
        time: { created: event.created },
      })
      break
    case 'session.step.started': {
      const previous = messages.findLast(
        (m) => m.type === 'assistant' && !m.time.completed,
      )
      if (
        previous?.type === 'assistant' &&
        previous.id !== event.data.assistantMessageID
      ) {
        previous.time.completed = event.created
        previous.retry = undefined
      }
      const fresh: SessionMessageAssistant = {
        id: event.data.assistantMessageID,
        type: 'assistant',
        agent: event.data.agent,
        model: event.data.model,
        metadata: event.metadata,
        content: assistant?.content ?? [],
        snapshot: event.data.snapshot
          ? { start: event.data.snapshot }
          : undefined,
        time: { created: event.data.started },
      }
      append(fresh)
      break
    }
    case 'session.step.streamed':
      if (assistant) assistant.time.streamed = event.created
      break
    case 'session.step.ended':
      if (assistant) {
        Object.assign(assistant, {
          finish: event.data.finish,
          rawFinish: event.data.rawFinish,
          providerState: event.data.providerState,
          cost: event.data.cost,
          tokens: event.data.tokens,
        })
        assistant.time.completed = event.created
        if (event.data.snapshot)
          assistant.snapshot = {
            ...assistant.snapshot,
            end: event.data.snapshot,
          }
      }
      break
    case 'session.step.failed':
      if (assistant) {
        Object.assign(assistant, {
          finish: event.data.finish ?? 'error',
          rawFinish: event.data.rawFinish,
          error: event.data.error,
          retry: undefined,
          providerState: event.data.providerState,
          cost: event.data.cost,
          tokens: event.data.tokens,
        })
        assistant.time.completed = event.created
      }
      break
    case 'session.text.started':
      assistant?.content.push({ type: 'text', text: '' })
      break
    case 'session.text.delta':
      if (text) text.text += event.data.delta
      break
    case 'session.text.ended':
      if (text) text.text = event.data.text
      break
    case 'session.reasoning.started':
      assistant?.content.push({
        type: 'reasoning',
        text: '',
        state: event.data.state,
        time: { created: event.created },
      })
      break
    case 'session.reasoning.delta':
      if (reasoning) reasoning.text += event.data.delta
      break
    case 'session.reasoning.ended':
      if (reasoning) {
        reasoning.text = event.data.text
        reasoning.time = {
          created: reasoning.time?.created ?? event.created,
          completed: event.created,
        }
        if (event.data.state !== undefined) reasoning.state = event.data.state
      }
      break
    case 'session.tool.input.started':
      assistant?.content.push({
        type: 'tool',
        id: event.data.id,
        name: event.data.name,
        state: { status: 'streaming', input: '' },
        time: { created: event.created },
      })
      break
    case 'session.tool.input.delta':
      if (tool?.state.status === 'streaming')
        tool.state.input += event.data.delta
      break
    case 'session.tool.input.ended':
      if (tool?.state.status === 'streaming') tool.state.input = event.data.text
      break
    case 'session.tool.called':
      if (tool) {
        tool.time.ran = event.created
        tool.executed = event.data.executed
        tool.providerState = event.data.state
        tool.state = {
          status: 'running',
          input: event.data.input,
          metadata: {},
        }
      }
      break
    case 'session.tool.progress':
      if (tool?.state.status === 'running')
        tool.state.metadata = event.data.metadata
      break
    case 'session.tool.success':
      if (tool?.state.status === 'running') {
        tool.state = {
          status: 'completed',
          input: tool.state.input,
          content: event.data.content,
          metadata: event.data.metadata,
        }
        tool.time.completed = event.created
        tool.executed = event.data.executed || tool.executed === true
        tool.providerResultState = event.data.resultState
      }
      break
    case 'session.tool.failed':
      if (tool) {
        tool.state = {
          status: 'error',
          input: typeof tool.state.input === 'string' ? {} : tool.state.input,
          error: event.data.error,
          content: event.data.content,
          metadata: event.data.metadata,
        }
        tool.time.completed = event.created
        tool.executed = event.data.executed || tool.executed === true
        tool.providerResultState = event.data.resultState
      }
      break
    case 'session.retry.scheduled':
      if (assistant)
        assistant.retry = {
          attempt: event.data.attempt,
          at: event.data.at,
          error: event.data.error,
        }
      break
    case 'session.compaction.started':
      append({
        id: event.data.inputID ?? messageID(event.id),
        type: 'compaction',
        status: 'running',
        reason: event.data.reason,
        summary: '',
        recent: event.data.recent ?? '',
        time: { created: event.created },
      })
      break
    case 'session.compaction.delta':
      if (compaction?.type === 'compaction' && compaction.status === 'running')
        compaction.summary += event.data.text
      break
    case 'session.compaction.ended':
      append({
        id: compaction?.id ?? messageID(event.id),
        type: 'compaction',
        status: 'completed',
        reason: event.data.reason,
        model: event.data.model,
        summary: event.data.text,
        recent: event.data.recent,
        cost: event.data.cost,
        tokens: event.data.tokens,
        providerState: event.data.providerState,
        providerContext: event.data.providerContext,
        time: compaction?.time ?? { created: event.created },
      })
      break
    case 'session.compaction.failed':
      append({
        id: compaction?.id ?? event.data.inputID ?? messageID(event.id),
        type: 'compaction',
        status: 'failed',
        reason: event.data.reason ?? 'manual',
        error: event.data.error ?? {
          type: 'compaction.failed',
          message: 'Compaction failed',
        },
        cost: event.data.cost,
        tokens: event.data.tokens,
        time: compaction?.time ?? { created: event.created },
      })
      break
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted': {
      const last = messages.findLast(
        (m) => m.type === 'assistant' && !m.time.completed,
      )
      if (last?.type === 'assistant') last.retry = undefined
      if (
        event.type === 'session.execution.interrupted' &&
        event.data.reason === 'shutdown'
      )
        break
      append({
        id: messageID(event.id),
        type: 'idle',
        outcome:
          event.type === 'session.execution.succeeded'
            ? 'succeeded'
            : event.type === 'session.execution.failed'
              ? 'failed'
              : 'interrupted',
        ...(event.type === 'session.execution.failed'
          ? { error: event.data.error }
          : {}),
        time: { created: event.created },
      })
      break
    }
    case 'session.revert.committed':
      return messages.filter((m) => m.id < event.data.to)
    case 'session.shell.started':
      append({
        id: messageID(event.id),
        type: 'shell',
        shellID: event.data.shell.id,
        command: event.data.shell.command,
        status: event.data.shell.status,
        exit: event.data.shell.exit,
        time: { created: event.created },
      })
      break
    case 'session.shell.ended': {
      const shell = messages.findLast(
        (m) => m.type === 'shell' && m.shellID === event.data.shell.id,
      )
      if (shell?.type === 'shell') {
        shell.status = event.data.shell.status
        shell.exit = event.data.shell.exit
        shell.output = event.data.output
        shell.time.completed = event.created
      }
      break
    }
  }
  return messages
}

export function applyEvent(qc: QueryClient, event: TranscriptEvent) {
  if (event.type === 'server.connected' || event.type === 'location.shutdown') {
    void qc.invalidateQueries()
    return
  }
  if ('sessionID' in event.data) {
    const id = event.data.sessionID
    markSessionEvent(id)
    qc.setQueryData<SessionMessageInfo[]>(['messages', id], (current) =>
      current
        ? projectMessageEvent(
            current,
            event,
            qc.getQueryData<Session>(['session', id]),
          )
        : current,
    )
    if (
      event.type === 'session.execution.started' ||
      event.type.startsWith('session.execution.')
    ) {
      qc.setQueryData<Record<string, SessionStatus>>(
        ['session-status'],
        (current) => ({
          ...current,
          [id]: {
            type: event.type === 'session.execution.started' ? 'busy' : 'idle',
          },
        }),
      )
      if (event.type !== 'session.execution.started') {
        void qc.invalidateQueries({ queryKey: ['session', id] })
        void qc.invalidateQueries({ queryKey: ['messages', id] })
        void qc.invalidateQueries({ queryKey: ['sessions'] })
        void qc.invalidateQueries({ queryKey: ['sessions-all'] })
        qc.setQueryData(['session-diff-available', id], true)
        qc.setQueryData<number>(
          ['session-diff-revision', id],
          (n) => (n ?? 0) + 1,
        )
      }
    }
    if (event.type === 'session.execution.failed')
      qc.setQueryData(['session-error', id], event.data.error)
    if (event.type === 'permission.asked')
      qc.setQueryData<PendingPermission[]>(['permissions', id], (current) => [
        ...(current ?? []).filter((p) => p.id !== event.data.id),
        event.data,
      ])
    if (event.type === 'permission.replied')
      qc.setQueryData<PendingPermission[]>(['permissions', id], (current) =>
        current?.filter((p) => p.id !== event.data.requestID),
      )
    if (event.type === 'form.replied' || event.type === 'form.cancelled')
      qc.setQueryData<FormInfo[]>(['questions', id], (current) =>
        current?.filter((f) => f.id !== event.data.id),
      )
    if (
      [
        'session.created',
        'session.deleted',
        'session.renamed',
        'session.agent.selected',
        'session.model.selected',
        'session.revert.staged',
        'session.revert.cleared',
        'session.revert.committed',
        'session.moved',
      ].includes(event.type)
    ) {
      void qc.invalidateQueries({ queryKey: ['session', id] })
      void qc.invalidateQueries({ queryKey: ['sessions'] })
      void qc.invalidateQueries({ queryKey: ['sessions-all'] })
      void qc.invalidateQueries({ queryKey: ['session-descendants'] })
    }
    if (event.type === 'session.deleted') {
      qc.removeQueries({ queryKey: ['session', id] })
      qc.removeQueries({ queryKey: ['messages', id] })
    }
  }
  if (event.type === 'form.created') {
    const form = event.data.form
    markSessionEvent(form.sessionID)
    qc.setQueryData<FormInfo[]>(['questions', form.sessionID], (current) => [
      ...(current ?? []).filter((f) => f.id !== form.id),
      form,
    ])
  }
  if (event.type === 'project.updated')
    void qc.invalidateQueries({ queryKey: ['projects'] })
  const catalogs: Record<string, string> = {
    'agent.updated': 'agents',
    'command.updated': 'commands',
    'skill.updated': 'skills',
    'provider.updated': 'providers',
    'model.updated': 'providers',
    'integration.updated': 'providers',
  }
  const catalog = catalogs[event.type]
  if (catalog) void qc.invalidateQueries({ queryKey: [catalog] })
}

export function useGlobalEvents() {
  const qc = useQueryClient()
  React.useEffect(() => {
    let source: EventSource
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    const connect = () => {
      if (closed) return
      source = new EventSource('/api/proxy/api/event')
      source.onopen = () => {
        void qc.invalidateQueries()
      }
      source.onmessage = ({ data }) => {
        try {
          applyEvent(qc, JSON.parse(data) as OpenCodeEvent)
        } catch (error) {
          console.error('Failed to apply OpenCode event', error)
        }
      }
      source.onerror = () => {
        source.close()
        if (!closed) timer = setTimeout(connect, 1500)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      source.close()
    }
  }, [qc])
}

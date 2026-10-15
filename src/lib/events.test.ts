import { expect, test } from 'bun:test'
import type { OpenCodeEvent, SessionMessageInfo } from '@opencode/client'
import { projectMessageEvent, type TranscriptEvent } from './events'

test('live text and tool events produce the reloaded V2 transcript', () => {
  let messages: SessionMessageInfo[] = []
  const emit = (type: string, data: object, created = 1) => {
    messages = projectMessageEvent(messages, {
      id: `evt_${created}`,
      type,
      created,
      data: { sessionID: 'ses_1', assistantMessageID: 'msg_2', ...data },
    } as OpenCodeEvent)
  }
  emit('session.inbox.enqueued', {
    inboxID: 'msg_1',
    item: { type: 'user', delivery: 'steer', payload: { text: 'hello' } },
  })
  emit(
    'session.step.started',
    { started: 2, agent: 'build', model: { providerID: 'mock', id: 'mock' } },
    2,
  )
  emit('session.text.started', {}, 3)
  emit('session.text.delta', { delta: 'hel' }, 4)
  emit('session.text.ended', { text: 'hello' }, 5)
  emit('session.tool.input.started', { id: 'tool_1', name: 'shell' }, 6)
  emit('session.tool.called', { id: 'tool_1', input: { command: 'pwd' } }, 7)
  emit(
    'session.tool.success',
    { id: 'tool_1', executed: true, content: [{ type: 'text', text: '/tmp' }] },
    8,
  )
  emit(
    'session.step.ended',
    {
      finish: 'stop',
      cost: 0,
      tokens: {
        input: 10,
        output: 5,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    9,
  )
  expect(messages[0]).toEqual({
    id: 'msg_1',
    type: 'user',
    text: 'hello',
    time: { created: 1 },
  })
  expect(messages[1]).toMatchObject({
    id: 'msg_2',
    type: 'assistant',
    time: { created: 2, completed: 9 },
    content: [
      { type: 'text', text: 'hello' },
      {
        type: 'tool',
        id: 'tool_1',
        name: 'shell',
        state: {
          status: 'completed',
          input: { command: 'pwd' },
          content: [{ type: 'text', text: '/tmp' }],
        },
      },
    ],
  })
})

test('Code Mode metadata survives progress and success projection', () => {
  let messages: SessionMessageInfo[] = [
    {
      id: 'msg_2',
      type: 'assistant',
      agent: 'build',
      model: { id: 'mock', providerID: 'mock' },
      content: [
        {
          type: 'tool',
          id: 'exec',
          name: 'execute',
          state: {
            status: 'running',
            input: { code: 'return tools.search({})' },
            metadata: {},
          },
          time: { created: 1 },
        },
      ],
      time: { created: 1 },
    },
  ]
  const toolCalls = [
    { tool: 'search', input: { query: 'test' }, status: 'running' },
  ]
  messages = projectMessageEvent(messages, {
    id: 'evt_progress',
    created: 2,
    type: 'session.tool.progress',
    data: {
      sessionID: 'ses_1',
      assistantMessageID: 'msg_2',
      id: 'exec',
      metadata: { toolCalls },
    },
  } as OpenCodeEvent)
  expect(messages[0]).toMatchObject({
    content: [{ state: { metadata: { toolCalls } } }],
  })
  toolCalls[0].status = 'completed'
  messages = projectMessageEvent(messages, {
    id: 'evt_success',
    durable: { aggregateID: 'ses_1', seq: 3, version: 2 },
    created: 3,
    type: 'session.tool.success',
    data: {
      sessionID: 'ses_1',
      assistantMessageID: 'msg_2',
      id: 'exec',
      metadata: { toolCalls },
      content: [{ type: 'text', text: 'found' }],
      executed: true,
    },
  } as OpenCodeEvent)
  expect(messages[0]).toMatchObject({
    content: [
      {
        state: {
          status: 'completed',
          metadata: { toolCalls },
          content: [{ type: 'text', text: 'found' }],
        },
      },
    ],
  })
})

test('replacement content and moves match reloaded transcript entries', () => {
  const original: SessionMessageInfo[] = [
    {
      id: 'msg_1',
      type: 'assistant',
      agent: 'build',
      model: { id: 'mock', providerID: 'mock' },
      content: [{ type: 'text', text: 'before' }],
      time: { created: 1 },
    },
  ]
  const replaced = projectMessageEvent(original, {
    id: 'evt_2',
    created: 2,
    type: 'session.message.content.updated',
    data: {
      sessionID: 'ses_1',
      messageID: 'msg_1',
      content: [{ type: 'text', text: 'after' }],
    },
  } as TranscriptEvent)
  expect(replaced[0]).toMatchObject({ content: [{ text: 'after' }] })
  const moved = projectMessageEvent(replaced, {
    id: 'evt_3',
    created: 3,
    type: 'session.moved',
    data: {
      sessionID: 'ses_1',
      projectID: 'project',
      location: { directory: '/tmp/new' },
    },
  } as TranscriptEvent)
  expect(moved[1]).toEqual({
    id: 'msg_3',
    type: 'location-switched',
    projectID: 'project',
    location: { directory: '/tmp/new' },
    time: { created: 3 },
  })
})

test('a new assistant step clears retry status on the previous step', () => {
  const original: SessionMessageInfo[] = [
    {
      id: 'msg_1',
      type: 'assistant',
      agent: 'build',
      model: { id: 'mock', providerID: 'mock' },
      content: [],
      retry: {
        attempt: 1,
        at: 2,
        error: { type: 'unknown', message: 'retry' },
      },
      time: { created: 1 },
    },
  ]
  const messages = projectMessageEvent(original, {
    id: 'evt_3',
    created: 3,
    type: 'session.step.started',
    data: {
      sessionID: 'ses_1',
      assistantMessageID: 'msg_2',
      started: 3,
      agent: 'build',
      model: { id: 'mock', providerID: 'mock' },
    },
  } as TranscriptEvent)
  expect(messages[0]).toMatchObject({
    retry: undefined,
    time: { completed: 3 },
  })
})

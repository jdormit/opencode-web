import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  MessageView,
  groupParts,
  reasoningLabel,
  forkPoint,
  nestedToolCalls,
  backgroundableToolStart,
  backgroundButtonDelay,
} from './MessageView'
import type { Message, ToolPart } from '~/lib/oc'

test('synthetic messages render no user-facing content', () => {
  const message: Message = {
    id: 'msg_synthetic',
    type: 'synthetic',
    text: 'Internal agent instructions',
    description: 'Agent-only notification',
    time: { created: 1 },
  }
  expect(
    renderToStaticMarkup(
      createElement(MessageView, { message, directory: '/tmp' }),
    ),
  ).toBe('')
})

test('background button waits until a call has run for more than two seconds', () => {
  expect(backgroundButtonDelay(1000, 1000)).toBe(2001)
  expect(backgroundButtonDelay(1000, 2999)).toBe(2)
  expect(backgroundButtonDelay(1000, 3000)).toBe(1)
  expect(backgroundButtonDelay(1000, 3001)).toBe(0)
  expect(backgroundButtonDelay(1000, 5000)).toBe(0)
})

test('only running foreground shell and subagent calls can be backgrounded', () => {
  const part: ToolPart = {
    type: 'tool',
    id: 'call_background',
    name: 'shell',
    time: { created: 1000, ran: 1500 },
    state: { status: 'running', input: {}, metadata: {} },
  }
  expect(backgroundableToolStart(part)).toBe(1500)
  expect(backgroundableToolStart({ ...part, name: 'subagent' })).toBe(1500)
  expect(backgroundableToolStart({ ...part, time: { created: 1000 } })).toBe(
    1000,
  )
  expect(backgroundableToolStart({ ...part, name: 'read' })).toBeUndefined()
  expect(backgroundableToolStart({ ...part, name: 'execute' })).toBeUndefined()
  expect(
    backgroundableToolStart({
      ...part,
      state: {
        status: 'running',
        input: { background: true },
        metadata: {},
      },
    }),
  ).toBeUndefined()
  expect(
    backgroundableToolStart({
      ...part,
      state: {
        status: 'running',
        input: {},
        metadata: { background: true },
      },
    }),
  ).toBeUndefined()
  expect(
    backgroundableToolStart({
      ...part,
      state: {
        status: 'streaming',
        input: '',
      },
    }),
  ).toBeUndefined()
  expect(
    backgroundableToolStart({
      ...part,
      state: {
        status: 'completed',
        input: {},
        content: [{ type: 'text', text: 'Done' }],
      },
    }),
  ).toBeUndefined()
  expect(
    backgroundableToolStart({
      ...part,
      state: {
        status: 'error',
        input: {},
        error: { type: 'unknown', message: 'Failed' },
      },
    }),
  ).toBeUndefined()
})

test('renders V2 user attachments and assistant content', () => {
  const user: Message = {
    id: 'msg_1',
    type: 'user',
    text: 'Hello',
    files: [
      {
        data: 'YQ==',
        mime: 'image/png',
        name: 'a.png',
        source: { type: 'inline' },
      },
    ],
    time: { created: 1 },
  }
  const html = renderToStaticMarkup(
    createElement(MessageView, { message: user, directory: '/tmp' }),
  )
  expect(html).toContain('Hello')
  expect(html).toContain('data:image/png;base64,YQ==')
  const assistant: Message = {
    id: 'msg_2',
    type: 'assistant',
    agent: 'build',
    model: { id: 'mock', providerID: 'mock' },
    content: [
      {
        type: 'tool',
        id: 'call_1',
        name: 'shell',
        state: {
          status: 'completed',
          input: { command: 'pwd' },
          content: [{ type: 'text', text: '/tmp' }],
        },
        time: { created: 2, completed: 3 },
      },
    ],
    time: { created: 2, completed: 4 },
  }
  const reply = renderToStaticMarkup(
    createElement(MessageView, { message: assistant, directory: '/tmp' }),
  )
  expect(reply).toContain('shell')
  expect(reply).toContain('/tmp')
})

test('groups adjacent reasoning and uses V2 timestamps', () => {
  const parts = [
    {
      type: 'reasoning' as const,
      text: 'one',
      time: { created: 100, completed: 500 },
    },
    { type: 'text' as const, text: '' },
    {
      type: 'reasoning' as const,
      text: 'two',
      time: { created: 500, completed: 1100 },
    },
  ] as const
  expect(groupParts([...parts])).toHaveLength(1)
  expect(reasoningLabel([parts[0], parts[2]])).toBe('Thought for 1s')
})

test('fork after a turn uses the next message boundary', () => {
  expect(
    forkPoint([{ id: 'msg_a' }, { id: 'msg_b' }] as Message[], 'msg_a'),
  ).toEqual({ messageID: 'msg_b' })
})

test('Code Mode nested calls render live progress and persisted outcomes', () => {
  const tool = {
    type: 'tool' as const,
    id: 'execute_1',
    name: 'execute',
    time: { created: 1 },
    state: {
      status: 'running' as const,
      input: { code: 'return tools.memory.search({query: "hello"})' },
      metadata: {
        toolCalls: [
          {
            tool: 'memory.search',
            input: { query: 'hello' },
            status: 'running',
          },
        ],
      },
    },
  }
  expect(nestedToolCalls(tool)).toEqual([
    { tool: 'memory.search', input: { query: 'hello' }, status: 'running' },
  ])
  const message: Message = {
    id: 'msg_execute',
    type: 'assistant',
    agent: 'build',
    model: { id: 'mock', providerID: 'mock' },
    content: [tool],
    time: { created: 1 },
  }
  const live = renderToStaticMarkup(
    createElement(MessageView, { message, directory: '/tmp' }),
  )
  expect(live).toContain('memory.search')
  expect(live).toContain('running')
  const persisted: Message = {
    ...message,
    content: [
      {
        ...tool,
        state: {
          status: 'completed',
          input: tool.state.input,
          metadata: {
            toolCalls: [
              {
                tool: 'memory.search',
                input: { query: 'hello' },
                status: 'completed',
              },
              { tool: 'memory.save', status: 'error' },
            ],
          },
          content: [{ type: 'text', text: 'aggregate result' }],
        },
      },
    ],
  }
  const reloaded = renderToStaticMarkup(
    createElement(MessageView, { message: persisted, directory: '/tmp' }),
  )
  expect(reloaded).toContain('memory.search')
  expect(reloaded).toContain('completed')
  expect(reloaded).toContain('memory.save')
  expect(reloaded).toContain('error')
  expect(reloaded).toContain('aggregate result')
})

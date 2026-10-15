import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  MessageView,
  groupParts,
  reasoningLabel,
  forkPoint,
  nestedToolCalls,
} from './MessageView'
import type { Message } from '~/lib/oc'

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

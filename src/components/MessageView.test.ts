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
  toolSummary,
  toolElapsed,
} from './MessageView'
import type { Message, ToolPart } from '~/lib/oc'

test('shell and subagent timers use execution timestamps and stop at completion', () => {
  const part: ToolPart = {
    type: 'tool',
    id: 'call_timer',
    name: 'shell',
    time: { created: 1000, ran: 2000 },
    state: { status: 'running', input: {}, metadata: {} },
  }
  expect(toolElapsed(part, 2000)).toBe('0s')
  expect(toolElapsed(part, 5000)).toBe('3s')
  expect(toolElapsed({ ...part, name: 'subagent' }, 64000)).toBe('1m 2s')
  expect(toolElapsed({ ...part, time: { created: 1000 } }, 5000)).toBe('4s')
  expect(toolElapsed(part, 1000)).toBe('0s')
  expect(toolElapsed({ ...part, name: 'read' }, 5000)).toBeUndefined()
  expect(toolElapsed({
    ...part,
    state: { status: 'streaming', input: '' },
  }, 5000)).toBeUndefined()
  const completed: ToolPart = {
    ...part,
    time: { ...part.time, completed: 7000 },
    state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'Done' }] },
  }
  expect(toolElapsed(completed, 10000)).toBe('5s')
  expect(toolElapsed(completed, 100000)).toBe('5s')
  expect(toolElapsed({ ...completed, time: part.time }, 10000)).toBeUndefined()
  expect(toolElapsed({
    ...completed,
    state: { status: 'error', input: {}, error: { type: 'unknown', message: 'Failed' } },
  }, 10000)).toBe('5s')
  expect(toolElapsed({
    ...part,
    state: { status: 'running', input: { background: true }, metadata: {} },
  }, 5000)).toBe('3s')
})

test('tool summaries use commands, paths, searches, and descriptions', () => {
  expect(toolSummary({ command: 'pwd', description: 'Working directory' })).toBe('pwd')
  expect(toolSummary({ filePath: '/src/app.ts' })).toBe('/src/app.ts')
  expect(toolSummary({ path: '/src' })).toBe('/src')
  expect(toolSummary({ pattern: '**/*.ts' })).toBe('**/*.ts')
  expect(toolSummary({ query: 'tool cards' })).toBe('tool cards')
  expect(toolSummary({ url: 'https://example.com' })).toBe('https://example.com')
  expect(toolSummary({ description: 'Explore components' })).toBe('Explore components')
  expect(toolSummary({ code: 'return 1' })).toBe('return 1')
  expect(toolSummary({}, { title: 'Custom tool action' })).toBe('Custom tool action')
})

test('tool summaries ignore incomplete or unsupported inputs', () => {
  for (const input of [undefined, null, [], '{"command":', { command: 42 }, {}]) {
    expect(toolSummary(input)).toBeUndefined()
  }
  expect(toolSummary({ command: '  ', description: ' Useful action ' })).toBe('Useful action')
  expect(toolSummary({}, { title: {} })).toBeUndefined()
})

test('skill calls preview their skill ID', () => {
  expect(toolSummary({ id: 'plain-language' })).toBe('plain-language')
  expect(toolSummary({ id: '' })).toBeUndefined()
})

test('patch calls preview affected files and operations without patch contents', () => {
  expect(toolSummary({
    patchText: '*** Begin Patch\n*** Add File: src/new.ts\n+Hello\n*** Update File: src/old.ts\n@@\n-old\n+new\n*** Delete File: src/deleted.ts\n*** End Patch',
  })).toBe('Add src/new.ts · Update src/old.ts · Delete src/deleted.ts')
  expect(toolSummary({
    patchText: '*** Begin Patch\r\n*** Update File: old.ts\r\n*** Move to: new.ts\r\n*** End Patch',
  })).toBe('Update old.ts · Move to new.ts')
  expect(toolSummary({ patchText: '*** Begin Patch\n' })).toBeUndefined()
  expect(toolSummary({ patchText: '+*** Delete File: not-a-header.ts' })).toBeUndefined()
})

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
  expect(reply.match(/<summary>[\s\S]*?<\/summary>/)?.[0]).toContain('title="pwd">pwd</span>')
  expect(reply.match(/<summary>[\s\S]*?<\/summary>/)?.[0]).toContain('title="Elapsed time">0s</span>')
  expect(reply).not.toContain('<details open')
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
  expect(live.match(/<summary>[\s\S]*?<\/summary>/)?.[0]).toContain('return tools.memory.search')
  expect(live).toContain('title="hello">hello</span>')
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

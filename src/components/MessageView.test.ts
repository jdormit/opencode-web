import { describe, expect, test } from 'bun:test'
import type { MessageWithParts, ToolPart } from '~/lib/oc'
import {
  endsAssistantTurn,
  forkPoint,
  isFinishedAssistantTurn,
  subagentActivity,
  taskChildSessionIds,
  taskSessionId,
} from './MessageView'

function tool(
  id: string,
  name: string,
  state: Record<string, unknown>,
): ToolPart {
  return {
    id,
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: `call-${id}`,
    tool: name,
    state,
  } as unknown as ToolPart
}

function messages(parts: Array<ToolPart>): Array<MessageWithParts> {
  return [
    {
      info: {
        id: 'message-1',
        sessionID: 'session-1',
        role: 'assistant',
      },
      parts,
    } as unknown as MessageWithParts,
  ]
}

function turn(
  id: string,
  role: 'user' | 'assistant',
  time: Record<string, number> = { created: 1 },
  error?: Record<string, unknown>,
): MessageWithParts {
  return {
    info: { id, sessionID: 'session-1', role, time, error },
    parts: [],
  } as unknown as MessageWithParts
}

describe('isFinishedAssistantTurn', () => {
  test('completed assistant turns are finished', () => {
    expect(
      isFinishedAssistantTurn(
        turn('m1', 'assistant', { created: 1, completed: 2 }),
      ),
    ).toBe(true)
  })

  test('errored assistant turns are finished', () => {
    expect(
      isFinishedAssistantTurn(
        turn('m1', 'assistant', { created: 1 }, { name: 'MessageAbortedError', data: {} }),
      ),
    ).toBe(true)
  })

  test('streaming assistant turns are not finished', () => {
    expect(isFinishedAssistantTurn(turn('m1', 'assistant'))).toBe(false)
  })

  test('user messages are never finished turns', () => {
    expect(
      isFinishedAssistantTurn(turn('m1', 'user', { created: 1, completed: 2 })),
    ).toBe(false)
  })
})

describe('endsAssistantTurn', () => {
  const transcript = [
    turn('u1', 'user'),
    turn('a1', 'assistant', { created: 1, completed: 2 }),
    turn('a2', 'assistant', { created: 3, completed: 4 }),
    turn('u2', 'user'),
    turn('a3', 'assistant', { created: 5, completed: 6 }),
  ]

  test('an assistant message followed by a user message ends the turn', () => {
    expect(endsAssistantTurn(transcript, 2)).toBe(true)
  })

  test('an assistant message followed by another assistant message does not', () => {
    expect(endsAssistantTurn(transcript, 1)).toBe(false)
  })

  test('the last message of the transcript ends the turn', () => {
    expect(endsAssistantTurn(transcript, 4)).toBe(true)
  })

  test('user messages never end an assistant turn', () => {
    expect(endsAssistantTurn(transcript, 3)).toBe(false)
  })

  test('out-of-range indexes are not turn ends', () => {
    expect(endsAssistantTurn(transcript, 5)).toBe(false)
  })
})

describe('forkPoint', () => {
  const transcript = [
    turn('u1', 'user'),
    turn('a1', 'assistant', { created: 1, completed: 2 }),
    turn('u2', 'user'),
    turn('a2', 'assistant', { created: 3, completed: 4 }),
  ]

  test('forks at the message after the assistant turn', () => {
    expect(forkPoint(transcript, 'a1')).toEqual({ messageID: 'u2' })
  })

  test('forks the whole session for the last turn', () => {
    expect(forkPoint(transcript, 'a2')).toEqual({})
  })

  test('refuses to fork at unknown messages', () => {
    expect(forkPoint(transcript, 'missing')).toBeNull()
  })

  test('refuses to fork while the next message is an optimistic placeholder', () => {
    expect(
      forkPoint(
        [...transcript, turn('optimistic-123', 'user')],
        'a2',
      ),
    ).toBeNull()
  })
})

describe('subagent task widgets', () => {
  test('reads the child session from task state metadata', () => {
    const part = tool('task-1', 'task', {
      status: 'running',
      input: { description: 'Inspect the code' },
      title: 'Inspect the code',
      metadata: { sessionId: 'session-child' },
      time: { start: 1 },
    })

    expect(taskSessionId(part)).toBe('session-child')
  })

  test('ignores missing, malformed, and non-task session metadata', () => {
    const pending = tool('task-1', 'task', {
      status: 'pending',
      input: {},
      raw: '',
    })
    const malformed = tool('task-2', 'task', {
      status: 'completed',
      input: {},
      output: '',
      title: '',
      metadata: { sessionId: 42 },
      time: { start: 1, end: 2 },
    })
    const other = tool('task-3', 'bash', {
      status: 'running',
      input: {},
      metadata: { sessionId: 'session-child' },
      time: { start: 1 },
    })

    expect(taskSessionId(pending)).toBeUndefined()
    expect(taskSessionId(malformed)).toBeUndefined()
    expect(taskSessionId(other)).toBeUndefined()
  })

  test('counts every tool and describes the latest call', () => {
    const activity = subagentActivity(
      messages([
        tool('read-1', 'read', {
          status: 'completed',
          input: { filePath: '/tmp/one.ts' },
          output: '',
          title: 'Read one.ts',
          metadata: {},
          time: { start: 1, end: 2 },
        }),
        tool('grep-1', 'grep', {
          status: 'error',
          input: { pattern: 'TaskTool' },
          error: 'Failed',
          metadata: {},
          time: { start: 3, end: 4 },
        }),
      ]),
    )

    expect(activity).toEqual({
      toolCalls: 2,
      lastTool: 'grep TaskTool',
    })
  })

  test('reports an empty child transcript', () => {
    expect(subagentActivity([])).toEqual({ toolCalls: 0 })
  })

  test('collects unique child session IDs from task parts', () => {
    const task = tool('task-1', 'task', {
      status: 'running',
      input: {},
      metadata: { sessionId: 'session-child' },
      time: { start: 1 },
    })

    expect(
      taskChildSessionIds(
        messages([
          task,
          { ...task, id: 'task-2' },
          tool('bash-1', 'bash', {
            status: 'running',
            input: {},
            metadata: { sessionId: 'not-a-child' },
            time: { start: 1 },
          }),
        ]),
      ),
    ).toEqual(['session-child'])
  })
})

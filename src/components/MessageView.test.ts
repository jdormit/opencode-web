import { describe, expect, test } from 'bun:test'
import type { MessageWithParts, ToolPart } from '~/lib/oc'
import {
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

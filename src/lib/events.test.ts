import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { applyEvent } from './events'
import { permissionsForSession, questionsForSession } from './oc'
import type {
  Event,
  MessageWithParts,
  PendingPermission,
  QuestionRequest,
  Session,
  ToolPart,
} from './oc'

const childSession = {
  id: 'session-child',
  projectID: 'project-1',
  directory: '/workspace',
  parentID: 'session-parent',
  title: 'Child session',
  version: '1',
  time: { created: 1, updated: 2 },
} as Session

describe('subagent session events', () => {
  test('caches child sessions without adding them to root session lists', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<Array<Session>>(['sessions', '/workspace'], [])
    queryClient.setQueryData<Array<string>>(
      ['session-descendants', 'session-parent'],
      [],
    )

    applyEvent(queryClient, '/workspace', {
      type: 'session.created',
      properties: { info: childSession },
    } as Event)

    expect(
      queryClient.getQueryData<Session>(['session', childSession.id]),
    ).toEqual(childSession)
    expect(
      queryClient.getQueryData<Array<Session>>(['sessions', '/workspace']),
    ).toEqual([])
    expect(
      queryClient.getQueryState([
        'session-descendants',
        'session-parent',
      ])?.isInvalidated,
    ).toBe(true)
  })

  test('updates task parts when child metadata arrives', () => {
    const queryClient = new QueryClient()
    const message = {
      info: {
        id: 'message-1',
        sessionID: 'session-parent',
        role: 'assistant',
      },
      parts: [],
    } as unknown as MessageWithParts
    queryClient.setQueryData<Array<MessageWithParts>>(
      ['messages', 'session-parent'],
      [message],
    )
    const part = {
      id: 'part-1',
      sessionID: 'session-parent',
      messageID: 'message-1',
      type: 'tool',
      callID: 'call-1',
      tool: 'task',
      state: {
        status: 'running',
        input: { description: 'Inspect the code' },
        title: 'Inspect the code',
        metadata: { sessionId: childSession.id },
        time: { start: 1 },
      },
    } as unknown as ToolPart

    applyEvent(queryClient, '/workspace', {
      type: 'message.part.updated',
      properties: { part },
    } as unknown as Event)

    expect(
      queryClient.getQueryData<Array<MessageWithParts>>([
        'messages',
        'session-parent',
      ])?.[0].parts,
    ).toEqual([part])
  })
})

const permission: PendingPermission = {
  id: 'permission-1',
  sessionID: 'session-1',
  permission: 'bash',
  patterns: ['git status'],
  metadata: {},
}

describe('pending permissions', () => {
  test('filters the server permission list to the open session', () => {
    expect(
      permissionsForSession(
        [permission, { ...permission, id: 'permission-2', sessionID: 'session-2' }],
        'session-1',
      ),
    ).toEqual([permission])
  })

  test('adds current permission events to the session cache', () => {
    const queryClient = new QueryClient()

    applyEvent(queryClient, undefined, {
      type: 'permission.asked',
      properties: permission,
    } as unknown as Event)

    expect(
      queryClient.getQueryData<Array<PendingPermission>>([
        'permissions',
        permission.sessionID,
      ]),
    ).toEqual([permission])
  })

  test('removes permissions using the current requestID field', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['permissions', permission.sessionID], [permission])

    applyEvent(queryClient, undefined, {
      type: 'permission.replied',
      properties: {
        sessionID: permission.sessionID,
        requestID: permission.id,
        reply: 'once',
      },
    } as unknown as Event)

    expect(
      queryClient.getQueryData<Array<PendingPermission>>([
        'permissions',
        permission.sessionID,
      ]),
    ).toEqual([])
  })

  test('supports legacy permission event fields', () => {
    const queryClient = new QueryClient()
    const legacy = {
      ...permission,
      title: 'Run a command',
    }

    applyEvent(queryClient, undefined, {
      type: 'permission.updated',
      properties: legacy,
    } as unknown as Event)
    applyEvent(queryClient, undefined, {
      type: 'permission.replied',
      properties: {
        sessionID: permission.sessionID,
        permissionID: permission.id,
        response: 'once',
      },
    } as unknown as Event)

    expect(
      queryClient.getQueryData<Array<PendingPermission>>([
        'permissions',
        permission.sessionID,
      ]),
    ).toEqual([])
  })
})

const question: QuestionRequest = {
  id: 'question-1',
  sessionID: 'session-1',
  questions: [
    {
      header: 'Approach',
      question: 'Which approach should I use?',
      options: [{ label: 'Simple', description: 'Make the smallest change' }],
    },
  ],
}

describe('pending questions', () => {
  test('filters the server question list to the open session', () => {
    expect(
      questionsForSession(
        [
          question,
          { ...question, id: 'question-2', sessionID: 'session-2' },
        ],
        'session-1',
      ),
    ).toEqual([question])
  })

  test('adds and updates question events in request order', () => {
    const queryClient = new QueryClient()
    const later = { ...question, id: 'question-2' }

    applyEvent(queryClient, undefined, {
      type: 'question.asked',
      properties: later,
    } as unknown as Event)
    applyEvent(queryClient, undefined, {
      type: 'question.asked',
      properties: question,
    } as unknown as Event)
    applyEvent(queryClient, undefined, {
      type: 'question.asked',
      properties: {
        ...question,
        questions: [{ ...question.questions[0], header: 'Updated' }],
      },
    } as unknown as Event)

    const requests = queryClient.getQueryData<Array<QuestionRequest>>([
      'questions',
      question.sessionID,
    ])
    expect(requests?.map((item) => item.id)).toEqual([
      question.id,
      later.id,
    ])
    expect(requests?.[0].questions[0].header).toBe('Updated')
  })

  test('removes replied and rejected questions', () => {
    const queryClient = new QueryClient()
    const second = { ...question, id: 'question-2' }
    queryClient.setQueryData(
      ['questions', question.sessionID],
      [question, second],
    )

    applyEvent(queryClient, undefined, {
      type: 'question.replied',
      properties: {
        sessionID: question.sessionID,
        requestID: question.id,
        answers: [['Simple']],
      },
    } as unknown as Event)
    applyEvent(queryClient, undefined, {
      type: 'question.rejected',
      properties: {
        sessionID: second.sessionID,
        requestID: second.id,
      },
    } as unknown as Event)

    expect(
      queryClient.getQueryData<Array<QuestionRequest>>([
        'questions',
        question.sessionID,
      ]),
    ).toEqual([])
  })
})

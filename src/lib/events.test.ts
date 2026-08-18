import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { applyEvent } from './events'
import { permissionsForSession, questionsForSession } from './oc'
import type { Event, PendingPermission, QuestionRequest } from './oc'

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

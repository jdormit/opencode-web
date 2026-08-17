import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { applyEvent } from './events'
import { permissionsForSession } from './oc'
import type { Event, PendingPermission } from './oc'

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

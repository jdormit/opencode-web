import { expect, test } from 'bun:test'
import { createServiceConnection } from './service.server'

test('discovers first and starts the CLI once for concurrent requests', async () => {
  let running = false
  let starts = 0
  const connection = createServiceConnection({
    discover: async () =>
      running ? { url: 'http://localhost:49405' } : undefined,
    start: async () => {
      starts++
      running = true
    },
    fetch: async () => Response.json({ ok: true }),
  })
  await Promise.all([connection('/api/project'), connection('/api/session')])
  expect(starts).toBe(1)
})

test('re-discovers after authentication rotates and forwards only service auth', async () => {
  let generation = 0
  const authorizations: (string | null)[] = []
  const connection = createServiceConnection({
    discover: async () => ({
      url: `http://localhost:${49405 + generation++}`,
      auth: {
        type: 'basic',
        username: 'opencode',
        password: `secret-${generation}`,
      },
    }),
    start: async () => {
      throw new Error('must not start')
    },
    fetch: async (_url, init) => {
      authorizations.push(new Headers(init?.headers).get('authorization'))
      return new Response(null, {
        status: authorizations.length === 1 ? 401 : 204,
      })
    },
  })
  expect(
    (
      await connection('/api/project', {
        headers: { authorization: 'browser-secret' },
      })
    ).status,
  ).toBe(204)
  expect(authorizations).toEqual([
    'Basic ' + btoa('opencode:secret-1'),
    'Basic ' + btoa('opencode:secret-2'),
  ])
})

test('does not replay mutations after a connection failure', async () => {
  let calls = 0
  const connection = createServiceConnection({
    discover: async () => ({ url: 'http://localhost:49405' }),
    start: async () => {},
    fetch: async () => {
      calls++
      throw new Error('disconnected')
    },
  })
  await expect(
    connection('/api/session', { method: 'POST', body: '{}' }),
  ).rejects.toThrow('restarted')
  expect(calls).toBe(1)
})

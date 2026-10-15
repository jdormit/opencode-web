import { expect, test } from 'bun:test'
import { OpenCode } from '@opencode/client'
import { listSessions, promptFiles } from './oc'

test('session history follows V2 cursors and requests roots', async () => {
  const requests: URL[] = []
  const api = OpenCode.make({
    baseUrl: 'http://example.test',
    fetch: (async (url) => {
      if (new URL(String(url)).pathname === '/api/location')
        return Response.json({ project: { id: 'project' } })
      requests.push(new URL(String(url)))
      return Response.json(
        requests.length === 1
          ? {
              data: [{ id: 'ses_1', location: { directory: '/tmp/project' } }],
              cursor: { next: 'next-page' },
            }
          : {
              data: [{ id: 'ses_2', location: { directory: '/tmp/project' } }],
              cursor: {},
            },
      )
    }) as typeof fetch,
  })
  const sessions = await listSessions(api, '/tmp/project', true)
  expect(sessions.map((s) => s.id)).toEqual(['ses_1', 'ses_2'])
  expect(requests[0].pathname).toBe('/api/session')
  expect(requests[0].searchParams.get('parentID')).toBe('null')
  expect(requests[1].searchParams.get('cursor')).toBe('next-page')
  expect(requests[1].searchParams.has('order')).toBe(false)
})

test('attachments use V2 file URI inputs', () => {
  expect(
    promptFiles([
      {
        id: 'file',
        mime: 'image/png',
        filename: 'image.png',
        url: 'data:image/png;base64,YQ==',
      },
    ]),
  ).toEqual([{ uri: 'data:image/png;base64,YQ==', name: 'image.png' }])
})

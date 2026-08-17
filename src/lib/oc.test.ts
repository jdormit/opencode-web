import { describe, expect, test } from 'bun:test'
import { sessionListRequest } from './oc'

describe('sessionListRequest', () => {
  test('lists sessions globally by directory', () => {
    expect(sessionListRequest('/Users/test/project', 100)).toEqual({
      path: '/experimental/session',
      query: {
        directory: '/Users/test/project',
        roots: 'true',
        limit: 100,
      },
    })
  })
})

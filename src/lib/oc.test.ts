import { describe, expect, test } from 'bun:test'
import { promptParts, sessionListRequest } from './oc'

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

describe('promptParts', () => {
  test('serializes text and file attachments', () => {
    expect(
      promptParts({
        text: 'Review this',
        attachments: [
          {
            id: 'local-1',
            filename: 'screen.png',
            mime: 'image/png',
            url: 'data:image/png;base64,AAAA',
          },
        ],
      }),
    ).toEqual([
      { type: 'text', text: 'Review this' },
      {
        type: 'file',
        filename: 'screen.png',
        mime: 'image/png',
        url: 'data:image/png;base64,AAAA',
      },
    ])
  })

  test('allows an attachment-only prompt', () => {
    expect(
      promptParts({
        text: '',
        attachments: [
          {
            id: 'local-1',
            filename: 'notes.txt',
            mime: 'text/plain',
            url: 'data:text/plain;base64,SGVsbG8=',
          },
        ],
      }),
    ).toHaveLength(1)
  })
})

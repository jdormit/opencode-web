import { describe, expect, test } from 'bun:test'
import {
  commandRequest,
  forkSessionRequest,
  promptParts,
  sessionListRequest,
} from './oc'

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

describe('forkSessionRequest', () => {
  test('forks before a specific message', () => {
    expect(
      forkSessionRequest('session-1', '/Users/test/project', 'message-2'),
    ).toEqual({
      path: '/session/session-1/fork',
      query: { directory: '/Users/test/project' },
      body: { messageID: 'message-2' },
    })
  })

  test('forks the whole session when no message is given', () => {
    expect(forkSessionRequest('session-1', '/Users/test/project')).toEqual({
      path: '/session/session-1/fork',
      query: { directory: '/Users/test/project' },
      body: {},
    })
  })
})

describe('commandRequest', () => {
  test('sends the raw argument string for the server to expand', () => {
    expect(
      commandRequest('session-1', '/Users/test/project', {
        command: 'review',
        args: 'the last commit',
        agent: 'build',
        model: 'anthropic/claude-sonnet-4-5',
      }),
    ).toEqual({
      path: '/session/session-1/command',
      query: { directory: '/Users/test/project' },
      body: {
        command: 'review',
        arguments: 'the last commit',
        agent: 'build',
        model: 'anthropic/claude-sonnet-4-5',
      },
    })
  })

  test('attaches files as parts', () => {
    expect(
      commandRequest('session-1', '/Users/test/project', {
        command: 'review',
        args: '',
        attachments: [
          {
            id: 'local-1',
            filename: 'screen.png',
            mime: 'image/png',
            url: 'data:image/png;base64,AAAA',
          },
        ],
      }).body.parts,
    ).toEqual([
      {
        type: 'file',
        filename: 'screen.png',
        mime: 'image/png',
        url: 'data:image/png;base64,AAAA',
      },
    ])
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

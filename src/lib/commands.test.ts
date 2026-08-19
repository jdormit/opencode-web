import { describe, expect, test } from 'bun:test'
import {
  commandSlashItems,
  filterSlashItems,
  parseCommandInput,
  revertBoundary,
  sessionBuiltins,
  sessionExportFilename,
  slashQuery,
} from './commands'
import type { SlashItem } from './commands'

describe('slashQuery', () => {
  test('matches a bare slash', () => {
    expect(slashQuery('/')).toBe('')
  })

  test('matches a partial command token', () => {
    expect(slashQuery('/com')).toBe('com')
  })

  test('closes once arguments start', () => {
    expect(slashQuery('/compact now')).toBeNull()
    expect(slashQuery('/review ')).toBeNull()
  })

  test('ignores non-slash text', () => {
    expect(slashQuery('hello')).toBeNull()
    expect(slashQuery(' /review')).toBeNull()
    expect(slashQuery('')).toBeNull()
  })

  test('ignores multi-line drafts', () => {
    expect(slashQuery('/review\nmore')).toBeNull()
  })
})

describe('filterSlashItems', () => {
  const items: Array<SlashItem> = [
    { name: 'review', description: 'Review changes', kind: 'template' },
    { name: 'new', description: 'Start a new session', kind: 'action' },
    { name: 'unshare', description: 'Stop sharing', kind: 'action' },
    { name: 'share', description: 'Share this session', kind: 'action' },
  ]

  test('returns everything for an empty query', () => {
    expect(filterSlashItems(items, '')).toEqual(items)
  })

  test('ranks prefix matches before substring matches', () => {
    expect(filterSlashItems(items, 'share').map((i) => i.name)).toEqual([
      'share',
      'unshare',
    ])
  })

  test('is case-insensitive', () => {
    expect(filterSlashItems(items, 'REV').map((i) => i.name)).toEqual([
      'review',
    ])
  })

  test('returns nothing when no name matches', () => {
    expect(filterSlashItems(items, 'zzz')).toEqual([])
  })
})

describe('commandSlashItems', () => {
  const commands = [
    { name: 'init', description: 'guided AGENTS.md setup', source: 'command' },
    { name: 'summarize', source: 'mcp' },
    { name: 'honeycomb', description: 'Query observability data', source: 'skill' },
    { name: 'legacy' },
  ]

  test('maps server commands to template items', () => {
    expect(commandSlashItems([commands[0]])).toEqual([
      {
        name: 'init',
        description: 'guided AGENTS.md setup',
        kind: 'template',
      },
    ])
  })

  test('hides skill-sourced commands, like the TUI', () => {
    expect(commandSlashItems(commands).map((i) => i.name)).toEqual([
      'init',
      'summarize',
      'legacy',
    ])
  })

  test('keeps commands from servers that do not send a source', () => {
    expect(commandSlashItems([{ name: 'legacy' }])).toHaveLength(1)
  })
})

describe('parseCommandInput', () => {
  test('parses a command without arguments', () => {
    expect(parseCommandInput('/init')).toEqual({ name: 'init', args: '' })
  })

  test('parses a command with arguments', () => {
    expect(parseCommandInput('/review the last commit')).toEqual({
      name: 'review',
      args: 'the last commit',
    })
  })

  test('keeps newlines inside arguments', () => {
    expect(parseCommandInput('/review line one\nline two')).toEqual({
      name: 'review',
      args: 'line one\nline two',
    })
  })

  test('rejects plain text and a bare slash', () => {
    expect(parseCommandInput('hello /world')).toBeNull()
    expect(parseCommandInput('/')).toBeNull()
    expect(parseCommandInput('')).toBeNull()
  })
})

describe('sessionBuiltins', () => {
  const base = {
    shareEnabled: true,
    shared: false,
    hasUserMessages: true,
    reverted: false,
  }

  test('includes the full set for an active session', () => {
    const names = sessionBuiltins(base).map((i) => i.name)
    expect(names).toEqual([
      'new',
      'share',
      'fork',
      'compact',
      'undo',
      'export',
    ])
  })

  test('offers unshare only when shared', () => {
    const names = sessionBuiltins({ ...base, shared: true }).map((i) => i.name)
    expect(names).toContain('unshare')
  })

  test('hides share commands when sharing is disabled', () => {
    const names = sessionBuiltins({
      ...base,
      shareEnabled: false,
      shared: true,
    }).map((i) => i.name)
    expect(names).not.toContain('share')
    expect(names).not.toContain('unshare')
  })

  test('offers redo only while reverted', () => {
    expect(sessionBuiltins(base).map((i) => i.name)).not.toContain('redo')
    expect(
      sessionBuiltins({ ...base, reverted: true }).map((i) => i.name),
    ).toContain('redo')
  })

  test('hides message commands for an empty session', () => {
    const names = sessionBuiltins({ ...base, hasUserMessages: false }).map(
      (i) => i.name,
    )
    expect(names).not.toContain('fork')
    expect(names).not.toContain('compact')
    expect(names).not.toContain('undo')
  })

  test('marks every builtin as an action', () => {
    for (const item of sessionBuiltins({ ...base, shared: true, reverted: true })) {
      expect(item.kind).toBe('action')
    }
  })
})

describe('revertBoundary', () => {
  const messages = [
    { info: { id: 'm1', role: 'user' } },
    { info: { id: 'm2', role: 'assistant' } },
    { info: { id: 'm3', role: 'user' } },
    { info: { id: 'm4', role: 'assistant' } },
  ]

  test('returns null without a revert point', () => {
    expect(revertBoundary(messages, undefined)).toBeNull()
  })

  test('returns null when the revert point is unknown', () => {
    expect(revertBoundary(messages, 'missing')).toBeNull()
  })

  test('finds the boundary and counts reverted user messages', () => {
    expect(revertBoundary(messages, 'm3')).toEqual({
      index: 2,
      revertedUserCount: 1,
    })
  })

  test('counts every user message when reverting to the start', () => {
    expect(revertBoundary(messages, 'm1')).toEqual({
      index: 0,
      revertedUserCount: 2,
    })
  })
})

describe('sessionExportFilename', () => {
  test('slugifies the session title', () => {
    expect(
      sessionExportFilename({ id: 'ses_1', title: 'Fix the Build!' }),
    ).toBe('fix-the-build.json')
  })

  test('falls back to the id without a title', () => {
    expect(sessionExportFilename({ id: 'ses_1', title: '' })).toBe('ses_1.json')
  })
})

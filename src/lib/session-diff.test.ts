import { describe, expect, test } from 'bun:test'
import {
  collapsedDiffLines,
  diffLines,
  diffMetadata,
  expandDiffGap,
  mergeSessionDiffs,
} from './session-diff'
import type { SessionDiffLine } from './session-diff'

describe('session diff normalization', () => {
  test('normalizes legacy full-file metadata', () => {
    expect(
      diffMetadata([
        {
          file: 'src/new.ts',
          before: '',
          after: 'export {}\n',
          additions: 1,
          deletions: 0,
        },
      ]),
    ).toEqual([
      {
        id: 0,
        file: 'src/new.ts',
        additions: 1,
        deletions: 0,
        status: 'added',
        complete: true,
      },
    ])
  })

  test('parses a unified patch into numbered rows', () => {
    const lines = diffLines({
      file: 'src/value.ts',
      additions: 1,
      deletions: 1,
      patch: [
        '--- a/src/value.ts',
        '+++ b/src/value.ts',
        '@@ -1,2 +1,2 @@',
        '-const value = 1',
        '+const value = 2',
        ' export { value }',
        '',
      ].join('\n'),
    })

    expect(lines).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'deletion', oldLine: 1, text: 'const value = 1' },
      { kind: 'addition', newLine: 1, text: 'const value = 2' },
      { kind: 'context', oldLine: 2, newLine: 2, text: 'export { value }' },
    ])
  })

  test('does not mark an ordinary leading hunk as complete', () => {
    expect(
      diffMetadata([
        {
          file: 'src/value.ts',
          additions: 1,
          deletions: 1,
          patch: '@@ -1,2 +1,2 @@\n-old\n+new\n context\n',
        },
      ])[0].complete,
    ).toBe(false)
  })

  test('recognizes jsdiff Index patches as complete', () => {
    expect(
      diffMetadata([
        {
          file: 'value.txt',
          additions: 1,
          deletions: 1,
          patch: [
            'Index: value.txt',
            '===================================================================',
            '--- value.txt',
            '+++ value.txt',
            '@@ -1,1 +1,1 @@',
            '-before',
            '+after',
            '',
          ].join('\n'),
        },
      ])[0].complete,
    ).toBe(true)
  })

  test('renders every document in concatenated partial patches', () => {
    const patch = (before: string, after: string) =>
      `--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-${before}\n+${after}\n`
    const lines = diffLines({
      file: 'value.txt',
      patch: `${patch('one', 'two')}\n${patch('two', 'three')}`,
      additions: 2,
      deletions: 2,
    })

    expect(lines.filter((line) => line.kind === 'addition').map((line) => line.text)).toEqual(['two', 'three'])
  })

  test('converts legacy before and after content into rows', () => {
    const lines = diffLines({
      file: 'README.md',
      before: 'before\n',
      after: 'after\n',
      additions: 1,
      deletions: 1,
    })

    expect(lines.some((line) => line.kind === 'deletion' && line.text === 'before')).toBe(true)
    expect(lines.some((line) => line.kind === 'addition' && line.text === 'after')).toBe(true)
  })

  test('merges message diffs from the first before state to the last after state', () => {
    expect(
      mergeSessionDiffs([
        [{ file: 'value.txt', before: 'one', after: 'two', additions: 1, deletions: 1 }],
        [{ file: 'value.txt', before: 'two', after: 'three', additions: 1, deletions: 1 }],
      ]),
    ).toEqual([
      {
        file: 'value.txt',
        before: 'one',
        after: 'three',
        additions: 1,
        deletions: 1,
        status: 'modified',
      },
    ])
  })

  test('drops files that return to their original content', () => {
    expect(
      mergeSessionDiffs([
        [{ file: 'value.txt', before: 'one', after: 'two', additions: 1, deletions: 1 }],
        [{ file: 'value.txt', before: 'two', after: 'one', additions: 1, deletions: 1 }],
      ]),
    ).toEqual([])
  })

  test('collapses unchanged lines and expands a gap in bounded steps', () => {
    const lines: Array<SessionDiffLine> = Array.from(
      { length: 21 },
      (_, index) => ({
        kind: index === 10 ? 'addition' : 'context',
        oldLine: index + 1,
        newLine: index + 1,
        text: `line ${index + 1}`,
      }),
    )
    const expanded = new Set<number>()
    const collapsed = collapsedDiffLines(lines, expanded, false)

    expect(collapsed.filter((line) => line.kind === 'gap').map((line) => line.hiddenLines)).toEqual([7, 7])

    expandDiffGap(expanded, 0, 6, 'down', 2)
    expect(
      collapsedDiffLines(lines, expanded, false)
        .filter((line) => line.kind === 'gap')
        .map((line) => line.hiddenLines),
    ).toEqual([5, 7])
  })
})

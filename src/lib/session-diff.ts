import { parsePatch, structuredPatch } from 'diff'
import type { StructuredPatch } from 'diff'

export interface RawSessionDiff {
  file?: string
  path?: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: 'added' | 'deleted' | 'modified'
}

export interface SessionDiffFile {
  id: number
  file: string
  additions: number
  deletions: number
  status: 'added' | 'deleted' | 'modified'
  complete: boolean
}

export type SessionDiffLineKind =
  | 'hunk'
  | 'gap'
  | 'context'
  | 'addition'
  | 'deletion'

export interface SessionDiffLine {
  kind: SessionDiffLineKind
  oldLine?: number
  newLine?: number
  text: string
  gapStart?: number
  gapEnd?: number
  hiddenLines?: number
}

export function diffMetadata(
  diffs: Array<RawSessionDiff>,
): Array<SessionDiffFile> {
  return diffs.map((diff, id) => ({
    id,
    file: diff.file ?? diff.path ?? 'Unknown file',
    additions: diff.additions,
    deletions: diff.deletions,
    status:
      diff.status ??
      (diff.before === ''
        ? 'added'
        : diff.after === ''
          ? 'deleted'
          : 'modified'),
    complete: isCompleteDiff(diff),
  }))
}

export function mergeSessionDiffs(
  groups: Array<Array<RawSessionDiff>>,
): Array<RawSessionDiff> {
  const merged = new Map<string, RawSessionDiff>()
  for (const group of groups) {
    for (const diff of group) {
      const file = diff.file ?? diff.path ?? 'Unknown file'
      const current = merged.get(file)
      if (!current) {
        merged.set(file, diff)
        continue
      }
      const currentContents = diffContents(current)
      const nextContents = diffContents(diff)
      if (currentContents && nextContents) {
        const combined: RawSessionDiff = {
          file,
          before: currentContents.before,
          after: nextContents.after,
          additions: 0,
          deletions: 0,
          status:
            currentContents.before === ''
              ? 'added'
              : nextContents.after === ''
                ? 'deleted'
                : 'modified',
        }
        const rows = diffLines(combined)
        combined.additions = rows.filter((line) => line.kind === 'addition').length
        combined.deletions = rows.filter((line) => line.kind === 'deletion').length
        merged.set(file, combined)
        continue
      }
      merged.set(file, {
        ...diff,
        before: current.before ?? diff.before,
        patch:
          current.patch && diff.patch
            ? `${current.patch}\n${diff.patch}`
            : diff.patch ?? current.patch,
        additions: current.additions + diff.additions,
        deletions: current.deletions + diff.deletions,
      })
    }
  }
  return [...merged.values()].filter(
    (diff) =>
      diff.before === undefined ||
      diff.after === undefined ||
      diff.before !== diff.after,
  )
}

export function completePatchContents(patch: string) {
  try {
    const parsed = parsePatch(patch)[0]
    if (!parsed || parsed.hunks.length !== 1) return
    if (
      !patch.startsWith('diff --git ') &&
      !patch.startsWith('Index: ') &&
      !/^--- [^\n]*\t\r?\n\+\+\+ [^\n]*\t(?:\r?\n|$)/m.test(patch)
    ) return
    const hunk = parsed.hunks[0]
    if (!hunk || hunk.oldStart > 1 || hunk.newStart > 1) return

    const before: Array<{ text: string; newline: boolean }> = []
    const after: Array<{ text: string; newline: boolean }> = []
    let previous: '-' | '+' | ' ' | undefined
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) {
        if (previous === '-' || previous === ' ') {
          const value = before.at(-1)
          if (value) value.newline = false
        }
        if (previous === '+' || previous === ' ') {
          const value = after.at(-1)
          if (value) value.newline = false
        }
      } else if (line.startsWith('-')) {
        before.push({ text: line.slice(1), newline: true })
        previous = '-'
      } else if (line.startsWith('+')) {
        after.push({ text: line.slice(1), newline: true })
        previous = '+'
      } else if (line.startsWith(' ')) {
        before.push({ text: line.slice(1), newline: true })
        after.push({ text: line.slice(1), newline: true })
        previous = ' '
      } else {
        return
      }
    }
    const text = (lines: Array<{ text: string; newline: boolean }>) =>
      lines.map((line) => line.text + (line.newline ? '\n' : '')).join('')
    return { before: text(before), after: text(after) }
  } catch {
    return
  }
}

function diffContents(diff: RawSessionDiff) {
  if (diff.before !== undefined && diff.after !== undefined) {
    return { before: diff.before, after: diff.after }
  }
  return diff.patch ? completePatchContents(diff.patch) : undefined
}

export function isCompleteDiff(diff: RawSessionDiff) {
  return diffContents(diff) !== undefined
}

function toStructuredPatches(diff: RawSessionDiff): Array<StructuredPatch> {
  if (diff.patch) {
    try {
      return parsePatch(diff.patch)
    } catch {
      return []
    }
  }
  if (diff.before === undefined || diff.after === undefined) return []
  const file = diff.file ?? diff.path ?? 'file'
  return [
    structuredPatch(file, file, diff.before, diff.after, '', '', {
      context: Number.MAX_SAFE_INTEGER,
    }),
  ]
}

export function collapsedDiffLines(
  lines: Array<SessionDiffLine>,
  expanded: Set<number>,
  showAll: boolean,
  context = 3,
): Array<SessionDiffLine> {
  const header = lines.find((line) => line.kind === 'hunk')
  const content = lines.filter((line) => line.kind !== 'hunk')
  if (showAll || content.length === 0) return lines

  const visible = new Set(expanded)
  for (let index = 0; index < content.length; index++) {
    if (content[index].kind === 'context') continue
    for (
      let neighbor = Math.max(0, index - context);
      neighbor <= Math.min(content.length - 1, index + context);
      neighbor++
    ) {
      visible.add(neighbor)
    }
  }

  const result = header ? [header] : []
  let index = 0
  while (index < content.length) {
    if (visible.has(index)) {
      result.push(content[index])
      index++
      continue
    }
    const start = index
    while (index < content.length && !visible.has(index)) index++
    result.push({
      kind: 'gap',
      text: '',
      gapStart: start,
      gapEnd: index - 1,
      hiddenLines: index - start,
    })
  }
  return result
}

export function expandDiffGap(
  expanded: Set<number>,
  start: number,
  end: number,
  direction: 'up' | 'down' | 'all',
  count = 20,
) {
  const from = direction === 'up' ? Math.max(start, end - count + 1) : start
  const to = direction === 'down' ? Math.min(end, start + count - 1) : end
  for (let index = from; index <= to; index++) expanded.add(index)
}

export function diffLines(diff: RawSessionDiff): Array<SessionDiffLine> {
  const result: Array<SessionDiffLine> = []
  for (const patch of toStructuredPatches(diff)) {
    for (const hunk of patch.hunks) {
      result.push({
        kind: 'hunk',
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      })
      let oldLine = hunk.oldStart
      let newLine = hunk.newStart
      for (const line of hunk.lines) {
        const marker = line[0]
        const text = line.slice(1)
        if (marker === '+') {
          result.push({ kind: 'addition', newLine, text })
          newLine += 1
        } else if (marker === '-') {
          result.push({ kind: 'deletion', oldLine, text })
          oldLine += 1
        } else if (marker === ' ') {
          result.push({ kind: 'context', oldLine, newLine, text })
          oldLine += 1
          newLine += 1
        }
      }
    }
  }
  return result
}

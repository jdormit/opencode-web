/// <reference lib="webworker" />

import {
  collapsedDiffLines,
  diffLines,
  diffMetadata,
  expandDiffGap,
  isCompleteDiff,
  mergeSessionDiffs,
} from './session-diff'
import type { RawSessionDiff, SessionDiffLine } from './session-diff'

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope
let diffs: Array<RawSessionDiff> = []
const lines = new Map<number, Array<SessionDiffLine>>()
const expanded = new Map<number, Set<number>>()
const showAll = new Set<number>()

scope.onmessage = async (message: MessageEvent) => {
  const request = message.data as
    | { type: 'load'; requestId: number; urls: Array<string> }
    | {
        type: 'lines'
        requestId: number
        fileId: number
        offset: number
        limit: number
        expansion?: {
          direction: 'up' | 'down' | 'all' | 'file-all' | 'reset'
          start?: number
          end?: number
        }
      }

  try {
    if (request.type === 'load') {
      const groups = new Array<Array<RawSessionDiff>>(request.urls.length)
      let next = 0
      const fetchNext = async () => {
        while (next < request.urls.length) {
          const index = next++
          const response = await fetch(request.urls[index])
          if (!response.ok) throw new Error(`Diff request failed (${response.status})`)
          groups[index] = (await response.json()) as Array<RawSessionDiff>
        }
      }
      await Promise.all(
        Array.from(
          { length: Math.min(4, request.urls.length) },
          () => fetchNext(),
        ),
      )
      diffs = mergeSessionDiffs(groups)
      lines.clear()
      expanded.clear()
      showAll.clear()
      scope.postMessage({
        type: 'metadata',
        requestId: request.requestId,
        files: diffMetadata(diffs),
      })
      return
    }

    let fileLines = lines.get(request.fileId)
    if (!fileLines) {
      const diff = diffs[request.fileId]
      fileLines = diff ? diffLines(diff) : []
      lines.set(request.fileId, fileLines)
    }
    const expansion = request.expansion
    if (expansion?.direction === 'file-all') {
      showAll.add(request.fileId)
    } else if (expansion?.direction === 'reset') {
      showAll.delete(request.fileId)
      expanded.delete(request.fileId)
    } else if (
      expansion &&
      expansion.start !== undefined &&
      expansion.end !== undefined
    ) {
      const indexes = expanded.get(request.fileId) ?? new Set<number>()
      expandDiffGap(
        indexes,
        expansion.start,
        expansion.end,
        expansion.direction,
      )
      expanded.set(request.fileId, indexes)
    }
    const diff = diffs[request.fileId]
    const view =
      diff && isCompleteDiff(diff)
        ? collapsedDiffLines(
            fileLines,
            expanded.get(request.fileId) ?? new Set(),
            showAll.has(request.fileId),
          )
        : fileLines
    scope.postMessage({
      type: 'lines',
      requestId: request.requestId,
      fileId: request.fileId,
      offset: request.offset,
      lines: view.slice(request.offset, request.offset + request.limit),
      total: view.length,
      fullyExpanded: showAll.has(request.fileId),
    })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SessionDiffFile, SessionDiffLine } from './session-diff'

interface WorkerResponse {
  type: 'metadata' | 'lines' | 'error'
  requestId: number
  files?: Array<SessionDiffFile>
  lines?: Array<SessionDiffLine>
  total?: number
  fullyExpanded?: boolean
  message?: string
}

interface LineChunk {
  lines: Array<SessionDiffLine>
  total: number
  fullyExpanded: boolean
}

export interface DiffExpansion {
  direction: 'up' | 'down' | 'all' | 'file-all' | 'reset'
  start?: number
  end?: number
}

export interface SessionDiffController {
  files: Array<SessionDiffFile>
  generation: number
  hasDiff: boolean
  loading: boolean
  error?: string
  loadLines: (
    fileId: number,
    offset: number,
    limit: number,
    expansion?: DiffExpansion,
  ) => Promise<LineChunk>
  retry: () => void
}

export function useSessionDiff(
  sessionId: string,
  directory: string | undefined,
  summaryFiles: number | undefined,
  messageIds: Array<string>,
  enabled: boolean,
): SessionDiffController {
  const queryClient = useQueryClient()
  const availability = useQuery<boolean>({
    queryKey: ['session-diff-available', sessionId],
    queryFn: () => messageIds.length > 0 || (summaryFiles ?? 0) > 0,
    initialData: messageIds.length > 0 || (summaryFiles ?? 0) > 0,
    staleTime: Infinity,
  })
  const revision = useQuery<number>({
    queryKey: ['session-diff-revision', sessionId],
    queryFn: () => 0,
    initialData: 0,
    staleTime: Infinity,
  })
  const workerRef = React.useRef<Worker | undefined>(undefined)
  const pendingRef = React.useRef(new Map<number, {
    resolve: (value: WorkerResponse) => void
    reject: (error: Error) => void
  }>())
  const requestIdRef = React.useRef(0)
  const [files, setFiles] = React.useState<Array<SessionDiffFile>>([])
  const [generation, setGeneration] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [retryCount, setRetryCount] = React.useState(0)
  const messageKey = messageIds.join(',')

  const send = React.useEffectEvent(
    (payload: Record<string, unknown>): Promise<WorkerResponse> => {
      const requestId = ++requestIdRef.current
      return new Promise((resolve, reject) => {
        pendingRef.current.set(requestId, { resolve, reject })
        workerRef.current?.postMessage({ ...payload, requestId })
      })
    },
  )

  React.useEffect(() => {
    if (!enabled || !directory || typeof Worker === 'undefined') return
    const worker = new Worker(
      new URL('./session-diff.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = pendingRef.current.get(response.requestId)
      if (!pending) return
      pendingRef.current.delete(response.requestId)
      if (response.type === 'error') {
        pending.reject(new Error(response.message ?? 'Unable to load diff'))
      } else {
        pending.resolve(response)
      }
    }

    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      setLoading(true)
      setError(undefined)
      try {
        const search = new URLSearchParams({ directory })
        const ids = messageKey ? messageKey.split(',') : []
        const base = `/api/proxy/session/${encodeURIComponent(sessionId)}/diff`
        const response = await send({
          type: 'load',
          urls: ids.length > 0
            ? ids.map((messageID) => {
                const query = new URLSearchParams(search)
                query.set('messageID', messageID)
                return `${base}?${query}`
              })
            : [`${base}?${search}`],
        })
        if (cancelled) return
        const nextFiles = response.files ?? []
        setFiles(nextFiles)
        setGeneration((value) => value + 1)
        queryClient.setQueryData(
          ['session-diff-available', sessionId],
          nextFiles.length > 0,
        )
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const schedule = window.requestIdleCallback
      ? window.requestIdleCallback(() => void load(), { timeout: 1500 })
      : (timeout = setTimeout(() => void load(), 0))

    return () => {
      cancelled = true
      if (window.cancelIdleCallback && typeof schedule === 'number') {
        window.cancelIdleCallback(schedule)
      }
      if (timeout) clearTimeout(timeout)
      for (const pending of pendingRef.current.values()) {
        pending.reject(new Error('Diff request cancelled'))
      }
      pendingRef.current.clear()
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = undefined
    }
  }, [
    enabled,
    sessionId,
    directory,
    messageKey,
    revision.data,
    retryCount,
    queryClient,
  ])

  const loadLines = React.useEffectEvent(
    async (
      fileId: number,
      offset: number,
      limit: number,
      expansion?: DiffExpansion,
    ) => {
      const response = await send({
        type: 'lines',
        fileId,
        offset,
        limit,
        expansion,
      })
      return {
        lines: response.lines ?? [],
        total: response.total ?? 0,
        fullyExpanded: response.fullyExpanded ?? false,
      }
    },
  )

  return {
    files,
    generation,
    hasDiff: messageIds.length > 0 || availability.data,
    loading,
    error,
    loadLines,
    retry: () => setRetryCount((count) => count + 1),
  }
}

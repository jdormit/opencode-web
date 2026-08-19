import * as React from 'react'
import type { SessionDiffController } from '~/lib/session-diff-client'
import type { DiffExpansion } from '~/lib/session-diff-client'
import type { SessionDiffFile, SessionDiffLine } from '~/lib/session-diff'
import { shouldKeepDiffGesture } from '~/lib/session-diff-gesture'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExpandLinesIcon,
  XIcon,
} from './icons'
import styles from './SessionDiffPanel.module.css'

const LINE_CHUNK = 250
const FILE_CHUNK = 100

interface SessionDiffPanelProps {
  diff: SessionDiffController
  onClose: () => void
}

export function SessionDiffPanel({ diff, onClose }: SessionDiffPanelProps) {
  const [collapsed, setCollapsed] = React.useState<Set<number>>(() => new Set())
  const [visibleFiles, setVisibleFiles] = React.useState(FILE_CHUNK)
  const additions = diff.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = diff.files.reduce((sum, file) => sum + file.deletions, 0)

  const collapseAll = () => setCollapsed(new Set(diff.files.map((file) => file.id)))
  const expandAll = () => setCollapsed(new Set())
  const toggle = (fileId: number) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  return (
    <section className={styles.panel} aria-label="Session changes">
      <header className={styles.panelHeader}>
        <div>
          <h2>Session changes</h2>
          {diff.files.length > 0 && (
            <p>
              {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}
              <span className={styles.additions}> +{additions}</span>
              <span className={styles.deletions}> -{deletions}</span>
            </p>
          )}
        </div>
        <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close session changes">
          <XIcon size={18} />
        </button>
      </header>

      <div className={styles.toolbar}>
        <button type="button" onClick={collapseAll}>Collapse all</button>
        <button type="button" onClick={expandAll}>Expand all</button>
      </div>

      <div className={styles.files}>
        {diff.loading && diff.files.length === 0 && <p className={styles.state}>Loading changes…</p>}
        {diff.error && diff.files.length === 0 && (
          <div className={styles.state}>
            <p>{diff.error}</p>
            <button type="button" onClick={diff.retry}>Retry</button>
          </div>
        )}
        {diff.files.slice(0, visibleFiles).map((file) => (
          <DiffFile
            key={`${diff.generation}:${file.id}`}
            file={file}
            expanded={!collapsed.has(file.id)}
            loadLines={diff.loadLines}
            onToggle={() => toggle(file.id)}
          />
        ))}
        {visibleFiles < diff.files.length && (
          <button
            className={styles.moreFiles}
            type="button"
            onClick={() => React.startTransition(() => setVisibleFiles((count) => count + FILE_CHUNK))}
          >
            Show {Math.min(FILE_CHUNK, diff.files.length - visibleFiles)} more files
          </button>
        )}
      </div>
    </section>
  )
}

function DiffFile({
  file,
  expanded,
  loadLines,
  onToggle,
}: {
  file: SessionDiffFile
  expanded: boolean
  loadLines: SessionDiffController['loadLines']
  onToggle: () => void
}) {
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const fileToggleRef = React.useRef<HTMLButtonElement>(null)
  const gestureRef = React.useRef<{
    pointerId: number
    x: number
    y: number
    decided: boolean
  } | undefined>(undefined)
  const [visible, setVisible] = React.useState(false)
  const [lines, setLines] = React.useState<Array<SessionDiffLine>>([])
  const [total, setTotal] = React.useState<number>()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [fullyExpanded, setFullyExpanded] = React.useState(false)

  React.useEffect(() => {
    const body = bodyRef.current
    if (!body || !expanded || typeof IntersectionObserver === 'undefined') {
      if (expanded) setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '500px 0px' },
    )
    observer.observe(body)
    return () => observer.disconnect()
  }, [expanded])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      decided: false,
    }
    event.currentTarget.setAttribute('data-vaul-no-drag', '')
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.decided) return
    const deltaX = event.clientX - gesture.x
    const deltaY = event.clientY - gesture.y
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 5) return

    gesture.decided = true
    if (
      !shouldKeepDiffGesture({
        deltaX,
        deltaY,
        scrollLeft: event.currentTarget.scrollLeft,
        scrollWidth: event.currentTarget.scrollWidth,
        clientWidth: event.currentTarget.clientWidth,
      })
    ) {
      event.currentTarget.removeAttribute('data-vaul-no-drag')
    }
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return
    gestureRef.current = undefined
    const body = event.currentTarget
    setTimeout(() => body.removeAttribute('data-vaul-no-drag'), 0)
  }

  const loadMore = React.useEffectEvent(async (expansion?: DiffExpansion) => {
    if (
      loading ||
      (!expansion && total !== undefined && lines.length >= total)
    ) return
    setLoading(true)
    setError(undefined)
    try {
      const replace = expansion !== undefined
      const chunk = await loadLines(
        file.id,
        replace ? 0 : lines.length,
        replace ? Math.max(LINE_CHUNK, lines.length + LINE_CHUNK) : LINE_CHUNK,
        expansion,
      )
      // Mark the request complete before scheduling the heavier row render so
      // the visibility effect cannot request the first chunk again.
      setTotal(chunk.total)
      setFullyExpanded(chunk.fullyExpanded)
      React.startTransition(() => {
        setLines((current) => replace ? chunk.lines : [...current, ...chunk.lines])
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  })

  const expandContext = (
    expansion: DiffExpansion,
    restoreFocus = false,
  ) => {
    setTotal(undefined)
    void loadMore(expansion).then(() => {
      if (!restoreFocus) return
      requestAnimationFrame(() => fileToggleRef.current?.focus())
    })
  }

  React.useEffect(() => {
    if (expanded && visible && lines.length === 0 && !loading && total === undefined) {
      void loadMore()
    }
  }, [expanded, visible, lines.length, loading, total])

  return (
    <article className={styles.file}>
      <div className={styles.fileHeader}>
        <button
          ref={fileToggleRef}
          type="button"
          className={styles.fileToggle}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
          <span className={styles.fileName}>{file.file}</span>
        </button>
        <span className={styles.counts}>
          <span className={styles.additions}>+{file.additions}</span>
          <span className={styles.deletions}>-{file.deletions}</span>
        </span>
        {expanded && file.complete && (
          <button
            type="button"
            className={`${styles.contextToggle} ${fullyExpanded ? styles.contextToggleActive : ''}`}
            onClick={() => expandContext({ direction: fullyExpanded ? 'reset' : 'file-all' })}
            aria-label={fullyExpanded ? `Hide unchanged lines in ${file.file}` : `Show all lines in ${file.file}`}
            title={fullyExpanded ? 'Hide unchanged lines' : 'Show all lines'}
          >
            <ExpandLinesIcon size={15} />
          </button>
        )}
      </div>
      {expanded && (
        <div
          className={styles.diffBody}
          ref={bodyRef}
          onPointerDownCapture={handlePointerDown}
          onPointerMoveCapture={handlePointerMove}
          onPointerUpCapture={handlePointerEnd}
          onPointerCancelCapture={handlePointerEnd}
        >
          {lines.map((line, index) => (
            <DiffLineView
              key={`${line.kind}:${line.gapStart ?? index}:${line.gapEnd ?? ''}`}
              line={line}
              onExpand={expandContext}
            />
          ))}
          {(loading || (!visible && lines.length === 0)) && <p className={styles.loading}>Loading diff…</p>}
          {error && <button className={styles.loadMore} type="button" onClick={() => void loadMore()}>Retry</button>}
          {!loading && total !== undefined && lines.length < total && (
            <button className={styles.loadMore} type="button" onClick={() => void loadMore()}>
              Show {Math.min(LINE_CHUNK, total - lines.length)} more lines
            </button>
          )}
          {!loading && total === 0 && <p className={styles.loading}>No textual diff available.</p>}
        </div>
      )}
    </article>
  )
}

function DiffLineView({
  line,
  onExpand,
}: {
  line: SessionDiffLine
  onExpand: (expansion: DiffExpansion, restoreFocus?: boolean) => void
}) {
  if (line.kind === 'hunk') return <div className={styles.hunk}>{line.text}</div>
  if (line.kind === 'gap') {
    const range = { start: line.gapStart, end: line.gapEnd }
    return (
      <div className={styles.gap}>
        <div className={styles.gapButtons}>
          <button
            type="button"
            onClick={(event) => onExpand(
              { direction: 'up', ...range },
              event.detail === 0,
            )}
            aria-label="Show 20 lines above"
            title="Show 20 lines above"
          >
            <ChevronDownIcon className={styles.chevronUp} size={14} />
          </button>
          <button
            type="button"
            onClick={(event) => onExpand(
              { direction: 'down', ...range },
              event.detail === 0,
            )}
            aria-label="Show 20 lines below"
            title="Show 20 lines below"
          >
            <ChevronDownIcon size={14} />
          </button>
          <button
            type="button"
            onClick={(event) => onExpand(
              { direction: 'all', ...range },
              event.detail === 0,
            )}
            aria-label={`Show all ${line.hiddenLines} hidden lines`}
            title="Show all hidden lines"
          >
            <ExpandLinesIcon size={14} />
          </button>
        </div>
        <span>{line.hiddenLines} unchanged lines</span>
      </div>
    )
  }
  const marker = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '
  return (
    <div className={`${styles.line} ${styles[line.kind]}`}>
      <span className={styles.lineNumber}>{line.oldLine ?? ''}</span>
      <span className={styles.lineNumber}>{line.newLine ?? ''}</span>
      <code><span className={styles.marker}>{marker}</span>{line.text}</code>
    </div>
  )
}

export default SessionDiffPanel

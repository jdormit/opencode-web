import * as React from 'react'
import { createPortal } from 'react-dom'
import { FIT_IMAGE, zoomImage } from '~/lib/image-zoom'
import { XIcon } from './icons'
import styles from './ChatImage.module.css'

export function ChatImage({
  src,
  alt = 'Chat image',
  className,
  title,
}: {
  src: string
  alt?: string
  className?: string
  title?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState(FIT_IMAGE)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const pointers = React.useRef(new Map<number, { x: number; y: number }>())
  const moved = React.useRef(false)
  const backdrop = React.useRef(false)
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    dialog?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const stage = stageRef.current
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = stage!.getBoundingClientRect()
      setView((current) => zoomImage(current, current.scale * Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      }))
    }
    stage?.addEventListener('wheel', wheel, { passive: false })
    return () => {
      stage?.removeEventListener('wheel', wheel)
      pointers.current.clear()
      dialog?.close()
      document.body.style.overflow = overflow
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`View image: ${alt || 'Chat image'}`}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setView(FIT_IMAGE)
          setOpen(true)
        }}
      >
        <img src={src} alt={alt} className={className} title={title} />
      </button>
      {open && createPortal(
        <dialog
          ref={dialogRef}
          className={styles.dialog}
          aria-label={alt || 'Chat image'}
          onCancel={() => setOpen(false)}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <button
            type="button"
            className={styles.close}
            aria-label="Close image"
            autoFocus
            onClick={() => setOpen(false)}
          >
            <XIcon size={24} />
          </button>
          <div
            ref={stageRef}
            className={styles.stage}
            data-zoomed={view.scale > 1}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              if (pointers.current.size === 0) {
                moved.current = false
                backdrop.current = event.target === event.currentTarget
              } else moved.current = true
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const previous = pointers.current.get(event.pointerId)
              if (!previous) return
              const next = { x: event.clientX, y: event.clientY }
              const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
              const dx = next.x - previous.x
              const dy = next.y - previous.y
              if (dx || dy) moved.current = true
              pointers.current.set(event.pointerId, next)
              if (other) {
                const distance = Math.hypot(previous.x - other.x, previous.y - other.y)
                const nextDistance = Math.hypot(next.x - other.x, next.y - other.y)
                if (!distance) return
                const rect = event.currentTarget.getBoundingClientRect()
                setView((current) => {
                  const zoomed = zoomImage(current, current.scale * nextDistance / distance, {
                    x: (previous.x + other.x) / 2 - rect.left - rect.width / 2,
                    y: (previous.y + other.y) / 2 - rect.top - rect.height / 2,
                  })
                  return zoomed.scale === 1 ? FIT_IMAGE : {
                    ...zoomed, x: zoomed.x + dx / 2, y: zoomed.y + dy / 2,
                  }
                })
              } else setView((current) => current.scale === 1 ? current : {
                ...current, x: current.x + dx, y: current.y + dy,
              })
            }}
            onPointerUp={(event) => pointers.current.delete(event.pointerId)}
            onPointerCancel={(event) => {
              moved.current = true
              pointers.current.delete(event.pointerId)
            }}
            onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
            onClick={() => {
              if (backdrop.current && !moved.current) setOpen(false)
            }}
            onDoubleClick={() => {
              if (!backdrop.current) {
                setView((current) => current.scale > 1 ? FIT_IMAGE : zoomImage(current, 2))
              }
            }}
          >
            <img
              className={styles.image}
              src={src}
              alt={alt}
              draggable={false}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            />
          </div>
          <div className={styles.zoomControls} role="group" aria-label="Image zoom">
            <button type="button" aria-label="Zoom out" disabled={view.scale <= 1}
              onClick={() => setView((current) => zoomImage(current, current.scale / 1.5))}>−</button>
            <button type="button" aria-label="Reset zoom" onClick={() => setView(FIT_IMAGE)}>
              {Math.round(view.scale * 100)}%
            </button>
            <button type="button" aria-label="Zoom in" disabled={view.scale >= 5}
              onClick={() => setView((current) => zoomImage(current, current.scale * 1.5))}>+</button>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}

import * as React from 'react'
import { Drawer } from 'vaul'
import { XIcon } from './icons'
import styles from './Sheet.module.css'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  /** Override where focus goes when the sheet closes. */
  onCloseAutoFocus?: (event: Event) => void
}

/** Bottom sheet on mobile; centered and width-capped on larger screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  onCloseAutoFocus,
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className={styles.overlay} />
        <Drawer.Content
          className={styles.content}
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className={styles.handle} />
          <header className={styles.header}>
            <button
              type="button"
              className={styles.close}
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <XIcon size={18} />
            </button>
            <Drawer.Title className={styles.title}>{title}</Drawer.Title>
            <span className={styles.spacer} />
          </header>
          <div className={styles.body}>{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

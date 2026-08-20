import * as React from 'react'
import styles from './Dialog.module.css'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Renders as role="alertdialog", for destructive confirmations. */
  alert?: boolean
  children?: React.ReactNode
  actions: React.ReactNode
}

/**
 * Centered modal built on the native <dialog> element, so it lives in the top
 * layer and needs no z-index coordination with the vaul drawers and sheets.
 * Focus trapping, Escape, and focus restore come from the platform.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  alert,
  children,
  actions,
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // showModal() throws if the dialog is already open.
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      // Escape and close() both fire this; keep React state in sync.
      onClose={() => onOpenChange(false)}
      // The backdrop counts as the dialog itself, so a click that lands on the
      // element rather than the panel came from outside.
      onClick={(event) => {
        if (event.target === ref.current) onOpenChange(false)
      }}
    >
      <div className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {children}
        <div className={styles.actions}>{actions}</div>
      </div>
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      alert
      actions={
        <>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            // Cancel holds focus so a stray Enter is never destructive.
            autoFocus
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? styles.danger : styles.primary}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className={styles.message}>{message}</p>
    </Dialog>
  )
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel,
  cancelLabel = 'Cancel',
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  placeholder?: string
  initialValue?: string
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = React.useState(initialValue)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    setValue(initialValue)
    // Runs after <dialog> autofocus, so the text is selected and replaceable.
    inputRef.current?.select()
  }, [open, initialValue])

  const submit = () => {
    const next = value.trim()
    if (!next) return
    onSubmit(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      actions={
        <>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !value.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <label className={styles.field}>
        <span>{label}</span>
        <input
          ref={inputRef}
          value={value}
          disabled={busy}
          placeholder={placeholder}
          autoFocus
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          // A form would submit through the dialog and needs a hidden submit
          // button, which assistive tech then announces twice.
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submit()
          }}
        />
      </label>
    </Dialog>
  )
}

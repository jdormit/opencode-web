import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { agentsQuery, projectName, providersQuery } from '~/lib/oc'
import type { Project } from '~/lib/oc'
import { findModel } from '~/lib/model-usage'
import type { ModelRef } from '~/lib/model-usage'
import {
  ACCEPTED_FILE_TYPES,
  createAttachment,
} from '~/lib/attachments'
import type { MessageAttachment } from '~/lib/attachments'
import {
  COMPOSER_BUILTINS,
  filterSlashItems,
  slashQuery,
} from '~/lib/commands'
import type { SlashItem } from '~/lib/commands'
import {
  ArrowUpIcon,
  BotIcon,
  ChipIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  StopIcon,
  XIcon,
} from './icons'
import { AgentSheet, ModelSheet, ProjectSheet, SkillSheet } from './pickers'
import { OpenProjectSheet } from './OpenProjectSheet'
import styles from './Composer.module.css'

export interface ComposerProps {
  placeholder?: string
  onSend: (
    text: string,
    attachments: Array<MessageAttachment>,
  ) => void | Promise<void>
  busy?: boolean
  onAbort?: () => void
  sending?: boolean

  /** When provided, a project picker pill is shown (new sessions only). */
  project?: Project
  directory?: string
  onProjectChange?: (project: Project, directory?: string) => void

  modelRef?: ModelRef
  onModelChange: (ref: ModelRef) => void

  agentName?: string
  onAgentChange: (name: string) => void

  autoFocus?: boolean

  /** Slash commands beyond the composer's own /model and /agent. */
  commands?: Array<SlashItem>
  /** Invoked when a built-in ("action") slash command is selected. */
  onCommandAction?: (name: string) => void
  /** Lets the page replace the draft (e.g. /undo restores the message). */
  handleRef?: React.Ref<ComposerHandle>
}

export interface ComposerHandle {
  setDraft: (text: string) => void
}

type SheetName =
  | 'project'
  | 'openProject'
  | 'model'
  | 'agent'
  | 'skills'
  | null

export function Composer({
  placeholder = 'Message opencode…',
  onSend,
  busy,
  onAbort,
  sending,
  project,
  directory,
  onProjectChange,
  modelRef,
  onModelChange,
  agentName,
  onAgentChange,
  autoFocus,
  commands,
  onCommandAction,
  handleRef,
}: ComposerProps) {
  const [text, setText] = React.useState('')
  const [attachments, setAttachments] = React.useState<Array<MessageAttachment>>(
    [],
  )
  const [attachmentError, setAttachmentError] = React.useState<string>()
  const [addingAttachments, setAddingAttachments] = React.useState(false)
  const [sheet, setSheet] = React.useState<SheetName>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const skillPickedRef = React.useRef(false)

  const providers = useQuery(providersQuery(directory))
  const agents = useQuery(agentsQuery())

  const selectedModel = findModel(providers.data, modelRef)
  const directoryLabel = directory
    ?.replace(/\/+$/, '')
    .split('/')
    .at(-1)

  const resize = React.useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  React.useImperativeHandle(
    handleRef,
    () => ({
      setDraft: (value: string) => {
        setText(value)
        requestAnimationFrame(resize)
        textareaRef.current?.focus()
      },
    }),
    [resize],
  )

  /* ---- Slash command popover ---- */
  const slashItems = React.useMemo(
    () => [...(commands ?? []), ...COMPOSER_BUILTINS],
    [commands],
  )
  const [slashDismissed, setSlashDismissed] = React.useState(false)
  const [slashIndex, setSlashIndex] = React.useState(0)
  const slashListRef = React.useRef<HTMLDivElement>(null)
  const slashToken = slashQuery(text)
  const filteredSlash =
    slashToken !== null ? filterSlashItems(slashItems, slashToken) : []
  const slashOpen = !slashDismissed && filteredSlash.length > 0
  const activeSlash = Math.min(slashIndex, filteredSlash.length - 1)

  React.useEffect(() => {
    setSlashDismissed(false)
    setSlashIndex(0)
  }, [slashToken])

  React.useEffect(() => {
    if (!slashOpen) return
    slashListRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeSlash, slashOpen])

  const selectSlashItem = (item: SlashItem) => {
    if (item.kind === 'template') {
      setText(`/${item.name} `)
      requestAnimationFrame(resize)
      textareaRef.current?.focus()
      return
    }
    setText('')
    requestAnimationFrame(resize)
    if (
      item.name === 'model' ||
      item.name === 'agent' ||
      item.name === 'skills'
    ) {
      setSheet(item.name)
      return
    }
    onCommandAction?.(item.name)
  }

  const canSend =
    (text.trim().length > 0 || attachments.length > 0) &&
    !addingAttachments &&
    !sending &&
    (!onProjectChange || !!project)

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setAddingAttachments(true)
    setAttachmentError(undefined)
    const added: Array<MessageAttachment> = []
    try {
      for (const file of Array.from(files)) {
        try {
          added.push(await createAttachment(file))
        } catch (error) {
          setAttachmentError(
            error instanceof Error ? error.message : 'Could not attach file',
          )
        }
      }
      if (added.length) setAttachments((current) => [...current, ...added])
    } finally {
      setAddingAttachments(false)
    }
  }

  const submit = async () => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || sending || addingAttachments) return
    const sentAttachments = attachments
    setText('')
    setAttachments([])
    setAttachmentError(undefined)
    requestAnimationFrame(resize)
    try {
      await onSend(value, sentAttachments)
    } catch {
      // Restore the draft; the page surfaces the error itself.
      setText(value)
      setAttachments(sentAttachments)
    }
  }

  return (
    <div className={styles.composer}>
      {attachments.length > 0 && (
        <div className={styles.attachments}>
          {attachments.map((attachment) => (
            <div className={styles.attachment} key={attachment.id}>
              {attachment.mime.startsWith('image/') ? (
                <img
                  className={styles.attachmentImage}
                  src={attachment.url}
                  alt={attachment.filename}
                />
              ) : (
                <div className={styles.attachmentFile}>
                  <FileIcon size={18} />
                  <span>{attachment.filename}</span>
                </div>
              )}
              <button
                type="button"
                className={styles.removeAttachment}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.id !== attachment.id),
                  )
                }
                aria-label={`Remove ${attachment.filename}`}
              >
                <XIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachmentError && (
        <div className={styles.attachmentError} role="alert">
          {attachmentError}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={styles.input}
        placeholder={placeholder}
        value={text}
        rows={1}
        autoFocus={autoFocus}
        enterKeyHint="send"
        onChange={(e) => {
          setText(e.target.value)
          resize()
        }}
        onKeyDown={(e) => {
          if (slashOpen && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
              e.preventDefault()
              setSlashIndex((activeSlash + 1) % filteredSlash.length)
              return
            }
            if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
              e.preventDefault()
              setSlashIndex(
                (activeSlash - 1 + filteredSlash.length) %
                  filteredSlash.length,
              )
              return
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
              e.preventDefault()
              selectSlashItem(filteredSlash[activeSlash])
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setSlashDismissed(true)
              return
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {slashOpen && (
        <div
          className={styles.commandPopover}
          ref={slashListRef}
          role="listbox"
          aria-label="Slash commands"
          // Keep focus (and the mobile keyboard) on the textarea.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          {filteredSlash.map((item, index) => (
            <button
              key={`${item.kind}-${item.name}`}
              type="button"
              role="option"
              aria-selected={index === activeSlash}
              data-active={index === activeSlash || undefined}
              className={styles.commandRow}
              onPointerMove={() => setSlashIndex(index)}
              onClick={() => selectSlashItem(item)}
            >
              <span className={styles.commandName}>/{item.name}</span>
              {item.description && (
                <span className={styles.commandDescription}>
                  {item.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.attach}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Add attachment"
        >
          <PlusIcon size={18} />
        </button>
        {onProjectChange && (
          <button
            type="button"
            className={styles.pill}
            onClick={() => setSheet('project')}
          >
            <FolderIcon size={14} />
            <span className={styles.pillLabel}>
              {project
                ? directory !== project.worktree && directoryLabel
                  ? directoryLabel
                  : projectName(project)
                : 'Choose project'}
            </span>
          </button>
        )}
        <button
          type="button"
          className={styles.pill}
          onClick={() => setSheet('model')}
        >
          <ChipIcon size={14} />
          <span className={styles.pillLabel}>
            {selectedModel?.model.name ?? 'Model'}
          </span>
        </button>
        <button
          type="button"
          className={styles.pill}
          onClick={() => setSheet('agent')}
        >
          <BotIcon size={14} />
          <span className={styles.pillLabel}>{agentName ?? 'Agent'}</span>
        </button>
        <span className={styles.spacer} />
        {busy && onAbort ? (
          <button
            type="button"
            className={styles.stop}
            onClick={onAbort}
            aria-label="Stop"
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.send}
            disabled={!canSend}
            onClick={() => void submit()}
            aria-label="Send"
          >
            <ArrowUpIcon size={18} />
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        accept={ACCEPTED_FILE_TYPES.join(',')}
        multiple
        onChange={(event) => {
          void addFiles(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />

      {onProjectChange && (
        <ProjectSheet
          open={sheet === 'project'}
          onOpenChange={(open) => setSheet(open ? 'project' : null)}
          selected={project}
          onSelect={(p) => {
            onProjectChange(p)
            setSheet(null)
          }}
          onOpenProject={() => setSheet('openProject')}
        />
      )}
      {onProjectChange && (
        <OpenProjectSheet
          open={sheet === 'openProject'}
          onOpenChange={(open) => setSheet(open ? 'openProject' : null)}
          onSelect={(project, selectedDirectory) => {
            onProjectChange(project, selectedDirectory)
            setSheet(null)
          }}
        />
      )}
      <ModelSheet
        open={sheet === 'model'}
        onOpenChange={(open) => setSheet(open ? 'model' : null)}
        selected={modelRef}
        directory={directory}
        onSelect={(ref) => {
          onModelChange(ref)
          setSheet(null)
        }}
      />
      <AgentSheet
        open={sheet === 'agent'}
        onOpenChange={(open) => setSheet(open ? 'agent' : null)}
        agents={agents.data ?? []}
        selected={agentName}
        onSelect={(name) => {
          onAgentChange(name)
          setSheet(null)
        }}
      />
      <SkillSheet
        open={sheet === 'skills'}
        onOpenChange={(open) => setSheet(open ? 'skills' : null)}
        directory={directory}
        onSelect={(name) => {
          setSheet(null)
          // Skills execute as commands; queue the name so the user can add
          // arguments before sending.
          skillPickedRef.current = true
          setText(`/${name} `)
          requestAnimationFrame(resize)
        }}
        onCloseAutoFocus={(event) => {
          // After picking a skill, put the caret back in the composer so
          // arguments can be typed. Leave focus alone on plain dismissal so
          // the mobile keyboard doesn't pop open uninvited.
          if (!skillPickedRef.current) return
          skillPickedRef.current = false
          event.preventDefault()
          textareaRef.current?.focus()
        }}
      />
    </div>
  )
}

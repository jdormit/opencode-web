import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { agentsQuery, projectName, providersQuery } from '~/lib/oc'
import type { Project } from '~/lib/oc'
import { findModel } from '~/lib/model-usage'
import type { ModelRef } from '~/lib/model-usage'
import { ArrowUpIcon, BotIcon, ChipIcon, FolderIcon, StopIcon } from './icons'
import { AgentSheet, ModelSheet, ProjectSheet } from './pickers'
import { OpenProjectSheet } from './OpenProjectSheet'
import styles from './Composer.module.css'

export interface ComposerProps {
  placeholder?: string
  onSend: (text: string) => void | Promise<void>
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
}

type SheetName = 'project' | 'openProject' | 'model' | 'agent' | null

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
}: ComposerProps) {
  const [text, setText] = React.useState('')
  const [sheet, setSheet] = React.useState<SheetName>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

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

  const canSend =
    text.trim().length > 0 && !sending && (!onProjectChange || !!project)

  const submit = async () => {
    const value = text.trim()
    if (!value || sending) return
    setText('')
    requestAnimationFrame(resize)
    try {
      await onSend(value)
    } catch {
      // Restore the draft; the page surfaces the error itself.
      setText(value)
    }
  }

  return (
    <div className={styles.composer}>
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
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className={styles.controls}>
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
    </div>
  )
}

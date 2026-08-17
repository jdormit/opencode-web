import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectName, projectsQuery, providersQuery } from '~/lib/oc'
import type { Agent, Project } from '~/lib/oc'
import { modelKey, rankModels } from '~/lib/model-usage'
import type { ModelRef, RankedModel } from '~/lib/model-usage'
import { Sheet } from './Sheet'
import { CheckIcon, ChevronRightIcon, SearchIcon } from './icons'
import styles from './pickers.module.css'

/* ---- Project picker ---- */

export function ProjectSheet({
  open,
  onOpenChange,
  selected,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected?: Project
  onSelect: (project: Project) => void
}) {
  const projects = useQuery(projectsQuery())
  const [search, setSearch] = React.useState('')

  const filtered = (projects.data ?? []).filter((p) =>
    p.worktree.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Choose project">
      {(projects.data?.length ?? 0) > 6 && (
        <SearchInput value={search} onChange={setSearch} />
      )}
      <ul className={styles.list}>
        {filtered.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              className={styles.row}
              onClick={() => onSelect(project)}
            >
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{projectName(project)}</span>
                <span className={styles.rowSubtitle}>{project.worktree}</span>
              </span>
              {selected?.id === project.id && (
                <CheckIcon size={18} className={styles.check} />
              )}
            </button>
          </li>
        ))}
        {projects.isSuccess && filtered.length === 0 && (
          <li className={styles.empty}>No projects found</li>
        )}
      </ul>
    </Sheet>
  )
}

/* ---- Model picker ---- */

export function ModelSheet({
  open,
  onOpenChange,
  selected,
  directory,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected?: ModelRef
  directory?: string
  onSelect: (ref: ModelRef) => void
}) {
  const providers = useQuery(providersQuery(directory))
  const [showAll, setShowAll] = React.useState(false)
  const [search, setSearch] = React.useState('')

  React.useEffect(() => {
    if (!open) {
      setShowAll(false)
      setSearch('')
    }
  }, [open])

  const ranked = React.useMemo(
    () => (providers.data ? rankModels(providers.data) : []),
    [providers.data],
  )

  const top = ranked.slice(0, 4)
  const visible = showAll
    ? ranked.filter(
        (m) =>
          m.model.name.toLowerCase().includes(search.toLowerCase()) ||
          m.provider.name.toLowerCase().includes(search.toLowerCase()),
      )
    : top

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Select model">
      {showAll && <SearchInput value={search} onChange={setSearch} autoFocus />}
      <ul className={styles.list}>
        {visible.map((entry) => (
          <ModelRow
            key={modelKey(entry.ref)}
            entry={entry}
            selected={
              selected ? modelKey(selected) === modelKey(entry.ref) : false
            }
            onSelect={onSelect}
          />
        ))}
        {providers.isSuccess && visible.length === 0 && (
          <li className={styles.empty}>No models found</li>
        )}
        {providers.isError && (
          <li className={styles.empty}>Couldn't load models</li>
        )}
      </ul>
      {!showAll && ranked.length > 4 && (
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setShowAll(true)}
        >
          More models
          <ChevronRightIcon size={16} />
        </button>
      )}
    </Sheet>
  )
}

function ModelRow({
  entry,
  selected,
  onSelect,
}: {
  entry: RankedModel
  selected: boolean
  onSelect: (ref: ModelRef) => void
}) {
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        onClick={() => onSelect(entry.ref)}
      >
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{entry.model.name}</span>
          <span className={styles.rowSubtitle}>{entry.provider.name}</span>
        </span>
        {selected && <CheckIcon size={18} className={styles.check} />}
      </button>
    </li>
  )
}

/* ---- Agent picker ---- */

export function AgentSheet({
  open,
  onOpenChange,
  agents,
  selected,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: Array<Agent>
  selected?: string
  onSelect: (name: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Select agent">
      <ul className={styles.list}>
        {agents.map((agent) => (
          <li key={agent.name}>
            <button
              type="button"
              className={styles.row}
              onClick={() => onSelect(agent.name)}
            >
              <span className={styles.rowText}>
                <span className={`${styles.rowTitle} ${styles.capitalize}`}>
                  {agent.name}
                </span>
                {agent.description && (
                  <span className={styles.rowSubtitle}>
                    {agent.description}
                  </span>
                )}
              </span>
              {selected === agent.name && (
                <CheckIcon size={18} className={styles.check} />
              )}
            </button>
          </li>
        ))}
        {agents.length === 0 && (
          <li className={styles.empty}>No agents configured</li>
        )}
      </ul>
    </Sheet>
  )
}

/* ---- Shared ---- */

function SearchInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  return (
    <div className={styles.search}>
      <SearchIcon size={16} />
      <input
        type="text"
        placeholder="Search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

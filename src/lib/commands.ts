/**
 * Slash command logic. Server-defined commands ("template") insert
 * `/name ` into the composer and are executed by the server, which expands
 * the command template ($ARGUMENTS, $1..$N, shell interpolation). Built-in
 * commands ("action") run a client-side action immediately.
 */

export interface SlashItem {
  name: string
  description?: string
  kind: 'action' | 'template'
}

/**
 * The token being completed, or null when the popover should be closed.
 * Matches the official client: the draft must be exactly "/" plus a single
 * token, so the popover closes as soon as arguments start.
 */
export function slashQuery(text: string): string | null {
  const match = text.match(/^\/(\S*)$/)
  return match ? match[1] : null
}

export function filterSlashItems(
  items: Array<SlashItem>,
  query: string,
): Array<SlashItem> {
  const q = query.toLowerCase()
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const rank = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : 1)
      return rank(a.item.name) - rank(b.item.name) || a.index - b.index
    })
    .map(({ item }) => item)
}

/** Split a submitted draft into a command name and its raw arguments. */
export function parseCommandInput(
  text: string,
): { name: string; args: string } | null {
  const match = text.match(/^\/(\S+)([\s\S]*)$/)
  if (!match) return null
  return { name: match[1], args: match[2].trim() }
}

/**
 * Popover items for server-defined commands. Skill-sourced commands are
 * hidden, matching the TUI: skills stay executable (they remain in the
 * server command list) but are browsed via the /skills picker instead of
 * cluttering the main popover.
 */
export function commandSlashItems(
  commands: Array<{ name: string; description?: string; source?: string }>,
): Array<SlashItem> {
  return commands
    .filter((command) => command.source !== 'skill')
    .map((command) => ({
      name: command.name,
      description: command.description,
      kind: 'template' as const,
    }))
}

/** Built-ins the composer itself provides on every page. */
export const COMPOSER_BUILTINS: Array<SlashItem> = [
  { name: 'model', description: 'Choose a model', kind: 'action' },
  { name: 'agent', description: 'Choose an agent', kind: 'action' },
  { name: 'skills', description: 'Browse and run a skill', kind: 'action' },
]

export interface SessionBuiltinContext {
  shareEnabled: boolean
  shared: boolean
  hasUserMessages: boolean
  reverted: boolean
}

/** Built-ins available inside an open session, mirroring the official app. */
export function sessionBuiltins(
  ctx: SessionBuiltinContext,
): Array<SlashItem> {
  const items: Array<SlashItem> = [
    { name: 'new', description: 'Start a new session', kind: 'action' },
  ]
  if (ctx.shareEnabled) {
    items.push({
      name: 'share',
      description: ctx.shared
        ? 'Copy the share link'
        : 'Share this session and copy the link',
      kind: 'action',
    })
    if (ctx.shared) {
      items.push({
        name: 'unshare',
        description: 'Stop sharing this session',
        kind: 'action',
      })
    }
  }
  if (ctx.hasUserMessages) {
    items.push(
      { name: 'fork', description: 'Fork this session', kind: 'action' },
      {
        name: 'compact',
        description: 'Summarize the conversation to free up context',
        kind: 'action',
      },
      {
        name: 'undo',
        description: 'Revert the last message',
        kind: 'action',
      },
    )
  }
  if (ctx.reverted) {
    items.push({
      name: 'redo',
      description: 'Restore reverted messages',
      kind: 'action',
    })
  }
  items.push({
    name: 'export',
    description: 'Download this session as JSON',
    kind: 'action',
  })
  return items
}

/**
 * Where the transcript is cut off by an active revert: messages from
 * `index` onward are hidden until the revert is cleared or committed.
 */
export function revertBoundary(
  messages: Array<{ info: { id: string; role: string } }>,
  revertMessageID: string | undefined,
): { index: number; revertedUserCount: number } | null {
  if (!revertMessageID) return null
  const index = messages.findIndex((m) => m.info.id === revertMessageID)
  if (index === -1) return null
  const revertedUserCount = messages
    .slice(index)
    .filter((m) => m.info.role === 'user').length
  return { index, revertedUserCount }
}

/** Matches the filename produced by the official client's /export. */
export function sessionExportFilename(session: {
  id: string
  title?: string
}): string {
  const name = session.title || session.id
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return `${clean || session.id}.json`
}

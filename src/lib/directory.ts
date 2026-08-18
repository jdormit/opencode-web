export function normalizeDirectory(raw: string, home: string): string | undefined {
  const value = raw.trim()
  if (!value) return undefined
  const expanded = value === '~' ? home : value.startsWith('~/') ? `${home}/${value.slice(2)}` : value
  if (!expanded.startsWith('/')) return undefined
  return expanded.replace(/\/+$/, '') || '/'
}

export function parentDirectory(directory: string): string {
  const normalized = directory.replace(/\/+$/, '') || '/'
  if (normalized === '/') return '/'
  const separator = normalized.lastIndexOf('/')
  return separator <= 0 ? '/' : normalized.slice(0, separator)
}

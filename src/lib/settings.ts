export const SERVER_URL_COOKIE = 'oc_server_url'
export const AUTH_COOKIE = 'oc_server_auth'
export function resolveDefaultServerUrl(configuredUrl?: string): string {
  return configuredUrl || 'http://localhost:4096'
}
export const DEFAULT_SERVER_URL = resolveDefaultServerUrl(
  import.meta.env.VITE_OPENCODE_SERVER_URL,
)
export const THEME_STORAGE_KEY = 'oc-theme'

export interface ServerConfig {
  url: string
  /** base64-encoded `user:password`, or undefined when the server has no auth */
  auth?: string
}

export function normalizeServerUrl(raw: string): string {
  let url = raw.trim()
  if (!url) return DEFAULT_SERVER_URL
  if (!/^https?:\/\//.test(url)) url = `http://${url}`
  return url.replace(/\/+$/, '')
}

export function readClientCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined
}

export function writeClientCookie(name: string, value: string | undefined) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  if (value === undefined) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
  } else {
    const oneYear = 60 * 60 * 24 * 365
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${oneYear}; SameSite=Lax${secure}`
  }
}

export function getClientServerConfig(): ServerConfig {
  return {
    url: normalizeServerUrl(
      readClientCookie(SERVER_URL_COOKIE) ?? DEFAULT_SERVER_URL,
    ),
    auth: readClientCookie(AUTH_COOKIE) || undefined,
  }
}

export function encodeBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`
  if (typeof btoa !== 'undefined') return btoa(raw)
  return Buffer.from(raw, 'utf-8').toString('base64')
}

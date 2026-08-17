import { getCookie } from '@tanstack/react-start/server'
import {
  AUTH_COOKIE,
  DEFAULT_SERVER_URL,
  SERVER_URL_COOKIE,
  normalizeServerUrl,
  type ServerConfig,
} from './settings'

/** Read the OpenCode server config from request cookies. Server-side only. */
export function getServerConfigFromRequest(): ServerConfig {
  const url = getCookie(SERVER_URL_COOKIE)
  const auth = getCookie(AUTH_COOKIE)
  return {
    url: normalizeServerUrl(url ?? DEFAULT_SERVER_URL),
    auth: auth || undefined,
  }
}

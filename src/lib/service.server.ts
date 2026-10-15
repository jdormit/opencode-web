import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Service, type Endpoint } from '@opencode/client/service'

export function createServiceConnection(dependencies: {
  discover: () => Promise<Endpoint | undefined>
  start: () => Promise<unknown>
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}) {
  let pending: Promise<Endpoint> | undefined
  const endpoint = () =>
    (pending ??= (async () => {
      const found = await dependencies.discover()
      if (found) return found
      await dependencies.start()
      const started = await dependencies.discover()
      if (!started) throw new Error('OpenCode service did not start')
      return started
    })().catch((error) => {
      pending = undefined
      throw error
    }))

  return async (path: string, init?: RequestInit) => {
    const target = await endpoint()
    const send = (current: Endpoint) =>
      dependencies.fetch(new URL(path, current.url), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          ...Service.headers(current),
        },
      })
    try {
      const response = await send(target)
      if (response.status !== 401) return response
      await response.body?.cancel()
    } catch (error) {
      if (init?.signal?.aborted) throw error
    }
    // A failed transport may have admitted a mutation before losing its response.
    pending = undefined
    const current = await endpoint()
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) {
      throw new Error('OpenCode service restarted. Refresh and try again.')
    }
    return send(current)
  }
}

export const serviceFetch = createServiceConnection({
  discover: () => Service.discover(),
  start: () =>
    promisify(execFile)('opencode', ['service', 'start'], { timeout: 60_000 }),
  fetch: (...args) => fetch(...args),
})

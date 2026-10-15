import { createFileRoute } from '@tanstack/react-router'
import { serviceFetch } from '~/lib/service.server'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // fetch() transparently decompresses the body, so the original encoding
  // headers no longer describe what we forward.
  'content-length',
  'content-encoding',
])

async function proxy({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}): Promise<Response> {
  const incoming = new URL(request.url)
  const path = `/${params._splat ?? ''}`
  if (!path.startsWith('/api/')) return new Response('Not found', { status: 404 })

  const headers = new Headers()
  for (const name of ['content-type', 'accept', 'last-event-id']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const method = request.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()

  let upstream: Response
  try {
    upstream = await serviceFetch(`${path}${incoming.search}`, {
      method,
      headers,
      body,
      signal: request.signal,
      redirect: 'manual',
    })
  } catch (err) {
    return Response.json(
      {
        error: 'opencode-unreachable',
        message: 'Could not reach the local OpenCode service',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) responseHeaders.set(name, value)
  })
  // Make sure SSE responses are never buffered by intermediaries.
  if (upstream.headers.get('content-type')?.includes('text/event-stream')) {
    responseHeaders.set('cache-control', 'no-cache')
    responseHeaders.set('x-accel-buffering', 'no')
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/proxy/$')({
  server: {
    handlers: {
      GET: proxy,
      POST: proxy,
      PATCH: proxy,
      PUT: proxy,
      DELETE: proxy,
    },
  },
})

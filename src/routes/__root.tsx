/// <reference types="vite/client" />
import * as React from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { AppShell } from '~/components/shell'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { NotFound } from '~/components/NotFound'
import { useGlobalEvents } from '~/lib/events'
import {
  agentsQuery,
  projectsQuery,
  providersQuery,
  sessionStatusQuery,
  sessionsQuery,
} from '~/lib/oc'
import appCss from '~/styles/app.css?url'

const themeInitScript = `
try {
  var t = localStorage.getItem('oc-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
      },
      { title: 'opencode' },
      { name: 'theme-color', content: '#faf9f7', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#161616', media: '(prefers-color-scheme: dark)' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
    scripts: [{ children: themeInitScript }],
  }),
  loader: async ({ context }) => {
    const { queryClient } = context
    try {
      const projects = await queryClient.ensureQueryData(projectsQuery())
      await Promise.all([
        ...projects.map((p) =>
          queryClient.ensureQueryData(sessionsQuery(p.worktree)),
        ),
        // Awaited so busy indicators render consistently on server and client.
        queryClient.ensureQueryData(sessionStatusQuery()),
      ])
      // Not needed for first paint; warm them without blocking.
      void queryClient.prefetchQuery(agentsQuery())
      void queryClient.prefetchQuery(providersQuery())
    } catch {
      // Server unreachable: render anyway; the UI points at settings.
    }
  },
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
})

function RootComponent() {
  useGlobalEvents()
  return (
    <RootDocument>
      <AppShell>
        <Outlet />
      </AppShell>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

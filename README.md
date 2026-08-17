# opencode-web

A mobile-first web UI for [OpenCode](https://opencode.ai), inspired by the UX
of the Claude mobile apps. The goal is to make it pleasant to check on and
drive coding agents from a phone, while scaling up to a desktop layout with
standard responsive design.

The interface is organized around OpenCode's project/session model: a
slide-out drawer (a persistent sidebar on desktop) lists sessions grouped by
project, a single tap opens a new-session composer with bottom-sheet pickers
for project, model, and agent, and the chat view renders streaming markdown,
collapsible tool calls, and inline permission prompts. The model picker
surfaces your four most-used models, tracked locally since the server exposes
no usage stats, with the full catalog behind a searchable "More models" view.

## How it works

The app is built on [TanStack Start](https://tanstack.com/start) with
server-side rendering and TanStack Query, so first paints are fast and
navigation is cache-backed. Two architectural choices are worth knowing about:

- **All API traffic goes through a proxy route** (`/api/proxy/*`) on the Start
  server rather than from the browser to OpenCode directly. This sidesteps
  CORS entirely (the OpenCode server only allows localhost origins by default)
  and lets SSR loaders fetch data server-side. The OpenCode server URL lives
  in a cookie, configurable from the settings page, so both the proxy and SSR
  can read it. It defaults to `http://localhost:4096`.
- **Live updates come from a single SSE connection** to OpenCode's
  `/global/event` stream, mirrored into the query cache. Streaming text, title
  generation, busy indicators, and permission requests all update without
  refetching.

## Running it

You need [Bun](https://bun.sh) and an OpenCode server:

```sh
opencode serve          # in any directory; defaults to port 4096
bun install
bun run dev             # dev server on http://localhost:3000
```

For a production build:

```sh
bun run build
bun run start
```

To reach it from your phone, run the dev or production server on a machine on
your network and open that machine's address in a mobile browser. The OpenCode
server URL in settings is resolved from the machine running this app, so the
default `localhost:4096` works when both run on the same host.

If your OpenCode server sets `OPENCODE_SERVER_PASSWORD`, enter the credentials
on the settings page and they'll be forwarded as basic auth.

## Security caveat

The proxy route is intentionally unauthenticated, and it forwards requests to
whatever server URL the client's cookie names. That is a reasonable tradeoff
for the personal, localhost/LAN use this app targets, but it means anyone who
can reach this app can drive your OpenCode server — which executes commands on
your machine. Don't expose it to the public internet as-is; put it behind a
VPN (e.g. Tailscale) or an authenticating reverse proxy if you want remote
access.

## Limitations

This is an intentionally small v1 rather than a full replacement for the
official web UI or TUI. File attachments, slash commands, diff views, session
sharing, and forking aren't implemented yet. Session lists are windowed to the
100 most recent per project (the server's default cap), with full history
loaded per project on demand. Permission prompts arrive over the event stream,
so a permission requested before you opened the app won't be visible until the
next one fires.

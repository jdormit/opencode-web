# OpenCode 2 web port

Target: `@opencode/client` 2.0.29. Discover the shared service; start it through
`opencode service start` when absent. Keep credentials on the web server.

| V1 feature | V2 endpoint / event |
| --- | --- |
| Projects, open directory, server paths | `project.list`, `location.get` |
| Directory browser | `file.list` (`/api/fs/list`) |
| Session lists and children | `session.list`, `parentID` filter, cursor pagination |
| Session create/get/delete/rename | `session.create/get/remove/update` |
| Messages | `message.list`, cursor pagination |
| Agent/model/variant | `agent.list`, `model.list/default`, session switch endpoints |
| Providers | Integration/provider/model catalogs |
| Commands and skills | `command.list`, `skill.list`, `session.command`, `session.prompt` skill attachments |
| Prompt and attachments | `session.prompt` (text/files); selections belong to session |
| Abort | `session.interrupt` |
| Fork | `session.fork` with `before` boundary |
| Compact | `session.compact` |
| Undo/redo | `session.revert.stage/clear/commit` |
| Diff | `session.diff` |
| Permissions | `permission.list/reply`, `permission.asked/replied` |
| Questions | Generic `session.form.list/reply/cancel`, `form.*` events |
| Busy status | `session.active`, `session.execution.*` events |
| Streaming transcript | `/api/event`; project inbox, step, text, reasoning, tool, compaction events into V2 messages |
| Share/unshare | Dropped: no V2 protocol endpoint |
| Server URL/password settings | Removed: local service discovery |
| Export | V2 session export |

## Sequence

1. Update API and event tests to V2 contracts; implement generated-client requests and service proxy.
2. Project live events into native V2 messages and port rendering/session controls.
3. Port remaining pickers, directory browsing, permissions/forms and diff reads.
4. Run unit tests, typecheck and build; exercise isolated `web` service (49405), mock model (50405), web UI (5405).
5. Review changes independently, update README, commit and report verification and omissions.

## Implementation and verification

The API uses the generated Promise client. Small `worktree` and `directory`
aliases on project/session records keep the sidebar and project picker stable;
transcripts use native V2 messages throughout. Session selections use switch
endpoints. The server discovers the shared service, starts it through the CLI
if absent, and re-discovers after transport/authentication failure. Mutations
are not replayed after ambiguous connection failures.

Code Mode rows come from `execute` tool metadata, including live progress and
persisted completion/error status. OpenCode 2.0.29 supplies call names, inputs,
and statuses but no individual results; the aggregate execute result is shown
below the nested calls. The renderer also accepts individual results if a
later server includes them.

### Checks completed

- `bun test`: 67 passing tests, including V2 cursor requests, event projection,
  nested Code Mode calls, forms, service startup, rotated authentication, and
  mutation replay prevention.
- `bun run typecheck`, `bun run build`, and `git diff --check`: passed.
- Formatted changed implementation/test files with Prettier.
- Browser: Chrome through playwright-cli, web UI on 5405, isolated `web`
  service on 49405, mock model on 50405. Opened `/tmp/oc2-web-project`, created
  a session through the UI, and received mock replies.
- Blocked transcript HTTP reads while sending a subsequent prompt. The reply
  still appeared through events. After unblocking and reloading, the rendered
  transcript was identical (including the picker once its catalog loaded).
- Invoked `CALL_TOOL shell {"command":"printf web-tool-ok"}` using the shell
  name found in the mock request log. With an isolated wildcard `ask` rule,
  answered **Allow once** in the UI and received `done: web-tool-ok`.
- Invoked `execute` with a nested fetch of the mock model catalog. Inspected
  its nested fetch name, GET URL, completed status and aggregate result live
  and after reload. Checked the reloaded view at 390×844 with no horizontal
  page overflow.
- Invoked the question tool, approved its permission, and submitted `Blue`
  through the V2 generic form. The streamed result contained the answer.
- Stopped the isolated service while the UI was open; the web server started
  it again through discovery/CLI startup and reloaded the same session.
- Independent adversarial review completed in a fresh CLI session. Fixed its
  findings about content replacement events, directory-move transcript rows,
  and stale retry labels; added regression tests and reran checks.

### Limits and omissions

Share/unshare have no V2 endpoint and were removed. The configurable upstream
URL/password UI was removed in favor of the local service. Other mapped
features remain available. Fork, compaction, undo/redo, export, nonempty diffs,
attachments, and real authenticated provider runs were not browser-tested in
this pass. Phone pairing behavior was checked against the V2 CLI source;
remote network access was not exercised. Per-client instruction configuration
is deferred as requested.

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FormAnswer,
  IntegrationAttempt,
  IntegrationInfo,
} from '@opencode/client'
import { client, providerConnectionsQuery } from '~/lib/oc'
import {
  authError,
  connectMethods,
  methodLabel,
  popularProviders,
  safeAuthUrl,
} from '~/lib/provider-auth'
import type { ConnectMethod } from '~/lib/provider-auth'
import { defaultAnswers, visibleFields } from './QuestionSheet'
import { Dialog, ConfirmDialog } from './Dialog'
import styles from './ProviderSettings.module.css'

export function ProviderSettings() {
  const query = useQuery(providerConnectionsQuery())
  const qc = useQueryClient()
  const [selected, setSelected] = React.useState<IntegrationInfo>()
  const [disconnect, setDisconnect] = React.useState<IntegrationInfo>()
  const [search, setSearch] = React.useState('')
  const [showAll, setShowAll] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const [notice, setNotice] = React.useState<string>()
  const refresh = async () => {
    await Promise.all(
      ['provider-connections', 'providers', 'config'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
  const connected = (query.data ?? []).filter((p) => p.connections.length)
  const available = (query.data ?? [])
    .filter((p) => !p.connections.length && connectMethods(p).length)
    .filter(
      (p) =>
        (showAll || search || popularProviders.includes(p.id)) &&
        `${p.name} ${p.id}`.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const rank = (id: string) =>
        popularProviders.includes(id) ? popularProviders.indexOf(id) : 100
      return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name)
    })
  return (
    <div className={styles.content}>
      <p className={styles.help}>
        Connect your accounts to use their models in OpenCode.
      </p>
      {query.isPending && <p role="status">Loading providers…</p>}
      {query.isError && (
        <div role="alert" className={styles.error}>
          Could not load providers.{' '}
          <button onClick={() => void query.refetch()}>Retry</button>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.help}>
          {notice}
        </p>
      )}
      {!!connected.length && (
        <>
          <h3 className={styles.subheading}>Connected</h3>
          {connected.map((p) => (
            <div className={styles.row} key={p.id}>
              <div className={styles.identity}>
                <strong>{p.name}</strong>
                <span className={styles.help}>
                  {p.connections
                    .map((c) =>
                      c.type === 'env' ? 'Environment variable' : c.label,
                    )
                    .join(', ')}
                </span>
              </div>
              {p.connections.some((c) => c.type === 'credential') ? (
                <button
                  className={styles.button}
                  onClick={() => {
                    setError(undefined)
                    setDisconnect(p)
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <span className={styles.help}>Managed by environment</span>
              )}
            </div>
          ))}
        </>
      )}
      {!query.isPending && !query.isError && !connected.length && (
        <p className={styles.help}>No providers connected yet.</p>
      )}
      <h3 className={styles.subheading}>
        {showAll || search ? 'All providers' : 'Popular providers'}
      </h3>
      <input
        className={styles.input}
        type="search"
        aria-label="Search providers"
        placeholder="Search providers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {available.map((p) => (
        <div className={styles.row} key={p.id}>
          <strong className={styles.identity}>{p.name}</strong>
          <button className={styles.button} onClick={() => setSelected(p)}>
            Connect<span className={styles.srOnly}> {p.name}</span>
          </button>
        </div>
      ))}
      {!query.isPending && !query.isError && !available.length && (
        <p className={styles.help}>No matching providers.</p>
      )}
      {!showAll && !search && (
        <button className={styles.link} onClick={() => setShowAll(true)}>
          View all providers
        </button>
      )}
      {selected && (
        <ProviderConnection
          key={selected.id}
          provider={selected}
          onClose={() => setSelected(undefined)}
          onConnected={() => {
            setNotice(`${selected.name} connected.`)
            setSelected(undefined)
            void refresh()
          }}
        />
      )}
      <ConfirmDialog
        open={!!disconnect}
        onOpenChange={(open) => {
          if (!open && !busy) setDisconnect(undefined)
        }}
        title={`Disconnect ${disconnect?.name ?? 'provider'}?`}
        message="This removes the saved credentials for this provider. Environment-based connections are not changed."
        confirmLabel={busy ? 'Disconnecting…' : 'Disconnect'}
        danger
        busy={busy}
        onConfirm={async () => {
          if (!disconnect || busy) return
          setBusy(true)
          try {
            const api = await client()
            for (const c of disconnect.connections)
              if (c.type === 'credential')
                await api.credential.remove({ credentialID: c.id })
            setNotice(`${disconnect.name} disconnected.`)
            setDisconnect(undefined)
            await refresh()
          } catch (e) {
            setDisconnect(undefined)
            setError(authError(e))
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function ProviderConnection({
  provider,
  onClose,
  onConnected,
}: {
  provider: IntegrationInfo
  onClose: () => void
  onConnected: () => void
}) {
  const methods = connectMethods(provider)
  const [method, setMethod] = React.useState<ConnectMethod | undefined>(
    methods.length === 1 ? methods[0] : undefined,
  )
  const [answer, setAnswer] = React.useState<FormAnswer>(() =>
    defaultAnswers(methods.length === 1 ? (methods[0].form ?? []) : []),
  )
  const [key, setKey] = React.useState('')
  const [code, setCode] = React.useState('')
  const [attempt, setAttempt] = React.useState<IntegrationAttempt>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const attemptRef = React.useRef<IntegrationAttempt | undefined>(undefined)
  const alive = React.useRef(true)
  const sending = React.useRef(false)
  const done = React.useRef(false)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      const current = attemptRef.current
      if (current && !done.current)
        void client()
          .then((api) =>
            api.integration.oauth.cancel({
              integrationID: provider.id,
              attemptID: current.attemptID,
            }),
          )
          .catch(() => undefined)
    }
  }, [provider.id])
  const complete = React.useCallback(() => {
    done.current = true
    onConnected()
  }, [onConnected])
  React.useEffect(() => {
    if (!attempt || attempt.mode !== 'auto') return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const { data } = await (
          await client()
        ).integration.oauth.status({
          integrationID: provider.id,
          attemptID: attempt.attemptID,
        })
        if (stopped) return
        if (data.status === 'complete') {
          complete()
          return
        }
        if (data.status === 'failed') throw new Error(data.message)
        if (data.status === 'expired' || Date.now() >= attempt.time.expires)
          throw new Error('Sign-in expired. Please try again.')
        timer = setTimeout(poll, 1000)
      } catch (e) {
        if (!stopped) setError(authError(e))
      }
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [attempt, provider.id, complete])
  const submit = async () => {
    if (!method || sending.current) return
    sending.current = true
    setBusy(true)
    setError(undefined)
    try {
      const api = await client()
      const input = { integrationID: provider.id }
      if (attempt) {
        await api.integration.oauth.complete({
          ...input,
          attemptID: attempt.attemptID,
          code: code.trim(),
        })
        if (alive.current) complete()
      } else if (method.type === 'key') {
        await api.integration.connect.key({
          ...input,
          key: key.trim(),
          answer: Object.fromEntries(
            visibleFields(method.form ?? [], answer)
              .filter((f) => f.key in answer)
              .map((f) => [f.key, answer[f.key]]),
          ),
        })
        if (alive.current) complete()
      } else {
        const values = Object.fromEntries(
          visibleFields(method.form ?? [], answer)
            .filter((f) => f.key in answer)
            .map((f) => [f.key, answer[f.key]]),
        )
        if (method.type === 'external') {
          await api.integration.connect.external({
            ...input,
            methodID: method.id,
            answer: values,
          })
          if (alive.current) complete()
        } else {
          const { data } = await api.integration.oauth.connect({
            ...input,
            methodID: method.id,
            answer: values,
          })
          attemptRef.current = data
          if (!alive.current) {
            await api.integration.oauth.cancel({
              ...input,
              attemptID: data.attemptID,
            })
            return
          }
          setAttempt(data)
        }
      }
    } catch (e) {
      if (alive.current) setError(authError(e))
    } finally {
      sending.current = false
      if (alive.current) setBusy(false)
    }
  }
  const reset = () => {
    const current = attemptRef.current
    attemptRef.current = undefined
    if (current)
      void client()
        .then((api) =>
          api.integration.oauth.cancel({
            integrationID: provider.id,
            attemptID: current.attemptID,
          }),
        )
        .catch(() => undefined)
    setAttempt(undefined)
    setMethod(undefined)
    setAnswer({})
    setKey('')
    setCode('')
    setError(undefined)
  }
  const url = attempt && safeAuthUrl(attempt.url)
  return (
    <Dialog
      open
      title={`Connect ${provider.name}`}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      actions={
        <>
          {method && (
            <button className={styles.button} disabled={busy} onClick={reset}>
              Back
            </button>
          )}
          <button className={styles.button} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className={styles.content}>
        {!method ? (
          <>
            <p className={styles.help}>Choose how to connect.</p>
            {methods.map((m, i) => (
              <button
                key={i}
                className={styles.button}
                onClick={() => {
                  setMethod(m)
                  setAnswer(defaultAnswers(m.form ?? []))
                }}
              >
                {methodLabel(m)}
              </button>
            ))}
          </>
        ) : (
          <form
            className={styles.content}
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {!attempt && (
              <>
                <p className={styles.help}>{methodLabel(method)}</p>
                {method.type === 'key' && (
                  <label className={styles.field}>
                    API key
                    <input
                      className={styles.input}
                      type="password"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      required
                      value={key}
                      disabled={busy}
                      onChange={(e) => setKey(e.target.value)}
                    />
                  </label>
                )}
                {visibleFields(method.form ?? [], answer).map((field) => (
                  <label className={styles.field} key={field.key}>
                    <span>{field.title ?? field.key}</span>
                    {field.description && (
                      <small className={styles.help}>{field.description}</small>
                    )}
                    {field.type === 'external' ? (
                      <a
                        href={safeAuthUrl(field.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open link
                      </a>
                    ) : field.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={answer[field.key] === true}
                        disabled={busy}
                        onChange={(e) =>
                          setAnswer({
                            ...answer,
                            [field.key]: e.target.checked,
                          })
                        }
                      />
                    ) : field.type === 'multiselect' ? (
                      <select
                        className={styles.input}
                        multiple
                        required={field.required}
                        disabled={busy}
                        value={
                          Array.isArray(answer[field.key])
                            ? (answer[field.key] as string[])
                            : []
                        }
                        onChange={(e) =>
                          setAnswer({
                            ...answer,
                            [field.key]: Array.from(
                              e.target.selectedOptions,
                              (o) => o.value,
                            ),
                          })
                        }
                      >
                        {field.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'string' &&
                      field.options?.length &&
                      !field.custom ? (
                      <select
                        className={styles.input}
                        required={field.required}
                        disabled={busy}
                        value={String(answer[field.key] ?? '')}
                        onChange={(e) =>
                          setAnswer({ ...answer, [field.key]: e.target.value })
                        }
                      >
                        <option value="">Choose…</option>
                        {field.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={styles.input}
                        type={field.type === 'string' ? 'text' : 'number'}
                        required={field.required}
                        disabled={busy}
                        value={String(answer[field.key] ?? '')}
                        placeholder={
                          'placeholder' in field ? field.placeholder : undefined
                        }
                        minLength={
                          'minLength' in field ? field.minLength : undefined
                        }
                        maxLength={
                          'maxLength' in field ? field.maxLength : undefined
                        }
                        pattern={'pattern' in field ? field.pattern : undefined}
                        onChange={(e) =>
                          setAnswer({
                            ...answer,
                            [field.key]:
                              field.type === 'string'
                                ? e.target.value
                                : Number(e.target.value),
                          })
                        }
                      />
                    )}
                  </label>
                ))}
              </>
            )}
            {attempt && (
              <>
                {url && (
                  <a
                    className={styles.link}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open {provider.name} sign-in ↗
                  </a>
                )}
                <p className={styles.instructions}>{attempt.instructions}</p>
                {attempt.mode === 'code' ? (
                  <label className={styles.field}>
                    Authorization code
                    <input
                      className={styles.input}
                      autoFocus
                      autoComplete="off"
                      required
                      value={code}
                      disabled={busy}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                ) : (
                  !error && (
                    <p className={styles.help} role="status">
                      Waiting for authorization…
                    </p>
                  )
                )}
              </>
            )}
            {(!attempt || attempt.mode === 'code') && (
              <button
                className={styles.primary}
                type="submit"
                disabled={
                  busy ||
                  (method.type === 'key' && !key.trim()) ||
                  (!!attempt && !code.trim())
                }
              >
                {busy
                  ? 'Connecting…'
                  : attempt
                    ? 'Connect'
                    : method.type === 'key'
                      ? 'Connect'
                      : 'Continue'}
              </button>
            )}
          </form>
        )}
        {error && (
          <div role="alert" className={styles.error}>
            {error}
            {attempt?.mode === 'auto' && (
              <button className={styles.button} onClick={reset}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

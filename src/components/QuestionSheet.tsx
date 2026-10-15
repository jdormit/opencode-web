import * as React from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  markSessionEvent,
  questionsQuery,
  rejectQuestion,
  replyQuestion,
} from '~/lib/oc'
import type { FormAnswer, FormField, FormInfo } from '~/lib/oc'
import { Sheet } from './Sheet'
import styles from './QuestionSheet.module.css'

export function defaultAnswers(fields: FormField[]): FormAnswer {
  return Object.fromEntries(
    fields.flatMap((f) =>
      'default' in f && f.default !== undefined ? [[f.key, f.default]] : [],
    ),
  )
}
export function visibleFields(fields: FormField[], answer: FormAnswer) {
  return fields.filter(
    (f) =>
      !('hidden' in f && f.hidden) &&
      (!('when' in f) ||
        f.when?.every((w) =>
          w.op === 'eq' ? answer[w.key] === w.value : answer[w.key] !== w.value,
        ) !== false),
  )
}
export function QuestionSheet({
  sessionIds,
  directory,
}: {
  sessionIds: string[]
  directory: string
}) {
  const qc = useQueryClient()
  const queries = useQueries({
    queries: sessionIds.map((id) => questionsQuery(id, directory)),
  })
  const request = queries.flatMap((q) => q.data ?? [])[0]
  return request ? (
    <FormSheet
      key={request.id}
      request={request}
      onDone={() => {
        markSessionEvent(request.sessionID)
        qc.setQueryData<FormInfo[]>(
          ['questions', request.sessionID],
          (current) => current?.filter((f) => f.id !== request.id),
        )
      }}
    />
  ) : null
}
function FormSheet({
  request,
  onDone,
}: {
  request: FormInfo
  onDone: () => void
}) {
  const [answer, setAnswer] = React.useState<FormAnswer>(() =>
    defaultAnswers(request.fields),
  )
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const fields = visibleFields(request.fields, answer)
  const update = (key: string, value: FormAnswer[string]) =>
    setAnswer((current) => ({ ...current, [key]: value }))
  const settle = async (reject = false) => {
    if (sending) return
    setSending(true)
    setError(undefined)
    try {
      if (reject) await rejectQuestion(request.sessionID, request.id)
      else
        await replyQuestion(
          request.sessionID,
          request.id,
          Object.fromEntries(
            fields
              .filter((f) => f.key in answer)
              .map((f) => [f.key, answer[f.key]]),
          ),
        )
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void settle(true)
      }}
      title={request.title}
    >
      <form
        className={styles.content}
        onSubmit={(event) => {
          event.preventDefault()
          void settle()
        }}
      >
        {fields.map((field) => (
          <label className={styles.custom} key={field.key}>
            <span>{field.title ?? field.key}</span>
            {field.description && <small>{field.description}</small>}
            {field.type === 'external' ? (
              <a href={field.url} target="_blank" rel="noreferrer">
                Open link
              </a>
            ) : field.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={answer[field.key] === true}
                disabled={sending}
                onChange={(e) => update(field.key, e.target.checked)}
              />
            ) : field.type === 'multiselect' ? (
              <>
                <select
                  multiple
                  value={
                    Array.isArray(answer[field.key])
                      ? (answer[field.key] as string[])
                      : []
                  }
                  required={field.required}
                  disabled={sending}
                  onChange={(e) =>
                    update(
                      field.key,
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {field.custom && (
                  <input
                    placeholder="Other answers (comma separated)"
                    onChange={(e) =>
                      update(field.key, [
                        ...(Array.isArray(answer[field.key])
                          ? (answer[field.key] as string[])
                          : []
                        ).filter((v) =>
                          field.options.some((o) => o.value === v),
                        ),
                        ...e.target.value
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean),
                      ])
                    }
                  />
                )}
              </>
            ) : field.type === 'string' ? (
              <>
                {field.options && !field.custom ? (
                  <select
                    value={String(answer[field.key] ?? '')}
                    required={field.required}
                    disabled={sending}
                    onChange={(e) => update(field.key, e.target.value)}
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
                    value={String(answer[field.key] ?? '')}
                    list={
                      field.options
                        ? `form-${request.id}-${field.key}`
                        : undefined
                    }
                    required={field.required}
                    disabled={sending}
                    placeholder={field.placeholder}
                    minLength={field.minLength}
                    maxLength={field.maxLength}
                    pattern={field.pattern}
                    onChange={(e) => update(field.key, e.target.value)}
                  />
                )}
                {field.options && field.custom && (
                  <datalist id={`form-${request.id}-${field.key}`}>
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                )}
              </>
            ) : (
              <input
                type="number"
                value={String(answer[field.key] ?? '')}
                required={field.required}
                disabled={sending}
                step={field.type === 'integer' ? 1 : 'any'}
                min={
                  typeof field.minimum === 'number' ? field.minimum : undefined
                }
                max={
                  typeof field.maximum === 'number' ? field.maximum : undefined
                }
                onChange={(e) => {
                  if (e.target.value === '')
                    setAnswer((current) => {
                      const next = { ...current }
                      delete next[field.key]
                      return next
                    })
                  else update(field.key, Number(e.target.value))
                }}
              />
            )}
          </label>
        ))}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.reject}
            disabled={sending}
            onClick={() => void settle(true)}
          >
            Dismiss
          </button>
          <button type="submit" className={styles.primary} disabled={sending}>
            {sending ? 'Sending…' : 'Submit'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

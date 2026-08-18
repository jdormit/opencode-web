import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  markQuestionEvent,
  questionsQuery,
  rejectQuestion,
  replyQuestion,
} from '~/lib/oc'
import type { QuestionAnswer, QuestionRequest } from '~/lib/oc'
import { Sheet } from './Sheet'
import styles from './QuestionSheet.module.css'

function replaceAt<T>(
  values: Array<T>,
  index: number,
  value: T,
) {
  const next = [...values]
  next[index] = value
  return next
}

export function buildQuestionAnswers(
  count: number,
  answers: Array<QuestionAnswer>,
  custom: Array<string>,
) {
  return Array.from({ length: count }, (_, index) => {
    const ownAnswer = custom[index]?.trim()
    return ownAnswer
      ? [...new Set([...(answers[index] ?? []), ownAnswer])]
      : answers[index] ?? []
  })
}

export function QuestionSheet({
  sessionId,
  directory,
}: {
  sessionId: string
  directory: string
}) {
  const queryClient = useQueryClient()
  const { data: requests = [] } = useQuery(
    questionsQuery(sessionId, directory),
  )
  const request = requests[0]
  const [index, setIndex] = React.useState(0)
  const [answers, setAnswers] = React.useState<Array<QuestionAnswer>>([])
  const [custom, setCustom] = React.useState<Array<string>>([])
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string>()

  React.useEffect(() => {
    setIndex(0)
    setAnswers([])
    setCustom([])
    setSending(false)
    setError(undefined)
  }, [request?.id])

  if (!request) return null
  const question = request.questions[index]
  if (!question) return null

  const selected = answers[index] ?? []
  const multiple = question.multiple === true
  const last = index === request.questions.length - 1

  const removeRequest = () => {
    markQuestionEvent(sessionId)
    queryClient.setQueryData<Array<QuestionRequest>>(
      ['questions', sessionId],
      (current) => current?.filter((item) => item.id !== request.id),
    )
  }

  const selectOption = (label: string) => {
    setError(undefined)
    setAnswers((current) => {
      const previous = current[index] ?? []
      if (!multiple) return replaceAt(current, index, [label])
      const next = previous.includes(label)
        ? previous.filter((item) => item !== label)
        : [...previous, label]
      return replaceAt(current, index, next)
    })
    if (!multiple && custom[index]) {
      setCustom((current) => replaceAt(current, index, ''))
    }
  }

  const updateCustom = (value: string) => {
    setCustom((current) => replaceAt(current, index, value))
    if (!multiple && value.trim()) {
      setAnswers((current) => replaceAt(current, index, []))
    }
  }

  const reject = async () => {
    if (sending) return
    setSending(true)
    setError(undefined)
    try {
      await rejectQuestion(directory, request.id)
      removeRequest()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }

  const submit = async () => {
    if (sending) return
    setSending(true)
    setError(undefined)
    try {
      const ordered = buildQuestionAnswers(
        request.questions.length,
        answers,
        custom,
      )
      await replyQuestion(directory, request.id, ordered)
      removeRequest()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSending(false)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void reject()
      }}
      title={
        request.questions.length > 1
          ? `Question ${index + 1} of ${request.questions.length}`
          : question.header
      }
    >
      <div className={styles.content}>
        {request.questions.length > 1 && (
          <span className={styles.header}>{question.header}</span>
        )}
        <p className={styles.question}>{question.question}</p>
        <div
          className={styles.options}
          role={multiple ? 'group' : 'radiogroup'}
          aria-label={question.header}
        >
          {question.options.map((option) => {
            const picked = selected.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                className={styles.option}
                data-picked={picked}
                role={multiple ? 'checkbox' : 'radio'}
                aria-checked={picked}
                disabled={sending}
                onClick={() => selectOption(option.label)}
              >
                <span className={styles.mark} data-multiple={multiple}>
                  {picked && (multiple ? '✓' : '●')}
                </span>
                <span className={styles.optionText}>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </button>
            )
          })}
        </div>
        {question.custom !== false && (
          <label className={styles.custom}>
            <span>Type your own answer</span>
            <input
              value={custom[index] ?? ''}
              disabled={sending}
              placeholder="Your answer"
              onChange={(event) => updateCustom(event.target.value)}
            />
          </label>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.reject}
            disabled={sending}
            onClick={() => void reject()}
          >
            Dismiss
          </button>
          {index > 0 && (
            <button
              type="button"
              className={styles.secondary}
              disabled={sending}
              onClick={() => setIndex((current) => current - 1)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={sending}
            onClick={() => {
              if (last) void submit()
              else setIndex((current) => current + 1)
            }}
          >
            {sending ? 'Sending…' : last ? 'Submit' : 'Next'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

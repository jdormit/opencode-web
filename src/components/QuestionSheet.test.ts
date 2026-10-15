import { expect, test } from 'bun:test'
import { visibleFields, defaultAnswers } from './QuestionSheet'
import type { FormField } from '~/lib/oc'

test('generic forms retain typed defaults and conditional fields', () => {
  const fields: FormField[] = [
    { key: 'confirm', type: 'boolean', default: false },
    {
      key: 'reason',
      type: 'string',
      when: [{ key: 'confirm', op: 'eq', value: true }],
    },
    { key: 'count', type: 'integer', default: 3 },
  ]
  expect(defaultAnswers(fields)).toEqual({ confirm: false, count: 3 })
  expect(
    visibleFields(fields, defaultAnswers(fields)).map((f) => f.key),
  ).toEqual(['confirm', 'count'])
  expect(visibleFields(fields, { confirm: true }).map((f) => f.key)).toEqual([
    'confirm',
    'reason',
    'count',
  ])
})

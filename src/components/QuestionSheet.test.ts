import { describe, expect, test } from 'bun:test'
import { buildQuestionAnswers } from './QuestionSheet'

describe('question answers', () => {
  test('preserves question order and removes custom answer duplicates', () => {
    expect(
      buildQuestionAnswers(
        3,
        [['Staging'], ['Unit tests'], []],
        ['', 'Unit tests', 'A custom answer'],
      ),
    ).toEqual([['Staging'], ['Unit tests'], ['A custom answer']])
  })
})

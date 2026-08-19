import { describe, expect, test } from 'bun:test'
import { shouldKeepDiffGesture } from './session-diff-gesture'

const overflow = { scrollWidth: 800, clientWidth: 320 }

describe('session diff gesture arbitration', () => {
  test('keeps vertical gestures in the scrollable diff panel', () => {
    expect(
      shouldKeepDiffGesture({
        ...overflow,
        scrollLeft: 0,
        deltaX: 4,
        deltaY: 30,
      }),
    ).toBe(true)
  })

  test('keeps horizontal gestures when the diff can scroll that way', () => {
    expect(
      shouldKeepDiffGesture({
        ...overflow,
        scrollLeft: 0,
        deltaX: -30,
        deltaY: 2,
      }),
    ).toBe(true)
    expect(
      shouldKeepDiffGesture({
        ...overflow,
        scrollLeft: 200,
        deltaX: 30,
        deltaY: 2,
      }),
    ).toBe(true)
  })

  test('releases a right swipe at the left edge to close the drawer', () => {
    expect(
      shouldKeepDiffGesture({
        ...overflow,
        scrollLeft: 0,
        deltaX: 30,
        deltaY: 2,
      }),
    ).toBe(false)
  })

  test('releases horizontal gestures when the diff does not overflow', () => {
    expect(
      shouldKeepDiffGesture({
        scrollWidth: 320,
        clientWidth: 320,
        scrollLeft: 0,
        deltaX: -30,
        deltaY: 2,
      }),
    ).toBe(false)
  })
})

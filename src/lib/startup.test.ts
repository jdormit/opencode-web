import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getStartupPage,
  rememberSession,
  setStartupPage,
  startupSession,
} from './startup'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
let storage: Map<string, string>

beforeEach(() => {
  storage = new Map()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  })
})

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('startup preference', () => {
  test('defaults to the last visited session, with no redirect before a visit', () => {
    expect(getStartupPage()).toBe('last-session')
    expect(startupSession('/', '')).toBeNull()
    rememberSession('session-one')
    expect(startupSession('/', '')).toBe('session-one')
  })

  test('remembers the most recent visit even when opening new sessions is preferred', () => {
    rememberSession('session-one')
    setStartupPage('new-session')
    rememberSession('session-two')
    expect(getStartupPage()).toBe('new-session')
    expect(startupSession('/', '')).toBeNull()
    setStartupPage('last-session')
    expect(startupSession('/', '')).toBe('session-two')
  })

  test('preserves deep links and explicit new-session project selections', () => {
    rememberSession('session-one')
    expect(startupSession('/session/session-two', '')).toBeNull()
    expect(startupSession('/settings', '')).toBeNull()
    expect(startupSession('/', '?project=project-one')).toBeNull()
    expect(startupSession('/', '?directory=%2Fhome%2Fnova')).toBeNull()
  })

  test('uses the default for an invalid preference', () => {
    storage.set('oc-startup-page', 'invalid')
    expect(getStartupPage()).toBe('last-session')
  })

  test('works without browser storage, including during server rendering', () => {
    Reflect.deleteProperty(globalThis, 'window')
    expect(getStartupPage()).toBe('last-session')
    expect(startupSession('/', '')).toBeNull()
    expect(() => rememberSession('session-one')).not.toThrow()
    expect(() => setStartupPage('new-session')).not.toThrow()
  })

  test('handles blocked browser storage', () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage blocked')
      },
    })
    expect(getStartupPage()).toBe('last-session')
    expect(startupSession('/', '')).toBeNull()
    expect(() => rememberSession('session-one')).not.toThrow()
    expect(() => setStartupPage('new-session')).not.toThrow()
  })
})

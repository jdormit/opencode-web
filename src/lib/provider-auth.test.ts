import { expect, test } from 'bun:test'
import type { IntegrationInfo } from '@opencode/client'
import {
  authError,
  connectMethods,
  methodLabel,
  safeAuthUrl,
} from './provider-auth'

test('exposes API key, OAuth, and external methods without inventing API key fallback', () => {
  const provider: IntegrationInfo = {
    id: 'test',
    name: 'Test',
    connections: [],
    methods: [
      { type: 'env', names: ['TOKEN'] },
      { type: 'key' },
      { type: 'oauth', id: 'device', label: 'Sign in' },
      { type: 'external', id: 'profile', label: 'AWS profile' },
    ],
  }
  expect(connectMethods(provider).map(methodLabel)).toEqual([
    'API key',
    'Sign in',
    'AWS profile',
  ])
  expect(
    connectMethods({
      ...provider,
      methods: [{ type: 'env', names: ['TOKEN'] }],
    }),
  ).toEqual([])
})

test('authorization links only allow web URLs', () => {
  expect(safeAuthUrl('https://example.com/auth?code=abc')).toBe(
    'https://example.com/auth?code=abc',
  )
  expect(safeAuthUrl('http://localhost:1234/auth')).toBe(
    'http://localhost:1234/auth',
  )
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    '/relative',
    'not a url',
  ])
    expect(safeAuthUrl(url)).toBeUndefined()
})

test('extracts server errors and provides a useful fallback', () => {
  expect(authError({ data: { message: 'Invalid code' } })).toBe('Invalid code')
  expect(authError(new Error('Network unavailable'))).toBe(
    'Network unavailable',
  )
  expect(authError(null)).toContain('Please try again')
})

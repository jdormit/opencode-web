import { describe, expect, test } from 'bun:test'
import { normalizeDirectory, parentDirectory } from './directory'

describe('normalizeDirectory', () => {
  test('normalizes absolute and home-relative paths', () => {
    expect(normalizeDirectory('/home/nova/project/', '/home/nova')).toBe(
      '/home/nova/project',
    )
    expect(normalizeDirectory('~/project', '/home/nova')).toBe(
      '/home/nova/project',
    )
    expect(normalizeDirectory('~', '/home/nova')).toBe('/home/nova')
  })

  test('rejects relative and empty paths', () => {
    expect(normalizeDirectory('project', '/home/nova')).toBeUndefined()
    expect(normalizeDirectory(' ', '/home/nova')).toBeUndefined()
  })
})

describe('parentDirectory', () => {
  test('moves toward the filesystem root', () => {
    expect(parentDirectory('/home/nova/project')).toBe('/home/nova')
    expect(parentDirectory('/home')).toBe('/')
    expect(parentDirectory('/')).toBe('/')
  })
})

import { describe, expect, test } from 'bun:test'
import { resolveDefaultServerUrl } from './settings'

describe('resolveDefaultServerUrl', () => {
  test('defaults to the standard OpenCode server URL', () => {
    expect(resolveDefaultServerUrl(undefined)).toBe('http://localhost:4096')
  })

  test('uses the configured server URL', () => {
    expect(resolveDefaultServerUrl('http://localhost:5555')).toBe(
      'http://localhost:5555',
    )
  })

  test('reads the configured server URL from the environment', () => {
    const settingsUrl = new URL('./settings.ts', import.meta.url).href
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        '-e',
        `import { DEFAULT_SERVER_URL } from ${JSON.stringify(settingsUrl)}; console.log(DEFAULT_SERVER_URL)`,
      ],
      env: {
        ...process.env,
        VITE_OPENCODE_SERVER_URL: 'http://localhost:5555',
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe('http://localhost:5555')
  })
})

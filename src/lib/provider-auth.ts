import type { IntegrationInfo, IntegrationMethod } from '@opencode/client'

export type ConnectMethod = Extract<
  IntegrationMethod,
  { type: 'key' | 'oauth' | 'external' }
>
export const popularProviders = [
  'opencode',
  'opencode-go',
  'anthropic',
  'openai',
  'github-copilot',
  'google',
  'openrouter',
  'vercel',
]
export function connectMethods(provider: IntegrationInfo): ConnectMethod[] {
  return provider.methods.filter(
    (m): m is ConnectMethod =>
      m.type === 'key' || m.type === 'oauth' || m.type === 'external',
  )
}
export function methodLabel(method: ConnectMethod) {
  return method.label ?? 'API key'
}
export function authError(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('data' in error) return authError(error.data)
    if ('message' in error && typeof error.message === 'string')
      return error.message
  }
  return error instanceof Error
    ? error.message
    : 'Could not connect. Please try again.'
}
export function safeAuthUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : undefined
  } catch {
    return undefined
  }
}

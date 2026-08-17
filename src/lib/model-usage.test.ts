import { describe, expect, test } from 'bun:test'
import { configuredModel } from './model-usage'
import type { ConfigProvidersResponse } from './oc'

const providers = {
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      env: [],
      models: {
        'gpt-5.6-sol': { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
        'gateway/model': { id: 'gateway/model', name: 'Gateway model' },
      },
    },
  ],
  default: { openai: 'gpt-5.6-sol' },
} as unknown as ConfigProvidersResponse

describe('configuredModel', () => {
  test('converts a configured model to a model reference', () => {
    expect(configuredModel('openai/gpt-5.6-sol', providers)).toEqual({
      providerID: 'openai',
      modelID: 'gpt-5.6-sol',
    })
  })

  test('preserves slashes in the model ID', () => {
    expect(configuredModel('openai/gateway/model', providers)).toEqual({
      providerID: 'openai',
      modelID: 'gateway/model',
    })
  })

  test('ignores missing and unavailable configured models', () => {
    expect(configuredModel(undefined, providers)).toBeUndefined()
    expect(configuredModel('openai/missing', providers)).toBeUndefined()
    expect(configuredModel('missing/model', providers)).toBeUndefined()
  })
})

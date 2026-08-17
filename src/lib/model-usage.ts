import type { ConfigProvidersResponse, Model, Provider } from './oc'

const STORAGE_KEY = 'oc-model-usage'

export interface ModelRef {
  providerID: string
  modelID: string
}

interface UsageEntry {
  count: number
  last: number
}

type UsageMap = Record<string, UsageEntry>

export function modelKey(ref: ModelRef): string {
  return `${ref.providerID}/${ref.modelID}`
}

function readUsage(): UsageMap {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function recordModelUse(ref: ModelRef) {
  if (typeof window === 'undefined') return
  const usage = readUsage()
  const key = modelKey(ref)
  const entry = usage[key] ?? { count: 0, last: 0 }
  usage[key] = { count: entry.count + 1, last: Date.now() }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(usage))
}

export interface RankedModel {
  ref: ModelRef
  model: Model
  provider: Provider
}

/**
 * All available models ranked by local usage (count desc, recency as the
 * tie-break), then provider defaults, then the rest.
 */
export function rankModels(
  providers: ConfigProvidersResponse,
): Array<RankedModel> {
  const usage = readUsage()
  const all: Array<RankedModel> = []
  for (const provider of providers.providers) {
    for (const model of Object.values(provider.models)) {
      all.push({
        ref: { providerID: provider.id, modelID: model.id },
        model,
        provider,
      })
    }
  }
  const score = (m: RankedModel) => {
    const entry = usage[modelKey(m.ref)]
    if (entry) return entry.count * 1e13 + entry.last
    if (providers.default[m.ref.providerID] === m.ref.modelID) return 1
    return 0
  }
  return all.sort((a, b) => {
    const diff = score(b) - score(a)
    if (diff !== 0) return diff
    return a.model.name.localeCompare(b.model.name)
  })
}

export function defaultModel(
  providers: ConfigProvidersResponse,
): ModelRef | undefined {
  const ranked = rankModels(providers)
  return ranked[0]?.ref
}

export function findModel(
  providers: ConfigProvidersResponse | undefined,
  ref: ModelRef | undefined,
): { model: Model; provider: Provider } | undefined {
  if (!providers || !ref) return undefined
  const provider = providers.providers.find((p) => p.id === ref.providerID)
  const model = provider?.models[ref.modelID]
  if (!provider || !model) return undefined
  return { model, provider }
}

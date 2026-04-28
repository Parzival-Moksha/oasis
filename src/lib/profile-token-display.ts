export interface ProfileTokenBurnData {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
  displayInputTokens?: number
  costUsd?: number
}

export interface ProfileTokenBurnProviderData extends ProfileTokenBurnData {
  provider?: string
}

export interface ProfileTokenBurnSummaryData {
  grand: ProfileTokenBurnData
  providers: ProfileTokenBurnProviderData[]
}

interface ProviderCostRate {
  inputUsdPerMTok: number
  cachedInputUsdPerMTok: number
  outputUsdPerMTok: number
}

const PROVIDER_COST_RATES: Record<string, ProviderCostRate> = {
  anthropic: {
    inputUsdPerMTok: 3,
    cachedInputUsdPerMTok: 0.3,
    outputUsdPerMTok: 15,
  },
  openai: {
    inputUsdPerMTok: 2.5,
    cachedInputUsdPerMTok: 0.25,
    outputUsdPerMTok: 10,
  },
  unknown: {
    inputUsdPerMTok: 3,
    cachedInputUsdPerMTok: 0.3,
    outputUsdPerMTok: 15,
  },
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function normalizeCost(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value)
  return parsed > 0 ? parsed : undefined
}

export function emptyProfileTokenBurnData(): ProfileTokenBurnData {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    displayInputTokens: 0,
    costUsd: 0,
  }
}

export function emptyProfileTokenBurnSummary(): ProfileTokenBurnSummaryData {
  return {
    grand: emptyProfileTokenBurnData(),
    providers: [],
  }
}

export function normalizeProfileTokenBurnData(value: unknown): ProfileTokenBurnData {
  if (!value || typeof value !== 'object') return emptyProfileTokenBurnData()

  const record = value as Record<string, unknown>
  const inputTokens = Math.max(0, Math.round(toFiniteNumber(record.inputTokens)))
  const cachedInputTokens = Math.max(0, Math.round(toFiniteNumber(record.cachedInputTokens)))
  const outputTokens = Math.max(0, Math.round(toFiniteNumber(record.outputTokens)))
  const explicitDisplayInputTokens = record.displayInputTokens === undefined
    ? undefined
    : Math.max(0, Math.round(toFiniteNumber(record.displayInputTokens)))
  const costUsd = normalizeCost(record.costUsd)

  return {
    inputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    outputTokens,
    ...(explicitDisplayInputTokens !== undefined
      ? { displayInputTokens: explicitDisplayInputTokens }
      : { displayInputTokens: inputTokens + cachedInputTokens }),
    ...(typeof costUsd === 'number' ? { costUsd } : {}),
  }
}

export function normalizeProfileTokenBurnSummary(value: unknown): ProfileTokenBurnSummaryData {
  if (!value || typeof value !== 'object') return emptyProfileTokenBurnSummary()

  const record = value as Record<string, unknown>
  const grand = normalizeProfileTokenBurnData(record.grand ?? value)
  const providers = Array.isArray(record.providers)
    ? record.providers
      .filter((provider): provider is Record<string, unknown> => !!provider && typeof provider === 'object')
      .map(provider => ({
        ...normalizeProfileTokenBurnData(provider),
        ...(typeof provider.provider === 'string' && provider.provider.trim()
          ? { provider: provider.provider.trim() }
          : {}),
      }))
    : []

  return { grand, providers }
}

export function getProfileDisplayInputTokens(data: ProfileTokenBurnData): number {
  if (typeof data.displayInputTokens === 'number' && Number.isFinite(data.displayInputTokens)) {
    return Math.max(0, Math.round(data.displayInputTokens))
  }
  return Math.max(0, data.inputTokens + (data.cachedInputTokens || 0))
}

export function hasProfileTokenUsage(data: ProfileTokenBurnData): boolean {
  return getProfileDisplayInputTokens(data) > 0
    || data.outputTokens > 0
    || (typeof data.costUsd === 'number' && data.costUsd > 0)
}

function estimateProviderCostUsd(
  data: ProfileTokenBurnData,
  provider?: string,
): number {
  const rate = PROVIDER_COST_RATES[(provider || 'unknown').toLowerCase()] || PROVIDER_COST_RATES.unknown
  return (
    data.inputTokens * rate.inputUsdPerMTok
    + (data.cachedInputTokens || 0) * rate.cachedInputUsdPerMTok
    + data.outputTokens * rate.outputUsdPerMTok
  ) / 1_000_000
}

export function estimateProfileTokenCostUsd(summary: ProfileTokenBurnSummaryData): number {
  const providers = summary.providers || []

  if (providers.length === 0) {
    if (typeof summary.grand.costUsd === 'number' && summary.grand.costUsd > 0) {
      return summary.grand.costUsd
    }
    return hasProfileTokenUsage(summary.grand)
      ? estimateProviderCostUsd(summary.grand)
      : 0
  }

  let totalCostUsd = 0
  for (const provider of providers) {
    if (!hasProfileTokenUsage(provider)) continue
    if (typeof provider.costUsd === 'number' && provider.costUsd > 0) {
      totalCostUsd += provider.costUsd
      continue
    }
    totalCostUsd += estimateProviderCostUsd(provider, provider.provider)
  }

  if (totalCostUsd > 0) return totalCostUsd
  return typeof summary.grand.costUsd === 'number' ? summary.grand.costUsd : 0
}

export function formatProfileTokenCost(summary: ProfileTokenBurnSummaryData): string {
  const costUsd = estimateProfileTokenCostUsd(summary)
  if (costUsd <= 0) return '$0.00'
  return costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
}

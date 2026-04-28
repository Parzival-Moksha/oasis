export interface TokenUsagePayload {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
  costUsd?: number
  sessionId: string
  provider: string
  model: string
}

type TokenUsageDefaults = Partial<Pick<TokenUsagePayload, 'sessionId' | 'provider' | 'model'>>

const TOKEN_USAGE_KEYS = new Set([
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'costUsd',
  'sessionId',
  'provider',
  'model',
  'total_input_tokens',
  'cached_input_tokens',
  'total_output_tokens',
  'cost_usd',
  'total_cost_usd',
  'session_id',
])

export function toTokenCount(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.max(0, Math.round(parsed))
}

export function toOptionalCostUsd(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : NaN
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

export function normalizeTokenUsagePayload(value: {
  inputTokens?: unknown
  cachedInputTokens?: unknown
  outputTokens?: unknown
  costUsd?: unknown
  sessionId?: unknown
  provider?: unknown
  model?: unknown
}): TokenUsagePayload {
  const inputTokens = toTokenCount(value.inputTokens)
  const cachedInputTokens = toTokenCount(value.cachedInputTokens)
  const outputTokens = toTokenCount(value.outputTokens)
  const costUsd = toOptionalCostUsd(value.costUsd)
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : ''
  const provider = typeof value.provider === 'string' && value.provider.trim()
    ? value.provider.trim()
    : 'unknown'
  const model = typeof value.model === 'string' && value.model.trim()
    ? value.model.trim()
    : 'unknown'

  return {
    inputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    outputTokens,
    ...(typeof costUsd === 'number' ? { costUsd } : {}),
    sessionId,
    provider,
    model,
  }
}

export function hasTokenUsage(payload: Pick<TokenUsagePayload, 'inputTokens' | 'outputTokens'> & {
  cachedInputTokens?: number
  costUsd?: number
}): boolean {
  return payload.inputTokens > 0
    || (payload.cachedInputTokens || 0) > 0
    || payload.outputTokens > 0
    || typeof payload.costUsd === 'number'
}

export function getDisplayInputTokens(payload: Pick<TokenUsagePayload, 'inputTokens'> & {
  cachedInputTokens?: number
}): number {
  return payload.inputTokens + (payload.cachedInputTokens || 0)
}

export function inferProviderFromSource(source: string): string {
  const normalized = source.trim().toLowerCase()
  if (normalized.startsWith('codex')) return 'openai'
  return 'anthropic'
}

export function readTokenUsagePayload(value: unknown, defaults: TokenUsageDefaults = {}): TokenUsagePayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const hasUsageField = Object.keys(record).some(key => TOKEN_USAGE_KEYS.has(key))
  if (!hasUsageField) return null

  return normalizeTokenUsagePayload({
    inputTokens: record.inputTokens ?? record.total_input_tokens,
    cachedInputTokens: record.cachedInputTokens ?? record.cached_input_tokens,
    outputTokens: record.outputTokens ?? record.total_output_tokens,
    costUsd: record.costUsd ?? record.cost_usd ?? record.total_cost_usd,
    sessionId: record.sessionId ?? record.session_id ?? defaults.sessionId,
    provider: record.provider ?? defaults.provider,
    model: record.model ?? defaults.model,
  })
}

export function extractClaudeTokenUsage(
  raw: Record<string, unknown>,
  defaults: TokenUsageDefaults & { model: string; provider?: string },
): TokenUsagePayload {
  const usage = raw.usage && typeof raw.usage === 'object'
    ? raw.usage as Record<string, unknown>
    : {}

  return normalizeTokenUsagePayload({
    inputTokens: raw.total_input_tokens ?? usage.input_tokens,
    outputTokens: raw.total_output_tokens ?? usage.output_tokens,
    costUsd: raw.cost_usd ?? raw.total_cost_usd,
    sessionId: raw.session_id ?? defaults.sessionId,
    provider: raw.provider ?? defaults.provider ?? 'anthropic',
    model: raw.model ?? defaults.model,
  })
}

export function extractCodexTokenUsage(
  usage: Record<string, unknown>,
  defaults: TokenUsageDefaults & { model: string; provider?: string },
): TokenUsagePayload {
  return normalizeTokenUsagePayload({
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: usage.cost_usd,
    sessionId: defaults.sessionId,
    provider: defaults.provider ?? 'openai',
    model: defaults.model,
  })
}

import 'server-only'

import { prisma } from '@/lib/db'
import { getLocalUserId } from '@/lib/local-auth'

import {
  type TokenUsagePayload,
  getDisplayInputTokens,
  hasTokenUsage,
  normalizeTokenUsagePayload,
} from '@/lib/token-usage'

export interface TokenBurnAggregate {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  displayInputTokens: number
  costUsd: number
}

export interface TokenBurnSummaryRow extends TokenBurnAggregate {
  source?: string
  provider?: string
}

export interface TokenBurnSummary {
  range: string
  totals: TokenBurnSummaryRow[]
  providers: TokenBurnSummaryRow[]
  grand: TokenBurnAggregate
}

export interface RecordTokenBurnInput extends TokenUsagePayload {
  source: string
  occurredAt?: Date
  userId?: string
}

interface TokenBurnRowLike {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number | null
}

export function hourBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13)
}

function emptyAggregate(): TokenBurnAggregate {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    displayInputTokens: 0,
    costUsd: 0,
  }
}

function accumulateTokenBurn(target: TokenBurnAggregate, row: TokenBurnRowLike): TokenBurnAggregate {
  target.inputTokens += Math.max(0, row.inputTokens || 0)
  target.cachedInputTokens += Math.max(0, row.cachedInputTokens || 0)
  target.outputTokens += Math.max(0, row.outputTokens || 0)
  target.costUsd += Math.max(0, row.costUsd || 0)
  target.displayInputTokens = getDisplayInputTokens(target)
  return target
}

export async function recordTokenBurn(input: RecordTokenBurnInput): Promise<void> {
  const source = input.source.trim()
  if (!source) return

  const usage = normalizeTokenUsagePayload(input)
  if (!hasTokenUsage(usage)) return

  const createdAt = input.occurredAt ?? new Date()
  const userId = input.userId || await getLocalUserId()

  await prisma.tokenBurn.create({
    data: {
      userId,
      source,
      provider: usage.provider,
      model: usage.model,
      sessionId: usage.sessionId,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens || 0,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      window: hourBucket(createdAt),
      createdAt,
    },
  })
}

export async function readTokenBurnSummary(params?: {
  source?: string
  range?: string
  userId?: string
}): Promise<TokenBurnSummary> {
  const range = params?.range || 'alltime'
  const userId = params?.userId || await getLocalUserId()
  const source = params?.source?.trim()

  let since: Date | undefined
  const now = new Date()
  if (range === 'hourly') {
    since = new Date(now.getTime() - 60 * 60 * 1000)
  } else if (range === 'daily') {
    since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  } else if (range === 'weekly') {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  }

  const rows = await prisma.tokenBurn.findMany({
    where: {
      userId,
      ...(source ? { source } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: {
      source: true,
      provider: true,
      inputTokens: true,
      cachedInputTokens: true,
      outputTokens: true,
      costUsd: true,
    },
  })

  const bySource = new Map<string, TokenBurnSummaryRow>()
  const byProvider = new Map<string, TokenBurnSummaryRow>()
  const grand = emptyAggregate()

  for (const row of rows) {
    accumulateTokenBurn(grand, row)

    const sourceAggregate = bySource.get(row.source) || {
      source: row.source,
      ...emptyAggregate(),
    }
    accumulateTokenBurn(sourceAggregate, row)
    bySource.set(row.source, sourceAggregate)

    const providerAggregate = byProvider.get(row.provider) || {
      provider: row.provider,
      ...emptyAggregate(),
    }
    accumulateTokenBurn(providerAggregate, row)
    byProvider.set(row.provider, providerAggregate)
  }

  return {
    range,
    totals: [...bySource.values()].sort((a, b) => b.displayInputTokens + b.outputTokens - (a.displayInputTokens + a.outputTokens)),
    providers: [...byProvider.values()].sort((a, b) => b.displayInputTokens + b.outputTokens - (a.displayInputTokens + a.outputTokens)),
    grand,
  }
}

import 'server-only'

import { prisma } from '@/lib/db'
import { getLocalUserId } from '@/lib/local-auth'

export interface AgentSessionCacheRecord<TPayload = unknown> {
  sessionId: string
  agentType: string
  title?: string
  model?: string
  payload: TPayload
  messageCount: number
  source: string
  createdAt: string
  updatedAt: string
  lastActiveAt: string
}

export interface UpsertAgentSessionCacheInput<TPayload = unknown> {
  sessionId: string
  agentType: string
  title?: string
  model?: string
  payload: TPayload
  messageCount?: number
  source?: string
  lastActiveAt?: Date | string | number
  createdAt?: Date | string | number
  userId?: string
}

function cleanText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function makeCacheKey(userId: string, agentType: string, sessionId: string): string {
  return [userId, agentType, sessionId].map(encodeURIComponent).join(':')
}

function coerceDate(value: Date | string | number | undefined, fallback = new Date()): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed
  }
  return fallback
}

function parsePayload<TPayload>(raw: string): TPayload {
  try {
    return JSON.parse(raw) as TPayload
  } catch {
    return null as TPayload
  }
}

function toRecord<TPayload>(row: {
  sessionId: string
  agentType: string
  title: string | null
  model: string | null
  payload: string
  messageCount: number
  source: string
  createdAt: Date
  updatedAt: Date
  lastActiveAt: Date
}): AgentSessionCacheRecord<TPayload> {
  return {
    sessionId: row.sessionId,
    agentType: row.agentType,
    title: row.title || undefined,
    model: row.model || undefined,
    payload: parsePayload<TPayload>(row.payload),
    messageCount: row.messageCount,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
  }
}

export async function upsertAgentSessionCache<TPayload>(
  input: UpsertAgentSessionCacheInput<TPayload>,
): Promise<AgentSessionCacheRecord<TPayload>> {
  const userId = input.userId || await getLocalUserId()
  const agentType = cleanText(input.agentType).toLowerCase()
  const sessionId = cleanText(input.sessionId)
  if (!agentType) throw new Error('agentType is required')
  if (!sessionId) throw new Error('sessionId is required')

  const now = new Date()
  const createdAt = coerceDate(input.createdAt, now)
  const lastActiveAt = coerceDate(input.lastActiveAt, now)
  const payload = JSON.stringify(input.payload ?? null)
  const messageCount = Math.max(0, Math.floor(input.messageCount || 0))

  const row = await prisma.agentSessionCache.upsert({
    where: { id: makeCacheKey(userId, agentType, sessionId) },
    create: {
      id: makeCacheKey(userId, agentType, sessionId),
      userId,
      agentType,
      sessionId,
      title: cleanText(input.title) || null,
      model: cleanText(input.model) || null,
      payload,
      messageCount,
      source: cleanText(input.source, 'oasis') || 'oasis',
      createdAt,
      lastActiveAt,
    },
    update: {
      title: cleanText(input.title) || null,
      model: cleanText(input.model) || null,
      payload,
      messageCount,
      source: cleanText(input.source, 'oasis') || 'oasis',
      lastActiveAt,
    },
  })

  return toRecord<TPayload>(row)
}

export async function upsertAgentSessionCaches<TPayload>(
  inputs: UpsertAgentSessionCacheInput<TPayload>[],
): Promise<AgentSessionCacheRecord<TPayload>[]> {
  const records: AgentSessionCacheRecord<TPayload>[] = []
  for (const input of inputs) {
    records.push(await upsertAgentSessionCache(input))
  }
  return records
}

export async function getAgentSessionCache<TPayload>(params: {
  agentType: string
  sessionId: string
  userId?: string
}): Promise<AgentSessionCacheRecord<TPayload> | null> {
  const userId = params.userId || await getLocalUserId()
  const agentType = cleanText(params.agentType).toLowerCase()
  const sessionId = cleanText(params.sessionId)
  if (!agentType || !sessionId) return null

  const row = await prisma.agentSessionCache.findUnique({
    where: { id: makeCacheKey(userId, agentType, sessionId) },
  })
  return row ? toRecord<TPayload>(row) : null
}

export async function listAgentSessionCaches<TPayload>(params: {
  agentType: string
  limit?: number
  userId?: string
}): Promise<AgentSessionCacheRecord<TPayload>[]> {
  const userId = params.userId || await getLocalUserId()
  const agentType = cleanText(params.agentType).toLowerCase()
  if (!agentType) return []

  const rows = await prisma.agentSessionCache.findMany({
    where: { userId, agentType },
    orderBy: [{ lastActiveAt: 'desc' }, { updatedAt: 'desc' }],
    take: Math.max(1, Math.min(200, params.limit || 100)),
  })

  return rows.map(row => toRecord<TPayload>(row))
}

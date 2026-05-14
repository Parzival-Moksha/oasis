import 'server-only'

import { prisma } from '@/lib/db'
import {
  HOSTED_ANONYMOUS_USER_ID,
  getOasisUserId,
  readBrowserSession,
} from '@/lib/session'
import { readTokenBurnSummary } from '@/lib/token-burn'

export const OASIS_ACTIVATION_EVENTS = new Set([
  'object_placed',
  'world_created',
  'world_imported',
  'agent_connected',
  'agent_pairing_created',
  'realtime_voice_started',
  'share_created',
  'world_published',
])

const FLOW_BREAK_EVENTS = new Set([
  'flow_break',
  'error',
  'dead_end',
  'rage_click',
])

const CONNECTION_EVENTS = new Set([
  'agent_connected',
  'agent_pairing_created',
  'agent_pairing_reused',
])

const SHARE_EVENTS = new Set([
  'share_created',
  'invite_link_created',
  'invite_entered',
  'world_published',
])

export interface RecordOasisAnalyticsEventInput {
  request?: Request
  sessionId?: string
  userId?: string
  eventType: string
  worldId?: string | null
  agentType?: string | null
  source?: string | null
  durationMs?: number | null
  costUsd?: number | null
  metadata?: unknown
  occurredAt?: Date
}

export interface AdminKpiDashboard {
  generatedAt: string
  range: string
  since: string | null
  northStar: {
    seen: number
    entered: number
    activated: number
    returned: number
    asked: number
  }
  totals: {
    sessions: number
    events: number
    activatedSessions: number
    activationRate: number
    avgSessionLengthMs: number
    dailyConnections: number
    worldsVisited: number
    flowBreaks: number
    shareEvents: number
    estimatedCostUsd: number
    costPerActivatedUserUsd: number
  }
  funnel: Array<{
    label: string
    value: number
    target: number
    rate?: number
  }>
  worlds: Array<{
    id: string
    name: string
    visibility: string
    visitCount: number
    objectCount: number
    updatedAt: string
    eventVisits: number
  }>
  connections: Array<{
    agentType: string
    count: number
  }>
  costSources: Array<{
    source: string
    costUsd: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
  }>
  recentEvents: Array<{
    id: number
    eventType: string
    sessionId: string
    userId: string
    worldId: string | null
    agentType: string | null
    durationMs: number | null
    costUsd: number | null
    metadata: unknown
    createdAt: string
  }>
  instrumentation: {
    tracked: string[]
    next: string[]
  }
}

function cleanString(value: string | null | undefined, max = 120): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function cleanNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function safeJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 8000 ? serialized.slice(0, 8000) : serialized
  } catch {
    return JSON.stringify({ unserializable: true })
  }
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function rangeToSince(range: string): Date | undefined {
  const now = Date.now()
  if (range === 'hourly') return new Date(now - 60 * 60 * 1000)
  if (range === 'daily') return new Date(now - 24 * 60 * 60 * 1000)
  if (range === 'weekly') return new Date(now - 7 * 24 * 60 * 60 * 1000)
  return undefined
}

export async function recordOasisAnalyticsEvent(input: RecordOasisAnalyticsEventInput): Promise<void> {
  const eventType = cleanString(input.eventType, 80)
  if (!eventType) return

  try {
    const browserSession = input.request ? readBrowserSession(input.request) : null
    const userId = cleanString(input.userId, 160)
      || (input.request ? await getOasisUserId(input.request) : null)
      || HOSTED_ANONYMOUS_USER_ID
    const sessionId = cleanString(input.sessionId, 160)
      || browserSession?.browserSessionId
      || userId

    await prisma.oasisAnalyticsEvent.create({
      data: {
        sessionId,
        userId,
        eventType,
        worldId: cleanString(input.worldId ?? null, 160),
        agentType: cleanString(input.agentType ?? null, 80),
        source: cleanString(input.source ?? null, 80),
        durationMs: cleanNumber(input.durationMs),
        costUsd: cleanNumber(input.costUsd),
        metadata: safeJson(input.metadata),
        createdAt: input.occurredAt ?? new Date(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[oasis-analytics] record failed:', message.slice(0, 180))
  }
}

export async function readAdminKpiDashboard(params?: {
  range?: string
}): Promise<AdminKpiDashboard> {
  const range = params?.range || 'daily'
  const since = rangeToSince(range)
  const where = since ? { createdAt: { gte: since } } : {}

  const [events, worlds, tokenBurn] = await Promise.all([
    prisma.oasisAnalyticsEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.world.findMany({
      orderBy: [
        { visitCount: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: 12,
      select: {
        id: true,
        name: true,
        visibility: true,
        visitCount: true,
        objectCount: true,
        updatedAt: true,
      },
    }),
    readTokenBurnSummary({ range }),
  ])

  const sessions = new Map<string, {
    firstAt: number
    lastAt: number
    durationMs: number
    activated: boolean
    connected: boolean
    returned: boolean
    asked: boolean
    worlds: Set<string>
    costUsd: number
  }>()
  const worldEventVisits = new Map<string, number>()
  const connections = new Map<string, number>()
  let flowBreaks = 0
  let shareEvents = 0
  let analyticsCostUsd = 0

  for (const event of events) {
    const key = event.sessionId || event.userId || 'unknown'
    const createdAt = event.createdAt.getTime()
    const session = sessions.get(key) || {
      firstAt: createdAt,
      lastAt: createdAt,
      durationMs: 0,
      activated: false,
      connected: false,
      returned: false,
      asked: false,
      worlds: new Set<string>(),
      costUsd: 0,
    }

    session.firstAt = Math.min(session.firstAt, createdAt)
    session.lastAt = Math.max(session.lastAt, createdAt)
    session.durationMs = Math.max(session.durationMs, event.durationMs || 0)
    session.activated ||= OASIS_ACTIVATION_EVENTS.has(event.eventType)
    session.connected ||= CONNECTION_EVENTS.has(event.eventType)
    session.returned ||= event.eventType === 'return_visit'
    session.asked ||= event.eventType === 'conversion_ask' || event.eventType === 'paid_interest'
    session.costUsd += Math.max(0, event.costUsd || 0)
    if (event.worldId) session.worlds.add(event.worldId)
    sessions.set(key, session)

    if (event.worldId && event.eventType === 'world_visit') {
      worldEventVisits.set(event.worldId, (worldEventVisits.get(event.worldId) || 0) + 1)
    }
    if (CONNECTION_EVENTS.has(event.eventType)) {
      const agentType = event.agentType || 'unknown'
      connections.set(agentType, (connections.get(agentType) || 0) + 1)
    }
    if (FLOW_BREAK_EVENTS.has(event.eventType)) flowBreaks += 1
    if (SHARE_EVENTS.has(event.eventType)) shareEvents += 1
    analyticsCostUsd += Math.max(0, event.costUsd || 0)
  }

  const sessionRows = [...sessions.values()]
  const activatedSessions = sessionRows.filter(session => session.activated).length
  const avgSessionLengthMs = sessionRows.length === 0
    ? 0
    : Math.round(sessionRows.reduce((sum, session) => {
      const span = Math.max(session.durationMs, session.lastAt - session.firstAt)
      return sum + span
    }, 0) / sessionRows.length)
  const tokenCostUsd = tokenBurn.grand.costUsd
  const estimatedCostUsd = tokenCostUsd + analyticsCostUsd

  return {
    generatedAt: new Date().toISOString(),
    range,
    since: since?.toISOString() ?? null,
    northStar: {
      seen: 100,
      entered: 20,
      activated: 10,
      returned: 3,
      asked: 1,
    },
    totals: {
      sessions: sessionRows.length,
      events: events.length,
      activatedSessions,
      activationRate: sessionRows.length ? activatedSessions / sessionRows.length : 0,
      avgSessionLengthMs,
      dailyConnections: [...connections.values()].reduce((sum, count) => sum + count, 0),
      worldsVisited: new Set(events.map(event => event.worldId).filter(Boolean)).size,
      flowBreaks,
      shareEvents,
      estimatedCostUsd,
      costPerActivatedUserUsd: activatedSessions ? estimatedCostUsd / activatedSessions : 0,
    },
    funnel: [
      { label: 'Entered', value: sessionRows.length, target: 20 },
      { label: 'Activated', value: activatedSessions, target: 10, rate: sessionRows.length ? activatedSessions / sessionRows.length : 0 },
      { label: 'Agent Connected', value: sessionRows.filter(session => session.connected).length, target: 5 },
      { label: 'Returned', value: sessionRows.filter(session => session.returned).length, target: 3 },
      { label: 'Asked / Paid Signal', value: sessionRows.filter(session => session.asked).length, target: 1 },
    ],
    worlds: worlds.map(world => ({
      id: world.id,
      name: world.name,
      visibility: world.visibility,
      visitCount: world.visitCount,
      objectCount: world.objectCount,
      updatedAt: world.updatedAt.toISOString(),
      eventVisits: worldEventVisits.get(world.id) || 0,
    })),
    connections: [...connections.entries()]
      .map(([agentType, count]) => ({ agentType, count }))
      .sort((a, b) => b.count - a.count),
    costSources: tokenBurn.totals.map(row => ({
      source: row.source || 'unknown',
      costUsd: row.costUsd,
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
    })),
    recentEvents: events.slice(0, 80).map(event => ({
      id: event.id,
      eventType: event.eventType,
      sessionId: event.sessionId,
      userId: event.userId,
      worldId: event.worldId,
      agentType: event.agentType,
      durationMs: event.durationMs,
      costUsd: event.costUsd,
      metadata: safeParseJson(event.metadata),
      createdAt: event.createdAt.toISOString(),
    })),
    instrumentation: {
      tracked: [
        'session_start',
        'session_end',
        'world_visit',
        'world_created',
        'world_imported',
        'agent_pairing_created',
        'agent_pairing_reused',
        'token_burn',
      ],
      next: [
        'object_placed',
        'realtime_voice_started',
        'realtime_voice_ended',
        'share_created',
        'invite_entered',
        'flow_break',
      ],
    },
  }
}

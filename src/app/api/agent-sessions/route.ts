import { NextRequest, NextResponse } from 'next/server'

import {
  getAgentSessionCache,
  listAgentSessionCaches,
  upsertAgentSessionCache,
  upsertAgentSessionCaches,
  type UpsertAgentSessionCacheInput,
} from '@/lib/agent-session-cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readSessionInput(agentType: string, value: unknown): UpsertAgentSessionCacheInput | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const sessionId = clean(record.sessionId) || clean(record.id)
  if (!sessionId) return null

  return {
    sessionId,
    agentType,
    title: clean(record.title) || clean(record.name) || undefined,
    model: clean(record.model) || undefined,
    payload: 'payload' in record ? record.payload : record,
    messageCount: typeof record.messageCount === 'number' ? record.messageCount : undefined,
    source: clean(record.source) || 'oasis',
    createdAt: typeof record.createdAt === 'string' || typeof record.createdAt === 'number' ? record.createdAt : undefined,
    lastActiveAt: typeof record.lastActiveAt === 'string' || typeof record.lastActiveAt === 'number' ? record.lastActiveAt : undefined,
  }
}

export async function GET(request: NextRequest) {
  try {
    const agentType = clean(request.nextUrl.searchParams.get('agentType')).toLowerCase()
    const sessionId = clean(request.nextUrl.searchParams.get('sessionId') || request.nextUrl.searchParams.get('id'))
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || 100)
    const limit = Number.isFinite(limitParam) ? limitParam : 100

    if (!agentType) {
      return NextResponse.json({ error: 'agentType required' }, { status: 400 })
    }

    if (sessionId) {
      const record = await getAgentSessionCache({ agentType, sessionId })
      return NextResponse.json({ record })
    }

    const records = await listAgentSessionCaches({ agentType, limit })
    return NextResponse.json({ records })
  } catch (error) {
    console.error('[agent-sessions] GET error:', error)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const agentType = clean(body.agentType).toLowerCase()
    if (!agentType) {
      return NextResponse.json({ error: 'agentType required' }, { status: 400 })
    }

    if (Array.isArray(body.sessions)) {
      const sessions = body.sessions
        .map(value => readSessionInput(agentType, value))
        .filter((value): value is UpsertAgentSessionCacheInput => Boolean(value))
      const records = await upsertAgentSessionCaches(sessions)
      return NextResponse.json({ ok: true, records })
    }

    const session = readSessionInput(agentType, body.session)
    if (!session) {
      return NextResponse.json({ error: 'session required' }, { status: 400 })
    }

    const record = await upsertAgentSessionCache(session)
    return NextResponse.json({ ok: true, record })
  } catch (error) {
    console.error('[agent-sessions] POST error:', error)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}

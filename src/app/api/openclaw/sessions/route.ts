import { NextRequest, NextResponse } from 'next/server'

import {
  createOpenclawDraftSession,
  getOpenclawCachedSession,
  listOpenclawCachedSessions,
} from '@/lib/openclaw-session-cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  const sessionId = sanitizeString(request.nextUrl.searchParams.get('sessionId'))
  if (sessionId) {
    const session = await getOpenclawCachedSession(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    }
    // Phase 1: messages always empty here. Phase 2 will fetch transcripts via
    // Gateway sessions.get WebSocket RPC instead of the local pointer store.
    return NextResponse.json({
      session,
      messages: [],
    })
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'))
  const offsetParam = Number(request.nextUrl.searchParams.get('offset'))
  const sessions = await listOpenclawCachedSessions({
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : undefined,
  })
  return NextResponse.json({
    sessions,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const session = await createOpenclawDraftSession(typeof body?.title === 'string' ? body.title : undefined)
  return NextResponse.json({
    ok: true,
    session,
  })
}

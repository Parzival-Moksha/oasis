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
    return NextResponse.json({
      session: session.summary,
      messages: session.messages,
    })
  }

  const sessions = await listOpenclawCachedSessions()
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

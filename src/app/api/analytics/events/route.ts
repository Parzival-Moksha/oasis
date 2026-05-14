import { NextRequest, NextResponse } from 'next/server'

import { recordOasisAnalyticsEvent } from '@/lib/oasis-analytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const eventType = typeof body?.eventType === 'string' ? body.eventType.trim() : ''
    if (!eventType) {
      return NextResponse.json({ ok: false, error: 'eventType required' }, { status: 400 })
    }

    await recordOasisAnalyticsEvent({
      request,
      eventType,
      worldId: typeof body?.worldId === 'string' ? body.worldId : null,
      agentType: typeof body?.agentType === 'string' ? body.agentType : null,
      source: typeof body?.source === 'string' ? body.source : 'browser',
      durationMs: typeof body?.durationMs === 'number' ? body.durationMs : null,
      costUsd: typeof body?.costUsd === 'number' ? body.costUsd : null,
      metadata: body?.metadata,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analytics/events] POST failed:', message)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}

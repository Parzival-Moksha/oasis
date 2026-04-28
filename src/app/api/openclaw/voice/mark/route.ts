import { NextRequest, NextResponse } from 'next/server'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const voiceSessionId = sanitizeString(body.voiceSessionId)

  if (!voiceSessionId) {
    return NextResponse.json({ ok: false, error: 'voiceSessionId is required.' }, { status: 400 })
  }

  const client = getOasisGatewayClient()
  try {
    await client.ensureReady()
    await client.callMethod('oasis.voice.mark', {
      voiceSessionId,
      markName: sanitizeString(body.markName),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not acknowledge OpenClaw voice playback.',
    }, { status: 503 })
  }
}

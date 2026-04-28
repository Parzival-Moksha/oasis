import { NextRequest, NextResponse } from 'next/server'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return undefined
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const voiceSessionId = sanitizeString(body.voiceSessionId)
  const audioBase64 = sanitizeString(body.audioBase64)
  const mediaTimestampMs = sanitizeInteger(body.mediaTimestampMs)

  if (!voiceSessionId || !audioBase64) {
    return NextResponse.json({ ok: false, error: 'voiceSessionId and audioBase64 are required.' }, { status: 400 })
  }

  const client = getOasisGatewayClient()
  try {
    await client.ensureReady()
    await client.callMethod('oasis.voice.audio', {
      voiceSessionId,
      audioBase64,
      ...(typeof mediaTimestampMs === 'number' ? { mediaTimestampMs } : {}),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not forward voice audio to OpenClaw.',
    }, { status: 503 })
  }
}

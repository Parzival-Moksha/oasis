import { NextRequest, NextResponse } from 'next/server'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'
import {
  hostedVisitorOpenclawBlockedResponse,
  shouldBlockHostedVisitorOpenclawGateway,
} from '@/lib/openclaw-hosted-boundary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  if (shouldBlockHostedVisitorOpenclawGateway(request)) {
    return hostedVisitorOpenclawBlockedResponse('OpenClaw Gateway voice')
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const voiceSessionId = sanitizeString(body.voiceSessionId)

  if (!voiceSessionId) {
    return NextResponse.json({ ok: false, error: 'voiceSessionId is required.' }, { status: 400 })
  }

  const client = getOasisGatewayClient()
  try {
    await client.ensureReady()
    await client.callMethod('oasis.voice.stop', {
      voiceSessionId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not stop OpenClaw voice.',
    }, { status: 503 })
  }
}

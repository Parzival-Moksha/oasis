import { NextRequest } from 'next/server'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  const voiceSessionId = sanitizeString(request.nextUrl.searchParams.get('voiceSessionId'))
  if (!voiceSessionId) {
    return new Response(JSON.stringify({ ok: false, error: 'voiceSessionId is required.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const client = getOasisGatewayClient()
  try {
    await client.ensureReady()
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'OpenClaw Gateway is not ready.',
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const writeEvent = (name: string, payload: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${name}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const unsubscribe = client.subscribeEvent('oasis.voice', payload => {
        const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        if (sanitizeString(record.voiceSessionId) !== voiceSessionId) return
        writeEvent('voice', record)
      })

      const shutdown = (reason?: string) => {
        if (closed) return
        closed = true
        try {
          unsubscribe()
        } catch {
          // ignore
        }
        if (reason) {
          writeEvent('closed', { reason })
        }
        try {
          controller.close()
        } catch {
          // ignore
        }
      }

      request.signal.addEventListener('abort', () => shutdown('aborted'))
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}

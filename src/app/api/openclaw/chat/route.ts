import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// POST /api/openclaw/chat  {sessionKey, message, idempotencyKey?}
//   → SSE stream of chat events from the Gateway
//
// Each SSE frame carries a `chat` event payload:
//   {runId, sessionKey, seq, state:"delta"|"final"|"aborted"|"error", message?, ...}
//
// Stream closes when state is 'final', 'aborted', or 'error'.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

interface ChatSendResult {
  runId?: string
  status?: string
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sessionKey = sanitizeString(body.sessionKey)
  const message = sanitizeString(body.message)
  const idempotencyKey = sanitizeString(body.idempotencyKey) || randomUUID()

  if (!sessionKey) return jsonError('sessionKey is required.', 400)
  if (!message) return jsonError('message is required.', 400)

  const client = getOasisGatewayClient()

  try {
    await client.ensureReady()
  } catch (err) {
    const msg = (err as Error).message || String(err)
    const status = client.getStatus()
    if (status.state === 'pairing-required') {
      return jsonError(msg, 428, { state: 'pairing-required', hint: 'Approve Oasis on the machine running the Gateway: openclaw devices list && openclaw devices approve <id>' })
    }
    return jsonError(msg, 503, { state: status.state })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let unsubscribeChat: (() => void) | null = null
      let unsubscribeAbort: (() => void) | null = null
      let targetRunId = ''
      const knownRunIds = new Set<string>([idempotencyKey])
      const bufferedToolEvents: Record<string, unknown>[] = []

      const writeEvent = (name: string, payload: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${name}\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          // controller closed — ignore
        }
      }

      const shutdown = (reason?: string) => {
        if (closed) return
        closed = true
        try { unsubscribeChat?.() } catch { /* ignore */ }
        try { unsubscribeAbort?.() } catch { /* ignore */ }
        if (reason) writeEvent('closed', { reason })
        try { controller.close() } catch { /* ignore */ }
      }

      const toolTraceSessionKey = (rec: Record<string, unknown>) => (
        typeof rec.sessionKey === 'string'
          ? rec.sessionKey
          : typeof rec.sessionId === 'string'
            ? rec.sessionId
            : ''
      )

      const toolTraceMatchesRun = (rec: Record<string, unknown>) => {
        const runId = typeof rec.runId === 'string' ? rec.runId : ''
        const eventSessionKey = toolTraceSessionKey(rec)
        if (runId) return knownRunIds.has(runId)
        return Boolean(eventSessionKey && eventSessionKey === sessionKey)
      }

      const flushBufferedToolEvents = () => {
        if (bufferedToolEvents.length === 0) return
        const pending = bufferedToolEvents.splice(0, bufferedToolEvents.length)
        for (const rec of pending) {
          if (toolTraceMatchesRun(rec)) writeEvent('session.tool', rec)
        }
      }

      try {
        await client.callMethod('sessions.subscribe', {})
      } catch {
        // Chat deltas still work without the session event lane; history remains the fallback.
      }

      // Subscribe BEFORE calling chat.send so we don't miss early events.
      unsubscribeChat = client.subscribeEvent('chat', (payload) => {
        const rec = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        const runId = typeof rec.runId === 'string' ? rec.runId : ''
        if (!runId || (targetRunId && runId !== targetRunId)) return
        writeEvent('chat', rec)
        const state = typeof rec.state === 'string' ? rec.state : ''
        if (state === 'final' || state === 'aborted' || state === 'error') {
          shutdown(state)
        }
      })

      // Also forward session.tool events for the active runId — these are the
      // tool_use / tool_result traces OpenClaw fires while executing.
      unsubscribeAbort = client.subscribeEvent('session.tool', (payload) => {
        const rec = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        if (!targetRunId) {
          if (toolTraceMatchesRun(rec) || toolTraceSessionKey(rec) === sessionKey) bufferedToolEvents.push(rec)
          return
        }
        if (!toolTraceMatchesRun(rec)) return
        writeEvent('session.tool', rec)
      })

      try {
        const sendResult = await client.callMethod<ChatSendResult>('chat.send', {
          sessionKey,
          message,
          idempotencyKey,
        })
        targetRunId = sendResult?.runId || idempotencyKey
        knownRunIds.add(targetRunId)
        writeEvent('started', { runId: targetRunId, status: sendResult?.status || 'started' })
        flushBufferedToolEvents()
      } catch (err) {
        writeEvent('error', { message: (err as Error).message || String(err) })
        shutdown('error')
        return
      }

      // Signal.abort support — if client closes the stream early, stop listening.
      request.signal.addEventListener('abort', () => shutdown('aborted'))
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}

// GET returns the current gateway client status — useful for panel UI
// to decide whether to show "pair me" CTA vs "ready".
export async function GET() {
  const client = getOasisGatewayClient()
  return new Response(JSON.stringify(client.getStatus()), {
    headers: { 'content-type': 'application/json' },
  })
}

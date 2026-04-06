// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD EVENTS SSE — Real-time world mutation stream
// ─═̷─═̷─ॐ─═̷─═̷─ Agent builds → browser sees instantly ─═̷─═̷─ॐ─═̷─═̷─
//
// GET /api/world-events → SSE stream
// Browser subscribes on mount, receives events when MCP tools modify world.
// Replaces Supabase Realtime.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { subscribe, type WorldEvent } from '@/lib/mcp/world-events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat so the client knows the connection is alive
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`))

      const listener = (event: WorldEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Stream closed by client
        }
      }

      const unsubscribe = subscribe(listener)

      // Heartbeat every 30s to keep the connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`))
        } catch {
          clearInterval(heartbeat)
          unsubscribe()
        }
      }, 30000)

      // Cleanup when client disconnects — detected via the stream closing
      // Note: ReadableStream doesn't have a native 'cancel' callback in all runtimes,
      // but the heartbeat try/catch will clean up on the next tick after disconnect.
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

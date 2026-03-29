// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/console/stream — SSE endpoint for live server console output
// ─═̷─═̷─ॐ─═̷─═̷─ Streams console.log/warn/error/info in real time ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { patchConsole, patchStdio, getLines, subscribe, type ConsoleLine } from '@/lib/console-buffer'

// Ensure console + stdout/stderr are patched on first import
patchConsole()
patchStdio()

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()
  let unsub: (() => void) | null = null

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send history (last 200 lines as initial burst)
      const history = getLines().slice(-200)
      for (const line of history) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
      }

      // Stream new lines in real time
      unsub = subscribe((line: ConsoleLine) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
        } catch {
          // Stream closed
          unsub?.()
          if (heartbeatTimer) clearInterval(heartbeatTimer)
        }
      })

      // 30s keepalive heartbeat — SSE comment keeps connection alive through proxies
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:keepalive\n\n`))
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          unsub?.()
        }
      }, 30_000)
    },
    cancel() {
      unsub?.()
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

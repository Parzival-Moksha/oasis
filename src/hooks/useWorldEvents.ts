// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useWorldEvents — SSE subscriber for real-time world mutations
// ─═̷─═̷─ॐ─═̷─═̷─ Agent builds → you see it instantly ─═̷─═̷─ॐ─═̷─═̷─
//
// Subscribes to /api/world-events SSE stream.
// When an MCP tool modifies the world, the event arrives here in ~10ms.
// The hook reloads the full world state from the server.
//
// Surgical updates (per-event patching) would be faster but fragile.
// Full reload is ~5-15ms for a typical world and guarantees consistency.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef } from 'react'
import { useOasisStore } from '@/store/oasisStore'
import { getActiveWorldId } from '@/lib/forge/world-persistence'

const RECONNECT_DELAY_MS = 3000

export function useWorldEvents() {
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    function connect() {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      const es = new EventSource('/api/world-events')
      esRef.current = es

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type: string; worldId?: string }

          // Skip heartbeats and connection events
          if (parsed.type === 'heartbeat' || parsed.type === 'connected') return

          // Only reload if the event is for our active world
          const activeWorldId = getActiveWorldId()
          if (parsed.worldId && parsed.worldId !== activeWorldId) return

          // Reload world state from server
          const store = useOasisStore.getState()
          if (store._isReceivingRemoteUpdate) return // already applying

          console.log(`[WorldEvents] ${parsed.type} — reloading world state`)
          store.loadWorldState()
        } catch {
          // Ignore malformed events
        }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        // Reconnect after delay
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    connect()

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [])
}

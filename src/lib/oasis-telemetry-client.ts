'use client'

export interface TrackOasisEventInput {
  eventType: string
  worldId?: string | null
  agentType?: string | null
  source?: string | null
  durationMs?: number | null
  costUsd?: number | null
  metadata?: unknown
}

export function trackOasisEvent(input: TrackOasisEventInput, options?: { beacon?: boolean }): void {
  if (typeof window === 'undefined') return
  const eventType = input.eventType.trim()
  if (!eventType) return

  const payload = JSON.stringify({
    eventType,
    worldId: input.worldId || undefined,
    agentType: input.agentType || undefined,
    source: input.source || 'browser',
    durationMs: input.durationMs ?? undefined,
    costUsd: input.costUsd ?? undefined,
    metadata: input.metadata,
  })

  if (options?.beacon && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' })
    navigator.sendBeacon('/api/analytics/events', blob)
    return
  }

  fetch('/api/analytics/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => null)
}

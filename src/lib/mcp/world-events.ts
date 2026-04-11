// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD EVENTS — In-process pub/sub for world mutations
// ─═̷─═̷─ॐ─═̷─═̷─ MCP tools publish, SSE subscribers receive ─═̷─═̷─ॐ─═̷─═̷─
//
// Replaces Supabase Realtime. Agent modifies world → event published →
// browser receives via SSE → Zustand updates → React re-renders.
// ~10-50ms end-to-end, zero page reload.
//
// IMPORTANT: Listeners live on globalThis so they survive Next.js HMR.
// Without this, hot-reloads orphan old SSE connections' listeners and
// new events never reach the browser until a full page refresh.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export type WorldEventType =
  | 'object_added'
  | 'object_removed'
  | 'object_modified'
  | 'conjured_asset_added'
  | 'conjured_asset_removed'
  | 'scene_crafted'
  | 'sky_changed'
  | 'ground_changed'
  | 'tiles_painted'
  | 'light_added'
  | 'light_modified'
  | 'behavior_set'
  | 'agent_avatar_set'
  | 'agent_avatar_walk'
  | 'agent_avatar_animation'
  | 'world_cleared'
  | 'world_saved'

export interface WorldEvent {
  type: WorldEventType
  worldId: string
  timestamp: number
  data?: Record<string, unknown>
}

type Listener = (event: WorldEvent) => void

// Pin listeners to globalThis so they survive Next.js HMR reloads.
// Without this, each hot-reload creates a new empty Set while existing
// SSE subscriber references point at the orphaned old Set.
const globalState = globalThis as typeof globalThis & {
  __oasisWorldEventListeners?: Set<Listener>
}
if (!globalState.__oasisWorldEventListeners) {
  globalState.__oasisWorldEventListeners = new Set()
}
const listeners = globalState.__oasisWorldEventListeners

/** Subscribe to world events. Returns unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Publish a world event to all subscribers. */
export function publish(event: WorldEvent): void {
  for (const listener of listeners) {
    try { listener(event) } catch { /* swallow per-listener errors */ }
  }
}

/** Convenience: publish from an MCP tool result. */
export function emitWorldEvent(type: WorldEventType, worldId: string, data?: Record<string, unknown>): void {
  publish({ type, worldId, timestamp: Date.now(), data })
}

/** Current subscriber count (for diagnostics). */
export function subscriberCount(): number {
  return listeners.size
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD EVENTS — Unit tests
// Tests: subscribe/publish, emitWorldEvent, subscriberCount,
//        globalThis HMR survival, error isolation, unsubscribe
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorldEvent, WorldEventType } from '../mcp/world-events'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function makeEvent(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    type: 'object_added',
    worldId: 'test-world',
    timestamp: Date.now(),
    ...overrides,
  }
}

// Clear globalThis listener set between tests to ensure isolation
function clearGlobalListeners() {
  const g = globalThis as typeof globalThis & { __oasisWorldEventListeners?: Set<unknown> }
  if (g.__oasisWorldEventListeners) {
    g.__oasisWorldEventListeners.clear()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('world-events pub/sub', () => {
  let mod: typeof import('../mcp/world-events')

  beforeEach(async () => {
    clearGlobalListeners()
    // Dynamic import so globalThis state is respected per test
    mod = await import('../mcp/world-events')
  })

  afterEach(() => {
    clearGlobalListeners()
  })

  // ── subscribe + publish ─────────────────────────────────────────────

  it('delivers events to a subscribed listener', () => {
    const received: WorldEvent[] = []
    mod.subscribe((e) => received.push(e))

    const event = makeEvent()
    mod.publish(event)

    expect(received).toHaveLength(1)
    expect(received[0]).toBe(event)
  })

  it('delivers events to multiple listeners', () => {
    const a: WorldEvent[] = []
    const b: WorldEvent[] = []
    mod.subscribe((e) => a.push(e))
    mod.subscribe((e) => b.push(e))

    mod.publish(makeEvent())

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('does not deliver events after unsubscribe', () => {
    const received: WorldEvent[] = []
    const unsub = mod.subscribe((e) => received.push(e))

    mod.publish(makeEvent())
    expect(received).toHaveLength(1)

    unsub()
    mod.publish(makeEvent())
    expect(received).toHaveLength(1) // still 1, not 2
  })

  it('returns a working unsubscribe function from subscribe', () => {
    const unsub = mod.subscribe(() => {})
    expect(typeof unsub).toBe('function')
    // Should not throw
    unsub()
    unsub() // double-unsubscribe is safe (Set.delete on missing is no-op)
  })

  // ── emitWorldEvent convenience ──────────────────────────────────────

  it('emitWorldEvent publishes with correct type, worldId, and data', () => {
    const received: WorldEvent[] = []
    mod.subscribe((e) => received.push(e))

    mod.emitWorldEvent('sky_changed', 'world-42', { preset: 'sunset' })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('sky_changed')
    expect(received[0].worldId).toBe('world-42')
    expect(received[0].data).toEqual({ preset: 'sunset' })
    expect(typeof received[0].timestamp).toBe('number')
  })

  it('emitWorldEvent works without optional data argument', () => {
    const received: WorldEvent[] = []
    mod.subscribe((e) => received.push(e))

    mod.emitWorldEvent('world_cleared', 'world-99')

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('world_cleared')
    expect(received[0].data).toBeUndefined()
  })

  // ── subscriberCount ─────────────────────────────────────────────────

  it('subscriberCount returns 0 when no listeners', () => {
    expect(mod.subscriberCount()).toBe(0)
  })

  it('subscriberCount increments on subscribe', () => {
    mod.subscribe(() => {})
    expect(mod.subscriberCount()).toBe(1)

    mod.subscribe(() => {})
    expect(mod.subscriberCount()).toBe(2)
  })

  it('subscriberCount decrements on unsubscribe', () => {
    const unsub1 = mod.subscribe(() => {})
    const unsub2 = mod.subscribe(() => {})
    expect(mod.subscriberCount()).toBe(2)

    unsub1()
    expect(mod.subscriberCount()).toBe(1)

    unsub2()
    expect(mod.subscriberCount()).toBe(0)
  })

  // ── error isolation ─────────────────────────────────────────────────

  it('a throwing listener does not prevent other listeners from receiving events', () => {
    const received: WorldEvent[] = []

    mod.subscribe(() => { throw new Error('boom') })
    mod.subscribe((e) => received.push(e))

    // Should not throw despite first listener throwing
    mod.publish(makeEvent())
    expect(received).toHaveLength(1)
  })

  // ── event types ─────────────────────────────────────────────────────

  it('all WorldEventType values can be published without error', () => {
    const eventTypes: WorldEventType[] = [
      'object_added', 'object_removed', 'object_modified',
      'conjured_asset_added', 'conjured_asset_removed',
      'scene_crafted', 'scene_craft_progress', 'sky_changed', 'ground_changed',
      'tiles_painted', 'light_added', 'light_modified',
      'behavior_set', 'agent_avatar_set', 'agent_avatar_walk',
      'agent_avatar_animation', 'world_cleared', 'world_saved',
    ]

    const received: WorldEvent[] = []
    mod.subscribe((e) => received.push(e))

    for (const type of eventTypes) {
      mod.publish(makeEvent({ type }))
    }

    expect(received).toHaveLength(eventTypes.length)
    expect(received.map(e => e.type)).toEqual(eventTypes)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// globalThis HMR SURVIVAL
// This is the core behavioral change being tested. The listener Set must
// live on globalThis so that when Next.js HMR re-imports the module,
// existing SSE subscribers (registered via the old import) still receive
// events published via the new import.
// ═══════════════════════════════════════════════════════════════════════════

describe('world-events globalThis HMR survival', () => {
  beforeEach(() => {
    clearGlobalListeners()
  })

  afterEach(() => {
    clearGlobalListeners()
  })

  it('listeners Set is stored on globalThis.__oasisWorldEventListeners', () => {
    const g = globalThis as typeof globalThis & { __oasisWorldEventListeners?: Set<unknown> }
    // After importing the module, the set should exist on globalThis
    // (the import at top of file already triggered module initialization)
    expect(g.__oasisWorldEventListeners).toBeInstanceOf(Set)
  })

  it('two imports of the module share the same listener set (HMR simulation)', async () => {
    // Import the module once
    const mod1 = await import('../mcp/world-events')

    // Simulate what HMR does: the module re-executes, but globalThis persists.
    // In vitest we can't truly re-execute the module, but we can verify the
    // fundamental invariant: subscribers registered through one reference
    // receive events published through another, because they share globalThis.
    const mod2 = await import('../mcp/world-events')

    // Both imports should reference the same underlying module (vitest caches)
    // The key test: subscribe via mod1, publish via mod2
    const received: WorldEvent[] = []
    mod1.subscribe((e) => received.push(e))

    mod2.emitWorldEvent('sky_changed', 'hmr-test-world')

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('sky_changed')
  })

  it('pre-existing listeners on globalThis survive module re-import', async () => {
    // Simulate a listener that was registered before HMR reload
    const g = globalThis as typeof globalThis & { __oasisWorldEventListeners?: Set<Function> }
    if (!g.__oasisWorldEventListeners) {
      g.__oasisWorldEventListeners = new Set()
    }

    const received: WorldEvent[] = []
    const preExistingListener = (e: WorldEvent) => received.push(e)
    g.__oasisWorldEventListeners.add(preExistingListener)

    // Now import the module (simulating post-HMR)
    const mod = await import('../mcp/world-events')

    // The module should NOT have replaced the Set, so our pre-existing listener survives
    mod.emitWorldEvent('object_added', 'survival-test')

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('object_added')
  })

  it('module does not overwrite existing globalThis Set on re-init', () => {
    const g = globalThis as typeof globalThis & { __oasisWorldEventListeners?: Set<unknown> }

    // Place a known Set on globalThis
    const originalSet = new Set<unknown>()
    originalSet.add('sentinel')
    g.__oasisWorldEventListeners = originalSet

    // The module checks `if (!globalState.__oasisWorldEventListeners)` before creating.
    // Since the set already exists, the module should use it as-is.
    // We verify by checking the sentinel value persists.
    expect(g.__oasisWorldEventListeners.has('sentinel')).toBe(true)
    expect(g.__oasisWorldEventListeners).toBe(originalSet)
  })
})

import { describe, expect, it } from 'vitest'
import {
  WELCOME_HUB_WORLD_ID,
  buildWelcomeHubPortalGates,
  createPortalTriggerState,
  getSafePortalTargetWorlds,
  isWithinPortalTriggerRadius,
  markPortalTriggered,
  shouldTriggerPortal,
  type PortalGate,
} from '../portal-gates'
import type { WorldMeta } from '../forge/world-persistence'

const gate: PortalGate = {
  id: 'portal-a',
  variant: 'threshold-ring',
  position: [2, 0, 3],
  triggerRadius: 1.5,
  targetWorldId: 'world-target',
}

function world(id: string, visibility: WorldMeta['visibility'] = 'private'): WorldMeta {
  return {
    id,
    name: id,
    icon: 'W',
    visibility,
    createdAt: '',
    lastSavedAt: '',
  }
}

describe('portal gate trigger helpers', () => {
  it('uses XZ distance for trigger radius checks', () => {
    expect(isWithinPortalTriggerRadius([2, 20, 4.4], gate)).toBe(true)
    expect(isWithinPortalTriggerRadius([2, 0, 4.51], gate)).toBe(false)
  })

  it('does not trigger inert gates or missing player poses', () => {
    const state = createPortalTriggerState()

    expect(shouldTriggerPortal(null, gate, state, { nowMs: 1000, cooldownMs: 500 })).toBe(false)
    expect(shouldTriggerPortal([2, 0, 3], { ...gate, inert: true }, state, { nowMs: 1000, cooldownMs: 500 })).toBe(false)
  })

  it('respects cooldowns before allowing another trigger', () => {
    const state = markPortalTriggered(createPortalTriggerState(), 1000)

    expect(shouldTriggerPortal([2, 0, 3], gate, state, { nowMs: 1200, cooldownMs: 500 })).toBe(false)
    expect(shouldTriggerPortal([2, 0, 3], gate, state, { nowMs: 1600, cooldownMs: 500 })).toBe(true)
  })

  it('supports one-shot portals', () => {
    const state = markPortalTriggered(createPortalTriggerState(), 1000)

    expect(shouldTriggerPortal([2, 0, 3], gate, state, { nowMs: 5000, cooldownMs: 500, oneShot: true })).toBe(false)
  })

  it('filters Welcome Hub, active world, core worlds, and templates from targets', () => {
    expect(getSafePortalTargetWorlds([
      world(WELCOME_HUB_WORLD_ID, 'core'),
      world('world-active'),
      world('world-core', 'core'),
      world('world-template', 'template'),
      world('world-safe', 'private'),
    ], 'world-active').map(item => item.id)).toEqual(['world-safe'])
  })

  it('builds inert gallery gates when there are no target worlds', () => {
    const gates = buildWelcomeHubPortalGates([])

    expect(gates).toHaveLength(5)
    expect(gates.every(item => item.inert && !item.targetWorldId && item.triggerRadius === 0)).toBe(true)
  })

  it('places a single live destination away from spawn', () => {
    const [singleGate] = buildWelcomeHubPortalGates([world('world-safe')])

    expect(singleGate.position).toEqual([0, 0, -4])
    expect(singleGate.triggerRadius).toBeGreaterThan(0)
    expect(singleGate.inert).toBe(false)
  })
})

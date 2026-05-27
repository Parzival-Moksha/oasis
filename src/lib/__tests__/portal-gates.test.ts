import { describe, expect, it } from 'vitest'
import {
  WELCOME_HUB_WORLD_ID,
  buildWelcomeHubPortalGates,
  buildWelcomeHubDirectoryPortalGates,
  crossedPortalPlane,
  createPortalTriggerState,
  enteredPortalActivationZone,
  getSafePortalTargetWorlds,
  isWithinPortalPlaneBounds,
  getPortalGateLabel,
  layoutPortalAreaGates,
  markPortalTriggered,
  portalAreaPose,
  portalRotationTowardCenter,
  resolveWelcomeHubPortalGates,
  resolvePortalGateAction,
  shouldTriggerPortal,
  type PortalGate,
} from '../portal-gates'
import type { WorldMeta } from '../forge/world-persistence'

const gate: PortalGate = {
  id: 'portal-a',
  variant: 'threshold-ring',
  position: [2, 0, 3],
  width: 2,
  height: 3,
  targetWorldId: 'world-target',
}

function world(id: string, visibility: WorldMeta['visibility'] = 'private', extras: Partial<WorldMeta> = {}): WorldMeta {
  return {
    id,
    name: id,
    icon: 'W',
    visibility,
    createdAt: '',
    lastSavedAt: '',
    ...extras,
  }
}

describe('portal gate trigger helpers', () => {
  it('uses portal plane bounds instead of a radius bubble', () => {
    expect(isWithinPortalPlaneBounds([2.9, 0, 3.01], gate)).toBe(true)
    expect(isWithinPortalPlaneBounds([3.2, 0, 3.01], gate)).toBe(false)
  })

  it('does not trigger inert gates or missing player poses', () => {
    const state = createPortalTriggerState()

    expect(shouldTriggerPortal(null, gate, state, { nowMs: 1000, cooldownMs: 500 })).toBe(false)
    expect(shouldTriggerPortal([2, 0, 2.8], { ...gate, inert: true }, state, { nowMs: 1000, cooldownMs: 500 })).toBe(false)
  })

  it('triggers only when the player crosses the portal plane inside the doorway', () => {
    expect(crossedPortalPlane([2, 0, 2.8], [2, 0, 3.2], gate)).toBe(true)
    expect(crossedPortalPlane([0.5, 0, 2.8], [0.5, 0, 3.2], gate)).toBe(false)

    const state = createPortalTriggerState()
    expect(shouldTriggerPortal([2, 0, 2.8], gate, state, { nowMs: 1000, cooldownMs: 500 })).toBe(false)
    expect(shouldTriggerPortal([2, 0, 3.2], gate, state, { nowMs: 1100, cooldownMs: 500 })).toBe(true)
  })

  it('also triggers when the player enters a shallow activation band around the portal plane', () => {
    expect(enteredPortalActivationZone([2, 0, 2.2], [2, 0, 2.55], gate, 0.5)).toBe(true)
    expect(enteredPortalActivationZone([2, 0, 2.55], [2, 0, 2.6], gate, 0.5)).toBe(false)
    expect(enteredPortalActivationZone([0.5, 0, 2.2], [0.5, 0, 2.55], gate, 0.5)).toBe(false)

    const state = createPortalTriggerState()
    expect(shouldTriggerPortal([2, 0, 2.2], gate, state, { nowMs: 1000, cooldownMs: 500, activationDepth: 0.5 })).toBe(false)
    expect(shouldTriggerPortal([2, 0, 2.55], gate, state, { nowMs: 1100, cooldownMs: 500, activationDepth: 0.5 })).toBe(true)
  })

  it('respects cooldowns before allowing another trigger', () => {
    const state = { ...markPortalTriggered(createPortalTriggerState(), 1000), lastPlayerPosition: [2, 0, 2.8] as [number, number, number] }

    expect(shouldTriggerPortal([2, 0, 3.2], gate, state, { nowMs: 1200, cooldownMs: 500 })).toBe(false)
    state.lastPlayerPosition = [2, 0, 2.8]
    expect(shouldTriggerPortal([2, 0, 3.2], gate, state, { nowMs: 1600, cooldownMs: 500 })).toBe(true)
  })

  it('supports one-shot portals', () => {
    const state = { ...markPortalTriggered(createPortalTriggerState(), 1000), lastPlayerPosition: [2, 0, 2.8] as [number, number, number] }

    expect(shouldTriggerPortal([2, 0, 3.2], gate, state, { nowMs: 5000, cooldownMs: 500, oneShot: true })).toBe(false)
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

    expect(gates).toHaveLength(10)
    expect(gates.every(item => item.inert && !item.targetWorldId && item.width > 0 && item.height > 0)).toBe(true)
  })

  it('builds public and FFA directory gates behind the create portals', () => {
    const publicGate = buildWelcomeHubDirectoryPortalGates([world('world-public', 'public')], 'public')[0]
    const ffaGates = buildWelcomeHubDirectoryPortalGates([
      world('world-ffa', 'public_edit'),
      world('world-ffa-2', 'ffa'),
    ], 'ffa')
    const ffaGate = ffaGates[0]

    expect(publicGate).toMatchObject({
      id: 'portal-zero-public-world-world-public',
      targetWorldId: 'world-public',
      action: { type: 'load_world', worldId: 'world-public' },
    })
    expect(publicGate.position[0]).toBeGreaterThan(19.8)
    expect(publicGate.rotationY).toBeCloseTo(-Math.PI / 2)

    expect(ffaGate).toMatchObject({
      id: 'portal-zero-ffa-world-world-ffa',
      targetWorldId: 'world-ffa',
      action: { type: 'load_world', worldId: 'world-ffa' },
    })
    expect(ffaGate.position[0]).toBeCloseTo(-4.64)
    expect(ffaGates[1].position[0] - ffaGate.position[0]).toBeCloseTo(9.28)
    expect(ffaGate.position[2]).toBeGreaterThan(19.8)
    expect(ffaGate.rotationY).toBeCloseTo(Math.PI + Math.PI / 12)
  })

  it('backfills Conjure and live public/FFA portals into Portal Zero without duplicating existing targets', () => {
    const gates = resolveWelcomeHubPortalGates([{
      id: 'portal-zero-new-public-world',
      label: 'New Public World',
      variant: 'solar-arch',
      position: [19.8, 0, 0],
      rotationY: -Math.PI / 2,
      width: 2.35,
      height: 3.15,
      action: { type: 'create_world', visibility: 'public' },
    }], [
      world(WELCOME_HUB_WORLD_ID, 'core'),
      world('world-public', 'public'),
      world('world-ffa', 'public_edit'),
      world('world-private', 'private'),
    ])

    expect(gates.map(item => item.id)).toEqual(expect.arrayContaining([
      'portal-zero-conjure-external',
      'portal-zero-new-public-world',
      'portal-zero-public-world-world-public',
      'portal-zero-ffa-world-world-ffa',
    ]))
    expect(gates.some(item => item.targetWorldId === 'world-private')).toBe(false)
    const conjureGate = gates.find(item => item.id === 'portal-zero-conjure-external')
    expect(conjureGate?.action).toMatchObject({
      type: 'external_url',
      url: 'https://conjure.04515.xyz',
      returnUrl: 'https://04515.xyz',
    })
  })

  it('keeps stress and demo shard worlds out of the Portal Zero directory', () => {
    const gates = resolveWelcomeHubPortalGates([], [
      world(WELCOME_HUB_WORLD_ID, 'core'),
      world('world-real-public', 'public'),
      world('world-swarm', 'ffa', { name: 'Swarm mpmxul 11 16' }),
      world('world-demo', 'ffa', { name: 'Demo ai-tinkerers-bogota-may-2026 FFA 1' }),
      world('world-demo-owner', 'ffa', { name: 'Regular Looking FFA', userId: 'oasis-demo-router' }),
    ])

    expect(gates.some(item => item.targetWorldId === 'world-real-public')).toBe(true)
    expect(gates.some(item => item.targetWorldId === 'world-swarm')).toBe(false)
    expect(gates.some(item => item.targetWorldId === 'world-demo')).toBe(false)
    expect(gates.some(item => item.targetWorldId === 'world-demo-owner')).toBe(false)
  })

  it('keeps deprecated tutorial worlds out of Portal Zero', () => {
    const gates = resolveWelcomeHubPortalGates([{
      id: 'legacy-rookie-gate',
      label: 'Rookie Wizard',
      variant: 'threshold-ring',
      position: [30, 0, 0],
      width: 2.4,
      height: 3.2,
      targetWorldId: 'world-rookie-wizard-system',
      action: { type: 'load_world', worldId: 'world-rookie-wizard-system', worldName: 'Rookie Wizard' },
    }], [
      world(WELCOME_HUB_WORLD_ID, 'core'),
      world('world-rookie-wizard-system', 'public', { name: 'Rookie Wizard' }),
      world('world-quest-zero-system', 'public', { name: 'Quest Zero' }),
      world('world-real-public', 'public'),
    ])

    expect(gates.some(item => item.targetWorldId === 'world-rookie-wizard-system')).toBe(false)
    expect(gates.some(item => item.targetWorldId === 'world-quest-zero-system')).toBe(false)
    expect(gates.some(item => item.targetWorldId === 'world-real-public')).toBe(true)
  })

  it('places a single live destination in the portal area', () => {
    const [singleGate] = buildWelcomeHubPortalGates([world('world-safe')])

    expect(singleGate.position).toEqual([30, 0, 0])
    expect(singleGate.width).toBeGreaterThan(0)
    expect(singleGate.height).toBeGreaterThan(0)
    expect(singleGate.inert).toBe(false)
  })

  it('lays out portal-area gates on a non-overlapping semicircle', () => {
    expect(portalAreaPose(0, 2).position).toEqual([30, 0, -2])
    expect(portalAreaPose(1, 2).position).toEqual([30, 0, 2])

    const gates: PortalGate[] = Array.from({ length: 6 }, (_, index) => ({
      id: `portal-${index}`,
      variant: 'threshold-ring',
      position: [30, 0, 0],
      width: 2.4,
      height: 3.2,
      targetWorldId: `world-${index}`,
      autoLayout: 'portal-area',
    }))
    const laidOut = layoutPortalAreaGates(gates)
    for (let index = 1; index < laidOut.length; index += 1) {
      const prev = laidOut[index - 1].position
      const current = laidOut[index].position
      expect(Math.hypot(current[0] - prev[0], current[2] - prev[2])).toBeGreaterThanOrEqual(3.99)
    }
  })

  it('does not sweep untagged gates just because they are near the portal area center', () => {
    const [gate] = layoutPortalAreaGates([{
      id: 'manual-portal',
      variant: 'threshold-ring',
      position: [30, 0, 0],
      width: 2.4,
      height: 3.2,
      targetWorldId: 'world-manual',
    }])

    expect(gate.position).toEqual([30, 0, 0])
    expect(gate.autoLayout).toBeUndefined()
  })

  it('aims return portals from the rim back toward world center', () => {
    expect(portalRotationTowardCenter([30, 0, 0])).toBeCloseTo(-Math.PI / 2)
    expect(Math.abs(portalRotationTowardCenter([0, 0, 30]))).toBeCloseTo(Math.PI)
  })

  it('resolves legacy target portals as load_world actions', () => {
    expect(resolvePortalGateAction({
      ...gate,
      targetWorldId: 'world-destination',
      targetWorldName: 'Destination',
    })).toEqual({
      type: 'load_world',
      worldId: 'world-destination',
      worldName: 'Destination',
    })
  })

  it('uses explicit portal actions and labels for creation and locked gates', () => {
    const createGate: PortalGate = {
      ...gate,
      label: 'Make a new FFA',
      action: { type: 'create_world', visibility: 'ffa', promptForName: true },
      targetWorldId: undefined,
      targetWorldName: undefined,
    }
    const lockedGate: PortalGate = {
      ...gate,
      action: { type: 'locked_message', message: 'Reach level 5.' },
      targetWorldId: undefined,
      targetWorldName: undefined,
    }

    expect(resolvePortalGateAction(createGate)).toEqual({ type: 'create_world', visibility: 'ffa', promptForName: true })
    expect(getPortalGateLabel(createGate)).toBe('Make a new FFA')
    expect(getPortalGateLabel(lockedGate)).toBe('Locked portal')
  })
})

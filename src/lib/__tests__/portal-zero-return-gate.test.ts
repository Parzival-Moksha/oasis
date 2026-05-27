import { describe, expect, it } from 'vitest'

import { WELCOME_HUB_WORLD_ID, type PortalGate } from '../portal-gates'
import { PORTAL_ZERO_RETURN_GATE_ID, upsertPortalZeroReturnGate } from '../portal-zero-return-gate'

describe('portal zero return gate', () => {
  it('repairs stale return gates that point back to the source world', () => {
    const gates: PortalGate[] = [{
      id: PORTAL_ZERO_RETURN_GATE_ID,
      variant: 'crystal-cavern',
      label: 'Wrong place',
      position: [4, 0, 4],
      rotationY: 1,
      scale: 1,
      width: 3,
      height: 4,
      sourceWorldId: 'demo-world',
      targetWorldId: 'demo-world',
      targetWorldName: 'Demo World',
      action: { type: 'load_world', worldId: 'demo-world', worldName: 'Demo World' },
    }]

    const [gate] = upsertPortalZeroReturnGate(gates, 'demo-world')

    expect(gate.id).toBe(PORTAL_ZERO_RETURN_GATE_ID)
    expect(gate.label).toBe('Portal Zero')
    expect(gate.targetWorldId).toBe(WELCOME_HUB_WORLD_ID)
    expect(gate.action).toMatchObject({ type: 'load_world', worldId: WELCOME_HUB_WORLD_ID })
    expect(gate.position).toEqual([4, 0, 4])
  })

  it('keeps only one canonical return gate when multiple home gates exist', () => {
    const gates: PortalGate[] = [
      {
        id: PORTAL_ZERO_RETURN_GATE_ID,
        variant: 'crystal-cavern',
        label: 'Portal Zero',
        position: [0, 0, -6],
        rotationY: 0,
        scale: 1,
        width: 2.65,
        height: 3.35,
        sourceWorldId: 'demo-world',
        targetWorldId: WELCOME_HUB_WORLD_ID,
        targetWorldName: 'Portal Zero',
        action: { type: 'load_world', worldId: WELCOME_HUB_WORLD_ID, worldName: 'Portal Zero' },
      },
      {
        id: 'duplicate-home',
        variant: 'crystal-cavern',
        label: 'Another home',
        position: [2, 0, -6],
        rotationY: 0,
        scale: 1,
        width: 2,
        height: 3,
        sourceWorldId: 'demo-world',
        targetWorldId: WELCOME_HUB_WORLD_ID,
        targetWorldName: 'Portal Zero',
        action: { type: 'load_world', worldId: WELCOME_HUB_WORLD_ID, worldName: 'Portal Zero' },
      },
    ]

    const next = upsertPortalZeroReturnGate(gates, 'demo-world')

    expect(next.filter(gate => gate.targetWorldId === WELCOME_HUB_WORLD_ID)).toHaveLength(1)
    expect(next[0]?.id).toBe(PORTAL_ZERO_RETURN_GATE_ID)
  })
})

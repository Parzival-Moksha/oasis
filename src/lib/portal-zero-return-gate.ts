import {
  WELCOME_HUB_WORLD_ID,
  type PortalGate,
} from './portal-gates'

export const PORTAL_ZERO_RETURN_GATE_ID = 'portal-return-to-portal-zero'

export function createPortalZeroReturnGate(sourceWorldId: string): PortalGate {
  return {
    id: PORTAL_ZERO_RETURN_GATE_ID,
    variant: 'crystal-cavern',
    label: 'Portal Zero',
    position: [0, 0, -6],
    rotationY: 0,
    scale: 1,
    width: 2.65,
    height: 3.35,
    direction: 'one-way',
    sourceWorldId,
    targetWorldId: WELCOME_HUB_WORLD_ID,
    targetWorldName: 'Portal Zero',
    action: {
      type: 'load_world',
      worldId: WELCOME_HUB_WORLD_ID,
      worldName: 'Portal Zero',
    },
  }
}

export function upsertPortalZeroReturnGate(
  portalGates: PortalGate[] | undefined,
  sourceWorldId: string,
): PortalGate[] {
  const gates = portalGates || []
  if (sourceWorldId === WELCOME_HUB_WORLD_ID) return gates

  const returnGate = createPortalZeroReturnGate(sourceWorldId)
  const hasReturnGate = gates.some(gate =>
    gate.id === PORTAL_ZERO_RETURN_GATE_ID ||
    gate.targetWorldId === WELCOME_HUB_WORLD_ID ||
    (gate.action?.type === 'load_world' && gate.action.worldId === WELCOME_HUB_WORLD_ID),
  )
  return hasReturnGate
    ? gates.map(gate => gate.id === PORTAL_ZERO_RETURN_GATE_ID ? { ...returnGate, ...gate } : gate)
    : [...gates, returnGate]
}

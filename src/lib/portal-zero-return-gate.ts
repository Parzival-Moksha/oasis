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
    position: [0, 0, 16],
    rotationY: Math.PI,
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

function isLegacyFrontReturnGate(gate: PortalGate): boolean {
  const position = gate.position
  return Array.isArray(position)
    && Math.abs(Number(position[0])) < 0.001
    && Math.abs(Number(position[1])) < 0.001
    && Math.abs(Number(position[2]) + 6) < 0.001
}

function normalizePortalZeroReturnGate(gate: PortalGate, sourceWorldId: string): PortalGate {
  const canonical = createPortalZeroReturnGate(sourceWorldId)
  const useCanonicalPlacement = !gate.position || isLegacyFrontReturnGate(gate)
  return {
    ...gate,
    id: canonical.id,
    direction: canonical.direction,
    sourceWorldId: canonical.sourceWorldId,
    targetWorldId: canonical.targetWorldId,
    targetWorldName: canonical.targetWorldName,
    action: canonical.action,
    label: canonical.label,
    variant: gate.variant || canonical.variant,
    position: useCanonicalPlacement ? canonical.position : gate.position,
    rotationY: useCanonicalPlacement ? canonical.rotationY : gate.rotationY ?? canonical.rotationY,
    scale: gate.scale ?? canonical.scale,
    width: gate.width || canonical.width,
    height: gate.height || canonical.height,
  }
}

export function upsertPortalZeroReturnGate(
  portalGates: PortalGate[] | undefined,
  sourceWorldId: string,
): PortalGate[] {
  const gates = portalGates || []
  if (sourceWorldId === WELCOME_HUB_WORLD_ID) return gates

  const returnGate = createPortalZeroReturnGate(sourceWorldId)
  let normalizedReturnGate = false
  const nextGates: PortalGate[] = []
  for (const gate of gates) {
    const isReturnGate = gate.id === PORTAL_ZERO_RETURN_GATE_ID
      || gate.targetWorldId === WELCOME_HUB_WORLD_ID
      || (gate.action?.type === 'load_world' && gate.action.worldId === WELCOME_HUB_WORLD_ID)
    if (!isReturnGate) {
      nextGates.push(gate)
      continue
    }
    if (normalizedReturnGate) continue
    normalizedReturnGate = true
    nextGates.push(normalizePortalZeroReturnGate(gate, sourceWorldId))
  }

  return normalizedReturnGate
    ? nextGates
    : [...gates, returnGate]
}

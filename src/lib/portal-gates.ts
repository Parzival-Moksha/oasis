import type { WorldMeta } from './forge/world-persistence'

export const WELCOME_HUB_WORLD_ID = 'world-welcome-hub-system'

export type PortalGateVariant =
  | 'threshold-ring'
  | 'void-door'
  | 'hologram-gate'
  | 'solar-arch'
  | 'rift-slit'

export type Vec3Tuple = [number, number, number]

export interface PortalGate {
  id: string
  variant: PortalGateVariant
  position: Vec3Tuple
  rotationY?: number
  triggerRadius: number
  targetWorldId?: string
  targetWorldName?: string
  inert?: boolean
}

export interface PortalTriggerState {
  lastTriggeredAtMs: number | null
  consumed: boolean
}

export interface PortalTriggerOptions {
  nowMs: number
  cooldownMs: number
  oneShot?: boolean
}

export const PORTAL_GATE_VARIANTS: PortalGateVariant[] = [
  'threshold-ring',
  'void-door',
  'hologram-gate',
  'solar-arch',
  'rift-slit',
]

export function distanceSquaredXZ(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return dx * dx + dz * dz
}

export function isWithinPortalTriggerRadius(playerPosition: Vec3Tuple, gate: Pick<PortalGate, 'position' | 'triggerRadius'>): boolean {
  if (gate.triggerRadius <= 0) return false
  return distanceSquaredXZ(playerPosition, gate.position) <= gate.triggerRadius * gate.triggerRadius
}

export function shouldTriggerPortal(
  playerPosition: Vec3Tuple | null,
  gate: Pick<PortalGate, 'position' | 'triggerRadius' | 'inert'>,
  state: PortalTriggerState,
  options: PortalTriggerOptions,
): boolean {
  if (!playerPosition || gate.inert) return false
  if (options.oneShot && state.consumed) return false
  if (!isWithinPortalTriggerRadius(playerPosition, gate)) return false

  const lastTriggeredAtMs = state.lastTriggeredAtMs
  return lastTriggeredAtMs === null || options.nowMs - lastTriggeredAtMs >= options.cooldownMs
}

export function markPortalTriggered(state: PortalTriggerState, nowMs: number): PortalTriggerState {
  return {
    lastTriggeredAtMs: nowMs,
    consumed: true,
  }
}

export function createPortalTriggerState(): PortalTriggerState {
  return {
    lastTriggeredAtMs: null,
    consumed: false,
  }
}

export function isWelcomeHubWorld(worldId: string | null | undefined): boolean {
  return worldId === WELCOME_HUB_WORLD_ID
}

export function getSafePortalTargetWorlds(worlds: WorldMeta[], activeWorldId: string): WorldMeta[] {
  return worlds.filter(world => {
    if (!world.id || world.id === activeWorldId || world.id === WELCOME_HUB_WORLD_ID) return false
    return world.visibility !== 'core' && world.visibility !== 'template'
  })
}

export function buildWelcomeHubPortalGates(targetWorlds: WorldMeta[]): PortalGate[] {
  const worlds = targetWorlds.slice(0, PORTAL_GATE_VARIANTS.length)
  const source = worlds.length > 0
    ? worlds
    : PORTAL_GATE_VARIANTS.map((variant, index) => ({
        id: `portal-gallery-${variant}`,
        name: variant.replace(/-/g, ' '),
        icon: '',
        visibility: 'template' as const,
        createdAt: '',
        lastSavedAt: '',
        __galleryIndex: index,
      }))

  const count = source.length
  const radius = count <= 1 ? 4 : 5.5
  return source.map((world, index) => {
    const angle = count <= 1 ? -Math.PI / 2 : (-Math.PI / 2) + (index / count) * Math.PI * 2
    const x = count <= 1 ? 0 : Math.cos(angle) * radius
    const z = count <= 1 ? -radius : Math.sin(angle) * radius
    const variant = PORTAL_GATE_VARIANTS[index % PORTAL_GATE_VARIANTS.length]
    return {
      id: `portal-gate-${world.id}`,
      variant,
      position: [x, 0, z],
      rotationY: -angle + Math.PI / 2,
      triggerRadius: worlds.length > 0 ? 1.35 : 0,
      targetWorldId: worlds.length > 0 ? world.id : undefined,
      targetWorldName: world.name,
      inert: worlds.length === 0,
    }
  })
}

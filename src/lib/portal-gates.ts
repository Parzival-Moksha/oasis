import type { WorldMeta } from './forge/world-persistence'

export const WELCOME_HUB_WORLD_ID = 'world-welcome-hub-system'
export const ROOKIE_WIZARD_WORLD_ID = 'world-rookie-wizard-system'
export const QUEST_ZERO_WORLD_ID = 'world-quest-zero-system'

export type PortalGateVariant =
  | 'threshold-ring'
  | 'void-door'
  | 'hologram-gate'
  | 'solar-arch'
  | 'rift-slit'
  | 'stargate-vortex'
  | 'crystal-cavern'
  | 'verdant-arch'
  | 'mirror-pool'
  | 'clockwork-iris'

export type Vec3Tuple = [number, number, number]

export type PortalCreateWorldVisibility =
  | 'private'
  | 'public'
  | 'public_edit'
  | 'ffa'
  | 'unlisted'
  | 'unlisted_edit'
  | 'only-with-link'

export type PortalAction =
  | { type: 'load_world'; worldId: string; worldName?: string }
  | {
      type: 'create_world'
      visibility?: PortalCreateWorldVisibility
      templateWorldId?: string
      name?: string
      icon?: string
      promptForName?: boolean
    }
  | { type: 'external_url'; url: string; label?: string; returnUrl?: string; requiresConfirm?: boolean }
  | { type: 'locked_message'; message: string }

export interface PortalSpawnPose {
  position: Vec3Tuple
  rotationY?: number
}

export interface PortalGateVariantDef {
  id: PortalGateVariant
  label: string
  desc: string
  accent: string
  preview: {
    from: string
    via: string
    to: string
  }
}

export interface PortalGate {
  id: string
  variant: PortalGateVariant
  label?: string
  position: Vec3Tuple
  rotationY?: number
  scale?: number
  width: number
  height: number
  direction?: 'one-way' | 'two-way'
  sourceWorldId?: string
  targetWorldId?: string
  targetWorldName?: string
  action?: PortalAction
  spawnPose?: PortalSpawnPose
  requiresLevel?: number
  linkedPortalId?: string
  autoLayout?: 'portal-area'
  inert?: boolean
  hidden?: boolean
}

export interface PortalTriggerState {
  lastTriggeredAtMs: number | null
  lastPlayerPosition: Vec3Tuple | null
  consumed: boolean
}

export interface PortalTriggerOptions {
  nowMs: number
  cooldownMs: number
  oneShot?: boolean
  activationDepth?: number
}

export const PORTAL_GATE_VARIANTS: PortalGateVariant[] = [
  'threshold-ring',
  'void-door',
  'hologram-gate',
  'solar-arch',
  'rift-slit',
  'stargate-vortex',
  'crystal-cavern',
  'verdant-arch',
  'mirror-pool',
  'clockwork-iris',
]

export const PORTAL_GATE_VARIANT_DEFS: PortalGateVariantDef[] = [
  {
    id: 'threshold-ring',
    label: 'Threshold',
    desc: 'A bright ceremonial ring with layered starfield depth.',
    accent: '#67e8f9',
    preview: { from: '#67e8f9', via: '#a78bfa', to: '#020617' },
  },
  {
    id: 'void-door',
    label: 'Void Door',
    desc: 'A dark monolith doorway with deep-space parallax.',
    accent: '#a78bfa',
    preview: { from: '#020617', via: '#7c3aed', to: '#111827' },
  },
  {
    id: 'hologram-gate',
    label: 'Temple',
    desc: 'A monumental Greek stone facade with a masked void threshold.',
    accent: '#d7d0c0',
    preview: { from: '#4b473e', via: '#d7d0c0', to: '#090909' },
  },
  {
    id: 'solar-arch',
    label: 'Solar Arch',
    desc: 'A warm golden arch with flare and ember motion.',
    accent: '#fbbf24',
    preview: { from: '#7c2d12', via: '#f59e0b', to: '#fff7ed' },
  },
  {
    id: 'rift-slit',
    label: 'Rift Slit',
    desc: 'A narrow unstable tear with violet plasma edges.',
    accent: '#f472b6',
    preview: { from: '#581c87', via: '#f472b6', to: '#020617' },
  },
  {
    id: 'stargate-vortex',
    label: 'Stargate',
    desc: 'A monumental ring with a rotating star tunnel.',
    accent: '#38bdf8',
    preview: { from: '#0f172a', via: '#38bdf8', to: '#f8fafc' },
  },
  {
    id: 'crystal-cavern',
    label: 'Crystal',
    desc: 'A faceted cavern gate with prism shards and cold glow.',
    accent: '#c084fc',
    preview: { from: '#312e81', via: '#c084fc', to: '#ecfeff' },
  },
  {
    id: 'verdant-arch',
    label: 'Torii',
    desc: 'A red lacquer East Asian gate with gold trim and a deep portal opening.',
    accent: '#ef4444',
    preview: { from: '#1f1714', via: '#b91c1c', to: '#facc15' },
  },
  {
    id: 'mirror-pool',
    label: 'Moon Cavern',
    desc: 'A second cave-mouth portal with a cold vertical pool inside.',
    accent: '#7dd3fc',
    preview: { from: '#082f49', via: '#7dd3fc', to: '#f0f9ff' },
  },
  {
    id: 'clockwork-iris',
    label: 'Clockwork',
    desc: 'A brass mechanical iris with rotating gear teeth.',
    accent: '#facc15',
    preview: { from: '#422006', via: '#facc15', to: '#fef3c7' },
  },
]

export const DEFAULT_PORTAL_ACTIVATION_DEPTH = 0.55
export const PORTAL_AREA_CENTER: Vec3Tuple = [30, 0, 0]
export const PORTAL_AREA_MIN_SPACING = 4
const WELCOME_HUB_DIRECTORY_LIMIT = 8
const WELCOME_HUB_PUBLIC_PORTAL_PREFIX = 'portal-zero-public-world-'
const WELCOME_HUB_FFA_PORTAL_PREFIX = 'portal-zero-ffa-world-'
const CONJURE_ARENA_URL = 'https://conjure.04515.xyz'
const OASIS_RETURN_URL = 'https://04515.xyz'

export const WELCOME_HUB_CONJURE_PORTAL_GATE: PortalGate = {
  id: 'portal-zero-conjure-external',
  label: 'Conjure Arena',
  variant: 'stargate-vortex',
  position: [0, 0, -19.8],
  rotationY: 0,
  scale: 0.96,
  width: 2.65,
  height: 3.55,
  direction: 'one-way',
  sourceWorldId: WELCOME_HUB_WORLD_ID,
  action: {
    type: 'external_url',
    url: CONJURE_ARENA_URL,
    label: 'Conjure Arena',
    returnUrl: OASIS_RETURN_URL,
    requiresConfirm: false,
  },
}

function portalNormalXZ(rotationY = 0): [number, number] {
  return [Math.sin(rotationY), Math.cos(rotationY)]
}

function portalTangentXZ(rotationY = 0): [number, number] {
  return [Math.cos(rotationY), -Math.sin(rotationY)]
}

function signedDistanceToPortalPlaneXZ(playerPosition: Vec3Tuple, gate: Pick<PortalGate, 'position' | 'rotationY'>): number {
  const [normalX, normalZ] = portalNormalXZ(gate.rotationY)
  const dx = playerPosition[0] - gate.position[0]
  const dz = playerPosition[2] - gate.position[2]
  return dx * normalX + dz * normalZ
}

function lateralDistanceOnPortalPlaneXZ(playerPosition: Vec3Tuple, gate: Pick<PortalGate, 'position' | 'rotationY'>): number {
  const [tangentX, tangentZ] = portalTangentXZ(gate.rotationY)
  const dx = playerPosition[0] - gate.position[0]
  const dz = playerPosition[2] - gate.position[2]
  return dx * tangentX + dz * tangentZ
}

export function isWithinPortalPlaneBounds(
  playerPosition: Vec3Tuple,
  gate: Pick<PortalGate, 'position' | 'rotationY' | 'width' | 'height'>,
): boolean {
  if (gate.width <= 0 || gate.height <= 0) return false
  const halfWidth = gate.width / 2
  const lateral = Math.abs(lateralDistanceOnPortalPlaneXZ(playerPosition, gate))
  const minY = gate.position[1]
  const maxY = gate.position[1] + gate.height
  return lateral <= halfWidth && playerPosition[1] >= minY - 0.25 && playerPosition[1] <= maxY + 0.25
}

export function crossedPortalPlane(
  previousPosition: Vec3Tuple | null,
  playerPosition: Vec3Tuple,
  gate: Pick<PortalGate, 'position' | 'rotationY' | 'width' | 'height'>,
): boolean {
  if (!previousPosition) return false
  if (!isWithinPortalPlaneBounds(playerPosition, gate)) return false

  const previousDistance = signedDistanceToPortalPlaneXZ(previousPosition, gate)
  const currentDistance = signedDistanceToPortalPlaneXZ(playerPosition, gate)
  if (Math.abs(previousDistance) < 0.02 && Math.abs(currentDistance) < 0.02) return false
  return previousDistance === 0 || currentDistance === 0 || Math.sign(previousDistance) !== Math.sign(currentDistance)
}

export function enteredPortalActivationZone(
  previousPosition: Vec3Tuple | null,
  playerPosition: Vec3Tuple,
  gate: Pick<PortalGate, 'position' | 'rotationY' | 'width' | 'height'>,
  activationDepth = DEFAULT_PORTAL_ACTIVATION_DEPTH,
): boolean {
  if (!previousPosition) return false
  if (activationDepth <= 0) return false
  const currentDistance = Math.abs(signedDistanceToPortalPlaneXZ(playerPosition, gate))
  if (currentDistance > activationDepth || !isWithinPortalPlaneBounds(playerPosition, gate)) return false

  const previousDistance = Math.abs(signedDistanceToPortalPlaneXZ(previousPosition, gate))
  const previousInside = previousDistance <= activationDepth && isWithinPortalPlaneBounds(previousPosition, gate)
  return !previousInside
}

export function shouldTriggerPortal(
  playerPosition: Vec3Tuple | null,
  gate: Pick<PortalGate, 'position' | 'rotationY' | 'width' | 'height' | 'inert'>,
  state: PortalTriggerState,
  options: PortalTriggerOptions,
): boolean {
  if (!playerPosition || gate.inert) return false
  if (options.oneShot && state.consumed) return false
  const crossed = crossedPortalPlane(state.lastPlayerPosition, playerPosition, gate)
  const enteredZone = enteredPortalActivationZone(
    state.lastPlayerPosition,
    playerPosition,
    gate,
    options.activationDepth ?? DEFAULT_PORTAL_ACTIVATION_DEPTH,
  )
  state.lastPlayerPosition = playerPosition
  if (!crossed && !enteredZone) return false

  const lastTriggeredAtMs = state.lastTriggeredAtMs
  return lastTriggeredAtMs === null || options.nowMs - lastTriggeredAtMs >= options.cooldownMs
}

export function markPortalTriggered(state: PortalTriggerState, nowMs: number): PortalTriggerState {
  return {
    ...state,
    lastTriggeredAtMs: nowMs,
    consumed: true,
  }
}

export function createPortalTriggerState(): PortalTriggerState {
  return {
    lastTriggeredAtMs: null,
    lastPlayerPosition: null,
    consumed: false,
  }
}

export function isWelcomeHubWorld(worldId: string | null | undefined): boolean {
  return worldId === WELCOME_HUB_WORLD_ID
}

export function resolvePortalGateAction(gate: PortalGate): PortalAction {
  if (gate.action) return gate.action
  if (gate.targetWorldId) {
    return {
      type: 'load_world',
      worldId: gate.targetWorldId,
      worldName: gate.targetWorldName,
    }
  }
  return {
    type: 'locked_message',
    message: gate.inert
      ? 'This portal has no destination yet.'
      : 'This portal is not open yet.',
  }
}

export function getPortalGateLabel(gate: PortalGate): string {
  if (gate.label?.trim()) return gate.label.trim()
  const action = resolvePortalGateAction(gate)
  switch (action.type) {
    case 'load_world':
      return action.worldName || gate.targetWorldName || 'World portal'
    case 'create_world':
      return action.name || `Create ${action.visibility || 'private'} world`
    case 'external_url':
      return action.label || 'External portal'
    case 'locked_message':
      return 'Locked portal'
    default:
      return gate.variant.replace(/-/g, ' ')
  }
}

export function getSafePortalTargetWorlds(worlds: WorldMeta[], activeWorldId: string): WorldMeta[] {
  return worlds.filter(world => {
    if (!world.id || world.id === activeWorldId || world.id === WELCOME_HUB_WORLD_ID) return false
    return world.visibility !== 'core' && world.visibility !== 'template'
  })
}

export function portalRotationTowardTarget(position: Vec3Tuple, target: Vec3Tuple): number {
  const dx = target[0] - position[0]
  const dz = target[2] - position[2]
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return 0
  return Math.atan2(dx, dz)
}

export function portalRotationTowardCenter(position: Vec3Tuple): number {
  return portalRotationTowardTarget(position, [0, 0, 0])
}

export function portalAreaPose(
  index: number,
  count: number,
  center: Vec3Tuple = PORTAL_AREA_CENTER,
  minSpacing = PORTAL_AREA_MIN_SPACING,
): { position: Vec3Tuple; rotationY: number } {
  if (count <= 1) {
    return {
      position: [...center] as Vec3Tuple,
      rotationY: portalRotationTowardCenter(center),
    }
  }

  const safeIndex = Math.max(0, Math.min(index, count - 1))
  const stepAngle = Math.PI / (count - 1)
  const radius = minSpacing / (2 * Math.sin(stepAngle / 2))
  const angle = -Math.PI / 2 + safeIndex * stepAngle
  const position: Vec3Tuple = [
    center[0] + Math.cos(angle) * radius,
    center[1],
    center[2] + Math.sin(angle) * radius,
  ]

  return {
    position,
    rotationY: portalRotationTowardCenter(position),
  }
}

function isPortalAreaManaged(
  gate: PortalGate,
  transforms?: Record<string, { position?: Vec3Tuple } | undefined>,
): boolean {
  if (gate.inert) return false
  if (transforms?.[gate.id]?.position) return false
  return gate.autoLayout === 'portal-area'
}

export function layoutPortalAreaGates(
  gates: PortalGate[],
  transforms?: Record<string, { position?: Vec3Tuple } | undefined>,
): PortalGate[] {
  const managed = gates.filter(gate => isPortalAreaManaged(gate, transforms))
  if (managed.length === 0) return gates

  const managedIndexes = new Map<string, number>()
  managed.forEach((gate, index) => managedIndexes.set(gate.id, index))

  return gates.map(gate => {
    const index = managedIndexes.get(gate.id)
    if (index === undefined) return gate
    const pose = portalAreaPose(index, managed.length)
    return {
      ...gate,
      position: pose.position,
      rotationY: pose.rotationY,
      autoLayout: 'portal-area',
    }
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
  return source.map((world, index) => {
    const variant = PORTAL_GATE_VARIANTS[index % PORTAL_GATE_VARIANTS.length]
    const pose = portalAreaPose(index, count)
    return {
      id: `portal-gate-${world.id}`,
      variant,
      position: pose.position,
      rotationY: pose.rotationY,
      scale: 1,
      width: 2.4,
      height: 3.2,
      direction: 'two-way',
      targetWorldId: worlds.length > 0 ? world.id : undefined,
      targetWorldName: world.name,
      action: worlds.length > 0
        ? { type: 'load_world' as const, worldId: world.id, worldName: world.name }
        : undefined,
      autoLayout: worlds.length > 0 ? 'portal-area' : undefined,
      inert: worlds.length === 0,
    }
  })
}

function worldSortTime(world: WorldMeta): number {
  const saved = Date.parse(world.lastSavedAt || '')
  if (Number.isFinite(saved)) return saved
  const created = Date.parse(world.createdAt || '')
  return Number.isFinite(created) ? created : 0
}

function sortDirectoryWorlds(worlds: WorldMeta[]): WorldMeta[] {
  return [...worlds].sort((a, b) => {
    const visits = (b.visitCount || 0) - (a.visitCount || 0)
    if (visits !== 0) return visits
    return worldSortTime(b) - worldSortTime(a)
  })
}

function isPortalZeroDirectorySuppressedWorld(world: WorldMeta): boolean {
  const name = (world.name || '').trim().toLowerCase()
  const owner = (world as WorldMeta & { userId?: string | null }).userId || ''
  return owner === 'oasis-demo-router'
    || name.startsWith('swarm ')
    || name.startsWith('demo ai-tinkerers')
}

function laneOffset(index: number): number {
  const row = Math.floor(index / 2)
  const side = index % 2 === 0 ? -1 : 1
  return side * (2.9 + row * 3.9)
}

function directoryPortalPose(kind: 'public' | 'ffa', index: number): { position: Vec3Tuple; rotationY: number } {
  if (kind === 'public') {
    const column = Math.floor(index / 4)
    return {
      position: [25.2 + column * 4.4, 0, laneOffset(index % 4)],
      rotationY: -Math.PI / 2,
    }
  }

  const column = Math.floor(index / 4)
  return {
    position: [laneOffset(index % 4), 0, 25.2 + column * 4.4],
    rotationY: Math.PI,
  }
}

function isWelcomeHubDirectoryGate(gate: PortalGate): boolean {
  return gate.id.startsWith(WELCOME_HUB_PUBLIC_PORTAL_PREFIX)
    || gate.id.startsWith(WELCOME_HUB_FFA_PORTAL_PREFIX)
}

function normalizeWelcomeHubConjureGate(gate: PortalGate): PortalGate {
  if (gate.id !== WELCOME_HUB_CONJURE_PORTAL_GATE.id) return gate
  const existingAction = gate.action?.type === 'external_url' ? gate.action : undefined
  return {
    ...WELCOME_HUB_CONJURE_PORTAL_GATE,
    ...gate,
    action: {
      ...WELCOME_HUB_CONJURE_PORTAL_GATE.action,
      ...(existingAction || {}),
      type: 'external_url',
      url: existingAction?.url || CONJURE_ARENA_URL,
      returnUrl: OASIS_RETURN_URL,
      requiresConfirm: false,
    },
  }
}

export function buildWelcomeHubDirectoryPortalGates(
  worlds: WorldMeta[],
  kind: 'public' | 'ffa',
): PortalGate[] {
  const prefix = kind === 'public' ? WELCOME_HUB_PUBLIC_PORTAL_PREFIX : WELCOME_HUB_FFA_PORTAL_PREFIX
  const variants: PortalGateVariant[] = kind === 'public'
    ? ['solar-arch', 'hologram-gate', 'mirror-pool', 'verdant-arch']
    : ['rift-slit', 'crystal-cavern', 'clockwork-iris', 'threshold-ring']

  return sortDirectoryWorlds(worlds)
    .slice(0, WELCOME_HUB_DIRECTORY_LIMIT)
    .map((world, index) => {
      const pose = directoryPortalPose(kind, index)
      return {
        id: `${prefix}${world.id}`,
        label: world.name || (kind === 'public' ? 'Public world' : 'FFA world'),
        variant: variants[index % variants.length],
        position: pose.position,
        rotationY: pose.rotationY,
        scale: 0.78,
        width: 2.15,
        height: 2.9,
        direction: 'one-way' as const,
        sourceWorldId: WELCOME_HUB_WORLD_ID,
        targetWorldId: world.id,
        targetWorldName: world.name,
        action: { type: 'load_world' as const, worldId: world.id, worldName: world.name },
      }
    })
}

export function resolveWelcomeHubPortalGates(
  storedGates: PortalGate[] | null | undefined,
  worldRegistry: WorldMeta[],
  transforms?: Record<string, { position?: Vec3Tuple } | undefined>,
): PortalGate[] {
  const base = Array.isArray(storedGates) ? storedGates : []
  const withoutDirectory = base
    .filter(gate => !isWelcomeHubDirectoryGate(gate))
    .map(normalizeWelcomeHubConjureGate)
  const withConjure = withoutDirectory.some(gate => gate.id === WELCOME_HUB_CONJURE_PORTAL_GATE.id)
    ? withoutDirectory
    : [WELCOME_HUB_CONJURE_PORTAL_GATE, ...withoutDirectory]

  const existingTargets = new Set(withConjure.map(gate => gate.targetWorldId).filter(Boolean))
  const eligible = getSafePortalTargetWorlds(worldRegistry, WELCOME_HUB_WORLD_ID)
    .filter(world => !existingTargets.has(world.id) && !isPortalZeroDirectorySuppressedWorld(world))
  const publicWorlds = eligible.filter(world => world.visibility === 'public')
  const ffaWorlds = eligible.filter(world => world.visibility === 'ffa' || world.visibility === 'public_edit')

  return layoutPortalAreaGates([
    ...withConjure,
    ...buildWelcomeHubDirectoryPortalGates(publicWorlds, 'public'),
    ...buildWelcomeHubDirectoryPortalGates(ffaWorlds, 'ffa'),
  ], transforms)
}

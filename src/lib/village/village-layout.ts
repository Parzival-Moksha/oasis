// ░▒▓ VILLAGE LAYOUT — where engine agents stand, which body they wear, how the camera frames them ▓▒░
// Pure math, no three.js: the village components turn these numbers into meshes.

export type Vec3 = [number, number, number]

/** PlayerAvatar spawns at (0, 0, 3) facing +Z (see PlayerAvatar positionRef / facingAngle). */
export const VILLAGE_SPAWN = { x: 0, z: 3, yaw: 0 }

export interface VillageOrigin {
  x: number
  z: number
  /** Facing: 0 = +Z. The plaza opens up in this direction. */
  yaw: number
}

/**
 * Where the village goes: in front of what the player sees when the world loads. The camera's
 * horizontal forward wins (third-person looks past the avatar); the avatar's facing is the
 * fallback when the camera looks straight down; +Z from the spawn point is the last resort.
 */
export function resolveVillageOrigin(
  avatar: { position: Vec3; forward?: Vec3 } | null | undefined,
  camera: { position: Vec3; forward: Vec3 } | null | undefined,
): VillageOrigin {
  const base = avatar?.position || camera?.position
  if (!base) return { ...VILLAGE_SPAWN }
  const candidates: Array<Vec3 | undefined> = [camera?.forward, avatar?.forward]
  for (const forward of candidates) {
    if (!forward) continue
    if (Math.hypot(forward[0], forward[2]) < 0.2) continue
    return { x: base[0], z: base[2], yaw: Math.atan2(forward[0], forward[2]) }
  }
  return { x: base[0], z: base[2], yaw: 0 }
}

export interface VillageLayoutOptions {
  origin?: { x: number; z: number; yaw: number }
  /** Plaza center distance in front of the spawn point. */
  plazaDistance?: number
  /** Radius of the first ring of desks around the plaza center. */
  radius?: number
  /** Extra radius per additional ring. */
  ringGap?: number
  /** Minimum distance between neighbouring desks on a ring. */
  spacing?: number
  /** Widest arc a ring may cover, in radians. */
  maxSpread?: number
}

export interface VillageStationLayout {
  /** Desk center on the ground (y = 0; callers add terrain height). */
  position: Vec3
  /** Yaw so the station's local +Z faces the plaza center (and the arriving player). */
  rotationY: number
  ring: number
  slot: number
}

const DEFAULTS = {
  plazaDistance: 4.5,
  radius: 6.5,
  ringGap: 4,
  spacing: 3.4,
  maxSpread: (200 * Math.PI) / 180,
}

export function plazaCenter(options: VillageLayoutOptions = {}): { x: number; z: number } {
  const origin = options.origin || VILLAGE_SPAWN
  const distance = options.plazaDistance ?? DEFAULTS.plazaDistance
  return { x: origin.x + Math.sin(origin.yaw) * distance, z: origin.z + Math.cos(origin.yaw) * distance }
}

/** How many desks fit on ring `ring` without crowding. */
export function ringCapacity(ring: number, options: VillageLayoutOptions = {}): number {
  const radius = (options.radius ?? DEFAULTS.radius) + ring * (options.ringGap ?? DEFAULTS.ringGap)
  const spacing = options.spacing ?? DEFAULTS.spacing
  const step = 2 * Math.asin(Math.min(1, spacing / 2 / radius))
  return Math.max(1, Math.floor((options.maxSpread ?? DEFAULTS.maxSpread) / step) + 1)
}

/**
 * Desks on arcs around a plaza in front of the spawn point, on the far side so the player
 * walks toward them. The first ring fills from the middle outward; extra agents go to wider rings.
 */
export function layoutVillageStations(count: number, options: VillageLayoutOptions = {}): VillageStationLayout[] {
  const origin = options.origin || VILLAGE_SPAWN
  const center = plazaCenter(options)
  const spacing = options.spacing ?? DEFAULTS.spacing
  const out: VillageStationLayout[] = []
  let remaining = Math.max(0, Math.floor(count))
  let ring = 0
  while (remaining > 0) {
    const radius = (options.radius ?? DEFAULTS.radius) + ring * (options.ringGap ?? DEFAULTS.ringGap)
    const step = 2 * Math.asin(Math.min(1, spacing / 2 / radius))
    const onRing = Math.min(remaining, ringCapacity(ring, options))
    for (let slot = 0; slot < onRing; slot += 1) {
      const angle = origin.yaw + (slot - (onRing - 1) / 2) * step
      const x = center.x + Math.sin(angle) * radius
      const z = center.z + Math.cos(angle) * radius
      out.push({ position: [x, 0, z], rotationY: Math.atan2(center.x - x, center.z - z), ring, slot })
    }
    remaining -= onRing
    ring += 1
  }
  return out
}

/** Station-local offsets (local +Z faces the plaza). */
export const STATION = {
  avatar: [0, 0, -0.55] as Vec3,
  label: [0, 2.12, -0.55] as Vec3,
  window: [0, 3.1, -0.95] as Vec3,
  /** Hit volume for clicks: encloses the desk and the avatar. */
  hitCenter: [0, 1.0, -0.12] as Vec3,
  hitSize: [2.0, 2.0, 1.5] as Vec3,
}

export function stationLocalToWorld(station: { position: Vec3; rotationY: number }, local: Vec3): Vec3 {
  const [lx, ly, lz] = local
  const c = Math.cos(station.rotationY)
  const s = Math.sin(station.rotationY)
  return [station.position[0] + lx * c + lz * s, station.position[1] + ly, station.position[2] - lx * s + lz * c]
}

/** Station forward (local +Z) and right (local +X) in world space. */
export function stationAxes(rotationY: number): { forward: Vec3; right: Vec3 } {
  return {
    forward: [Math.sin(rotationY), 0, Math.cos(rotationY)],
    right: [Math.cos(rotationY), 0, -Math.sin(rotationY)],
  }
}

export function findNearestStation(
  actor: Vec3 | null | undefined,
  anchors: Record<string, Vec3>,
  radius: number,
): string | null {
  if (!actor) return null
  let best: string | null = null
  let bestDistance = radius
  for (const [id, anchor] of Object.entries(anchors)) {
    const distance = Math.hypot(actor[0] - anchor[0], actor[2] - anchor[2])
    if (distance <= bestDistance) {
      best = id
      bestDistance = distance
    }
  }
  return best
}

// ─── bodies ─────────────────────────────────────────────────────────────────

export const ANORAK_PRO_AVATAR = '/avatars/gallery/UnicornPerson.vrm'

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

/**
 * Give every agent its own VRM. One loaded VRM scene can only be on screen once, so two agents
 * (or an agent and the player) must never share a URL. Assignment is stable per name and order.
 */
export function assignVillageAvatars(
  agents: Array<{ id: string; name: string }>,
  catalog: string[],
  exclude: Iterable<string> = [],
): Record<string, string> {
  const excluded = new Set(exclude)
  const pool = catalog.filter(path => !excluded.has(path))
  const taken = new Set<string>()
  const out: Record<string, string> = {}
  let duplicates = 0
  for (const agent of agents) {
    let pick: string | null = null
    if (/anorak/i.test(agent.name) && pool.includes(ANORAK_PRO_AVATAR) && !taken.has(ANORAK_PRO_AVATAR)) pick = ANORAK_PRO_AVATAR
    if (!pick && pool.length) {
      const start = hashString(agent.name || agent.id) % pool.length
      for (let i = 0; i < pool.length && !pick; i += 1) {
        const candidate = pool[(start + i) % pool.length]
        if (!taken.has(candidate)) pick = candidate
      }
    }
    if (!pick) {
      // More agents than bodies: reuse one under a distinct URL so the loader caches a second copy.
      const base = pool[hashString(agent.id) % Math.max(1, pool.length)] || catalog[0] || ''
      duplicates += 1
      pick = `${base}?copy=${duplicates}`
    }
    taken.add(pick)
    out[agent.id] = pick
  }
  return out
}

// ─── camera framing for the session view ────────────────────────────────────

export interface FocusFramingInput {
  /** Where the avatar stands (ground). */
  anchor: Vec3
  rotationY: number
  /** Vertical field of view in degrees. */
  fov: number
  aspect: number
  /** Where the 2D session panel covers the viewport. */
  panel: 'right' | 'bottom' | 'none'
  /** Fraction of the viewport width (right) or height (bottom) the panel covers. */
  panelFraction: number
  /** Size of the region to frame around the avatar. */
  subject?: { width: number; height: number; centerY: number }
}

export interface FocusPose {
  position: Vec3
  target: Vec3
}

/**
 * Camera pose that frames the avatar in the part of the screen the session panel leaves free
 * (left of a right-side panel on desktop, above a bottom sheet on phones).
 */
export function computeFocusPose(input: FocusFramingInput): FocusPose {
  const subject = input.subject || { width: 2.2, height: 2.3, centerY: 1.2 }
  const fraction = input.panel === 'none' ? 0 : Math.min(0.75, Math.max(0, input.panelFraction))
  const tanV = Math.tan(((input.fov || 50) * Math.PI) / 360)
  const tanH = tanV * Math.max(0.2, input.aspect || 1)
  const freeH = input.panel === 'right' ? 1 - fraction : 1
  const freeV = input.panel === 'bottom' ? 1 - fraction : 1
  const fill = 0.78
  const distance = Math.max(
    2.6,
    subject.height / 2 / (tanV * freeV) / fill,
    subject.width / 2 / (tanH * freeH) / fill,
  )
  // NDC center of the free area: left part for a right panel, upper part for a bottom sheet.
  const ndcX = input.panel === 'right' ? -fraction : 0
  const ndcY = input.panel === 'bottom' ? fraction : 0
  const { forward, right } = stationAxes(input.rotationY)
  const shiftRight = -ndcX * distance * tanH
  const shiftUp = -ndcY * distance * tanV
  // Look down a little, over the desk and monitor, at the avatar's face.
  const elevation = 0.95
  const target: Vec3 = [
    input.anchor[0] + right[0] * shiftRight,
    input.anchor[1] + subject.centerY + shiftUp,
    input.anchor[2] + right[2] * shiftRight,
  ]
  const position: Vec3 = [
    target[0] + forward[0] * distance,
    target[1] + elevation,
    target[2] + forward[2] * distance,
  ]
  return { position, target }
}

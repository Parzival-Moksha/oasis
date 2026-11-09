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
 * Where the village stands in a world: fixed, so desks are where you left them after a reload,
 * wherever the camera happens to look. A world may say where (`village: {x, z, yaw}`); otherwise
 * the plaza opens in front of the spawn point.
 *
 * TODO: no world carries `village` yet. WorldState is rebuilt field by field on every save
 * (oasisStore.ts: three saveWorld calls + the loader), so the field has to be threaded there first.
 */
export function resolveVillageOrigin(worldVillage?: Partial<VillageOrigin> | null): VillageOrigin {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  if (worldVillage && finite(worldVillage.x) && finite(worldVillage.z)) {
    return { x: worldVillage.x, z: worldVillage.z, yaw: finite(worldVillage.yaw) ? worldVillage.yaw : 0 }
  }
  return { ...VILLAGE_SPAWN }
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
 * Desk number `seat` on arcs around a plaza in front of the village origin, on the far side so the
 * player walks toward them. Seat 0 is straight ahead, then the ring fills alternately to either side
 * (0, +1, -1, +2, -2 ...); full rings spill into wider ones. A seat's place never depends on how many
 * other seats are taken, so an arrival or a departure moves nobody.
 */
export function villageSeatStation(seat: number, options: VillageLayoutOptions = {}): VillageStationLayout {
  const origin = options.origin || VILLAGE_SPAWN
  const center = plazaCenter(options)
  const spacing = options.spacing ?? DEFAULTS.spacing
  let slot = Math.max(0, Math.floor(seat))
  let ring = 0
  while (slot >= ringCapacity(ring, options)) {
    slot -= ringCapacity(ring, options)
    ring += 1
  }
  const radius = (options.radius ?? DEFAULTS.radius) + ring * (options.ringGap ?? DEFAULTS.ringGap)
  const step = 2 * Math.asin(Math.min(1, spacing / 2 / radius))
  const offset = slot % 2 === 1 ? (slot + 1) / 2 : -slot / 2
  const angle = origin.yaw + offset * step
  const x = center.x + Math.sin(angle) * radius
  const z = center.z + Math.cos(angle) * radius
  return { position: [x, 0, z], rotationY: Math.atan2(center.x - x, center.z - z), ring, slot }
}

/** Seats 0 .. count-1. */
export function layoutVillageStations(count: number, options: VillageLayoutOptions = {}): VillageStationLayout[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, seat) => villageSeatStation(seat, options))
}

// ─── memory: each agent keeps its desk and its body ─────────────────────────

/** What the village remembers per agent: its desk number and its body (a base VRM path). */
export interface VillageMemoryEntry {
  seat?: number
  skin?: string
  /** Last time this agent was in the village (ms). */
  seenAt: number
}
export type VillageMemory = Record<string, VillageMemoryEntry>

export interface VillageRosterAgent {
  id: string
  name: string
  sessionId?: string | null
}

/** A seat held by an agent that left stays its own this long, so it gets its desk back when it returns. */
export const VILLAGE_SEAT_HOLD_MS = 3 * 24 * 3600 * 1000
/** Bodies are remembered longer: keeping a face is cheap, a seat gap is not. */
export const VILLAGE_MEMORY_KEEP_MS = 60 * 24 * 3600 * 1000
const VILLAGE_MEMORY_MAX = 300

/** The session is the agent (an observer moved here, a resumed one); brand-new agents go by id until they have one. */
export function villageAgentKey(agent: { id: string; sessionId?: string | null }): string {
  return agent.sessionId || agent.id
}

/**
 * Bring the memory up to date with who is here: move an agent's entry from its id to its session once
 * it has one, stamp everyone present as seen, forget long-gone agents.
 */
export function rememberVillageAgents(agents: VillageRosterAgent[], memory: VillageMemory, now: number): VillageMemory {
  const next: VillageMemory = { ...memory }
  for (const agent of agents) {
    if (!agent.sessionId || agent.sessionId === agent.id) continue
    const byId = next[agent.id]
    if (!byId) continue
    if (!next[agent.sessionId]) next[agent.sessionId] = byId
    delete next[agent.id]
  }
  const present = new Set(agents.map(villageAgentKey))
  for (const key of present) next[key] = { ...next[key], seenAt: now }
  for (const [key, entry] of Object.entries(next)) {
    if (!present.has(key) && !(now - (entry.seenAt || 0) < VILLAGE_MEMORY_KEEP_MS)) delete next[key]
  }
  const keys = Object.keys(next)
  if (keys.length > VILLAGE_MEMORY_MAX) {
    keys
      .filter(key => !present.has(key))
      .sort((a, b) => (next[a].seenAt || 0) - (next[b].seenAt || 0))
      .slice(0, keys.length - VILLAGE_MEMORY_MAX)
      .forEach(key => { delete next[key] })
  }
  return next
}

/**
 * A desk per agent. Agents keep the seat they had; a newcomer takes the lowest seat nobody here sits
 * in and nobody who left recently holds. Two agents on one session (a moment during "Move it here"):
 * the first keeps the seat, the second sits elsewhere until the first is gone. Call after
 * rememberVillageAgents (it reads `seenAt`).
 */
export function assignVillageSeats(
  agents: VillageRosterAgent[],
  memory: VillageMemory,
  now: number,
): { seats: Record<string, number>; memory: VillageMemory } {
  const next: VillageMemory = { ...memory }
  const present = new Set(agents.map(villageAgentKey))
  const seats: Record<string, number> = {}
  const occupied = new Set<number>()
  const seatedKeys = new Set<string>()
  for (const agent of agents) {
    const key = villageAgentKey(agent)
    const seat = next[key]?.seat
    if (seatedKeys.has(key) || typeof seat !== 'number' || occupied.has(seat)) continue
    seats[agent.id] = seat
    occupied.add(seat)
    seatedKeys.add(key)
  }
  const held = new Set<number>()
  for (const [key, entry] of Object.entries(next)) {
    if (!present.has(key) && typeof entry.seat === 'number' && now - (entry.seenAt || 0) < VILLAGE_SEAT_HOLD_MS) held.add(entry.seat)
  }
  let cursor = 0
  for (const agent of agents) {
    if (agent.id in seats) continue
    while (occupied.has(cursor) || held.has(cursor)) cursor += 1
    seats[agent.id] = cursor
    occupied.add(cursor)
    const key = villageAgentKey(agent)
    // The second agent on a session borrows a seat; the session's own seat stays with the first.
    if (!seatedKeys.has(key)) {
      next[key] = { ...next[key], seat: cursor, seenAt: next[key]?.seenAt ?? now }
      seatedKeys.add(key)
    }
  }
  return { seats, memory: next }
}

/** Station-local offsets (local +Z faces the plaza). */
export const STATION = {
  avatar: [0, 0, -0.55] as Vec3,
  label: [0, 2.12, -0.55] as Vec3,
  /** Center of the desk window (its bottom edge clears the status sign over the agent's head). */
  window: [0, 3.3, -0.95] as Vec3,
  /** Hit volume for clicks: encloses the desk and the avatar. */
  hitCenter: [0, 1.0, -0.12] as Vec3,
  hitSize: [2.0, 2.0, 1.5] as Vec3,
}

/**
 * The desk window, a glass screen above each agent. Both modes cover the same patch of world
 * (DESK_WINDOW_WORLD meters); the zoomed-in screen (F) just packs more pixels into it, so the
 * camera can fill the view with it and the text stays sharp.
 */
export const DESK_WINDOW_WORLD = { width: 2.7, height: 1.78 }
/** At the desk the window leans back a little, like a monitor on a stand, toward someone walking up. */
export const DESK_WINDOW_TILT = 0.2
export const DESK_WINDOW_PX = {
  desk: { width: 760, height: 500 },
  screen: { width: 1140, height: 750 },
}
/** drei <Html transform>: one CSS pixel spans distanceFactor / 400 meters. */
export function deskWindowDistanceFactor(mode: keyof typeof DESK_WINDOW_PX): number {
  return (DESK_WINDOW_WORLD.width * 400) / DESK_WINDOW_PX[mode].width
}

export interface ScreenFramingInput {
  /** World center of the window. */
  center: Vec3
  /** Station yaw; the window faces the station's forward (+Z local). */
  rotationY: number
  fov: number
  aspect: number
  /** Share of the view the window should fill (0..1, default SCREEN_FILL). */
  fill?: number
}

/** Camera square in front of the desk window, close enough that it fills the view. */
/** The F screen fills this much of the view: 4% margins each side (the owner: "half the margins" of the old 0.84). */
export const SCREEN_FILL = 0.92

export function computeScreenPose(input: ScreenFramingInput): FocusPose {
  const fill = Math.min(1, Math.max(0.3, input.fill ?? SCREEN_FILL))
  const tanV = Math.tan(((input.fov || 50) * Math.PI) / 360)
  const tanH = tanV * Math.max(0.2, input.aspect || 1)
  const distance = Math.max(
    DESK_WINDOW_WORLD.height / 2 / tanV / fill,
    DESK_WINDOW_WORLD.width / 2 / tanH / fill,
  )
  const { forward } = stationAxes(input.rotationY)
  const target: Vec3 = [...input.center]
  const position: Vec3 = [
    input.center[0] + forward[0] * distance,
    input.center[1],
    input.center[2] + forward[2] * distance,
  ]
  return { position, target }
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
  /** Ignore stations this far above / below the actor (a noclip camera flying over the village). */
  maxHeightDelta = Infinity,
): string | null {
  if (!actor) return null
  let best: string | null = null
  let bestDistance = radius
  for (const [id, anchor] of Object.entries(anchors)) {
    if (Math.abs(actor[1] - anchor[1]) > maxHeightDelta) continue
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
 * Give every agent a body and let it keep that body: once picked, the skin is remembered per session,
 * so switching worlds or putting on another avatar never re-dresses the village. A newcomer gets a
 * body nobody here wears (the player's and the world's included); the first Anorak gets UnicornPerson.
 * One loaded VRM scene can only be on screen once, so when two agents, or an agent and the player,
 * wear the same body, the later one gets its own `?copy=` URL (a second cache entry in the loader).
 */
export function assignVillageAvatars(
  agents: VillageRosterAgent[],
  catalog: string[],
  exclude: Iterable<string> = [],
  memory: VillageMemory = {},
  now = 0,
): { avatars: Record<string, string>; memory: VillageMemory } {
  const next: VillageMemory = { ...memory }
  const excluded = new Set(exclude)
  const known = new Set(catalog)
  const bases: Record<string, string> = {}
  const worn = new Set<string>()
  // Remembered bodies first, so a newcomer never takes one from an agent that already wears it.
  for (const agent of agents) {
    const skin = next[villageAgentKey(agent)]?.skin
    if (skin && known.has(skin)) {
      bases[agent.id] = skin
      worn.add(skin)
    }
  }
  const pool = catalog.filter(path => !excluded.has(path) && path !== ANORAK_PRO_AVATAR)
  for (const agent of agents) {
    if (bases[agent.id]) continue
    let pick: string | null = null
    if (/anorak/i.test(agent.name) && known.has(ANORAK_PRO_AVATAR) && !worn.has(ANORAK_PRO_AVATAR)) pick = ANORAK_PRO_AVATAR
    if (!pick && pool.length) {
      const start = hashString(agent.name || agent.id) % pool.length
      for (let i = 0; i < pool.length && !pick; i += 1) {
        const candidate = pool[(start + i) % pool.length]
        if (!worn.has(candidate)) pick = candidate
      }
    }
    // More agents than bodies: share one (it gets its own URL below).
    if (!pick) pick = pool[hashString(agent.id) % Math.max(1, pool.length)] || catalog[0] || ''
    bases[agent.id] = pick
    worn.add(pick)
    const key = villageAgentKey(agent)
    if (pick) next[key] = { ...next[key], skin: pick, seenAt: next[key]?.seenAt ?? now }
  }
  // URLs: the first wearer of a body gets it plain, later ones (and anyone in the player's) a copy.
  // The copy number comes from the agent's key, so it doesn't shift when others come and go.
  const avatars: Record<string, string> = {}
  const used = new Set<string>()
  for (const agent of agents) {
    const base = bases[agent.id]
    let url = base
    if (excluded.has(base) || used.has(base)) {
      let copy = (hashString(villageAgentKey(agent)) % 9000) + 1
      while (used.has(`${base}?copy=${copy}`)) copy += 1
      url = `${base}?copy=${copy}`
    }
    used.add(url)
    used.add(base)
    avatars[agent.id] = url
  }
  return { avatars, memory: next }
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

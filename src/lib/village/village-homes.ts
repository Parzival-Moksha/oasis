// ░▒▓ VILLAGE HOMES — each agent's own place in a world, instead of a desk on the ring ▓▒░
// The owner (2026-11-19): "change the paradigm from every agent standing next to their desk to basically every
// agent building their own little part of the Oasis… one by one, we would send the agents to different places."
// An agent with a home in a world stands there, facing its way, with no desk (its screen and its marker stay);
// without one it keeps its seat on the ring. Homes are kept on the page server (data/village-homes.local.json,
// /api/village/homes), so they outlive reloads, engine restarts and other browsers. The owner sets one from the
// agent's settings menu; an agent sets its own with `me.mjs home`, which leaves a request the open page answers
// (only the page knows the world it shows and where the agent stands). Pure, so it can be tested.

export interface VillageHome {
  x: number
  z: number
  /** Facing: 0 = +Z, like a station's rotationY. */
  yaw: number
  by: 'owner' | 'agent'
  at: number
}

/** worldId -> agent key (its session id, else its agent id: villageAgentKey) -> home. */
export type HomesByWorld = Record<string, Record<string, VillageHome>>

/** Left by `me.mjs home …` for the open page: `here` (where the agent stands), `at` (x, z), `clear`. */
export interface HomeRequest {
  id: string
  agentKey: string
  agentId: string | null
  kind: 'here' | 'at' | 'clear'
  x?: number
  z?: number
  at: number
}

export interface HomesFile {
  v: 1
  /** Goes up with every change: the page asks for news with it. */
  version: number
  homes: HomesByWorld
  requests: HomeRequest[]
  /** What became of answered requests (the last few), so `me.mjs` can say what happened. */
  done: Array<{ id: string; ok: boolean; note: string; world?: string; at: number }>
  /**
   * The village's world: agents with no other place live here (village-worlds.ts). null: not chosen yet, and
   * then such agents are in every world, as before 2026-11-20. "Move the village here" sets it.
   */
  villageWorld: string | null
  /** Agents the owner called into a world ("Call here"), by agent key, until sent home. */
  calls: Record<string, string>
}

/** The ground an agent may build on around its home, and how much. Told to the agent in its card. */
export const HOME = { buildRadius: 8, objects: 40, lights: 2, requestTtlMs: 60 * 60_000, maxRequests: 50, maxDone: 30 } as const

export const EMPTY_HOMES: HomesFile = { v: 1, version: 0, homes: {}, requests: [], done: [], villageWorld: null, calls: {} }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const LIMIT = 5000

export function cleanHome(raw: unknown): VillageHome | null {
  const h = raw as Partial<VillageHome> | null
  if (!h || !finite(h.x) || !finite(h.z) || Math.abs(h.x) > LIMIT || Math.abs(h.z) > LIMIT) return null
  return {
    x: Math.round(h.x * 100) / 100,
    z: Math.round(h.z * 100) / 100,
    yaw: finite(h.yaw) ? Math.round(h.yaw * 1000) / 1000 : 0,
    by: h.by === 'agent' ? 'agent' : 'owner',
    at: finite(h.at) ? h.at : Date.now(),
  }
}

const KEY = /^[\w.:-]{1,120}$/

export function isHomeKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value)
}

/** A file as read from disk (or sent by a client), with anything malformed dropped. */
export function parseHomesFile(raw: unknown, now = Date.now()): HomesFile {
  const f = raw as Partial<HomesFile> | null
  if (!f || typeof f !== 'object') return { ...EMPTY_HOMES, homes: {}, requests: [], done: [], calls: {} }
  const homes: HomesByWorld = {}
  for (const [world, byAgent] of Object.entries(f.homes || {})) {
    if (!isHomeKey(world) || !byAgent || typeof byAgent !== 'object') continue
    for (const [key, home] of Object.entries(byAgent)) {
      const clean = isHomeKey(key) ? cleanHome(home) : null
      if (clean) (homes[world] ||= {})[key] = clean
    }
  }
  const requests = (Array.isArray(f.requests) ? f.requests : [])
    .filter((r): r is HomeRequest => Boolean(r) && isHomeKey(r.id) && isHomeKey(r.agentKey) && (r.kind === 'here' || r.kind === 'at' || r.kind === 'clear') && finite(r.at) && now - r.at < HOME.requestTtlMs)
    .filter(r => r.kind !== 'at' || (finite(r.x) && finite(r.z)))
    .slice(-HOME.maxRequests)
  const done = (Array.isArray(f.done) ? f.done : []).filter(d => d && isHomeKey(d.id) && finite(d.at)).slice(-HOME.maxDone)
  const calls: Record<string, string> = {}
  for (const [key, world] of Object.entries(f.calls || {})) if (isHomeKey(key) && isHomeKey(world)) calls[key] = world
  return { v: 1, version: finite(f.version) ? f.version : 0, homes, requests, done, villageWorld: isHomeKey(f.villageWorld) ? f.villageWorld : null, calls }
}

export function homeOf(file: HomesFile | null, world: string | null | undefined, key: string | null | undefined): VillageHome | null {
  if (!file || !world || !key) return null
  return file.homes[world]?.[key] ?? null
}

/** The file with this agent's home in this world set (or cleared, with null). */
export function withHome(file: HomesFile, world: string, key: string, home: VillageHome | null): HomesFile {
  const homes: HomesByWorld = { ...file.homes, [world]: { ...(file.homes[world] || {}) } }
  if (home) homes[world][key] = home
  else delete homes[world][key]
  if (!Object.keys(homes[world]).length) delete homes[world]
  return { ...file, version: file.version + 1, homes }
}

export function withRequest(file: HomesFile, request: HomeRequest): HomesFile {
  return { ...file, version: file.version + 1, requests: [...file.requests.filter(r => r.agentKey !== request.agentKey), request].slice(-HOME.maxRequests) }
}

/** The request answered by a page: gone from the list, its outcome kept for `me.mjs`. */
export function withAnswer(file: HomesFile, id: string, outcome: { ok: boolean; note: string; world?: string }, now = Date.now()): HomesFile {
  return {
    ...file,
    version: file.version + 1,
    requests: file.requests.filter(r => r.id !== id),
    done: [...file.done.filter(d => d.id !== id), { id, ...outcome, at: now }].slice(-HOME.maxDone),
  }
}

/** The village's world (null: none chosen). */
export function withVillageWorld(file: HomesFile, world: string | null): HomesFile {
  return { ...file, version: file.version + 1, villageWorld: world }
}

/** An agent called into a world (null: sent home). */
export function withCall(file: HomesFile, key: string, world: string | null): HomesFile {
  const calls = { ...file.calls }
  if (world) calls[key] = world
  else delete calls[key]
  return { ...file, version: file.version + 1, calls }
}

/** The worlds where an agent has a home spot. */
export function homeSpotWorlds(file: HomesFile, key: string): string[] {
  return Object.keys(file.homes).filter(world => Boolean(file.homes[world]?.[key]))
}

/** Facing from a spot toward a point (the plaza), as a station's rotationY. */
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  return Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz)
}

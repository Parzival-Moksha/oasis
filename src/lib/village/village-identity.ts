// ░▒▓ VILLAGE IDENTITY — who each agent is, one copy on this PC for every browser and app window ▓▒░
// The owner (2026-11-20): "i opened oasis PWA… now all the agents have new, seemingly arbitrary avatars… that needs
// a refactor so that the oasis characters remain the same across browsers." Until then each browser kept its own
// copy in localStorage (Brave's tab and Chrome's app window are separate stores), and a page with an empty one dealt
// fresh bodies and voices and told the engine about them.
//
// Now one file on this PC, data/village-identity.local.json, served by the page server (/api/village/identity,
// village-identity-server.ts), holds per agent (its session key, villageAgentKey): seat, body (skin), voice and
// speed, name-tag colour (accent), come-to-me and follow-me, home world; and the village-wide settings that belong to
// the world and not to a screen (name-tag style, village looks). Pages read it before they place anyone
// (village-identity-client.ts) and write through it.
//
// Two strengths of write, so two pages never take each other's agents apart:
//   set       the owner's (or an agent's) choice: it replaces what is there.
//   ifAbsent  what a page deals by itself (a free seat, a body, a voice): kept only if the agent has none yet.
// Pure, no I/O; tested in src/lib/__tests__/village-identity.test.ts.

export interface IdentityAgent {
  seat?: number
  /** Avatar path (/avatars/gallery/….vrm). */
  skin?: string
  /** The owner chose the body (agent panel → Avatar). */
  skinPicked?: boolean
  /** Last time a page saw this agent in the village (ms); kept roughly (pages send it at most every few minutes). */
  seenAt?: number
  /** A VILLAGE_VOICES key. */
  voice?: string
  voicePicked?: boolean
  speed?: number
  /** Name-tag / panel colour, #rrggbb. */
  accent?: string
  /** Walks up to the owner when it needs them (absent: the default, on). */
  come?: boolean
  /** Follows the owner (absent: the default for its name). */
  follow?: boolean
  /** The world it lives in (a world id); absent or null: the default village world. Companion's homes (village-worlds.ts). */
  homeWorld?: string | null
  /** Follow across worlds: it is in whatever world the owner is in. Absent: the page's default (on for Anorak, off for the rest). */
  followWorlds?: boolean
}

export interface IdentitySettings {
  /** tag-style.ts TagSettings. */
  tagStyle?: Record<string, unknown>
  /** village-looks.ts VillageLooks. */
  looks?: Record<string, unknown>
}

export interface IdentityFile {
  version: number
  updatedAt: number
  agents: Record<string, IdentityAgent>
  settings: IdentitySettings
}

type Fields = { [K in keyof IdentityAgent]?: IdentityAgent[K] | null }

export interface IdentityOp {
  /** The agent's session key (or its agent id before it has a session). */
  agent: string
  set?: Fields
  ifAbsent?: Fields
  /** Forget this key (its entry moved from the agent id to the session id). */
  remove?: boolean
}

export interface IdentityPatch {
  ops?: IdentityOp[]
  settings?: { [K in keyof IdentitySettings]?: IdentitySettings[K] | null }
}

export const EMPTY_IDENTITY: IdentityFile = { version: 0, updatedAt: 0, agents: {}, settings: {} }
/** Agents not seen this long are forgotten (village-layout VILLAGE_MEMORY_KEEP_MS). */
export const IDENTITY_KEEP_MS = 60 * 24 * 3600 * 1000
export const IDENTITY_MAX_AGENTS = 400
/** A page sends `seenAt` only when it moved on this much: no write per frame. */
export const SEEN_EVERY_MS = 10 * 60 * 1000

const KEY = /^[\w.:-]{1,120}$/
export function isIdentityKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value)
}

const FIELDS = ['seat', 'skin', 'skinPicked', 'seenAt', 'voice', 'voicePicked', 'speed', 'accent', 'come', 'follow', 'homeWorld', 'followWorlds'] as const
type FieldName = typeof FIELDS[number]
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A field's value cleaned, `null` to clear it, or `undefined` when it is not acceptable (ignored). */
export function cleanField(name: FieldName, value: unknown): unknown {
  if (value === null) return null
  switch (name) {
    case 'seat': return finite(value) && value >= 0 && value < 1000 ? Math.round(value) : undefined
    case 'skin': return typeof value === 'string' && value.length > 0 && value.length <= 400 && /^(\/|https?:\/\/)/.test(value) ? value : undefined
    case 'seenAt': return finite(value) && value > 0 ? Math.round(value) : undefined
    case 'voice': return typeof value === 'string' && /^[\w-]{1,40}$/.test(value) ? value : undefined
    case 'speed': return finite(value) && value >= 0.3 && value <= 4 ? Math.round(value * 100) / 100 : undefined
    case 'accent': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined
    case 'homeWorld': return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
    case 'skinPicked': case 'voicePicked': case 'come': case 'follow': case 'followWorlds': return typeof value === 'boolean' ? value : undefined
  }
}

function cleanFields(raw: unknown): Fields {
  const out: Fields = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const name of FIELDS) {
    if (!(name in (raw as object))) continue
    const value = cleanField(name, (raw as Record<string, unknown>)[name])
    if (value !== undefined) (out as Record<string, unknown>)[name] = value
  }
  return out
}

function cleanAgent(raw: unknown): IdentityAgent | null {
  const fields = cleanFields(raw)
  const agent: IdentityAgent = {}
  for (const [k, v] of Object.entries(fields)) if (v !== null) (agent as Record<string, unknown>)[k] = v
  return Object.keys(agent).length ? agent : null
}

const SETTINGS = ['tagStyle', 'looks'] as const
function cleanSetting(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const text = JSON.stringify(value)
  return text.length <= 2000 ? (JSON.parse(text) as Record<string, unknown>) : undefined
}

/** A file as read from disk, anything malformed dropped. */
export function parseIdentityFile(raw: unknown): IdentityFile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const agents: Record<string, IdentityAgent> = {}
  if (r.agents && typeof r.agents === 'object' && !Array.isArray(r.agents)) {
    for (const [key, value] of Object.entries(r.agents as Record<string, unknown>)) {
      const agent = isIdentityKey(key) ? cleanAgent(value) : null
      if (agent) agents[key] = agent
    }
  }
  const settings: IdentitySettings = {}
  const rs = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>
  for (const name of SETTINGS) {
    const value = cleanSetting(rs[name])
    if (value) settings[name] = value
  }
  return { version: finite(r.version) ? r.version : 0, updatedAt: finite(r.updatedAt) ? r.updatedAt : 0, agents, settings }
}

/**
 * A request body as a patch. Besides `{ ops, settings }`, the short form `{ agent, <field>: value, … }` sets those
 * fields of one agent (Companion: `{ agent, homeWorld }`).
 */
export function parseIdentityPatch(raw: unknown): IdentityPatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const ops: IdentityOp[] = []
  if (Array.isArray(r.ops)) {
    for (const item of r.ops.slice(0, 500)) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (!isIdentityKey(o.agent)) continue
      const op: IdentityOp = { agent: o.agent }
      if (o.remove === true) op.remove = true
      const set = cleanFields(o.set)
      const ifAbsent = cleanFields(o.ifAbsent)
      if (Object.keys(set).length) op.set = set
      if (Object.keys(ifAbsent).length) op.ifAbsent = ifAbsent
      if (op.remove || op.set || op.ifAbsent) ops.push(op)
    }
  } else if (isIdentityKey(r.agent)) {
    const set = cleanFields(r)
    if (Object.keys(set).length) ops.push({ agent: r.agent, set })
  }
  const settings: IdentityPatch['settings'] = {}
  if (r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings)) {
    for (const name of SETTINGS) {
      if (!(name in (r.settings as object))) continue
      const value = cleanSetting((r.settings as Record<string, unknown>)[name])
      if (value !== undefined) settings[name] = value
    }
  }
  if (!ops.length && !Object.keys(settings).length) return null
  return { ops, settings }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The file with a patch applied; the same object when nothing changed (no new version, no write). */
export function applyIdentityPatch(file: IdentityFile, patch: IdentityPatch, now: number): IdentityFile {
  const agents = { ...file.agents }
  for (const op of patch.ops || []) {
    if (op.remove) delete agents[op.agent]
    if (!op.set && !op.ifAbsent) continue
    const entry: Record<string, unknown> = { ...agents[op.agent] }
    for (const [k, v] of Object.entries(op.ifAbsent || {})) {
      if (v !== null && v !== undefined && entry[k] === undefined) entry[k] = v
    }
    for (const [k, v] of Object.entries(op.set || {})) {
      if (v === null || v === undefined) delete entry[k]
      else if (k === 'seenAt') entry[k] = Math.max(Number(entry[k]) || 0, v as number)
      else entry[k] = v
    }
    if (Object.keys(entry).length) agents[op.agent] = entry as IdentityAgent
    else delete agents[op.agent]
  }
  // Long-gone agents are forgotten; a picked body or a home world is not a reason to keep one forever.
  for (const [key, entry] of Object.entries(agents)) {
    if (entry.seenAt && now - entry.seenAt > IDENTITY_KEEP_MS) delete agents[key]
  }
  const keys = Object.keys(agents)
  if (keys.length > IDENTITY_MAX_AGENTS) {
    keys.sort((a, b) => (agents[a].seenAt || 0) - (agents[b].seenAt || 0))
      .slice(0, keys.length - IDENTITY_MAX_AGENTS)
      .forEach(key => { delete agents[key] })
  }
  const settings: IdentitySettings = { ...file.settings }
  for (const [k, v] of Object.entries(patch.settings || {})) {
    const name = k as keyof IdentitySettings
    if (v === null) delete settings[name]
    else if (v) settings[name] = { ...(settings[name] || {}), ...v }
  }
  if (same(agents, file.agents) && same(settings, file.settings)) return file
  return { version: file.version + 1, updatedAt: now, agents, settings }
}

// ─── the shapes the page's modules already use ───────────────────────────────

export interface MemoryEntryShape { seat?: number; skin?: string; picked?: boolean; seenAt: number }
export interface VoiceEntryShape { voice?: string; picked?: boolean; speed?: number }

/** village-memory.ts VillageMemory: agents with a seat or a body. */
export function memoryFromIdentity(file: IdentityFile): Record<string, MemoryEntryShape> {
  const out: Record<string, MemoryEntryShape> = {}
  for (const [key, a] of Object.entries(file.agents)) {
    if (a.seat === undefined && !a.skin) continue
    out[key] = {
      ...(a.seat !== undefined ? { seat: a.seat } : {}),
      ...(a.skin ? { skin: a.skin } : {}),
      ...(a.skin && a.skinPicked ? { picked: true } : {}),
      seenAt: a.seenAt || 0,
    }
  }
  return out
}

/** village-voices.ts VoicePrefs. */
export function voicesFromIdentity(file: IdentityFile): Record<string, VoiceEntryShape> {
  const out: Record<string, VoiceEntryShape> = {}
  for (const [key, a] of Object.entries(file.agents)) {
    if (!a.voice && a.speed === undefined) continue
    out[key] = {
      ...(a.voice ? { voice: a.voice } : {}),
      ...(a.voice && a.voicePicked ? { picked: true } : {}),
      ...(a.speed !== undefined ? { speed: a.speed } : {}),
    }
  }
  return out
}

/** One field of every agent that has it: accent colours, come and follow choices. */
export function fieldMap<K extends 'accent' | 'come' | 'follow'>(file: IdentityFile, field: K): Record<string, NonNullable<IdentityAgent[K]>> {
  const out: Record<string, NonNullable<IdentityAgent[K]>> = {}
  for (const [key, a] of Object.entries(file.agents)) {
    const value = a[field]
    if (value !== undefined && value !== null) out[key] = value as NonNullable<IdentityAgent[K]>
  }
  return out
}

/** Seats and bodies only (what the owner sees), not `seenAt`. */
export function sameLooks(a: Record<string, MemoryEntryShape>, b: Record<string, MemoryEntryShape>): boolean {
  const strip = (m: Record<string, MemoryEntryShape>) => Object.keys(m).sort().map(k => [k, m[k].seat, m[k].skin, Boolean(m[k].picked)])
  return same(strip(a), strip(b))
}

/**
 * What a change of the page's village memory means for the store. A body the owner picked is `set`; a seat or a
 * body the page dealt is `ifAbsent`; `seenAt` goes when it moved on SEEN_EVERY_MS past the store's. An entry that
 * left the memory is removed from the store only when it was under an agent id (it moved to the session id).
 */
export function memoryOps(prev: Record<string, MemoryEntryShape>, next: Record<string, MemoryEntryShape>, stored: Record<string, IdentityAgent>): IdentityOp[] {
  const ops: IdentityOp[] = []
  for (const [key, n] of Object.entries(next)) {
    if (!isIdentityKey(key)) continue
    const p = prev[key]
    const set: Fields = {}
    const ifAbsent: Fields = {}
    if (n.picked && n.skin && (!p?.picked || p.skin !== n.skin)) {
      set.skin = n.skin
      set.skinPicked = true
    } else if (!n.picked && p?.picked) {
      set.skinPicked = null
      set.skin = n.skin ?? null
    } else if (n.skin && n.skin !== p?.skin) {
      ifAbsent.skin = n.skin
    }
    if (typeof n.seat === 'number' && n.seat !== p?.seat) ifAbsent.seat = n.seat
    if (n.seenAt && n.seenAt - (stored[key]?.seenAt || 0) >= SEEN_EVERY_MS) set.seenAt = n.seenAt
    const op: IdentityOp = { agent: key }
    if (Object.keys(set).length) op.set = set
    if (Object.keys(ifAbsent).length) op.ifAbsent = ifAbsent
    if (op.set || op.ifAbsent) ops.push(op)
  }
  for (const key of Object.keys(prev)) {
    if (!(key in next) && /^agent-/.test(key) && isIdentityKey(key)) ops.push({ agent: key, remove: true })
  }
  return ops
}

/** The same for voices: a picked voice and any speed are `set`; a dealt voice is `ifAbsent`. */
export function voiceOps(prev: Record<string, VoiceEntryShape>, next: Record<string, VoiceEntryShape>): IdentityOp[] {
  const ops: IdentityOp[] = []
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (!isIdentityKey(key)) continue
    const p = prev[key]
    const n = next[key]
    const set: Fields = {}
    const ifAbsent: Fields = {}
    if (!n) {
      if (p) { set.voice = null; set.voicePicked = null; set.speed = null }
    } else {
      if (n.picked && n.voice && (!p?.picked || p.voice !== n.voice)) {
        set.voice = n.voice
        set.voicePicked = true
      } else if (!n.picked && p?.picked) {
        set.voicePicked = null
        set.voice = n.voice ?? null
      } else if (n.voice && n.voice !== p?.voice) {
        ifAbsent.voice = n.voice
      } else if (!n.voice && p?.voice) {
        set.voice = null
      }
      if ((n.speed ?? null) !== (p?.speed ?? null)) set.speed = n.speed ?? null
    }
    const op: IdentityOp = { agent: key }
    if (Object.keys(set).length) op.set = set
    if (Object.keys(ifAbsent).length) op.ifAbsent = ifAbsent
    if (op.set || op.ifAbsent) ops.push(op)
  }
  return ops
}

/** A browser's old localStorage values (keys of the Oasis's village) as a patch, every field `ifAbsent`. */
export function importOps(local: {
  memory?: Record<string, Partial<MemoryEntryShape>> | null
  voices?: Record<string, VoiceEntryShape> | null
  accent?: Record<string, string> | null
  come?: Record<string, boolean> | null
  follow?: Record<string, boolean> | null
}): IdentityOp[] {
  const byKey = new Map<string, Fields>()
  const put = (key: string, fields: Fields) => {
    if (!isIdentityKey(key)) return
    byKey.set(key, { ...byKey.get(key), ...fields })
  }
  for (const [key, m] of Object.entries(local.memory || {})) {
    put(key, { seat: m?.seat, skin: m?.skin, skinPicked: m?.picked && m?.skin ? true : undefined, seenAt: m?.seenAt })
  }
  for (const [key, v] of Object.entries(local.voices || {})) put(key, { voice: v?.voice, voicePicked: v?.picked && v?.voice ? true : undefined, speed: v?.speed })
  for (const [key, c] of Object.entries(local.accent || {})) put(key, { accent: c })
  for (const [key, c] of Object.entries(local.come || {})) put(key, { come: c })
  for (const [key, c] of Object.entries(local.follow || {})) put(key, { follow: c })
  const ops: IdentityOp[] = []
  for (const [agent, fields] of byKey) {
    const clean = cleanFields(fields)
    for (const k of Object.keys(clean)) if ((clean as Record<string, unknown>)[k] === null) delete (clean as Record<string, unknown>)[k]
    if (Object.keys(clean).length) ops.push({ agent, ifAbsent: clean })
  }
  return ops
}

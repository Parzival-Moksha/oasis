// ░▒▓ VILLAGE COMBAT — shoot the village's agents for fun: HP, knockdown, respawn ▓▒░
// Purely cosmetic and local to this tab. A "dead" agent only falls over and gets up again a few
// seconds later; its Claude Code process is never touched (no engine command is ever sent from here).

export const VILLAGE_AGENT_MAX_HP = 100
export const VILLAGE_BOLT_DAMAGE = 25
/** How long a knocked-out agent stays down before it gets back up with full HP. */
export const VILLAGE_DOWN_MS = 6000
/** How long the hit flinch (knockback animation) lasts. */
export const VILLAGE_FLINCH_MS = 900
/** HP comes back on its own after this long without a hit. */
export const VILLAGE_REGEN_AFTER_MS = 20000

export interface VillageVitals {
  hp: number
  /** When it went down (ms), or null while standing. */
  downAt: number | null
  lastHitAt: number | null
  /** Recent damage numbers to float above it. */
  hits: Array<{ id: number; amount: number; at: number; lethal: boolean }>
  seq: number
}

export const FULL_VITALS: VillageVitals = { hp: VILLAGE_AGENT_MAX_HP, downAt: null, lastHitAt: null, hits: [], seq: 0 }

/** Where an agent stands at time `now`: knocked-out agents get up, untouched ones heal. */
export function vitalsAt(v: VillageVitals, now: number): VillageVitals {
  if (v.downAt !== null && now - v.downAt >= VILLAGE_DOWN_MS) return { ...FULL_VITALS, seq: v.seq }
  if (v.downAt === null && v.lastHitAt !== null && v.hp < VILLAGE_AGENT_MAX_HP && now - v.lastHitAt >= VILLAGE_REGEN_AFTER_MS) {
    return { ...FULL_VITALS, seq: v.seq }
  }
  return v
}

export function isVillageAgentDown(v: VillageVitals, now: number): boolean {
  const current = vitalsAt(v, now)
  return current.downAt !== null
}

/** One bolt lands. A downed agent can't be hit again until it is back up. */
export function applyVillageHit(v: VillageVitals, damage: number, now: number): { vitals: VillageVitals; lethal: boolean; landed: boolean } {
  const current = vitalsAt(v, now)
  if (current.downAt !== null) return { vitals: current, lethal: false, landed: false }
  const hp = Math.max(0, current.hp - Math.max(0, damage))
  const lethal = hp === 0
  const seq = current.seq + 1
  const hits = [...current.hits.filter(hit => now - hit.at < 1500), { id: seq, amount: Math.max(0, damage), at: now, lethal }].slice(-6)
  return { vitals: { hp, downAt: lethal ? now : null, lastHitAt: now, hits, seq }, lethal, landed: true }
}

/** Mid-flinch (knockback animation), as opposed to standing or knocked out. */
export function isFlinching(v: VillageVitals, now: number): boolean {
  return v.downAt === null && v.lastHitAt !== null && now - v.lastHitAt < VILLAGE_FLINCH_MS
}

// ─── this tab's state ───────────────────────────────────────────────────────

const vitals = new Map<string, VillageVitals>()
const listeners = new Set<() => void>()
let version = 0
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function notify(): void {
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribeVillageCombat(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getVillageCombatVersion(): number {
  return version
}

export function getVillageVitals(agentId: string, now = Date.now()): VillageVitals {
  const v = vitals.get(agentId)
  return v ? vitalsAt(v, now) : FULL_VITALS
}

/** Wake the HUD again when something changes on its own (end of a flinch, getting up, healing). */
function scheduleWake(agentId: string, inMs: number): void {
  const old = timers.get(agentId)
  if (old) clearTimeout(old)
  timers.set(agentId, setTimeout(() => {
    timers.delete(agentId)
    const v = vitals.get(agentId)
    if (v) {
      const now = Date.now()
      const next = vitalsAt(v, now)
      if (next.hp === VILLAGE_AGENT_MAX_HP && next.downAt === null) vitals.delete(agentId)
      else if (isFlinching(next, now)) scheduleWake(agentId, VILLAGE_FLINCH_MS)
      else if (next.downAt !== null) scheduleWake(agentId, VILLAGE_DOWN_MS - (now - next.downAt) + 20)
      else if (next.lastHitAt !== null) scheduleWake(agentId, VILLAGE_REGEN_AFTER_MS - (now - next.lastHitAt) + 20)
    }
    notify()
  }, Math.max(0, inMs)))
}

export interface VillageHitEvent {
  agentId: string
  /** Where the bolt struck (world), if known. */
  at: [number, number, number] | null
  lethal: boolean
  /** Damage dealt: a bullet (8) sprays less than a bolt (25). */
  amount: number
}

const hitListeners = new Set<(event: VillageHitEvent) => void>()

/** Every landed hit (the gore layer sprays from here). */
export function onVillageHit(listener: (event: VillageHitEvent) => void): () => void {
  hitListeners.add(listener)
  return () => { hitListeners.delete(listener) }
}

/** A bolt hit agent `agentId`. Returns what happened, for the hit marker. */
export function damageVillageAgent(
  agentId: string,
  damage = VILLAGE_BOLT_DAMAGE,
  now = Date.now(),
  at: [number, number, number] | null = null,
): { landed: boolean; lethal: boolean; hp: number } {
  const result = applyVillageHit(vitals.get(agentId) || FULL_VITALS, damage, now)
  if (!result.landed) return { landed: false, lethal: false, hp: result.vitals.hp }
  vitals.set(agentId, result.vitals)
  scheduleWake(agentId, result.lethal ? VILLAGE_DOWN_MS + 20 : VILLAGE_FLINCH_MS)
  notify()
  hitListeners.forEach(listener => listener({ agentId, at, lethal: result.lethal, amount: damage }))
  return { landed: true, lethal: result.lethal, hp: result.vitals.hp }
}

/** Bolt targets skip knocked-out agents: shots fly through until they are back up. */
export function canHitVillageAgent(agentId: string, now = Date.now()): boolean {
  return !isVillageAgentDown(vitals.get(agentId) || FULL_VITALS, now)
}

export const VILLAGE_TARGET_PREFIX = 'village:'
/** Chest height above the avatar's feet (the hit sphere's centre), and the sphere's radius. */
export const VILLAGE_TARGET_HEIGHT = 1.05
export const VILLAGE_TARGET_RADIUS = 0.7

// ─── where a knocked-out body lies (VillageCorpseDrop writes, the gore layer pools blood there) ──

const corpseCenters = new Map<string, [number, number, number]>()

export function setVillageCorpseCenter(agentId: string, center: [number, number, number] | null): void {
  if (center) corpseCenters.set(agentId, center)
  else corpseCenters.delete(agentId)
}

export function getVillageCorpseCenter(agentId: string): [number, number, number] | null {
  return corpseCenters.get(agentId) || null
}

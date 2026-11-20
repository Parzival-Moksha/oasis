// What an agent's body does while it stands, by what it is doing (the owner, 2026-11-20, first recording 9:52-16:40):
//   - waiting for him (the "!"): "instead of like the original idle, they could cycle across idle torch, spell simple
//     idle, idle fold arms", "sword idle could also be one of those idles that they use when they are waiting for me",
//     "swim idle ... could be also one of those waiting for you idle animations";
//   - working: "talking phone could be one of the defaults for when they're working", "fixing kneeling could also be one
//     of the first random and then less random animations that the avatars could cycle through as they work", "tree
//     chopping needs to be one of those as well";
//   - talking: "the idle talking, we already have that" (when they talk to him; on the phone they are not).
// Each agent picks its own from the pool and changes every so often (with a blend), so they don't all look the same.
// All clips are from Quaternius's free packs (CC0).

export type AgentPose = 'waiting' | 'working' | 'talking' | 'resting'

export const IDLE_POOLS: Record<'waiting' | 'working', readonly string[]> = {
  waiting: ['ual-idle-torch', 'ual-spell-idle', 'ual-fold-arms', 'ual-sword-idle', 'ual-swim-idle'],
  working: ['ual-phone', 'ual-fixing', 'ual-chop'],
}
export const TALKING_CLIP = 'ual-talking'
/** Without variety (Settings > Agents): one clip per state, the first one he named. */
export const PLAIN_CLIP: Record<'waiting' | 'working', string> = { waiting: 'ual-fold-arms', working: 'ual-phone' }

/** How long one clip holds before the next, seconds: each agent has its own length in this range. */
export const HOLD_MIN_S = 18
export const HOLD_MAX_S = 36

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** This agent's own hold length, seconds. */
export function holdSeconds(agentId: string): number {
  return HOLD_MIN_S + (hash(`${agentId}:hold`) % 1000) / 1000 * (HOLD_MAX_S - HOLD_MIN_S)
}

/** This agent's order through the pool on one lap: a shuffle seeded by its id and the lap. */
function lapOrder(agentId: string, pool: readonly string[], lap: number): string[] {
  const order = [...pool].sort((a, b) => hash(`${agentId}:${lap}:${a}`) - hash(`${agentId}:${lap}:${b}`))
  // The seam between laps never repeats a clip.
  if (lap > 0) {
    const before = lapOrder(agentId, pool, lap - 1)
    if (order[0] === before[before.length - 1]) [order[0], order[1]] = [order[1], order[0]]
  }
  return order
}

/**
 * The clip for an agent's `round` in a pool: its own shuffled order, a new one each time round the pool, so two agents
 * side by side rarely match and one agent never plays the same clip twice in a row.
 */
export function pickVariety(agentId: string, pool: readonly string[], round: number): string {
  if (pool.length === 0) return ''
  if (pool.length === 1) return pool[0]
  const lap = Math.floor(round / pool.length)
  return lapOrder(agentId, pool, lap)[round % pool.length]
}

/** The clip for a pose (null: the plain idle). */
export function clipForPose(agentId: string, pose: AgentPose, round: number, variety: boolean): string | null {
  if (pose === 'talking') return TALKING_CLIP
  if (pose === 'resting') return null
  return variety ? pickVariety(agentId, IDLE_POOLS[pose], round) : PLAIN_CLIP[pose]
}

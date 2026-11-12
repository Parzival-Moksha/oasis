// ░▒▓ VILLAGE SEEN — "finished while you weren't looking" survives a page reload ▓▒░
// The page remembers, per agent (its session), when you last looked at it. After a reload or an engine
// restart, an agent whose last turn ended after that is unseen again, so the attention queue (N, the
// Agents menu glow, the tab title) still knows who wanted you. Kept in this browser (localStorage).

const STORAGE_KEY = 'oasis.village.seen.v1'
const MAX_ENTRIES = 400

export type SeenMap = Record<string, number>

export interface SeenAgent {
  /** Session id, or the agent id while it has none. */
  key: string
  id: string
  status: string
  lastOutcomeAt: number | null
}

/** Statuses that a turn ending leaves behind (an agent that is working or idle-and-fresh needs no look). */
const FINISHED = new Set(['waiting', 'error', 'idle'])

/**
 * Which agents become unseen again, and the updated seen map. An agent this page never saw before gets
 * a baseline of `now` (the first load doesn't flag everyone); one whose last turn ended after the time
 * you last looked is unseen.
 */
export function planUnseenRestore(agents: SeenAgent[], seen: SeenMap, now: number, focusedId: string | null = null): { unseenIds: string[]; seen: SeenMap } {
  const next: SeenMap = { ...seen }
  const unseenIds: string[] = []
  for (const agent of agents) {
    const lastLook = next[agent.key]
    if (lastLook === undefined) {
      next[agent.key] = now
      continue
    }
    if (agent.id === focusedId) {
      next[agent.key] = now
      continue
    }
    if (agent.lastOutcomeAt !== null && agent.lastOutcomeAt > lastLook && FINISHED.has(agent.status)) unseenIds.push(agent.id)
  }
  return { unseenIds, seen: trim(next) }
}

function trim(map: SeenMap): SeenMap {
  const keys = Object.keys(map)
  if (keys.length <= MAX_ENTRIES) return map
  const kept = keys.sort((a, b) => map[b] - map[a]).slice(0, MAX_ENTRIES)
  return Object.fromEntries(kept.map(key => [key, map[key]]))
}

export function loadSeen(): SeenMap {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SeenMap : {}
  } catch {
    return {}
  }
}

export function saveSeen(map: SeenMap): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trim(map))) } catch { /* storage blocked */ }
}

/** You looked at this agent now. */
export function markSeen(key: string, at = Date.now()): void {
  const map = loadSeen()
  map[key] = at
  saveSeen(map)
}

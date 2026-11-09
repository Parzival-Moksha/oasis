// ░▒▓ VILLAGE SUBAGENTS — an agent's helpers as small copies of it, in a semicircle behind it ▓▒░
// Pure: which helpers show, where each one stands (station-local), how long it has been at it.

import { runningSubagentCount, SUBAGENT_STALE_MS, type EngineAgentState, type EngineSubagentState } from '../../store/slices/agentEngineSlice'
import { STATION } from './village-layout'

/** A helper that just finished stays in view this long, so you can see it was there and check its work. */
export const SUBAGENT_RECENT_MS = 60_000

export type SubagentLook = 'running' | 'done' | 'failed' | 'stopped'

export function subagentLook(sub: Pick<EngineSubagentState, 'status'>): SubagentLook {
  const status = (sub.status || '').toLowerCase()
  if (status === 'running') return 'running'
  if (status === 'stopped' || status === 'killed' || status === 'cancelled') return 'stopped'
  if (status === 'completed' || status === 'success' || status === 'done') return 'done'
  return 'failed'
}

/** Running helpers, then the ones that ended in the last minute; oldest first, so nobody changes place. */
export function visibleSubagents(agent: Pick<EngineAgentState, 'subagents'>, now: number): EngineSubagentState[] {
  return (agent.subagents || [])
    .filter(sub => (sub.status === 'running'
      ? !(now - sub.startedAt > SUBAGENT_STALE_MS)
      : typeof sub.endedAt === 'number' && now - sub.endedAt < SUBAGENT_RECENT_MS))
    .sort((a, b) => a.startedAt - b.startedAt)
}

export { runningSubagentCount }

export interface MiniSeat {
  /** Station-local ground position (local +Z faces the plaza; the parent stands at STATION.avatar). */
  x: number
  z: number
  row: number
}

/** Up to this many in the first row; the second row takes a few more, then a "+N" sign. */
export const MINI_ROW_SIZES = [6, 7]
const MINI_RADII = [2.0, 2.9]
const MAX_ARC = (150 * Math.PI) / 180
const MAX_STEP = (28 * Math.PI) / 180

/** A semicircle behind the parent, about 2 m back, centred on its back. */
export function miniSeats(count: number): { seats: MiniSeat[]; overflow: number; overflowAt: MiniSeat | null } {
  const seats: MiniSeat[] = []
  let left = Math.max(0, Math.floor(count))
  const [ax, , az] = STATION.avatar
  MINI_ROW_SIZES.forEach((size, row) => {
    const n = Math.min(left, size)
    left -= n
    const step = n > 1 ? Math.min(MAX_STEP, MAX_ARC / (n - 1)) : 0
    for (let i = 0; i < n; i += 1) {
      const angle = (i - (n - 1) / 2) * step // 0 = straight behind the parent
      seats.push({ x: ax + Math.sin(angle) * MINI_RADII[row], z: az - Math.cos(angle) * MINI_RADII[row], row })
    }
  })
  return { seats, overflow: left, overflowAt: left > 0 ? { x: ax, z: az - MINI_RADII[1] - 1.1, row: 2 } : null }
}

/** "40s", "12m", "1h 05m". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

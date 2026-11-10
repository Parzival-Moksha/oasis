// ░▒▓ DESK SCREENS — which agents show the glass screen above their desk ▓▒░
// A desk screen is a whole conversation as live HTML under a CSS 3D transform: the most expensive
// thing the village draws, per agent. The owner picks how many show (Config → Agents → Desk
// screens). Name labels and status signs are separate and always show. Talking to an agent (E:
// side panel, F: its screen) never depends on this setting.

export type DeskScreensMode = 'off' | 'nearest' | 'all'

export const DESK_SCREENS_DEFAULT: DeskScreensMode = 'off'

/** How many desk screens may show at once in each mode. */
export const DESK_SCREEN_LIMIT: Record<DeskScreensMode, number> = { off: 0, nearest: 2, all: 8 }

/** A screen shows within this many meters of the camera... */
export const DESK_SCREEN_REACH_M = 26
/** ...and one that already shows stays until this much further (no flicker at the edge). */
export const DESK_SCREEN_KEEP_M = 2

export function isDeskScreensMode(value: unknown): value is DeskScreensMode {
  return value === 'off' || value === 'nearest' || value === 'all'
}

export interface DeskDistance {
  id: string
  /** Meters from the camera to the agent's screen. */
  distance: number
}

/**
 * The agents whose desk screen shows: the nearest `limit` within reach, where one that already
 * shows gets a little extra reach. Sorted by id (a stable key for the caller).
 */
export function pickDeskScreens(desks: readonly DeskDistance[], limit: number, showing: ReadonlySet<string>): string[] {
  if (limit <= 0) return []
  return desks
    .filter(desk => desk.distance < (showing.has(desk.id) ? DESK_SCREEN_REACH_M + DESK_SCREEN_KEEP_M : DESK_SCREEN_REACH_M))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(desk => desk.id)
    .sort()
}

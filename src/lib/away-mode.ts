// ░▒▓ AWAY MODE — the 3D world stops drawing while nobody is looking ▓▒░
// The owner (20 Nov): "it occupies some CPU and GPU for nothing… how do we do this most effectively
// where we're not draining resources uselessly when I'm away from the keyboard?"
// The installed app window keeps drawing at full rate whenever it is visible. So: after a few
// minutes with no mouse or key (Settings → Graphics → Rest when away), when the window is hidden
// or covered, or on F8, the page rests: the render loop stops, the screen dims with one line,
// and everything that is not drawing (the engine connection, sounds and spoken replies, the
// chime and the title count) keeps running. Any input wakes it.

export type AwayAfter = 0 | 1 | 3 | 5 | 10

export const AWAY_AFTER_DEFAULT: AwayAfter = 3

export function isAwayAfter(value: unknown): value is AwayAfter {
  return value === 0 || value === 1 || value === 3 || value === 5 || value === 10
}

export type AwayReason = 'idle' | 'hidden' | 'manual'

export interface AwayState {
  resting: boolean
  reason: AwayReason | null
}

/**
 * Decides when the page rests. Pure: the caller reports input, visibility and the time, and
 * calls `tick(now)` now and then (a few times a second is plenty).
 */
export class AwayTracker {
  private lastInput: number
  private hidden = false
  private manual = false
  private state: AwayState = { resting: false, reason: null }

  /** `afterMinutes`: idle minutes before resting; 0 never rests on idle (hidden and F8 still do). */
  constructor(now: number, private afterMinutes: number = AWAY_AFTER_DEFAULT) {
    this.lastInput = now
  }

  setAfter(minutes: number): AwayState {
    this.afterMinutes = minutes
    return this.state
  }

  /** A mouse move, key, wheel, touch or click. Wakes at once. */
  input(now: number): AwayState {
    this.lastInput = now
    this.manual = false
    return this.evaluate(now)
  }

  /** The window was hidden (minimised, covered, another tab) or shown again. Showing it does not wake by itself: the owner may not be there. */
  visibility(hidden: boolean, now: number): AwayState {
    this.hidden = hidden
    if (!hidden) {
      // Coming back into view counts as a sign of life only if it was hidden for a short time
      // (switching windows); after a long absence the next real input wakes it.
      if (now - this.lastInput < this.idleMs()) this.lastInput = now
    }
    return this.evaluate(now)
  }

  /** F8 or the menu: rest now, until the next input. */
  restNow(now: number): AwayState {
    this.manual = true
    return this.evaluate(now)
  }

  tick(now: number): AwayState {
    return this.evaluate(now)
  }

  get current(): AwayState {
    return this.state
  }

  private idleMs(): number {
    return this.afterMinutes > 0 ? this.afterMinutes * 60_000 : Number.POSITIVE_INFINITY
  }

  private evaluate(now: number): AwayState {
    const reason: AwayReason | null = this.manual ? 'manual'
      : this.hidden ? 'hidden'
      : now - this.lastInput >= this.idleMs() ? 'idle'
      : null
    if (reason !== this.state.reason) this.state = { resting: reason !== null, reason }
    return this.state
  }
}

// ── The page's state ─────────────────────────────────────────────────────────────────────────────

let current: AwayState = { resting: false, reason: null }
const listeners = new Set<() => void>()
let restNowHandler: (() => void) | null = null

export function getAwayState(): AwayState {
  return current
}

export function setAwayState(next: AwayState): void {
  if (next.resting === current.resting && next.reason === current.reason) return
  current = next
  listeners.forEach(listener => listener())
}

export function subscribeAwayState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The page's away-mode driver registers how to rest now; menus call `restNow()`. */
export function registerRestNow(handler: (() => void) | null): void {
  restNowHandler = handler
}

export function restNow(): void {
  restNowHandler?.()
}

const SERVER_STATE: AwayState = { resting: false, reason: null }
export function getServerAwayState(): AwayState {
  return SERVER_STATE
}

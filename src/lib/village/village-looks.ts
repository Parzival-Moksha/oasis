// ░▒▓ VILLAGE LOOKS — the desks (on or off) and how a dismissed agent leaves ▓▒░
// The owner (2026-11-19 walk-through, 54:57 to 1:02:35): "the desk thing, it's served us well, but I think it's
// time to ditch it… I like the circular thing", and a dismissed avatar never just disappears. Kept in this browser
// (localStorage), chosen in Settings > Agents.

export type LeaveEffect = 'fade' | 'spin' | 'crt' | 'poof'

export const LEAVE_EFFECTS: Array<{ id: LeaveEffect; label: string; hint: string; ms: number }> = [
  { id: 'spin', label: 'Spin', hint: 'It spins faster and faster while it stretches sideways, then runs off to the horizon and rips apart, with a rising sound. 3 s.', ms: 3000 },
  { id: 'crt', label: 'CRT', hint: 'Like an old screen switching off: squashed to a line, stretched wide, then gone. 1.2 s.', ms: 1200 },
  { id: 'poof', label: 'Poof', hint: 'Squeezed to nothing, a puff of smoke, a poof. 0.9 s.', ms: 900 },
  { id: 'fade', label: 'Fade', hint: 'It fades out over two seconds.', ms: 2000 },
]

export interface VillageLooks {
  /** Desk furniture under the agents on the ring. Off by default (the screen and the markers stay). */
  desks: boolean
  leave: LeaveEffect
  /** The leaving sound. */
  leaveSound: boolean
}

export const VILLAGE_LOOKS_DEFAULT: VillageLooks = { desks: false, leave: 'spin', leaveSound: true }

export function isLeaveEffect(value: unknown): value is LeaveEffect {
  return value === 'fade' || value === 'spin' || value === 'crt' || value === 'poof'
}

export function clampLooks(raw: Partial<VillageLooks> | null | undefined): VillageLooks {
  return {
    desks: raw?.desks === true,
    leave: isLeaveEffect(raw?.leave) ? raw.leave : VILLAGE_LOOKS_DEFAULT.leave,
    leaveSound: raw?.leaveSound !== false,
  }
}

export function leaveEffectMs(effect: LeaveEffect): number {
  return LEAVE_EFFECTS.find(entry => entry.id === effect)?.ms ?? 2000
}

const KEY = 'oasis.village.looks.v1'
const listeners = new Set<() => void>()
let version = 0
let cache: VillageLooks | null = null

export function getVillageLooks(): VillageLooks {
  if (!cache) {
    let raw: Partial<VillageLooks> | null = null
    if (typeof window !== 'undefined') {
      try { raw = JSON.parse(window.localStorage.getItem(KEY) || 'null') } catch { raw = null }
    }
    cache = clampLooks(raw)
  }
  return cache
}

export function setVillageLooks(patch: Partial<VillageLooks>): void {
  cache = clampLooks({ ...getVillageLooks(), ...patch })
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* storage blocked */ }
  }
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribeVillageLooks(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getVillageLooksVersion(): number {
  return version
}

// ─── the spin (pure: the shape of the owner's three seconds) ──────────────────────────────────────

/**
 * The spin at `t` seconds of 3: how fast it turns (radians/s), how wide it is (x and z scale) and how tall, how far
 * it has run off, how opaque. Slow and still clearly there for two seconds (about 3 m wide by then), then the last
 * second runs away to the horizon and rips apart.
 */
export function spinAt(t: number): { turnRate: number; wide: number; tall: number; run: number; opacity: number } {
  const u = Math.max(0, Math.min(3, t))
  // Two calm seconds: width grows to about 6x (a 0.5 m body becomes about 3 m), the spin to about 5 turns a second.
  const calm = Math.min(u, 2) / 2
  let wide = 1 + 5 * calm * calm
  let turnRate = 2 + 28 * calm * calm
  let tall = 1 - 0.15 * calm
  let run = 0
  let opacity = 1
  if (u > 2) {
    // The last second: hyperbolic, toward the horizon.
    const k = (u - 2) / 1
    const blow = 1 / Math.max(0.04, 1 - k) - 1
    wide *= 1 + blow * 1.5
    turnRate *= 1 + blow
    tall *= Math.max(0.05, 1 - k * 0.9)
    run = blow * 4
    opacity = Math.max(0, 1 - k * k)
  }
  return { turnRate, wide, tall, run, opacity }
}

/** The CRT switch-off at `t` seconds: squashed to a line while it widens (0.5 s), then fades (0.7 s). */
export function crtAt(t: number): { wide: number; tall: number; opacity: number; glow: number } {
  const u = Math.max(0, t)
  const squash = Math.min(1, u / 0.5)
  const ease = 1 - (1 - squash) * (1 - squash)
  const fade = Math.max(0, Math.min(1, (u - 0.5) / 0.7))
  return { wide: 1 + 2.2 * ease, tall: Math.max(0.015, 1 - 0.985 * ease), opacity: 1 - fade, glow: ease * (1 - fade) }
}

/** The poof at `t` seconds: squeezed to nothing in 0.35 s; the smoke follows. */
export function poofAt(t: number): { scale: number; smoke: number } {
  const squeeze = Math.min(1, Math.max(0, t) / 0.35)
  return { scale: Math.max(0.001, 1 - squeeze * squeeze * (3 - 2 * squeeze)), smoke: Math.max(0, Math.min(1, (t - 0.25) / 0.65)) }
}

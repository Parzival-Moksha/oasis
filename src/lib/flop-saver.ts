// ░▒▓ FLOP SAVER — graphics effects switch off by tiers while the frame rate stays under 30 ▓▒░
// The owner (19 Nov): "a tier list for switching them on and off depending on frame rate. If
// frame rate is persistently under thirty, go to a low flop mode or flop saver mode. And
// otherwise just have all the effects by default."
//
// Every effect has a tier. Saver level N switches off every effect of tier N or lower, so the
// cheapest loss goes first. The level never raises anything above what the owner set: it only
// caps (`capGraphicsPrefs`, `useFlopCaps`). Settings → Graphics → Flop saver: Auto (the watcher
// below picks the level), Everything on (level 0), Saver (level SAVER_LEVEL).
//
// Components with an effect read their cap with `useFlopCaps()` (src/lib/use-flop-caps.ts).

import type { FlopSaverMode, GraphicsPrefs, GroundSharpness, ShadowMode, ShadowQuality, ShadowRefresh } from './graphics-prefs'

export type { FlopSaverMode }

/** The highest level, and the one "Saver" picks. */
export const MAX_FLOP_LEVEL = 5
export const SAVER_LEVEL = 4

/**
 * Every graphics effect, cheapest loss first: what it is, the tier at which flop saver turns it
 * down, and what it cost when measured (19 Nov, world ghi9 at 1825 x 1056, 12 agents, headless
 * Chrome on this machine's RTX 4060 laptop GPU; "main" is main-thread time a frame, "GPU" the
 * card's time a frame; everything on: main 8.3 ms, GPU 3.5 ms). `cost` is for people reading
 * this; the code uses `tier`. Log: docs/missions/fps-ceiling.md (7c_oasis).
 */
export const FLOP_EFFECTS = [
  { id: 'skyTransition', tier: 1, name: 'Sky change effect (melt, rip, glitch); the sky swaps at once instead', cost: 'only while the sky changes' },
  { id: 'chromatic', tier: 1, name: 'Chromatic aberration (colour fringes at the edges)', cost: 'tier 1 together: main 0.3 ms, GPU under 0.1 ms' },
  { id: 'vignette', tier: 1, name: 'Vignette, and the darkening and fringes while dashing', cost: 'in tier 1 above' },
  { id: 'shadowRefresh', tier: 1, name: 'Shadow redraw on every moving frame (capped at 60 a second)', cost: 'up to 0.8 ms main on a 165 Hz screen while someone walks' },
  { id: 'bloom', tier: 2, name: 'Bloom (glow around bright things); with it the whole effect pipeline goes', cost: 'tier 2 together: main 1.2 ms, GPU 2.1 ms (3.5 -> 1.45)' },
  { id: 'shadowsAll', tier: 2, name: 'Shadows from world objects (avatars keep theirs)', cost: 'main 1.2 ms over avatar-only shadows' },
  { id: 'shadowQuality', tier: 2, name: 'Shadow map at 4096 px (2048 instead)', cost: 'GPU memory 64 MB -> 16 MB' },
  { id: 'groundSharpness', tier: 3, name: 'Sharper ground (detail layer, extra repeats)', cost: 'main 0.3 ms; GPU under 0.1 ms' },
  { id: 'particles', tier: 3, name: 'Decorative particles (portal sparks, swarms, motes)', cost: 'not measurable in ghi9 (two point clouds)' },
  { id: 'labels3d', tier: 3, name: '3D letters on name tags and signs (flat text instead)', cost: 'main 0.6 ms for the 14 words in ghi9' },
  { id: 'leaveEffects', tier: 3, name: 'Full leaving effects when an agent is dismissed (a short fade instead)', cost: 'only while one plays' },
  { id: 'shadows', tier: 4, name: 'All shadows', cost: 'tier 4 together: main 0.4 ms, GPU 0.6 ms' },
  { id: 'resolution75', tier: 4, name: 'Full resolution (75% instead)', cost: 'in tier 4 above (44% fewer pixels)' },
  { id: 'resolution50', tier: 5, name: 'Resolution 75% (50% instead)', cost: 'tier 5 together: main 0.3 ms, GPU 0.2 ms' },
  { id: 'drawDistance', tier: 5, name: 'Far view (150 m instead of 500 m)', cost: 'in tier 5 above; more in open worlds' },
] as const

export type FlopEffectId = typeof FLOP_EFFECTS[number]['id']

export function effectTier(id: FlopEffectId): number {
  return FLOP_EFFECTS.find(effect => effect.id === id)!.tier
}

/** Whether an effect may run at a saver level. */
export function effectAllowed(id: FlopEffectId, level: number): boolean {
  return effectTier(id) > level
}

export interface FlopCaps {
  level: number
  chromatic: boolean
  vignette: boolean
  bloom: boolean
  particles: boolean
  labels3d: boolean
  leaveEffects: boolean
  skyTransition: boolean
  maxShadows: ShadowMode
  maxShadowQuality: ShadowQuality
  /** The fastest shadow refresh allowed. */
  maxShadowRefresh: ShadowRefresh
  maxGroundSharpness: GroundSharpness
  /** Multiplier on the screen's pixel ratio. */
  resolution: number
  /** Camera far plane, metres; null: as the scene sets it. */
  drawDistance: number | null
}

export function capsForLevel(level: number): FlopCaps {
  const l = Math.max(0, Math.min(MAX_FLOP_LEVEL, Math.round(Number.isFinite(level) ? level : 0)))
  const on = (id: FlopEffectId) => effectAllowed(id, l)
  return {
    level: l,
    chromatic: on('chromatic'),
    vignette: on('vignette'),
    bloom: on('bloom'),
    particles: on('particles'),
    labels3d: on('labels3d'),
    leaveEffects: on('leaveEffects'),
    skyTransition: on('skyTransition'),
    maxShadows: !on('shadows') ? 'off' : !on('shadowsAll') ? 'avatars' : 'all',
    maxShadowQuality: on('shadowQuality') ? 'high' : 'medium',
    maxShadowRefresh: on('shadowRefresh') ? 'frame' : '60',
    maxGroundSharpness: on('groundSharpness') ? 4 : 1,
    resolution: !on('resolution50') ? 0.5 : !on('resolution75') ? 0.75 : 1,
    drawDistance: on('drawDistance') ? null : 150,
  }
}

const SHADOW_ORDER: ShadowMode[] = ['off', 'avatars', 'all']
const QUALITY_ORDER: ShadowQuality[] = ['low', 'medium', 'high']
/** Slowest to fastest; 'auto' sits between 60 and every frame (every frame only while something moves). */
const REFRESH_ORDER: ShadowRefresh[] = ['30', '60', 'auto', 'frame']

function lower<T>(order: T[], a: T, b: T): T {
  return order[Math.min(order.indexOf(a), order.indexOf(b))]
}

/** The owner's graphics settings, each lowered to what the saver level allows (never raised). */
export function capGraphicsPrefs(prefs: GraphicsPrefs, caps: FlopCaps): GraphicsPrefs {
  return {
    ...prefs,
    shadows: lower(SHADOW_ORDER, prefs.shadows, caps.maxShadows),
    shadowQuality: lower(QUALITY_ORDER, prefs.shadowQuality, caps.maxShadowQuality),
    shadowRefresh: lower(REFRESH_ORDER, prefs.shadowRefresh, caps.maxShadowRefresh),
    groundSharpness: Math.min(prefs.groundSharpness, caps.maxGroundSharpness) as GroundSharpness,
  }
}

// ── The watcher ─────────────────────────────────────────────────────────────────────────────────

export const FLOP_LOW_FPS = 30
/** Seconds under FLOP_LOW_FPS before stepping down a level. */
export const FLOP_DOWN_AFTER_S = 5
/** Frame rate that counts as comfortably fast again (the margin above 30 that stops flapping). */
export const FLOP_HIGH_FPS = 50
/** Seconds at or above FLOP_HIGH_FPS before stepping back up a level. */
export const FLOP_UP_AFTER_S = 20
/** A level that had to be left again within this long after stepping up to it is held longer next time. */
export const FLOP_BOUNCE_WINDOW_S = 60
/** The longest wait before trying a level that keeps bouncing. */
export const FLOP_MAX_UP_WAIT_S = 600
/** Nothing is judged in the first seconds after start (shaders compile, the world loads). */
export const FLOP_WARMUP_S = 10

/**
 * Picks the saver level from the frame times it is fed. Pure: the caller feeds every frame's
 * duration and the time, and reads `level`. Gaps (a hidden tab, a load) are skipped, not judged.
 */
export class FlopWatcher {
  level = 0
  private started: number | null = null
  private secondStart: number | null = null
  private secondFrames = 0
  private lowSeconds = 0
  private highSeconds = 0
  /** Per level: how long to wait at fast frame rates before trying it again. */
  private upWait = new Map<number, number>()
  /** When we last stepped up, and to which level. */
  private lastUp: { at: number; to: number } | null = null

  /** One frame: its duration (ms) and the time it ended (ms). Returns the level after it. */
  frame(durationMs: number, nowMs: number): number {
    if (this.started === null) this.started = nowMs
    // A gap of a second or more is not a frame rate: a hidden tab, a load. (Slower frames do
    // count: a machine stuck at 3 fps must step down too.)
    if (!(durationMs > 0) || durationMs >= 1000) {
      this.secondStart = null
      this.secondFrames = 0
      return this.level
    }
    if (nowMs - this.started < FLOP_WARMUP_S * 1000) return this.level
    if (this.secondStart === null) {
      this.secondStart = nowMs
      this.secondFrames = 0
      return this.level
    }
    this.secondFrames += 1
    const elapsed = nowMs - this.secondStart
    if (elapsed < 1000) return this.level
    this.judge((this.secondFrames * 1000) / elapsed, nowMs)
    this.secondStart = nowMs
    this.secondFrames = 0
    return this.level
  }

  private judge(fps: number, nowMs: number): void {
    if (fps < FLOP_LOW_FPS) {
      this.lowSeconds += 1
      this.highSeconds = 0
      if (this.lowSeconds >= FLOP_DOWN_AFTER_S && this.level < MAX_FLOP_LEVEL) {
        // Stepped up to this level a moment ago and it failed: wait longer before trying it again.
        if (this.lastUp && this.lastUp.to === this.level && nowMs - this.lastUp.at < FLOP_BOUNCE_WINDOW_S * 1000) {
          const wait = Math.min(FLOP_MAX_UP_WAIT_S, (this.upWait.get(this.level) ?? FLOP_UP_AFTER_S) * 2)
          this.upWait.set(this.level, wait)
        }
        this.level += 1
        this.lowSeconds = 0
        this.lastUp = null
      }
      return
    }
    this.lowSeconds = 0
    if (fps >= FLOP_HIGH_FPS) {
      this.highSeconds += 1
      const target = this.level - 1
      const wait = this.upWait.get(target) ?? FLOP_UP_AFTER_S
      if (this.level > 0 && this.highSeconds >= wait) {
        this.level = target
        this.highSeconds = 0
        this.lastUp = { at: nowMs, to: target }
      }
    } else {
      this.highSeconds = 0
    }
  }

  /** How long the watcher waits before trying `level` again (seconds). */
  upWaitFor(level: number): number {
    return this.upWait.get(level) ?? FLOP_UP_AFTER_S
  }

  reset(): void {
    this.level = 0
    this.started = null
    this.secondStart = null
    this.secondFrames = 0
    this.lowSeconds = 0
    this.highSeconds = 0
    this.upWait.clear()
    this.lastUp = null
  }
}

// ── The level the page is at ─────────────────────────────────────────────────────────────────────

let currentLevel = 0
const levelListeners = new Set<() => void>()

export function getFlopLevel(): number {
  return currentLevel
}

export function setFlopLevel(level: number): void {
  const next = capsForLevel(level).level
  if (next === currentLevel) return
  currentLevel = next
  levelListeners.forEach(listener => listener())
}

export function subscribeFlopLevel(listener: () => void): () => void {
  levelListeners.add(listener)
  return () => { levelListeners.delete(listener) }
}

/** The level a mode means, given what the watcher picked. */
export function levelForMode(mode: FlopSaverMode, watcherLevel: number): number {
  if (mode === 'all') return 0
  if (mode === 'saver') return SAVER_LEVEL
  return watcherLevel
}

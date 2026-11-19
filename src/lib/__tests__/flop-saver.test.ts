import { describe, expect, it } from 'vitest'

import {
  capGraphicsPrefs, capsForLevel, effectAllowed, FLOP_EFFECTS, FlopWatcher, levelForMode,
  FLOP_DOWN_AFTER_S, FLOP_UP_AFTER_S, FLOP_WARMUP_S, MAX_FLOP_LEVEL, SAVER_LEVEL,
} from '../flop-saver'
import { GRAPHICS_PREFS_DEFAULT, type GraphicsPrefs } from '../graphics-prefs'

/** Feeds the watcher `seconds` of frames at `fps`, starting at `t`; returns the time after. */
function run(watcher: FlopWatcher, fps: number, seconds: number, t: number): number {
  const dt = 1000 / fps
  const frames = Math.round(seconds * fps)
  for (let i = 0; i < frames; i++) { t += dt; watcher.frame(dt, t) }
  return t
}

function warm(watcher: FlopWatcher): number {
  return run(watcher, 120, FLOP_WARMUP_S + 1, 0)
}

describe('the tier list', () => {
  it('is ordered cheapest loss first, every tier from 1 to the top is used, ids are unique', () => {
    const tiers = FLOP_EFFECTS.map(effect => effect.tier)
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers)
    expect(new Set(tiers)).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(new Set(FLOP_EFFECTS.map(effect => effect.id)).size).toBe(FLOP_EFFECTS.length)
  })

  it('level 0 allows everything; each level only ever takes more away', () => {
    for (const effect of FLOP_EFFECTS) expect(effectAllowed(effect.id, 0)).toBe(true)
    for (let level = 1; level <= MAX_FLOP_LEVEL; level++) {
      for (const effect of FLOP_EFFECTS) {
        if (!effectAllowed(effect.id, level - 1)) expect(effectAllowed(effect.id, level)).toBe(false)
      }
    }
    for (const effect of FLOP_EFFECTS) expect(effectAllowed(effect.id, MAX_FLOP_LEVEL)).toBe(false)
  })

  it('caps step down in order: post effects, then bloom and world shadows, then ground and particles, then shadows and resolution', () => {
    expect(capsForLevel(0)).toMatchObject({ chromatic: true, bloom: true, maxShadows: 'all', resolution: 1, drawDistance: null })
    expect(capsForLevel(1)).toMatchObject({ chromatic: false, vignette: false, bloom: true, maxShadowRefresh: '60' })
    expect(capsForLevel(2)).toMatchObject({ bloom: false, maxShadows: 'avatars', maxShadowQuality: 'medium' })
    expect(capsForLevel(3)).toMatchObject({ maxGroundSharpness: 1, particles: false, labels3d: false, leaveEffects: false, maxShadows: 'avatars' })
    expect(capsForLevel(4)).toMatchObject({ maxShadows: 'off', resolution: 0.75 })
    expect(capsForLevel(5)).toMatchObject({ resolution: 0.5, drawDistance: 150 })
    expect(capsForLevel(99).level).toBe(MAX_FLOP_LEVEL)
    expect(capsForLevel(Number.NaN).level).toBe(0)
  })

  it('caps never raise what the owner set, only lower it', () => {
    const owner: GraphicsPrefs = { ...GRAPHICS_PREFS_DEFAULT, shadows: 'avatars', shadowQuality: 'low', shadowRefresh: '30', groundSharpness: 1 }
    expect(capGraphicsPrefs(owner, capsForLevel(0))).toEqual(owner)
    const top: GraphicsPrefs = { ...GRAPHICS_PREFS_DEFAULT, shadows: 'all', shadowQuality: 'high', shadowRefresh: 'frame', groundSharpness: 4 }
    expect(capGraphicsPrefs(top, capsForLevel(1))).toMatchObject({ shadows: 'all', shadowRefresh: '60', groundSharpness: 4 })
    expect(capGraphicsPrefs(top, capsForLevel(2))).toMatchObject({ shadows: 'avatars', shadowQuality: 'medium' })
    expect(capGraphicsPrefs(top, capsForLevel(3))).toMatchObject({ groundSharpness: 1 })
    expect(capGraphicsPrefs(top, capsForLevel(4))).toMatchObject({ shadows: 'off' })
    // Auto refresh is slower than every frame, faster than 60: level 1 brings it to 60.
    expect(capGraphicsPrefs({ ...top, shadowRefresh: 'auto' }, capsForLevel(1)).shadowRefresh).toBe('60')
  })

  it('the modes: everything on is level 0, saver a fixed level, auto what the watcher says', () => {
    expect(levelForMode('all', 3)).toBe(0)
    expect(levelForMode('saver', 0)).toBe(SAVER_LEVEL)
    expect(levelForMode('auto', 2)).toBe(2)
  })
})

describe('FlopWatcher', () => {
  it('does nothing while the frame rate is fine', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    t = run(w, 60, 120, t)
    expect(w.level).toBe(0)
  })

  it('judges nothing during the warm-up (shaders compiling, the world loading)', () => {
    const w = new FlopWatcher()
    run(w, 10, FLOP_WARMUP_S - 1, 0)
    expect(w.level).toBe(0)
  })

  it('steps down one level after a few seconds under 30, and keeps stepping while it stays under', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    t = run(w, 24, FLOP_DOWN_AFTER_S - 1.5, t)
    expect(w.level).toBe(0)
    t = run(w, 24, 2, t)
    expect(w.level).toBe(1)
    t = run(w, 24, FLOP_DOWN_AFTER_S + 0.5, t)
    expect(w.level).toBe(2)
    t = run(w, 20, 120, t)
    expect(w.level).toBe(MAX_FLOP_LEVEL)
  })

  it('a short dip does not count; a frame rate between 30 and 50 holds the level where it is', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    for (let i = 0; i < 20; i++) { t = run(w, 24, 2, t); t = run(w, 60, 1, t) }
    expect(w.level).toBe(0)
    t = run(w, 20, 7, t)
    expect(w.level).toBe(1)
    t = run(w, 40, 300, t)
    expect(w.level).toBe(1)
  })

  it('steps back up only after a long stretch well above 30', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    t = run(w, 20, 7, t)
    expect(w.level).toBe(1)
    t = run(w, 60, FLOP_UP_AFTER_S - 2, t)
    expect(w.level).toBe(1)
    t = run(w, 60, 3, t)
    expect(w.level).toBe(0)
  })

  it('does not flap: a level that fails again right after stepping up to it is tried later each time', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    t = run(w, 20, 7, t)                         // down to 1
    expect(w.level).toBe(1)
    const changes: number[] = []
    let last = w.level
    // A machine that runs 60 fps at level 1 and 22 fps at level 0, for 20 minutes.
    for (let s = 0; s < 1200; s++) {
      t = run(w, w.level === 0 ? 22 : 60, 1, t)
      if (w.level !== last) { changes.push(s); last = w.level }
    }
    // Back up, down again, each try further apart: a handful of changes, not hundreds.
    expect(changes.length).toBeLessThanOrEqual(10)
    expect(w.upWaitFor(0)).toBeGreaterThan(FLOP_UP_AFTER_S)
  })

  it('a hidden tab or a load hitch is skipped, not counted as slow', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    for (let i = 0; i < 20; i++) { t += 2000; w.frame(2000, t) }
    t = run(w, 60, 2, t)
    expect(w.level).toBe(0)
  })

  it('reset puts it back to level 0', () => {
    const w = new FlopWatcher()
    let t = warm(w)
    t = run(w, 10, 30, t)
    expect(w.level).toBeGreaterThan(0)
    w.reset()
    expect(w.level).toBe(0)
  })
})

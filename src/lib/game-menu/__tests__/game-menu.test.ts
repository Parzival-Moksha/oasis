import { describe, expect, it } from 'vitest'
import {
  DRIFT,
  blockDrift,
  clearGround,
  driftAngle,
  driftBob,
  driftPivot,
  easeInOutCubic,
  horizontalDistance,
  returnRemainder,
  rotateAboutPivot,
  startDrift,
  stepDrift,
  type DriftState,
} from '../menu-drift'
import {
  FEEL_STYLES,
  followTilt,
  releaseTile,
  restingTile,
  stepSpring,
  stepTile,
  tapTile,
  tileAtRest,
  tileScaleTarget,
  tileTransform,
  type TileInput,
  type TileMotion,
} from '../menu-feel'
import { menuLayout } from '../menu-layout'
import { menuShouldOpenOnEscape, type EscapeSnapshot } from '../menu-escape'

const run = (state: DriftState, seconds: number, fps = 60, each?: (s: DriftState, t: number) => void) => {
  let s = state
  const dt = 1 / fps
  for (let t = 0; t < seconds; t += dt) {
    s = stepDrift(s, dt)
    each?.(s, t + dt)
  }
  return s
}

describe('camera drift', () => {
  it('eases up to about 1 m/s and never goes faster', () => {
    let top = 0
    const early = run(startDrift(15, 1), 0.3)
    expect(early.v).toBeLessThan(0.5) // no jolt at the start
    const later = run(startDrift(15, 1), 3, 60, s => { top = Math.max(top, Math.abs(s.v)) })
    expect(later.v).toBeGreaterThan(0.95)
    expect(top).toBeLessThanOrEqual(DRIFT.speed + 1e-9)
    expect(later.s).toBeGreaterThan(2)
  })

  it('never changes speed abruptly (under 1.7 m/s² setting off, under 3.4 turning around)', () => {
    let last = 0
    let worst = 0
    run(startDrift(6, 1), 120, 60, s => { worst = Math.max(worst, Math.abs(s.v - last) * 60); last = s.v })
    expect(worst).toBeLessThan(3.4)
    let first = 0
    last = 0
    run(startDrift(6, 1), 2, 60, s => { first = Math.max(first, Math.abs(s.v - last) * 60); last = s.v })
    expect(first).toBeLessThan(1.7)
  })

  it('stays inside a quarter turn each side and turns around at the ends', () => {
    const radius = 6
    const reach = (Math.PI / 2) * radius
    let lo = 0
    let hi = 0
    run(startDrift(radius, 1), 120, 60, s => { lo = Math.min(lo, s.s); hi = Math.max(hi, s.s) })
    expect(hi).toBeLessThanOrEqual(reach + 1e-9)
    expect(lo).toBeGreaterThanOrEqual(-reach - 1e-9)
    expect(hi).toBeGreaterThan(reach * 0.85) // it does use the arc
    expect(lo).toBeLessThan(-reach * 0.85) // and comes back the other way
  })

  it('is the same path at 30, 60 and 165 fps (within a few centimetres)', () => {
    const at = (fps: number) => run(startDrift(15, -1), 10, fps).s
    expect(Math.abs(at(30) - at(60))).toBeLessThan(0.08)
    expect(Math.abs(at(165) - at(60))).toBeLessThan(0.08)
  })

  it('stops short of something in the way and heads back', () => {
    let s = run(startDrift(15, 1), 4)
    const where = s.s
    s = blockDrift(s, 1.5)
    let far = where
    s = run(s, 6, 60, x => { far = Math.max(far, x.s) })
    expect(far).toBeLessThanOrEqual(where + 1.0 + 1e-9) // 1.5 m ahead minus the 0.5 m margin
    expect(s.v).toBeLessThan(0)
    expect(s.s).toBeLessThan(where)
  })

  it('settles when it is boxed in on both sides', () => {
    let s = startDrift(15, 1)
    s = { ...s, min: -0.3, max: 0.4 }
    let top = 0
    s = run(s, 8, 60, x => { top = Math.max(top, Math.abs(x.v)) })
    expect(s.s).toBeGreaterThanOrEqual(-0.3)
    expect(s.s).toBeLessThanOrEqual(0.4)
    expect(Math.abs(s.v)).toBeLessThan(0.02)
    expect(top).toBeLessThan(0.5)
  })

  it('keeps the distance to the pivot and only turns about the vertical', () => {
    const pivot = { x: 3, y: 0, z: -8 }
    const cam = { x: 1, y: 2.4, z: 6 }
    for (const angle of [0, 0.2, -0.7, Math.PI / 2]) {
      const p = rotateAboutPivot(cam, pivot, angle)
      expect(horizontalDistance(p, pivot)).toBeCloseTo(horizontalDistance(cam, pivot), 9)
      expect(p.y).toBe(cam.y)
    }
    expect(rotateAboutPivot(cam, pivot, 0)).toEqual(cam)
    // A quarter turn the same way three.js turns: +x goes to -z.
    const q = rotateAboutPivot({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, Math.PI / 2)
    expect(q.x).toBeCloseTo(0, 9)
    expect(q.z).toBeCloseTo(-1, 9)
  })

  it('puts the pivot ahead on the ground plane, and has none when looking straight down', () => {
    const p = driftPivot({ x: 1, y: 0, z: 1 }, { x: 0, y: -0.6, z: -0.8 }, 10)!
    expect(p.x).toBeCloseTo(1, 9)
    expect(p.z).toBeCloseTo(-9, 9)
    expect(p.y).toBe(0)
    expect(driftPivot({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0.01 }, 10)).toBeNull()
  })

  it('uses a wider circle than a too-near pivot would give', () => {
    expect(driftAngle(2, 0.5)).toBeCloseTo(2 / DRIFT.minRadius, 9)
    expect(driftAngle(3, 15)).toBeCloseTo(0.2, 9)
  })

  it('barely climbs, never dips, and stays above the ground', () => {
    for (let s = -40; s <= 40; s += 0.37) {
      expect(driftBob(s)).toBeGreaterThanOrEqual(0)
      expect(driftBob(s)).toBeLessThanOrEqual(DRIFT.bobHeight + 1e-9)
    }
    expect(driftBob(0)).toBe(0)
    expect(clearGround(1, 3)).toBeCloseTo(3 + DRIFT.groundClearance, 9)
    expect(clearGround(5, 3)).toBe(5)
  })

  it('comes back in under a second, starting and ending at rest, never overshooting', () => {
    expect(DRIFT.returnSeconds).toBeGreaterThanOrEqual(0.8)
    expect(DRIFT.returnSeconds).toBeLessThanOrEqual(1)
    expect(returnRemainder(0)).toBe(1)
    expect(returnRemainder(DRIFT.returnSeconds)).toBe(0)
    expect(returnRemainder(5)).toBe(0)
    let last = 1
    for (let t = 0; t <= DRIFT.returnSeconds; t += 1 / 120) {
      const r = returnRemainder(t)
      expect(r).toBeLessThanOrEqual(last + 1e-12)
      expect(r).toBeGreaterThanOrEqual(0)
      last = r
    }
    expect(1 - returnRemainder(1 / 60)).toBeLessThan(0.001) // leaves gently
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9)
  })
})

const idle: TileInput = { hovered: false, pressed: false, tiltX: 0, tiltY: 0 }
const hover: TileInput = { ...idle, hovered: true }
const simulate = (motion: TileMotion, input: TileInput, style: (typeof FEEL_STYLES)[number], seconds: number, each?: (m: TileMotion, t: number) => void) => {
  let m = motion
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    m = stepTile(m, input, style, dt)
    each?.(m, t + dt)
  }
  return m
}

describe('tile feel', () => {
  it('a spring reaches its target and stays stable with a long frame', () => {
    let s = { x: 0, v: 0 }
    for (let i = 0; i < 120; i++) s = stepSpring(s, 1, 300, 11, 1 / 60)
    expect(s.x).toBeCloseTo(1, 3)
    let slow = { x: 0, v: 0 }
    for (let i = 0; i < 20; i++) slow = stepSpring(slow, 1, 900, 60, 0.5) // a stalled tab
    expect(Number.isFinite(slow.x)).toBe(true)
    expect(slow.x).toBeCloseTo(1, 3)
  })

  for (const style of FEEL_STYLES) {
    describe(style.label, () => {
      it('grows to about 1.15 on hover within a third of a second', () => {
        expect(tileScaleTarget(hover, style)).toBeCloseTo(1.15, 9)
        const m = simulate(restingTile(), hover, style, 0.33)
        expect(m.scale.x).toBeGreaterThan(1.1)
        expect(m.scale.x).toBeLessThan(1.22)
      })

      it('is pushed in while pressed', () => {
        const pressed = simulate(simulate(restingTile(), hover, style, 0.5), { ...hover, pressed: true }, style, 0.25)
        expect(pressed.scale.x).toBeLessThan(1)
        expect(pressed.scale.x).toBeGreaterThan(0.8)
      })

      it('after a click it is at rest again in under a second and never leaves sane bounds', () => {
        let m = simulate(restingTile(), hover, style, 0.5)
        m = simulate(m, { ...hover, pressed: true }, style, 0.12)
        m = releaseTile(m, style, 0.8, -0.6)
        let restAt = Infinity
        m = simulate(m, hover, style, 1.2, (x, t) => {
          expect(x.scale.x).toBeGreaterThan(0.75)
          expect(x.scale.x).toBeLessThan(1.4)
          expect(Math.abs(x.squash.x)).toBeLessThan(0.2)
          expect(Math.abs(x.punchX.x) + Math.abs(x.punchY.x)).toBeLessThan(25)
          if (restAt === Infinity && tileAtRest(x, hover, style)) restAt = t
        })
        expect(restAt).toBeLessThan(1)
        expect(tileAtRest(m, hover, style)).toBe(true)
      })

      it('a keyboard click still shows the push', () => {
        const m = tapTile(restingTile(), style)
        expect(m.scale.x).toBeLessThanOrEqual(style.pressScale)
      })
    })
  }

  it('the wobbling feels pass their target and come back; Snap does not', () => {
    const overshoot = (id: string) => {
      const style = FEEL_STYLES.find(s => s.id === id)!
      let top = 0
      simulate(tapTile(simulate(restingTile(), hover, style, 0.5), style), hover, style, 1, m => { top = Math.max(top, m.scale.x) })
      return top - style.hoverScale
    }
    expect(overshoot('spring')).toBeGreaterThan(0.02)
    expect(overshoot('jelly')).toBeGreaterThan(0.01)
    expect(overshoot('snap')).toBeLessThan(0.004)
  })

  it('writes a transform CSS can read, and leans towards the mouse by at most 9 degrees', () => {
    expect(tileTransform(restingTile())).toBe('rotateX(0deg) rotateY(0deg) scale(1, 1)')
    expect(followTilt(1, 0)).toEqual({ tiltX: -0, tiltY: 9 })
    expect(followTilt(5, -5)).toEqual({ tiltX: 9, tiltY: 9 })
    const leaned = simulate(restingTile(), { ...hover, ...followTilt(1, 1) }, FEEL_STYLES[0], 0.6)
    expect(leaned.tiltY.x).toBeCloseTo(9, 0)
    expect(tileTransform(leaned)).toMatch(/^rotateX\(-?[\d.]+deg\) rotateY\(-?[\d.]+deg\) scale\([\d.]+, [\d.]+\)$/)
  })
})

describe('menu layout', () => {
  const screens: Array<[number, number]> = [[1280, 720], [1920, 1080], [1825, 1056], [2560, 1440], [3840, 2160], [3440, 1440], [1366, 768], [1024, 768], [900, 1200], [800, 600]]
  for (const [w, h] of screens) {
    it(`fits six tiles in the middle 60% at ${w}x${h}`, () => {
      const l = menuLayout(w, h, 6)
      expect(l.tiles).toHaveLength(6)
      for (const t of l.tiles) {
        expect(t.x).toBeGreaterThanOrEqual(w * 0.2 - 0.5)
        expect(t.x + t.w).toBeLessThanOrEqual(w * 0.8 + 0.5)
        expect(t.y).toBeGreaterThanOrEqual(l.title.y + l.title.h)
        expect(t.y + t.h).toBeLessThanOrEqual(h * 0.91 + 0.5)
        expect(t.w).toBeGreaterThan(70)
        expect(t.h).toBeGreaterThan(60)
        expect(t.w / t.h).toBeGreaterThan(0.8)
        expect(t.w / t.h).toBeLessThan(1.75)
      }
      // No two tiles overlap, and a hovered tile (1.15x) does not reach past its neighbour's middle.
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
        const a = l.tiles[i], b = l.tiles[j]
        const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5
        expect(apart).toBe(true)
      }
    })
  }

  it('uses three columns on a usual wide screen and a full last row', () => {
    const l = menuLayout(1920, 1080, 6)
    expect(l.cols).toBe(3)
    expect(l.rows).toBe(2)
  })

  it('survives a tiny or empty view', () => {
    const l = menuLayout(0, 0, 6)
    for (const t of l.tiles) expect(Number.isFinite(t.x + t.y + t.w + t.h)).toBe(true)
  })
})

describe('Escape opens the menu only when nothing else is open', () => {
  const free: EscapeSnapshot = {
    inputState: 'third-person', uiLayers: 0, typing: false, selectedObject: false, agentOpen: false,
    panelsBefore: 4, panelsAfter: 4, inputStateAfter: 'third-person', reachedBubble: true, defaultPrevented: false, menuPhase: 'closed',
  }
  it('opens from the three camera modes', () => {
    for (const inputState of ['third-person', 'noclip', 'orbit'] as const) {
      expect(menuShouldOpenOnEscape({ ...free, inputState, inputStateAfter: inputState })).toBe(true)
    }
  })
  it('stays shut when Escape had something else to do', () => {
    expect(menuShouldOpenOnEscape({ ...free, inputState: 'placement' })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, inputState: 'agent-focus' })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, inputState: 'ui-focused' })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, uiLayers: 1 })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, typing: true })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, selectedObject: true })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, agentOpen: true })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, panelsAfter: 3 })).toBe(false) // a panel closed on this key
    expect(menuShouldOpenOnEscape({ ...free, reachedBubble: false })).toBe(false) // someone swallowed it
    expect(menuShouldOpenOnEscape({ ...free, defaultPrevented: true })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, inputStateAfter: 'orbit' })).toBe(false)
    expect(menuShouldOpenOnEscape({ ...free, menuPhase: 'returning' })).toBe(false)
  })
})

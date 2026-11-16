// How a main-menu tile answers the mouse: plain spring maths, no DOM.
//
// A tile has a handful of springs (scale, squash, a punch tilt, the mouse-follow tilt). Hover moves
// the scale spring's target to about 1.15; pressing pushes it in; letting go gives the springs a
// kick, and the under-damped ones wobble out in well under a second. A "feel" is one set of spring
// numbers. The owner picks between them in Settings > Experiments.

export interface Spring { x: number; v: number }

const SUBSTEP = 1 / 240

/** A damped spring pulled towards `target`. Fixed small substeps keep it stable at any frame rate. */
export function stepSpring(spring: Spring, target: number, stiffness: number, damping: number, dt: number): Spring {
  let { x, v } = spring
  let left = Math.min(Math.max(dt, 0), 0.1)
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left)
    v += (-stiffness * (x - target) - damping * v) * h
    x += v * h
    left -= h
  }
  return { x, v }
}

export type FeelId = 'spring' | 'jelly' | 'snap' | 'punch'

export interface FeelStyle {
  id: FeelId
  label: string
  blurb: string
  hoverScale: number
  pressScale: number
  /** The scale spring. */
  stiffness: number
  damping: number
  /** Speed added to the scale when the press is let go (scale units a second, outwards). */
  releaseKick: number
  /** Squash and stretch: width and height wobble against each other. 0 for none. */
  squashKick: number
  /** A tilt away from the point that was clicked, degrees a second. 0 for none. */
  punchKick: number
}

export const FEEL_STYLES: FeelStyle[] = [
  {
    id: 'spring', label: 'Spring', blurb: 'Pushed in, then a soft wobble that dies in half a second.',
    hoverScale: 1.15, pressScale: 0.9, stiffness: 300, damping: 13, releaseKick: 1.2, squashKick: 0, punchKick: 0,
  },
  {
    id: 'jelly', label: 'Jelly', blurb: 'Squashes wide and tall like something soft.',
    hoverScale: 1.15, pressScale: 0.88, stiffness: 240, damping: 12, releaseKick: 0.8, squashKick: 2, punchKick: 0,
  },
  {
    id: 'snap', label: 'Snap', blurb: 'Fast and exact, no wobble.',
    hoverScale: 1.15, pressScale: 0.95, stiffness: 900, damping: 60, releaseKick: 0, squashKick: 0, punchKick: 0,
  },
  {
    id: 'punch', label: 'Punch', blurb: 'Tips away from where you hit it, then rocks back.',
    hoverScale: 1.15, pressScale: 0.9, stiffness: 320, damping: 14, releaseKick: 1, squashKick: 0, punchKick: 260,
  },
]

export const DEFAULT_FEEL: FeelId = 'spring'

export function feelStyle(id: FeelId): FeelStyle {
  return FEEL_STYLES.find(s => s.id === id) ?? FEEL_STYLES[0]
}

export interface TileMotion {
  scale: Spring
  squash: Spring
  punchX: Spring
  punchY: Spring
  tiltX: Spring
  tiltY: Spring
}

export interface TileInput {
  hovered: boolean
  pressed: boolean
  /** Mouse-follow tilt the tile should lean to, degrees (0 when the option is off or not hovered). */
  tiltX: number
  tiltY: number
}

export const restingTile = (): TileMotion => ({
  scale: { x: 1, v: 0 },
  squash: { x: 0, v: 0 },
  punchX: { x: 0, v: 0 },
  punchY: { x: 0, v: 0 },
  tiltX: { x: 0, v: 0 },
  tiltY: { x: 0, v: 0 },
})

export function tileScaleTarget(input: TileInput, style: FeelStyle): number {
  if (input.pressed) return style.pressScale
  return input.hovered ? style.hoverScale : 1
}

export function stepTile(motion: TileMotion, input: TileInput, style: FeelStyle, dt: number): TileMotion {
  return {
    scale: stepSpring(motion.scale, tileScaleTarget(input, style), style.stiffness, style.damping, dt),
    squash: stepSpring(motion.squash, 0, 210, 11, dt),
    punchX: stepSpring(motion.punchX, 0, 230, 13, dt),
    punchY: stepSpring(motion.punchY, 0, 230, 13, dt),
    tiltX: stepSpring(motion.tiltX, input.tiltX, 170, 22, dt),
    tiltY: stepSpring(motion.tiltY, input.tiltY, 170, 22, dt),
  }
}

/**
 * The press is let go at (px, py), each from -1 (left / top edge of the tile) to 1: the springs get
 * their kick. Without it the tile would only glide back out.
 */
export function releaseTile(motion: TileMotion, style: FeelStyle, px = 0, py = 0): TileMotion {
  return {
    ...motion,
    scale: { x: motion.scale.x, v: motion.scale.v + style.releaseKick },
    squash: { x: motion.squash.x, v: motion.squash.v + style.squashKick },
    // Hit on the right edge: the right edge goes away from you (a turn about the vertical axis).
    punchY: { x: motion.punchY.x, v: motion.punchY.v + style.punchKick * px },
    punchX: { x: motion.punchX.x, v: motion.punchX.v - style.punchKick * py },
  }
}

/** A click that never showed a press (keyboard, a very fast tap): start from pushed in. */
export function tapTile(motion: TileMotion, style: FeelStyle, px = 0, py = 0): TileMotion {
  return releaseTile({ ...motion, scale: { x: Math.min(motion.scale.x, style.pressScale), v: 0 } }, style, px, py)
}

export function tileAtRest(motion: TileMotion, input: TileInput, style: FeelStyle): boolean {
  const near = (s: Spring, target: number, eps: number) => Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 12
  // Thresholds are what the eye can see: a third of a percent of size, a seventh of a degree.
  return near(motion.scale, tileScaleTarget(input, style), 0.003)
    && near(motion.squash, 0, 0.003)
    && near(motion.punchX, 0, 0.15)
    && near(motion.punchY, 0, 0.15)
    && near(motion.tiltX, input.tiltX, 0.15)
    && near(motion.tiltY, input.tiltY, 0.15)
}

const f = (n: number, digits = 4) => {
  const p = Math.pow(10, digits)
  return String(Math.round(n * p) / p)
}

/** The CSS transform for a tile (its parent supplies the perspective). */
export function tileTransform(motion: TileMotion): string {
  const sx = motion.scale.x * (1 + motion.squash.x)
  const sy = motion.scale.x * (1 - motion.squash.x)
  const rx = motion.tiltX.x + motion.punchX.x
  const ry = motion.tiltY.x + motion.punchY.x
  return `rotateX(${f(rx, 2)}deg) rotateY(${f(ry, 2)}deg) scale(${f(sx)}, ${f(sy)})`
}

/** Mouse-follow tilt for a pointer at (px, py) in -1..1 across the tile. */
export function followTilt(px: number, py: number, maxDegrees = 9): { tiltX: number; tiltY: number } {
  const clamp = (n: number) => Math.max(-1, Math.min(1, n))
  return { tiltX: -clamp(py) * maxDegrees, tiltY: clamp(px) * maxDegrees }
}

// ░▒▓ SUN SHADOW — one shadow map from the world's sun, kept cheap ▓▒░
// The world's first directional light is the sun (it already shades everything, so its shadows
// agree with the lighting; put it where the sky's sun is, see public/skies/README.md). One shadow
// map covers a square around what the camera looks at. Costs are kept down three ways:
//   - the map follows the view in whole texels of the map, so shadow edges do not swim;
//   - it is redrawn when needed (see shadowRefreshDue): on every frame while a caster in range
//     moves, 60 times a second otherwise, or as often as the owner set. Moving or turning the
//     camera alone never redraws it: the map lives in the world;
//   - "avatars only" keeps world objects out of the shadow pass altogether.

import { Matrix4, Vector3 } from 'three'

/** Half the side of the square the shadow map covers, metres. */
export const SUN_SHADOW_HALF_SIZE = 32
/** Shadow map side in texels per quality (over 64 m: 6.3, 3.1 and 1.6 cm of ground per texel). */
export const SUN_SHADOW_MAP_SIZES = { low: 1024, medium: 2048, high: 4096 } as const
/** The blur at a shadow's edge, metres, at softness 0 and 1. */
export const SUN_SHADOW_BLUR_M = [0.015, 0.09] as const

/** Metres of ground one texel of the map covers. */
export function shadowTexelMetres(mapSize: number): number {
  return (SUN_SHADOW_HALF_SIZE * 2) / mapSize
}

/**
 * The filter radius in texels for a softness (0..1). The same softness blurs the same width on
 * the ground at every quality; it is never under one texel (that is what looks pixelated) and
 * capped at six, where the 17-tap filter starts to show its taps as bands.
 */
export function shadowRadiusTexels(softness: number, mapSize: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(softness) ? softness : 0.5))
  const metres = SUN_SHADOW_BLUR_M[0] + (SUN_SHADOW_BLUR_M[1] - SUN_SHADOW_BLUR_M[0]) * s
  return Math.min(6, Math.max(1, metres / shadowTexelMetres(mapSize)))
}

/** Strength (0..1) → the share of ambient and sky light a shadow takes away (0: three's plain shadow). */
export function shadowAmbientDim(strength: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0.5))
  return s * 0.9
}
/** How far from the covered area the light sits (it must clear the tallest caster). */
export const SUN_SHADOW_DISTANCE = 90
/** The map's centre sits this far ahead of the camera, on the ground. */
export const SUN_SHADOW_LEAD = 14
/** The map's centre moves in steps of this many metres (then onto the texel grid), so it is not redrawn for every small turn of the camera. */
export const SUN_SHADOW_CENTER_STEP = 4
/** A sun lower than this (sine of its elevation) casts shadows too long to be worth a map: about 4 degrees. */
export const SUN_SHADOW_MIN_ELEVATION = 0.07

const _up = new Vector3(0, 1, 0)
const _altUp = new Vector3(0, 0, 1)
const _view = new Matrix4()
const _inverse = new Matrix4()
const _point = new Vector3()
const _origin = new Vector3()

/** Unit vector from the scene toward the sun, from a directional light's position (it shines at the origin). Null: no usable sun. */
export function sunDirection(position: readonly [number, number, number] | null | undefined): Vector3 | null {
  if (!position) return null
  const direction = new Vector3(position[0], position[1], position[2])
  if (!(direction.lengthSq() > 1e-8)) return null
  direction.normalize()
  if (!(direction.y >= SUN_SHADOW_MIN_ELEVATION)) return null
  return direction
}

/**
 * Where the shadow map's centre goes for a wanted centre: the same point moved onto the map's
 * texel grid (as seen from the sun), so that following the camera never shifts the shadow edges
 * by a fraction of a texel. Writes into and returns `out`.
 */
export function snapShadowCenter(wanted: Vector3, toSun: Vector3, texelMetres: number, out: Vector3): Vector3 {
  const up = Math.abs(toSun.y) > 0.99 ? _altUp : _up
  _view.lookAt(toSun, _origin, up) // rotation: the sun's frame → world
  _inverse.copy(_view).invert()
  _point.copy(wanted).applyMatrix4(_inverse)
  _point.x = Math.round(_point.x / texelMetres) * texelMetres
  _point.y = Math.round(_point.y / texelMetres) * texelMetres
  return out.copy(_point).applyMatrix4(_view)
}

export interface ShadowRefreshInput {
  /** The owner's setting: 'auto', every 'frame', or at most '60' / '30' times a second. */
  refresh: 'auto' | 'frame' | '60' | '30'
  /** Milliseconds since the map was last drawn. */
  msSinceDraw: number
  /** The map's centre moved this frame. */
  recentred: boolean
  /** A caster in range changed place this frame or the last few (a body walking, an object being moved). */
  moving: boolean
}

/**
 * Whether to redraw the shadow map this frame. A shadow that is redrawn less often than the
 * screen shows frames visibly steps behind a moving body, so 'auto' redraws on every frame while
 * something moves and drops to 60 a second when all that changes is a body breathing or typing.
 */
export function shadowRefreshDue(input: ShadowRefreshInput): boolean {
  if (input.recentred || input.refresh === 'frame') return true
  // A little under the nominal interval: a 60 Hz frame that arrives 0.5 ms early must not be
  // skipped, or the shadow would be redrawn in an uneven rhythm (which shows as stepping).
  if (input.refresh === 'auto') return input.moving || input.msSinceDraw >= SIXTY_MS
  return input.msSinceDraw >= (input.refresh === '60' ? SIXTY_MS : THIRTY_MS)
}

const SIXTY_MS = 15
const THIRTY_MS = 31

/** After the last movement, 'auto' keeps redrawing every frame this long (a body easing to a stop). */
export const SUN_SHADOW_MOVING_HOLD_MS = 250

/** The wanted centre of the map: a point ahead of the camera on the ground, in coarse steps. */
export function wantedShadowCenter(camera: { x: number; z: number }, forward: { x: number; z: number }, out: Vector3): Vector3 {
  const length = Math.hypot(forward.x, forward.z)
  const fx = length > 1e-6 ? forward.x / length : 0
  const fz = length > 1e-6 ? forward.z / length : 0
  const step = SUN_SHADOW_CENTER_STEP
  return out.set(
    Math.round((camera.x + fx * SUN_SHADOW_LEAD) / step) * step,
    0,
    Math.round((camera.z + fz * SUN_SHADOW_LEAD) / step) * step,
  )
}

/** Name of the uniform that carries the ambient dim (0: none) into every lit material. */
export const SUN_SHADOW_DIM_UNIFORM = 'oasisSunShadowDim'

/**
 * GLSL for three's shader chunks, so that a sun shadow also takes away part of the ambient and
 * sky light (Oasis worlds are lit mostly by those; a shadow that only blocks the sun's own share
 * barely shows). `declare` goes after `shadowmap_pars_fragment`, `apply` after
 * `lights_fragment_end`. Both only do anything in a shader compiled with a directional shadow
 * map, and with the uniform at 0 (its value when nobody sets it) nothing changes.
 */
export function sunShadowAmbientChunks(): { declare: string; apply: string } {
  return {
    declare: /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  uniform float ${SUN_SHADOW_DIM_UNIFORM};
#endif
`,
    apply: /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    DirectionalLightShadow oasisSunShadow = directionalLightShadows[ 0 ];
    float oasisSunLit = receiveShadow ? getShadow( directionalShadowMap[ 0 ], oasisSunShadow.shadowMapSize, oasisSunShadow.shadowBias, oasisSunShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
    float oasisAmbientKept = mix( 1.0 - ${SUN_SHADOW_DIM_UNIFORM}, 1.0, oasisSunLit );
    reflectedLight.indirectDiffuse *= oasisAmbientKept;
    reflectedLight.indirectSpecular *= oasisAmbientKept;
  }
#endif
`,
  }
}

// ░▒▓ SUN SHADOW — one shadow map from the world's sun, kept cheap ▓▒░
// The world's first directional light is the sun (it already shades everything, so its shadows
// agree with the lighting; put it where the sky's sun is, see public/skies/README.md). One shadow
// map covers a square around what the camera looks at. Costs are kept down three ways:
//   - the map follows the view in whole texels of the map, so shadow edges do not swim;
//   - it is redrawn only when needed: 60 times a second while avatars are the only casters (a
//     handful of draws); with the whole world casting, 30 times a second; and whenever the map moves on.
//     Moving or turning the camera alone never redraws it: the map lives in the world;
//   - "avatars only" keeps world objects out of the shadow pass altogether.

import { Matrix4, Vector3 } from 'three'

/** Half the side of the square the shadow map covers, metres. */
export const SUN_SHADOW_HALF_SIZE = 32
/** Shadow map side, texels (2048: about 3 cm of ground per texel at the size above). */
export const SUN_SHADOW_MAP_SIZE = 2048
/** How far from the covered area the light sits (it must clear the tallest caster). */
export const SUN_SHADOW_DISTANCE = 90
/** The map's centre sits this far ahead of the camera, on the ground. */
export const SUN_SHADOW_LEAD = 14
/** With the whole world casting, the map is redrawn at most this often (ms): 30 times a second. */
export const SUN_SHADOW_WORLD_INTERVAL_MS = 33
/** With only avatars casting: 60 times a second (on a 165 Hz screen, not on every frame). */
export const SUN_SHADOW_AVATAR_INTERVAL_MS = 16
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
  /** 'avatars': only bodies cast. 'all': the world casts too. */
  mode: 'avatars' | 'all'
  /** Milliseconds since the map was last drawn. */
  msSinceDraw: number
  /** The map's centre moved this frame. */
  recentred: boolean
}

/** Whether to redraw the shadow map this frame. */
export function shadowRefreshDue(input: ShadowRefreshInput): boolean {
  if (input.recentred) return true
  return input.msSinceDraw >= (input.mode === 'avatars' ? SUN_SHADOW_AVATAR_INTERVAL_MS : SUN_SHADOW_WORLD_INTERVAL_MS)
}

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

/**
 * How much of the ambient and sky light a sun shadow also takes away (0: none, as three does it).
 * Oasis worlds are lit mostly by the sky image and an ambient light, so a shadow that only removed
 * the sun's own share was barely visible.
 */
export const SUN_SHADOW_AMBIENT_DIM = 0.45

/**
 * GLSL appended to three's `lights_fragment_end` chunk (standard, phong, lambert and toon
 * materials). It only does anything in a shader compiled with a directional shadow map, so with
 * shadows off every material renders exactly as before.
 */
export function sunShadowAmbientChunk(dim = SUN_SHADOW_AMBIENT_DIM): string {
  return /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    DirectionalLightShadow oasisSunShadow = directionalLightShadows[ 0 ];
    float oasisSunLit = receiveShadow ? getShadow( directionalShadowMap[ 0 ], oasisSunShadow.shadowMapSize, oasisSunShadow.shadowBias, oasisSunShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
    float oasisAmbientKept = mix( ${(1 - dim).toFixed(3)}, 1.0, oasisSunLit );
    reflectedLight.indirectDiffuse *= oasisAmbientKept;
    reflectedLight.indirectSpecular *= oasisAmbientKept;
  }
#endif
`
}

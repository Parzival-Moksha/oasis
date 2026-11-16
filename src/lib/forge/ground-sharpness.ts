// ░▒▓ GROUND SHARPNESS — more texels per metre of ground, for free on the CPU ▓▒░
// The base ground stretches one 1024 px image over 12-25 m (40-80 px a metre), and until now it
// was sampled without anisotropic filtering, which is what smears a floor seen at a low angle.
// Sharper ground, in three parts, all on the GPU:
//   1. anisotropic filtering at the GPU's maximum (the big one at eye level);
//   2. a detail layer on the base ground: the same texture sampled again `sharpness` times finer
//      and multiplied in as a ratio to its own average colour, so the big shapes and the overall
//      colour stay where they were and no new tiling pattern shows from above;
//   3. painted cells that were stretched over several metres repeat the texture inside the cell
//      (up to `sharpness` times), instead of one image pulled over 4 x 4 m.

import type { GroundSharpness } from '../graphics-prefs'

/** How strongly the detail layer shows (0: not at all, 1: full contrast of the texture again). */
export const GROUND_DETAIL_STRENGTH = 0.75

/** Texture repeats inside one painted cell that spans `stretch` metres: never finer than one image a metre. */
export function paintedCellRepeat(stretch: number, sharpness: GroundSharpness): number {
  const cell = Math.max(1, Math.floor(Number.isFinite(stretch) ? stretch : 1))
  return Math.max(1, Math.min(cell, sharpness))
}

/** Anisotropy for ground textures: the GPU's most when sharpening, plain trilinear otherwise. */
export function groundAnisotropy(sharpness: GroundSharpness, gpuMax: number): number {
  return sharpness > 1 ? Math.max(1, gpuMax) : 1
}

/** Detail layer frequency against the base layer (1: no detail layer). */
export function groundDetailScale(sharpness: GroundSharpness): number {
  return sharpness
}

/** Pixels of source texture per metre of base ground, before and after (for the log and the menu hint). */
export function groundTexelsPerMetre(textureSize: number, repeat: number, groundMetres: number, sharpness: GroundSharpness): number {
  return (textureSize * repeat * groundDetailScale(sharpness)) / groundMetres
}

/**
 * The fragment shader piece that adds the detail layer. Replaces three's `#include <map_fragment>`.
 * `texture2D(map, uv, 16.0)` reads the smallest mip: the texture's average colour.
 */
export const GROUND_DETAIL_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  if ( uGroundDetail > 1.0 ) {
    vec2 detailUv = vMapUv * uGroundDetail;
    vec3 detail = texture2D( map, detailUv ).rgb;
    vec3 average = max( texture2D( map, detailUv, 16.0 ).rgb, vec3( 0.02 ) );
    sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), detail / average, uGroundDetailStrength );
  }
  diffuseColor *= sampledDiffuseColor;
#endif
`

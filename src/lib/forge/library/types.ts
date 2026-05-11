// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIBRARY — Unified asset descriptor
// ─═̷─═̷─📚─═̷─═̷─ The shape every asset in the Oasis collapses to ─═̷─═̷─📚─═̷─═̷─
//
// This file defines the v0 schema. It mirrors the Prisma `Asset` model and
// the JSON shape we'll eventually consolidate `core` entries into. Until
// v1 retires the constants.ts arrays, the merge happens at read time in
// library-service.ts.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export type AssetKind =
  | 'glb'         // 3D model — GLB binary
  | 'gltf'        // 3D model — glTF JSON + sibling .bin + textures
  | 'vrm'         // VRM humanoid avatar
  | 'sound'       // .ogg / .mp3 / .wav sound effect or music
  | 'ground'      // Tileable ground/material texture (PNG/JPG)
  | 'sky'         // HDRI environment / sky background
  | 'conjured'    // AI-generated GLB (Meshy, Tripo, Hunyuan)
  | 'crafted'     // Procedural scene built from primitives

export type AssetScope = 'core' | 'shared' | 'user'

export type WorldAssetVisibility = 'public' | 'private'

export interface LibraryAsset {
  id: string
  kind: AssetKind
  path: string
  name: string
  category?: string | null
  shortLabel?: string | null
  description?: string | null
  defaultScale?: number
  /** [w, h, d] in meters at defaultScale, or null if not yet computed. */
  bbox?: [number, number, number] | null
  thumbnailUrl?: string | null
  bytes?: number | null
  scope: AssetScope
  /** null for core/shared. */
  ownerId?: string | null
  source?: string | null
  license?: string | null
  tags?: string[] | null
}

export interface AssetVisibilityContext {
  /** Current viewer's user id. With local-auth this is always 'local-user'. */
  viewerUserId: string
  /** World's assetVisibility setting, if we're rendering in a world context. */
  worldAssetVisibility?: WorldAssetVisibility
  /** World owner's user id, if we're rendering in a world context. */
  worldOwnerId?: string | null
}

/** A user-scope asset is visible to a viewer if any of these hold:
 *  - the viewer owns the asset
 *  - we're in a public-visibility world and the asset is the world owner's
 *  - (TODO once auth: explicit per-asset grants)
 *
 *  A user-scope asset with a NULL ownerId is treated as orphaned — invisible
 *  to all viewers. This shouldn't happen in normal flow (mirror always sets
 *  ownerId from `getLocalUserId()`) but if a partial backfill or a race
 *  produces one, hiding it is safer than leaking it to everyone.
 */
export function canViewAsset(asset: LibraryAsset, ctx: AssetVisibilityContext): boolean {
  if (asset.scope === 'core' || asset.scope === 'shared') return true
  if (!asset.ownerId) return false   // orphaned user-scope row — invisible
  if (asset.ownerId === ctx.viewerUserId) return true
  if (ctx.worldAssetVisibility === 'public' && asset.ownerId === ctx.worldOwnerId) return true
  return false
}

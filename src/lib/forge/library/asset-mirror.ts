// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ASSET MIRROR — Parallel writes from legacy registries -> Asset table
// ─═̷─═̷─🪞─═̷─═̷─ v1 keeps both stores; v2 retires the legacy ones ─═̷─═̷─🪞─═̷─═̷─
//
// Every conjured asset that completes (status='ready') gets a sibling row
// in the new `Asset` table tagged scope='user' + ownerId=<viewer cookie id>.
// Idempotent: if an Asset row already exists for the same conjured id,
// we update it instead of creating a duplicate.
//
// Called fire-and-forget from registry.updateAsset() so the synchronous
// registry contract stays unchanged. Failures are logged, not propagated.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { prisma } from '../../db'
import type { ConjuredAsset, CraftedScene } from '../../conjure/types'

/** Bridge a conjured asset into the unified Asset table. Idempotent. */
export async function mirrorConjuredAsset(asset: ConjuredAsset, ownerId: string): Promise<void> {
  if (asset.status !== 'ready' || !asset.glbPath) return
  const name = asset.displayName || asset.prompt.slice(0, 60) || asset.id
  const bytes = typeof asset.metadata?.fileSizeBytes === 'number' ? asset.metadata.fileSizeBytes : undefined
  try {
    await prisma.asset.upsert({
      where: { id: asset.id },
      create: {
        id: asset.id,
        kind: 'conjured',
        path: asset.glbPath,
        name,
        category: 'conjured',
        defaultScale: asset.scale ?? 1,
        thumbnailUrl: asset.thumbnailUrl,
        bytes,
        scope: 'user',
        ownerId,
        source: `conjure:${asset.provider}:${asset.tier}`,
      },
      update: {
        path: asset.glbPath,
        name,
        thumbnailUrl: asset.thumbnailUrl,
        bytes,
        defaultScale: asset.scale ?? 1,
        ownerId,  // re-stamp owner if it changed
      },
    })
  } catch (err) {
    console.warn('[asset-mirror] conjured upsert failed for', asset.id, err)
  }
}

/** Bridge a crafted scene into the unified Asset table. Idempotent.
 *  Crafted scenes have no GLB file — `path` is a synthetic `crafted://<id>`
 *  marker; consumers resolve the actual primitives via the scene library. */
export async function mirrorCraftedScene(scene: CraftedScene, ownerId: string): Promise<void> {
  if (!scene.id) return
  const name = scene.name || `Crafted scene ${scene.id.slice(0, 8)}`
  try {
    // Serialize the full scene into `data` so /api/worlds/scene-library GET
    // can reconstitute it without touching scene-library.json at read time.
    const serialized = JSON.stringify(scene)
    await prisma.asset.upsert({
      where: { id: scene.id },
      create: {
        id: scene.id,
        kind: 'crafted',
        path: `crafted://${scene.id}`,
        name,
        category: 'crafted',
        defaultScale: 1,
        thumbnailUrl: scene.thumbnailUrl,
        scope: 'user',
        ownerId,
        source: scene.model || 'self-craft',
        data: serialized,
      },
      update: {
        name,
        thumbnailUrl: scene.thumbnailUrl,
        ownerId,
        data: serialized,
      },
    })
  } catch (err) {
    console.warn('[asset-mirror] crafted upsert failed for', scene.id, err)
  }
}

/** Delete an Asset row by id (only if user-scope + ownerId matches). */
export async function deleteMirroredAsset(id: string, requesterUserId: string): Promise<boolean> {
  try {
    const row = await prisma.asset.findUnique({ where: { id } })
    if (!row) return false
    if (row.scope !== 'user')
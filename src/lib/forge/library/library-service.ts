// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIBRARY SERVICE — Server-side aggregator over every asset tier
// ─═̷─═̷─⛩️─═̷─═̷─ Core (TS arrays + JSON extras) + DB (user/shared) ─═̷─═̷─⛩️─═̷─═̷─
//
// In v0 this provides a *parallel* read surface to the legacy code paths
// (ASSET_CATALOG, GROUND_PRESETS, SKY_BACKGROUNDS, conjured registry,
// scene-library). New code can call listAssets() here; old code keeps
// working unchanged until v1 retires the legacy surfaces.
//
// Mutations for user-scope assets go through createUserAsset / deleteAsset.
// Core-tier mutations still go through data/asset-catalog-extras.json +
// data/ground-presets-extras.json (see existing override JSON layer).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { prisma } from '../../db'
import { ASSET_CATALOG } from '../../../components/scene-lib/constants'
import { GROUND_PRESETS } from '../ground-textures'
import { SKY_BACKGROUNDS } from '../../../components/scene-lib/constants'
import type { LibraryAsset, AssetKind, AssetScope } from './types'
import { canViewAsset } from './types'

interface ListOptions {
  /** Viewer identity; used to filter user-scope rows by visibility rules. */
  viewerUserId: string
  /** Optional world context. When provided, we look up the world's
   *  assetVisibility + ownerId so visitors of public-visibility worlds
   *  see the owner's user-scope content too (per
   *  feedback_world_visibility_is_universal: world contents are world-public).
   */
  worldId?: string
  /** Restrict to one tier. Default: all tiers. */
  scope?: AssetScope
  /** Restrict to one kind. Default: all kinds. */
  kind?: AssetKind
  /** Free-text query against id, name, shortLabel, description. */
  query?: string
  /** Cap. */
  limit?: number
}

function pathExtKind(path: string): AssetKind {
  const lower = path.toLowerCase()
  if (lower.endsWith('.vrm')) return 'vrm'
  if (lower.endsWith('.gltf')) return 'gltf'
  if (lower.endsWith('.glb')) return 'glb'
  if (lower.endsWith('.hdr') || lower.endsWith('.exr')) return 'sky'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'ground'
  if (lower.endsWith('.ogg') || lower.endsWith('.mp3') || lower.endsWith('.wav')) return 'sound'
  return 'glb' // sane default for catalog entries
}

/** Stream the static `core`-tier entries from constants.ts arrays. */
function coreAssets(): LibraryAsset[] {
  const out: LibraryAsset[] = []

  for (const a of ASSET_CATALOG) {
    out.push({
      id: a.id,
      kind: pathExtKind(a.path),
      path: a.path,
      name: a.name,
      category: a.category,
      shortLabel: a.shortLabel,
      description: a.description,
      defaultScale: a.defaultScale,
      bbox: a.bbox || null,
      thumbnailUrl: a.thumbnail || `/thumbs/${a.id}.jpg`,
      scope: 'core',
      ownerId: null,
      source: null,
      license: null,
      tags: a.tags ?? null,
    })
  }

  for (const p of GROUND_PRESETS) {
    out.push({
      id: `ground_${p.id}`,
      kind: 'ground',
      path: p.customTextureUrl || (p.assetName ? `/ground/${p.assetName}_diff_1k.jpg` : ''),
      name: p.name,
      category: 'ground',
      shortLabel: p.shortLabel,
      description: p.description,
      defaultScale: 1,
      scope: 'core',
      ownerId: null,
    })
  }

  for (const sky of SKY_BACKGROUNDS) {
    if (!('path' in sky) || !sky.path) continue
    out.push({
      id: `sky_${sky.id}`,
      kind: 'sky',
      path: sky.path,
      name: sky.name,
      category: 'sky',
      scope: 'core',
      ownerId: null,
    })
  }

  return out
}

/** Read user/shared-tier rows from the Asset table. */
async function dbAssets(opts: ListOptions): Promise<LibraryAsset[]> {
  const where: Record<string, unknown> = {}
  if (opts.scope && opts.scope !== 'core') where.scope = opts.scope
  if (opts.kind) where.kind = opts.kind
  const rows = await prisma.asset.findMany({
    where,
    take: Math.min(opts.limit ?? 500, 1000),
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map(rowToLibraryAsset)
}

function rowToLibraryAsset(row: Awaited<ReturnType<typeof prisma.asset.findMany>>[number]): LibraryAsset {
  return {
    id: row.id,
    kind: row.kind as AssetKind,
    path: row.path,
    name: row.name,
    category: row.category,
    shortLabel: row.shortLabel,
    description: row.description,
    defaultScale: row.defaultScale,
    bbox: row.bbox ? safeJsonParseTuple3(row.bbox) : null,
    thumbnailUrl: row.thumbnailUrl,
    bytes: row.bytes,
    scope: row.scope as AssetScope,
    ownerId: row.ownerId,
    source: row.source,
    license: row.license,
    tags: row.tags ? safeJsonParseStringArray(row.tags) : null,
  }
}

function safeJsonParseTuple3(raw: string): [number, number, number] | null {
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr) && arr.length === 3 && arr.every(n => typeof n === 'number')) {
      return arr as [number, number, number]
    }
  } catch {}
  return null
}

function safeJsonParseStringArray(raw: string): string[] | null {
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) return arr as string[]
  } catch {}
  return null
}

/** Aggregate every visible asset for a viewer. v0 = core (always visible) + DB rows filtered by canViewAsset. */
export async function listAssets(opts: ListOptions): Promise<LibraryAsset[]> {
  const viewerUserId = opts.viewerUserId
  const wantsCore = !opts.scope || opts.scope === 'core'
  const wantsDb = !opts.scope || opts.scope !== 'core'

  // Look up the world context so visitors of public worlds see the owner's
  // user-scope content. Failures (world not found, DB hiccup) degrade to
  // "no world context" rather than throwing — better to show core only than
  // to 500 the whole library list.
  let worldAssetVisibility: 'public' | 'private' | undefined
  let worldOwnerId: string | null | undefined
  if (opts.worldId) {
    try {
      const world = await prisma.world.findUnique({
        where: { id: opts.worldId },
        select: { userId: true, assetVisibility: true },
      })
      if (world) {
        worldAssetVisibility = (world.assetVisibility as 'public' | 'private') || 'public'
        worldOwnerId = world.userId
      }
    } catch {}
  }

  const core = wantsCore ? coreAssets() : []
  const db = wantsDb ? await dbAssets(opts) : []

  let merged = [...core, ...db].filter(a => canViewAsset(a, { viewerUserId, worldAssetVisibility, worldOwnerId }))

  if (opts.kind) merged = merged.filter(a => a.kind === opts.kind)
  if (opts.query) {
    const q = opts.query.toLowerCase()
    merged = merged.filter(a =>
      a.id.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      (a.shortLabel || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.category || '').toLowerCase().includes(q) ||
      (Array.isArray(a.tags) && a.tags.some(t => t.toLowerCase().includes(q)))
    )
  }
  if (opts.limit) merged = merged.slice(0, opts.limit)
  return merged
}

export interface CreateUserAssetInput {
  ownerId: string
  kind: AssetKind
  path: string
  name: string
  category?: string
  defaultScale?: number
  shortLabel?: string
  description?: string
  thumbnailUrl?: string
  bbox?: [number, number, number]
  bytes?: number
  source?: string
  license?: string
  tags?: string[]
}

/** Insert a user-scope asset row. */
export async function createUserAsset(input: CreateUserAssetInput) {
  return prisma.asset.create({
    data: {
      ownerId: input.ownerId,
      scope: 'user',
      kind: input.kind,
      path: input.path,
      name: input.name,
      category: input.category,
      defaultScale: input.defaultScale ?? 1,
      shortLabel: input.shortLabel,
      description: input.description,
      thumbnailUrl: input.thumbnailUrl,
      bbox: input.bbox ? JSON.stringify(input.bbox) : undefined,
      bytes: input.bytes,
      source: input.source,
      license: input.license,
      tags: input.tags ? JSON.stringify(input.tags) : undefined,
    },
  })
}

/** Delete an Asset row by id. Only succeeds if scope='user' and ownerId matches. */
export async function deleteUserAsset(id: string, requesterUserId: string): Promise<boolean> {
  const row = await prisma.asset.findUnique({ where: { id } })
  if (!row) return false
  if (row.scope !== 'user') return false
  if (row.ownerId !== requesterUserId) return false
  await prisma.asset.delete({ where: { id } })
  return true
}

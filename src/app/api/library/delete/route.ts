// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/library/delete — One-click banish from the asset library
// ─═̷─═̷─🗑️─═̷─═̷─ Removes catalog/ground entry + (for assets) the GLB on disk
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
// POST { kind: 'asset' | 'ground', id: string, path?: string }
//   - asset: removes from additions OR adds to deletedIds in
//            data/asset-catalog-extras.json. If `path` is provided and lives
//            inside public/, also unlinks the file on disk.
//   - ground: same merge logic against data/ground-presets-extras.json. The
//             underlying texture file is NOT deleted (textures are often
//             seed-shared; clean up by hand if needed).
//
// No auth — local-first single-user. No confirmation required: the UI invokes
// this on first click. Idempotent: re-deleting a missing id is a no-op.

import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

const ROOT = process.cwd()
const PUBLIC_DIR = path.join(ROOT, 'public')
const ASSET_EXTRAS = path.join(ROOT, 'data', 'asset-catalog-extras.json')
const GROUND_EXTRAS = path.join(ROOT, 'data', 'ground-presets-extras.json')

interface ExtrasFile {
  _doc?: string
  deletedIds?: string[]
  additions?: Array<{ id: string; path?: string; [k: string]: unknown }>
}

function resolveInsidePublic(rel: string | undefined | null): string | null {
  if (!rel || typeof rel !== 'string') return null
  const clean = rel.replace(/^\/+/, '')
  const abs = path.resolve(PUBLIC_DIR, clean)
  // Refuse traversal escapes
  const withSep = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep
  if (abs !== PUBLIC_DIR && !abs.startsWith(withSep)) return null
  return abs
}

async function readExtras(file: string): Promise<ExtrasFile> {
  try {
    const raw = await fs.promises.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as ExtrasFile
    return {
      _doc: parsed._doc,
      deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
      additions: Array.isArray(parsed.additions) ? parsed.additions : [],
    }
  } catch {
    return { deletedIds: [], additions: [] }
  }
}

async function writeExtras(file: string, data: ExtrasFile): Promise<void> {
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/** Delete is destructive on disk and is gated to local-first dev mode.
 *  Set OASIS_ALLOW_LIBRARY_DELETE=1 to override (e.g. internal admin builds). */
function isDeleteAllowed(): boolean {
  if (process.env.OASIS_ALLOW_LIBRARY_DELETE === '1') return true
  return process.env.NODE_ENV !== 'production'
}

export async function POST(request: Request) {
  if (!isDeleteAllowed()) {
    return NextResponse.json(
      { error: 'Library mutations are disabled on the deployed Oasis. Edit the source repo and redeploy.' },
      { status: 403 },
    )
  }
  let body: { kind?: string; id?: string; path?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { kind, id, path: assetPath } = body
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }
  if (kind !== 'asset' && kind !== 'ground') {
    return NextResponse.json({ error: 'Invalid kind (must be "asset" or "ground")' }, { status: 400 })
  }

  // ── v1 PATH: if the id targets a user-scope Asset row, delete that first. ──
  // The Asset table is the future home for conjured/crafted; it lives outside
  // the JSON-extras layer entirely, so we check before falling through.
  if (kind === 'asset') {
    const { deleteMirroredAsset } = await import('@/lib/forge/library/asset-mirror')
    const { getLocalUserId } = await import('@/lib/local-auth')
    const viewerId = await getLocalUserId()
    const removed = await deleteMirroredAsset(id, viewerId)
    if (removed) {
      let removedFile: string | null = null
      const abs = resolveInsidePublic(assetPath)
      if (abs && fs.existsSync(abs)) {
        try {
          await fs.promises.unlink(abs)
          removedFile = assetPath || null
        } catch {}
      }
      return NextResponse.json({ ok: true, mode: 'asset-row-deleted', removedFile })
    }
  }

  const extrasPath = kind === 'asset' ? ASSET_EXTRAS : GROUND_EXTRAS
  const extras = await readExtras(extrasPath)

  let mode: 'removed-from-additions' | 'added-to-deleted' | 'already-deleted' = 'added-to-deleted'
  let removedFile: string | null = null

  // 1) If the id is in additions, pop it (and delete its file for assets).
  const additions = extras.additions || []
  const addIdx = additions.findIndex(a => a.id === id)
  if (addIdx !== -1) {
    const entry = additions[addIdx]
    additions.splice(addIdx, 1)
    extras.additions = additions
    mode = 'removed-from-additions'
    if (kind === 'asset') {
      const filePath = (entry.path as string | undefined) || assetPath
      const abs = resolveInsidePublic(filePath)
      if (abs && fs.existsSync(abs)) {
        try {
          await fs.promises.unlink(abs)
          removedFile = filePath || null
        } catch {}
      }
    }
  } else {
    // 2) Baked-in entry — add to deletedIds.
    const deletedIds = extras.deletedIds || []
    if (deletedIds.includes(id)) {
      mode = 'already-deleted'
    } else {
      deletedIds.push(id)
      extras.deletedIds = deletedIds
    }
    if (kind === 'asset') {
      const abs = resolveInsidePublic(assetPath)
      if (abs && fs.existsSync(abs)) {
        try {
          await fs.promises.unlink(abs)
          removedFile = assetPath || null
        } catch {}
      }
    }
  }

  await writeExtras(extrasPath, extras)
  return NextResponse.json({ ok: true, mode, removedFile })
}

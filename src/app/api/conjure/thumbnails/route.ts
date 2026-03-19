// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Thumbnail Generation Route
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   POST /api/conjure/thumbnails — Generate thumbnails for all assets
//   that have external thumbnailUrls (CDN) or no thumbnail at all.
//
//   For external URLs: downloads to local /conjured/{id}_thumb.jpg
//   For no-thumbnail assets: sets a placeholder path so client can
//   generate via offscreen renderer on next gallery load.
//
// ░▒▓█ Every creation deserves a face █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { getAllAssets, updateAsset } from '@/lib/conjure/registry'

function ensureConjuredDir(): string {
  const dir = join(process.cwd(), 'public', 'conjured')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/conjure/thumbnails — Batch download external thumbnails
//
// Returns: { processed: number, downloaded: number, errors: string[] }
// ═══════════════════════════════════════════════════════════════════════════

export async function POST() {
  const assets = getAllAssets()
  const dir = ensureConjuredDir()
  let downloaded = 0
  let processed = 0
  const errors: string[] = []

  for (const asset of assets) {
    if (asset.status !== 'ready') continue
    processed++

    // ░▒▓ Skip if already has a local thumbnail ▓▒░
    if (asset.thumbnailUrl && !asset.thumbnailUrl.startsWith('http')) continue

    // ░▒▓ Skip if local thumbnail file already exists on disk ▓▒░
    const localPath = join(dir, `${asset.id}_thumb.jpg`)
    if (existsSync(localPath)) {
      // Update registry to point to local path if it still has external URL
      if (asset.thumbnailUrl?.startsWith('http')) {
        updateAsset(asset.id, { thumbnailUrl: `/conjured/${asset.id}_thumb.jpg` })
      }
      continue
    }

    // ░▒▓ If external URL exists, download it ▓▒░
    if (asset.thumbnailUrl?.startsWith('http')) {
      try {
        const res = await fetch(asset.thumbnailUrl)
        if (!res.ok) {
          errors.push(`${asset.id}: HTTP ${res.status}`)
          continue
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        writeFileSync(localPath, buffer)
        updateAsset(asset.id, { thumbnailUrl: `/conjured/${asset.id}_thumb.jpg` })
        downloaded++
        console.log(`[Forge:Thumbs] Downloaded ${asset.id} (${(buffer.length / 1024).toFixed(0)} KB)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${asset.id}: ${msg}`)
      }
    }
    // Assets with no thumbnailUrl at all — client-side rendering needed
    // (we don't have WebGL on the server, so this has to happen in the browser)
  }

  console.log(`[Forge:Thumbs] Batch complete: ${downloaded} downloaded, ${errors.length} errors, ${processed} processed`)

  return NextResponse.json({
    processed,
    downloaded,
    needsClientRender: assets.filter(a => a.status === 'ready' && !a.thumbnailUrl).length,
    errors: errors.slice(0, 10), // cap error list
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/conjure/thumbnails — Check how many assets need thumbnails
// ═══════════════════════════════════════════════════════════════════════════

export async function GET() {
  const assets = getAllAssets()
  const ready = assets.filter(a => a.status === 'ready')
  const withThumb = ready.filter(a => a.thumbnailUrl)
  const withLocalThumb = ready.filter(a => a.thumbnailUrl && !a.thumbnailUrl.startsWith('http'))
  const withExternalThumb = ready.filter(a => a.thumbnailUrl?.startsWith('http'))
  const noThumb = ready.filter(a => !a.thumbnailUrl)

  return NextResponse.json({
    total: ready.length,
    withLocalThumb: withLocalThumb.length,
    withExternalThumb: withExternalThumb.length,
    noThumb: noThumb.length,
    // IDs of assets needing client-side rendering (no thumbnail at all)
    needsRender: noThumb.map(a => a.id),
  })
}

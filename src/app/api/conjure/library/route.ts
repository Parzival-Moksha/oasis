// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/conjure/library — Scan ALL .glb files on disk, merge with registry
// ─═̷─═̷─ॐ─═̷─═̷─ Discovers orphan GLBs not tracked by the registry ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getBundledConjuredAssetById } from '@/lib/conjure/bundled-assets'

export const dynamic = 'force-dynamic'

interface LibraryItem {
  id: string
  filename: string
  glbPath: string
  thumbnailUrl: string | null
  displayName: string
  provider: string | null
  tier: string | null
  createdAt: string | null
  fileSizeBytes: number
  inRegistry: boolean
}

// In-memory cache with 30s TTL
let cache: { items: LibraryItem[]; ts: number } | null = null
const CACHE_TTL = 30_000

export async function GET() {
  try {
    // Return cached result if fresh
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.items)
    }

    const conjuredDir = path.join(process.cwd(), 'public', 'conjured')
    if (!fs.existsSync(conjuredDir)) {
      return NextResponse.json([])
    }

    // Single readdir for all files — build Sets for fast lookup
    const allFiles = fs.readdirSync(conjuredDir)
    const glbFiles = allFiles.filter(f => f.endsWith('.glb'))
    const thumbSet = new Set(allFiles.filter(f => f.endsWith('_thumb.jpg')))

    // Load registry for metadata enrichment
    let registry: Record<string, { displayName?: string; prompt?: string; provider?: string; tier?: string; thumbnailUrl?: string; createdAt?: string }> = {}
    try {
      const regPath = path.join(process.cwd(), 'data', 'conjured-registry.json')
      if (fs.existsSync(regPath)) {
        const regData = JSON.parse(fs.readFileSync(regPath, 'utf-8'))
        for (const asset of regData) {
          registry[asset.id] = asset
        }
      }
    } catch { /* registry not available */ }

    // Async stat all files in parallel
    const statResults = await Promise.all(
      glbFiles.map(async filename => {
        const stat = await fs.promises.stat(path.join(conjuredDir, filename))
        return { filename, size: stat.size, mtime: stat.mtime }
      })
    )

    // Build library items
    const items: LibraryItem[] = statResults.map(({ filename, size, mtime }) => {
      const id = filename.replace('.glb', '')
      const regEntry = registry[id]
      const bundledEntry = getBundledConjuredAssetById(id)
      const thumbName = `${id}_thumb.jpg`

      return {
        id,
        filename,
        glbPath: `/conjured/${filename}`,
        thumbnailUrl: thumbSet.has(thumbName) ? `/conjured/${thumbName}` : (regEntry?.thumbnailUrl || bundledEntry?.thumbnailUrl || null),
        displayName: regEntry?.displayName || bundledEntry?.displayName || regEntry?.prompt?.slice(0, 40) || bundledEntry?.prompt.slice(0, 40) || id.replace('conj_', ''),
        provider: regEntry?.provider || bundledEntry?.provider || null,
        tier: regEntry?.tier || bundledEntry?.tier || null,
        createdAt: regEntry?.createdAt || bundledEntry?.createdAt || mtime.toISOString(),
        fileSizeBytes: size,
        inRegistry: !!regEntry,
      }
    })

    // Sort newest first
    items.sort((a, b) => new Date(b.createdAt || '1970').getTime() - new Date(a.createdAt || '1970').getTime())

    // Cache result
    cache = { items, ts: Date.now() }

    return NextResponse.json(items)
  } catch (e) {
    console.error('[Library] Scan failed:', e)
    return NextResponse.json({ error: 'Library scan failed' }, { status: 500 })
  }
}

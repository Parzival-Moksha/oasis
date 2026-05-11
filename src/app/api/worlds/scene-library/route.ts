// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SCENE LIBRARY API — Crafted scenes that outlive their worlds
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET  /api/worlds/scene-library  — All saved scenes
//   PUT  /api/worlds/scene-library  — Update entire library
//   POST /api/worlds/scene-library  — Add a scene (deduplicates)
//
// ░▒▓█ SCENE LIBRARY ROUTE █▓▒░

import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CraftedScene } from '@/lib/conjure/types'

const DATA_DIR = join(process.cwd(), 'data')
const LIBRARY_PATH = join(DATA_DIR, 'scene-library.json')

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadLibrary(): CraftedScene[] {
  ensureDir()
  if (!existsSync(LIBRARY_PATH)) return []
  try {
    return JSON.parse(readFileSync(LIBRARY_PATH, 'utf-8')) as CraftedScene[]
  } catch { return [] }
}

function saveLibrary(scenes: CraftedScene[]): void {
  ensureDir()
  writeFileSync(LIBRARY_PATH, JSON.stringify(scenes, null, 2), 'utf-8')
}

// GET — all scenes. v1: read from the Asset table (kind='crafted'), filtered
// by viewer-cookie ownership. Local-mode-only JSON fallback: in hosted mode,
// new viewers get [] (otherwise we'd leak every user's legacy scenes from the
// shared scene-library.json blob).
export async function GET() {
  try {
    const { getLocalUserId } = await import('@/lib/local-auth')
    const { prisma } = await import('@/lib/db')
    const ownerId = await getLocalUserId()
    const rows = await prisma.asset.findMany({
      where: { kind: 'crafted', scope: 'user', ownerId },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    })
    const scenes: CraftedScene[] = []
    let legacyCache: CraftedScene[] | null = null
    const getLegacy = () => legacyCache ?? (legacyCache = loadLibrary())
    for (const row of rows) {
      if (row.data) {
        try {
          const parsed = JSON.parse(row.data) as CraftedScene
          if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
            scenes.push(parsed)
            continue
          }
        } catch {}
      }
      // No data blob — backfill not yet populated. Try the legacy file for this id.
      const legacy = getLegacy().find(s => s.id === row.id)
      if (legacy) scenes.push(legacy)
    }
    // Local-mode-only fallback: if the Asset table is empty for this viewer
    // AND we're not in hosted mode, surface the on-disk JSON as legacy content.
    // Hosted mode never falls back — every visitor has a separate cookie
    // identity, and the JSON is a per-instance shared blob that would leak
    // every user's scenes to every fresh visitor.
    if (scenes.length === 0 && process.env.OASIS_MODE !== 'hosted') {
      return NextResponse.json(getLegacy())
    }
    return NextResponse.json(scenes)
  } catch (err) {
    console.warn('[scene-library] Asset-table read failed:', err)
    if (process.env.OASIS_MODE !== 'hosted') return NextResponse.json(loadLibrary())
    return NextResponse.json([])
  }
}

// PUT — replace entire library (for delete operations)
export async function PUT(request: Request) {
  try {
    const body = await request.json() as CraftedScene[]
    saveLibrary(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST — add or update a scene (upsert by id)
export async function POST(request: Request) {
  try {
    const scene = await request.json() as CraftedScene
    const library = loadLibrary()
    const existing = library.findIndex(s => s.id === scene.id)
    if (existing >= 0) {
      library[existing] = scene
    } else {
      library.push(scene)
    }
    saveLibrary(library)
    // ░▒▓ v1 ASSET MIRROR — also record this crafted scene in the unified Asset
    // table tagged scope='user', ownerId=<viewer cookie>. Fire-and-forget. ▓▒░
    void (async () => {
      try {
        const { getLocalUserId } = await import('@/lib/local-auth')
        const { mirrorCraftedScene } = await import('@/lib/forge/library/asset-mirror')
        const ownerId = await getLocalUserId()
        await mirrorCraftedScene(scene, ownerId)
      } catch (err) {
        console.warn('[scene-library] asset mirror failed for', scene.id, err)
      }
    })()
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ▓▓▓▓【S̸C̸E̸N̸E̸】▓▓▓▓ॐ▓▓▓▓【L̸I̸B̸R̸A̸R̸Y̸】▓▓▓▓

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Asset Registry
// JSON file persistence for conjured assets — no Prisma needed
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { ConjuredAsset } from './types'

// Registry lives alongside the uploader data
const DATA_DIR = join(process.cwd(), 'data')
const REGISTRY_PATH = join(DATA_DIR, 'conjured-registry.json')

// ═══════════════════════════════════════════════════════════════════════════════
// In-memory cache — globalThis singleton
// ─═̷─═̷─ Next.js dev mode can split route handlers into separate webpack chunks,
// each getting their own module-level variables. A module-level `let cache`
// means the POST pipeline's updateAsset() writes to one cache while the
// GET handler's getAssetById() reads from a DIFFERENT stale cache.
// Fix: pin the cache to globalThis so ALL module instances share one truth.
// ═══════════════════════════════════════════════════════════════════════════════
const CACHE_KEY = '__forge_registry_cache__' as const
function getSharedCache(): ConjuredAsset[] | null {
  return (globalThis as Record<string, unknown>)[CACHE_KEY] as ConjuredAsset[] | null ?? null
}
function setSharedCache(assets: ConjuredAsset[] | null) {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = assets
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadFromDisk(): ConjuredAsset[] {
  ensureDir()
  if (!existsSync(REGISTRY_PATH)) {
    writeFileSync(REGISTRY_PATH, '[]', 'utf-8')
    return []
  }
  const raw = readFileSync(REGISTRY_PATH, 'utf-8')
  const parsed = JSON.parse(raw)
  // Guard: if the JSON was saved as an object (keyed by index) instead of array,
  // convert it back to an array. This happens when another process writes {0: ..., 1: ...}
  let assets: ConjuredAsset[]
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    assets = Object.values(parsed) as ConjuredAsset[]
  } else {
    assets = parsed
  }
  // Strip orphan-rescue ghosts: entries created by rescueOrphanGlbs with garbage metadata.
  // These have displayName "Recovered asset" or prompt matching their own ID (conj_xxx).
  const before = assets.length
  assets = assets.filter(a => a.displayName !== 'Recovered asset' && !(a.prompt && /^conj_[a-z0-9]+$/.test(a.prompt)))
  if (assets.length < before) {
    console.log(`[Registry] Stripped ${before - assets.length} recovered-asset ghosts on load`)
    saveToDisk(assets)
  }
  return assets
}

function saveToDisk(assets: ConjuredAsset[]) {
  ensureDir()
  writeFileSync(REGISTRY_PATH, JSON.stringify(assets, null, 2), 'utf-8')
}

function getCache(): ConjuredAsset[] {
  const cached = getSharedCache()
  if (cached === null) {
    const loaded = loadFromDisk()
    setSharedCache(loaded)
    return loaded
  }
  return cached
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function getAllAssets(): ConjuredAsset[] {
  return getCache()
}

export function getAssetById(id: string): ConjuredAsset | undefined {
  return getCache().find(a => a.id === id)
}

export function addAsset(asset: ConjuredAsset): void {
  const assets = getCache()
  assets.push(asset)
  setSharedCache(assets)
  saveToDisk(assets)
}

export function updateAsset(id: string, updates: Partial<ConjuredAsset>): ConjuredAsset | undefined {
  const assets = getCache()
  const idx = assets.findIndex(a => a.id === id)
  if (idx === -1) return undefined
  assets[idx] = { ...assets[idx], ...updates }
  setSharedCache(assets)
  saveToDisk(assets)
  return assets[idx]
}

export function removeAsset(id: string): boolean {
  const assets = getCache()
  const idx = assets.findIndex(a => a.id === id)
  if (idx === -1) return false
  assets.splice(idx, 1)
  setSharedCache(assets)
  saveToDisk(assets)
  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// STALENESS DETECTOR — The Forge's immune system
// ─═̷─═̷─ No conjuration should haunt the registry forever ─═̷─═̷─
// If a pipeline dies mid-flight (server restart, crash, API timeout),
// the asset rots in 'generating' forever. This reaper finds the ghosts
// and lays them to rest so the poller stops chasing phantoms.
// ═══════════════════════════════════════════════════════════════════════════════

const TERMINAL_STATES = ['ready', 'failed']

/** Max age (ms) before a non-terminal asset is declared dead by tier */
const STALENESS_THRESHOLDS: Record<string, number> = {
  preview:  10 * 60_000,   // 10 min (normally ~30s)
  draft:    10 * 60_000,   // 10 min
  standard: 15 * 60_000,   // 15 min
  refine:   20 * 60_000,   // 20 min (normally ~90s + preview wait)
  remesh:   15 * 60_000,   // 15 min
  premium:  20 * 60_000,   // 20 min
  rig:      20 * 60_000,   // 20 min — rigging can be slow
  animate:  20 * 60_000,   // 20 min — animation baking
}
const DEFAULT_STALENESS_MS = 15 * 60_000  // 15 min fallback

/**
 * markStaleAssets — The reaper walks the registry
 *
 * Scans all non-terminal assets. If any have been stuck longer
 * than their tier's threshold, marks them failed with a timeout message.
 * Returns the number of assets reaped.
 *
 * Called on every GET /api/conjure — cheap (in-memory scan),
 * and only writes to disk if something actually changed.
 */
export function markStaleAssets(): number {
  const assets = getCache()
  const now = Date.now()
  let reaped = 0

  for (const asset of assets) {
    if (TERMINAL_STATES.includes(asset.status)) continue

    const age = now - new Date(asset.createdAt).getTime()
    const threshold = STALENESS_THRESHOLDS[asset.tier] ?? DEFAULT_STALENESS_MS

    if (age > threshold) {
      const stuckMinutes = Math.round(age / 60_000)
      const stuckStatus = asset.status  // capture BEFORE clobbering
      asset.status = 'failed'
      asset.errorMessage = `Pipeline timed out — stuck in '${stuckStatus}' for ${stuckMinutes} min`
      asset.completedAt = new Date().toISOString()
      reaped++
      console.log(`[Forge:Reaper] Reaped stale asset ${asset.id} (${asset.tier}, ${stuckMinutes}min old)`)
    }
  }

  if (reaped > 0) {
    setSharedCache(assets)
    saveToDisk(assets)
  }

  return reaped
}

// Force re-read from disk (for debugging)
export function invalidateCache(): void {
  setSharedCache(null)
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORPHAN SCANNER — Resurrect GLBs that exist on disk but not in registry
// ─═̷─═̷─ When the registry gets nuked but the GLBs survive, this brings them back ─═̷─═̷─
// Scans public/conjured/*.glb, finds files with no matching registry entry,
// and creates registry entries so the UI can see them again.
// ═══════════════════════════════════════════════════════════════════════════════

export function rescueOrphanGlbs(): { rescued: number; orphanIds: string[] } {
  // Disabled: orphan rescue creates "Recovered asset" entries with garbage metadata
  // that confuse users and can crash the UI. Re-enable when proper recovery UX exists.
  return { rescued: 0, orphanIds: [] }

  const conjuredDir = join(process.cwd(), 'public', 'conjured')
  if (!existsSync(conjuredDir)) return { rescued: 0, orphanIds: [] }

  const assets = getCache()
  const registeredIds = new Set(assets.map(a => a.id))

  // ░▒▓ Scan disk for .glb files ▓▒░
  const glbFiles = readdirSync(conjuredDir).filter(f => f.endsWith('.glb'))
  const orphanIds: string[] = []

  for (const filename of glbFiles) {
    // Extract ID from filename: conj_xyz123.glb → conj_xyz123
    const id = filename.replace('.glb', '')
    if (registeredIds.has(id)) continue

    // ░▒▓ Orphan found — create a resurrection entry ▓▒░
    const filePath = join(conjuredDir, filename)
    const fileStat = statSync(filePath)

    const resurrected: ConjuredAsset = {
      id,
      prompt: id,                       // minimal non-empty prompt (ID as fallback)
      displayName: 'Recovered asset',   // user can rename in gallery
      provider: 'meshy',                // best guess — most conjurations are meshy
      tier: 'unknown',
      providerTaskId: '',
      status: 'ready',
      progress: 100,
      glbPath: `/conjured/${filename}`,
      position: [
        (Math.random() - 0.5) * 10,
        0.5,
        (Math.random() - 0.5) * 10,
      ],
      scale: 1,
      rotation: [0, 0, 0],
      createdAt: fileStat.birthtime.toISOString(),
      completedAt: fileStat.mtime.toISOString(),
      metadata: {
        fileSizeBytes: fileStat.size,
      },
    }

    assets.push(resurrected)
    orphanIds.push(id)
    console.log(`[Forge:Rescue] Resurrected orphan GLB: ${id} (${(fileStat.size / 1024).toFixed(0)} KB)`)
  }

  if (orphanIds.length > 0) {
    setSharedCache(assets)
    saveToDisk(assets)
  }

  return { rescued: orphanIds.length, orphanIds }
}

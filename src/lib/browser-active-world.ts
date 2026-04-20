import 'server-only'

import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

interface StoredBrowserActiveWorld {
  worldId: string
  updatedAt: string
}

const BROWSER_ACTIVE_WORLD_PATH = join(process.cwd(), 'prisma', 'data', 'browser-active-world.json')
const BROWSER_ACTIVE_WORLD_TTL_MS = 10 * 60 * 1000

async function readStoredBrowserActiveWorld(): Promise<StoredBrowserActiveWorld | null> {
  if (!existsSync(BROWSER_ACTIVE_WORLD_PATH)) return null
  try {
    const raw = await readFile(BROWSER_ACTIVE_WORLD_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as StoredBrowserActiveWorld | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.worldId !== 'string' || typeof parsed.updatedAt !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function publishBrowserActiveWorld(worldId: string): Promise<void> {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return
  await mkdir(join(process.cwd(), 'prisma', 'data'), { recursive: true })
  await writeFile(
    BROWSER_ACTIVE_WORLD_PATH,
    JSON.stringify({
      worldId: safeWorldId,
      updatedAt: new Date().toISOString(),
    }, null, 2),
  )
}

export async function readBrowserActiveWorldId(): Promise<string | null> {
  const stored = await readStoredBrowserActiveWorld()
  if (!stored) return null
  const updatedAtMs = Date.parse(stored.updatedAt)
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > BROWSER_ACTIVE_WORLD_TTL_MS) {
    return null
  }
  return stored.worldId.trim() || null
}

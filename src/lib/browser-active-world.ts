import 'server-only'

import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

import { prisma } from './db'
import { getOasisMode } from './oasis-profile'

interface StoredBrowserActiveWorld {
  worldId: string
  updatedAt: string
}

const BROWSER_ACTIVE_WORLD_PATH = join(process.cwd(), 'prisma', 'data', 'browser-active-world.json')
const BROWSER_ACTIVE_WORLD_TTL_MS = 10 * 60 * 1000
const SESSION_ACTIVE_WORLD_KEY_PREFIX = 'browser-active-world:'

function sessionActiveWorldKey(userId: string): string {
  return `${SESSION_ACTIVE_WORLD_KEY_PREFIX}${userId}`
}

function canUseSessionActiveWorld(userId?: string): userId is string {
  return getOasisMode() === 'hosted' && Boolean(userId && userId !== 'local-user')
}

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

export async function publishBrowserActiveWorld(worldId: string, userId?: string): Promise<void> {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return
  if (getOasisMode() === 'hosted') {
    if (!canUseSessionActiveWorld(userId)) return
    await prisma.appConfig.upsert({
      where: { key: sessionActiveWorldKey(userId) },
      create: {
        key: sessionActiveWorldKey(userId),
        value: JSON.stringify({ worldId: safeWorldId, updatedAt: new Date().toISOString() }),
        updatedAt: new Date(),
      },
      update: {
        value: JSON.stringify({ worldId: safeWorldId, updatedAt: new Date().toISOString() }),
        updatedAt: new Date(),
      },
    })
    return
  }

  await mkdir(join(process.cwd(), 'prisma', 'data'), { recursive: true })
  await writeFile(
    BROWSER_ACTIVE_WORLD_PATH,
    JSON.stringify({
      worldId: safeWorldId,
      updatedAt: new Date().toISOString(),
    }, null, 2),
  )
}

export async function readBrowserActiveWorldId(userId?: string): Promise<string | null> {
  if (getOasisMode() === 'hosted') {
    if (!canUseSessionActiveWorld(userId)) return null
    const stored = await prisma.appConfig.findUnique({
      where: { key: sessionActiveWorldKey(userId) },
      select: { value: true },
    })
    if (!stored?.value) return null
    try {
      const parsed = JSON.parse(stored.value) as StoredBrowserActiveWorld | null
      if (!parsed || typeof parsed.worldId !== 'string') return null
      return parsed.worldId.trim() || null
    } catch {
      return null
    }
  }

  const stored = await readStoredBrowserActiveWorld()
  if (!stored) return null
  const updatedAtMs = Date.parse(stored.updatedAt)
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > BROWSER_ACTIVE_WORLD_TTL_MS) {
    return null
  }
  return stored.worldId.trim() || null
}

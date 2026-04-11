import 'server-only'

import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface RuntimeAvatarContext {
  position: [number, number, number]
  yaw?: number
  forward?: [number, number, number]
}

export interface RuntimeCameraContext {
  position: [number, number, number]
  forward?: [number, number, number]
}

export interface RuntimePlayerContext {
  avatar?: RuntimeAvatarContext | null
  camera?: RuntimeCameraContext | null
}

interface StoredWorldRuntimeContext {
  updatedAt: string
  player?: RuntimePlayerContext | null
}

type WorldRuntimeContextRegistry = Record<string, StoredWorldRuntimeContext>

const RUNTIME_CONTEXT_PATH = join(process.cwd(), 'prisma', 'data', 'world-runtime-context.json')
const LIVE_CONTEXT_TTL_MS = 5 * 60 * 1000

function cloneVec3(value: [number, number, number]): [number, number, number] {
  return [value[0], value[1], value[2]]
}

function clonePlayerContext(player: RuntimePlayerContext | null | undefined): RuntimePlayerContext | null {
  if (!player) return null
  return {
    avatar: player.avatar
      ? {
          position: cloneVec3(player.avatar.position),
          ...(typeof player.avatar.yaw === 'number' ? { yaw: player.avatar.yaw } : {}),
          ...(player.avatar.forward ? { forward: cloneVec3(player.avatar.forward) } : {}),
        }
      : null,
    camera: player.camera
      ? {
          position: cloneVec3(player.camera.position),
          ...(player.camera.forward ? { forward: cloneVec3(player.camera.forward) } : {}),
        }
      : null,
  }
}

async function readRegistry(): Promise<WorldRuntimeContextRegistry> {
  if (!existsSync(RUNTIME_CONTEXT_PATH)) return {}
  try {
    const raw = await readFile(RUNTIME_CONTEXT_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as WorldRuntimeContextRegistry | null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeRegistry(registry: WorldRuntimeContextRegistry): Promise<void> {
  await mkdir(join(process.cwd(), 'prisma', 'data'), { recursive: true })
  await writeFile(RUNTIME_CONTEXT_PATH, JSON.stringify(registry, null, 2))
}

export async function publishWorldPlayerContext(worldId: string, player: RuntimePlayerContext | null | undefined): Promise<void> {
  const safeWorldId = worldId.trim()
  const nextPlayer = clonePlayerContext(player)
  if (!safeWorldId || !nextPlayer || (!nextPlayer.avatar && !nextPlayer.camera)) return

  const registry = await readRegistry()
  registry[safeWorldId] = {
    updatedAt: new Date().toISOString(),
    player: nextPlayer,
  }
  await writeRegistry(registry)
}

export async function readWorldPlayerContext(worldId: string): Promise<{ updatedAt: string; player: RuntimePlayerContext } | null> {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return null

  const registry = await readRegistry()
  const entry = registry[safeWorldId]
  if (!entry?.player) return null

  const updatedAtMs = Date.parse(entry.updatedAt)
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > LIVE_CONTEXT_TTL_MS) {
    return null
  }

  const player = clonePlayerContext(entry.player)
  if (!player || (!player.avatar && !player.camera)) return null

  return {
    updatedAt: entry.updatedAt,
    player,
  }
}

import 'server-only'

export interface BrowserPlayerAvatar {
  position: [number, number, number]
  yaw?: number
  forward?: [number, number, number]
}

export interface BrowserPlayerCamera {
  position: [number, number, number]
  forward?: [number, number, number]
}

export interface BrowserPlayerContext {
  avatar: BrowserPlayerAvatar | null
  camera: BrowserPlayerCamera | null
  updatedAt: number
}

const TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 32

// Pin to globalThis — Next.js dev splits route handlers into separate chunks, so
// plain module state is duplicated per chunk. /api/world-active writes to chunk A;
// /api/mcp/oasis reads from chunk B; they never see each other without this.
const GLOBAL_KEY = Symbol.for('oasis.browserPlayerContext.v1')
const globalStore = globalThis as unknown as { [key: symbol]: Map<string, BrowserPlayerContext> | undefined }
const MEMORY: Map<string, BrowserPlayerContext> = globalStore[GLOBAL_KEY] ?? new Map()
if (!globalStore[GLOBAL_KEY]) {
  globalStore[GLOBAL_KEY] = MEMORY
}

function sweepExpired(now: number): void {
  for (const [key, entry] of MEMORY) {
    if (now - entry.updatedAt > TTL_MS) MEMORY.delete(key)
  }
}

function evictOldestIfOver(capacity: number): void {
  while (MEMORY.size > capacity) {
    const oldestKey = MEMORY.keys().next().value
    if (!oldestKey) break
    MEMORY.delete(oldestKey)
  }
}

function cloneVec3(value: [number, number, number]): [number, number, number] {
  return [value[0], value[1], value[2]]
}

function sanitizeAvatar(raw: unknown): BrowserPlayerAvatar | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const position = record.position
  if (!Array.isArray(position) || position.length < 3) return null
  const p = position.slice(0, 3).map(Number) as [number, number, number]
  if (p.some(n => !Number.isFinite(n))) return null
  const yaw = typeof record.yaw === 'number' && Number.isFinite(record.yaw) ? record.yaw : undefined
  const forwardRaw = record.forward
  const forward = Array.isArray(forwardRaw) && forwardRaw.length >= 3
    ? (() => {
        const f = forwardRaw.slice(0, 3).map(Number) as [number, number, number]
        return f.some(n => !Number.isFinite(n)) ? undefined : f
      })()
    : undefined
  return { position: cloneVec3(p), ...(yaw !== undefined ? { yaw } : {}), ...(forward ? { forward } : {}) }
}

function sanitizeCamera(raw: unknown): BrowserPlayerCamera | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const position = record.position
  if (!Array.isArray(position) || position.length < 3) return null
  const p = position.slice(0, 3).map(Number) as [number, number, number]
  if (p.some(n => !Number.isFinite(n))) return null
  const forwardRaw = record.forward
  const forward = Array.isArray(forwardRaw) && forwardRaw.length >= 3
    ? (() => {
        const f = forwardRaw.slice(0, 3).map(Number) as [number, number, number]
        return f.some(n => !Number.isFinite(n)) ? undefined : f
      })()
    : undefined
  return { position: cloneVec3(p), ...(forward ? { forward } : {}) }
}

export function publishBrowserPlayerContext(worldId: string, avatar: unknown, camera: unknown): void {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return
  const nextAvatar = sanitizeAvatar(avatar)
  const nextCamera = sanitizeCamera(camera)
  if (!nextAvatar && !nextCamera) {
    MEMORY.delete(safeWorldId)
    return
  }
  const now = Date.now()
  sweepExpired(now)
  // Reinsert to bump LRU ordering (Map preserves insertion order).
  MEMORY.delete(safeWorldId)
  MEMORY.set(safeWorldId, {
    avatar: nextAvatar,
    camera: nextCamera,
    updatedAt: now,
  })
  evictOldestIfOver(MAX_ENTRIES)
}

export function readBrowserPlayerContext(worldId: string): BrowserPlayerContext | null {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return null
  const entry = MEMORY.get(safeWorldId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > TTL_MS) {
    MEMORY.delete(safeWorldId)
    return null
  }
  return entry
}

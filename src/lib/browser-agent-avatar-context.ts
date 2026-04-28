import 'server-only'

export interface BrowserAgentAvatar {
  id: string
  agentType: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  linkedWindowId?: string
  label?: string
  avatar3dUrl?: string
}

export interface BrowserAgentAvatarContext {
  avatars: BrowserAgentAvatar[]
  updatedAt: number
}

const TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 32

const GLOBAL_KEY = Symbol.for('oasis.browserAgentAvatarContext.v1')
const globalStore = globalThis as unknown as { [key: symbol]: Map<string, BrowserAgentAvatarContext> | undefined }
const MEMORY: Map<string, BrowserAgentAvatarContext> = globalStore[GLOBAL_KEY] ?? new Map()
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

function sanitizeVec3(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null
  const vec = raw.slice(0, 3).map(Number) as [number, number, number]
  if (vec.some(n => !Number.isFinite(n))) return null
  return cloneVec3(vec)
}

function sanitizeAvatar(raw: unknown): BrowserAgentAvatar | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const agentType = typeof record.agentType === 'string' ? record.agentType.trim().toLowerCase() : ''
  const position = sanitizeVec3(record.position)
  if (!id || !agentType || !position) return null

  const rotation = sanitizeVec3(record.rotation) || undefined
  const scale = Number(record.scale)
  const linkedWindowId = typeof record.linkedWindowId === 'string' ? record.linkedWindowId.trim() : ''
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  const avatar3dUrl = typeof record.avatar3dUrl === 'string' ? record.avatar3dUrl.trim() : ''

  return {
    id,
    agentType,
    position,
    ...(rotation ? { rotation } : {}),
    ...(Number.isFinite(scale) ? { scale } : {}),
    ...(linkedWindowId ? { linkedWindowId } : {}),
    ...(label ? { label } : {}),
    ...(avatar3dUrl ? { avatar3dUrl } : {}),
  }
}

function cloneAvatar(avatar: BrowserAgentAvatar): BrowserAgentAvatar {
  return {
    ...avatar,
    position: cloneVec3(avatar.position),
    ...(avatar.rotation ? { rotation: cloneVec3(avatar.rotation) } : {}),
  }
}

export function publishBrowserAgentAvatarContext(worldId: string, avatars: unknown): void {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return

  const nextAvatars = Array.isArray(avatars)
    ? avatars
        .map(sanitizeAvatar)
        .filter((avatar): avatar is BrowserAgentAvatar => !!avatar)
    : []

  if (nextAvatars.length === 0) {
    MEMORY.delete(safeWorldId)
    return
  }

  const now = Date.now()
  sweepExpired(now)
  MEMORY.delete(safeWorldId)
  MEMORY.set(safeWorldId, {
    avatars: nextAvatars.map(cloneAvatar),
    updatedAt: now,
  })
  evictOldestIfOver(MAX_ENTRIES)
}

export function readBrowserAgentAvatarContext(worldId: string): BrowserAgentAvatarContext | null {
  const safeWorldId = worldId.trim()
  if (!safeWorldId) return null
  const entry = MEMORY.get(safeWorldId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > TTL_MS) {
    MEMORY.delete(safeWorldId)
    return null
  }
  return {
    updatedAt: entry.updatedAt,
    avatars: entry.avatars.map(cloneAvatar),
  }
}

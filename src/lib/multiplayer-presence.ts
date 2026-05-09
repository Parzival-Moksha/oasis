export interface MultiplayerPresencePlayer {
  playerId: string
  worldId: string
  name: string
  avatarUrl?: string
  color: string
  position: [number, number, number]
  yaw: number
  updatedAt: number
}

export interface MultiplayerPresenceUpdate {
  playerId: string
  worldId: string
  name?: string
  avatarUrl?: string
  color?: string
  position?: unknown
  yaw?: unknown
}

const PRESENCE_TTL_MS = 8500
const MAX_PLAYERS_PER_WORLD = 64

const globalState = globalThis as typeof globalThis & {
  __oasisMultiplayerPresence?: Map<string, MultiplayerPresencePlayer>
}

if (!globalState.__oasisMultiplayerPresence) {
  globalState.__oasisMultiplayerPresence = new Map()
}

const players = globalState.__oasisMultiplayerPresence

function cleanId(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || fallback
}

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/\s+/g, ' ').trim().slice(0, 32) || fallback
}

function cleanColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : fallback
}

function cleanVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback
  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])
  if (![x, y, z].every(Number.isFinite)) return fallback
  return [
    Math.max(-500, Math.min(500, x)),
    Math.max(-100, Math.min(100, y)),
    Math.max(-500, Math.min(500, z)),
  ]
}

function cleanYaw(value: unknown, fallback = 0): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(-Math.PI * 4, Math.min(Math.PI * 4, numberValue))
}

function colorForPlayer(playerId: string): string {
  const palette = ['#38bdf8', '#fb7185', '#facc15', '#22c55e', '#a78bfa', '#f97316', '#2dd4bf', '#e879f9']
  let hash = 0
  for (let index = 0; index < playerId.length; index += 1) {
    hash = ((hash << 5) - hash + playerId.charCodeAt(index)) | 0
  }
  return palette[Math.abs(hash) % palette.length] || palette[0]
}

export function pruneMultiplayerPresence(now = Date.now()): void {
  for (const [playerId, player] of players.entries()) {
    if (now - player.updatedAt > PRESENCE_TTL_MS) {
      players.delete(playerId)
    }
  }
}

export function upsertMultiplayerPresence(update: MultiplayerPresenceUpdate, now = Date.now()): MultiplayerPresencePlayer | null {
  pruneMultiplayerPresence(now)

  const playerId = cleanId(update.playerId)
  const worldId = cleanId(update.worldId)
  if (!playerId || !worldId) return null

  const previous = players.get(playerId)
  const player: MultiplayerPresencePlayer = {
    playerId,
    worldId,
    name: cleanText(update.name, previous?.name || `Player ${playerId.slice(0, 4)}`),
    avatarUrl: typeof update.avatarUrl === 'string' ? update.avatarUrl.slice(0, 500) : previous?.avatarUrl,
    color: cleanColor(update.color, previous?.color || colorForPlayer(playerId)),
    position: cleanVec3(update.position, previous?.position || [0, 0, 0]),
    yaw: cleanYaw(update.yaw, previous?.yaw || 0),
    updatedAt: now,
  }

  players.set(playerId, player)

  const worldPlayers = listMultiplayerPresence(worldId, undefined, now)
  if (worldPlayers.length > MAX_PLAYERS_PER_WORLD) {
    worldPlayers
      .slice()
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, worldPlayers.length - MAX_PLAYERS_PER_WORLD)
      .forEach(entry => players.delete(entry.playerId))
  }

  return player
}

export function listMultiplayerPresence(
  worldId: string,
  excludePlayerId?: string,
  now = Date.now(),
): MultiplayerPresencePlayer[] {
  pruneMultiplayerPresence(now)
  return Array.from(players.values())
    .filter(player => player.worldId === worldId && player.playerId !== excludePlayerId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function removeMultiplayerPresence(playerId: string): boolean {
  const id = cleanId(playerId)
  return id ? players.delete(id) : false
}

export function clearMultiplayerPresenceForTests(): void {
  players.clear()
}

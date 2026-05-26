// World roster — exposes per-world player info to non-Room callers (HTTP).
//
// WorldRoom instances live inside Colyseus and own state via Schema. The HTTP
// handler in server.ts can't reach into a specific room's state directly, so
// we mirror just enough player metadata into a module-level registry. Rooms
// update on join/leave/input; HTTP reads.

export interface WorldRosterEntry {
  playerId: string
  userId?: string
  sessionId: string
  displayName: string
  avatarUrl: string
  profileAvatarUrl: string
  color: string
  position: [number, number, number]
  yaw: number
  animState: string
  updatedAt: number
}

const worlds: Map<string, Map<string, WorldRosterEntry>> = new Map()

export interface WorldRoomMetrics {
  worldId: string
  maxClients: number
  createdAt: number
  commandsAccepted: number
  commandsRejected: number
  mutationsRelayed: number
  commandLatencyCount: number
  commandLatencyTotalMs: number
  commandLatencyMaxMs: number
  lastCommandAt: number
  lastMutationAt: number
}

const metricsByWorld: Map<string, WorldRoomMetrics> = new Map()

function ensureMetrics(worldId: string): WorldRoomMetrics {
  let metrics = metricsByWorld.get(worldId)
  if (!metrics) {
    metrics = {
      worldId,
      maxClients: 0,
      createdAt: Date.now(),
      commandsAccepted: 0,
      commandsRejected: 0,
      mutationsRelayed: 0,
      commandLatencyCount: 0,
      commandLatencyTotalMs: 0,
      commandLatencyMaxMs: 0,
      lastCommandAt: 0,
      lastMutationAt: 0,
    }
    metricsByWorld.set(worldId, metrics)
  }
  return metrics
}

export function recordWorldRoomCreated(worldId: string, maxClients: number): void {
  const metrics = ensureMetrics(worldId)
  metrics.maxClients = maxClients
  metrics.createdAt = Date.now()
}

export function recordWorldMutation(worldId: string): void {
  const metrics = ensureMetrics(worldId)
  metrics.mutationsRelayed += 1
  metrics.lastMutationAt = Date.now()
}

export function recordWorldCommand(worldId: string, accepted: boolean, createdAt?: unknown): void {
  const metrics = ensureMetrics(worldId)
  if (accepted) metrics.commandsAccepted += 1
  else metrics.commandsRejected += 1
  metrics.lastCommandAt = Date.now()
  if (accepted && typeof createdAt === 'string') {
    const sentAt = Date.parse(createdAt)
    if (Number.isFinite(sentAt)) {
      const latencyMs = Math.max(0, metrics.lastCommandAt - sentAt)
      metrics.commandLatencyCount += 1
      metrics.commandLatencyTotalMs += latencyMs
      metrics.commandLatencyMaxMs = Math.max(metrics.commandLatencyMaxMs, latencyMs)
    }
  }
}

export function getWorldRoomMetrics(worldId?: string): Array<WorldRoomMetrics & { players: number; commandLatencyAvgMs: number }> {
  const source = worldId ? (metricsByWorld.get(worldId) ? [metricsByWorld.get(worldId)!] : []) : Array.from(metricsByWorld.values())
  return source.map(metrics => ({
    ...metrics,
    players: worlds.get(metrics.worldId)?.size || 0,
    commandLatencyAvgMs: metrics.commandLatencyCount > 0
      ? Math.round(metrics.commandLatencyTotalMs / metrics.commandLatencyCount)
      : 0,
    commandLatencyTotalMs: Math.round(metrics.commandLatencyTotalMs),
    commandLatencyMaxMs: Math.round(metrics.commandLatencyMaxMs),
  }))
}

export function rosterUpsert(worldId: string, sessionId: string, entry: WorldRosterEntry): void {
  if (!worldId) return
  let room = worlds.get(worldId)
  if (!room) {
    room = new Map()
    worlds.set(worldId, room)
  }
  room.set(sessionId, entry)
}

export function rosterRemove(worldId: string, sessionId: string): void {
  const room = worlds.get(worldId)
  if (!room) return
  room.delete(sessionId)
  if (room.size === 0) worlds.delete(worldId)
}

export function rosterClearWorld(worldId: string): void {
  worlds.delete(worldId)
  metricsByWorld.delete(worldId)
}

export function getWorldPlayers(worldId: string): WorldRosterEntry[] {
  const room = worlds.get(worldId)
  if (!room) return []
  return Array.from(room.values())
}

export function getRosterStats(): { worlds: number; totalPlayers: number } {
  let total = 0
  for (const room of worlds.values()) total += room.size
  return { worlds: worlds.size, totalPlayers: total }
}

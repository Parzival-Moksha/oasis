// World roster — exposes per-world player info to non-Room callers (HTTP).
//
// WorldRoom instances live inside Colyseus and own state via Schema. The HTTP
// handler in server.ts can't reach into a specific room's state directly, so
// we mirror just enough player metadata into a module-level registry. Rooms
// update on join/leave/input; HTTP reads.

export interface WorldRosterEntry {
  playerId: string
  sessionId: string
  displayName: string
  avatarUrl: string
  color: string
  position: [number, number, number]
  yaw: number
  animState: string
  updatedAt: number
}

const worlds: Map<string, Map<string, WorldRosterEntry>> = new Map()

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

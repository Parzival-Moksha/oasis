import { Room, type Client } from 'colyseus'
import { PlayerState, WorldRoomState } from '../schema/RoomSchema.js'

interface JoinOptions {
  worldId?: string
  playerId?: string
  displayName?: string
  avatarUrl?: string
  color?: string
}

interface InputMessage {
  x?: number
  y?: number
  z?: number
  yaw?: number
  vx?: number
  vz?: number
  animState?: string
}

const MAX_PLAYERS_PER_WORLD = 64
const SIM_HZ = 20
const PATCH_HZ = 15

function sanitizeWorldId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, 96)
}

function sanitizePlayerId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || fallback
}

function sanitizeText(value: unknown, fallback: string, max = 32): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/\s+/g, ' ').trim().slice(0, max) || fallback
}

function clampPos(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(-500, Math.min(500, n))
}

function clampVel(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(-50, Math.min(50, n))
}

function clampYaw(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(-Math.PI * 4, Math.min(Math.PI * 4, n))
}

export class WorldRoom extends Room<WorldRoomState> {
  override maxClients = MAX_PLAYERS_PER_WORLD

  override onCreate(options: JoinOptions): void {
    const worldId = sanitizeWorldId(options.worldId)
    if (!worldId) {
      throw new Error('worldId is required to create a WorldRoom')
    }

    const state = new WorldRoomState()
    state.worldId = worldId
    this.setState(state)

    this.setPatchRate(1000 / PATCH_HZ)
    this.setSimulationInterval(deltaMs => this.simulate(deltaMs), 1000 / SIM_HZ)

    this.setMetadata({ worldId }).catch(() => {})
    console.log(`[room ${this.roomId}] created worldId=${worldId}`)

    this.onMessage('input', (client, payload: InputMessage) => {
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      if (payload.x !== undefined) player.x = clampPos(payload.x, player.x)
      if (payload.y !== undefined) player.y = clampPos(payload.y, player.y)
      if (payload.z !== undefined) player.z = clampPos(payload.z, player.z)
      if (payload.yaw !== undefined) player.yaw = clampYaw(payload.yaw, player.yaw)
      if (payload.vx !== undefined) player.vx = clampVel(payload.vx, player.vx)
      if (payload.vz !== undefined) player.vz = clampVel(payload.vz, player.vz)
      if (payload.animState !== undefined) player.animState = sanitizeText(payload.animState, player.animState, 24)
      player.updatedAt = Date.now()
    })
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const player = new PlayerState()
    player.playerId = sanitizePlayerId(options.playerId, client.sessionId)
    player.displayName = sanitizeText(options.displayName, `Player ${player.playerId.slice(0, 4)}`)
    player.avatarUrl = sanitizeText(options.avatarUrl, '', 500)
    player.color = sanitizeText(options.color, '#38bdf8', 7)
    player.updatedAt = Date.now()
    this.state.players.set(client.sessionId, player)
    console.log(`[room ${this.roomId}] join ${client.sessionId} (${player.displayName}) total=${this.state.players.size}`)
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId)
    console.log(`[room ${this.roomId}] leave ${client.sessionId} total=${this.state.players.size}`)
  }

  override onDispose(): void {
    // No-op for now; room state lives only in memory.
  }

  private simulate(_deltaMs: number): void {
    this.state.tick += 1
    // v1: clients are authoritative for their own position; server is the
    // broadcast hub. A proper authoritative tick (apply velocity, validate
    // displacement, reject teleport spikes) comes in v2.
  }
}

import { Room, type Client } from 'colyseus'
import { PlayerState, WorldRoomState } from '../schema/RoomSchema.js'
import { rosterClearWorld, rosterRemove, rosterUpsert } from '../world-roster.js'

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

interface ProfileMessage {
  avatarUrl?: string
  displayName?: string
  color?: string
}

const MAX_PLAYERS_PER_WORLD = 64
const SIM_HZ = 30
const PATCH_HZ = 30
// Mutation passthrough is unauthenticated by design (no auth yet) — bound
// the abuse surface explicitly. A malicious WS client could otherwise flood
// every peer with megabyte-sized payloads.
const MUTATION_MAX_BYTES = 16 * 1024  // 16 KiB per mutation envelope
const MUTATION_TOKENS_PER_SEC = 30    // 30 mutation broadcasts/sec sustained
const MUTATION_BURST = 60             // allow short bursts for drag streams

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

interface MutationBucket {
  tokens: number
  lastRefillAt: number
}

export class WorldRoom extends Room<WorldRoomState> {
  override maxClients = MAX_PLAYERS_PER_WORLD
  private readonly mutationBuckets = new Map<string, MutationBucket>()

  private consumeMutationToken(sessionId: string, now: number): boolean {
    let bucket = this.mutationBuckets.get(sessionId)
    if (!bucket) {
      bucket = { tokens: MUTATION_BURST, lastRefillAt: now }
      this.mutationBuckets.set(sessionId, bucket)
    } else {
      const elapsedSec = (now - bucket.lastRefillAt) / 1000
      if (elapsedSec > 0) {
        bucket.tokens = Math.min(MUTATION_BURST, bucket.tokens + elapsedSec * MUTATION_TOKENS_PER_SEC)
        bucket.lastRefillAt = now
      }
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }
    return false
  }

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
      rosterUpsert(this.state.worldId, client.sessionId, {
        playerId: player.playerId,
        sessionId: client.sessionId,
        displayName: player.displayName,
        avatarUrl: player.avatarUrl,
        color: player.color,
        position: [player.x, player.y, player.z],
        yaw: player.yaw,
        animState: player.animState,
        updatedAt: player.updatedAt,
      })
    })

    this.onMessage('profile', (client, payload: ProfileMessage) => {
      // Mutates a connected player's avatarUrl/displayName/color in-place.
      // Previously the layer had to disconnect+reconnect to swap avatars
      // mid-session; this lets it just send a small update.
      const player = this.state.players.get(client.sessionId)
      if (!player || !payload || typeof payload !== 'object') return
      if (typeof payload.avatarUrl === 'string') {
        // Don't run sanitizeText on URLs — its whitespace-collapse corrupts
        // valid encoded URLs. Just length-cap and trim leading/trailing space.
        player.avatarUrl = payload.avatarUrl.trim().slice(0, 500)
      }
      if (typeof payload.displayName === 'string') {
        player.displayName = sanitizeText(payload.displayName, player.displayName)
      }
      if (typeof payload.color === 'string') {
        player.color = sanitizeText(payload.color, player.color, 7)
      }
      player.updatedAt = Date.now()
      rosterUpsert(this.state.worldId, client.sessionId, {
        playerId: player.playerId,
        sessionId: client.sessionId,
        displayName: player.displayName,
        avatarUrl: player.avatarUrl,
        color: player.color,
        position: [player.x, player.y, player.z],
        yaw: player.yaw,
        animState: player.animState,
        updatedAt: player.updatedAt,
      })
    })

    this.onMessage('mutation', (client, payload: unknown) => {
      // v1: server is a passthrough broadcaster. No validation, no persistence.
      // Persistence still happens client-side via the existing debounced save
      // path on the originating client. Phase 4 v2 will move persistence into
      // the room and add baseVersion conflict rules from the spec.

      // Defensive caps: shape, payload size, per-client rate.
      if (!payload || typeof payload !== 'object') return
      const env = payload as { kind?: unknown; payload?: unknown }
      if (typeof env.kind !== 'string' || env.kind.length > 64) return

      // Serialized-size cap. JSON.stringify is the cheapest realistic proxy
      // for the wire size of an arbitrary unknown payload here; perfectly
      // synced with the actual broadcast cost given Colyseus uses msgpack
      // for everything that isn't schema-typed.
      let serializedSize: number
      try {
        serializedSize = JSON.stringify(env).length
      } catch {
        return  // unserializable payload
      }
      if (serializedSize > MUTATION_MAX_BYTES) return

      // Token-bucket rate limit per session.
      if (!this.consumeMutationToken(client.sessionId, Date.now())) return

      this.broadcast('mutation', payload, { except: client })
    })
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const player = new PlayerState()
    player.playerId = sanitizePlayerId(options.playerId, client.sessionId)
    player.displayName = sanitizeText(options.displayName, `Player ${player.playerId.slice(0, 4)}`)
    player.avatarUrl = (typeof options.avatarUrl === 'string' ? options.avatarUrl.trim() : '').slice(0, 500)
    player.color = sanitizeText(options.color, '#38bdf8', 7)
    player.updatedAt = Date.now()
    this.state.players.set(client.sessionId, player)
    rosterUpsert(this.state.worldId, client.sessionId, {
      playerId: player.playerId,
      sessionId: client.sessionId,
      displayName: player.displayName,
      avatarUrl: player.avatarUrl,
      color: player.color,
      position: [player.x, player.y, player.z],
      yaw: player.yaw,
      animState: player.animState,
      updatedAt: player.updatedAt,
    })
    console.log(`[room ${this.roomId}] join ${client.sessionId} (${player.displayName}) total=${this.state.players.size}`)
  }

  override onLeave(client: Client): void {
    // try/finally guards against a roster leak if state.players.delete or
    // mutationBuckets.delete were to throw mid-cleanup — the roster must
    // drop the session regardless so /world-players doesn't keep reporting
    // ghosts.
    try {
      this.state.players.delete(client.sessionId)
      this.mutationBuckets.delete(client.sessionId)
    } finally {
      rosterRemove(this.state.worldId, client.sessionId)
      console.log(`[room ${this.roomId}] leave ${client.sessionId} total=${this.state.players.size}`)
    }
  }

  override onDispose(): void {
    rosterClearWorld(this.state.worldId)
  }

  private simulate(_deltaMs: number): void {
    this.state.tick += 1
    // v1: clients are authoritative for their own position; server is the
    // broadcast hub. A proper authoritative tick (apply velocity, validate
    // displacement, reject teleport spikes) comes in v2.
  }
}

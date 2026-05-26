import { Room, type Client } from 'colyseus'
import { ActiveBolt, PlayerState, WorldRoomState } from '../schema/RoomSchema.js'
import {
  fallbackRoomAccess,
  shouldRequireRoomJoinClaim,
  verifyRoomJoinClaim,
  type RoomAccess,
} from '../room-join-claim.js'
import {
  recordWorldCommand,
  recordWorldMutation,
  recordWorldRoomCreated,
  rosterClearWorld,
  rosterRemove,
  rosterUpsert,
} from '../world-roster.js'
import { applyRoomWorldCommand } from '../world-reducer.js'

interface JoinOptions {
  worldId?: string
  playerId?: string
  userId?: string
  joinClaim?: string
  displayName?: string
  avatarUrl?: string
  profileAvatarUrl?: string
  color?: string
  // PvP join params — client passes its own progression-computed max values.
  // First join seeds pvpEnabled, and later true joins can promote it if the
  // browser joined before the world registry finished hydrating.
  pvpEnabled?: boolean
  maxHp?: number
  mana?: number
  maxMana?: number
}

interface CastMessage {
  spell?: string         // 'firebolt' | 'lightning-bolt' | 'ice-bolt'
  design?: string        // 'A' | 'B' | 'C' | 'D'
  ox?: number; oy?: number; oz?: number
  dx?: number; dy?: number; dz?: number
  speed?: number
  damage?: number
  seed?: number
  /** Client-generated id; server reuses it as the bolt id so no roundtrip needed. */
  clientPredictionId?: string
}

interface ReportHitMessage {
  /** boltId == casting client's clientPredictionId. */
  boltId?: string
  /** Victim's Colyseus sessionId (not playerId). */
  victimSessionId?: string
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
  profileAvatarUrl?: string
  displayName?: string
  color?: string
}

interface VitalsMessage {
  hp?: number
  maxHp?: number
  mana?: number
  maxMana?: number
}

interface ChatMessage {
  id?: unknown
  text?: unknown
}

const DEFAULT_MAX_PLAYERS_PER_WORLD = 64
const MAX_CONFIGURABLE_PLAYERS_PER_WORLD = 256
const SIM_HZ = 30
const PATCH_HZ = 30
// Mutation passthrough is unauthenticated by design (no auth yet) — bound
// the abuse surface explicitly. A malicious WS client could otherwise flood
// every peer with megabyte-sized payloads.
const MUTATION_MAX_BYTES = 16 * 1024  // 16 KiB per mutation envelope
const MUTATION_TOKENS_PER_SEC = 30    // 30 mutation broadcasts/sec sustained
const MUTATION_BURST = 60             // allow short bursts for drag streams
const WORLD_COMMAND_MAX_BYTES = 16 * 1024
const CHAT_MAX_TEXT_CHARS = 280
const CHAT_MAX_BYTES = 1024
const COMMAND_EVENT_RING_MAX = 256
const CHECKPOINT_INTERVAL_MS = 5_000
const CHECKPOINT_EVENT_THRESHOLD = 100
const INTERNAL_CHECKPOINT_TIMEOUT_MS = 15_000
const WORLD_MUTATION_KINDS = new Set([
  'object_added',
  'object_updated',
  'object_removed',
  'object_transformed',
  'crafted_scene_added',
  'crafted_scene_updated',
  'portal_added',
  'spatial_web_added',
  'spatial_web_updated',
  'spatial_web_value_set',
  'agent_window_added',
  'agent_avatar_added',
  'placement_vfx',
  'sky_changed',
  'ground_changed',
  'ground_painted',
  'ground_tile_erased',
  'ground_tiles_cleared',
  'terrain_brushed',
  'terrain_reset',
  'behavior_updated',
  'light_added',
  'light_removed',
  'light_updated',
  'stroke_started',
  'stroke_pointed',
  'stroke_ended',
  'stroke_updated',
  'stroke_removed',
  'text3d_added',
  'text3d_removed',
  'text3d_updated',
])
const WORLD_COMMAND_KINDS = new Set([
  'object.add',
  'object.update',
  'object.remove',
  'object.transform',
  'object.behavior.update',
  'crafted.add',
  'crafted.update',
  'crafted.remove',
  'portal.add',
  'portal.update',
  'portal.remove',
  'spatial.add',
  'spatial.update',
  'spatial.remove',
  'spatial.value.set',
  'ground.setPreset',
  'ground.paint',
  'ground.tile.erase',
  'ground.tiles.clear',
  'terrain.brush',
  'terrain.reset',
  'light.add',
  'light.update',
  'light.remove',
  'sky.set',
  'stroke.start',
  'stroke.point',
  'stroke.end',
  'stroke.update',
  'stroke.remove',
  'text3d.add',
  'text3d.update',
  'text3d.remove',
  'agent.window.add',
  'agent.window.update',
  'agent.window.remove',
  'agent.avatar.add',
  'agent.avatar.update',
  'agent.avatar.remove',
  'media.playback.set',
  'placement.vfx',
])
const WORLD_LIGHT_TYPES = new Set(['point', 'spot', 'directional', 'ambient', 'hemisphere', 'environment'])
const TRANSIENT_WORLD_COMMAND_KINDS = new Set([
  'placement.vfx',
  'stroke.start',
  'stroke.point',
])

// PvP combat constants
const RESPAWN_DELAY_MS = 5000
/** How long the room keeps an ActiveBolt around for reportHit reference.
 *  Matches client-side BOLT_DEFAULT_TTL_S (~2.5s) plus a network-jitter pad.
 *  After this, the bolt is retired and any reportHit referencing it is rejected. */
const BOLT_TTL_MS = 3500
/** Max casts/sec per player; the casting client also rate-limits via cooldown
 *  but we double-check server-side to deny modified clients spamming. */
const CAST_TOKENS_PER_SEC = 4
const CAST_BURST = 6
/** Tolerance window for reportHit timestamp vs server-side bolt age. Casual
 *  PvP standard is 50-100ms; we pick 150ms to favour cooperative clients on
 *  shaky home wifi over strict anti-cheat. */
const HIT_REPORT_TOLERANCE_MS = 150
/** Max distance from caster origin a hit can claim; rejects "I hit you from
 *  across the map" lies that survive timestamp validation. */
const MAX_HIT_DISTANCE_M = 80

function resolveInternalOasisBaseUrl(): string {
  return (process.env.OASIS_WEB_INTERNAL_URL || process.env.OASIS_INTERNAL_URL || 'http://127.0.0.1:4516').replace(/\/+$/, '')
}

function resolveInternalCommandSecret(): string {
  const secret = process.env.OASIS_ROOM_INTERNAL_SECRET || process.env.OASIS_ROOM_SIGNING_KEY || process.env.RELAY_SIGNING_KEY
  if (secret) return secret
  if (process.env.OASIS_MODE === 'hosted') throw new Error('OASIS_ROOM_INTERNAL_SECRET or RELAY_SIGNING_KEY is required in hosted mode')
  return 'oasis-room-dev-key-do-not-use-in-production'
}

function sanitizeWorldId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, 96)
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function resolveMaxClients(): number {
  return clampInteger(
    process.env.OASIS_ROOM_MAX_CLIENTS,
    DEFAULT_MAX_PLAYERS_PER_WORLD,
    1,
    MAX_CONFIGURABLE_PLAYERS_PER_WORLD,
  )
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

function clampHp(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(10_000, Math.floor(n)))
}

function clampResource(value: unknown, fallback: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, Math.floor(n)))
}

function clampSpell(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value === 'firebolt' || value === 'lightning-bolt' || value === 'ice-bolt') return value
  return null
}

function clampDesignLetter(value: unknown): string {
  if (typeof value !== 'string') return 'A'
  const upper = value.toUpperCase()
  if (upper === 'A' || upper === 'B' || upper === 'C' || upper === 'D') return upper
  return 'A'
}

function clampId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && (record[key] as string).trim().length > 0
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return Number.isFinite(Number(record[key]))
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => Number.isFinite(Number(item)))
}

function isSpatialValue(value: unknown): boolean {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

function isPositiveScale(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return isVec3(value) && value.every(item => Number(item) > 0)
}

function validateCatalogPlacement(value: unknown): string | null {
  if (!isRecord(value)) return 'object.add missing object'
  if (!hasString(value, 'id')) return 'object.add missing object.id'
  if (!hasString(value, 'catalogId')) return 'object.add missing object.catalogId'
  if (!hasString(value, 'name')) return 'object.add missing object.name'
  if (!isVec3(value.position)) return 'object.add invalid object.position'
  return isPositiveScale(value.scale) ? null : 'object.add invalid object.scale'
}

function validateWorldLight(value: unknown): string | null {
  if (!isRecord(value)) return 'light.add missing light'
  if (!hasString(value, 'id')) return 'light.add missing light.id'
  if (typeof value.type !== 'string' || !WORLD_LIGHT_TYPES.has(value.type)) return 'light.add invalid light.type'
  if (!hasNumber(value, 'intensity')) return 'light.add invalid light.intensity'
  if (!isVec3(value.position)) return 'light.add invalid light.position'
  if (value.target !== undefined && !isVec3(value.target)) return 'light.add invalid light.target'
  return null
}

function validateCommandPayloadShape(kind: string, payload: unknown): string | null {
  if (!isRecord(payload)) return 'command payload must be an object'

  if (kind.endsWith('.remove')) {
    return hasString(payload, 'id') ? null : 'remove command missing id'
  }
  if (kind.endsWith('.update')) {
    if (!hasString(payload, 'id')) return 'update command missing id'
    return isRecord(payload.updates) ? null : 'update command missing updates object'
  }

  switch (kind) {
    case 'object.add':
      return validateCatalogPlacement(payload.object)
    case 'object.transform':
      if (!hasString(payload, 'id')) return 'object.transform missing id'
      if (payload.position !== undefined && !isVec3(payload.position)) return 'object.transform invalid position'
      if (payload.rotation !== undefined && !isVec3(payload.rotation)) return 'object.transform invalid rotation'
      if (payload.scale !== undefined && !isPositiveScale(payload.scale)) return 'object.transform invalid scale'
      return null
    case 'object.behavior.update':
      if (!hasString(payload, 'id')) return 'object.behavior.update missing id'
      return isRecord(payload.updates) ? null : 'object.behavior.update missing updates object'
    case 'crafted.add':
      return isRecord(payload.scene) && hasString(payload.scene, 'id') ? null : 'crafted.add missing scene.id'
    case 'portal.add':
      return isRecord(payload.gate) && hasString(payload.gate, 'id') ? null : 'portal.add missing gate.id'
    case 'spatial.add':
      return isRecord(payload.object) && hasString(payload.object, 'id') ? null : 'spatial.add missing object.id'
    case 'spatial.value.set':
      if (!hasString(payload, 'id')) return 'spatial.value.set missing id'
      return isSpatialValue(payload.value) ? null : 'spatial.value.set invalid value'
    case 'ground.setPreset':
      return hasString(payload, 'groundPresetId') ? null : 'ground.setPreset missing groundPresetId'
    case 'ground.paint':
      if (!hasNumber(payload, 'cx') || !hasNumber(payload, 'cz')) return 'ground.paint missing coordinates'
      if (payload.size !== undefined && !Number.isFinite(Number((payload as Record<string, unknown>).size))) return 'ground.paint invalid size'
      if (payload.stretch !== undefined && !Number.isFinite(Number((payload as Record<string, unknown>).stretch))) return 'ground.paint invalid stretch'
      return hasString(payload, 'presetId') ? null : 'ground.paint missing presetId'
    case 'ground.tile.erase':
      return hasNumber(payload, 'x') && hasNumber(payload, 'z') ? null : 'ground.tile.erase missing coordinates'
    case 'ground.tiles.clear':
    case 'terrain.reset':
      return null
    case 'terrain.brush':
      if (!hasNumber(payload, 'x') || !hasNumber(payload, 'z')) return 'terrain.brush missing coordinates'
      if (!hasNumber(payload, 'radius') || !hasNumber(payload, 'intensity') || !hasNumber(payload, 'deltaSeconds')) return 'terrain.brush missing numeric brush params'
      return payload.direction === 'up' || payload.direction === 'down' ? null : 'terrain.brush invalid direction'
    case 'light.add':
      return validateWorldLight(payload.light)
    case 'sky.set':
      return hasString(payload, 'skyBackgroundId') ? null : 'sky.set missing skyBackgroundId'
    case 'stroke.start':
      if (!hasString(payload, 'strokeId') || !hasString(payload, 'authorId')) return 'stroke.start missing id/author'
      return isRecord(payload.style) ? null : 'stroke.start missing style'
    case 'stroke.point':
      if (!hasString(payload, 'strokeId')) return 'stroke.point missing strokeId'
      return isVec3(payload.point) ? null : 'stroke.point invalid point'
    case 'stroke.end':
      if (!hasString(payload, 'strokeId')) return 'stroke.end missing strokeId'
      return isRecord(payload.finalStroke) && hasString(payload.finalStroke, 'id') ? null : 'stroke.end missing finalStroke.id'
    case 'text3d.add':
      return isRecord(payload.object) && hasString(payload.object, 'id') ? null : 'text3d.add missing object.id'
    case 'agent.window.add':
      return isRecord(payload.window) && hasString(payload.window, 'id') ? null : 'agent.window.add missing window.id'
    case 'agent.avatar.add':
      return isRecord(payload.avatar) && hasString(payload.avatar, 'id') ? null : 'agent.avatar.add missing avatar.id'
    case 'media.playback.set':
      if (!hasString(payload, 'objectId')) return 'media.playback.set missing objectId'
      if (payload.playbackScope !== 'shared' && payload.playbackScope !== 'local') return 'media.playback.set invalid playbackScope'
      return payload.state === 'playing' || payload.state === 'paused' || payload.state === 'stopped' ? null : 'media.playback.set invalid state'
    case 'placement.vfx':
      return isVec3(payload.position) ? null : 'placement.vfx invalid position'
    default:
      return null
  }
}

function validateRoomScopedCommand(kind: string, payload: unknown): string | null {
  if (!isRecord(payload)) return null
  if (kind === 'spatial.value.set') {
    const scope = payload.stateScope
    if (scope === 'session' || scope === 'actor') {
      return 'spatial.value.set is not room-scoped'
    }
  }
  if (kind === 'media.playback.set' && payload.playbackScope === 'local') {
    return 'media.playback.set local playback is not room-scoped'
  }
  return null
}

interface MutationBucket {
  tokens: number
  lastRefillAt: number
}

interface CastBucket {
  tokens: number
  lastRefillAt: number
}

interface WorldCommandMessage {
  id?: unknown
  kind?: unknown
  worldId?: unknown
  actorId?: unknown
  actorDisplayName?: unknown
  clientId?: unknown
  createdAt?: unknown
  payload?: unknown
}

interface WorldEventMessage {
  id: string
  kind: 'command.accepted' | 'command.rejected'
  worldId: string
  commandId?: string
  actorId?: string
  acceptedAt: string
  revision: number
  error?: string
  command?: unknown
  source?: 'room' | 'http'
  durable?: boolean
}

interface WorldSnapshotMessage {
  worldId: string
  revision: number
  savedAt?: string
  loadedAt: number
  reason: 'join' | 'refresh' | 'command'
  state: unknown
}

export class WorldRoom extends Room<WorldRoomState> {
  override maxClients = resolveMaxClients()
  private readonly playerAccess = new Map<string, RoomAccess>()
  private readonly mutationBuckets = new Map<string, MutationBucket>()
  private readonly castBuckets = new Map<string, CastBucket>()
  private readonly commandEvents = new Map<string, WorldEventMessage>()
  private readonly commandEventRing: WorldEventMessage[] = []
  private worldSnapshot: WorldSnapshotMessage | null = null
  private worldSnapshotPromise: Promise<WorldSnapshotMessage | null> | null = null
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null
  private checkpointInFlightPromise: Promise<void> | null = null
  private checkpointDirtyEvents: WorldEventMessage[] = []
  private checkpointActorUserId = 'local-user'
  private checkpointBaseSavedAt: string | null = null
  private commandQueue: Promise<void> = Promise.resolve()
  private worldRevision = 0
  /** Tracks which (boltId, victimSessionId) pairs have already been
   *  consumed so a hostile client can't repeatedly report the same hit. */
  private readonly consumedHits = new Set<string>()

  private resolveJoinAccess(options: JoinOptions, expectedWorldId = this.state.worldId): RoomAccess {
    if (shouldRequireRoomJoinClaim()) {
      return verifyRoomJoinClaim(options.joinClaim, expectedWorldId)
    }
    if (options.joinClaim) {
      try {
        return verifyRoomJoinClaim(options.joinClaim, expectedWorldId)
      } catch (error) {
        console.warn(`[room ${this.roomId}] ignoring invalid optional join claim:`, error instanceof Error ? error.message : String(error))
      }
    }
    return fallbackRoomAccess({ userId: options.userId, pvpEnabled: options.pvpEnabled })
  }

  private async fetchWorldSnapshot(actorUserId: string, reason: WorldSnapshotMessage['reason']): Promise<WorldSnapshotMessage | null> {
    const response = await fetch(`${resolveInternalOasisBaseUrl()}/api/worlds/${encodeURIComponent(this.state.worldId)}`, {
      headers: {
        'x-oasis-room-secret': resolveInternalCommandSecret(),
        'x-oasis-actor-user-id': actorUserId || 'local-user',
      },
    })
    if (!response.ok) return null
    const latestRevision = Number(response.headers.get('x-oasis-world-revision') || 0)
    if (Number.isFinite(latestRevision)) {
      this.worldRevision = Math.max(this.worldRevision, Math.floor(latestRevision))
    }
    const state = await response.json().catch(() => null)
    if (!state || typeof state !== 'object') return null
    const savedAt = typeof (state as { savedAt?: unknown }).savedAt === 'string'
      ? (state as { savedAt: string }).savedAt
      : null
    this.checkpointBaseSavedAt = savedAt
    return this.setWorldSnapshot(state, reason)
  }

  private ensureWorldSnapshot(actorUserId: string, reason: WorldSnapshotMessage['reason']): Promise<WorldSnapshotMessage | null> {
    if (this.worldSnapshot) return Promise.resolve(this.worldSnapshot)
    if (!this.worldSnapshotPromise) {
      this.worldSnapshotPromise = this.fetchWorldSnapshot(actorUserId, reason)
        .catch(error => {
          console.warn(`[room ${this.roomId}] snapshot load failed:`, error instanceof Error ? error.message : String(error))
          return null
        })
        .finally(() => {
          this.worldSnapshotPromise = null
        })
    }
    return this.worldSnapshotPromise
  }

  private setWorldSnapshot(state: unknown, reason: WorldSnapshotMessage['reason']): WorldSnapshotMessage {
    const savedAt = state && typeof state === 'object' && typeof (state as { savedAt?: unknown }).savedAt === 'string'
      ? (state as { savedAt: string }).savedAt
      : undefined
    const snapshot: WorldSnapshotMessage = {
      worldId: this.state.worldId,
      revision: this.worldRevision,
      ...(savedAt ? { savedAt } : {}),
      loadedAt: Date.now(),
      reason,
      state,
    }
    this.worldSnapshot = snapshot
    return snapshot
  }

  private sendWorldSnapshot(client: Client, actorUserId: string, reason: WorldSnapshotMessage['reason']): void {
    void this.ensureWorldSnapshot(actorUserId, reason).then(snapshot => {
      if (!snapshot) return
      client.send('worldSnapshot', snapshot)
    })
  }

  private scheduleCheckpoint(actorUserId: string, event: WorldEventMessage): void {
    this.checkpointActorUserId = actorUserId || this.checkpointActorUserId
    this.checkpointDirtyEvents.push(event)
    if (this.checkpointDirtyEvents.length >= CHECKPOINT_EVENT_THRESHOLD) {
      void this.flushCheckpoint('threshold')
      return
    }
    if (this.checkpointTimer) return
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null
      void this.flushCheckpoint('timer')
    }, CHECKPOINT_INTERVAL_MS)
  }

  private async flushCheckpoint(reason: 'timer' | 'threshold' | 'dispose'): Promise<void> {
    if (this.checkpointInFlightPromise) {
      await this.checkpointInFlightPromise
      if (reason === 'dispose' && this.checkpointDirtyEvents.length > 0) {
        return this.flushCheckpoint(reason)
      }
      return
    }
    this.checkpointInFlightPromise = this.doFlushCheckpoint(reason)
    try {
      await this.checkpointInFlightPromise
    } finally {
      this.checkpointInFlightPromise = null
    }
  }

  private async doFlushCheckpoint(reason: 'timer' | 'threshold' | 'dispose'): Promise<void> {
    const snapshot = this.worldSnapshot
    if (!snapshot || this.checkpointDirtyEvents.length === 0) return
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer)
      this.checkpointTimer = null
    }

    const events = this.checkpointDirtyEvents.splice(0)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), INTERNAL_CHECKPOINT_TIMEOUT_MS)
    try {
      const response = await fetch(`${resolveInternalOasisBaseUrl()}/api/worlds/${encodeURIComponent(this.state.worldId)}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-oasis-room-secret': resolveInternalCommandSecret(),
          'x-oasis-actor-user-id': this.checkpointActorUserId || 'local-user',
          'x-oasis-room-checkpoint': reason,
          ...(this.checkpointBaseSavedAt ? { 'x-oasis-client-loaded-at': this.checkpointBaseSavedAt } : {}),
        },
        body: JSON.stringify({
          state: snapshot.state,
          events,
          baseSavedAt: this.checkpointBaseSavedAt,
          revision: this.worldRevision,
        }),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null) as {
        ok?: boolean
        savedAt?: string
        serverUpdatedAt?: string
        conflict?: boolean
        eventsSaved?: number
        eventsSkipped?: number
        error?: string
      } | null
      if (!response.ok || body?.ok === false) {
        this.checkpointDirtyEvents.unshift(...events)
        if (body?.conflict) {
          await this.rebaseDirtyCommandsAfterCheckpointConflict(this.checkpointActorUserId || 'local-user', body.serverUpdatedAt)
        }
        console.warn(`[room ${this.roomId}] checkpoint failed:`, body?.error || `HTTP ${response.status}`)
        return
      }
      if (body?.savedAt && this.worldSnapshot?.state && typeof this.worldSnapshot.state === 'object') {
        ;(this.worldSnapshot.state as { savedAt?: string }).savedAt = body.savedAt
        this.worldSnapshot.savedAt = body.savedAt
        this.checkpointBaseSavedAt = body.savedAt
      }
      console.log(`[room ${this.roomId}] checkpoint ok reason=${reason} events=${events.length} saved=${body?.eventsSaved ?? '?'} skipped=${body?.eventsSkipped ?? '?'} rev=${this.worldRevision}`)
    } catch (error) {
      this.checkpointDirtyEvents.unshift(...events)
      console.warn(`[room ${this.roomId}] checkpoint failed:`, error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timeout)
      if (this.checkpointDirtyEvents.length > 0 && !this.checkpointTimer && reason !== 'dispose') {
        this.checkpointTimer = setTimeout(() => {
          this.checkpointTimer = null
          void this.flushCheckpoint('timer')
        }, CHECKPOINT_INTERVAL_MS)
      }
    }
  }

  private async rebaseDirtyCommandsAfterCheckpointConflict(actorUserId: string, serverUpdatedAt?: string): Promise<void> {
    const dirtyEvents = this.checkpointDirtyEvents.slice()
    if (dirtyEvents.length === 0) return
    this.worldSnapshot = null
    this.worldSnapshotPromise = null
    const snapshot = await this.fetchWorldSnapshot(actorUserId, 'refresh')
    if (!snapshot) return
    let current = snapshot.state
    let changed = false
    for (const event of dirtyEvents) {
      const command = event.command
      if (!command || typeof command !== 'object') continue
      const applied = applyRoomWorldCommand(current, command)
      current = applied.state
      changed = changed || applied.changed
    }
    if (changed) {
      this.setWorldSnapshot(current, 'command')
      console.warn(`[room ${this.roomId}] rebased ${dirtyEvents.length} dirty events after checkpoint conflict${serverUpdatedAt ? ` serverUpdatedAt=${serverUpdatedAt}` : ''}`)
    }
  }

  private enqueueDurableCommandApply<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandQueue.then(task, task)
    this.commandQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async applyDurableCommandInOrder(
    commandId: string,
    command: WorldCommandMessage,
    actorUserId: string,
  ): Promise<WorldEventMessage> {
    return this.enqueueDurableCommandApply(async () => {
      const duplicate = this.commandEvents.get(commandId)
      if (duplicate) return duplicate

      const snapshot = await this.ensureWorldSnapshot(actorUserId, 'refresh')
      if (!snapshot) {
        throw new Error('world snapshot unavailable')
      }

      const applied = applyRoomWorldCommand(snapshot.state, command)
      if (applied.changed) {
        this.worldRevision += 1
        this.setWorldSnapshot(applied.state, 'command')
      }
      const event = this.makeCommandEvent('command.accepted', command, commandId)
      event.revision = this.worldRevision
      event.durable = applied.changed
      if (applied.changed) this.scheduleCheckpoint(actorUserId, event)
      this.rememberCommandEvent(commandId, event)
      return event
    })
  }

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

  private consumeCastToken(sessionId: string, now: number): boolean {
    let bucket = this.castBuckets.get(sessionId)
    if (!bucket) {
      bucket = { tokens: CAST_BURST, lastRefillAt: now }
      this.castBuckets.set(sessionId, bucket)
    } else {
      const elapsedSec = (now - bucket.lastRefillAt) / 1000
      if (elapsedSec > 0) {
        bucket.tokens = Math.min(CAST_BURST, bucket.tokens + elapsedSec * CAST_TOKENS_PER_SEC)
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
    this.maxClients = resolveMaxClients()
    const worldId = sanitizeWorldId(options.worldId)
    if (!worldId) {
      throw new Error('worldId is required to create a WorldRoom')
    }

    const state = new WorldRoomState()
    state.worldId = worldId
    const firstJoinAccess = this.resolveJoinAccess(options, worldId)
    // First-joiner sets PvP for the room lifetime. Subsequent joiners can
    // NOT flip this — they pass their own value, we just ignore it. The
    // Next.js side is the source of truth via World.pvpEnabled; clients
    // read it before joining and pass it through. v2 will sign this with
    // a server-issued token so clients can't lie.
    state.pvpEnabled = firstJoinAccess.pvpEnabled
    this.setState(state)

    this.setPatchRate(1000 / PATCH_HZ)
    this.setSimulationInterval(deltaMs => this.simulate(deltaMs), 1000 / SIM_HZ)

    this.setMetadata({ worldId, maxClients: this.maxClients }).catch(() => {})
    recordWorldRoomCreated(worldId, this.maxClients)
    void this.ensureWorldSnapshot(firstJoinAccess.userId, 'refresh')
    console.log(`[room ${this.roomId}] created worldId=${worldId} maxClients=${this.maxClients}`)

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
        userId: player.userId,
        sessionId: client.sessionId,
        displayName: player.displayName,
        avatarUrl: player.avatarUrl,
        profileAvatarUrl: player.profileAvatarUrl,
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
      if (typeof payload.profileAvatarUrl === 'string') {
        player.profileAvatarUrl = payload.profileAvatarUrl.trim().slice(0, 500)
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
        userId: player.userId,
        sessionId: client.sessionId,
        displayName: player.displayName,
        avatarUrl: player.avatarUrl,
        profileAvatarUrl: player.profileAvatarUrl,
        color: player.color,
        position: [player.x, player.y, player.z],
        yaw: player.yaw,
        animState: player.animState,
        updatedAt: player.updatedAt,
      })
    })

    this.onMessage('vitals', (client, payload: VitalsMessage) => {
      // The profile DB remains the durable progression source, but clients can
      // recover/recharge there while the room is already live. Mirror that
      // fresh local state into the room so PvP HUDs do not stick at stale zero.
      const player = this.state.players.get(client.sessionId)
      if (!player || !payload || typeof payload !== 'object') return

      if (payload.maxHp !== undefined) {
        player.maxHp = clampHp(payload.maxHp, player.maxHp)
        player.hp = clampResource(player.hp, player.hp, player.maxHp)
      }
      if (payload.maxMana !== undefined) {
        player.maxMana = clampHp(payload.maxMana, player.maxMana)
        player.mana = clampResource(player.mana, player.mana, player.maxMana)
      }
      if (payload.hp !== undefined) {
        player.hp = clampResource(payload.hp, player.hp, player.maxHp)
      }
      if (payload.mana !== undefined) {
        player.mana = clampResource(payload.mana, player.mana, player.maxMana)
      }
      if (player.hp > 0 && !player.alive && player.respawnAt === 0) {
        player.alive = true
      }
      player.updatedAt = Date.now()
    })

    this.onMessage('chat', (client, payload: ChatMessage) => {
      const player = this.state.players.get(client.sessionId)
      const access = this.playerAccess.get(client.sessionId)
      if (!player || !access?.canRead) return
      if (!payload || typeof payload !== 'object') return

      const text = sanitizeText(payload.text, '', CHAT_MAX_TEXT_CHARS)
      if (!text) return
      const id = typeof payload.id === 'string'
        ? sanitizeText(payload.id, '', 96)
        : `chat-${Date.now()}-${client.sessionId}`

      let serializedSize: number
      try {
        serializedSize = JSON.stringify({ id, text }).length
      } catch {
        return
      }
      if (serializedSize > CHAT_MAX_BYTES) return
      if (!this.consumeMutationToken(client.sessionId, Date.now())) return

      this.broadcast('chat', {
        id: id || `chat-${Date.now()}-${client.sessionId}`,
        worldId: this.state.worldId,
        sessionId: client.sessionId,
        userId: player.userId || access.userId,
        playerId: player.playerId,
        displayName: player.displayName,
        color: player.color,
        text,
        createdAt: Date.now(),
      })
    })

    this.onMessage('cast', (client, payload: CastMessage) => {
      // PvP cast → broadcast to peers via state.bolts diff. Server validates
      // alive + mana + rate. Damage applied later via reportHit, not here —
      // bolts are deterministic geometry; the killing shot is whichever one
      // the caster reports landing, validated against the bolt's recorded
      // origin/direction at the claimed timestamp.
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      if (!this.state.pvpEnabled) return
      if (!player.alive) return
      if (!payload || typeof payload !== 'object') return

      const spell = clampSpell(payload.spell)
      if (!spell) return

      // Mana cost — same as PvE (1 per cast for now). Server-deducted so a
      // modified client can't cast at zero mana.
      const cost = 1
      if (player.mana < cost) return

      if (!this.consumeCastToken(client.sessionId, Date.now())) return

      const id = clampId(payload.clientPredictionId) || `b${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      // Idempotency: refuse duplicate ids (lossy retransmit / replay).
      for (const existing of this.state.bolts) {
        if (existing.id === id) return
      }

      const bolt = new ActiveBolt()
      bolt.id = id
      bolt.casterSessionId = client.sessionId
      bolt.spell = spell
      bolt.design = clampDesignLetter(payload.design)
      bolt.ox = clampPos(payload.ox, player.x)
      bolt.oy = clampPos(payload.oy, player.y + 1.5)
      bolt.oz = clampPos(payload.oz, player.z)
      // Direction is a unit vector. We don't normalize server-side; clients
      // are expected to send normalized. We clamp components to [-1, 1] to
      // keep the geometry sane even if a client lies.
      bolt.dx = Math.max(-1, Math.min(1, Number(payload.dx) || 0))
      bolt.dy = Math.max(-1, Math.min(1, Number(payload.dy) || 0))
      bolt.dz = Math.max(-1, Math.min(1, Number(payload.dz) || 1))
      bolt.speed = Math.max(1, Math.min(100, Number(payload.speed) || 24))
      bolt.damage = Math.max(1, Math.min(100, Number(payload.damage) || 14))
      bolt.spawnedAt = Date.now()
      bolt.seed = Math.floor(Math.abs(Number(payload.seed)) || (Math.random() * 0xffffffff)) & 0xffffffff

      player.mana = Math.max(0, player.mana - cost)
      this.state.bolts.push(bolt)
      this.broadcast('cast', {
        id: bolt.id,
        casterSessionId: bolt.casterSessionId,
        spell: bolt.spell,
        design: bolt.design,
        ox: bolt.ox,
        oy: bolt.oy,
        oz: bolt.oz,
        dx: bolt.dx,
        dy: bolt.dy,
        dz: bolt.dz,
        speed: bolt.speed,
        damage: bolt.damage,
        spawnedAt: bolt.spawnedAt,
        seed: bolt.seed,
      }, { except: client })
    })

    this.onMessage('reportHit', (client, payload: ReportHitMessage) => {
      // PvP-only: hit reports against player victims. Hits on NPCs/objects
      // are still authoritative on the local client (existing PvE flow); we
      // only validate player-vs-player damage here.
      if (!this.state.pvpEnabled) return
      if (!payload || typeof payload !== 'object') return
      const boltId = clampId(payload.boltId)
      const victimSessionId = clampId(payload.victimSessionId)
      if (!boltId || !victimSessionId) return
      if (victimSessionId === client.sessionId) return  // can't friendly-fire self

      const hitKey = `${boltId}:${victimSessionId}`
      if (this.consumedHits.has(hitKey)) return
      this.consumedHits.add(hitKey)

      let bolt: ActiveBolt | null = null
      for (const b of this.state.bolts) {
        if (b.id === boltId) { bolt = b; break }
      }
      if (!bolt) return  // bolt retired or never existed
      if (bolt.casterSessionId !== client.sessionId) return  // only caster can report their hits
      const victim = this.state.players.get(victimSessionId)
      if (!victim) return
      if (!victim.alive) return

      const now = Date.now()
      const boltAgeMs = now - bolt.spawnedAt
      if (boltAgeMs < 0 || boltAgeMs > BOLT_TTL_MS + HIT_REPORT_TOLERANCE_MS) return

      // Distance gate. Hit can't land further than the bolt could plausibly
      // have travelled in boltAgeMs (with tolerance), and can't exceed the
      // hard cap. Victim position is server-stored from input messages.
      const maxPlausibleDistance = (bolt.speed * boltAgeMs / 1000) + 2
      const dx = victim.x - bolt.ox
      const dy = victim.y - bolt.oy
      const dz = victim.z - bolt.oz
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (distance > maxPlausibleDistance || distance > MAX_HIT_DISTANCE_M) return

      const previousHp = victim.hp
      const damageApplied = Math.min(previousHp, bolt.damage)
      victim.hp = Math.max(0, victim.hp - bolt.damage)

      if (damageApplied > 0) {
        client.send('hitAward', {
          victimId: victimSessionId,
          victimName: victim.displayName,
          damage: damageApplied,
          xp: damageApplied,
          position: [victim.x, victim.y, victim.z],
          spell: bolt.spell,
        })
      }

      const caster = this.state.players.get(client.sessionId)
      if (victim.hp <= 0) {
        victim.alive = false
        victim.respawnAt = now + RESPAWN_DELAY_MS
        victim.lastKilledBy = caster ? caster.displayName : 'Unknown'
        this.broadcast('death', {
          casterId: client.sessionId,
          casterName: caster?.displayName ?? 'Unknown',
          victimId: victimSessionId,
          victimName: victim.displayName,
          spell: bolt.spell,
        })
      }
    })

    this.onMessage('mutation', (client, payload: unknown) => {
      // Legacy lane: still exists for old clients, but it must respect the
      // same room-issued write claim as the command rail.
      const access = this.playerAccess.get(client.sessionId)
      if (!access?.canWrite) return

      // Defensive caps: shape, payload size, per-client rate.
      if (!payload || typeof payload !== 'object') return
      const env = payload as { kind?: unknown; payload?: unknown }
      if (typeof env.kind !== 'string' || env.kind.length > 64) return
      if (!WORLD_MUTATION_KINDS.has(env.kind)) return

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

      recordWorldMutation(this.state.worldId)
      this.broadcast('mutation', payload, { except: client })
    })

    this.onMessage('command', async (client, payload: WorldCommandMessage) => {
      const rejected = (commandId: string | undefined, error: string) => {
        recordWorldCommand(this.state.worldId, false, payload?.createdAt)
        const player = this.state.players.get(client.sessionId)
        const access = this.playerAccess.get(client.sessionId)
        const rejectionCommand = payload && typeof payload === 'object'
          ? {
              ...payload,
              worldId: this.state.worldId,
              actorId: access?.userId || client.sessionId,
              actorDisplayName: player?.displayName,
              clientId: client.sessionId,
            }
          : payload
        client.send('worldEvent', this.makeCommandEvent('command.rejected', rejectionCommand, commandId, error))
      }

      if (!payload || typeof payload !== 'object') return
      const commandId = typeof payload.id === 'string' ? sanitizeText(payload.id, '', 160) : ''
      if (!commandId) {
        rejected(undefined, 'missing command id')
        return
      }

      const existingEvent = this.commandEvents.get(commandId)
      if (existingEvent) {
        client.send('worldEvent', existingEvent)
        return
      }

      if (typeof payload.kind !== 'string' || !WORLD_COMMAND_KINDS.has(payload.kind)) {
        rejected(commandId, 'unsupported command kind')
        return
      }
      if (typeof payload.worldId !== 'string' || sanitizeWorldId(payload.worldId) !== this.state.worldId) {
        rejected(commandId, 'world id mismatch')
        return
      }
      const player = this.state.players.get(client.sessionId)
      if (!player) {
        rejected(commandId, 'missing room player')
        return
      }
      const access = this.playerAccess.get(client.sessionId)
      if (!access?.canRead) {
        rejected(commandId, 'missing room access claim')
        return
      }
      if (payload.payload === undefined) {
        rejected(commandId, 'missing command payload')
        return
      }

      let serializedSize = 0
      try {
        serializedSize = JSON.stringify(payload).length
      } catch {
        rejected(commandId, 'unserializable command')
        return
      }
      if (serializedSize > WORLD_COMMAND_MAX_BYTES) {
        rejected(commandId, 'command too large')
        return
      }
      const payloadError = validateCommandPayloadShape(payload.kind, payload.payload)
      if (payloadError) {
        rejected(commandId, payloadError)
        return
      }
      const scopeError = validateRoomScopedCommand(payload.kind, payload.payload)
      if (scopeError) {
        rejected(commandId, scopeError)
        return
      }
      if (!this.consumeMutationToken(client.sessionId, Date.now())) {
        rejected(commandId, 'command rate limited')
        return
      }

      const transient = TRANSIENT_WORLD_COMMAND_KINDS.has(payload.kind)
      if (!transient && !access.canWrite) {
        rejected(commandId, 'world write forbidden')
        return
      }
      const canonicalCommand: WorldCommandMessage = {
        ...payload,
        id: commandId,
        kind: payload.kind,
        worldId: this.state.worldId,
        actorId: access.userId,
        actorDisplayName: player.displayName,
        clientId: client.sessionId,
        createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      }
      try {
        let event: WorldEventMessage
        if (transient) {
          event = this.makeCommandEvent('command.accepted', canonicalCommand, commandId)
        } else {
          event = await this.applyDurableCommandInOrder(commandId, canonicalCommand, access.userId)
        }
        if (event.kind === 'command.rejected') {
          recordWorldCommand(this.state.worldId, false, canonicalCommand.createdAt)
          client.send('worldEvent', event)
          return
        }
        recordWorldCommand(this.state.worldId, true, canonicalCommand.createdAt)
        if (!this.commandEvents.has(commandId)) this.rememberCommandEvent(commandId, event)
        this.broadcast('worldEvent', event)
      } catch (error) {
        rejected(commandId, error instanceof Error ? error.message : String(error))
      }
    })
  }

  override onJoin(client: Client, options: JoinOptions): void {
    let access: RoomAccess
    try {
      access = this.resolveJoinAccess(options)
    } catch (error) {
      console.warn(`[room ${this.roomId}] rejected join ${client.sessionId}:`, error instanceof Error ? error.message : String(error))
      client.leave(4001)
      return
    }
    this.playerAccess.set(client.sessionId, access)
    const player = new PlayerState()
    player.userId = access.userId
    player.playerId = sanitizePlayerId(options.playerId, client.sessionId)
    player.displayName = sanitizeText(options.displayName, `Player ${player.playerId.slice(0, 4)}`)
    player.avatarUrl = (typeof options.avatarUrl === 'string' ? options.avatarUrl.trim() : '').slice(0, 500)
    player.profileAvatarUrl = (typeof options.profileAvatarUrl === 'string' ? options.profileAvatarUrl.trim() : '').slice(0, 500)
    player.color = sanitizeText(options.color, '#38bdf8', 7)
    player.updatedAt = Date.now()
    // PvP stats — client passes its own max values (computed from skills).
    // V1 trusts the client; v2 will verify via signed API callback.
    player.maxHp = clampHp(options.maxHp, 100)
    player.maxMana = clampHp(options.maxMana, 20)
    player.hp = player.maxHp
    player.mana = clampResource(options.mana, player.maxMana, player.maxMana)
    player.alive = true
    player.respawnAt = 0
    this.state.players.set(client.sessionId, player)
    rosterUpsert(this.state.worldId, client.sessionId, {
      playerId: player.playerId,
      userId: player.userId,
      sessionId: client.sessionId,
      displayName: player.displayName,
      avatarUrl: player.avatarUrl,
      profileAvatarUrl: player.profileAvatarUrl,
      color: player.color,
      position: [player.x, player.y, player.z],
      yaw: player.yaw,
      animState: player.animState,
      updatedAt: player.updatedAt,
    })
    this.sendWorldSnapshot(client, access.userId, 'join')
    console.log(`[room ${this.roomId}] join ${client.sessionId} (${player.displayName}) total=${this.state.players.size}`)
  }

  override onLeave(client: Client): void {
    // try/finally guards against a roster leak if state.players.delete or
    // mutationBuckets.delete were to throw mid-cleanup — the roster must
    // drop the session regardless so /world-players doesn't keep reporting
    // ghosts.
    try {
      this.state.players.delete(client.sessionId)
      this.playerAccess.delete(client.sessionId)
      this.mutationBuckets.delete(client.sessionId)
      this.castBuckets.delete(client.sessionId)
      // Drop any bolts the leaving player owned — they can't be referenced
      // for hit reports anymore and would otherwise leak until TTL.
      for (let i = this.state.bolts.length - 1; i >= 0; i -= 1) {
        if (this.state.bolts[i]?.casterSessionId === client.sessionId) {
          this.state.bolts.splice(i, 1)
        }
      }
    } finally {
      rosterRemove(this.state.worldId, client.sessionId)
      console.log(`[room ${this.roomId}] leave ${client.sessionId} total=${this.state.players.size}`)
    }
  }

  override async onDispose(): Promise<void> {
    await this.flushCheckpoint('dispose')
    rosterClearWorld(this.state.worldId)
  }

  private simulate(_deltaMs: number): void {
    this.state.tick += 1

    // ─═̷─ Retire expired bolts (and their consumedHits entries) ─═̷─
    const now = Date.now()
    if (this.state.bolts.length > 0) {
      for (let i = this.state.bolts.length - 1; i >= 0; i -= 1) {
        const bolt = this.state.bolts[i]
        if (!bolt) continue
        if (now - bolt.spawnedAt > BOLT_TTL_MS) {
          this.state.bolts.splice(i, 1)
        }
      }
      // GC consumedHits whose bolt is gone — keep memory bounded. The set
      // never holds more than a few seconds of pairs so this is cheap.
      if (this.consumedHits.size > 256) {
        const liveIds = new Set<string>()
        for (const bolt of this.state.bolts) liveIds.add(bolt.id)
        for (const key of this.consumedHits) {
          const boltId = key.split(':')[0]
          if (!liveIds.has(boltId)) this.consumedHits.delete(key)
        }
      }
    }

    // ─═̷─ Respawn pass ─═̷─
    this.state.players.forEach(player => {
      if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
        player.hp = player.maxHp
        player.mana = player.maxMana
        player.alive = true
        player.respawnAt = 0
        player.lastKilledBy = ''
        // V1 spawn point: origin. The Next-side client can override via the
        // 'respawn' broadcast if World.spawnPoint is set — but the room
        // doesn't have DB access so we send origin and let the client
        // teleport to its locally known spawnPoint.
        player.x = 0
        player.y = 1
        player.z = 0
        this.broadcast('respawn', {
          playerId: player.playerId,
          sessionId: this.findSessionIdForPlayer(player),
          displayName: player.displayName,
        })
      }
    })
  }

  private findSessionIdForPlayer(target: PlayerState): string {
    let found = ''
    this.state.players.forEach((player, sessionId) => {
      if (player === target) found = sessionId
    })
    return found
  }

  private makeCommandEvent(
    kind: 'command.accepted' | 'command.rejected',
    command: WorldCommandMessage,
    commandId: string | undefined,
    error?: string,
  ): WorldEventMessage {
    const suffix = commandId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const actorId = typeof command.actorId === 'string' ? sanitizeText(command.actorId, '', 96) : undefined
    return {
      id: `world-event-${kind.replace('.', '-')}-${suffix}`,
      kind,
      worldId: this.state.worldId,
      commandId,
      actorId,
      acceptedAt: new Date().toISOString(),
      revision: this.worldRevision,
      source: 'room',
      durable: false,
      ...(error ? { error } : {}),
      ...(kind === 'command.accepted' ? { command } : {}),
    }
  }

  private rememberCommandEvent(commandId: string, event: WorldEventMessage): void {
    this.commandEvents.set(commandId, event)
    this.commandEventRing.push(event)
    while (this.commandEventRing.length > COMMAND_EVENT_RING_MAX) {
      const removed = this.commandEventRing.shift()
      if (removed?.commandId) this.commandEvents.delete(removed.commandId)
    }
  }
}

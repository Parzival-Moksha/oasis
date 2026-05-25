import { Room, type Client } from 'colyseus'
import { ActiveBolt, PlayerState, WorldRoomState } from '../schema/RoomSchema.js'
import { rosterClearWorld, rosterRemove, rosterUpsert } from '../world-roster.js'

interface JoinOptions {
  worldId?: string
  playerId?: string
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

const MAX_PLAYERS_PER_WORLD = 64
const SIM_HZ = 30
const PATCH_HZ = 30
// Mutation passthrough is unauthenticated by design (no auth yet) — bound
// the abuse surface explicitly. A malicious WS client could otherwise flood
// every peer with megabyte-sized payloads.
const MUTATION_MAX_BYTES = 16 * 1024  // 16 KiB per mutation envelope
const MUTATION_TOKENS_PER_SEC = 30    // 30 mutation broadcasts/sec sustained
const MUTATION_BURST = 60             // allow short bursts for drag streams

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

interface MutationBucket {
  tokens: number
  lastRefillAt: number
}

interface CastBucket {
  tokens: number
  lastRefillAt: number
}

export class WorldRoom extends Room<WorldRoomState> {
  override maxClients = MAX_PLAYERS_PER_WORLD
  private readonly mutationBuckets = new Map<string, MutationBucket>()
  private readonly castBuckets = new Map<string, CastBucket>()
  /** Tracks which (boltId, victimSessionId) pairs have already been
   *  consumed so a hostile client can't repeatedly report the same hit. */
  private readonly consumedHits = new Set<string>()

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
    const worldId = sanitizeWorldId(options.worldId)
    if (!worldId) {
      throw new Error('worldId is required to create a WorldRoom')
    }

    const state = new WorldRoomState()
    state.worldId = worldId
    // First-joiner sets PvP for the room lifetime. Subsequent joiners can
    // NOT flip this — they pass their own value, we just ignore it. The
    // Next.js side is the source of truth via World.pvpEnabled; clients
    // read it before joining and pass it through. v2 will sign this with
    // a server-issued token so clients can't lie.
    state.pvpEnabled = options.pvpEnabled === true
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

      victim.hp = Math.max(0, victim.hp - bolt.damage)

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
    // Clients can briefly join before the world registry has hydrated. If a
    // later join carries the DB-backed PvP flag, let true win for the room.
    if (options.pvpEnabled === true && !this.state.pvpEnabled) {
      this.state.pvpEnabled = true
    }

    const player = new PlayerState()
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

  override onDispose(): void {
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
}

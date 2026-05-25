'use client'

import { Client, Room } from 'colyseus.js'
import {
  notifyDeath,
  notifyHitAward,
  notifyPlayerState,
  notifyRemoteBolt,
  notifyRespawn,
  setPvpSender,
  type PvpDeathEvent,
  type PvpHitAwardEvent,
  type PvpPlayerSnapshot,
  type PvpRemoteBolt,
  type PvpRespawnEvent,
  type PvpVitalsPayload,
} from './pvp-bridge'

export interface MultiplayerRoomPlayer {
  sessionId: string
  playerId: string
  displayName: string
  avatarUrl?: string
  profileAvatarUrl?: string
  color: string
  position: [number, number, number]
  yaw: number
  animState: string
  updatedAt: number
}

export interface MultiplayerRoomJoinOptions {
  worldId: string
  playerId: string
  displayName: string
  avatarUrl?: string
  profileAvatarUrl?: string
  color?: string
  // PvP join params — passed straight to the Colyseus room.
  pvpEnabled?: boolean
  maxHp?: number
  mana?: number
  maxMana?: number
}

export interface MultiplayerRoomInput {
  x?: number
  y?: number
  z?: number
  yaw?: number
  vx?: number
  vz?: number
  animState?: string
}

interface RoomPlayerSchema {
  playerId: string
  displayName: string
  avatarUrl: string
  profileAvatarUrl: string
  color: string
  x: number
  y: number
  z: number
  yaw: number
  animState: string
  updatedAt: number
  // PvP fields — present once the server schema is updated.
  hp?: number
  maxHp?: number
  mana?: number
  maxMana?: number
  alive?: boolean
  respawnAt?: number
  lastKilledBy?: string
}

interface RoomBoltSchema {
  id: string
  casterSessionId: string
  spell: string
  design: string
  ox: number; oy: number; oz: number
  dx: number; dy: number; dz: number
  speed: number
  damage: number
  spawnedAt: number
  seed: number
}

type RoomBoltPayload = RoomBoltSchema

interface RoomStateSchema {
  players: {
    forEach(callback: (value: RoomPlayerSchema, key: string) => void): void
    size: number
  }
  bolts?: {
    onAdd?: (callback: (bolt: RoomBoltSchema, key: number) => void) => void
    forEach?: (callback: (value: RoomBoltSchema, key: number) => void) => void
  }
  pvpEnabled?: boolean
}

function resolveRoomEndpoint(): string | null {
  const explicit = process.env.NEXT_PUBLIC_OASIS_ROOM_URL?.trim()
  if (explicit) return explicit
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname || 'localhost'
    const isLocal = host === 'localhost' || host === '127.0.0.1'
    // ░▒▓ Local dev: skip the multiplayer room server unless explicitly opted
    // in via NEXT_PUBLIC_OASIS_ROOM_URL. Without this guard the client tries
    // ws://localhost:4519 (the colyseus-style room server that doesn't run
    // in standard `pnpm dev`), failing with `joinOrCreate failed` on every
    // reconnect tick and flooding the console.
    if (isLocal) return null
    return `${protocol}//${host}/rooms`
  }
  return null
}

export function isMultiplayerRoomConfigured(): boolean {
  return resolveRoomEndpoint() !== null
}

function snapshotPlayer(sessionId: string, raw: RoomPlayerSchema): MultiplayerRoomPlayer {
  return {
    sessionId,
    playerId: raw.playerId,
    displayName: raw.displayName,
    avatarUrl: raw.avatarUrl || undefined,
    profileAvatarUrl: raw.profileAvatarUrl || undefined,
    color: raw.color || '#38bdf8',
    position: [raw.x, raw.y, raw.z],
    yaw: raw.yaw,
    animState: raw.animState || 'idle',
    updatedAt: raw.updatedAt,
  }
}

function remoteBoltFromRoomBolt(bolt: RoomBoltPayload, localSessionId: string): PvpRemoteBolt | null {
  if (!bolt || bolt.casterSessionId === localSessionId) return null
  const spell = (bolt.spell === 'firebolt' || bolt.spell === 'lightning-bolt' || bolt.spell === 'ice-bolt')
    ? bolt.spell
    : null
  if (!spell || !bolt.id) return null
  return {
    id: bolt.id,
    casterSessionId: bolt.casterSessionId,
    spell,
    design: bolt.design,
    origin: [bolt.ox, bolt.oy, bolt.oz],
    direction: [bolt.dx, bolt.dy, bolt.dz],
    speed: bolt.speed,
    damage: bolt.damage,
    seed: bolt.seed,
  }
}

export interface MultiplayerRoomProfile {
  avatarUrl?: string
  profileAvatarUrl?: string
  displayName?: string
  color?: string
}

export interface MultiplayerRoomConnection {
  sendInput(input: MultiplayerRoomInput): void
  sendMutation(payload: unknown): void
  sendProfile(profile: MultiplayerRoomProfile): void
  sendVitals(vitals: PvpVitalsPayload): void
  dispose(): Promise<void>
  readonly sessionId: string
}

export interface MultiplayerRoomConnectArgs extends MultiplayerRoomJoinOptions {
  onPlayersChanged: (players: MultiplayerRoomPlayer[]) => void
  onConnectionState?: (state: 'connecting' | 'connected' | 'closed' | 'error', detail?: string) => void
  onMutation?: (payload: unknown) => void
}

const DEBUG = typeof window !== 'undefined' && /\bmultiplayer=debug\b/.test(window.location.search)
const log = (...args: unknown[]) => {
  if (DEBUG) console.debug('[oasis-room]', ...args)
  else console.info('[oasis-room]', ...args)
}

export async function connectToWorldRoom(args: MultiplayerRoomConnectArgs): Promise<MultiplayerRoomConnection> {
  const endpoint = resolveRoomEndpoint()
  if (!endpoint) {
    throw new Error('Multiplayer room not configured (set NEXT_PUBLIC_OASIS_ROOM_URL to enable)')
  }
  log('connecting to', endpoint, 'worldId=', args.worldId)
  const client = new Client(endpoint)

  args.onConnectionState?.('connecting')

  let room: Room<RoomStateSchema>
  const seenRemoteBoltIds = new Set<string>()
  const handleRemoteBolt = (bolt: RoomBoltPayload) => {
    const remoteBolt = remoteBoltFromRoomBolt(bolt, room.sessionId)
    if (!remoteBolt || seenRemoteBoltIds.has(remoteBolt.id)) return
    seenRemoteBoltIds.add(remoteBolt.id)
    notifyRemoteBolt(remoteBolt)
  }
  try {
    room = await client.joinOrCreate<RoomStateSchema>('world', {
      worldId: args.worldId,
      playerId: args.playerId,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
      profileAvatarUrl: args.profileAvatarUrl,
      color: args.color,
      pvpEnabled: args.pvpEnabled === true,
      maxHp: typeof args.maxHp === 'number' ? args.maxHp : undefined,
      mana: typeof args.mana === 'number' ? args.mana : undefined,
      maxMana: typeof args.maxMana === 'number' ? args.maxMana : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[oasis-room] joinOrCreate failed', message)
    args.onConnectionState?.('error', message)
    throw error
  }

  log('joined room', room.roomId, 'sessionId=', room.sessionId)
  args.onConnectionState?.('connected')

  const emit = () => {
    const state = room.state as RoomStateSchema | undefined
    if (!state?.players) {
      args.onPlayersChanged([])
      return
    }
    const players: MultiplayerRoomPlayer[] = []
    // Also build a PvP snapshot that includes the local player (HUD needs
    // its own HP/mana/alive flags from the room when in a PvP world).
    const pvpPlayers: PvpPlayerSnapshot[] = []
    state.players.forEach((player: RoomPlayerSchema, sessionId: string) => {
      if (sessionId !== room.sessionId) {
        players.push(snapshotPlayer(sessionId, player))
      }
      pvpPlayers.push({
        sessionId,
        playerId: player.playerId,
        displayName: player.displayName,
        hp: typeof player.hp === 'number' ? player.hp : 100,
        maxHp: typeof player.maxHp === 'number' ? player.maxHp : 100,
        mana: typeof player.mana === 'number' ? player.mana : 20,
        maxMana: typeof player.maxMana === 'number' ? player.maxMana : 20,
        alive: player.alive !== false,
        respawnAt: typeof player.respawnAt === 'number' ? player.respawnAt : 0,
        lastKilledBy: typeof player.lastKilledBy === 'string' ? player.lastKilledBy : '',
        position: [player.x, player.y, player.z],
      })
    })
    log('state change, peers=', players.length, 'total=', state.players.size)
    args.onPlayersChanged(players)
    notifyPlayerState(pvpPlayers)
  }

  room.onStateChange((_state) => {
    emit()
  })

  emit()

  // ─═̷─ PvP wiring ─═̷─
  room.onMessage('cast', (payload: RoomBoltPayload) => {
    try { handleRemoteBolt(payload) } catch (err) {
      if (DEBUG) console.warn('[oasis-room] cast handler threw', err)
    }
  })

  // Hook the colyseus.js bolts array so peers see remote casts. The onAdd
  // callback is wrapped in a try because schema-callbacks expose different
  // shapes between colyseus.js versions; we tolerate either.
  try {
    const stateForBolts = room.state as RoomStateSchema | undefined
    const bolts = stateForBolts?.bolts
    if (bolts && typeof bolts.onAdd === 'function') {
      bolts.onAdd((bolt: RoomBoltSchema) => {
        handleRemoteBolt(bolt)
      })
    }
  } catch (err) {
    if (DEBUG) console.warn('[oasis-room] bolts.onAdd hookup failed', err)
  }

  room.onMessage('death', (payload: PvpDeathEvent) => {
    try { notifyDeath(payload) } catch (err) {
      if (DEBUG) console.warn('[oasis-room] death handler threw', err)
    }
  })
  room.onMessage('respawn', (payload: PvpRespawnEvent) => {
    try { notifyRespawn(payload) } catch (err) {
      if (DEBUG) console.warn('[oasis-room] respawn handler threw', err)
    }
  })
  room.onMessage('hitAward', (payload: PvpHitAwardEvent) => {
    try { notifyHitAward(payload) } catch (err) {
      if (DEBUG) console.warn('[oasis-room] hitAward handler threw', err)
    }
  })

  setPvpSender({
    localSessionId: room.sessionId,
    pvpEnabled: args.pvpEnabled === true || (room.state as RoomStateSchema | undefined)?.pvpEnabled === true,
    sendCast: payload => {
      try { room.send('cast', payload) } catch (err) {
        if (DEBUG) console.warn('[oasis-room] sendCast failed', err)
      }
    },
    sendReportHit: payload => {
      try { room.send('reportHit', payload) } catch (err) {
        if (DEBUG) console.warn('[oasis-room] sendReportHit failed', err)
      }
    },
    sendVitals: payload => {
      try { room.send('vitals', payload) } catch (err) {
        if (DEBUG) console.warn('[oasis-room] sendVitals failed', err)
      }
    },
  })

  if (args.onMutation) {
    room.onMessage('mutation', (payload: unknown) => {
      try {
        args.onMutation?.(payload)
      } catch (error) {
        if (DEBUG) console.warn('[oasis-room] onMutation handler threw', error)
      }
    })
  }

  room.onLeave((code: number) => {
    log('room left, code=', code)
    args.onConnectionState?.('closed', String(code))
  })

  // colyseus.js Room.onError signature varies by version; use unknown to stay portable.
  ;(room.onError as unknown as (cb: (...errArgs: unknown[]) => void) => void)((...errArgs: unknown[]) => {
    const detail = errArgs.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join(':')
    console.error('[oasis-room] room error', detail)
    args.onConnectionState?.('error', detail)
  })

  return {
    sessionId: room.sessionId,
    sendInput(input: MultiplayerRoomInput): void {
      try {
        room.send('input', input)
      } catch (error) {
        if (DEBUG) console.warn('[oasis-room] sendInput failed', error)
      }
    },
    sendMutation(payload: unknown): void {
      try {
        room.send('mutation', payload)
      } catch (error) {
        if (DEBUG) console.warn('[oasis-room] sendMutation failed', error)
      }
    },
    sendProfile(profile: MultiplayerRoomProfile): void {
      try {
        room.send('profile', profile)
      } catch (error) {
        if (DEBUG) console.warn('[oasis-room] sendProfile failed', error)
      }
    },
    sendVitals(vitals: PvpVitalsPayload): void {
      try {
        room.send('vitals', vitals)
      } catch (error) {
        if (DEBUG) console.warn('[oasis-room] sendVitals failed', error)
      }
    },
    async dispose(): Promise<void> {
      log('disposing room connection')
      setPvpSender(null)
      try {
        await room.leave(true)
      } catch {
        // already closed
      }
    },
  }
}

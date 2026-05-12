'use client'

import { Client, Room } from 'colyseus.js'

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
}

interface RoomStateSchema {
  players: {
    forEach(callback: (value: RoomPlayerSchema, key: string) => void): void
    size: number
  }
}

function resolveRoomEndpoint(): string {
  const explicit = process.env.NEXT_PUBLIC_OASIS_ROOM_URL?.trim()
  if (explicit) return explicit
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname || 'localhost'
    const isLocal = host === 'localhost' || host === '127.0.0.1'
    // 4519 locally — 4517 is the OpenClaw/Hermes relay sidecar.
    if (isLocal) return `${protocol}//${host}:4519`
    return `${protocol}//${host}/rooms`
  }
  return 'ws://localhost:4519'
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
  log('connecting to', endpoint, 'worldId=', args.worldId)
  const client = new Client(endpoint)

  args.onConnectionState?.('connecting')

  let room: Room<RoomStateSchema>
  try {
    room = await client.joinOrCreate<RoomStateSchema>('world', {
      worldId: args.worldId,
      playerId: args.playerId,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
      profileAvatarUrl: args.profileAvatarUrl,
      color: args.color,
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
    state.players.forEach((player: RoomPlayerSchema, sessionId: string) => {
      if (sessionId === room.sessionId) return
      players.push(snapshotPlayer(sessionId, player))
    })
    log('state change, peers=', players.length, 'total=', state.players.size)
    args.onPlayersChanged(players)
  }

  room.onStateChange((_state) => {
    emit()
  })

  emit()

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
    async dispose(): Promise<void> {
      log('disposing room connection')
      try {
        await room.leave(true)
      } catch {
        // already closed
      }
    },
  }
}

'use client'

import { Client, Room } from 'colyseus.js'

export interface MultiplayerRoomPlayer {
  sessionId: string
  playerId: string
  displayName: string
  avatarUrl?: string
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
  color: string
  x: number
  y: number
  z: number
  yaw: number
  animState: string
  updatedAt: number
  onChange?(callback: () => void): () => void
  listen?(field: string, callback: (value: unknown) => void): () => void
}

interface RoomStateSchema {
  players: {
    forEach(callback: (value: RoomPlayerSchema, key: string) => void): void
    onAdd(callback: (value: RoomPlayerSchema, key: string) => void): () => void
    onRemove(callback: (value: RoomPlayerSchema, key: string) => void): () => void
  }
}

function resolveRoomEndpoint(): string {
  const explicit = process.env.NEXT_PUBLIC_OASIS_ROOM_URL?.trim()
  if (explicit) return explicit
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname || 'localhost'
    const port = host === 'localhost' || host === '127.0.0.1' ? ':4517' : ''
    return `${protocol}//${host}${port}`
  }
  return 'ws://localhost:4517'
}

function snapshotPlayer(sessionId: string, raw: RoomPlayerSchema): MultiplayerRoomPlayer {
  return {
    sessionId,
    playerId: raw.playerId,
    displayName: raw.displayName,
    avatarUrl: raw.avatarUrl || undefined,
    color: raw.color || '#38bdf8',
    position: [raw.x, raw.y, raw.z],
    yaw: raw.yaw,
    animState: raw.animState || 'idle',
    updatedAt: raw.updatedAt,
  }
}

export interface MultiplayerRoomConnection {
  sendInput(input: MultiplayerRoomInput): void
  dispose(): Promise<void>
  readonly sessionId: string
}

export interface MultiplayerRoomConnectArgs extends MultiplayerRoomJoinOptions {
  onPlayersChanged: (players: MultiplayerRoomPlayer[]) => void
  onConnectionState?: (state: 'connecting' | 'connected' | 'closed' | 'error', detail?: string) => void
}

export async function connectToWorldRoom(args: MultiplayerRoomConnectArgs): Promise<MultiplayerRoomConnection> {
  const endpoint = resolveRoomEndpoint()
  const client = new Client(endpoint)

  args.onConnectionState?.('connecting')

  const room = await client.joinOrCreate<RoomStateSchema>('world', {
    worldId: args.worldId,
    playerId: args.playerId,
    displayName: args.displayName,
    avatarUrl: args.avatarUrl,
    color: args.color,
  })

  args.onConnectionState?.('connected')

  const tracked = new Map<string, MultiplayerRoomPlayer>()
  const playerDisposers = new Map<string, () => void>()

  const flush = () => {
    args.onPlayersChanged(
      Array.from(tracked.values()).filter(player => player.sessionId !== room.sessionId),
    )
  }

  const wirePlayer = (player: RoomPlayerSchema, sessionId: string) => {
    tracked.set(sessionId, snapshotPlayer(sessionId, player))
    const onChange = player.onChange?.(() => {
      tracked.set(sessionId, snapshotPlayer(sessionId, player))
      flush()
    })
    if (onChange) playerDisposers.set(sessionId, onChange)
  }

  room.state.players.forEach((player, sessionId) => {
    wirePlayer(player, sessionId)
  })

  const addDisposer = room.state.players.onAdd((player, sessionId) => {
    wirePlayer(player, sessionId)
    flush()
  })

  const removeDisposer = room.state.players.onRemove((_player, sessionId) => {
    tracked.delete(sessionId)
    playerDisposers.get(sessionId)?.()
    playerDisposers.delete(sessionId)
    flush()
  })

  room.onLeave(code => {
    args.onConnectionState?.('closed', String(code))
  })
  room.onError((code, message) => {
    args.onConnectionState?.('error', `${code}:${message || ''}`)
  })

  flush()

  return {
    sessionId: room.sessionId,
    sendInput(input: MultiplayerRoomInput): void {
      try {
        room.send('input', input)
      } catch {
        // socket likely closed; swallow until reconnect logic exists
      }
    },
    async dispose(): Promise<void> {
      addDisposer?.()
      removeDisposer?.()
      playerDisposers.forEach(disposer => disposer())
      playerDisposers.clear()
      tracked.clear()
      try {
        await room.leave(true)
      } catch {
        // already closed
      }
    },
  }
}

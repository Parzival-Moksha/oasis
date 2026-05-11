'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { getCameraSnapshot } from '@/lib/camera-bridge'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import {
  connectToWorldRoom,
  type MultiplayerRoomConnection,
  type MultiplayerRoomPlayer,
} from '@/lib/multiplayer-room-client'
import { worldMutationBus, type WorldMutation } from '@/lib/world-mutation-bus'
import { useOasisStore } from '@/store/oasisStore'
import { RemoteVRMAvatar } from './RemoteVRMAvatar'

const INPUT_SEND_INTERVAL_MS = 33
const INPUT_POSITION_EPSILON = 0.02
const INPUT_YAW_EPSILON = 0.015
const REMOTE_RENDER_DELAY_MS = 120
const REMOTE_SNAPSHOT_BUFFER = 6
const REMOTE_POSITION_CATCHUP = 9
const REMOTE_YAW_CATCHUP = 9

function makePresenceId(): string {
  if (typeof window !== 'undefined') {
    const key = 'oasis-presence-player-id'
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
    const id = `player-${randomId}`
    window.sessionStorage.setItem(key, id)
    return id
  }
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `player-${randomId}`
}

function makePresenceName(playerId: string): string {
  if (typeof window === 'undefined') return 'Visitor'
  const key = 'oasis-presence-player-name'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const name = `Visitor ${playerId.slice(-4).toUpperCase()}`
  window.localStorage.setItem(key, name)
  return name
}

function colorForId(playerId: string): string {
  const palette = ['#38bdf8', '#fb7185', '#facc15', '#22c55e', '#a78bfa', '#f97316', '#2dd4bf', '#e879f9']
  let hash = 0
  for (let index = 0; index < playerId.length; index += 1) {
    hash = ((hash << 5) - hash + playerId.charCodeAt(index)) | 0
  }
  return palette[Math.abs(hash) % palette.length] || palette[0]
}

function getLocalPose(): { position: [number, number, number]; yaw: number } | null {
  const avatarPose = getPlayerAvatarPose()
  if (avatarPose) return { position: avatarPose.position, yaw: avatarPose.yaw }
  const camera = getCameraSnapshot()
  if (!camera) return null
  const [fx, , fz] = camera.forward
  return {
    position: [camera.position[0], Math.max(0, camera.position[1] - 1.65), camera.position[2]],
    yaw: Math.atan2(fx, fz || 1),
  }
}

interface RemoteSnapshot {
  arrivedAt: number
  position: [number, number, number]
  yaw: number
}

function shortAngle(target: number, current: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

function RemotePresenceAvatar({ player }: { player: MultiplayerRoomPlayer }) {
  const groupRef = useRef<THREE.Group>(null)
  const bufferRef = useRef<RemoteSnapshot[]>([])
  // Per-frame inferred speed in m/s — fed to RemoteVRMAvatar so its animation
  // state machine can pick idle/walk/run/sprint without us reaching into the
  // controller. Smoothed mildly so a single jittery snapshot doesn't pop the
  // state machine between idle and walk.
  const lastPosRef = useRef<THREE.Vector3>(new THREE.Vector3(player.position[0], player.position[1], player.position[2]))
  const smoothedSpeedRef = useRef<number>(0)
  const [speed, setSpeed] = useState(0)
  const color = player.color || '#38bdf8'
  const avatarUrl = player.avatarUrl || ''

  // One-shot seed: place the group at the player's incoming pose before the
  // first useFrame runs, so a new remote doesn't appear at world origin and
  // visibly slide toward its spawn.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.position.set(player.position[0], player.position[1], player.position[2])
    group.rotation.y = player.yaw
    lastPosRef.current.set(player.position[0], player.position[1], player.position[2])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const last = bufferRef.current[bufferRef.current.length - 1]
    if (last
      && Math.abs(last.position[0] - player.position[0]) < 0.0001
      && Math.abs(last.position[1] - player.position[1]) < 0.0001
      && Math.abs(last.position[2] - player.position[2]) < 0.0001
      && Math.abs(last.yaw - player.yaw) < 0.0001) {
      return
    }
    bufferRef.current.push({
      arrivedAt: now,
      position: [player.position[0], player.position[1], player.position[2]],
      yaw: player.yaw,
    })
    if (bufferRef.current.length > REMOTE_SNAPSHOT_BUFFER) {
      bufferRef.current.shift()
    }
  }, [player.position[0], player.position[1], player.position[2], player.yaw])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const buffer = bufferRef.current
    if (buffer.length === 0) return

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const renderTime = now - REMOTE_RENDER_DELAY_MS

    let target: { position: [number, number, number]; yaw: number }
    if (buffer.length === 1 || renderTime >= buffer[buffer.length - 1].arrivedAt) {
      const last = buffer[buffer.length - 1]
      target = { position: last.position, yaw: last.yaw }
    } else if (renderTime <= buffer[0].arrivedAt) {
      const first = buffer[0]
      target = { position: first.position, yaw: first.yaw }
    } else {
      let lo = buffer[0]
      let hi = buffer[1]
      for (let i = 1; i < buffer.length; i += 1) {
        if (buffer[i].arrivedAt >= renderTime) {
          hi = buffer[i]
          lo = buffer[i - 1]
          break
        }
      }
      const span = hi.arrivedAt - lo.arrivedAt
      const alpha = span <= 0 ? 1 : (renderTime - lo.arrivedAt) / span
      const yawDiff = shortAngle(hi.yaw, lo.yaw)
      target = {
        position: [
          lo.position[0] + (hi.position[0] - lo.position[0]) * alpha,
          lo.position[1] + (hi.position[1] - lo.position[1]) * alpha,
          lo.position[2] + (hi.position[2] - lo.position[2]) * alpha,
        ],
        yaw: lo.yaw + yawDiff * alpha,
      }
    }

    const catchUp = 1 - Math.exp(-REMOTE_POSITION_CATCHUP * delta)
    group.position.x += (target.position[0] - group.position.x) * catchUp
    group.position.y += (target.position[1] - group.position.y) * catchUp
    group.position.z += (target.position[2] - group.position.z) * catchUp
    const yawCatch = 1 - Math.exp(-REMOTE_YAW_CATCHUP * delta)
    group.rotation.y += shortAngle(target.yaw, group.rotation.y) * yawCatch

    // ── Infer ground-plane speed from the group's displacement this frame.
    // Y is excluded so vertical terrain hops don't push the avatar into run.
    if (delta > 0.0001) {
      const dx = group.position.x - lastPosRef.current.x
      const dz = group.position.z - lastPosRef.current.z
      const instSpeed = Math.sqrt(dx * dx + dz * dz) / delta
      const smoothing = 1 - Math.exp(-8 * delta)
      smoothedSpeedRef.current += (instSpeed - smoothedSpeedRef.current) * smoothing
      // setState only when the value crosses a threshold band — avoids a
      // re-render every frame while still keeping the animation responsive.
      if (Math.abs(smoothedSpeedRef.current - speed) > 0.15) {
        setSpeed(smoothedSpeedRef.current)
      }
    }
    lastPosRef.current.set(group.position.x, group.position.y, group.position.z)
  })

  return (
    <RemoteVRMAvatar
      ref={groupRef}
      avatarUrl={avatarUrl}
      cacheKey={player.sessionId}
      displayName={player.displayName}
      color={color}
      speed={speed}
    />
  )
}

export function MultiplayerPresenceLayer() {
  const activeWorldId = useOasisStore(s => s.viewingWorldId || s.activeWorldId)
  const avatarUrl = useOasisStore(s => s.avatar3dUrl)
  const playerIdRef = useRef<string>('')
  const playerNameRef = useRef<string>('Visitor')
  const playerColorRef = useRef<string>('#38bdf8')
  const connectionRef = useRef<MultiplayerRoomConnection | null>(null)
  const lastSentPoseRef = useRef<{ position: [number, number, number]; yaw: number } | null>(null)
  const lastSentAtRef = useRef<number>(0)
  const [players, setPlayers] = useState<MultiplayerRoomPlayer[]>([])

  useEffect(() => {
    const playerId = makePresenceId()
    playerIdRef.current = playerId
    playerNameRef.current = makePresenceName(playerId)
    playerColorRef.current = colorForId(playerId)
  }, [])

  useEffect(() => {
    const applyRemoteCatalogPlacement = useOasisStore.getState().applyRemoteCatalogPlacement
    const applyRemoteCatalogRemoval = useOasisStore.getState().applyRemoteCatalogRemoval
    return worldMutationBus.subscribe(mutation => {
      if (mutation.kind === 'object_added') {
        applyRemoteCatalogPlacement(mutation.payload)
      } else if (mutation.kind === 'object_removed') {
        applyRemoteCatalogRemoval(mutation.payload.id)
      }
    })
  }, [])

  useEffect(() => {
    if (!activeWorldId) {
      setPlayers([])
      return
    }
    const playerId = playerIdRef.current
    if (!playerId) return

    let disposed = false
    let connection: MultiplayerRoomConnection | null = null

    setPlayers([])

    connectToWorldRoom({
      worldId: activeWorldId,
      playerId,
      displayName: playerNameRef.current,
      avatarUrl: avatarUrl || undefined,
      color: playerColorRef.current,
      onPlayersChanged: next => {
        if (!disposed) setPlayers(next)
      },
      onMutation: payload => {
        if (disposed) return
        const mutation = payload as WorldMutation
        if (!mutation || typeof mutation !== 'object' || typeof mutation.kind !== 'string') return
        worldMutationBus.applyIncoming(mutation)
      },
    })
      .then(next => {
        if (disposed) {
          void next.dispose()
          worldMutationBus.setSender(null)
          return
        }
        connection = next
        connectionRef.current = next
        worldMutationBus.setSender(mutation => next.sendMutation(mutation))
        lastSentPoseRef.current = null
        lastSentAtRef.current = 0
      })
      .catch(() => {
        // Room server unavailable. Stay silent; old HTTP fallback is gone but
        // the rest of the world keeps working.
      })

    return () => {
      disposed = true
      worldMutationBus.setSender(null)
      if (connection) {
        void connection.dispose()
      }
      connectionRef.current = null
      lastSentPoseRef.current = null
      lastSentAtRef.current = 0
    }
  }, [activeWorldId, avatarUrl])

  useFrame(() => {
    const connection = connectionRef.current
    if (!connection) return

    const pose = getLocalPose()
    if (!pose) return

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - lastSentAtRef.current < INPUT_SEND_INTERVAL_MS) return

    const last = lastSentPoseRef.current
    const moved = !last
      || Math.abs(pose.position[0] - last.position[0]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.position[1] - last.position[1]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.position[2] - last.position[2]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.yaw - last.yaw) > INPUT_YAW_EPSILON

    if (!moved) return

    connection.sendInput({
      x: pose.position[0],
      y: pose.position[1],
      z: pose.position[2],
      yaw: pose.yaw,
    })
    lastSentPoseRef.current = { position: [...pose.position], yaw: pose.yaw }
    lastSentAtRef.current = now
  })

  if (!activeWorldId || players.length === 0) return null

  return (
    <group name="multiplayer-presence-layer">
      {players.map(player => (
        <RemotePresenceAvatar key={player.sessionId} player={player} />
      ))}
    </group>
  )
}

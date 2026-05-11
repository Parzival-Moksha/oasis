'use client'

import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { getCameraSnapshot } from '@/lib/camera-bridge'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import {
  connectToWorldRoom,
  type MultiplayerRoomConnection,
  type MultiplayerRoomPlayer,
} from '@/lib/multiplayer-room-client'
import { useOasisStore } from '@/store/oasisStore'

const INPUT_SEND_INTERVAL_MS = 70
const INPUT_POSITION_EPSILON = 0.03
const INPUT_YAW_EPSILON = 0.02

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

function RemotePresenceAvatar({ player }: { player: MultiplayerRoomPlayer }) {
  const groupRef = useRef<THREE.Group>(null)
  const targetPosition = useMemo(() => new THREE.Vector3(), [])
  const color = player.color || '#38bdf8'

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    targetPosition.set(player.position[0], player.position[1], player.position[2])
    group.position.lerp(targetPosition, 1 - Math.exp(-10 * delta))
    let diff = player.yaw - group.rotation.y
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    group.rotation.y += diff * Math.min(1, delta * 10)
  })

  return (
    <group ref={groupRef} position={player.position} rotation={[0, player.yaw, 0]}>
      <mesh castShadow position={[0, 0.88, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.9, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.52} metalness={0.12} />
      </mesh>
      <mesh castShadow position={[0, 1.46, 0]}>
        <sphereGeometry args={[0.22, 18, 12]} />
        <meshStandardMaterial color="#f8fafc" emissive={color} emissiveIntensity={0.08} roughness={0.48} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.15, 0.28]}>
        <boxGeometry args={[0.42, 0.08, 0.06]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.54} />
      </mesh>
      <Text
        position={[0, 1.86, 0]}
        rotation={[0, Math.PI, 0]}
        fontSize={0.16}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#020617"
      >
        {player.displayName}
        <meshBasicMaterial color="#e0f2fe" />
      </Text>
    </group>
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
    })
      .then(next => {
        if (disposed) {
          void next.dispose()
          return
        }
        connection = next
        connectionRef.current = next
        lastSentPoseRef.current = null
        lastSentAtRef.current = 0
      })
      .catch(() => {
        // Room server unavailable. Stay silent; old HTTP fallback is gone but
        // the rest of the world keeps working.
      })

    return () => {
      disposed = true
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

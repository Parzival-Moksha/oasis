'use client'

import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { getCameraSnapshot } from '@/lib/camera-bridge'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import type { MultiplayerPresencePlayer } from '@/lib/multiplayer-presence'
import { useOasisStore } from '@/store/oasisStore'

const HEARTBEAT_INTERVAL_SECONDS = 0.24

function makePresenceId(): string {
  if (typeof window === 'undefined') return 'server'
  const key = 'oasis-presence-player-id'
  const existing = window.sessionStorage.getItem(key)
  if (existing) return existing
  const id = `player-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  window.sessionStorage.setItem(key, id)
  return id
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

function RemotePresenceAvatar({ player }: { player: MultiplayerPresencePlayer }) {
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
        {player.name}
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
  const elapsedRef = useRef(HEARTBEAT_INTERVAL_SECONDS)
  const inFlightRef = useRef(false)
  const latestWorldIdRef = useRef(activeWorldId)
  const [players, setPlayers] = useState<MultiplayerPresencePlayer[]>([])

  useEffect(() => {
    const playerId = makePresenceId()
    playerIdRef.current = playerId
    playerNameRef.current = makePresenceName(playerId)
    playerColorRef.current = colorForId(playerId)
  }, [])

  useEffect(() => {
    latestWorldIdRef.current = activeWorldId
    setPlayers([])
  }, [activeWorldId])

  useEffect(() => {
    return () => {
      const playerId = playerIdRef.current
      const worldId = latestWorldIdRef.current
      if (!playerId || !worldId) return
      const payload = JSON.stringify({ playerId, worldId, leave: true })
      try {
        navigator.sendBeacon?.('/api/presence', new Blob([payload], { type: 'application/json' }))
      } catch {}
    }
  }, [])

  useFrame((_, delta) => {
    elapsedRef.current += delta
    if (elapsedRef.current < HEARTBEAT_INTERVAL_SECONDS || inFlightRef.current) return
    elapsedRef.current = 0

    const worldId = latestWorldIdRef.current
    const playerId = playerIdRef.current
    const pose = getLocalPose()
    if (!worldId || !playerId || !pose) return

    inFlightRef.current = true
    fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        worldId,
        name: playerNameRef.current,
        avatarUrl: avatarUrl || undefined,
        color: playerColorRef.current,
        position: pose.position,
        yaw: pose.yaw,
      }),
    })
      .then(response => response.ok ? response.json() : null)
      .then((payload: { players?: MultiplayerPresencePlayer[] } | null) => {
        if (Array.isArray(payload?.players)) setPlayers(payload.players)
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false
      })
  })

  if (!activeWorldId || players.length === 0) return null

  return (
    <group name="multiplayer-presence-layer">
      {players.map(player => (
        <RemotePresenceAvatar key={player.playerId} player={player} />
      ))}
    </group>
  )
}

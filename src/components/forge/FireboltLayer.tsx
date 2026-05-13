'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PLAYER_BASE_STATS } from '@/lib/player-progression'
import { useAudioManager } from '@/lib/audio-manager'
import { useInputManager } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'

type FireboltProjectile = {
  id: string
  position: [number, number, number]
  velocity: [number, number, number]
  age: number
  ttl: number
  damage: number
}

type FireboltResponse = {
  ok?: boolean
  error?: string
  progression?: unknown
  spell?: {
    cost?: number
    damage?: number
    speedMetersPerSecond?: number
  }
}

const FIREBOLT_TTL_S = 1.75
const FIREBOLT_COOLDOWN_MS = 170

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `firebolt-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function canCastFirebolt(): boolean {
  const input = useInputManager.getState()
  const store = useOasisStore.getState()
  if (input.hasActiveUILayer()) return false
  if (input.inputState === 'agent-focus' || input.inputState === 'ui-focused') return false
  if (input.inputState === 'placement' || input.inputState === 'paint') return false
  if (store.placementPending || store.paintHeldActive) return false
  return true
}

function FireboltMesh({ projectile }: { projectile: FireboltProjectile }) {
  const direction = useMemo(() => {
    return new THREE.Vector3(...projectile.velocity).normalize()
  }, [projectile.velocity])
  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))

  return (
    <group position={projectile.position}>
      <pointLight color="#ff9a1f" intensity={2.4 * opacity} distance={5.5} />
      <mesh>
        <sphereGeometry args={[0.18, 18, 12]} />
        <meshStandardMaterial color="#ff5a1f" emissive="#ff7a18" emissiveIntensity={2.7} transparent opacity={opacity} />
      </mesh>
      <mesh position={direction.clone().multiplyScalar(-0.22)}>
        <sphereGeometry args={[0.12, 14, 10]} />
        <meshBasicMaterial color="#ffd38a" transparent opacity={0.72 * opacity} />
      </mesh>
      {[0.42, 0.74, 1.04].map((offset, index) => (
        <mesh key={offset} position={direction.clone().multiplyScalar(-offset)}>
          <sphereGeometry args={[0.13 - index * 0.03, 10, 8]} />
          <meshBasicMaterial color={index === 0 ? '#fb923c' : '#7f1d1d'} transparent opacity={(0.4 - index * 0.09) * opacity} />
        </mesh>
      ))}
    </group>
  )
}

export function FireboltLayer({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree()
  const [projectiles, setProjectiles] = useState<FireboltProjectile[]>([])
  const lastCastAtRef = useRef(0)
  const castingRef = useRef(false)

  const spawnProjectile = useCallback((speed: number, damage: number) => {
    const origin = new THREE.Vector3()
    const direction = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()

    camera.getWorldPosition(origin)
    camera.getWorldDirection(direction).normalize()
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()

    origin
      .addScaledVector(direction, 0.86)
      .addScaledVector(right, 0.24)
      .addScaledVector(up, -0.16)

    const velocity = direction.multiplyScalar(speed)
    setProjectiles(prev => [
      ...prev.slice(-15),
      {
        id: randomId(),
        position: [origin.x, origin.y, origin.z],
        velocity: [velocity.x, velocity.y, velocity.z],
        age: 0,
        ttl: FIREBOLT_TTL_S,
        damage,
      },
    ])
  }, [camera])

  const castFirebolt = useCallback(async () => {
    if (!enabled || castingRef.current || !canCastFirebolt()) return
    const now = performance.now()
    if (now - lastCastAtRef.current < FIREBOLT_COOLDOWN_MS) return
    lastCastAtRef.current = now
    castingRef.current = true
    try {
      const response = await fetch('/api/profile/spells/firebolt', { method: 'POST' })
      const data = await response.json().catch(() => ({})) as FireboltResponse
      if (!response.ok || !data.ok) {
        window.dispatchEvent(new CustomEvent('oasis:firebolt-failed', { detail: data }))
        return
      }
      const speed = typeof data.spell?.speedMetersPerSecond === 'number'
        ? data.spell.speedMetersPerSecond
        : PLAYER_BASE_STATS.fireboltSpeedMetersPerSecond
      const damage = typeof data.spell?.damage === 'number' ? data.spell.damage : 14
      spawnProjectile(speed, damage)
      useAudioManager.getState().play('conjureStart')
      if (data.progression) {
        window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: data.progression }))
      }
    } finally {
      castingRef.current = false
    }
  }, [enabled, spawnProjectile])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onCast = () => void castFirebolt()
    window.addEventListener('oasis:cast-firebolt', onCast)
    return () => window.removeEventListener('oasis:cast-firebolt', onCast)
  }, [castFirebolt])

  useEffect(() => {
    if (!enabled) return
    const canvas = gl.domElement
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (isTypingTarget(event.target)) return
      if (!canCastFirebolt()) return
      void castFirebolt()
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    return () => canvas.removeEventListener('pointerdown', onPointerDown)
  }, [castFirebolt, enabled, gl])

  useFrame((_, delta) => {
    if (projectiles.length === 0) return
    setProjectiles(prev => prev
      .map(projectile => {
        const nextAge = projectile.age + delta
        const nextPosition: [number, number, number] = [
          projectile.position[0] + projectile.velocity[0] * delta,
          projectile.position[1] + projectile.velocity[1] * delta,
          projectile.position[2] + projectile.velocity[2] * delta,
        ]
        return { ...projectile, age: nextAge, position: nextPosition }
      })
      .filter(projectile => projectile.age < projectile.ttl && projectile.position[1] > -8))
  })

  return (
    <group name="firebolt-layer">
      {projectiles.map(projectile => (
        <FireboltMesh key={projectile.id} projectile={projectile} />
      ))}
    </group>
  )
}

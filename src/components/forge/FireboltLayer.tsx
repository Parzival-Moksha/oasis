'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { PLAYER_BASE_STATS } from '@/lib/player-progression'
import { useAudioManager } from '@/lib/audio-manager'
import { useInputManager } from '@/lib/input-manager'
import { getPlayerAvatarPose, setPlayerSpellCasting } from '@/lib/player-avatar-runtime'
import { QUEST_ZERO_WORLD_ID } from '@/lib/portal-gates'
import { useOasisStore } from '@/store/oasisStore'

type FireboltProjectile = {
  id: string
  origin: [number, number, number]
  position: [number, number, number]
  velocity: [number, number, number]
  distance: number
  age: number
  ttl: number
  damage: number
  trailCarry: number
}

type FireboltExplosion = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

type FireboltSmokePuff = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  size: number
}

type FireboltHitMarker = {
  id: string
  position: [number, number, number]
  label: string
  age: number
  ttl: number
}

type CollisionTarget = {
  id: string
  position: [number, number, number]
  radius: number
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
const FIREBOLT_ARMING_DISTANCE_M = 1.35
const EXPLOSION_TTL_S = 0.82
const FIREBOLT_TRAIL_SPACING_M = 0.5
const FIREBOLT_SMOKE_TTL_S = 1
const FIREBOLT_CAST_ANIMATION_MS = 620

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

function resolvePosition(
  id: string,
  fallback: [number, number, number] | undefined,
  transforms: Record<string, { position?: [number, number, number] } | undefined>,
): [number, number, number] | null {
  return transforms[id]?.position || fallback || null
}

function resolveScale(
  id: string,
  fallback: number | undefined,
  transforms: Record<string, { scale?: number | [number, number, number] } | undefined>,
): number {
  const scale = transforms[id]?.scale
  if (typeof scale === 'number') return scale
  if (Array.isArray(scale)) return Math.max(scale[0] || 1, scale[1] || 1, scale[2] || 1)
  return fallback || 1
}

function collectCollisionTargets(): CollisionTarget[] {
  const state = useOasisStore.getState()
  const transforms = state.transforms
  const targets: CollisionTarget[] = []

  for (const asset of state.conjuredAssets) {
    if (!state.worldConjuredAssetIds.includes(asset.id)) continue
    const position = resolvePosition(asset.id, asset.position, transforms)
    if (!position) continue
    const scale = resolveScale(asset.id, asset.scale, transforms)
    targets.push({ id: asset.id, position, radius: Math.max(0.75, scale * 0.9) })
  }

  for (const asset of state.placedCatalogAssets) {
    const position = resolvePosition(asset.id, asset.position, transforms)
    if (!position) continue
    const scale = resolveScale(asset.id, asset.scale, transforms)
    targets.push({ id: asset.id, position, radius: Math.max(0.75, scale * 0.9) })
  }

  for (const scene of state.craftedScenes) {
    const position = resolvePosition(scene.id, scene.position, transforms)
    if (!position) continue
    targets.push({
      id: scene.id,
      position,
      radius: Math.max(1.4, 1.6 + Math.sqrt(scene.objects.length) * 0.28),
    })
  }

  for (const text of state.text3dObjects) {
    const position = resolvePosition(text.id, text.position, transforms)
    if (!position) continue
    targets.push({ id: text.id, position, radius: Math.max(0.9, text.size * 1.8) })
  }

  return targets
}

function segmentSphereHit(
  start: THREE.Vector3,
  end: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const segment = end.clone().sub(start)
  const lengthSq = segment.lengthSq()
  if (lengthSq <= 0) return null
  const t = THREE.MathUtils.clamp(center.clone().sub(start).dot(segment) / lengthSq, 0, 1)
  const closest = start.clone().addScaledVector(segment, t)
  return closest.distanceTo(center) <= radius ? closest : null
}

function groundHit(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 | null {
  if (start.y < 0.05 && end.y < 0.05) return null
  if (start.y >= 0.05 && end.y <= 0.05) {
    const t = start.y / Math.max(0.0001, start.y - end.y)
    return start.clone().lerp(end, THREE.MathUtils.clamp(t, 0, 1))
  }
  return null
}

function isQuestFireboltTarget(id: string): boolean {
  return /(^|-)quest-zero-fire-target-|training|dummy|target/i.test(id)
}

function labelForFireboltTarget(id: string): string {
  const match = id.match(/quest-zero-fire-target-(\d+)/i)
  return match ? `Target ${match[1]} hit` : 'Hit'
}

function armedSegment(
  start: THREE.Vector3,
  end: THREE.Vector3,
  previousDistance: number,
  nextDistance: number,
): { start: THREE.Vector3; end: THREE.Vector3 } | null {
  if (nextDistance < FIREBOLT_ARMING_DISTANCE_M) return null
  if (previousDistance >= FIREBOLT_ARMING_DISTANCE_M) return { start, end }
  const segmentDistance = nextDistance - previousDistance
  if (segmentDistance <= 0) return null
  const t = THREE.MathUtils.clamp((FIREBOLT_ARMING_DISTANCE_M - previousDistance) / segmentDistance, 0, 1)
  return { start: start.clone().lerp(end, t), end }
}

function FireboltMesh({ projectile }: { projectile: FireboltProjectile }) {
  const direction = useMemo(() => {
    return new THREE.Vector3(...projectile.velocity).normalize()
  }, [projectile.velocity])
  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))
  const pulse = 1 + Math.sin(projectile.age * 54) * 0.07

  return (
    <group position={projectile.position}>
      <mesh scale={pulse}>
        <sphereGeometry args={[0.48, 18, 12]} />
        <meshBasicMaterial color="#ff7a18" transparent opacity={0.24 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh scale={pulse}>
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

function FireboltSmokePuffMesh({ puff }: { puff: FireboltSmokePuff }) {
  const t = Math.max(0, Math.min(1, puff.age / puff.ttl))
  const driftX = Math.sin(puff.seed * 0.17 + t * 2.4) * 0.12
  const driftZ = Math.cos(puff.seed * 0.13 + t * 2.1) * 0.12
  const lift = t * 0.58
  const opacity = Math.max(0, 0.24 * Math.pow(1 - t, 1.35))
  const scale = puff.size * (0.65 + t * 1.75)

  return (
    <mesh position={[puff.position[0] + driftX, puff.position[1] + lift, puff.position[2] + driftZ]} scale={scale}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshBasicMaterial color="#4a3a32" transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

function FireboltExplosionMesh({ explosion }: { explosion: FireboltExplosion }) {
  const particles = useMemo(() => {
    const count = 18
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + explosion.seed * 0.001
      return {
        id: index,
        angle,
        speed: 1.4 + ((index * 17 + explosion.seed) % 11) * 0.18,
        up: 0.5 + ((index * 23 + explosion.seed) % 9) * 0.08,
        size: 0.08 + (index % 4) * 0.018,
      }
    })
  }, [explosion.seed])
  const t = Math.max(0, Math.min(1, explosion.age / explosion.ttl))
  const pop = Math.sin(Math.min(1, t * 1.25) * Math.PI)
  const flashOpacity = Math.max(0, 0.78 - t * 1.35)
  const smokeOpacity = Math.max(0, 0.16 - t * 0.15)

  return (
    <group position={explosion.position}>
      <mesh scale={1 + t * 5.6}>
        <sphereGeometry args={[0.42, 18, 14]} />
        <meshBasicMaterial color="#fff1a4" transparent opacity={flashOpacity} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh scale={0.9 + pop * 3.4}>
        <sphereGeometry args={[0.6, 18, 14]} />
        <meshBasicMaterial color="#ff7a28" transparent opacity={Math.max(0, 0.44 - t * 0.48)} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={1 + t * 4.4}>
        <ringGeometry args={[0.46, 0.72, 36]} />
        <meshBasicMaterial color="#ffd76b" transparent opacity={Math.max(0, 0.74 - t * 0.82)} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {particles.map(particle => {
        const life = t * 1.35
        const x = Math.cos(particle.angle) * particle.speed * life
        const z = Math.sin(particle.angle) * particle.speed * life
        const y = Math.max(0.03, particle.up * life - 1.65 * life * life)
        return (
          <mesh key={particle.id} position={[x, y, z]} scale={Math.max(0.15, 1 - t * 0.55)}>
            <sphereGeometry args={[particle.size, 8, 8]} />
            <meshBasicMaterial
              color={particle.id % 3 === 0 ? '#fff1a4' : particle.id % 3 === 1 ? '#ff8d38' : '#ff4a28'}
              transparent
              opacity={Math.max(0, 0.92 - t * 1.08)}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
      {[0, 1, 2, 3].map(index => (
        <mesh
          key={index}
          position={[
            Math.cos(index * 1.7 + explosion.seed) * (0.3 + t * 0.5),
            0.35 + t * (0.9 + index * 0.18),
            Math.sin(index * 1.7 + explosion.seed) * (0.3 + t * 0.5),
          ]}
          scale={1 + t * (1.7 + index * 0.35)}
        >
          <sphereGeometry args={[0.35, 10, 8]} />
          <meshBasicMaterial color="#4f3b37" transparent opacity={smokeOpacity} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function FireboltHitMarkerMesh({ marker }: { marker: FireboltHitMarker }) {
  const t = Math.max(0, Math.min(1, marker.age / marker.ttl))
  return (
    <group position={[marker.position[0], marker.position[1] + 1.55 + t * 0.55, marker.position[2]]}>
      <Html transform sprite center distanceFactor={7} style={{ pointerEvents: 'none' }}>
        <div
          className="rounded-md border border-orange-200/50 bg-black/75 px-2.5 py-1 text-center text-[10px] font-black uppercase tracking-[0.18em] text-orange-100 shadow-[0_0_22px_rgba(249,115,22,0.35)]"
          style={{ opacity: Math.max(0, 1 - t) }}
        >
          {marker.label}
        </div>
      </Html>
    </group>
  )
}

export function FireboltLayer({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree()
  const [projectiles, setProjectiles] = useState<FireboltProjectile[]>([])
  const [explosions, setExplosions] = useState<FireboltExplosion[]>([])
  const [smokePuffs, setSmokePuffs] = useState<FireboltSmokePuff[]>([])
  const [hitMarkers, setHitMarkers] = useState<FireboltHitMarker[]>([])
  const lastCastAtRef = useRef(0)
  const castingRef = useRef(false)
  const reportedQuestTargetHitsRef = useRef<Set<string>>(new Set())

  const spawnProjectile = useCallback((speed: number, damage: number) => {
    const origin = new THREE.Vector3()
    const direction = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()

    camera.getWorldDirection(direction).normalize()
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()

    const pose = getPlayerAvatarPose()
    if (pose && useInputManager.getState().inputState === 'third-person') {
      const [px, py, pz] = pose.position
      const [fx, , fz] = pose.forward
      const poseForward = new THREE.Vector3(fx, 0, fz).normalize()
      const poseRight = new THREE.Vector3(poseForward.z, 0, -poseForward.x).normalize()
      origin.set(px, py + 1.22, pz)
        .addScaledVector(poseForward, 0.62)
        .addScaledVector(poseRight, 0.28)
    } else {
      camera.getWorldPosition(origin)
      origin
        .addScaledVector(direction, 0.86)
        .addScaledVector(right, 0.24)
        .addScaledVector(up, -0.16)
    }

    const velocity = direction.multiplyScalar(speed)
    setProjectiles(prev => [
      ...prev.slice(-15),
      {
        id: randomId(),
        origin: [origin.x, origin.y, origin.z],
        position: [origin.x, origin.y, origin.z],
        velocity: [velocity.x, velocity.y, velocity.z],
        distance: 0,
        age: 0,
        ttl: FIREBOLT_TTL_S,
        damage,
        trailCarry: 0,
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
      setPlayerSpellCasting(true)
      window.setTimeout(() => setPlayerSpellCasting(false), FIREBOLT_CAST_ANIMATION_MS)
      const audio = useAudioManager.getState()
      audio.play('fireboltCast')
      audio.play('fireboltVoice')
      window.dispatchEvent(new CustomEvent('oasis:spell-cast', { detail: { spell: 'firebolt', damage } }))
      if (data.progression) {
        window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: data.progression }))
      }
    } finally {
      castingRef.current = false
    }
  }, [enabled, spawnProjectile])

  const recordQuestTargetHit = useCallback((targetId: string, position: [number, number, number]) => {
    const activeWorldId = useOasisStore.getState().activeWorldId
    window.dispatchEvent(new CustomEvent('oasis:firebolt-hit', { detail: { targetId, position, worldId: activeWorldId } }))
    if (activeWorldId !== QUEST_ZERO_WORLD_ID || !isQuestFireboltTarget(targetId)) return
    if (reportedQuestTargetHitsRef.current.has(targetId)) return
    reportedQuestTargetHitsRef.current.add(targetId)
    void fetch('/api/player/progression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'record_firebolt_target_hit',
        targetId,
        worldId: activeWorldId,
        position,
      }),
    })
      .then(response => response.json().catch(() => null))
      .then(data => {
        if (data?.progression) {
          window.dispatchEvent(new CustomEvent('oasis:player-progression', { detail: data.progression }))
        }
        if (data?.result?.hitCount) {
          window.dispatchEvent(new CustomEvent('oasis:quest-progress-toast', {
            detail: {
              title: labelForFireboltTarget(targetId),
              message: `${Math.min(3, data.result.hitCount)}/3 fire targets`,
              tone: 'fire',
            },
          }))
        }
        if (data?.result?.hitStep?.xp || data?.result?.hitStep?.completionXp) {
          window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: data.result.hitStep.completionXp || data.result.hitStep.xp }))
        }
      })
      .catch(() => {})
  }, [])

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
    if (projectiles.length > 0) {
      const targets = collectCollisionTargets()
      const spawnedExplosions: FireboltExplosion[] = []
      const spawnedPuffs: FireboltSmokePuff[] = []
      const nextProjectiles: FireboltProjectile[] = []

      for (const projectile of projectiles) {
        const start = new THREE.Vector3(...projectile.position)
        const velocity = new THREE.Vector3(...projectile.velocity)
        const end = start.clone().addScaledVector(velocity, delta)
        const segmentLength = start.distanceTo(end)
        const nextDistance = (projectile.distance || 0) + segmentLength
        const nextAge = projectile.age + delta
        const oldTrailCarry = projectile.trailCarry || 0
        const carriedDistance = oldTrailCarry + segmentLength
        const puffCount = Math.floor(carriedDistance / FIREBOLT_TRAIL_SPACING_M)
        const nextTrailCarry = carriedDistance % FIREBOLT_TRAIL_SPACING_M

        for (let index = 0; index < puffCount; index += 1) {
          const distanceAlong = (FIREBOLT_TRAIL_SPACING_M - oldTrailCarry) + index * FIREBOLT_TRAIL_SPACING_M
          if (segmentLength <= 0 || distanceAlong < 0 || distanceAlong > segmentLength) continue
          const t = distanceAlong / segmentLength
          const position = start.clone().lerp(end, t)
          spawnedPuffs.push({
            id: randomId(),
            position: [position.x, position.y, position.z],
            age: 0,
            ttl: FIREBOLT_SMOKE_TTL_S,
            seed: Math.floor(Math.random() * 10000),
            size: 0.22 + Math.random() * 0.1,
          })
        }
        const activeSegment = armedSegment(start, end, projectile.distance || 0, nextDistance)
        const origin = new THREE.Vector3(...projectile.origin)
        let impact = activeSegment ? groundHit(activeSegment.start, activeSegment.end) : null
        let impactTarget: CollisionTarget | null = null

        if (!impact && activeSegment) {
          for (const target of targets) {
            const targetCenter = new THREE.Vector3(target.position[0], target.position[1] + Math.min(1.4, target.radius), target.position[2])
            if (origin.distanceTo(targetCenter) < target.radius + FIREBOLT_ARMING_DISTANCE_M + 0.2) continue
            impact = segmentSphereHit(activeSegment.start, activeSegment.end, targetCenter, target.radius)
            if (impact) {
              impactTarget = target
              break
            }
          }
        }

        const expired = nextAge >= projectile.ttl || end.y <= -8
        if (impact || expired) {
          spawnedExplosions.push({
            id: randomId(),
            position: impact ? [impact.x, Math.max(0.05, impact.y), impact.z] : [end.x, end.y, end.z],
            age: 0,
            ttl: EXPLOSION_TTL_S,
            seed: Math.floor(Math.random() * 10000),
          })
          if (impact && impactTarget) {
            if (isQuestFireboltTarget(impactTarget.id)) {
              setHitMarkers(prev => [
                ...prev.slice(-4),
                {
                  id: randomId(),
                  position: [impact.x, Math.max(0.05, impact.y), impact.z],
                  label: labelForFireboltTarget(impactTarget.id),
                  age: 0,
                  ttl: 1.15,
                },
              ])
            }
            recordQuestTargetHit(impactTarget.id, [impact.x, Math.max(0.05, impact.y), impact.z])
          }
          continue
        }

        nextProjectiles.push({
          ...projectile,
          age: nextAge,
          position: [end.x, end.y, end.z],
          distance: nextDistance,
          trailCarry: nextTrailCarry,
        })
      }

      setProjectiles(nextProjectiles)
      if (spawnedPuffs.length > 0) {
        setSmokePuffs(prev => [...prev.slice(-70), ...spawnedPuffs])
      }
      if (spawnedExplosions.length > 0) {
        useAudioManager.getState().play('fireboltHit')
        setExplosions(prev => [...prev.slice(-10), ...spawnedExplosions])
      }
    }

    if (smokePuffs.length > 0) {
      setSmokePuffs(prev => prev
        .map(puff => ({ ...puff, age: puff.age + delta }))
        .filter(puff => puff.age < puff.ttl))
    }

    if (explosions.length > 0) {
      setExplosions(prev => prev
        .map(explosion => ({ ...explosion, age: explosion.age + delta }))
        .filter(explosion => explosion.age < explosion.ttl))
    }

    if (hitMarkers.length > 0) {
      setHitMarkers(prev => prev
        .map(marker => ({ ...marker, age: marker.age + delta }))
        .filter(marker => marker.age < marker.ttl))
    }
  })

  return (
    <group name="firebolt-layer">
      {smokePuffs.map(puff => (
        <FireboltSmokePuffMesh key={puff.id} puff={puff} />
      ))}
      {projectiles.map(projectile => (
        <FireboltMesh key={projectile.id} projectile={projectile} />
      ))}
      {explosions.map(explosion => (
        <FireboltExplosionMesh key={explosion.id} explosion={explosion} />
      ))}
      {hitMarkers.map(marker => (
        <FireboltHitMarkerMesh key={marker.id} marker={marker} />
      ))}
    </group>
  )
}

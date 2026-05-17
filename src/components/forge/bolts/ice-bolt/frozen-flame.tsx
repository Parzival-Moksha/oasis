// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ICE B — Frozen Flame.
//
// Cold-fire projectile: render like a flame (tongue-like shape) but
// recolored to white-cyan core + frost-blue outer. Slower flicker than fire
// (~5Hz vs 15Hz). Trail = drifting snowflakes that "lock" into floating
// positions when their lifetime hits 50%. Impact = brief 1m radius white
// patch on the ground that fades over ~2s.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type FrozenFlameProjectile = {
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

export type FrozenFlameSnowflake = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  drift: [number, number, number]
}

export type FrozenFlameImpact = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export const FROZEN_TRAIL_SPACING_M = 0.22

export function FrozenFlameMesh({ projectile }: { projectile: FrozenFlameProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const flickerRef = useRef<THREE.Group>(null)
  const direction = useMemo(() => new THREE.Vector3(...projectile.velocity).normalize(), [projectile.velocity])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  useFrame(() => {
    if (flickerRef.current) {
      // 5Hz flicker (vs fire's 15Hz)
      const phase = projectile.age * Math.PI * 10
      flickerRef.current.scale.set(
        1 + Math.sin(phase) * 0.08,
        1 + Math.cos(phase * 0.8) * 0.06,
        1 + Math.sin(phase * 1.2) * 0.05,
      )
    }
  })

  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      {/* Outer additive blue glow */}
      <mesh scale={1.3}>
        <sphereGeometry args={[0.4, 14, 10]} />
        <meshBasicMaterial color="#4f8bbf" transparent opacity={0.22 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* Flame body — stylized teardrop using stretched sphere + cone */}
      <group ref={flickerRef}>
        {/* outer flame */}
        <mesh scale={[0.18, 0.18, 0.36]}>
          <sphereGeometry args={[1, 14, 10]} />
          <meshBasicMaterial color="#4f8bbf" transparent opacity={0.55 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.3]}>
          <coneGeometry args={[0.16, 0.32, 14]} />
          <meshBasicMaterial color="#7faedb" transparent opacity={0.6 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        {/* inner white-cyan core */}
        <mesh scale={[0.1, 0.1, 0.25]}>
          <sphereGeometry args={[1, 12, 9]} />
          <meshStandardMaterial color="#e0f6ff" emissive="#e0f6ff" emissiveIntensity={3.4} transparent opacity={opacity} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.18]} scale={[0.08, 0.08, 0.15]}>
          <coneGeometry args={[1, 1, 12]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.95 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

export function FrozenFlameSnowflakeMesh({ flake }: { flake: FrozenFlameSnowflake }) {
  const t = Math.max(0, Math.min(1, flake.age / flake.ttl))
  const opacity = Math.max(0, 0.85 * Math.pow(1 - t, 1.4))
  const scale = 0.05 * (1 - t * 0.3)
  // First 50%: drift; second 50%: lock in place
  const lockT = Math.min(0.5, t)
  const dx = flake.drift[0] * lockT
  const dy = flake.drift[1] * lockT
  const dz = flake.drift[2] * lockT
  const spin = flake.seed + t * Math.PI * 1.5
  return (
    <mesh
      position={[flake.position[0] + dx, flake.position[1] + dy, flake.position[2] + dz]}
      rotation={[0, 0, spin]}
      scale={scale}
    >
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#e0f6ff" transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export function FrozenFlameImpactMesh({ impact }: { impact: FrozenFlameImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  // Ground patch fade
  const patchAlpha = Math.max(0, (1 - t) * 0.5)
  const patchScale = 1 + t * 0.3
  // Initial burst quick
  const burstT = Math.min(1, t * 4)
  const burstAlpha = Math.max(0, 1 - burstT)

  return (
    <group position={impact.position}>
      {/* Quick frost burst */}
      <mesh scale={0.6 + burstT * 2.6}>
        <sphereGeometry args={[0.3, 14, 10]} />
        <meshBasicMaterial color="#e0f6ff" transparent opacity={burstAlpha * 0.8} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Cold ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={0.5 + burstT * 2.4}>
        <ringGeometry args={[0.5, 0.65, 36]} />
        <meshBasicMaterial color="#4f8bbf" transparent opacity={burstAlpha * 0.6} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Persistent white frost ground patch (lasts ~2s) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} scale={patchScale}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#e0f6ff" transparent opacity={patchAlpha} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} scale={patchScale * 0.6}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={patchAlpha * 0.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

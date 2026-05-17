// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ICE A — Crystal Spear.
//
// Long faceted spear projectile (Octahedron stretched along Z). Material =
// pale-blue + chrome-reflective look (high envMapIntensity, low roughness,
// moderate metalness). Inside: 3-4 floating frost cube crystals (dim emissive).
// Trail: thin spiraling mist of snow particles around the trajectory line.
// Impact: shatter into 12-20 shards orbiting briefly, then scale-down to 0.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type CrystalSpearProjectile = {
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

export type CrystalSpearTrailFlake = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  spinAxis: [number, number, number]
}

export type CrystalSpearImpact = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export const CRYSTAL_TRAIL_SPACING_M = 0.32

export function CrystalSpearMesh({ projectile }: { projectile: CrystalSpearProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const innerRef = useRef<THREE.Group>(null)
  const direction = useMemo(() => new THREE.Vector3(...projectile.velocity).normalize(), [projectile.velocity])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  useFrame((_, delta) => {
    if (innerRef.current) {
      innerRef.current.rotation.z += delta * 2.4
    }
  })

  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      {/* Outer glow halo */}
      <mesh>
        <sphereGeometry args={[0.28, 14, 10]} />
        <meshBasicMaterial color="#c9e8ff" transparent opacity={0.22 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* Main spear body - octahedron stretched along Z */}
      <mesh scale={[0.16, 0.16, 0.6]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#c9e8ff"
          emissive="#5b9bd6"
          emissiveIntensity={0.5}
          metalness={0.6}
          roughness={0.1}
          envMapIntensity={1.4}
          transparent
          opacity={0.88 * opacity}
          toneMapped={false}
        />
      </mesh>

      {/* Inner spinning frost crystals */}
      <group ref={innerRef}>
        {[0, 1, 2, 3].map(i => {
          const t = (i / 4) * Math.PI * 2
          const z = -0.18 + i * 0.12
          return (
            <mesh
              key={i}
              position={[Math.cos(t) * 0.04, Math.sin(t) * 0.04, z]}
              rotation={[t, t * 0.5, 0]}
            >
              <boxGeometry args={[0.04, 0.04, 0.04]} />
              <meshStandardMaterial
                color="#e8f6ff"
                emissive="#a8d4ff"
                emissiveIntensity={1.6}
                metalness={0.4}
                roughness={0.15}
                transparent
                opacity={opacity}
                toneMapped={false}
              />
            </mesh>
          )
        })}
      </group>

      {/* Sharp tip flare */}
      <mesh position={[0, 0, 0.32]}>
        <coneGeometry args={[0.08, 0.18, 6]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#c9e8ff"
          emissiveIntensity={1.8}
          metalness={0.7}
          roughness={0.08}
          transparent
          opacity={opacity}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

export function CrystalSpearTrailFlakeMesh({ flake }: { flake: CrystalSpearTrailFlake }) {
  const t = Math.max(0, Math.min(1, flake.age / flake.ttl))
  const opacity = Math.max(0, 0.45 * Math.pow(1 - t, 1.4))
  const scale = 0.03 + t * 0.05
  // spiraling motion: orbit the original position
  const orbit = t * Math.PI * 2.5
  const radius = 0.08 + t * 0.06
  const axis = new THREE.Vector3(...flake.spinAxis)
  // Compute orthogonal basis
  const perp = useMemo(() => {
    const tangent = Math.abs(axis.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    return new THREE.Vector3().crossVectors(axis, tangent).normalize()
  }, [axis])
  const perp2 = useMemo(() => new THREE.Vector3().crossVectors(axis, perp).normalize(), [axis, perp])
  const off = perp.clone().multiplyScalar(Math.cos(orbit + flake.seed) * radius)
    .add(perp2.clone().multiplyScalar(Math.sin(orbit + flake.seed) * radius))

  return (
    <mesh
      position={[flake.position[0] + off.x, flake.position[1] + off.y, flake.position[2] + off.z]}
      rotation={[orbit, orbit * 0.5, 0]}
      scale={scale}
    >
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#e8f6ff" transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export function CrystalSpearImpactMesh({ impact }: { impact: CrystalSpearImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  const shards = useMemo(() => {
    const count = 16
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (impact.seed * 0.001)
      const speed = 1.5 + ((impact.seed + i * 17) % 11) * 0.18
      const up = 0.4 + ((impact.seed + i * 23) % 9) * 0.08
      return { id: i, angle, speed, up, size: 0.04 + (i % 4) * 0.014, spin: ((i * 7) % 5) * 0.6 + 0.3 }
    })
  }, [impact.seed])

  // Orbit during first half, then scale-down second half.
  const orbitPhase = Math.min(1, t * 2)
  const scalePhase = Math.max(0, (t - 0.5) * 2)

  return (
    <group position={impact.position}>
      {/* Impact flash */}
      <mesh scale={0.6 + t * 3.4}>
        <sphereGeometry args={[0.32, 14, 10]} />
        <meshBasicMaterial color="#e8f6ff" transparent opacity={Math.max(0, 0.85 - t * 1.4)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Frost ring on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={0.4 + t * 3.8}>
        <ringGeometry args={[0.5, 0.66, 32]} />
        <meshBasicMaterial color="#a8d4ff" transparent opacity={Math.max(0, 0.6 - t * 0.9)} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Orbiting shards */}
      {shards.map(s => {
        const orbitAngle = s.angle + orbitPhase * Math.PI * 1.5
        const radius = 0.4 + orbitPhase * 0.6
        const x = Math.cos(orbitAngle) * radius
        const z = Math.sin(orbitAngle) * radius
        const y = Math.max(0.04, s.up * orbitPhase - 0.3 * orbitPhase * orbitPhase + 0.3)
        const scale = Math.max(0.04, s.size * (1 - scalePhase))
        return (
          <mesh key={s.id} position={[x, y, z]} rotation={[orbitAngle * s.spin, orbitAngle * 0.7, 0]} scale={scale}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#e8f6ff" emissive="#c9e8ff" emissiveIntensity={0.8} metalness={0.5} roughness={0.18} transparent opacity={Math.max(0, 1 - scalePhase * 1.3)} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

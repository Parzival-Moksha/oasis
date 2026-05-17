// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FIREBOLT B — Solar Flare.
// Spinning sun-disc projectile with curved corona prominences (TorusGeometry
// arcs that orbit the core). Behind it: a stellar-flame jet (TubeGeometry
// curving along the trajectory). Impact = miniature supernova (multi-stage
// flash + concentric shockwave rings + blinding aura).
//
// Bloom-friendly: white-hot #fff8e8 core, additive #ffaa44 outer prominences.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type SolarFlareProjectile = {
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

export type SolarFlareTrailPuff = {
  id: string
  position: [number, number, number]
  direction: [number, number, number]
  age: number
  ttl: number
}

export type SolarFlareExplosion = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export const SOLAR_TRAIL_SPACING_M = 0.22

const PROMINENCE_COUNT = 6

export function SolarFlareMesh({ projectile }: { projectile: SolarFlareProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)

  const direction = useMemo(() => {
    return new THREE.Vector3(...projectile.velocity).normalize()
  }, [projectile.velocity])

  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  const prominences = useMemo(() => {
    return Array.from({ length: PROMINENCE_COUNT }, (_, i) => ({
      angle: (i / PROMINENCE_COUNT) * Math.PI * 2,
      tilt: Math.sin(i * 1.3) * 0.4,
      hue: i % 2 === 0 ? '#ffaa44' : '#ff7a18',
    }))
  }, [])

  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.z += delta * 9.4
  })

  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))
  const pulse = 1 + Math.sin(projectile.age * 38) * 0.06

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      {/* Outer additive blooming halo */}
      <mesh scale={pulse * 1.4}>
        <sphereGeometry args={[0.42, 18, 12]} />
        <meshBasicMaterial color="#ffaa44" transparent opacity={0.22 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* Spinning core disc + prominences */}
      <group ref={spinRef}>
        {/* White-hot core sphere */}
        <mesh scale={pulse}>
          <sphereGeometry args={[0.18, 22, 14]} />
          <meshStandardMaterial
            color="#fff8e8"
            emissive="#fff8e8"
            emissiveIntensity={3.4}
            transparent
            opacity={opacity}
            toneMapped={false}
          />
        </mesh>

        {/* Sun-disc ring (face-on) */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.2, 0.34, 28]} />
          <meshBasicMaterial color="#ffd76b" transparent opacity={0.7 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>

        {/* Corona prominence ribbons — curved torus arcs */}
        {prominences.map((p, i) => (
          <group key={i} rotation={[p.tilt, 0, p.angle]}>
            <mesh position={[0.32, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.18, 0.04, 8, 18, Math.PI * 1.05]} />
              <meshStandardMaterial
                color={p.hue}
                emissive={p.hue}
                emissiveIntensity={2.4}
                transparent
                opacity={0.78 * opacity}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* Backward stellar-flame jet — short cone bursting out the rear */}
      <mesh position={[0, 0, -0.34]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.16, 0.46, 14, 1, true]} />
        <meshBasicMaterial color="#ffaa44" transparent opacity={0.5 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Trail puff for solar flare — stretched plasma streak. */
export function SolarFlareTrailMesh({ puff }: { puff: SolarFlareTrailPuff }) {
  const t = Math.max(0, Math.min(1, puff.age / puff.ttl))
  const opacity = Math.max(0, 0.4 * Math.pow(1 - t, 1.6))
  const direction = useMemo(() => new THREE.Vector3(...puff.direction).normalize(), [puff.direction])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  return (
    <group position={puff.position} quaternion={orientation}>
      <mesh position={[0, 0, -0.1]} scale={[1, 1, 1 + t * 0.6]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshBasicMaterial color={t < 0.45 ? '#fff5c8' : '#ff8a2c'} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function SolarFlareExplosionMesh({ explosion }: { explosion: SolarFlareExplosion }) {
  const t = Math.max(0, Math.min(1, explosion.age / explosion.ttl))
  const rings = useMemo(() => Array.from({ length: 10 }, (_, i) => i), [])
  const sparks = useMemo(() => {
    const count = 24
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + explosion.seed * 0.001
      return {
        id: index,
        angle,
        speed: 2.4 + ((index * 17 + explosion.seed) % 11) * 0.22,
        up: 0.4 + ((index * 23 + explosion.seed) % 9) * 0.06,
        size: 0.06 + (index % 4) * 0.02,
      }
    })
  }, [explosion.seed])

  return (
    <group position={explosion.position}>
      {/* Central white flash */}
      <mesh scale={0.6 + t * 4.2}>
        <sphereGeometry args={[0.4, 22, 16]} />
        <meshBasicMaterial color="#fff8e8" transparent opacity={Math.max(0, 0.95 - t * 1.4)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Orange shell */}
      <mesh scale={1 + t * 6}>
        <sphereGeometry args={[0.42, 20, 14]} />
        <meshBasicMaterial color="#ffaa44" transparent opacity={Math.max(0, 0.5 - t * 0.62)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Concentric shockwave rings (face-down) */}
      {rings.map(i => {
        const ringDelay = i * 0.05
        const ringT = Math.max(0, (t - ringDelay) / Math.max(0.0001, 1 - ringDelay))
        const opacity = Math.max(0, 0.7 - ringT * 1.1) * (ringT > 0 ? 1 : 0)
        if (opacity <= 0) return null
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} scale={0.4 + ringT * (3.8 + i * 0.18)}>
            <ringGeometry args={[0.5, 0.62, 36]} />
            <meshBasicMaterial color={i % 2 ? '#fff8e8' : '#ffd76b'} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        )
      })}
      {/* Burst sparks */}
      {sparks.map(s => {
        const life = t * 1.4
        const x = Math.cos(s.angle) * s.speed * life
        const z = Math.sin(s.angle) * s.speed * life
        const y = Math.max(0.04, s.up * life - 1.6 * life * life + 0.4)
        return (
          <mesh key={s.id} position={[x, y, z]} scale={Math.max(0.18, 1 - t * 0.5)}>
            <sphereGeometry args={[s.size, 8, 6]} />
            <meshBasicMaterial color={s.id % 3 === 0 ? '#fff8e8' : s.id % 3 === 1 ? '#ffaa44' : '#ff7a18'} transparent opacity={Math.max(0, 0.92 - t * 1.0)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        )
      })}
      {/* Blinding aura */}
      <mesh scale={1.4 + t * 1.6}>
        <sphereGeometry args={[0.6, 14, 10]} />
        <meshBasicMaterial color="#fff8e8" transparent opacity={Math.max(0, 0.16 - t * 0.18)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

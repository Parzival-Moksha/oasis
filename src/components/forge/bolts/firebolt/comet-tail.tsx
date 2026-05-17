// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FIREBOLT A — Comet Tail.
// Port of the original FireboltLayer.tsx render pipeline. Same projectile
// (additive halo + emissive core + warm tail nubs), same smoke-puff trail,
// same explosion (flash + corona + ring + sparks + smoke).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

export type CometTailProjectile = {
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

export type CometTailSmokePuff = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  size: number
}

export type CometTailExplosion = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export type CometTailHitMarker = {
  id: string
  position: [number, number, number]
  label: string
  age: number
  ttl: number
}

export const COMET_TRAIL_SPACING_M = 0.5
export const COMET_SMOKE_TTL_S = 1

export function CometTailMesh({ projectile }: { projectile: CometTailProjectile }) {
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
        <meshStandardMaterial color="#ff5a1f" emissive="#ff7a18" emissiveIntensity={2.7} transparent opacity={opacity} toneMapped={false} />
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

export function CometTailSmokePuffMesh({ puff }: { puff: CometTailSmokePuff }) {
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

export function CometTailExplosionMesh({ explosion }: { explosion: CometTailExplosion }) {
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

export function CometTailHitMarkerMesh({ marker }: { marker: CometTailHitMarker }) {
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

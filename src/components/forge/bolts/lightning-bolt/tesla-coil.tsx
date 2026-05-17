// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIGHTNING B — Tesla Coil.
//
// Vertical rolling lattice: 3-4 stacked TorusGeometry rings (copper-orange
// emissive) travel in formation. Short discharge arcs leap between adjacent
// rings, regenerated ~30Hz with seeded randomness. Trail = smoldering ozone
// fizz (small additive particles). Impact = rolling discharge across the
// surface, a circle of 20-30 small arcs spawning sequentially over 0.6s.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type TeslaCoilProjectile = {
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

export type TeslaCoilTrailPuff = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export type TeslaCoilImpact = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  normalUp: [number, number, number]
}

const RING_COUNT = 4
const RING_SPACING = 0.18

export function TeslaCoilMesh({ projectile }: { projectile: TeslaCoilProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const arcRef = useRef<number>(0)
  const [arcSeed, setArcSeed] = useState<number>(() => ((Math.random() * 1e6) | 0))
  const direction = useMemo(() => new THREE.Vector3(...projectile.velocity).normalize(), [projectile.velocity])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  useFrame((_, delta) => {
    arcRef.current += delta
    if (arcRef.current > 1 / 30) {
      arcRef.current = 0
      setArcSeed((Math.random() * 1e6) | 0)
    }
  })

  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))

  // Pre-compute discharge segments using arcSeed (regenerated 30Hz).
  // Each refresh allocates fresh TubeGeometries; the cleanup effect below
  // disposes the previous batch when arcSeed changes (or on unmount).
  const arcs = useMemo(() => {
    const rng = mulberry(arcSeed || 1)
    return Array.from({ length: 5 }, () => {
      // Pick two ring positions
      const a = Math.floor(rng() * RING_COUNT)
      let b = Math.floor(rng() * RING_COUNT)
      if (b === a) b = (b + 1) % RING_COUNT
      const aZ = (a - (RING_COUNT - 1) / 2) * RING_SPACING
      const bZ = (b - (RING_COUNT - 1) / 2) * RING_SPACING
      const angleA = rng() * Math.PI * 2
      const angleB = rng() * Math.PI * 2
      const r = 0.22
      const xa = Math.cos(angleA) * r
      const ya = Math.sin(angleA) * r
      const xb = Math.cos(angleB) * r
      const yb = Math.sin(angleB) * r
      const mid = new THREE.Vector3((xa + xb) / 2 + (rng() - 0.5) * 0.12, (ya + yb) / 2 + (rng() - 0.5) * 0.12, (aZ + bZ) / 2)
      const start = new THREE.Vector3(xa, ya, aZ)
      const end = new THREE.Vector3(xb, yb, bZ)
      const curve = new THREE.CatmullRomCurve3([start, mid, end])
      return new THREE.TubeGeometry(curve, 12, 0.012, 4, false)
    })
  }, [arcSeed])

  // Dispose the prior arc TubeGeometries when arcSeed changes (30Hz) or on
  // unmount. Without this, every cast leaks ~150 TubeGeometries/sec.
  useEffect(() => {
    return () => {
      for (const tube of arcs) tube.dispose()
    }
  }, [arcs])

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      {/* Stack of rings */}
      {Array.from({ length: RING_COUNT }, (_, i) => {
        const z = (i - (RING_COUNT - 1) / 2) * RING_SPACING
        const phase = projectile.age * 12 + i * 0.7
        const radius = 0.22 + Math.sin(phase) * 0.012
        return (
          <group key={i} position={[0, 0, z]}>
            {/* Ring core */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[radius, 0.024, 8, 28]} />
              <meshStandardMaterial color="#ff8a2c" emissive="#ff7a18" emissiveIntensity={2.6} transparent opacity={opacity} toneMapped={false} />
            </mesh>
            {/* Ring halo */}
            <mesh rotation={[Math.PI / 2, 0, 0]} scale={1.18}>
              <torusGeometry args={[radius, 0.05, 6, 24]} />
              <meshBasicMaterial color="#ffd76b" transparent opacity={0.32 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
          </group>
        )
      })}

      {/* Discharge arcs between rings */}
      {arcs.map((tube, i) => (
        <mesh key={i} geometry={tube}>
          <meshBasicMaterial color="#e0c4ff" transparent opacity={0.85 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}

      {/* Core glow (along the axis) */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, RING_SPACING * (RING_COUNT - 1), 10]} />
        <meshBasicMaterial color="#ff8a2c" transparent opacity={0.5 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

// Helper: deterministic RNG (inline, no shared.ts dep here so the file is self-contained for editors).
function mulberry(seedIn: number): () => number {
  let seed = seedIn >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function TeslaCoilTrailMesh({ puff }: { puff: TeslaCoilTrailPuff }) {
  const t = Math.max(0, Math.min(1, puff.age / puff.ttl))
  const drift = Math.sin(puff.seed * 0.17 + t * 3.4) * 0.04
  const opacity = Math.max(0, 0.4 * Math.pow(1 - t, 1.6))
  const scale = 0.05 + t * 0.18
  return (
    <mesh position={[puff.position[0] + drift, puff.position[1] + t * 0.18, puff.position[2] - drift]} scale={scale}>
      <sphereGeometry args={[1, 6, 5]} />
      <meshBasicMaterial color={t < 0.4 ? '#a07ed8' : '#5b3a8e'} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export function TeslaCoilImpactMesh({ impact }: { impact: TeslaCoilImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  // 20-30 small arcs around the circle, spawned sequentially over 0.6s.
  const surfaceArcs = useMemo(() => {
    const rng = mulberry(impact.seed || 1)
    const count = 24
    return Array.from({ length: count }, (_, i) => ({
      angle: (i / count) * Math.PI * 2 + rng() * 0.2,
      delay: i / count * 0.6,
      length: 0.18 + rng() * 0.14,
    }))
  }, [impact.seed])
  const upDir = useMemo(() => new THREE.Vector3(...impact.normalUp).normalize(), [impact.normalUp])
  // Build a local frame around upDir for radial placement
  const refX = useMemo(() => {
    const tangent = Math.abs(upDir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    return new THREE.Vector3().crossVectors(upDir, tangent).normalize()
  }, [upDir])
  const refZ = useMemo(() => new THREE.Vector3().crossVectors(upDir, refX).normalize(), [refX, upDir])

  // The arc endpoint extends with arcT each render. We allocate per-render so
  // the curve shape stays accurate. Track both the prior and current batches
  // in refs; after each commit, dispose the prior batch (which the GPU has
  // now finished using). On unmount, dispose the current batch.
  const arcTubesPrevRef = useRef<THREE.TubeGeometry[]>([])
  const arcTubesCurrentRef = useRef<THREE.TubeGeometry[]>([])
  const arcMeshes: ReactNode[] = []
  const liveTubes: THREE.TubeGeometry[] = []
  for (let i = 0; i < surfaceArcs.length; i++) {
    const arc = surfaceArcs[i]
    const arcAge = impact.age - arc.delay
    const arcT = Math.max(0, Math.min(1, arcAge / 0.4))
    if (arcT <= 0) continue
    const opacity = Math.max(0, 1 - arcT) * 0.95
    const radiusOuter = arc.length
    const a = arc.angle
    const dir = refX.clone().multiplyScalar(Math.cos(a)).add(refZ.clone().multiplyScalar(Math.sin(a)))
    const start = new THREE.Vector3().addScaledVector(dir, 0.1)
    const end = new THREE.Vector3().addScaledVector(dir, radiusOuter + arcT * 0.4)
    const mid = start.clone().lerp(end, 0.5).addScaledVector(upDir, 0.08).add(new THREE.Vector3(Math.sin(i * 7) * 0.05, 0, 0))
    const curve = new THREE.CatmullRomCurve3([start, mid, end])
    const tube = new THREE.TubeGeometry(curve, 10, 0.014, 4, false)
    liveTubes.push(tube)
    arcMeshes.push(
      <mesh key={i} geometry={tube}>
        <meshBasicMaterial color={i % 2 === 0 ? '#ffd76b' : '#a07ed8'} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>,
    )
  }
  // Rotate prev <- current <- new; the post-commit effect below disposes prev.
  arcTubesPrevRef.current = arcTubesCurrentRef.current
  arcTubesCurrentRef.current = liveTubes
  // After commit, dispose the previous frame's tubes (the GPU is done with
  // them since React has already rendered the new batch).
  useEffect(() => {
    const stale = arcTubesPrevRef.current
    arcTubesPrevRef.current = []
    for (const tube of stale) tube.dispose()
  })
  // Final unmount cleanup: dispose whatever the last frame allocated.
  useEffect(() => {
    return () => {
      for (const tube of arcTubesCurrentRef.current) tube.dispose()
      arcTubesCurrentRef.current = []
      for (const tube of arcTubesPrevRef.current) tube.dispose()
      arcTubesPrevRef.current = []
    }
  }, [])

  const ringQuat = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upDir)
    return q
  }, [upDir])

  return (
    <group position={impact.position}>
      {/* Central burst */}
      <mesh scale={0.6 + t * 3}>
        <sphereGeometry args={[0.3, 14, 10]} />
        <meshBasicMaterial color="#ffd76b" transparent opacity={Math.max(0, 0.7 - t * 1.2)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Rolling discharge arcs */}
      {arcMeshes}
      {/* Shockwave ring on surface */}
      <mesh quaternion={ringQuat} scale={0.4 + t * 3.5}>
        <ringGeometry args={[0.4, 0.55, 36]} />
        <meshBasicMaterial color="#ff8a2c" transparent opacity={Math.max(0, 0.65 - t * 0.85)} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

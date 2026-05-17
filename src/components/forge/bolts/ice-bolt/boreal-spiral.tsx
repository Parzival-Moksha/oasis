// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ICE C — Boreal Spiral.
//
// Double-helix of two thin ice ribbons twisting around a hollow snowflake-
// shaped core. Two TubeGeometry strands wrap helically (parametric curve;
// one full 360° revolution every ~0.6m). Core: snowflake-shape made from
// 6-fold symmetric thin ice crystal lines (transparent plane with hand-built
// vertex geometry). The core flickers between 3-4 snowflake "variants" as
// it travels. Trail: ephemeral snowflake glyph stamps. Impact: 8-12 fractal
// snowflake fragments + an ephemeral frost rune at y=0.01.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type BorealSpiralProjectile = {
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

export type BorealSpiralGlyph = {
  id: string
  position: [number, number, number]
  forward: [number, number, number]
  age: number
  ttl: number
  variant: number
}

export type BorealSpiralImpact = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export const BOREAL_TRAIL_SPACING_M = 0.4
const SPIRAL_LENGTH = 0.7
const SPIRAL_RADIUS = 0.09
const SPIRAL_REVOLUTIONS = SPIRAL_LENGTH / 0.6

/** Build two helical tubes around the projectile's local Z axis. */
function buildHelixTubes(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const segments = 80
  const pointsA: THREE.Vector3[] = []
  const pointsB: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const z = -SPIRAL_LENGTH / 2 + t * SPIRAL_LENGTH
    const angle = t * Math.PI * 2 * SPIRAL_REVOLUTIONS
    pointsA.push(new THREE.Vector3(Math.cos(angle) * SPIRAL_RADIUS, Math.sin(angle) * SPIRAL_RADIUS, z))
    pointsB.push(new THREE.Vector3(Math.cos(angle + Math.PI) * SPIRAL_RADIUS, Math.sin(angle + Math.PI) * SPIRAL_RADIUS, z))
  }
  const curveA = new THREE.CatmullRomCurve3(pointsA)
  const curveB = new THREE.CatmullRomCurve3(pointsB)
  return [
    new THREE.TubeGeometry(curveA, 60, 0.016, 6, false),
    new THREE.TubeGeometry(curveB, 60, 0.016, 6, false),
  ]
}

let helixCache: [THREE.BufferGeometry, THREE.BufferGeometry] | null = null
function getHelixGeoms(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (!helixCache) helixCache = buildHelixTubes()
  return helixCache
}

/** Build a 6-fold snowflake from line segments — variant index varies the petals. */
function buildSnowflake(variant: number): THREE.BufferGeometry {
  const lines: THREE.Vector3[] = []
  const r = 0.1
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const dirX = Math.cos(a) * r
    const dirY = Math.sin(a) * r
    lines.push(new THREE.Vector3(0, 0, 0))
    lines.push(new THREE.Vector3(dirX, dirY, 0))
    // Petal "teeth" — vary count by variant
    const teeth = 2 + (variant % 3)
    for (let j = 1; j <= teeth; j++) {
      const tFrac = j / (teeth + 1)
      const baseX = dirX * tFrac
      const baseY = dirY * tFrac
      const sideAngle = a + Math.PI / 2
      const sideLen = r * 0.18 * (1 + (variant % 2))
      lines.push(new THREE.Vector3(baseX, baseY, 0))
      lines.push(new THREE.Vector3(baseX + Math.cos(sideAngle) * sideLen, baseY + Math.sin(sideAngle) * sideLen, 0))
      lines.push(new THREE.Vector3(baseX, baseY, 0))
      lines.push(new THREE.Vector3(baseX - Math.cos(sideAngle) * sideLen, baseY - Math.sin(sideAngle) * sideLen, 0))
    }
  }
  const geom = new THREE.BufferGeometry().setFromPoints(lines)
  return geom
}

const snowflakeCache: Map<number, THREE.BufferGeometry> = new Map()
function getSnowflakeGeom(variant: number): THREE.BufferGeometry {
  if (!snowflakeCache.has(variant)) snowflakeCache.set(variant, buildSnowflake(variant))
  return snowflakeCache.get(variant)!
}

export function BorealSpiralMesh({ projectile }: { projectile: BorealSpiralProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)
  const direction = useMemo(() => new THREE.Vector3(...projectile.velocity).normalize(), [projectile.velocity])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.z += delta * 5.4
  })

  const [helixA, helixB] = getHelixGeoms()
  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))

  // Snowflake variant cycles 0..3 over time
  const variant = Math.floor(projectile.age * 12) % 4
  const snowGeom = getSnowflakeGeom(variant)

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      {/* Outer halo */}
      <mesh>
        <sphereGeometry args={[0.18, 14, 10]} />
        <meshBasicMaterial color="#c9e8ff" transparent opacity={0.22 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Double-helix tubes (spinning) */}
      <group ref={spinRef}>
        <mesh geometry={helixA}>
          <meshStandardMaterial color="#e8f6ff" emissive="#a8d4ff" emissiveIntensity={1.4} metalness={0.45} roughness={0.18} transparent opacity={opacity} toneMapped={false} />
        </mesh>
        <mesh geometry={helixB}>
          <meshStandardMaterial color="#c9e8ff" emissive="#5b9bd6" emissiveIntensity={1.2} metalness={0.45} roughness={0.2} transparent opacity={opacity} toneMapped={false} />
        </mesh>
        {/* Center snowflake core (flickers variants) */}
        <lineSegments geometry={snowGeom}>
          <lineBasicMaterial color="#e0f6ff" transparent opacity={opacity * 0.95} toneMapped={false} />
        </lineSegments>
      </group>
      {/* Tip flare */}
      <mesh position={[0, 0, SPIRAL_LENGTH / 2 + 0.04]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Trailing snowflake glyph stamp - billboard against the direction of travel. */
export function BorealSpiralGlyphMesh({ glyph }: { glyph: BorealSpiralGlyph }) {
  const t = Math.max(0, Math.min(1, glyph.age / glyph.ttl))
  const opacity = Math.max(0, 0.85 * Math.pow(1 - t, 1.6))
  const scale = 1 - t * 0.4
  const forward = useMemo(() => new THREE.Vector3(...glyph.forward).normalize(), [glyph.forward])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward)
    return q
  }, [forward])
  const geom = getSnowflakeGeom(glyph.variant)
  return (
    <group position={glyph.position} quaternion={orientation} scale={scale}>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color="#c9e8ff" transparent opacity={opacity} toneMapped={false} />
      </lineSegments>
    </group>
  )
}

export function BorealSpiralImpactMesh({ impact }: { impact: BorealSpiralImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  const fragments = useMemo(() => {
    const count = 10
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + impact.seed * 0.001
      return {
        id: i,
        angle,
        speed: 1.4 + ((impact.seed + i * 17) % 11) * 0.18,
        up: 0.4 + ((impact.seed + i * 23) % 9) * 0.07,
        variant: i % 4,
        size: 0.7 + (i % 3) * 0.15,
        spin: (i % 3) * 0.6 + 0.4,
      }
    })
  }, [impact.seed])

  return (
    <group position={impact.position}>
      {/* Burst */}
      <mesh scale={0.6 + t * 3.4}>
        <sphereGeometry args={[0.3, 14, 10]} />
        <meshBasicMaterial color="#e0f6ff" transparent opacity={Math.max(0, 0.8 - t * 1.4)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Frost rune at ground (ephemeral, fades over impact lifetime) */}
      <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} scale={1.4}>
        <lineSegments geometry={getSnowflakeGeom((impact.seed % 4) | 0)}>
          <lineBasicMaterial color="#c9e8ff" transparent opacity={Math.max(0, 0.85 - t * 0.85)} toneMapped={false} />
        </lineSegments>
        <lineSegments geometry={getSnowflakeGeom(((impact.seed + 7) % 4) | 0)} rotation={[0, 0, Math.PI / 6]}>
          <lineBasicMaterial color="#a8d4ff" transparent opacity={Math.max(0, 0.5 - t * 0.6)} toneMapped={false} />
        </lineSegments>
      </group>
      {/* Fractal snowflake fragments flying outward */}
      {fragments.map(f => {
        const life = t * 1.4
        const x = Math.cos(f.angle) * f.speed * life
        const z = Math.sin(f.angle) * f.speed * life
        const y = Math.max(0.04, f.up * life - 0.6 * life * life + 0.4)
        return (
          <group key={f.id} position={[x, y, z]} rotation={[f.angle, f.angle * f.spin, life * Math.PI]} scale={Math.max(0.1, f.size * (1 - t * 0.5))}>
            <lineSegments geometry={getSnowflakeGeom(f.variant)}>
              <lineBasicMaterial color={f.variant % 2 ? '#e0f6ff' : '#a8d4ff'} transparent opacity={Math.max(0, 0.85 - t * 1.1)} toneMapped={false} />
            </lineSegments>
          </group>
        )
      })}
    </group>
  )
}

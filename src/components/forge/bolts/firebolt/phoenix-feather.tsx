// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FIREBOLT C — Phoenix Feather.
// Feather-shape projectile (custom curved plane with vertex-color gradient
// gold→crimson). Ember sparks cascade off the trailing barbs. Impact bursts a
// phoenix-wing silhouette (additive billboard) and disperses an ember flock.
//
// Phase-1 visual choices:
//   * Feather is a procedural Shape -> ShapeGeometry, vertex-colored.
//   * Trail = small particle puffs with a per-particle fall+fade.
//   * Impact = additive billboard wing + radial ember spawn.
// TODO(polish): replace ShapeGeometry feather with a real feather texture and
//   feather-vane noise vertex displacement for true plumage.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type PhoenixFeatherProjectile = {
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

export type PhoenixEmber = {
  id: string
  position: [number, number, number]
  velocity: [number, number, number]
  age: number
  ttl: number
  hue: number
}

export type PhoenixExplosion = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  /** Up vector for the phoenix-wing billboard orientation. */
  upVec: [number, number, number]
}

export const PHOENIX_TRAIL_SPACING_M = 0.18

/** Build a feather-shape geometry once (cached). */
function buildFeatherGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  // Feather pointing along +Z (length 0.6m, width 0.16m).
  shape.moveTo(0, -0.05)
  shape.quadraticCurveTo(0.08, 0.06, 0.06, 0.18)
  shape.quadraticCurveTo(0.10, 0.30, 0.04, 0.45)
  shape.lineTo(0, 0.55)
  shape.lineTo(-0.04, 0.45)
  shape.quadraticCurveTo(-0.10, 0.30, -0.06, 0.18)
  shape.quadraticCurveTo(-0.08, 0.06, 0, -0.05)
  const geom = new THREE.ShapeGeometry(shape, 16)
  // Apply vertex colors: y -> gradient gold (top) to crimson (bottom).
  const pos = geom.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const golden = new THREE.Color('#ffe27a')
  const crimson = new THREE.Color('#c8341a')
  const tip = new THREE.Color('#fff8dc')
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const tNorm = THREE.MathUtils.clamp((y + 0.05) / 0.6, 0, 1)
    const c = new THREE.Color()
    if (tNorm > 0.78) c.copy(tip)
    else if (tNorm > 0.42) c.lerpColors(crimson, golden, (tNorm - 0.42) / 0.36)
    else c.copy(crimson).lerp(golden, tNorm / 0.42 * 0.4)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // Rotate so feather tip points along +Z forward direction.
  geom.rotateX(-Math.PI / 2)
  return geom
}

let featherGeomCache: THREE.BufferGeometry | null = null
function getFeatherGeometry(): THREE.BufferGeometry {
  if (!featherGeomCache) featherGeomCache = buildFeatherGeometry()
  return featherGeomCache
}

export function PhoenixFeatherMesh({ projectile }: { projectile: PhoenixFeatherProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const wobbleRef = useRef<THREE.Group>(null)

  const direction = useMemo(() => new THREE.Vector3(...projectile.velocity).normalize(), [projectile.velocity])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
    return q
  }, [direction])

  useFrame((_, delta) => {
    if (wobbleRef.current) {
      wobbleRef.current.rotation.z += delta * 1.8
      wobbleRef.current.rotation.x = Math.sin(projectile.age * 9) * 0.18
    }
  })

  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))
  const geom = getFeatherGeometry()

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      <group ref={wobbleRef}>
        {/* Glow halo behind feather */}
        <mesh>
          <sphereGeometry args={[0.22, 16, 12]} />
          <meshBasicMaterial color="#ffaa28" transparent opacity={0.32 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        {/* Feather body */}
        <mesh geometry={geom}>
          <meshStandardMaterial
            vertexColors
            emissive="#ff8a18"
            emissiveIntensity={1.6}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        {/* Mirror feather slightly rotated (depth richness) */}
        <mesh geometry={geom} rotation={[0, Math.PI / 6, 0]} scale={0.85}>
          <meshStandardMaterial
            vertexColors
            emissive="#c8341a"
            emissiveIntensity={1.0}
            transparent
            opacity={opacity * 0.72}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}

export function PhoenixEmberMesh({ ember }: { ember: PhoenixEmber }) {
  const t = Math.max(0, Math.min(1, ember.age / ember.ttl))
  const opacity = Math.max(0, 0.95 * Math.pow(1 - t, 1.4))
  const scale = 0.05 + (1 - t) * 0.05
  const color = ember.hue < 0.5 ? '#ffe27a' : '#ff7a18'
  return (
    <mesh position={ember.position} scale={scale}>
      <sphereGeometry args={[1, 6, 5]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export function PhoenixExplosionMesh({ explosion }: { explosion: PhoenixExplosion }) {
  const t = Math.max(0, Math.min(1, explosion.age / explosion.ttl))
  const sparks = useMemo(() => {
    const count = 28
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + explosion.seed * 0.001
      return {
        id: index,
        angle,
        speed: 1.6 + ((index * 13 + explosion.seed) % 11) * 0.22,
        up: 0.7 + ((index * 23 + explosion.seed) % 9) * 0.12,
        size: 0.06 + (index % 4) * 0.02,
      }
    })
  }, [explosion.seed])

  // Phoenix-wing scale curve: pop out, hold, fade.
  const wingPop = Math.sin(Math.min(1, t * 1.5) * Math.PI)
  const wingScale = 0.8 + wingPop * 3.6

  // Orientation: face camera (sprite) — use the upVec as wing tilt cue.
  const upDir = new THREE.Vector3(...explosion.upVec)

  return (
    <group position={explosion.position}>
      {/* Phoenix wing silhouette billboard — flat plane with wing shape */}
      <PhoenixWingBillboard t={t} scale={wingScale} upDir={upDir} />

      {/* Central white-gold flare */}
      <mesh scale={0.6 + t * 2.4}>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshBasicMaterial color="#fff8dc" transparent opacity={Math.max(0, 0.86 - t * 1.3)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Crimson aura */}
      <mesh scale={1 + t * 5}>
        <sphereGeometry args={[0.4, 16, 12]} />
        <meshBasicMaterial color="#c8341a" transparent opacity={Math.max(0, 0.4 - t * 0.55)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Ember sparks */}
      {sparks.map(s => {
        const life = t * 1.4
        const x = Math.cos(s.angle) * s.speed * life
        const z = Math.sin(s.angle) * s.speed * life
        const y = Math.max(0.04, s.up * life - 0.8 * life * life)
        return (
          <mesh key={s.id} position={[x, y, z]} scale={Math.max(0.18, 1 - t * 0.5)}>
            <sphereGeometry args={[s.size, 6, 5]} />
            <meshBasicMaterial color={s.id % 3 === 0 ? '#ffe27a' : s.id % 3 === 1 ? '#ff8a18' : '#c8341a'} transparent opacity={Math.max(0, 0.92 - t * 1.0)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

function buildWingShape(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  // Stylized phoenix-wing silhouette spreading left+right.
  shape.moveTo(0, 0)
  shape.bezierCurveTo(0.4, 0.6, 1.1, 0.8, 1.6, 0.5)
  shape.bezierCurveTo(1.3, 0.2, 0.7, 0.05, 0, 0)
  shape.bezierCurveTo(-0.7, 0.05, -1.3, 0.2, -1.6, 0.5)
  shape.bezierCurveTo(-1.1, 0.8, -0.4, 0.6, 0, 0)
  return new THREE.ShapeGeometry(shape, 24)
}

let wingGeomCache: THREE.BufferGeometry | null = null
function getWingGeometry(): THREE.BufferGeometry {
  if (!wingGeomCache) wingGeomCache = buildWingShape()
  return wingGeomCache
}

function PhoenixWingBillboard({ t, scale, upDir }: { t: number; scale: number; upDir: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null)
  const wingGeom = getWingGeometry()

  useFrame(({ camera }) => {
    if (!ref.current) return
    // Face camera (billboard) but tilt by upDir cue.
    const lookAt = new THREE.Vector3()
    camera.getWorldPosition(lookAt)
    ref.current.lookAt(lookAt)
    // small rotation about local Z driven by upDir.y so impact angle reads
    ref.current.rotation.z += upDir.y * 0.3
  })

  return (
    <mesh ref={ref} geometry={wingGeom} scale={[scale, scale * 0.7, scale]}>
      <meshBasicMaterial
        color="#ff7a18"
        transparent
        opacity={Math.max(0, 0.95 - t * 1.3)}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}

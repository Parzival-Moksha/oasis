// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIGHTNING A — Plasma Filament.
//
// Jagged forked main path. Geometry generated as a chain of 20-30 segments,
// each angled ±25° from the previous (random walk along the cast direction).
// Main trunk = thin TubeGeometry with emissive plasma material, wrapped in a
// thicker ozone-violet additive halo. Branches spawn at 3-5 random joints,
// each 30-50% length of trunk; recurse 1 more generation.
//
// Animation: the bolt is "revealed" over ~0.4s top→bottom segment-by-segment.
// Each segment ramps emission as it appears, then decays as the next ignites.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mulberry32 } from '../shared'

const TRUNK_SEGMENTS = 24
const PRIMARY_BRANCH_COUNT = 4
const GRANDCHILD_BRANCH_CHANCE = 0.55
const TRUNK_TUBE_RADIUS = 0.022
const TRUNK_HALO_RADIUS = 0.07
const REVEAL_DURATION_S = 0.4

export interface PlasmaFilamentBolt {
  id: string
  origin: [number, number, number]
  /** Full distance the bolt's main trunk spans (from origin in direction). */
  length: number
  direction: [number, number, number]
  age: number
  ttl: number
  damage: number
  seed: number
  /** Generated trunk + branch curves, cached at construction. */
  curves: PlasmaSegment[]
}

interface PlasmaSegment {
  points: [number, number, number][]
  /** Reveal timing 0..1 (when this segment lights up). */
  startT: number
  endT: number
  /** Depth (0 = trunk, 1 = primary branch, 2 = grandchild). */
  depth: number
}

export function buildPlasmaBolt(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  seed: number,
): PlasmaSegment[] {
  const rng = mulberry32(seed)
  const trunkPoints = makeJaggedPath(origin, direction, length, TRUNK_SEGMENTS, rng, 25)
  const trunk: PlasmaSegment = {
    points: trunkPoints.map(v => [v.x, v.y, v.z]),
    startT: 0,
    endT: 1,
    depth: 0,
  }
  const segments: PlasmaSegment[] = [trunk]

  // Pick 3-5 random joints for primary branches.
  const branchCount = 3 + Math.floor(rng() * 3)
  for (let b = 0; b < branchCount && b < PRIMARY_BRANCH_COUNT + 1; b++) {
    const joint = 4 + Math.floor(rng() * (trunkPoints.length - 8))
    if (joint >= trunkPoints.length - 1) continue
    const startPt = trunkPoints[joint]
    const baseDir = trunkPoints[joint + 1].clone().sub(startPt).normalize()
    // Branch angle: 35° offset from trunk
    const branchDir = perturbDirection(baseDir, rng, 0.65)
    const branchLen = length * (0.3 + rng() * 0.2)
    const branchSegments = Math.max(6, Math.floor(TRUNK_SEGMENTS * 0.4))
    const branchPoints = makeJaggedPath(startPt, branchDir, branchLen, branchSegments, rng, 35)
    const startT = joint / (trunkPoints.length - 1)
    segments.push({
      points: branchPoints.map(v => [v.x, v.y, v.z]),
      startT,
      endT: 1,
      depth: 1,
    })
    // 1 more generation of grandchildren branches
    const grandchildCount = 1 + Math.floor(rng() * 2)
    for (let g = 0; g < grandchildCount; g++) {
      if (rng() > GRANDCHILD_BRANCH_CHANCE) continue
      const childJoint = 2 + Math.floor(rng() * (branchPoints.length - 4))
      if (childJoint >= branchPoints.length - 1) continue
      const childStart = branchPoints[childJoint]
      const childBase = branchPoints[childJoint + 1].clone().sub(childStart).normalize()
      const childDir = perturbDirection(childBase, rng, 0.85)
      const childLen = branchLen * (0.3 + rng() * 0.25)
      const childPoints = makeJaggedPath(childStart, childDir, childLen, 5, rng, 45)
      const gcStartT = startT + (1 - startT) * (childJoint / branchPoints.length)
      segments.push({
        points: childPoints.map(v => [v.x, v.y, v.z]),
        startT: gcStartT,
        endT: 1,
        depth: 2,
      })
    }
  }

  return segments
}

function makeJaggedPath(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  segments: number,
  rng: () => number,
  maxAngleDeg: number,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  pts.push(origin.clone())
  let current = origin.clone()
  let dir = direction.clone().normalize()
  const stepLen = length / segments
  for (let i = 0; i < segments; i++) {
    // Pull dir back toward the original aim every step so bolt stays on target.
    dir = dir.lerp(direction, 0.18).normalize()
    dir = perturbDirection(dir, rng, (maxAngleDeg / 180) * Math.PI)
    const next = current.clone().addScaledVector(dir, stepLen)
    pts.push(next)
    current = next
  }
  return pts
}

function perturbDirection(dir: THREE.Vector3, rng: () => number, maxAngleRad: number): THREE.Vector3 {
  const axis = new THREE.Vector3((rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2).normalize()
  const angle = (rng() - 0.5) * 2 * maxAngleRad
  return dir.clone().applyAxisAngle(axis, angle).normalize()
}

export function PlasmaFilamentMesh({ bolt }: { bolt: PlasmaFilamentBolt }) {
  // reveal: how far the trunk has "walked" 0..1 by REVEAL_DURATION_S
  const reveal = Math.min(1, bolt.age / REVEAL_DURATION_S)
  // afterReveal fade
  const fade = Math.max(0, 1 - (bolt.age - REVEAL_DURATION_S) / Math.max(0.001, bolt.ttl - REVEAL_DURATION_S))

  // Build geometries lazily — only when bolt mounts.
  const built = useMemo(() => {
    return bolt.curves.map(segment => {
      const points = segment.points.map(p => new THREE.Vector3(...p))
      if (points.length < 2) return null
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25)
      const tubeSegments = Math.max(8, points.length * 2)
      const trunkRadius = segment.depth === 0 ? TRUNK_TUBE_RADIUS : segment.depth === 1 ? TRUNK_TUBE_RADIUS * 0.7 : TRUNK_TUBE_RADIUS * 0.45
      const haloRadius = segment.depth === 0 ? TRUNK_HALO_RADIUS : segment.depth === 1 ? TRUNK_HALO_RADIUS * 0.65 : TRUNK_HALO_RADIUS * 0.4
      const trunk = new THREE.TubeGeometry(curve, tubeSegments, trunkRadius, 5, false)
      const halo = new THREE.TubeGeometry(curve, tubeSegments, haloRadius, 5, false)
      return { trunk, halo, segment }
    })
  }, [bolt.curves])

  // Dispose TubeGeometries when the bolt unmounts (filter from state array).
  useEffect(() => {
    return () => {
      for (const b of built) {
        if (!b) continue
        b.trunk.dispose()
        b.halo.dispose()
      }
    }
  }, [built])

  return (
    <group>
      {built.map((b, i) => {
        if (!b) return null
        // Visibility window: segment is visible once reveal >= startT.
        const segReveal = THREE.MathUtils.clamp((reveal - b.segment.startT) / Math.max(0.0001, b.segment.endT - b.segment.startT), 0, 1)
        if (segReveal <= 0) return null
        const intensity = segReveal * fade
        const haloOpacity = 0.55 * intensity
        const trunkOpacity = Math.min(1, 0.95 * intensity)
        return (
          <group key={i}>
            {/* Halo (ozone violet) */}
            <mesh geometry={b.halo}>
              <meshBasicMaterial color="#a07ed8" transparent opacity={haloOpacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            {/* Inner plasma core */}
            <mesh geometry={b.trunk}>
              <meshStandardMaterial
                color="#ffffff"
                emissive="#aaccff"
                emissiveIntensity={3.5 * intensity + 1.2}
                transparent
                opacity={trunkOpacity}
                toneMapped={false}
              />
            </mesh>
          </group>
        )
      })}
      {/* tip flicker dot at trunk-end */}
      {reveal > 0 && (
        <TipFlicker bolt={bolt} reveal={reveal} fade={fade} />
      )}
    </group>
  )
}

function TipFlicker({ bolt, reveal, fade }: { bolt: PlasmaFilamentBolt; reveal: number; fade: number }) {
  const tip = useMemo(() => {
    const trunk = bolt.curves[0]
    if (!trunk) return new THREE.Vector3()
    const idx = Math.floor((trunk.points.length - 1) * reveal)
    const p = trunk.points[Math.min(idx, trunk.points.length - 1)]
    return new THREE.Vector3(...p)
  }, [bolt.curves, reveal])

  const flicker = 0.6 + Math.sin(performance.now() * 0.04) * 0.4

  return (
    <mesh position={tip}>
      <sphereGeometry args={[0.12 * (0.5 + reveal * 0.5), 12, 8]} />
      <meshBasicMaterial color="#ddeeff" transparent opacity={Math.max(0, fade * flicker * 0.8)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export interface PlasmaFilamentImpact {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  /** Optional grounding chain endpoints (collisions within 5m). */
  groundingTargets: [number, number, number][]
}

export function PlasmaFilamentImpactMesh({ impact }: { impact: PlasmaFilamentImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  const burstScale = 0.6 + t * 5
  const chainPaths = useMemo(() => {
    return impact.groundingTargets.map(target => {
      const t3 = new THREE.Vector3(...target)
      const start = new THREE.Vector3(...impact.position)
      const mid = start.clone().lerp(t3, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6))
      const curve = new THREE.CatmullRomCurve3([start, mid, t3])
      return new THREE.TubeGeometry(curve, 14, 0.018, 5, false)
    })
  }, [impact.groundingTargets, impact.position])

  // Dispose grounding-chain TubeGeometries when the impact mesh unmounts.
  useEffect(() => {
    return () => {
      for (const geom of chainPaths) geom.dispose()
    }
  }, [chainPaths])

  return (
    <group>
      {/* Local burst + ring at impact point */}
      <group position={impact.position}>
        <mesh scale={burstScale}>
          <sphereGeometry args={[0.32, 18, 14]} />
          <meshBasicMaterial color="#aaccff" transparent opacity={Math.max(0, 0.85 - t * 1.4)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
        <mesh scale={1 + t * 4} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.4, 0.55, 36]} />
          <meshBasicMaterial color="#a07ed8" transparent opacity={Math.max(0, 0.6 - t * 0.85)} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
      {/* Grounding chains use absolute-world geometry — render at origin */}
      {chainPaths.map((geom, i) => (
        <mesh key={i} geometry={geom}>
          <meshBasicMaterial color="#ddeeff" transparent opacity={Math.max(0, 0.85 - t * 1.2)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIGHTNING D — Thunderbolt.
//
// DIFFERENT from the other bolts — it does not fly forward from the player.
// Cast flow:
//   1) Telegraph (~0.3s): caller dispatches placement-VFX at the aimed
//      ground point. (CombatBoltLayer handles that.)
//   2) Strike geometry generation: chain of jaggy segments from y=15 down
//      to the ground point. Each step accumulates a random vertical hop
//      (1-3m) and horizontal jitter (0-1m radial). Branches at joints.
//   3) Animation reveal (0.7s): trunk walks down segment-by-segment.
//      Branches pop in at parent's lit-moment. Trunk hits ground → hold
//      peak ~0.1s → fade. Screen flash overlay at strike moment.
//   4) Impact: shockwave + horizontal grounding chains.
//
// Geometry is baked deterministically per cast via a mulberry32 RNG seeded
// from cast time. The reveal animation drives the visual; geometry never
// re-randomizes during the animation.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mulberry32 } from '../shared'

export const THUNDERBOLT_TELEGRAPH_S = 0.3
export const THUNDERBOLT_REVEAL_S = 0.7
export const THUNDERBOLT_HOLD_S = 0.1
export const THUNDERBOLT_TTL_S = THUNDERBOLT_TELEGRAPH_S + THUNDERBOLT_REVEAL_S + THUNDERBOLT_HOLD_S + 0.4 // + fade
export const THUNDERBOLT_ALTITUDE_M = 15

export interface ThunderboltStrike {
  id: string
  /** Ground impact point (y≈0). */
  groundPoint: [number, number, number]
  age: number
  ttl: number
  damage: number
  seed: number
  segments: ThunderboltSegment[]
  /** Optional collision target hit at the ground point. */
  target: { id: string; position: [number, number, number]; radius: number } | null
}

export interface ThunderboltSegment {
  points: [number, number, number][]
  /** When this segment starts revealing (0..1 of REVEAL phase). */
  startT: number
  /** When this segment finishes revealing (0..1 of REVEAL phase). */
  endT: number
  depth: number
}

/**
 * Bake the trunk geometry from altitude down to ground. Deterministic per
 * seed. Each step takes a random vertical drop (1-3m) plus horizontal
 * jitter (0-1m radial). Once the cumulative drop reaches the altitude, we
 * snap the final point to the ground.
 */
export function buildThunderbolt(groundPoint: THREE.Vector3, seed: number): ThunderboltSegment[] {
  const rng = mulberry32(seed)
  const start = new THREE.Vector3(groundPoint.x, THUNDERBOLT_ALTITUDE_M, groundPoint.z)
  const trunkPoints: THREE.Vector3[] = [start.clone()]
  let current = start.clone()
  let safety = 0
  while (current.y > groundPoint.y + 0.1 && safety++ < 40) {
    const drop = 1 + rng() * 2 // 1-3m
    const jitterAngle = rng() * Math.PI * 2
    const jitterDist = rng() * 1
    const nextY = Math.max(groundPoint.y, current.y - drop)
    const xOff = Math.cos(jitterAngle) * jitterDist
    const zOff = Math.sin(jitterAngle) * jitterDist
    // jitter is RELATIVE to the straight-down axis, not absolute
    const next = new THREE.Vector3(
      groundPoint.x + xOff * (current.y / THUNDERBOLT_ALTITUDE_M),
      nextY,
      groundPoint.z + zOff * (current.y / THUNDERBOLT_ALTITUDE_M),
    )
    trunkPoints.push(next)
    current = next
  }
  // Snap final point to ground
  trunkPoints.push(groundPoint.clone())

  const trunk: ThunderboltSegment = {
    points: trunkPoints.map(v => [v.x, v.y, v.z]),
    startT: 0,
    endT: 1,
    depth: 0,
  }
  const segments: ThunderboltSegment[] = [trunk]

  // Spawn 1-2 children at each joint; recurse 1 generation.
  for (let i = 1; i < trunkPoints.length - 1; i++) {
    const childCount = rng() < 0.7 ? 1 + Math.floor(rng() * 2) : 0
    for (let c = 0; c < childCount; c++) {
      const joint = trunkPoints[i]
      const remainingTrunk = THUNDERBOLT_ALTITUDE_M - (THUNDERBOLT_ALTITUDE_M - joint.y) // = joint.y
      const branchLen = remainingTrunk * (0.3 + rng() * 0.2)
      // Branch direction: mostly downward but skewed
      const baseDir = new THREE.Vector3(0, -1, 0)
      const skewAngle = rng() * Math.PI * 2
      const skewMag = 0.35 + rng() * 0.35
      const branchDir = new THREE.Vector3(
        Math.cos(skewAngle) * skewMag,
        -1,
        Math.sin(skewAngle) * skewMag,
      ).normalize()
      const branchSegs = Math.max(4, Math.floor(branchLen * 1.5))
      const branchPoints: THREE.Vector3[] = [joint.clone()]
      let bCur = joint.clone()
      let bDir = branchDir.clone()
      const stepLen = branchLen / branchSegs
      for (let b = 0; b < branchSegs; b++) {
        bDir = perturbDir(bDir, rng, (35 / 180) * Math.PI)
        const next = bCur.clone().addScaledVector(bDir, stepLen)
        next.y = Math.max(groundPoint.y, next.y)
        branchPoints.push(next)
        bCur = next
        if (bCur.y <= groundPoint.y) break
      }
      const startT = i / (trunkPoints.length - 1)
      segments.push({
        points: branchPoints.map(v => [v.x, v.y, v.z]),
        startT,
        endT: 1,
        depth: 1,
      })
      // Grandchild: small chance for one mini-branch
      if (rng() < 0.4 && branchPoints.length > 3) {
        const childJoint = 1 + Math.floor(rng() * (branchPoints.length - 2))
        const cStart = branchPoints[childJoint].clone()
        const cBaseDir = branchPoints[childJoint + 1].clone().sub(cStart).normalize()
        const cDir = perturbDir(cBaseDir, rng, (50 / 180) * Math.PI)
        const cLen = stepLen * (1 + rng() * 2)
        const cSegs = 4
        const cPts: THREE.Vector3[] = [cStart.clone()]
        let cCur = cStart.clone()
        let dDir = cDir.clone()
        for (let g = 0; g < cSegs; g++) {
          dDir = perturbDir(dDir, rng, (55 / 180) * Math.PI)
          const next = cCur.clone().addScaledVector(dDir, cLen / cSegs)
          next.y = Math.max(groundPoint.y, next.y)
          cPts.push(next)
          cCur = next
        }
        segments.push({
          points: cPts.map(v => [v.x, v.y, v.z]),
          startT: startT + (1 - startT) * (childJoint / branchPoints.length),
          endT: 1,
          depth: 2,
        })
      }
    }
  }

  return segments
}

function perturbDir(dir: THREE.Vector3, rng: () => number, maxAngleRad: number): THREE.Vector3 {
  const axis = new THREE.Vector3((rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2).normalize()
  const angle = (rng() - 0.5) * 2 * maxAngleRad
  return dir.clone().applyAxisAngle(axis, angle).normalize()
}

/** Compute the current phase of a strike based on its age. */
export function thunderboltPhase(age: number): {
  phase: 'telegraph' | 'reveal' | 'hold' | 'fade'
  /** Reveal progress 0..1 (only during 'reveal' and after). */
  reveal: number
  /** Fade progress 0..1 (only meaningful in 'fade'). */
  fade: number
  /** Did the trunk just hit the ground this frame? (lit-moment.) */
  justStruck: boolean
} {
  if (age < THUNDERBOLT_TELEGRAPH_S) {
    return { phase: 'telegraph', reveal: 0, fade: 0, justStruck: false }
  }
  const localAge = age - THUNDERBOLT_TELEGRAPH_S
  if (localAge < THUNDERBOLT_REVEAL_S) {
    const reveal = localAge / THUNDERBOLT_REVEAL_S
    return { phase: 'reveal', reveal, fade: 0, justStruck: reveal >= 0.985 }
  }
  if (localAge < THUNDERBOLT_REVEAL_S + THUNDERBOLT_HOLD_S) {
    return { phase: 'hold', reveal: 1, fade: 0, justStruck: false }
  }
  const fadeAge = localAge - THUNDERBOLT_REVEAL_S - THUNDERBOLT_HOLD_S
  const fadeMax = Math.max(0.001, THUNDERBOLT_TTL_S - THUNDERBOLT_TELEGRAPH_S - THUNDERBOLT_REVEAL_S - THUNDERBOLT_HOLD_S)
  return { phase: 'fade', reveal: 1, fade: Math.min(1, fadeAge / fadeMax), justStruck: false }
}

export function ThunderboltMesh({ strike }: { strike: ThunderboltStrike }) {
  const phase = thunderboltPhase(strike.age)

  const built = useMemo(() => {
    return strike.segments.map(segment => {
      const points = segment.points.map(p => new THREE.Vector3(...p))
      if (points.length < 2) return null
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2)
      const tubeSegs = Math.max(8, points.length * 2)
      const coreR = segment.depth === 0 ? 0.05 : segment.depth === 1 ? 0.035 : 0.022
      const haloR = segment.depth === 0 ? 0.14 : segment.depth === 1 ? 0.09 : 0.06
      const core = new THREE.TubeGeometry(curve, tubeSegs, coreR, 6, false)
      const halo = new THREE.TubeGeometry(curve, tubeSegs, haloR, 6, false)
      return { core, halo, segment }
    })
  }, [strike.segments])

  // Dispose trunk/branch TubeGeometries when the strike unmounts.
  useEffect(() => {
    return () => {
      for (const b of built) {
        if (!b) continue
        b.core.dispose()
        b.halo.dispose()
      }
    }
  }, [built])

  if (phase.phase === 'telegraph') {
    // Caller renders the placement-VFX telegraph at the ground point; nothing
    // to draw here yet.
    return null
  }

  const lifeOpacity = 1 - phase.fade

  return (
    <group>
      {built.map((b, i) => {
        if (!b) return null
        const segReveal = THREE.MathUtils.clamp((phase.reveal - b.segment.startT) / Math.max(0.0001, b.segment.endT - b.segment.startT), 0, 1)
        if (segReveal <= 0) return null
        const intensity = segReveal * lifeOpacity
        const haloOpacity = 0.6 * intensity
        const coreOpacity = Math.min(1, intensity * 0.95)
        return (
          <group key={i}>
            <mesh geometry={b.halo}>
              <meshBasicMaterial color="#aac8ff" transparent opacity={haloOpacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <mesh geometry={b.core}>
              <meshStandardMaterial color="#ffffff" emissive="#e8f4ff" emissiveIntensity={4 * intensity + 1.5} transparent opacity={coreOpacity} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export interface ThunderboltImpact {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export function ThunderboltImpactMesh({ impact }: { impact: ThunderboltImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  const chains = useMemo(() => {
    const rng = mulberry32(impact.seed || 1)
    const count = 7
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + rng() * 0.3
      const len = 2 + rng() * 1
      const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
      const start = new THREE.Vector3(0, 0.04, 0)
      const end = start.clone().addScaledVector(dir, len)
      // Zigzag mid points
      const mid1 = start.clone().lerp(end, 0.33).add(new THREE.Vector3((rng() - 0.5) * 0.6, 0.1 + rng() * 0.15, (rng() - 0.5) * 0.6))
      const mid2 = start.clone().lerp(end, 0.66).add(new THREE.Vector3((rng() - 0.5) * 0.6, 0.05 + rng() * 0.1, (rng() - 0.5) * 0.6))
      const curve = new THREE.CatmullRomCurve3([start, mid1, mid2, end])
      // Allocate the TubeGeometry once at mount instead of every render —
      // this avoids leaking a fresh TubeGeometry per frame * per chain.
      return new THREE.TubeGeometry(curve, 16, 0.018, 5, false)
    })
  }, [impact.seed])

  // Dispose grounding-chain TubeGeometries when the impact mesh unmounts.
  useEffect(() => {
    return () => {
      for (const geom of chains) geom.dispose()
    }
  }, [chains])

  return (
    <group position={impact.position}>
      {/* Central thunder shockwave */}
      <mesh scale={1 + t * 4}>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshBasicMaterial color="#fff5dc" transparent opacity={Math.max(0, 0.85 - t * 1.3)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={0.6 + t * 4}>
        <ringGeometry args={[0.5, 0.7, 36]} />
        <meshBasicMaterial color="#aac8ff" transparent opacity={Math.max(0, 0.75 - t * 1.1)} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Grounding radial chains */}
      {chains.map((tube, i) => (
        <mesh key={i} geometry={tube}>
          <meshBasicMaterial color="#fff5dc" transparent opacity={Math.max(0, 0.85 - t * 1.2)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Screen-flash overlay rendered as an HTML <div>. Mounted at strike-moment. */
export function ThunderboltScreenFlash({ alpha }: { alpha: number }) {
  if (alpha <= 0) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(255, 255, 240, 1)',
        opacity: alpha,
        pointerEvents: 'none',
        zIndex: 80,
        mixBlendMode: 'screen',
      }}
    />
  )
}

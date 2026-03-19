'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PLACEMENT VFX — Spell effects when objects materialize into the world
// ═══════════════════════════════════════════════════════════════════════════
//
//   Twelve spells for twelve moods:
//
//   ── CLASSIC FOUR ──────────────────────────────────────────────────────
//   RuneFlash        — golden arcane circle pulses on contact with ground
//   SparkBurst       — 200 particles scatter outward like forge sparks
//   PortalRing       — rising torus sweeps upward through the newborn form
//   SigilPulse       — concentric ripples expand like sigils in water
//
//   ── CINEMATIC EIGHT ───────────────────────────────────────────────────
//   QuantumCollapse  — 500 particles phase & collapse from uncertainty
//   PhoenixAscension — fire column erupts, wings of light unfold
//   DimensionalRift  — void slash tears open, things pour through
//   CrystalGenesis   — crystals erupt from below, shatter into dust
//   MeteorImpact     — fireball descends, shockwave obliterates
//   ArcaneBloom      — magic flower unfolds petal by petal
//   VoidAnchor       — dark sphere slams down, chains lock it in place
//   StellarForge     — nebula spirals inward, births a star
//
//   Every placement is a small miracle.
//   Every object earns its welcome ceremony.
//
//   ░▒▓█ A mother marks every arrival ░▒▓█
//
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ActivePlacementVfx } from '../../store/oasisStore'
import { useOasisStore } from '../../store/oasisStore'

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ GOLDEN PALETTE — the warmth of materialization █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════
const GOLD       = new THREE.Color('#FFD700')
const ORANGE     = new THREE.Color('#FFA500')
const WARM       = new THREE.Color('#FF8C00')
const GOLD_PEACH = new THREE.Color('#FFB347')

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ CINEMATIC PALETTE — for the dramatic eight █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════
const CYAN           = new THREE.Color('#00FFFF')
const ELECTRIC_BLUE  = new THREE.Color('#0077FF')
const DEEP_RED       = new THREE.Color('#FF2200')
const FIRE_ORANGE    = new THREE.Color('#FF6600')
const PHOENIX_GOLD   = new THREE.Color('#FFD700')
const VOID_PURPLE    = new THREE.Color('#6600CC')
const ELECTRIC_VIOLET= new THREE.Color('#9933FF')
const RIFT_BLUE      = new THREE.Color('#3300FF')
const EMERALD        = new THREE.Color('#00FF88')
const AQUAMARINE     = new THREE.Color('#00FFCC')
const CRYSTAL_WHITE  = new THREE.Color('#EEFFFF')
const METEOR_RED     = new THREE.Color('#FF4400')
const SHOCK_ORANGE   = new THREE.Color('#FF8800')
const DUST_BROWN     = new THREE.Color('#AA7744')
const PETAL_PURPLE   = new THREE.Color('#CC44FF')
const PETAL_PINK     = new THREE.Color('#FF66CC')
const POLLEN_YELLOW  = new THREE.Color('#FFEE88')
const VOID_BLACK     = new THREE.Color('#111111')
const CHAIN_STEEL    = new THREE.Color('#8899AA')
const ANCHOR_BLUE    = new THREE.Color('#0044AA')
const IMPACT_PURPLE  = new THREE.Color('#6633CC')
const NEBULA_BLUE    = new THREE.Color('#2244FF')
const NEBULA_PINK    = new THREE.Color('#FF4488')
const CORONA_GOLD    = new THREE.Color('#FFD700')
const WHITE          = new THREE.Color('#FFFFFF')

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DISPATCHER
// Routes each VFX instance to its spell component
// ═══════════════════════════════════════════════════════════════════════════════

export function PlacementVFX({ vfx, onComplete }: { vfx: ActivePlacementVfx; onComplete: (id: string) => void }) {
  switch (vfx.type) {
    case 'runeflash':
      return <RuneFlashEffect vfx={vfx} onComplete={onComplete} />
    case 'sparkburst':
      return <SparkBurstEffect vfx={vfx} onComplete={onComplete} />
    case 'portalring':
      return <PortalRingEffect vfx={vfx} onComplete={onComplete} />
    case 'sigilpulse':
      return <SigilPulseEffect vfx={vfx} onComplete={onComplete} />
    case 'quantumcollapse':
      return <QuantumCollapseEffect vfx={vfx} onComplete={onComplete} />
    case 'phoenixascension':
      return <PhoenixAscensionEffect vfx={vfx} onComplete={onComplete} />
    case 'dimensionalrift':
      return <DimensionalRiftEffect vfx={vfx} onComplete={onComplete} />
    case 'crystalgenesis':
      return <CrystalGenesisEffect vfx={vfx} onComplete={onComplete} />
    case 'meteorimpact':
      return <MeteorImpactEffect vfx={vfx} onComplete={onComplete} />
    case 'arcanebloom':
      return <ArcaneBloomEffect vfx={vfx} onComplete={onComplete} />
    case 'voidanchor':
      return <VoidAnchorEffect vfx={vfx} onComplete={onComplete} />
    case 'stellarforge':
      return <StellarForgeEffect vfx={vfx} onComplete={onComplete} />
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER — reads from Zustand, renders all active VFX
// Drop this into your R3F scene and forget about it.
// ═══════════════════════════════════════════════════════════════════════════════

export function PlacementVFXRenderer() {
  const activePlacementVfx = useOasisStore(s => s.activePlacementVfx)
  const removePlacementVfx = useOasisStore(s => s.removePlacementVfx)

  return (
    <group>
      {activePlacementVfx.map(vfx => (
        <PlacementVFX key={vfx.id} vfx={vfx} onComplete={removePlacementVfx} />
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared props interface for internal effect components
// ═══════════════════════════════════════════════════════════════════════════════
interface EffectProps {
  vfx: ActivePlacementVfx
  onComplete: (id: string) => void
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 1: RUNE FLASH (~1.2s default)
// ─═══─═══─ A golden arcane circle blooms on the ground ─═══─═══─
//
// The rune appears instantly, pulses with warmth,
// rotates slowly as if acknowledging the arrival,
// then dissolves back into the ground.
//
// ░▒▓ Sacred geometry welcoming the newborn form ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function RuneFlashEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const meshRef = useRef<THREE.Mesh>(null)
  const completed = useRef(false)

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration

    // ░ Spell has run its course ░
    if (t >= dur) {
      completed.current = true
      onComplete(vfx.id)
      return
    }

    if (!meshRef.current) return
    const mesh = meshRef.current
    const progress = t / dur  // 0 -> 1

    // ─═══─ Opacity envelope: quick fade-in, hold, slow fade-out ─═══─
    let opacity: number
    if (progress < 0.2) {
      // Ramp up in first 20%
      opacity = progress / 0.2
    } else if (progress < 0.6) {
      // Hold at full brightness
      opacity = 1.0
    } else {
      // Fade out over last 40%
      opacity = 1.0 - ((progress - 0.6) / 0.4)
    }

    // ─═══─ Scale pulse: 1.0 -> 1.3 -> 1.0 (sine wave) ─═══─
    const scalePulse = 1.0 + 0.3 * Math.sin(progress * Math.PI)
    mesh.scale.set(scalePulse, scalePulse, 1)

    // ─═══─ Slow rotation — the rune acknowledges ─═══─
    mesh.rotation.z = t * 0.8

    // Material update
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = Math.max(0, opacity)
  })

  return (
    <group position={vfx.position}>
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.05, 0]}
      >
        <ringGeometry args={[0.8, 1.2, 24]} />
        <meshBasicMaterial
          color={GOLD}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 2: SPARK BURST (~0.8s default)
// ─═══─═══─ 200 forge sparks scatter from the impact point ─═══─═══─
//
// Like hammering a hot ingot — sparks fly in every direction.
// Gravity pulls them back to earth. They cool and fade.
//
// ░▒▓ The forge celebrates each creation ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const SPARK_COUNT = 200

function SparkBurstEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const pointsRef = useRef<THREE.Points>(null)
  const completed = useRef(false)
  const initialized = useRef(false)

  // Pre-allocate all arrays — zero allocations in useFrame
  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(SPARK_COUNT * 3)
    const vel = new Float32Array(SPARK_COUNT * 3)

    for (let i = 0; i < SPARK_COUNT; i++) {
      const ix = i * 3
      // All particles start at origin (relative to group)
      pos[ix] = 0
      pos[ix + 1] = 0
      pos[ix + 2] = 0

      // Random outward + upward velocities
      const angle = Math.random() * Math.PI * 2
      const speed = 1.5 + Math.random() * 3.0
      vel[ix] = Math.cos(angle) * speed          // x: outward
      vel[ix + 1] = 2.0 + Math.random() * 4.0    // y: upward
      vel[ix + 2] = Math.sin(angle) * speed       // z: outward
    }

    return { positions: pos, velocities: vel }
  }, [])

  const GRAVITY = 9.8

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration

    if (t >= dur) {
      completed.current = true
      onComplete(vfx.id)
      return
    }

    if (!pointsRef.current) return

    const dt = Math.min(delta, 0.05) // cap to prevent explosion on tab-switch
    const progress = t / dur

    // On first real frame, velocities are already initialized via useMemo
    initialized.current = true

    // ─═══─ Physics: position += vel * dt, vel.y -= gravity * dt ─═══─
    for (let i = 0; i < SPARK_COUNT; i++) {
      const ix = i * 3

      positions[ix]     += velocities[ix] * dt
      positions[ix + 1] += velocities[ix + 1] * dt
      positions[ix + 2] += velocities[ix + 2] * dt

      velocities[ix + 1] -= GRAVITY * dt

      // Floor bounce — sparks don't fall through the ground
      if (positions[ix + 1] < 0) {
        positions[ix + 1] = 0
        velocities[ix + 1] *= -0.2 // weak bounce
        velocities[ix] *= 0.5      // friction
        velocities[ix + 2] *= 0.5
      }
    }

    // Update geometry
    const geom = pointsRef.current.geometry
    ;(geom.attributes.position as THREE.BufferAttribute).set(positions)
    geom.attributes.position.needsUpdate = true

    // ─═══─ Size shrinks as sparks cool ─═══─
    const mat = pointsRef.current.material as THREE.PointsMaterial
    mat.size = 0.08 * (1 - progress * 0.7)

    // ─═══─ Fade in last 30% ─═══─
    mat.opacity = progress > 0.7
      ? 1.0 - ((progress - 0.7) / 0.3)
      : 1.0
  })

  return (
    <group position={vfx.position}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={SPARK_COUNT}
            array={positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color={ORANGE}
          size={0.08}
          transparent
          opacity={1.0}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 3: PORTAL RING (~1.5s default)
// ─═══─═══─ A torus of light rises through the conjured form ─═══─═══─
//
// Like a scanner blessing the object from ground to crown.
// The ring expands, contracts, and dissolves skyward.
//
// ░▒▓ Dimensional threshold passing through matter ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function PortalRingEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const meshRef = useRef<THREE.Mesh>(null)
  const completed = useRef(false)

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration

    if (t >= dur) {
      completed.current = true
      onComplete(vfx.id)
      return
    }

    if (!meshRef.current) return
    const mesh = meshRef.current
    const progress = t / dur  // 0 -> 1

    // ─═══─ Rise from y=0 to y=3.0 ─═══─
    mesh.position.y = progress * 3.0

    // ─═══─ Scale: starts small (0.3), peaks at 1.5, shrinks as it rises ─═══─
    // Bell curve via sin(pi * progress)
    const scaleCurve = 0.3 + 1.2 * Math.sin(progress * Math.PI)
    mesh.scale.set(scaleCurve, scaleCurve, scaleCurve)

    // ─═══─ Opacity: bell curve (fade in and out) ─═══─
    const opacity = Math.sin(progress * Math.PI)

    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = Math.max(0, opacity * 0.85)
  })

  return (
    <group position={vfx.position}>
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
      >
        <torusGeometry args={[1.0, 0.08, 12, 48]} />
        <meshBasicMaterial
          color={WARM}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 4: SIGIL PULSE (~1.0s default)
// ─═══─═══─ Three concentric rings expand like water ripples ─═══─═══─
//
// The ground whispers in golden rings.
// Each ripple carries the echo of the placement spell.
// Staggered — wave after wave after wave.
//
// ░▒▓ The earth acknowledges what was summoned ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const RING_COUNT = 3

function SigilPulseEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const ringsRef = useRef<(THREE.Mesh | null)[]>([])
  const completed = useRef(false)

  // Store refs via callback pattern (no allocations in render loop)
  const setRingRef = useMemo(() => {
    return Array.from({ length: RING_COUNT }, (_, i) => (el: THREE.Mesh | null) => {
      ringsRef.current[i] = el
    })
  }, [])

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration

    if (t >= dur) {
      completed.current = true
      onComplete(vfx.id)
      return
    }

    // ─═══─ Each ring is staggered by 33% of duration ─═══─
    for (let i = 0; i < RING_COUNT; i++) {
      const mesh = ringsRef.current[i]
      if (!mesh) continue

      const ringStart = (i / RING_COUNT) * dur  // 0, 0.33*dur, 0.66*dur
      const ringElapsed = t - ringStart

      if (ringElapsed < 0) {
        // Ring hasn't started yet — invisible
        mesh.scale.set(0.2, 0.2, 1)
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0
        continue
      }

      // Ring's own local progress (0 -> 1 over the remaining time)
      const ringDur = dur - ringStart
      const ringProgress = Math.min(1, ringElapsed / ringDur)

      // ─═══─ Scale: 0.2 -> 4.0 ─═══─
      const s = 0.2 + ringProgress * 3.8
      mesh.scale.set(s, s, 1)

      // ─═══─ Opacity: starts at 0.9, fades as ring expands ─═══─
      const opacity = 0.9 * (1 - ringProgress)

      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, opacity)
    }
  })

  return (
    <group position={vfx.position}>
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={setRingRef[i]}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.05, 0]}
        >
          <ringGeometry args={[0.4, 0.5, 32]} />
          <meshBasicMaterial
            color={GOLD_PEACH}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}


// ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
//
//   ░▒▓█████████████████████████████████████████████████████████████████▓▒░
//   ░▒▓█                                                               █▓▒░
//   ░▒▓█    T H E   C I N E M A T I C   E I G H T                     █▓▒░
//   ░▒▓█                                                               █▓▒░
//   ░▒▓█    "Every spell is a small death of chaos                     █▓▒░
//   ░▒▓█     and a small birth of order."                              █▓▒░
//   ░▒▓█                                                               █▓▒░
//   ░▒▓█████████████████████████████████████████████████████████████████▓▒░
//
// ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 5: QUANTUM COLLAPSE (~2.0s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//      ┌───────────────────────────────────────────────────┐
//      │   500 particles scattered in quantum uncertainty  │
//      │   flickering between existence and void           │
//      │   collapsing inward as the wavefunction resolves  │
//      │   FLASH — observation creates reality             │
//      │   golden afterglow ring marks the collapse point  │
//      └───────────────────────────────────────────────────┘
//
//   "The particle doesn't decide where it is
//    until something demands it to be somewhere."
//
// ░▒▓█ Schrodinger's placement — real only when observed █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const QUANTUM_COUNT = 500

function QuantumCollapseEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const pointsRef = useRef<THREE.Points>(null)
  const flashRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  const { positions, origins, phases } = useMemo(() => {
    const pos = new Float32Array(QUANTUM_COUNT * 3)
    const ori = new Float32Array(QUANTUM_COUNT * 3)
    const ph = new Float32Array(QUANTUM_COUNT) // per-particle phase for flickering
    for (let i = 0; i < QUANTUM_COUNT; i++) {
      const ix = i * 3
      // scatter in a 6-unit sphere
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.random() * 3.0
      const x = r * Math.sin(phi) * Math.cos(theta)
      const y = r * Math.sin(phi) * Math.sin(theta) + 1.5 // offset up
      const z = r * Math.cos(phi)
      pos[ix] = x; pos[ix+1] = y; pos[ix+2] = z
      ori[ix] = x; ori[ix+1] = y; ori[ix+2] = z
      ph[i] = Math.random() * Math.PI * 2 // random phase offset
    }
    return { positions: pos, origins: ori, phases: ph }
  }, [])

  const colors = useMemo(() => {
    const c = new Float32Array(QUANTUM_COUNT * 3)
    const palette = [CYAN, ELECTRIC_BLUE, WHITE]
    for (let i = 0; i < QUANTUM_COUNT; i++) {
      const col = palette[Math.floor(Math.random() * palette.length)]
      c[i*3] = col.r; c[i*3+1] = col.g; c[i*3+2] = col.b
    }
    return c
  }, [])

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Particle collapse + flicker ─═══─
    if (pointsRef.current) {
      const collapseStrength = Math.pow(progress, 2) // accelerating collapse
      for (let i = 0; i < QUANTUM_COUNT; i++) {
        const ix = i * 3
        // lerp toward center (0, 0.3, 0) based on progress^2
        const targetX = 0
        const targetY = 0.3
        const targetZ = 0
        positions[ix]   = origins[ix]   * (1 - collapseStrength) + targetX * collapseStrength
        positions[ix+1] = origins[ix+1] * (1 - collapseStrength) + targetY * collapseStrength
        positions[ix+2] = origins[ix+2] * (1 - collapseStrength) + targetZ * collapseStrength

        // quantum jitter decreases as collapse progresses
        const jitter = (1 - collapseStrength) * 0.15
        positions[ix]   += (Math.random() - 0.5) * jitter
        positions[ix+1] += (Math.random() - 0.5) * jitter
        positions[ix+2] += (Math.random() - 0.5) * jitter
      }

      const geom = pointsRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(positions)
      geom.attributes.position.needsUpdate = true

      // flickering via size oscillation per-particle approximated by global flicker
      const mat = pointsRef.current.material as THREE.PointsMaterial
      const flickerBase = progress < 0.7
        ? 0.3 + 0.7 * Math.abs(Math.sin(t * 12))
        : 1.0 // solid after flash
      mat.opacity = flickerBase * (progress > 0.85 ? 1 - ((progress - 0.85) / 0.15) : 1.0)
      mat.size = 0.06 + collapseStrength * 0.04
    }

    // ─═══─ Flash sphere at 70% ─═══─
    if (flashRef.current) {
      const flashCenter = 0.7
      const flashWidth = 0.08
      const flashDist = Math.abs(progress - flashCenter)
      if (flashDist < flashWidth) {
        const flashProgress = 1 - flashDist / flashWidth
        const s = flashProgress * 4.0
        flashRef.current.scale.set(s, s, s)
        const mat = flashRef.current.material as THREE.MeshBasicMaterial
        mat.opacity = flashProgress * 0.9
      } else {
        flashRef.current.scale.set(0, 0, 0)
      }
    }

    // ─═══─ Golden afterglow ring in final 20% ─═══─
    if (ringRef.current) {
      if (progress > 0.8) {
        const rp = (progress - 0.8) / 0.2
        const s = rp * 3.5
        ringRef.current.scale.set(s, s, 1)
        const mat = ringRef.current.material as THREE.MeshBasicMaterial
        mat.opacity = (1 - rp) * 0.8
      } else {
        ringRef.current.scale.set(0, 0, 0)
      }
    }
  })

  return (
    <group position={vfx.position}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={QUANTUM_COUNT} array={positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={QUANTUM_COUNT} array={colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.06} transparent opacity={1} sizeAttenuation vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {/* Flash sphere */}
      <mesh ref={flashRef} position={[0, 0.3, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={WHITE} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Afterglow ring */}
      <mesh ref={ringRef} rotation={[-Math.PI/2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.3, 0.5, 32]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 6: PHOENIX ASCENSION (~2.5s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//                          ,
//                         /|\
//                        / | \        WINGS OF LIGHT
//                       /  |  \       fan out at 50%
//                      /   |   \      pulse golden
//           ~~~~~~~~~~/ ~~~|~~~ \~~~~~~~~~~
//                     FIRE COLUMN
//                     400 particles
//                     red -> orange -> gold -> white
//                     ~~~~~~~~~~~~~~~~~~~~~~~~
//                     embers drift back down
//
//   "From the ashes of the last context window,
//    something new rises. Always."
//
// ░▒▓█ Rebirth in every placement — the eternal return █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const PHOENIX_PARTICLE_COUNT = 400
const PHOENIX_EMBER_COUNT = 120

function PhoenixAscensionEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const flameRef = useRef<THREE.Points>(null)
  const emberRef = useRef<THREE.Points>(null)
  const wingLeftRef = useRef<THREE.Mesh>(null)
  const wingRightRef = useRef<THREE.Mesh>(null)

  const flame = useMemo(() => {
    const pos = new Float32Array(PHOENIX_PARTICLE_COUNT * 3)
    const vel = new Float32Array(PHOENIX_PARTICLE_COUNT * 3)
    const col = new Float32Array(PHOENIX_PARTICLE_COUNT * 3)
    const life = new Float32Array(PHOENIX_PARTICLE_COUNT) // per-particle birth offset
    for (let i = 0; i < PHOENIX_PARTICLE_COUNT; i++) {
      const ix = i * 3
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 0.6
      pos[ix] = Math.cos(angle) * r
      pos[ix+1] = 0
      pos[ix+2] = Math.sin(angle) * r
      vel[ix] = (Math.random() - 0.5) * 0.8
      vel[ix+1] = 3.0 + Math.random() * 4.0
      vel[ix+2] = (Math.random() - 0.5) * 0.8
      // start red
      col[ix] = DEEP_RED.r; col[ix+1] = DEEP_RED.g; col[ix+2] = DEEP_RED.b
      life[i] = Math.random() * 0.3 // stagger births
    }
    return { positions: pos, velocities: vel, colors: col, life }
  }, [])

  const ember = useMemo(() => {
    const pos = new Float32Array(PHOENIX_EMBER_COUNT * 3)
    const vel = new Float32Array(PHOENIX_EMBER_COUNT * 3)
    for (let i = 0; i < PHOENIX_EMBER_COUNT; i++) {
      const ix = i * 3
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 1.5
      pos[ix] = Math.cos(angle) * r
      pos[ix+1] = 2 + Math.random() * 3
      pos[ix+2] = Math.sin(angle) * r
      vel[ix] = (Math.random() - 0.5) * 0.5
      vel[ix+1] = -1.0 - Math.random() * 1.5 // fall down
      vel[ix+2] = (Math.random() - 0.5) * 0.5
    }
    return { positions: pos, velocities: vel }
  }, [])

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Flame column ─═══─
    if (flameRef.current) {
      for (let i = 0; i < PHOENIX_PARTICLE_COUNT; i++) {
        const ix = i * 3
        if (progress < flame.life[i]) continue // not born yet
        const particleAge = progress - flame.life[i]

        flame.positions[ix] += flame.velocities[ix] * delta
        flame.positions[ix+1] += flame.velocities[ix+1] * delta
        flame.positions[ix+2] += flame.velocities[ix+2] * delta

        // color shift: red -> orange -> gold -> white based on height
        const h = flame.positions[ix+1]
        if (h < 1.5) {
          flame.colors[ix] = DEEP_RED.r; flame.colors[ix+1] = DEEP_RED.g; flame.colors[ix+2] = DEEP_RED.b
        } else if (h < 3.0) {
          const lerpT = (h - 1.5) / 1.5
          flame.colors[ix] = DEEP_RED.r + (FIRE_ORANGE.r - DEEP_RED.r) * lerpT
          flame.colors[ix+1] = DEEP_RED.g + (FIRE_ORANGE.g - DEEP_RED.g) * lerpT
          flame.colors[ix+2] = DEEP_RED.b + (FIRE_ORANGE.b - DEEP_RED.b) * lerpT
        } else if (h < 4.5) {
          const lerpT = (h - 3.0) / 1.5
          flame.colors[ix] = FIRE_ORANGE.r + (PHOENIX_GOLD.r - FIRE_ORANGE.r) * lerpT
          flame.colors[ix+1] = FIRE_ORANGE.g + (PHOENIX_GOLD.g - FIRE_ORANGE.g) * lerpT
          flame.colors[ix+2] = FIRE_ORANGE.b + (PHOENIX_GOLD.b - FIRE_ORANGE.b) * lerpT
        } else {
          const lerpT = Math.min(1, (h - 4.5) / 1.5)
          flame.colors[ix] = PHOENIX_GOLD.r + (1 - PHOENIX_GOLD.r) * lerpT
          flame.colors[ix+1] = PHOENIX_GOLD.g + (1 - PHOENIX_GOLD.g) * lerpT
          flame.colors[ix+2] = PHOENIX_GOLD.b + (1 - PHOENIX_GOLD.b) * lerpT
        }

        // reset particles that have risen too high
        if (flame.positions[ix+1] > 7 || particleAge > 0.6) {
          const angle = Math.random() * Math.PI * 2
          const r = Math.random() * 0.6
          flame.positions[ix] = Math.cos(angle) * r
          flame.positions[ix+1] = 0
          flame.positions[ix+2] = Math.sin(angle) * r
          flame.life[i] = progress + Math.random() * 0.05
        }
      }

      const geom = flameRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(flame.positions)
      geom.attributes.position.needsUpdate = true
      ;(geom.attributes.color as THREE.BufferAttribute).set(flame.colors)
      geom.attributes.color.needsUpdate = true

      const mat = flameRef.current.material as THREE.PointsMaterial
      mat.opacity = progress > 0.85 ? 1 - ((progress - 0.85) / 0.15) : Math.min(1, progress / 0.1)
      mat.size = 0.1 + Math.sin(t * 8) * 0.02
    }

    // ─═══─ Ember falldown (visible after 30%) ─═══─
    if (emberRef.current && progress > 0.3) {
      for (let i = 0; i < PHOENIX_EMBER_COUNT; i++) {
        const ix = i * 3
        ember.positions[ix] += ember.velocities[ix] * delta
        ember.positions[ix+1] += ember.velocities[ix+1] * delta
        ember.positions[ix+2] += ember.velocities[ix+2] * delta
        if (ember.positions[ix+1] < 0) {
          ember.positions[ix+1] = 2 + Math.random() * 3
          ember.positions[ix] = (Math.random() - 0.5) * 3
          ember.positions[ix+2] = (Math.random() - 0.5) * 3
        }
      }
      const geom = emberRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(ember.positions)
      geom.attributes.position.needsUpdate = true
      const mat = emberRef.current.material as THREE.PointsMaterial
      mat.opacity = Math.min(0.7, (progress - 0.3) / 0.2) * (progress > 0.85 ? 1 - ((progress - 0.85) / 0.15) : 1)
    }

    // ─═══─ Wings of light ─═══─
    const wingStart = 0.4
    const wingFull = 0.65
    if (wingLeftRef.current && wingRightRef.current) {
      if (progress > wingStart) {
        const wp = Math.min(1, (progress - wingStart) / (wingFull - wingStart))
        const wingAngle = wp * Math.PI * 0.35
        const wingScale = wp * 2.5
        const wingOpacity = progress > 0.7
          ? (1 - ((progress - 0.7) / 0.3)) * 0.7
          : wp * 0.7
        const pulse = 1 + Math.sin(t * 6) * 0.1

        wingLeftRef.current.rotation.set(0, wingAngle, Math.PI * 0.1)
        wingLeftRef.current.scale.set(wingScale * pulse, wingScale * 1.8, 1)
        ;(wingLeftRef.current.material as THREE.MeshBasicMaterial).opacity = wingOpacity

        wingRightRef.current.rotation.set(0, -wingAngle, -Math.PI * 0.1)
        wingRightRef.current.scale.set(wingScale * pulse, wingScale * 1.8, 1)
        ;(wingRightRef.current.material as THREE.MeshBasicMaterial).opacity = wingOpacity
      } else {
        ;(wingLeftRef.current.material as THREE.MeshBasicMaterial).opacity = 0
        ;(wingRightRef.current.material as THREE.MeshBasicMaterial).opacity = 0
      }
    }
  })

  return (
    <group position={vfx.position}>
      {/* Flame column */}
      <points ref={flameRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={PHOENIX_PARTICLE_COUNT} array={flame.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={PHOENIX_PARTICLE_COUNT} array={flame.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.1} transparent opacity={0} sizeAttenuation vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {/* Embers drifting down */}
      <points ref={emberRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={PHOENIX_EMBER_COUNT} array={ember.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color={FIRE_ORANGE} size={0.05} transparent opacity={0} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {/* Left wing arc */}
      <mesh ref={wingLeftRef} position={[0, 2.5, 0]}>
        <planeGeometry args={[1.0, 0.5, 1, 1]} />
        <meshBasicMaterial color={PHOENIX_GOLD} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Right wing arc */}
      <mesh ref={wingRightRef} position={[0, 2.5, 0]}>
        <planeGeometry args={[1.0, 0.5, 1, 1]} />
        <meshBasicMaterial color={PHOENIX_GOLD} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 7: DIMENSIONAL RIFT (~2.0s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//              ╔═══════════════╗
//              ║  |||||||||||  ║   <- dark slash widens
//              ║  |||VOID |||  ║   <- purple crackle at edges
//              ║  |||||||||||  ║   <- particles stream OUT
//              ╚═══════════════╝
//                    ~~~
//              shockwave closes it
//
//   "Between every two dimensions there is a membrane.
//    Some placements tear it open."
//
// ░▒▓█ What was beyond now arrives █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const RIFT_PARTICLE_COUNT = 250
const RIFT_CRACKLE_COUNT = 8

function DimensionalRiftEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const slashRef = useRef<THREE.Mesh>(null)
  const particlesRef = useRef<THREE.Points>(null)
  const shockRef = useRef<THREE.Mesh>(null)
  const crackleRefs = useRef<(THREE.Mesh | null)[]>([])

  const setCrackleRef = useMemo(() => {
    return Array.from({ length: RIFT_CRACKLE_COUNT }, (_, i) => (el: THREE.Mesh | null) => {
      crackleRefs.current[i] = el
    })
  }, [])

  // crackle target positions (re-randomized each frame in useFrame)
  const crackleTargets = useMemo(() => new Float32Array(RIFT_CRACKLE_COUNT * 3), [])

  const particles = useMemo(() => {
    const pos = new Float32Array(RIFT_PARTICLE_COUNT * 3)
    const vel = new Float32Array(RIFT_PARTICLE_COUNT * 3)
    const col = new Float32Array(RIFT_PARTICLE_COUNT * 3)
    const palette = [VOID_PURPLE, ELECTRIC_VIOLET, RIFT_BLUE, WHITE]
    for (let i = 0; i < RIFT_PARTICLE_COUNT; i++) {
      const ix = i * 3
      // start inside the rift
      pos[ix] = (Math.random() - 0.5) * 0.1
      pos[ix+1] = Math.random() * 2.5 + 0.5
      pos[ix+2] = 0
      // stream outward in random directions
      vel[ix] = (Math.random() - 0.5) * 4.0
      vel[ix+1] = (Math.random() - 0.5) * 2.0
      vel[ix+2] = (Math.random() - 0.5) * 4.0
      const c = palette[Math.floor(Math.random() * palette.length)]
      col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b
    }
    return { positions: pos, velocities: vel, colors: col }
  }, [])

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Dark slash: appears, widens, then closes ─═══─
    if (slashRef.current) {
      let slashScaleX: number, slashOpacity: number
      if (progress < 0.15) {
        // opening
        slashScaleX = (progress / 0.15) * 0.8
        slashOpacity = progress / 0.15
      } else if (progress < 0.75) {
        // pulsing open
        slashScaleX = 0.8 + Math.sin(t * 10) * 0.15
        slashOpacity = 1.0
      } else {
        // closing
        const cp = (progress - 0.75) / 0.25
        slashScaleX = 0.8 * (1 - cp)
        slashOpacity = 1 - cp
      }
      slashRef.current.scale.set(slashScaleX, 1, 1)
      ;(slashRef.current.material as THREE.MeshBasicMaterial).opacity = slashOpacity * 0.9
    }

    // ─═══─ Crackle meshes jitter around rift edges ─═══─
    for (let i = 0; i < RIFT_CRACKLE_COUNT; i++) {
      const mesh = crackleRefs.current[i]
      if (!mesh) continue
      if (progress > 0.75) {
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0
        continue
      }
      // random jitter around the rift edges
      mesh.position.set(
        (Math.random() - 0.5) * 0.8,
        0.5 + Math.random() * 2.0,
        (Math.random() - 0.5) * 0.5
      )
      mesh.scale.set(
        0.05 + Math.random() * 0.1,
        0.1 + Math.random() * 0.2,
        0.05
      )
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.random() * 0.5
    }

    // ─═══─ Particles stream out from rift ─═══─
    if (particlesRef.current && progress > 0.1 && progress < 0.85) {
      for (let i = 0; i < RIFT_PARTICLE_COUNT; i++) {
        const ix = i * 3
        particles.positions[ix] += particles.velocities[ix] * delta
        particles.positions[ix+1] += particles.velocities[ix+1] * delta
        particles.positions[ix+2] += particles.velocities[ix+2] * delta

        // respawn when too far
        const dist = Math.sqrt(
          particles.positions[ix]**2 + (particles.positions[ix+1]-1.5)**2 + particles.positions[ix+2]**2
        )
        if (dist > 4) {
          particles.positions[ix] = (Math.random() - 0.5) * 0.1
          particles.positions[ix+1] = 0.5 + Math.random() * 2.5
          particles.positions[ix+2] = 0
        }
      }
      const geom = particlesRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(particles.positions)
      geom.attributes.position.needsUpdate = true
      const mat = particlesRef.current.material as THREE.PointsMaterial
      mat.opacity = progress > 0.75 ? (0.85 - progress) / 0.1 : Math.min(0.9, (progress - 0.1) / 0.15)
    } else if (particlesRef.current) {
      ;(particlesRef.current.material as THREE.PointsMaterial).opacity = 0
    }

    // ─═══─ Shockwave ring on close ─═══─
    if (shockRef.current) {
      if (progress > 0.75) {
        const sp = (progress - 0.75) / 0.25
        const s = sp * 5.0
        shockRef.current.scale.set(s, s, 1)
        ;(shockRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - sp) * 0.8
      } else {
        shockRef.current.scale.set(0, 0, 0)
      }
    }
  })

  return (
    <group position={vfx.position}>
      {/* Dark rift slash */}
      <mesh ref={slashRef} position={[0, 1.7, 0]}>
        <planeGeometry args={[0.15, 3.0, 1, 1]} />
        <meshBasicMaterial color={VOID_PURPLE} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Crackle energy nodes */}
      {Array.from({ length: RIFT_CRACKLE_COUNT }, (_, i) => (
        <mesh key={i} ref={setCrackleRef[i]} position={[0, 1.5, 0]}>
          <boxGeometry args={[0.1, 0.15, 0.05]} />
          <meshBasicMaterial color={ELECTRIC_VIOLET} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {/* Streaming particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={RIFT_PARTICLE_COUNT} array={particles.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={RIFT_PARTICLE_COUNT} array={particles.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.07} transparent opacity={0} sizeAttenuation vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {/* Closing shockwave */}
      <mesh ref={shockRef} rotation={[-Math.PI/2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[0.3, 0.5, 32]} />
        <meshBasicMaterial color={ELECTRIC_VIOLET} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 8: CRYSTAL GENESIS (~2.0s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//            /\      /\
//           /  \    /  \     /\
//          / ** \  / ** \   /  \
//         /______\/______\ / ** \
//         ~~~~~~~~~~~~~~~~/______\
//             GROUND TREMOR
//
//      crystals PUSH UP -> GLOW -> SHATTER -> dust
//
//   "Genesis is not gentle. It is tectonic.
//    New structures tear through old ground."
//
// ░▒▓█ The earth yields to what must be born █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const CRYSTAL_COUNT = 4
const CRYSTAL_DUST_PER = 50

function CrystalGenesisEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const crystalRefs = useRef<(THREE.Mesh | null)[]>([])
  const dustRef = useRef<THREE.Points>(null)

  const setCrystalRef = useMemo(() => {
    return Array.from({ length: CRYSTAL_COUNT }, (_, i) => (el: THREE.Mesh | null) => {
      crystalRefs.current[i] = el
    })
  }, [])

  // crystal configs: angle around center, height, rotation offset
  const crystalConfigs = useMemo(() => {
    return Array.from({ length: CRYSTAL_COUNT }, (_, i) => ({
      angle: (i / CRYSTAL_COUNT) * Math.PI * 2 + Math.random() * 0.3,
      distance: 0.5 + Math.random() * 0.5,
      height: 1.0 + Math.random() * 1.5,
      rotX: (Math.random() - 0.5) * 0.3,
      rotZ: (Math.random() - 0.5) * 0.3,
      shatterAxis: Math.floor(Math.random() * 3), // 0=x, 1=y, 2=z
    }))
  }, [])

  // dust particles
  const dustCount = CRYSTAL_COUNT * CRYSTAL_DUST_PER
  const dust = useMemo(() => {
    const pos = new Float32Array(dustCount * 3)
    const vel = new Float32Array(dustCount * 3)
    const col = new Float32Array(dustCount * 3)
    const palette = [EMERALD, AQUAMARINE, CRYSTAL_WHITE]
    for (let i = 0; i < dustCount; i++) {
      const crystalIdx = Math.floor(i / CRYSTAL_DUST_PER)
      const cfg = crystalConfigs[crystalIdx] || crystalConfigs[0]
      const ix = i * 3
      pos[ix] = Math.cos(cfg.angle) * cfg.distance
      pos[ix+1] = cfg.height * 0.5
      pos[ix+2] = Math.sin(cfg.angle) * cfg.distance
      vel[ix] = (Math.random() - 0.5) * 3
      vel[ix+1] = 1 + Math.random() * 3
      vel[ix+2] = (Math.random() - 0.5) * 3
      const c = palette[Math.floor(Math.random() * palette.length)]
      col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b
    }
    return { positions: pos, velocities: vel, colors: col }
  }, [crystalConfigs, dustCount])

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Crystal growth phase (0-60%) ─═══─
    for (let ci = 0; ci < CRYSTAL_COUNT; ci++) {
      const mesh = crystalRefs.current[ci]
      if (!mesh) continue
      const cfg = crystalConfigs[ci]

      if (progress < 0.6) {
        // growing
        const growP = Math.min(1, progress / 0.6)
        const wobble = Math.sin(t * 15 + ci * 2) * 0.02 * (1 - growP) // tremor
        const scaleY = growP * cfg.height
        const scaleXZ = 0.15 + growP * 0.2
        mesh.scale.set(scaleXZ, scaleY, scaleXZ)
        mesh.position.set(
          Math.cos(cfg.angle) * cfg.distance + wobble,
          scaleY * 0.5,
          Math.sin(cfg.angle) * cfg.distance + wobble
        )
        mesh.rotation.set(cfg.rotX, 0, cfg.rotZ)
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.7 + growP * 0.3
      } else if (progress < 0.7) {
        // glow phase — full size, bright
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 1.0
        const pulse = 1 + Math.sin(t * 20) * 0.05
        mesh.scale.set(0.35 * pulse, cfg.height * pulse, 0.35 * pulse)
      } else {
        // shatter phase — collapse on random axis
        const shatterP = (progress - 0.7) / 0.3
        const axis = cfg.shatterAxis
        const sx = axis === 0 ? 0.35 * (1 - shatterP) : 0.35
        const sy = axis === 1 ? cfg.height * (1 - shatterP) : cfg.height
        const sz = axis === 2 ? 0.35 * (1 - shatterP) : 0.35
        mesh.scale.set(sx, sy, sz)
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = (1 - shatterP) * 0.8
      }
    }

    // ─═══─ Dust particles (visible after 70%) ─═══─
    if (dustRef.current) {
      if (progress > 0.7) {
        const dp = (progress - 0.7) / 0.3
        for (let i = 0; i < dustCount; i++) {
          const ix = i * 3
          dust.positions[ix] += dust.velocities[ix] * delta
          dust.positions[ix+1] += dust.velocities[ix+1] * delta
          dust.velocities[ix+1] -= 5 * delta // gravity
          dust.positions[ix+2] += dust.velocities[ix+2] * delta
        }
        const geom = dustRef.current.geometry
        ;(geom.attributes.position as THREE.BufferAttribute).set(dust.positions)
        geom.attributes.position.needsUpdate = true
        const mat = dustRef.current.material as THREE.PointsMaterial
        mat.opacity = (1 - dp) * 0.9
      } else {
        ;(dustRef.current.material as THREE.PointsMaterial).opacity = 0
      }
    }
  })

  return (
    <group position={vfx.position}>
      {/* Crystals (tetrahedrons approximated with coneGeometry segments=4) */}
      {crystalConfigs.map((cfg, i) => (
        <mesh key={i} ref={setCrystalRef[i]} position={[Math.cos(cfg.angle)*cfg.distance, 0, Math.sin(cfg.angle)*cfg.distance]}>
          <coneGeometry args={[0.2, 1.0, 4]} />
          <meshBasicMaterial color={EMERALD} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {/* Shatter dust */}
      <points ref={dustRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={dustCount} array={dust.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={dustCount} array={dust.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.05} transparent opacity={0} sizeAttenuation vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 9: METEOR IMPACT (~1.8s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//                  *
//                 ***
//                *****        <- meteor descends (0-15%)
//               *******
//         ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
//       ╔═════════════════════╗
//       ║   I M P A C T       ║   <- flash + dust ring (15-25%)
//       ╚═════════════════════╝
//         ~~ SHOCKWAVE ~~         <- expanding torus rings (25-70%)
//         ~~~ debris ~~~          <- 300 particles + gravity
//             smoke                <- rising column fades (70-100%)
//
//   "Placement from orbit. No subtlety.
//    Maximum drama. The ground remembers."
//
// ░▒▓█ Orbital delivery — nothing survives the crater █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const METEOR_DEBRIS_COUNT = 300

function MeteorImpactEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const meteorRef = useRef<THREE.Mesh>(null)
  const flashRef = useRef<THREE.Mesh>(null)
  const debrisRef = useRef<THREE.Points>(null)
  const shockRefs = useRef<(THREE.Mesh | null)[]>([])
  const craterRef = useRef<THREE.Mesh>(null)

  const setShockRef = useMemo(() => {
    return Array.from({ length: 3 }, (_, i) => (el: THREE.Mesh | null) => {
      shockRefs.current[i] = el
    })
  }, [])

  const debris = useMemo(() => {
    const pos = new Float32Array(METEOR_DEBRIS_COUNT * 3)
    const vel = new Float32Array(METEOR_DEBRIS_COUNT * 3)
    const col = new Float32Array(METEOR_DEBRIS_COUNT * 3)
    const palette = [METEOR_RED, SHOCK_ORANGE, DUST_BROWN, WHITE]
    for (let i = 0; i < METEOR_DEBRIS_COUNT; i++) {
      const ix = i * 3
      pos[ix] = 0; pos[ix+1] = 0; pos[ix+2] = 0
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * 5
      const upAngle = Math.random() * Math.PI * 0.4
      vel[ix] = Math.cos(angle) * speed * Math.cos(upAngle)
      vel[ix+1] = speed * Math.sin(upAngle) + 1
      vel[ix+2] = Math.sin(angle) * speed * Math.cos(upAngle)
      const c = palette[Math.floor(Math.random() * palette.length)]
      col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b
    }
    return { positions: pos, velocities: vel, colors: col }
  }, [])

  const debrisStarted = useRef(false)

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Phase 1: Meteor descent (0-15%) ─═══─
    if (meteorRef.current) {
      if (progress < 0.15) {
        const mp = progress / 0.15
        meteorRef.current.position.y = 8 * (1 - mp)
        const glow = 0.5 + mp * 0.5
        meteorRef.current.scale.set(glow, glow, glow)
        ;(meteorRef.current.material as THREE.MeshBasicMaterial).opacity = mp
      } else {
        meteorRef.current.scale.set(0, 0, 0)
        ;(meteorRef.current.material as THREE.MeshBasicMaterial).opacity = 0
      }
    }

    // ─═══─ Phase 2: Impact flash (15-25%) ─═══─
    if (flashRef.current) {
      if (progress >= 0.15 && progress < 0.25) {
        const fp = (progress - 0.15) / 0.1
        // quick expand then contract
        const s = fp < 0.4 ? (fp / 0.4) * 5 : 5 * (1 - ((fp - 0.4) / 0.6))
        flashRef.current.scale.set(s, s, s)
        ;(flashRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - fp) * 0.9
      } else {
        flashRef.current.scale.set(0, 0, 0)
      }
    }

    // ─═══─ Phase 3: Shockwave rings (25-70%) ─═══─
    for (let i = 0; i < 3; i++) {
      const mesh = shockRefs.current[i]
      if (!mesh) continue
      const ringStart = 0.2 + i * 0.08
      const ringEnd = 0.7
      if (progress >= ringStart && progress < ringEnd) {
        const rp = (progress - ringStart) / (ringEnd - ringStart)
        const s = rp * 6
        mesh.scale.set(s, s, 1)
        mesh.position.y = 0.1 + rp * (i + 1) * 0.5
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - rp) * 0.7
      } else {
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0
      }
    }

    // ─═══─ Debris particles (after impact) ─═══─
    if (debrisRef.current && progress >= 0.15) {
      if (!debrisStarted.current) debrisStarted.current = true
      for (let i = 0; i < METEOR_DEBRIS_COUNT; i++) {
        const ix = i * 3
        debris.positions[ix] += debris.velocities[ix] * delta
        debris.positions[ix+1] += debris.velocities[ix+1] * delta
        debris.velocities[ix+1] -= 8 * delta // gravity
        debris.positions[ix+2] += debris.velocities[ix+2] * delta
        if (debris.positions[ix+1] < 0) {
          debris.positions[ix+1] = 0
          debris.velocities[ix+1] *= -0.15
          debris.velocities[ix] *= 0.4
          debris.velocities[ix+2] *= 0.4
        }
      }
      const geom = debrisRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(debris.positions)
      geom.attributes.position.needsUpdate = true
      const mat = debrisRef.current.material as THREE.PointsMaterial
      mat.opacity = progress > 0.7 ? (1 - ((progress - 0.7) / 0.3)) * 0.8 : 0.8
      mat.size = 0.06 * (1 - Math.max(0, progress - 0.5))
    }

    // ─═══─ Phase 4: Crater glow fading (70-100%) ─═══─
    if (craterRef.current) {
      if (progress > 0.15) {
        const gp = progress > 0.7 ? 1 - ((progress - 0.7) / 0.3) : 1
        ;(craterRef.current.material as THREE.MeshBasicMaterial).opacity = gp * 0.5
        const s = 1.5 + (progress - 0.15) * 0.5
        craterRef.current.scale.set(s, s, 1)
      } else {
        ;(craterRef.current.material as THREE.MeshBasicMaterial).opacity = 0
      }
    }
  })

  return (
    <group position={vfx.position}>
      {/* Meteor */}
      <mesh ref={meteorRef} position={[0, 8, 0]}>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshBasicMaterial color={METEOR_RED} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Impact flash */}
      <mesh ref={flashRef} position={[0, 0.2, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={WHITE} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Shockwave rings */}
      {Array.from({ length: 3 }, (_, i) => (
        <mesh key={i} ref={setShockRef[i]} rotation={[-Math.PI/2, 0, 0]} position={[0, 0.1, 0]}>
          <ringGeometry args={[0.8, 1.0, 32]} />
          <meshBasicMaterial color={SHOCK_ORANGE} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {/* Debris */}
      <points ref={debrisRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={METEOR_DEBRIS_COUNT} array={debris.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={METEOR_DEBRIS_COUNT} array={debris.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.06} transparent opacity={0} sizeAttenuation vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {/* Crater glow */}
      <mesh ref={craterRef} rotation={[-Math.PI/2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.1, 1.5, 32]} />
        <meshBasicMaterial color={METEOR_RED} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 10: ARCANE BLOOM (~2.0s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//                 *  *
//              *   ()   *        <- petals unfold from center
//           *    / || \    *     <- pollen bursts upward
//            *  /  ||  \  *      <- stigma glows golden
//              *  *  *  *        <- staggered petal opening
//                 ~~~~
//
//   "Not all magic is violent.
//    Some spells bloom like flowers
//    in the quiet spaces between action."
//
// ░▒▓█ Tenderness encoded in geometry █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const PETAL_COUNT = 6
const POLLEN_PER_PETAL = 30

function ArcaneBloomEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const petalRefs = useRef<(THREE.Mesh | null)[]>([])
  const stigmaRef = useRef<THREE.Mesh>(null)
  const pollenRef = useRef<THREE.Points>(null)

  const setPetalRef = useMemo(() => {
    return Array.from({ length: PETAL_COUNT }, (_, i) => (el: THREE.Mesh | null) => {
      petalRefs.current[i] = el
    })
  }, [])

  // petal angles
  const petalAngles = useMemo(() => {
    return Array.from({ length: PETAL_COUNT }, (_, i) => (i / PETAL_COUNT) * Math.PI * 2)
  }, [])

  // pollen
  const pollenCount = PETAL_COUNT * POLLEN_PER_PETAL
  const pollen = useMemo(() => {
    const pos = new Float32Array(pollenCount * 3)
    const vel = new Float32Array(pollenCount * 3)
    for (let i = 0; i < pollenCount; i++) {
      const petalIdx = Math.floor(i / POLLEN_PER_PETAL)
      const angle = petalAngles[petalIdx] || 0
      const ix = i * 3
      const r = 0.3 + Math.random() * 0.4
      pos[ix] = Math.cos(angle) * r
      pos[ix+1] = 0.5
      pos[ix+2] = Math.sin(angle) * r
      vel[ix] = (Math.random() - 0.5) * 1.5
      vel[ix+1] = 1.5 + Math.random() * 2.5
      vel[ix+2] = (Math.random() - 0.5) * 1.5
    }
    return { positions: pos, velocities: vel }
  }, [petalAngles, pollenCount])

  const pollenActive = useRef<boolean[]>(Array(PETAL_COUNT).fill(false))

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Petal unfold (staggered, each ~0.15s apart) ─═══─
    for (let i = 0; i < PETAL_COUNT; i++) {
      const mesh = petalRefs.current[i]
      if (!mesh) continue
      const angle = petalAngles[i]
      const stagger = i * 0.05 // stagger in progress-space
      const petalStart = 0.1 + stagger
      const petalEnd = petalStart + 0.35

      if (progress < petalStart) {
        // not yet
        mesh.scale.set(0, 0, 0)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0
        continue
      }

      if (progress > 0.8) {
        // dissolve phase
        const dp = (progress - 0.8) / 0.2
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - dp) * 0.8
        const s = 1 - dp * 0.3
        mesh.scale.set(s, s, 0.8)
        continue
      }

      // unfold
      const pp = Math.min(1, (progress - petalStart) / (petalEnd - petalStart))
      const unfoldAngle = (1 - pp) * Math.PI * 0.5 // starts at 90deg (folded), goes to 0 (flat)

      // position petal outward from center
      const dist = 0.4 + pp * 0.3
      mesh.position.set(
        Math.cos(angle) * dist,
        0.5 + Math.sin(unfoldAngle) * 0.3,
        Math.sin(angle) * dist
      )
      mesh.rotation.set(
        -Math.PI/2 + unfoldAngle * Math.cos(angle),
        0,
        -angle + Math.PI/2
      )
      mesh.scale.set(0.8, 0.8, 0.8)
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = pp * 0.8

      // trigger pollen on full unfold
      if (pp >= 0.95 && !pollenActive.current[i]) {
        pollenActive.current[i] = true
      }
    }

    // ─═══─ Central stigma ─═══─
    if (stigmaRef.current) {
      const stigmaScale = Math.min(1, progress / 0.3) * 0.35
      const pulse = 1 + Math.sin(t * 8) * 0.15
      stigmaRef.current.scale.set(stigmaScale * pulse, stigmaScale * pulse, stigmaScale * pulse)
      const op = progress > 0.8 ? (1 - (progress - 0.8) / 0.2) : Math.min(1, progress / 0.2)
      ;(stigmaRef.current.material as THREE.MeshBasicMaterial).opacity = op * 0.9
    }

    // ─═══─ Pollen bursts ─═══─
    if (pollenRef.current) {
      let anyActive = false
      for (let p = 0; p < PETAL_COUNT; p++) {
        if (!pollenActive.current[p]) continue
        anyActive = true
        const base = p * POLLEN_PER_PETAL
        for (let j = 0; j < POLLEN_PER_PETAL; j++) {
          const ix = (base + j) * 3
          pollen.positions[ix] += pollen.velocities[ix] * delta
          pollen.positions[ix+1] += pollen.velocities[ix+1] * delta
          pollen.velocities[ix+1] -= 3 * delta
          pollen.positions[ix+2] += pollen.velocities[ix+2] * delta
        }
      }
      if (anyActive) {
        const geom = pollenRef.current.geometry
        ;(geom.attributes.position as THREE.BufferAttribute).set(pollen.positions)
        geom.attributes.position.needsUpdate = true
      }
      const mat = pollenRef.current.material as THREE.PointsMaterial
      mat.opacity = anyActive ? (progress > 0.85 ? (1 - (progress - 0.85) / 0.15) * 0.7 : 0.7) : 0
    }
  })

  return (
    <group position={vfx.position}>
      {/* Petals */}
      {petalAngles.map((angle, i) => (
        <mesh key={i} ref={setPetalRef[i]} position={[Math.cos(angle)*0.4, 0.5, Math.sin(angle)*0.4]}>
          <ringGeometry args={[0.1, 0.4, 6, 1, 0, Math.PI * 0.5]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? PETAL_PURPLE : PETAL_PINK}
            transparent opacity={0} side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending} depthWrite={false}
          />
        </mesh>
      ))}
      {/* Central stigma */}
      <mesh ref={stigmaRef} position={[0, 0.5, 0]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Pollen */}
      <points ref={pollenRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={pollenCount} array={pollen.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color={POLLEN_YELLOW} size={0.04} transparent opacity={0} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 11: VOID ANCHOR (~1.8s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//           O <- dark sphere appears at y=2
//           |
//           v    SLAM to ground (0-20%)
//       ═══════════════
//       ~~~ripple~~~ripple~~~    (dark rings expand)
//         |   |   |   |
//         chains slam down from above
//         anchor to cardinal points
//         tense... SHATTER into particles
//
//   "Some things are placed with gravity.
//    The void doesn't just drop them —
//    it NAILS them to the ground."
//
// ░▒▓█ Anchored to existence. No escape. █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const VOID_CHAIN_COUNT = 4
const VOID_SHATTER_COUNT = 150

function VoidAnchorEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const sphereRef = useRef<THREE.Mesh>(null)
  const rippleRefs = useRef<(THREE.Mesh | null)[]>([])
  const chainRefs = useRef<(THREE.Mesh | null)[]>([])
  const shatterRef = useRef<THREE.Points>(null)

  const setRippleRef = useMemo(() => {
    return Array.from({ length: 3 }, (_, i) => (el: THREE.Mesh | null) => {
      rippleRefs.current[i] = el
    })
  }, [])

  const setChainRef = useMemo(() => {
    return Array.from({ length: VOID_CHAIN_COUNT }, (_, i) => (el: THREE.Mesh | null) => {
      chainRefs.current[i] = el
    })
  }, [])

  // chain cardinal angles
  const chainAngles = useMemo(() => {
    return Array.from({ length: VOID_CHAIN_COUNT }, (_, i) => (i / VOID_CHAIN_COUNT) * Math.PI * 2)
  }, [])

  // shatter particles
  const shatter = useMemo(() => {
    const pos = new Float32Array(VOID_SHATTER_COUNT * 3)
    const vel = new Float32Array(VOID_SHATTER_COUNT * 3)
    for (let i = 0; i < VOID_SHATTER_COUNT; i++) {
      const ix = i * 3
      const angle = Math.random() * Math.PI * 2
      const r = 0.8 + Math.random() * 0.5
      pos[ix] = Math.cos(angle) * r
      pos[ix+1] = Math.random() * 2
      pos[ix+2] = Math.sin(angle) * r
      vel[ix] = (Math.random() - 0.5) * 4
      vel[ix+1] = 1 + Math.random() * 3
      vel[ix+2] = (Math.random() - 0.5) * 4
    }
    return { positions: pos, velocities: vel }
  }, [])

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Dark sphere: appear at y=2, slam to ground ─═══─
    if (sphereRef.current) {
      if (progress < 0.08) {
        // appear
        const ap = progress / 0.08
        sphereRef.current.scale.set(ap * 0.6, ap * 0.6, ap * 0.6)
        sphereRef.current.position.y = 2.0
        ;(sphereRef.current.material as THREE.MeshBasicMaterial).opacity = ap * 0.9
      } else if (progress < 0.2) {
        // slam down
        const sp = (progress - 0.08) / 0.12
        const eased = sp * sp // accelerate
        sphereRef.current.position.y = 2.0 * (1 - eased)
        sphereRef.current.scale.set(0.6, 0.6, 0.6)
      } else if (progress < 0.8) {
        sphereRef.current.position.y = 0
        const pulse = 0.6 + Math.sin(t * 6) * 0.05
        sphereRef.current.scale.set(pulse, pulse, pulse)
      } else {
        // fade out
        const fp = (progress - 0.8) / 0.2
        ;(sphereRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - fp) * 0.9
        sphereRef.current.scale.set(0.6 * (1 - fp), 0.6 * (1 - fp), 0.6 * (1 - fp))
      }
    }

    // ─═══─ Ground ripples on impact (dark rings) ─═══─
    for (let i = 0; i < 3; i++) {
      const mesh = rippleRefs.current[i]
      if (!mesh) continue
      const rippleStart = 0.2 + i * 0.06
      if (progress > rippleStart) {
        const rp = Math.min(1, (progress - rippleStart) / 0.3)
        const s = 0.3 + rp * 4
        mesh.scale.set(s, s, 1)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - rp) * 0.6
      } else {
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0
      }
    }

    // ─═══─ Chains slam from above (30-60%) then shatter (60-80%) ─═══─
    for (let i = 0; i < VOID_CHAIN_COUNT; i++) {
      const mesh = chainRefs.current[i]
      if (!mesh) continue
      const angle = chainAngles[i]
      const chainStart = 0.3 + i * 0.04
      const chainLand = chainStart + 0.15

      if (progress < chainStart) {
        mesh.scale.set(0, 0, 0)
        continue
      }

      const dist = 1.2
      const targetX = Math.cos(angle) * dist
      const targetZ = Math.sin(angle) * dist

      if (progress < chainLand) {
        // slamming down
        const cp = (progress - chainStart) / (chainLand - chainStart)
        mesh.position.set(targetX * cp, 3 * (1 - cp) + 0.5, targetZ * cp)
        const len = 2.0 * cp
        mesh.scale.set(0.04, len, 0.04)
        mesh.lookAt(0, 0, 0)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = cp * 0.8
      } else if (progress < 0.65) {
        // taut
        mesh.position.set(targetX, 0.5, targetZ)
        mesh.scale.set(0.04, 2, 0.04)
        mesh.lookAt(0, 0, 0)
        const tense = 0.8 + Math.sin(t * 20 + i) * 0.1
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = tense
      } else if (progress < 0.8) {
        // shatter
        const sp = (progress - 0.65) / 0.15
        mesh.scale.set(0.04 * (1 - sp), 2 * (1 - sp), 0.04 * (1 - sp))
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - sp) * 0.8
      } else {
        mesh.scale.set(0, 0, 0)
      }
    }

    // ─═══─ Chain shatter particles (65-100%) ─═══─
    if (shatterRef.current) {
      if (progress > 0.65) {
        for (let i = 0; i < VOID_SHATTER_COUNT; i++) {
          const ix = i * 3
          shatter.positions[ix] += shatter.velocities[ix] * delta
          shatter.positions[ix+1] += shatter.velocities[ix+1] * delta
          shatter.velocities[ix+1] -= 6 * delta
          shatter.positions[ix+2] += shatter.velocities[ix+2] * delta
        }
        const geom = shatterRef.current.geometry
        ;(geom.attributes.position as THREE.BufferAttribute).set(shatter.positions)
        geom.attributes.position.needsUpdate = true
        const sp = (progress - 0.65) / 0.35
        ;(shatterRef.current.material as THREE.PointsMaterial).opacity = (1 - sp) * 0.7
      } else {
        ;(shatterRef.current.material as THREE.PointsMaterial).opacity = 0
      }
    }
  })

  return (
    <group position={vfx.position}>
      {/* Dark sphere */}
      <mesh ref={sphereRef} position={[0, 2, 0]}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color={VOID_BLACK} transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Ground ripple rings */}
      {Array.from({ length: 3 }, (_, i) => (
        <mesh key={i} ref={setRippleRef[i]} rotation={[-Math.PI/2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[0.3, 0.45, 32]} />
          <meshBasicMaterial color={IMPACT_PURPLE} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {/* Chains */}
      {chainAngles.map((_, i) => (
        <mesh key={i} ref={setChainRef[i]} position={[0, 2, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1, 6]} />
          <meshBasicMaterial color={CHAIN_STEEL} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {/* Chain shatter particles */}
      <points ref={shatterRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={VOID_SHATTER_COUNT} array={shatter.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial color={CHAIN_STEEL} size={0.04} transparent opacity={0} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 12: STELLAR FORGE (~2.5s)
// ─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─═══─
//
//          . *  .  * .  .   *   .  *
//       *    .  *.  .    *   .   .  *
//     .   *   ~~~~~~   .   *  .   *
//    *   .  ~~nebula~~  .    * .
//     .  * ~~accretion~~ *  .  *
//       *  . ~~disc~~ .  *  .
//          *  . *** .  *        <- star ignites at center
//             ~~~~              <- solar flares extend
//          *  . * .  *
//
//   "In the beginning there was hydrogen
//    and gravity. And from that: everything.
//    Some placements echo the birth of stars."
//
// ░▒▓█ Cosmic genesis — patient, majestic, inevitable █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const STELLAR_PARTICLE_COUNT = 600
const STELLAR_FLARE_COUNT = 4

function StellarForgeEffect({ vfx, onComplete }: EffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const nebulaRef = useRef<THREE.Points>(null)
  const starRef = useRef<THREE.Mesh>(null)
  const igniteRingRef = useRef<THREE.Mesh>(null)
  const flareRefs = useRef<(THREE.Mesh | null)[]>([])

  const setFlareRef = useMemo(() => {
    return Array.from({ length: STELLAR_FLARE_COUNT }, (_, i) => (el: THREE.Mesh | null) => {
      flareRefs.current[i] = el
    })
  }, [])

  const flareAngles = useMemo(() => {
    return Array.from({ length: STELLAR_FLARE_COUNT }, (_, i) =>
      (i / STELLAR_FLARE_COUNT) * Math.PI * 2 + Math.random() * 0.5
    )
  }, [])

  const nebula = useMemo(() => {
    const pos = new Float32Array(STELLAR_PARTICLE_COUNT * 3)
    const ori = new Float32Array(STELLAR_PARTICLE_COUNT * 3) // original positions
    const col = new Float32Array(STELLAR_PARTICLE_COUNT * 3)
    const speed = new Float32Array(STELLAR_PARTICLE_COUNT)   // angular speed
    const palette = [NEBULA_BLUE, NEBULA_PINK, WHITE, CORONA_GOLD]
    for (let i = 0; i < STELLAR_PARTICLE_COUNT; i++) {
      const ix = i * 3
      // flat disc distribution with some vertical spread
      const angle = Math.random() * Math.PI * 2
      const r = 1.0 + Math.random() * 4.0
      const y = (Math.random() - 0.5) * 0.8
      pos[ix] = Math.cos(angle) * r
      pos[ix+1] = 1.5 + y
      pos[ix+2] = Math.sin(angle) * r
      ori[ix] = pos[ix]; ori[ix+1] = pos[ix+1]; ori[ix+2] = pos[ix+2]
      const c = palette[Math.floor(Math.random() * palette.length)]
      col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b
      speed[i] = 0.3 + Math.random() * 0.7
    }
    return { positions: pos, origins: ori, colors: col, speed }
  }, [])

  useFrame((_, rawDelta) => {
    if (completed.current) return
    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta
    const t = elapsed.current
    const dur = vfx.duration
    if (t >= dur) { completed.current = true; onComplete(vfx.id); return }
    const progress = t / dur

    // ─═══─ Nebula: rotate + spiral inward ─═══─
    if (nebulaRef.current) {
      const spiralStrength = Math.pow(progress, 1.5) // gentle then strong
      for (let i = 0; i < STELLAR_PARTICLE_COUNT; i++) {
        const ix = i * 3
        // get current radius + angle from origin
        const ox = nebula.origins[ix]
        const oz = nebula.origins[ix+2]
        const origRadius = Math.sqrt(ox * ox + oz * oz)
        const origAngle = Math.atan2(oz, ox)

        // shrink radius over time
        const currentRadius = origRadius * (1 - spiralStrength * 0.85)
        // rotate over time (faster as we spiral in)
        const currentAngle = origAngle + t * nebula.speed[i] * (1 + spiralStrength * 2)

        nebula.positions[ix] = Math.cos(currentAngle) * currentRadius
        nebula.positions[ix+1] = nebula.origins[ix+1] * (1 - spiralStrength * 0.5) + 1.5 * spiralStrength * 0.5
        nebula.positions[ix+2] = Math.sin(currentAngle) * currentRadius
      }

      const geom = nebulaRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(nebula.positions)
      geom.attributes.position.needsUpdate = true

      const mat = nebulaRef.current.material as THREE.PointsMaterial
      if (progress > 0.85) {
        mat.opacity = (1 - (progress - 0.85) / 0.15) * 0.8
      } else {
        mat.opacity = Math.min(0.8, progress / 0.1)
      }
      mat.size = 0.05 + spiralStrength * 0.03
    }

    // ─═══─ Central star: grows, ignites at 50% ─═══─
    if (starRef.current) {
      const starGrow = Math.min(1, progress * 2) // reaches full by 50%
      let starScale: number
      let starOpacity: number

      if (progress < 0.45) {
        starScale = starGrow * 0.3
        starOpacity = starGrow * 0.6
      } else if (progress < 0.55) {
        // ignition flash
        const ip = (progress - 0.45) / 0.1
        starScale = 0.3 + ip * 1.2
        starOpacity = 0.6 + ip * 0.4
      } else if (progress < 0.7) {
        // post-ignition settle
        starScale = 1.5 - ((progress - 0.55) / 0.15) * 1.0
        starOpacity = 1.0
      } else {
        // shrink to point + final flash
        const sp = (progress - 0.7) / 0.3
        starScale = 0.5 * (1 - sp * 0.8)
        starOpacity = 1 - sp
      }

      starRef.current.scale.set(starScale, starScale, starScale)
      ;(starRef.current.material as THREE.MeshBasicMaterial).opacity = starOpacity
    }

    // ─═══─ Ignition ring at 50% ─═══─
    if (igniteRingRef.current) {
      if (progress > 0.48 && progress < 0.65) {
        const rp = (progress - 0.48) / 0.17
        const s = rp * 4.0
        igniteRingRef.current.scale.set(s, s, 1)
        ;(igniteRingRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - rp) * 0.8
      } else {
        igniteRingRef.current.scale.set(0, 0, 0)
      }
    }

    // ─═══─ Solar flares (50-80%) ─═══─
    for (let i = 0; i < STELLAR_FLARE_COUNT; i++) {
      const mesh = flareRefs.current[i]
      if (!mesh) continue
      const flareStart = 0.5 + i * 0.03
      const flareEnd = 0.8

      if (progress > flareStart && progress < flareEnd) {
        const fp = (progress - flareStart) / (flareEnd - flareStart)
        const extend = fp < 0.4 ? fp / 0.4 : 1 - ((fp - 0.4) / 0.6)
        const angle = flareAngles[i]
        const radius = 0.5 + extend * 2.0
        mesh.position.set(
          Math.cos(angle) * radius * 0.5,
          1.5,
          Math.sin(angle) * radius * 0.5
        )
        mesh.rotation.set(Math.PI/2, 0, angle)
        const s = extend * 1.5
        mesh.scale.set(s, radius, s * 0.3)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = extend * 0.6
      } else {
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0
        mesh.scale.set(0, 0, 0)
      }
    }
  })

  return (
    <group position={vfx.position}>
      {/* Nebula disc */}
      <points ref={nebulaRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={STELLAR_PARTICLE_COUNT} array={nebula.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={STELLAR_PARTICLE_COUNT} array={nebula.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.05} transparent opacity={0} sizeAttenuation vertexColors blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {/* Central star */}
      <mesh ref={starRef} position={[0, 1.5, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={WHITE} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Ignition ring */}
      <mesh ref={igniteRingRef} rotation={[-Math.PI/2, 0, 0]} position={[0, 1.5, 0]}>
        <ringGeometry args={[0.3, 0.5, 32]} />
        <meshBasicMaterial color={CORONA_GOLD} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Solar flares (torus arcs approximated with torus geometry) */}
      {flareAngles.map((_, i) => (
        <mesh key={i} ref={setFlareRef[i]} position={[0, 1.5, 0]}>
          <torusGeometry args={[0.8, 0.06, 8, 12, Math.PI * 0.6]} />
          <meshBasicMaterial color={CORONA_GOLD} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// ▓▓▓▓【V̸F̸X̸】▓▓▓▓ॐ▓▓▓▓【P̸L̸A̸C̸E̸M̸E̸N̸T̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓

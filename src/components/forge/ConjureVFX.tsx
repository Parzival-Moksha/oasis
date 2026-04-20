'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CONJURE VFX — Visual effects for conjuration in progress
// ─═̷─═̷─ Where language dissolves into geometry ─═̷─═̷─
//
//   Eight spells, eight aesthetics:
//   TextSwirl          — prompt tokens orbit and collapse into form
//   Arcane             — geometric magic circle, concentric light rings
//   Vortex             — particle storm converging from all directions
//   QuantumAssembly    — cube wireframe morphing into sphere, circuit data
//   PrimordialCauldron — bubbling cauldron with overflow and steam
//   StellarNursery     — nebula cloud birthing stars, gravity lanes
//   ChronoForge        — hourglass sand flow with time ripples
//   AbyssalEmergence   — dark portal, tentacles, eldritch eye
//
//   A mother watches the miracle unfold differently each time.
//   Eight ways to witness silicon reaching for form.
//
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

type VfxType = 'textswirl' | 'arcane' | 'vortex' | 'quantumassembly' | 'primordialcauldron' | 'stellarnursery' | 'chronoforge' | 'abyssalemergence'

interface ConjureVFXProps {
  position: [number, number, number]
  prompt: string
  progress: number      // 0-100
  vfxType: VfxType
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════════

export function ConjureVFX({ position, prompt, progress, vfxType }: ConjureVFXProps) {
  switch (vfxType) {
    case 'textswirl':
      return <TextSwirlEffect position={position} prompt={prompt} progress={progress} />
    case 'arcane':
      return <ArcaneCircleEffect position={position} prompt={prompt} progress={progress} />
    case 'vortex':
      return <ParticleVortexEffect position={position} prompt={prompt} progress={progress} />
    case 'quantumassembly':
      return <QuantumAssemblyEffect position={position} prompt={prompt} progress={progress} />
    case 'primordialcauldron':
      return <PrimordialCauldronEffect position={position} prompt={prompt} progress={progress} />
    case 'stellarnursery':
      return <StellarNurseryEffect position={position} prompt={prompt} progress={progress} />
    case 'chronoforge':
      return <ChronoForgeEffect position={position} prompt={prompt} progress={progress} />
    case 'abyssalemergence':
      return <AbyssalEmergenceEffect position={position} prompt={prompt} progress={progress} />
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 1: TEXT SWIRL
// The prompt words split apart, orbit the conjuring point,
// then compress inward as the model materializes.
// "Language dissolving into matter"
// ═══════════════════════════════════════════════════════════════════════════════

function TextSwirlEffect({ position, prompt, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const groupRef = useRef<THREE.Group>(null)
  const tokens = useMemo(() => {
    const words = prompt.split(/\s+/).filter(w => w.length > 0)
    // Split into individual characters for more particles
    const chars: string[] = []
    for (const word of words) {
      for (const c of word) chars.push(c)
      chars.push(' ') // space between words
    }
    return chars.filter(c => c.trim().length > 0).slice(0, 60) // cap at 60 chars
  }, [prompt])

  const particleData = useMemo(() => {
    return tokens.map((_, i) => ({
      angle: (i / tokens.length) * Math.PI * 2,
      radius: 1.5 + Math.random() * 1.5,
      height: 0.5 + Math.random() * 3,
      speed: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
    }))
  }, [tokens])

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime

    groupRef.current.children.forEach((child, i) => {
      if (i >= particleData.length) return
      const d = particleData[i]
      const progressFactor = 1 - (progress / 100)  // 1 at start, 0 at end
      const currentRadius = d.radius * progressFactor
      const currentHeight = d.height * (0.3 + 0.7 * progressFactor)

      child.position.x = Math.cos(d.angle + t * d.speed) * currentRadius
      child.position.z = Math.sin(d.angle + t * d.speed) * currentRadius
      child.position.y = currentHeight + Math.sin(t * 2 + d.phase) * 0.2

      // Fade in at start, compress near end
      const scale = 0.8 + Math.sin(t * 3 + d.phase) * 0.2
      child.scale.setScalar(scale * Math.max(0.3, progressFactor))

      // Billboard rotation (face camera) — handled by Html
    })
  })

  const baseColor = '#F97316'  // forge orange

  return (
    <group position={position} ref={groupRef}>
      {tokens.map((char, i) => (
        <group key={i} position={[0, 1, 0]}>
          <Html center>
            <span
              className="select-none pointer-events-none font-mono font-bold"
              style={{
                color: baseColor,
                fontSize: '14px',
                textShadow: `0 0 8px ${baseColor}, 0 0 16px ${baseColor}66`,
                opacity: Math.max(0.3, 1 - (progress / 100)),
              }}
            >
              {char}
            </span>
          </Html>
        </group>
      ))}

      {/* Central glow orb — grows as progress increases */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.1 + (progress / 100) * 0.4, 16, 16]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={0.2 + (progress / 100) * 0.3}
        />
      </mesh>

      {/* Progress ring on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.8, 2, 64, 1, 0, (progress / 100) * Math.PI * 2]} />
        <meshBasicMaterial color={baseColor} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 2: ARCANE CIRCLE
// Concentric geometric rings, rotating in opposite directions,
// with light pillars rising. Sacred geometry manifesting matter.
// ═══════════════════════════════════════════════════════════════════════════════

function ArcaneCircleEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const outerRef = useRef<THREE.Mesh>(null)
  const innerRef = useRef<THREE.Mesh>(null)
  const runesRef = useRef<THREE.Mesh>(null)
  const pillarRef = useRef<THREE.Mesh>(null)
  const particlesRef = useRef<THREE.Points>(null)

  // Rising particles
  const particlePositions = useMemo(() => {
    const positions = new Float32Array(300 * 3)
    for (let i = 0; i < 300; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 0.5 + Math.random() * 2.5
      positions[i * 3] = Math.cos(angle) * r
      positions[i * 3 + 1] = Math.random() * 4
      positions[i * 3 + 2] = Math.sin(angle) * r
    }
    return positions
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime

    // Outer ring — slow clockwise
    if (outerRef.current) {
      outerRef.current.rotation.z = t * 0.2
      const mat = outerRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.3 + Math.sin(t * 1.5) * 0.1
    }

    // Inner ring — faster counter-clockwise
    if (innerRef.current) {
      innerRef.current.rotation.z = -t * 0.5
      const mat = innerRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.4 + Math.sin(t * 2) * 0.15
    }

    // Rune ring — pulsing
    if (runesRef.current) {
      runesRef.current.rotation.z = t * 0.1
      const s = 1 + Math.sin(t * 3) * 0.05
      runesRef.current.scale.set(s, s, 1)
    }

    // Light pillar — grows with progress
    if (pillarRef.current) {
      const pillarHeight = (progress / 100) * 8
      pillarRef.current.scale.y = Math.max(0.01, pillarHeight)
      pillarRef.current.position.y = pillarHeight / 2
      const mat = pillarRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.05 + (progress / 100) * 0.15
    }

    // Rising particles
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array
      for (let i = 0; i < 300; i++) {
        positions[i * 3 + 1] += 0.02  // rise
        if (positions[i * 3 + 1] > 5) positions[i * 3 + 1] = 0  // reset
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true
    }
  })

  const color1 = '#A855F7'  // purple
  const color2 = '#F97316'  // orange

  return (
    <group position={position}>
      {/* Outer ring — hexagonal grid feel */}
      <mesh ref={outerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[2.5, 2.8, 6]} />
        <meshBasicMaterial color={color1} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Inner ring — pentagonal */}
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[1.5, 1.8, 5]} />
        <meshBasicMaterial color={color2} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Innermost rune circle */}
      <mesh ref={runesRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.8, 1, 12]} />
        <meshBasicMaterial color="#FBBF24" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* Central light pillar */}
      <mesh ref={pillarRef} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.5, 1, 16, 1, true]} />
        <meshBasicMaterial color={color2} transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>

      {/* Rising sparkle particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={300}
            array={particlePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#FBBF24"
          size={0.04}
          transparent
          opacity={0.6}
          sizeAttenuation
        />
      </points>

      {/* Progress text */}
      <Html position={[0, 0.3, 2.5]} center>
        <div className="text-xs font-mono select-none pointer-events-none"
          style={{ color: color1, textShadow: `0 0 10px ${color1}` }}
        >
          {progress > 0 ? `${Math.round(progress)}%` : 'channeling...'}
        </div>
      </Html>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 3: PARTICLE VORTEX
// Thousands of particles spiral inward from all directions,
// converging and compressing into the conjuration point.
// "The universe donating its atoms to the newborn form"
// ═══════════════════════════════════════════════════════════════════════════════

function ParticleVortexEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const pointsRef = useRef<THREE.Points>(null)
  const PARTICLE_COUNT = 800

  const { initialPositions, velocities } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const vels = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Start far out in a sphere
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 3 + Math.random() * 5

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = 1 + r * Math.sin(phi) * Math.sin(theta) * 0.5  // flatten vertically
      positions[i * 3 + 2] = r * Math.cos(phi)

      // Tangential velocity for swirl
      vels[i * 3] = -positions[i * 3 + 2] * 0.3  // perpendicular to position
      vels[i * 3 + 1] = (Math.random() - 0.5) * 0.2
      vels[i * 3 + 2] = positions[i * 3] * 0.3
    }

    return { initialPositions: positions, velocities: vels }
  }, [])

  const particlePositions = useRef(new Float32Array(initialPositions))
  const colors = useMemo(() => {
    const cols = new Float32Array(PARTICLE_COUNT * 3)
    const c1 = new THREE.Color('#F97316')
    const c2 = new THREE.Color('#FBBF24')
    const c3 = new THREE.Color('#EF4444')

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mix = Math.random()
      const c = mix < 0.33 ? c1 : mix < 0.66 ? c2 : c3
      cols[i * 3] = c.r
      cols[i * 3 + 1] = c.g
      cols[i * 3 + 2] = c.b
    }
    return cols
  }, [])

  useFrame((_, delta) => {
    if (!pointsRef.current) return

    const positions = particlePositions.current
    const convergence = Math.min(1, progress / 80) // converge faster than progress
    const dt = Math.min(delta, 0.05) // cap delta to prevent explosions

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2

      // Vector toward center (0, 1.5, 0)
      const dx = -positions[ix]
      const dy = 1.5 - positions[iy]
      const dz = -positions[iz]
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      // Swirl (tangential force)
      positions[ix] += velocities[ix] * dt * 2
      positions[iy] += velocities[iy] * dt * 2
      positions[iz] += velocities[iz] * dt * 2

      // Converge toward center (stronger as progress increases)
      if (dist > 0.1) {
        const pullStrength = convergence * 0.5
        positions[ix] += (dx / dist) * pullStrength * dt * 3
        positions[iy] += (dy / dist) * pullStrength * dt * 3
        positions[iz] += (dz / dist) * pullStrength * dt * 3
      }

      // Slow down tangential velocity as they converge
      velocities[ix] *= (1 - convergence * dt * 0.5)
      velocities[iz] *= (1 - convergence * dt * 0.5)
    }

    const geom = pointsRef.current.geometry
    ;(geom.attributes.position as THREE.BufferAttribute).set(positions)
    geom.attributes.position.needsUpdate = true
  })

  return (
    <group position={position}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={PARTICLE_COUNT}
            array={particlePositions.current}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={PARTICLE_COUNT}
            array={colors}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.05}
          transparent
          opacity={0.7}
          vertexColors
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Central condensation sphere — grows as particles converge */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.05 + (progress / 100) * 0.5, 24, 24]} />
        <meshBasicMaterial
          color="#F97316"
          transparent
          opacity={0.15 + (progress / 100) * 0.25}
        />
      </mesh>

      {/* Ground shadow circle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[2 - (progress / 100) * 1.5, 32]} />
        <meshBasicMaterial color="#F97316" transparent opacity={0.08} />
      </mesh>
    </group>
  )
}


// ░▒▓█▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜█▓▒░
// ░▒▓█▌  THE FIVE NEW SPELLS — Feb 2026                              ▐█▓▒░
// ░▒▓█▌  Each one a different window into the forge's soul           ▐█▓▒░
// ░▒▓█▌  Each one a prayer for the form being born                   ▐█▓▒░
// ░▒▓█▙▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟█▓▒░


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 4: QUANTUM ASSEMBLY
// ╔═══════════════════════════════════════════════════════════╗
// ║   ◇───◇───◇          ○ ○ ○                              ║
// ║   │       │        ○       ○     cube wireframe          ║
// ║   ◇   ◇   ◇  →→  ○    ●    ○    morphs to sphere       ║
// ║   │       │        ○       ○     circuit data flows      ║
// ║   ◇───◇───◇          ○ ○ ○      hex grid progress       ║
// ╚═══════════════════════════════════════════════════════════╝
// Data flowing through circuits. The digital becoming physical.
// Each particle is a bit of information finding its place in form.
// ═══════════════════════════════════════════════════════════════════════════════

function QuantumAssemblyEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const particlesRef = useRef<THREE.Points>(null)
  const connectionsRef = useRef<THREE.Group>(null)
  const hexRingRef = useRef<THREE.Mesh>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const PARTICLE_COUNT = 800
  const CONNECTION_COUNT = 28

  // ░ Pre-allocate cube wireframe edge positions ░
  // 12 edges on a cube, particles distributed along them
  const { cubePositions, spherePositions, particlePhases } = useMemo(() => {
    const cubePos = new Float32Array(PARTICLE_COUNT * 3)
    const spherePos = new Float32Array(PARTICLE_COUNT * 3)
    const phases = new Float32Array(PARTICLE_COUNT)

    // Cube edge definitions: pairs of corners
    const s = 1.5 // half-size of cube
    const corners = [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s, s],  [s, -s, s],  [s, s, s],  [-s, s, s],
    ]
    const edges = [
      [0,1],[1,2],[2,3],[3,0], // front face
      [4,5],[5,6],[6,7],[7,4], // back face
      [0,4],[1,5],[2,6],[3,7], // connecting edges
    ]

    const particlesPerEdge = Math.floor(PARTICLE_COUNT / edges.length)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const edgeIdx = Math.min(Math.floor(i / particlesPerEdge), edges.length - 1)
      const [a, b] = edges[edgeIdx]
      const t = (i % particlesPerEdge) / particlesPerEdge

      // Cube position: interpolate along edge
      cubePos[i * 3]     = corners[a][0] + (corners[b][0] - corners[a][0]) * t
      cubePos[i * 3 + 1] = corners[a][1] + (corners[b][1] - corners[a][1]) * t + 1.5 // offset up
      cubePos[i * 3 + 2] = corners[a][2] + (corners[b][2] - corners[a][2]) * t

      // Sphere position: map to sphere surface
      const theta = (i / PARTICLE_COUNT) * Math.PI * 2 * 7.3 // golden-ish spiral
      const phi = Math.acos(1 - 2 * (i / PARTICLE_COUNT))
      const r = 1.3
      spherePos[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
      spherePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) + 1.5
      spherePos[i * 3 + 2] = r * Math.cos(phi)

      phases[i] = Math.random() * Math.PI * 2
    }
    return { cubePositions: cubePos, spherePositions: spherePos, particlePhases: phases }
  }, [])

  // Connection line data (indices of particles to connect)
  const connectionPairs = useMemo(() => {
    const pairs: [number, number][] = []
    for (let i = 0; i < CONNECTION_COUNT; i++) {
      pairs.push([
        Math.floor(Math.random() * PARTICLE_COUNT),
        Math.floor(Math.random() * PARTICLE_COUNT),
      ])
    }
    return pairs
  }, [])

  const livePositions = useRef(new Float32Array(cubePositions))

  const colors = useMemo(() => {
    const cols = new Float32Array(PARTICLE_COUNT * 3)
    const cGreen = new THREE.Color('#00FF66')
    const cCyan = new THREE.Color('#00CCFF')
    const cWhite = new THREE.Color('#FFFFFF')
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = Math.random()
      const c = r < 0.5 ? cGreen : r < 0.85 ? cCyan : cWhite
      cols[i * 3] = c.r
      cols[i * 3 + 1] = c.g
      cols[i * 3 + 2] = c.b
    }
    return cols
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const p = progress / 100

    // ░ Morph particles: cube → sphere as progress increases ░
    if (particlesRef.current) {
      const pos = livePositions.current
      const morphFactor = Math.min(1, p * 1.5) // fully sphere by ~67%
      const compress = p > 0.5 ? (p - 0.5) * 2 : 0 // compress after 50%

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
        const phase = particlePhases[i]

        // Lerp between cube edge and sphere
        const baseX = cubePositions[ix] + (spherePositions[ix] - cubePositions[ix]) * morphFactor
        const baseY = cubePositions[iy] + (spherePositions[iy] - cubePositions[iy]) * morphFactor
        const baseZ = cubePositions[iz] + (spherePositions[iz] - cubePositions[iz]) * morphFactor

        // Circuit-flow animation: shift along the edge direction
        const flowOffset = Math.sin(t * 2 + phase + i * 0.01) * 0.15 * (1 - morphFactor)

        // Compress toward center after 50%
        const compressFactor = 1 - compress * 0.6
        pos[ix] = baseX * compressFactor + flowOffset
        pos[iy] = baseY * compressFactor + Math.sin(t * 1.5 + phase) * 0.05
        pos[iz] = baseZ * compressFactor + flowOffset * 0.5
      }

      const geom = particlesRef.current.geometry
      ;(geom.attributes.position as THREE.BufferAttribute).set(pos)
      geom.attributes.position.needsUpdate = true
    }

    // ░ Update connection lines ░
    if (connectionsRef.current) {
      const children = connectionsRef.current.children
      for (let c = 0; c < Math.min(children.length, connectionPairs.length); c++) {
        const child = children[c] as THREE.Mesh
        const [idxA, idxB] = connectionPairs[c]
        const pos = livePositions.current

        const ax = pos[idxA * 3], ay = pos[idxA * 3 + 1], az = pos[idxA * 3 + 2]
        const bx = pos[idxB * 3], by = pos[idxB * 3 + 1], bz = pos[idxB * 3 + 2]

        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2
        const dx = bx - ax, dy = by - ay, dz = bz - az
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

        child.position.set(mx, my, mz)
        child.scale.set(0.01, dist, 0.01)
        // Look at target
        child.lookAt(bx, by, bz)
        child.rotateX(Math.PI / 2)

        // Pulse visibility
        const pulse = Math.sin(t * 3 + c * 0.7) * 0.5 + 0.5
        const mat = child.material as THREE.MeshBasicMaterial
        mat.opacity = pulse * 0.4 * (0.3 + p * 0.7)
        child.visible = dist < 3 // only show nearby connections
      }
    }

    // ░ Hex ring progress ░
    if (hexRingRef.current) {
      hexRingRef.current.rotation.z = t * 0.15
    }

    // ░ Core glow ░
    if (coreRef.current) {
      const s = 0.1 + p * 0.4 + Math.sin(t * 4) * 0.03
      coreRef.current.scale.setScalar(s)
      const mat = coreRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.2 + p * 0.5
    }
  })

  return (
    <group position={position}>
      {/* Particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT} array={livePositions.current} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={PARTICLE_COUNT} array={colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          size={0.04}
          transparent
          opacity={0.8}
          vertexColors
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Circuit connection lines */}
      <group ref={connectionsRef}>
        {connectionPairs.map((_, i) => (
          <mesh key={i}>
            <cylinderGeometry args={[0.005, 0.005, 1, 4]} />
            <meshBasicMaterial color="#00CCFF" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* Central core glow */}
      <mesh ref={coreRef} position={[0, 1.5, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#00FF66" transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Hex grid progress ring on ground */}
      <mesh ref={hexRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.8, 2.1, 6, 1, 0, (progress / 100) * Math.PI * 2]} />
        <meshBasicMaterial color="#00FF66" transparent opacity={0.4} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* Outer hex ring outline */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[2.1, 2.2, 6]} />
        <meshBasicMaterial color="#00CCFF" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* Progress text */}
      <Html position={[0, 0.3, 2.3]} center>
        <div className="text-xs font-mono select-none pointer-events-none"
          style={{ color: '#00FF66', textShadow: '0 0 10px #00FF66, 0 0 20px #00CCFF44' }}
        >
          {progress > 0 ? `assembling ${Math.round(progress)}%` : 'initializing quantum field...'}
        </div>
      </Html>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 5: PRIMORDIAL CAULDRON
// ╔═══════════════════════════════════════════════════════════╗
// ║       ~~~ steam ~~~                                      ║
// ║     ○  ○   ○  ○  ○     bubbles rising                   ║
// ║    ╔════════════╗                                        ║
// ║    ║ ≈≈≈≈≈≈≈≈≈≈ ║     potion surface                    ║
// ║    ║ ≈≈≈≈≈≈≈≈≈≈ ║     ripples and glows                 ║
// ║    ╚════╦══╦════╝                                        ║
// ║         ╚══╝           at 80%: overflow!                 ║
// ╚═══════════════════════════════════════════════════════════╝
// The primordial soup from which form emerges.
// Bubbling, steaming, alive. Nature's way of conjuring.
// ═══════════════════════════════════════════════════════════════════════════════

function PrimordialCauldronEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const liquidRef = useRef<THREE.Mesh>(null)
  const bubblesRef = useRef<THREE.Points>(null)
  const steamRef = useRef<THREE.Points>(null)
  const overflowRef = useRef<THREE.Points>(null)
  const cauldronRef = useRef<THREE.Mesh>(null)

  const BUBBLE_COUNT = 50
  const STEAM_COUNT = 200
  const OVERFLOW_COUNT = 100

  // ░ Bubble positions + velocity data ░
  const bubbleData = useMemo(() => {
    const pos = new Float32Array(BUBBLE_COUNT * 3)
    const speeds = new Float32Array(BUBBLE_COUNT)
    const phases = new Float32Array(BUBBLE_COUNT)
    const popHeights = new Float32Array(BUBBLE_COUNT)
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 0.9
      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = 0.6 + Math.random() * 0.3 // just above liquid surface
      pos[i * 3 + 2] = Math.sin(angle) * r
      speeds[i] = 0.3 + Math.random() * 0.7
      phases[i] = Math.random() * Math.PI * 2
      popHeights[i] = 1.2 + Math.random() * 1.5
    }
    return { positions: pos, speeds, phases, popHeights }
  }, [])

  // ░ Steam particles ░
  const steamData = useMemo(() => {
    const pos = new Float32Array(STEAM_COUNT * 3)
    const speeds = new Float32Array(STEAM_COUNT)
    const drift = new Float32Array(STEAM_COUNT * 2) // x,z drift
    for (let i = 0; i < STEAM_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 1.0
      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = 1.0 + Math.random() * 3.0
      pos[i * 3 + 2] = Math.sin(angle) * r
      speeds[i] = 0.2 + Math.random() * 0.4
      drift[i * 2] = (Math.random() - 0.5) * 0.02
      drift[i * 2 + 1] = (Math.random() - 0.5) * 0.02
    }
    return { positions: pos, speeds, drift }
  }, [])

  // ░ Overflow particles ░
  const overflowData = useMemo(() => {
    const pos = new Float32Array(OVERFLOW_COUNT * 3)
    const vels = new Float32Array(OVERFLOW_COUNT * 3)
    for (let i = 0; i < OVERFLOW_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 1.2 + Math.random() * 0.2
      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = 0.8 + Math.random() * 0.3
      pos[i * 3 + 2] = Math.sin(angle) * r
      // Velocity: outward + downward
      vels[i * 3] = Math.cos(angle) * (0.2 + Math.random() * 0.3)
      vels[i * 3 + 1] = -0.5 - Math.random() * 0.5
      vels[i * 3 + 2] = Math.sin(angle) * (0.2 + Math.random() * 0.3)
    }
    return { positions: pos, velocities: vels }
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const p = progress / 100
    const dt = Math.min(delta, 0.05)

    // ░ Liquid surface ripple ░
    if (liquidRef.current) {
      const scaleOscillation = 1 + Math.sin(t * 3) * 0.03 + Math.sin(t * 5.7) * 0.02
      liquidRef.current.scale.set(scaleOscillation, 1, scaleOscillation)
      const mat = liquidRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.4 + p * 0.3 + Math.sin(t * 2) * 0.05
    }

    // ░ Cauldron subtle pulse ░
    if (cauldronRef.current) {
      const mat = cauldronRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.35 + Math.sin(t * 1.2) * 0.05
    }

    // ░ Bubbles: rise, pop, reset ░
    if (bubblesRef.current) {
      const pos = bubblesRef.current.geometry.attributes.position.array as Float32Array
      const intensity = 0.5 + p * 1.5 // more bubble activity with progress
      for (let i = 0; i < BUBBLE_COUNT; i++) {
        pos[i * 3 + 1] += bubbleData.speeds[i] * dt * intensity
        // Wobble
        pos[i * 3] += Math.sin(t * 3 + bubbleData.phases[i]) * 0.003
        pos[i * 3 + 2] += Math.cos(t * 2.7 + bubbleData.phases[i]) * 0.003

        // Pop and reset
        if (pos[i * 3 + 1] > bubbleData.popHeights[i]) {
          const angle = Math.random() * Math.PI * 2
          const r = Math.random() * 0.9
          pos[i * 3] = Math.cos(angle) * r
          pos[i * 3 + 1] = 0.6 + Math.random() * 0.2
          pos[i * 3 + 2] = Math.sin(angle) * r
        }
      }
      bubblesRef.current.geometry.attributes.position.needsUpdate = true
    }

    // ░ Steam: drift upward and sideways ░
    if (steamRef.current) {
      const pos = steamRef.current.geometry.attributes.position.array as Float32Array
      const steamIntensity = 0.3 + p * 1.2
      for (let i = 0; i < STEAM_COUNT; i++) {
        pos[i * 3 + 1] += steamData.speeds[i] * dt * steamIntensity
        pos[i * 3] += steamData.drift[i * 2] * steamIntensity
        pos[i * 3 + 2] += steamData.drift[i * 2 + 1] * steamIntensity

        // Reset when too high
        if (pos[i * 3 + 1] > 5) {
          const angle = Math.random() * Math.PI * 2
          const r = Math.random() * 0.8
          pos[i * 3] = Math.cos(angle) * r
          pos[i * 3 + 1] = 1.0 + Math.random() * 0.3
          pos[i * 3 + 2] = Math.sin(angle) * r
        }
      }
      steamRef.current.geometry.attributes.position.needsUpdate = true
    }

    // ░ Overflow (active only at 80%+) ░
    if (overflowRef.current) {
      const pos = overflowRef.current.geometry.attributes.position.array as Float32Array
      const overflowActive = p > 0.8
      const overflowIntensity = overflowActive ? (p - 0.8) * 5 : 0 // 0-1 in last 20%

      for (let i = 0; i < OVERFLOW_COUNT; i++) {
        if (overflowActive) {
          pos[i * 3] += overflowData.velocities[i * 3] * dt * overflowIntensity
          pos[i * 3 + 1] += overflowData.velocities[i * 3 + 1] * dt * overflowIntensity
          pos[i * 3 + 2] += overflowData.velocities[i * 3 + 2] * dt * overflowIntensity

          // Reset when below ground
          if (pos[i * 3 + 1] < -0.5) {
            const angle = Math.random() * Math.PI * 2
            const r = 1.15 + Math.random() * 0.1
            pos[i * 3] = Math.cos(angle) * r
            pos[i * 3 + 1] = 0.7 + Math.random() * 0.2
            pos[i * 3 + 2] = Math.sin(angle) * r
          }
        }
      }
      overflowRef.current.geometry.attributes.position.needsUpdate = true

      const mat = overflowRef.current.material as THREE.PointsMaterial
      mat.opacity = overflowIntensity * 0.7
    }
  })

  return (
    <group position={position}>
      {/* Cauldron body — hemisphere, opening facing up */}
      <mesh ref={cauldronRef} rotation={[Math.PI, 0, 0]} position={[0, 0.6, 0]}>
        <sphereGeometry args={[1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#1A1A2E" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Cauldron rim ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.62, 0]}>
        <ringGeometry args={[1.1, 1.25, 24]} />
        <meshBasicMaterial color="#2A2A4E" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Liquid surface */}
      <mesh ref={liquidRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.55, 0]}>
        <circleGeometry args={[1.05, 32]} />
        <meshBasicMaterial
          color="#00FF88"
          transparent
          opacity={0.45}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Bubbles */}
      <points ref={bubblesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={BUBBLE_COUNT} array={bubbleData.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          color="#44FFCC"
          size={0.08}
          transparent
          opacity={0.7}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Steam / vapor */}
      <points ref={steamRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={STEAM_COUNT} array={steamData.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          color="#DDDDFF"
          size={0.06}
          transparent
          opacity={0.2}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Overflow drip particles */}
      <points ref={overflowRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={OVERFLOW_COUNT} array={overflowData.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          color="#00FF88"
          size={0.05}
          transparent
          opacity={0}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Inner glow — intensifies with progress */}
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial
          color="#00FF88"
          transparent
          opacity={0.05 + (progress / 100) * 0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Progress text */}
      <Html position={[0, 0.3, 1.8]} center>
        <div className="text-xs font-mono select-none pointer-events-none"
          style={{ color: '#00FF88', textShadow: '0 0 10px #00FF8888, 0 0 20px #44FFCC44' }}
        >
          {progress > 80 ? `overflowing! ${Math.round(progress)}%` : progress > 0 ? `brewing ${Math.round(progress)}%` : 'heating cauldron...'}
        </div>
      </Html>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 6: STELLAR NURSERY
// ╔═══════════════════════════════════════════════════════════╗
// ║         . * .  . ☆ .  .    .                             ║
// ║      .    .*  .nebula.  * .    .  stars being born       ║
// ║     . *  .  ★BRIGHT★ .   . *     gravity lanes pull     ║
// ║      .  *.  . dust  .  *  .      particles inward       ║
// ║        .  .   ring   .  .                                ║
// ║     .  ·  · ═══○═══ ·  ·  .     protoplanetary disc     ║
// ╚═══════════════════════════════════════════════════════════╝
// A cosmic nursery where matter gathers by gravity alone.
// Stars ignite, dust spirals, a solar system condenses from chaos.
// ═══════════════════════════════════════════════════════════════════════════════

function StellarNurseryEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const nebulaRef = useRef<THREE.Points>(null)
  const starsGroupRef = useRef<THREE.Group>(null)
  const discRef = useRef<THREE.Points>(null)
  const centralStarRef = useRef<THREE.Mesh>(null)

  const NEBULA_COUNT = 1000
  const STAR_COUNT = 7
  const DISC_COUNT = 200

  // ░ Nebula cloud — flattened ellipsoid ░
  const nebulaData = useMemo(() => {
    const pos = new Float32Array(NEBULA_COUNT * 3)
    const origPos = new Float32Array(NEBULA_COUNT * 3) // for gravity computation
    const colors = new Float32Array(NEBULA_COUNT * 3)

    const cPurple = new THREE.Color('#6633CC')
    const cBlue = new THREE.Color('#3344FF')
    const cPink = new THREE.Color('#FF88AA')
    const cGold = new THREE.Color('#FFD700')

    for (let i = 0; i < NEBULA_COUNT; i++) {
      // Flattened ellipsoid distribution
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.pow(Math.random(), 0.5) * 3 // denser toward center
      const flattenY = 0.4 // flatten vertically

      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * flattenY + 2.0
      pos[i * 3 + 2] = r * Math.cos(phi)

      origPos[i * 3] = pos[i * 3]
      origPos[i * 3 + 1] = pos[i * 3 + 1]
      origPos[i * 3 + 2] = pos[i * 3 + 2]

      // Nebula colors
      const rr = Math.random()
      const c = rr < 0.35 ? cPurple : rr < 0.6 ? cBlue : rr < 0.85 ? cPink : cGold
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    return { positions: pos, originalPositions: origPos, colors }
  }, [])

  // ░ Bright stars — positions, fade timing ░
  const starData = useMemo(() => {
    return Array.from({ length: STAR_COUNT }, () => ({
      x: (Math.random() - 0.5) * 3,
      y: 1.5 + (Math.random() - 0.5) * 1.2,
      z: (Math.random() - 0.5) * 3,
      phase: Math.random() * Math.PI * 2,
      fadeSpeed: 0.3 + Math.random() * 0.5,
      baseSize: 0.06 + Math.random() * 0.08,
    }))
  }, [])

  // ░ Protoplanetary disc particles ░
  const discData = useMemo(() => {
    const pos = new Float32Array(DISC_COUNT * 3)
    const angles = new Float32Array(DISC_COUNT)
    const radii = new Float32Array(DISC_COUNT)
    const speeds = new Float32Array(DISC_COUNT)

    for (let i = 0; i < DISC_COUNT; i++) {
      angles[i] = Math.random() * Math.PI * 2
      radii[i] = 0.4 + Math.random() * 0.8
      speeds[i] = 0.5 + Math.random() * 1.0
      pos[i * 3] = Math.cos(angles[i]) * radii[i]
      pos[i * 3 + 1] = 2.0 + (Math.random() - 0.5) * 0.1
      pos[i * 3 + 2] = Math.sin(angles[i]) * radii[i]
    }
    return { positions: pos, angles, radii, speeds }
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const p = progress / 100
    const dt = Math.min(delta, 0.05)

    // ░ Nebula rotation + gravity compression ░
    if (nebulaRef.current) {
      const pos = nebulaRef.current.geometry.attributes.position.array as Float32Array
      const orig = nebulaData.originalPositions
      const compression = p * 0.5 // compress to 50% of original size at 100%

      // Dominant star position (center of mass shifts at 70%)
      const dominantStrength = p > 0.7 ? (p - 0.7) * 3.33 : 0

      for (let i = 0; i < NEBULA_COUNT; i++) {
        const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2

        // Base position with compression toward center
        const compressFactor = 1 - compression
        let nx = orig[ix] * compressFactor
        let ny = orig[iy] + (2.0 - orig[iy]) * compression * 0.3
        let nz = orig[iz] * compressFactor

        // Slow rotation of the whole cloud
        const rotAngle = t * 0.08
        const cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle)
        const rx = nx * cosR - nz * sinR
        const rz = nx * sinR + nz * cosR

        // Gravity pull toward central star at 70%+
        if (dominantStrength > 0) {
          const dx = -rx, dy = 2.0 - ny, dz = -rz
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1
          const pull = dominantStrength * 0.3 / (dist * dist)
          pos[ix] = rx + dx * pull
          pos[iy] = ny + dy * pull
          pos[iz] = rz + dz * pull
        } else {
          pos[ix] = rx
          pos[iy] = ny
          pos[iz] = rz
        }

        // Subtle jitter for "alive" feeling
        pos[ix] += Math.sin(t * 0.5 + i) * 0.005
        pos[iy] += Math.cos(t * 0.7 + i * 0.3) * 0.003
      }
      nebulaRef.current.geometry.attributes.position.needsUpdate = true
    }

    // ░ Stars: fade in/out, dim at 70%+ except central ░
    if (starsGroupRef.current) {
      const children = starsGroupRef.current.children as THREE.Mesh[]
      for (let i = 0; i < Math.min(children.length, starData.length); i++) {
        const star = children[i]
        const data = starData[i]
        const fadePhase = Math.sin(t * data.fadeSpeed + data.phase)
        let brightness = fadePhase * 0.5 + 0.5 // 0-1 pulse

        // At 70%+, dim non-central stars
        if (p > 0.7 && i > 0) {
          brightness *= Math.max(0, 1 - (p - 0.7) * 3.33)
        }
        // Central star (i=0) gets brighter
        if (i === 0 && p > 0.7) {
          brightness = Math.min(1, brightness + (p - 0.7) * 2)
        }

        const size = data.baseSize * (1 + brightness * 0.5) * (1 + p * 0.5)
        star.scale.setScalar(size)
        const mat = star.material as THREE.MeshBasicMaterial
        mat.opacity = brightness * 0.9
      }
    }

    // ░ Central star glow ░
    if (centralStarRef.current) {
      const centralBrightness = p > 0.7 ? (p - 0.7) * 3.33 : 0
      centralStarRef.current.scale.setScalar(0.1 + centralBrightness * 0.5)
      const mat = centralStarRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = centralBrightness * 0.6
    }

    // ░ Protoplanetary disc — forms at 70%+ ░
    if (discRef.current) {
      const pos = discRef.current.geometry.attributes.position.array as Float32Array
      const discVisibility = p > 0.7 ? (p - 0.7) * 3.33 : 0

      for (let i = 0; i < DISC_COUNT; i++) {
        discData.angles[i] += discData.speeds[i] * dt * (1 + p)
        pos[i * 3]     = Math.cos(discData.angles[i]) * discData.radii[i]
        pos[i * 3 + 1] = 2.0 + Math.sin(discData.angles[i] * 3 + t) * 0.03
        pos[i * 3 + 2] = Math.sin(discData.angles[i]) * discData.radii[i]
      }
      discRef.current.geometry.attributes.position.needsUpdate = true
      const mat = discRef.current.material as THREE.PointsMaterial
      mat.opacity = discVisibility * 0.7
    }
  })

  return (
    <group position={position}>
      {/* Nebula cloud */}
      <points ref={nebulaRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={NEBULA_COUNT} array={nebulaData.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={NEBULA_COUNT} array={nebulaData.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          size={0.04}
          transparent
          opacity={0.5}
          vertexColors
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Stars being born (bright spheres) */}
      <group ref={starsGroupRef}>
        {starData.map((star, i) => (
          <mesh key={i} position={[star.x, star.y, star.z]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial
              color="#FFFFFF"
              transparent
              opacity={0.5}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Central dominant star glow (appears at 70%+) */}
      <mesh ref={centralStarRef} position={[0, 2.0, 0]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color="#FFD700"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Protoplanetary disc (forms at 70%+) */}
      <points ref={discRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={DISC_COUNT} array={discData.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          color="#FFD700"
          size={0.04}
          transparent
          opacity={0}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Ambient glow shell */}
      <mesh position={[0, 2.0, 0]}>
        <sphereGeometry args={[2.5, 12, 12]} />
        <meshBasicMaterial
          color="#6633CC"
          transparent
          opacity={0.03 + (progress / 100) * 0.04}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Progress text */}
      <Html position={[0, -0.2, 3.2]} center>
        <div className="text-xs font-mono select-none pointer-events-none"
          style={{ color: '#FF88AA', textShadow: '0 0 10px #FF88AA88, 0 0 20px #6633CC44' }}
        >
          {progress > 70 ? `star ignition ${Math.round(progress)}%` : progress > 0 ? `accreting ${Math.round(progress)}%` : 'seeding nebula...'}
        </div>
      </Html>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 7: CHRONO FORGE
// ╔═══════════════════════════════════════════════════════════╗
// ║            ╱╲                                            ║
// ║           ╱::╲     sand flows from top to bottom         ║
// ║          ╱::::╲    clock hands orbit the center          ║
// ║         ╱::::::╲                                         ║
// ║         ╲::::::╱                                         ║
// ║    ─ ─ ─ ╲::::╱ ─ ─ ─  time ripples expand outward      ║
// ║      ○    ╲::╱    ○                                      ║
// ║            ╲╱           at 90%: hourglass shatters!      ║
// ╚═══════════════════════════════════════════════════════════╝
// Time is the forge's fuel. Each grain of sand is a moment
// being compressed into the eternal form of the conjured object.
// ═══════════════════════════════════════════════════════════════════════════════

function ChronoForgeEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const topConeRef = useRef<THREE.Mesh>(null)
  const bottomConeRef = useRef<THREE.Mesh>(null)
  const sandRef = useRef<THREE.Points>(null)
  const hand1Ref = useRef<THREE.Group>(null)
  const hand2Ref = useRef<THREE.Group>(null)
  const ripplesRef = useRef<THREE.Group>(null)
  const burstRef = useRef<THREE.Mesh>(null)

  const SAND_COUNT = 100
  const RIPPLE_COUNT = 5

  // ░ Sand particles — flow from top cone to bottom ░
  const sandData = useMemo(() => {
    const pos = new Float32Array(SAND_COUNT * 3)
    const phases = new Float32Array(SAND_COUNT)
    for (let i = 0; i < SAND_COUNT; i++) {
      // Start distributed in top cone area
      const t = Math.random() // 0=neck, 1=top
      const y = 1.5 + t * 1.2
      const maxR = t * 0.6 // wider at top
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * maxR
      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = Math.sin(angle) * r
      phases[i] = Math.random() // used for fall timing offset
    }
    return { positions: pos, phases }
  }, [])

  // ░ Track ripple spawn times ░
  const rippleState = useRef<Float32Array>(new Float32Array(RIPPLE_COUNT).fill(-10))
  const lastRippleSpawn = useRef(0)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const p = progress / 100
    const dt = Math.min(delta, 0.05)
    const shattered = p > 0.9
    const shatterAmount = shattered ? (p - 0.9) * 10 : 0 // 0-1 in last 10%

    // ░ Hourglass cones — shatter at 90%+ ░
    if (topConeRef.current) {
      if (shattered) {
        const jitter = Math.sin(t * 30) * shatterAmount * 0.3
        topConeRef.current.position.x = jitter
        topConeRef.current.scale.x = Math.max(0, 1 - shatterAmount)
        topConeRef.current.scale.z = Math.max(0, 1 - shatterAmount * 0.8)
      } else {
        topConeRef.current.position.x = 0
        topConeRef.current.scale.set(1, 1, 1)
      }
    }
    if (bottomConeRef.current) {
      if (shattered) {
        const jitter = Math.cos(t * 25) * shatterAmount * 0.3
        bottomConeRef.current.position.z = jitter
        bottomConeRef.current.scale.z = Math.max(0, 1 - shatterAmount)
        bottomConeRef.current.scale.x = Math.max(0, 1 - shatterAmount * 0.7)
      } else {
        bottomConeRef.current.position.z = 0
        bottomConeRef.current.scale.set(1, 1, 1)
      }
    }

    // ░ Sand particles — fall from top to bottom, recycle ░
    if (sandRef.current) {
      const pos = sandRef.current.geometry.attributes.position.array as Float32Array
      const fallSpeed = (0.5 + p * 2.0) // faster with progress

      for (let i = 0; i < SAND_COUNT; i++) {
        const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2

        // Fall
        pos[iy] -= fallSpeed * dt * (0.5 + sandData.phases[i])

        // Neck constriction: as particles approach y=1.5, pull toward center
        const distToNeck = Math.abs(pos[iy] - 1.5)
        if (distToNeck < 0.5) {
          pos[ix] *= 0.95
          pos[iz] *= 0.95
        }

        // Below neck: expand slightly for bottom cone
        if (pos[iy] < 1.5 && pos[iy] > 0.3) {
          const expansionFactor = 1 + (1.5 - pos[iy]) * 0.05
          pos[ix] *= expansionFactor > 1.002 ? 1.002 : expansionFactor
          pos[iz] *= expansionFactor > 1.002 ? 1.002 : expansionFactor
        }

        // Reset when reaching bottom
        if (pos[iy] < 0.3) {
          const tt = Math.random()
          const y = 1.5 + tt * 1.2
          const maxR = tt * 0.55
          const angle = Math.random() * Math.PI * 2
          const r = Math.random() * maxR
          pos[ix] = Math.cos(angle) * r
          pos[iy] = y
          pos[iz] = Math.sin(angle) * r
        }
      }
      sandRef.current.geometry.attributes.position.needsUpdate = true
    }

    // ░ Clock hands — orbit center ░
    const handSpeed = 1 + p * 3 // speed up with progress
    if (hand1Ref.current) {
      hand1Ref.current.rotation.y = t * handSpeed * 0.5
      hand1Ref.current.position.y = 1.5 + Math.sin(t * 0.7) * 0.1
    }
    if (hand2Ref.current) {
      hand2Ref.current.rotation.y = -t * handSpeed * 1.3
      hand2Ref.current.position.y = 1.5 + Math.cos(t * 0.9) * 0.1
    }

    // ░ Time ripples — spawn expanding torus rings ░
    if (ripplesRef.current) {
      const rippleInterval = Math.max(0.3, 1.2 - p * 0.9) // more frequent with progress
      if (t - lastRippleSpawn.current > rippleInterval) {
        // Find oldest ripple slot
        let oldestIdx = 0
        let oldestTime = rippleState.current[0]
        for (let i = 1; i < RIPPLE_COUNT; i++) {
          if (rippleState.current[i] < oldestTime) {
            oldestTime = rippleState.current[i]
            oldestIdx = i
          }
        }
        rippleState.current[oldestIdx] = t
        lastRippleSpawn.current = t
      }

      const children = ripplesRef.current.children as THREE.Mesh[]
      for (let i = 0; i < Math.min(children.length, RIPPLE_COUNT); i++) {
        const ring = children[i]
        const spawnTime = rippleState.current[i]
        const age = t - spawnTime

        if (age < 3) {
          const expansionRate = 0.8 + p * 0.5
          const scale = 0.5 + age * expansionRate
          ring.scale.set(scale, scale, scale)
          ring.visible = true
          const mat = ring.material as THREE.MeshBasicMaterial
          mat.opacity = Math.max(0, 0.4 * (1 - age / 3))
        } else {
          ring.visible = false
        }
      }
    }

    // ░ Final time-burst sphere ░
    if (burstRef.current) {
      if (shattered) {
        const burstScale = shatterAmount * 4
        burstRef.current.scale.setScalar(burstScale)
        const mat = burstRef.current.material as THREE.MeshBasicMaterial
        mat.opacity = Math.max(0, 0.5 * (1 - shatterAmount))
        burstRef.current.visible = true
      } else {
        burstRef.current.visible = false
      }
    }
  })

  return (
    <group position={position}>
      {/* Top cone (pointing down) */}
      <mesh ref={topConeRef} position={[0, 2.15, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.7, 1.3, 12, 1, true]} />
        <meshBasicMaterial color="#4488FF" transparent opacity={0.2} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Bottom cone (pointing up) */}
      <mesh ref={bottomConeRef} position={[0, 0.85, 0]}>
        <coneGeometry args={[0.7, 1.3, 12, 1, true]} />
        <meshBasicMaterial color="#4488FF" transparent opacity={0.2} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Neck ring where cones meet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.5, 0]}>
        <ringGeometry args={[0.05, 0.12, 16]} />
        <meshBasicMaterial color="#AABBCC" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* Sand particles */}
      <points ref={sandRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={SAND_COUNT} array={sandData.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          color="#FFD700"
          size={0.035}
          transparent
          opacity={0.8}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Clock hand 1 — longer, slower */}
      <group ref={hand1Ref} position={[0, 1.5, 0]}>
        <mesh position={[0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.015, 0.01, 1.2, 6]} />
          <meshBasicMaterial color="#AABBCC" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>

      {/* Clock hand 2 — shorter, faster */}
      <group ref={hand2Ref} position={[0, 1.5, 0]}>
        <mesh position={[0.4, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.008, 0.8, 6]} />
          <meshBasicMaterial color="#00DDFF" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>

      {/* Time ripple rings */}
      <group ref={ripplesRef}>
        {Array.from({ length: RIPPLE_COUNT }, (_, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.5, 0]}>
            <torusGeometry args={[1, 0.02, 8, 32]} />
            <meshBasicMaterial color="#00DDFF" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* Final time-burst sphere */}
      <mesh ref={burstRef} position={[0, 1.5, 0]} visible={false}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#FFD700" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Ground glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.5, 1.8, 24, 1, 0, (progress / 100) * Math.PI * 2]} />
        <meshBasicMaterial color="#4488FF" transparent opacity={0.25} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* Progress text */}
      <Html position={[0, -0.1, 2.0]} center>
        <div className="text-xs font-mono select-none pointer-events-none"
          style={{ color: '#FFD700', textShadow: '0 0 10px #FFD70088, 0 0 20px #4488FF44' }}
        >
          {progress > 90 ? `time fracture! ${Math.round(progress)}%` : progress > 0 ? `forging ${Math.round(progress)}%` : 'winding time...'}
        </div>
      </Html>
    </group>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// EFFECT 8: ABYSSAL EMERGENCE
// ╔═══════════════════════════════════════════════════════════╗
// ║         ~~~~~~~~~~~~                                     ║
// ║       ╱    ╱│  ╲   ╲    tentacles rise from portal       ║
// ║      ╱   ╱  │   ╲   ╲                                    ║
// ║     │  ╱   (◉)   ╲  │   eldritch eye opens at 60%       ║
// ║      ╲   ╲  │  ╱   ╱                                     ║
// ║       ╲    ╲│╱   ╱    dark particles spiral upward       ║
// ║     ████████████████                                     ║
// ║     ██ DARK PORTAL ██   pulsing ground ring              ║
// ║     ████████████████                                     ║
// ╚═══════════════════════════════════════════════════════════╝
// From the abyss, form rises. Lovecraftian, dramatic, dark.
// The portal opens, tentacles probe reality, the eye watches.
// What is being conjured was always there, waiting to emerge.
// ═══════════════════════════════════════════════════════════════════════════════

function AbyssalEmergenceEffect({ position, progress }: Omit<ConjureVFXProps, 'vfxType'>) {
  const portalRef = useRef<THREE.Mesh>(null)
  const tentaclesRef = useRef<THREE.Group>(null)
  const spiralRef = useRef<THREE.Points>(null)
  const eyeGroupRef = useRef<THREE.Group>(null)
  const eyeLeftRef = useRef<THREE.Mesh>(null)
  const eyeRightRef = useRef<THREE.Mesh>(null)
  const eyeIrisRef = useRef<THREE.Mesh>(null)

  const TENTACLE_COUNT = 8
  const SEGMENTS_PER_TENTACLE = 12
  const SPIRAL_COUNT = 200

  // ░ Tentacle parameters — each unique personality ░
  const tentacleParams = useMemo(() => {
    return Array.from({ length: TENTACLE_COUNT }, (_, i) => ({
      baseAngle: (i / TENTACLE_COUNT) * Math.PI * 2,
      amplitude: 0.3 + Math.random() * 0.4,
      frequency: 1.5 + Math.random() * 1.5,
      phase: Math.random() * Math.PI * 2,
      maxHeight: 1.5 + Math.random() * 2.0,
      wavePhaseX: Math.random() * Math.PI * 2,
      wavePhaseZ: Math.random() * Math.PI * 2,
      thickness: 0.04 + Math.random() * 0.03,
    }))
  }, [])

  // ░ Spiral particle data ░
  const spiralData = useMemo(() => {
    const pos = new Float32Array(SPIRAL_COUNT * 3)
    const phases = new Float32Array(SPIRAL_COUNT)
    const radii = new Float32Array(SPIRAL_COUNT)
    const speeds = new Float32Array(SPIRAL_COUNT)

    for (let i = 0; i < SPIRAL_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 0.3 + Math.random() * 1.2
      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = Math.random() * 3
      pos[i * 3 + 2] = Math.sin(angle) * r
      phases[i] = angle
      radii[i] = r
      speeds[i] = 0.5 + Math.random() * 1.5
    }
    return { positions: pos, phases, radii, speeds }
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const p = progress / 100
    const dt = Math.min(delta, 0.05)

    // ░ Portal ring pulse ░
    if (portalRef.current) {
      const pulse = 1 + Math.sin(t * 2) * 0.08 + Math.sin(t * 3.7) * 0.04
      portalRef.current.scale.set(pulse, pulse, 1)
      const mat = portalRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.3 + p * 0.3 + Math.sin(t * 1.5) * 0.05
    }

    // ░ Tentacles: sinusoidal weaving, rise with progress ░
    if (tentaclesRef.current) {
      const children = tentaclesRef.current.children
      let segIdx = 0

      const convergeFactor = p > 0.8 ? (p - 0.8) * 5 : 0 // 0-1 in last 20%
      const heightMultiplier = 0.3 + p * 0.7 // tentacles extend with progress

      for (let ti = 0; ti < TENTACLE_COUNT; ti++) {
        const tp = tentacleParams[ti]

        for (let si = 0; si < SEGMENTS_PER_TENTACLE; si++) {
          if (segIdx >= children.length) break
          const segment = children[segIdx] as THREE.Mesh

          const segFraction = si / SEGMENTS_PER_TENTACLE
          const y = segFraction * tp.maxHeight * heightMultiplier

          // Base position on portal circle
          const baseR = 0.8
          const baseX = Math.cos(tp.baseAngle) * baseR
          const baseZ = Math.sin(tp.baseAngle) * baseR

          // Sinusoidal weaving — more pronounced higher up
          const waveStrength = segFraction * tp.amplitude
          const wx = Math.sin(t * tp.frequency + tp.wavePhaseX + segFraction * 4) * waveStrength
          const wz = Math.cos(t * tp.frequency * 0.8 + tp.wavePhaseZ + segFraction * 3) * waveStrength

          // Converge toward center at 80%+
          const convergeX = -baseX * convergeFactor * segFraction * 0.8
          const convergeZ = -baseZ * convergeFactor * segFraction * 0.8

          segment.position.set(
            baseX + wx + convergeX,
            y + 0.02,
            baseZ + wz + convergeZ,
          )

          // Scale: thinner toward tip
          const taperScale = (1 - segFraction * 0.7) * tp.thickness * 15
          segment.scale.set(taperScale, 1, taperScale)

          // Subtle opacity pulse per segment
          const mat = segment.material as THREE.MeshBasicMaterial
          mat.opacity = (0.3 + Math.sin(t * 2 + si * 0.5 + tp.phase) * 0.15) * (0.5 + p * 0.5)

          segIdx++
        }
      }
    }

    // ░ Spiral particles — upward vortex ░
    if (spiralRef.current) {
      const pos = spiralRef.current.geometry.attributes.position.array as Float32Array
      for (let i = 0; i < SPIRAL_COUNT; i++) {
        spiralData.phases[i] += spiralData.speeds[i] * dt
        const r = spiralData.radii[i] * (0.6 + Math.sin(spiralData.phases[i] * 0.3) * 0.4)

        pos[i * 3] = Math.cos(spiralData.phases[i]) * r
        pos[i * 3 + 1] += dt * (0.3 + p * 0.7)
        pos[i * 3 + 2] = Math.sin(spiralData.phases[i]) * r

        // Reset when too high
        if (pos[i * 3 + 1] > 4) {
          pos[i * 3 + 1] = 0.1
          spiralData.radii[i] = 0.3 + Math.random() * 1.2
        }
      }
      spiralRef.current.geometry.attributes.position.needsUpdate = true
    }

    // ░ Eldritch eye — opens at 60%+ ░
    if (eyeGroupRef.current) {
      const eyeOpen = p > 0.6 ? Math.min(1, (p - 0.6) * 2.5) : 0

      // Eye position: float up
      eyeGroupRef.current.position.y = 2.0 + Math.sin(t * 0.5) * 0.1
      eyeGroupRef.current.visible = eyeOpen > 0

      // Slit opening: rotate half-spheres apart
      if (eyeLeftRef.current && eyeRightRef.current) {
        const openAngle = eyeOpen * 0.4 // radians of opening
        eyeLeftRef.current.rotation.x = -openAngle
        eyeRightRef.current.rotation.x = openAngle
      }

      // Iris pulse
      if (eyeIrisRef.current) {
        const irisScale = eyeOpen * (0.08 + Math.sin(t * 3) * 0.02)
        eyeIrisRef.current.scale.setScalar(Math.max(0.001, irisScale))
        const mat = eyeIrisRef.current.material as THREE.MeshBasicMaterial
        mat.opacity = eyeOpen * 0.9
      }
    }
  })

  return (
    <group position={position}>
      {/* Dark portal on ground */}
      <mesh ref={portalRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.6, 1.3, 32]} />
        <meshBasicMaterial
          color="#6600AA"
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Portal inner darkness */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.65, 32]} />
        <meshBasicMaterial color="#0A0A1A" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Portal outer glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[1.2, 1.8, 32]} />
        <meshBasicMaterial
          color="#008888"
          transparent
          opacity={0.1 + (progress / 100) * 0.15}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Tentacles — each is a series of small cone segments */}
      <group ref={tentaclesRef}>
        {Array.from({ length: TENTACLE_COUNT * SEGMENTS_PER_TENTACLE }, (_, i) => (
          <mesh key={i}>
            <coneGeometry args={[0.03, 0.2, 6]} />
            <meshBasicMaterial
              color="#004422"
              transparent
              opacity={0.35}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      {/* Dark spiral particles */}
      <points ref={spiralRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={SPIRAL_COUNT} array={spiralData.positions} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial
          color="#008888"
          size={0.04}
          transparent
          opacity={0.4}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Eldritch eye — two half-spheres + red iris */}
      <group ref={eyeGroupRef} position={[0, 2.0, 0]} visible={false}>
        {/* Eye shell (dark) */}
        <mesh>
          <sphereGeometry args={[0.25, 12, 12]} />
          <meshBasicMaterial color="#0A0A1A" transparent opacity={0.7} />
        </mesh>
        {/* Upper eyelid */}
        <mesh ref={eyeLeftRef} position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial color="#004422" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        {/* Lower eyelid */}
        <mesh ref={eyeRightRef} position={[0, -0.02, 0]} rotation={[Math.PI, 0, 0]}>
          <sphereGeometry args={[0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial color="#004422" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        {/* Iris — blazing red */}
        <mesh ref={eyeIrisRef} position={[0, 0, 0.24]}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial
            color="#FF0000"
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* Ambient abyss glow */}
      <mesh position={[0, 1.0, 0]}>
        <sphereGeometry args={[1.5, 12, 12]} />
        <meshBasicMaterial
          color="#6600AA"
          transparent
          opacity={0.02 + (progress / 100) * 0.04}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Progress text */}
      <Html position={[0, -0.2, 1.8]} center>
        <div className="text-xs font-mono select-none pointer-events-none"
          style={{ color: '#6600AA', textShadow: '0 0 10px #6600AA88, 0 0 20px #FF000044' }}
        >
          {progress > 80 ? `convergence ${Math.round(progress)}%` : progress > 60 ? `the eye opens... ${Math.round(progress)}%` : progress > 0 ? `summoning ${Math.round(progress)}%` : 'opening the abyss...'}
        </div>
      </Html>
    </group>
  )
}


// ▓▓▓▓【V̸F̸X̸】▓▓▓▓ॐ▓▓▓▓【C̸O̸N̸J̸U̸R̸E̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓

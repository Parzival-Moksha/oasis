'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getPortalGateLabel, type PortalGate } from '../../lib/portal-gates'

interface PortalGateVisualProps {
  gate: PortalGate
}

function PortalLabel({ gate }: { gate: PortalGate }) {
  return (
    <Html position={[0, 3.15, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          color: gate.inert ? '#a8b1c5' : '#f8fbff',
          fontSize: 12,
          fontWeight: 700,
          textShadow: '0 0 8px rgba(0,0,0,0.95), 0 0 14px rgba(88,166,255,0.85)',
          whiteSpace: 'nowrap',
          letterSpacing: 0,
          opacity: gate.inert ? 0.72 : 0.95,
        }}
      >
        {getPortalGateLabel(gate)}
      </div>
    </Html>
  )
}

type PortalMood = 'arcane' | 'void' | 'hologram' | 'solar' | 'rift' | 'forest' | 'water' | 'clockwork'

const MOOD_COLORS: Record<
  PortalMood,
  { primary: string; secondary: string; core: string; dark: string; stone: string; ember: string }
> = {
  arcane: { primary: '#58d5ff', secondary: '#fff5c2', core: '#063a56', dark: '#020917', stone: '#657184', ember: '#bdf7ff' },
  void: { primary: '#9f7cff', secondary: '#5ff0ff', core: '#05030b', dark: '#010006', stone: '#4d425f', ember: '#dacbff' },
  hologram: { primary: '#6effe8', secondary: '#ffffff', core: '#023944', dark: '#011113', stone: '#385d65', ember: '#d7fffb' },
  solar: { primary: '#ffb84a', secondary: '#fff3b0', core: '#ff5a24', dark: '#1b0700', stone: '#80623a', ember: '#fff0bf' },
  rift: { primary: '#ff4fd8', secondary: '#76f8ff', core: '#17001f', dark: '#08000c', stone: '#5f4568', ember: '#ffd4fa' },
  forest: { primary: '#6ee7b7', secondary: '#dcfce7', core: '#052e16', dark: '#02140a', stone: '#36533b', ember: '#bbf7d0' },
  water: { primary: '#7dd3fc', secondary: '#e0f2fe', core: '#082f49', dark: '#011827', stone: '#2f5f72', ember: '#bae6fd' },
  clockwork: { primary: '#facc15', secondary: '#fef3c7', core: '#422006', dark: '#160a00', stone: '#8a642c', ember: '#fde68a' },
}

function seededRandom(seed: number) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

function makeStarPositions(seed: number, count: number, width: number, height: number, zSpread: number) {
  const random = seededRandom(seed)
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * width
    positions[index * 3 + 1] = (random() - 0.5) * height
    positions[index * 3 + 2] = -0.06 - random() * zSpread
  }
  return positions
}

function PortalStarfield({
  seed,
  color,
  accentColor,
  width = 1.65,
  height = 2.45,
  count = 86,
  depth = 0.32,
  drift = 0.025,
  inert,
}: {
  seed: number
  color: string
  accentColor?: string
  width?: number
  height?: number
  count?: number
  depth?: number
  drift?: number
  inert?: boolean
}) {
  const pointsRef = useRef<THREE.Points>(null)
  const deepPointsRef = useRef<THREE.Points>(null)
  const positions = useMemo(() => makeStarPositions(seed, count, width, height, depth), [count, depth, height, seed, width])
  const deepPositions = useMemo(
    () => makeStarPositions(seed + 97, Math.max(18, Math.floor(count * 0.55)), width * 0.58, height * 0.72, depth * 1.8),
    [count, depth, height, seed, width]
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (pointsRef.current) {
      pointsRef.current.rotation.z = Math.sin(t * 0.12 + seed) * 0.08
      pointsRef.current.position.z = -0.05 + Math.sin(t * 0.55 + seed) * drift
      pointsRef.current.scale.setScalar(1 + Math.sin(t * 0.8 + seed) * 0.025)
    }
    if (deepPointsRef.current) {
      deepPointsRef.current.rotation.z = -t * 0.045 - seed * 0.01
      deepPointsRef.current.position.z = -0.22 + Math.cos(t * 0.36 + seed) * drift * 1.8
      deepPointsRef.current.scale.setScalar(0.74 + Math.sin(t * 0.5 + seed) * 0.04)
    }
  })

  return (
    <group>
      <points ref={deepPointsRef} position={[0, 0, -0.22]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[deepPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={accentColor ?? color}
          size={inert ? 0.018 : 0.026}
          sizeAttenuation
          transparent
          opacity={inert ? 0.16 : 0.46}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points ref={pointsRef} position={[0, 0, -0.05]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={inert ? 0.022 : 0.034}
          sizeAttenuation
          transparent
          opacity={inert ? 0.3 : 0.86}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

function EnergyVeil({
  mood,
  shape = 'circle',
  scale = [1, 1, 1],
  opacity = 0.28,
  inert,
}: {
  mood: PortalMood
  shape?: 'circle' | 'plane'
  scale?: [number, number, number]
  opacity?: number
  inert?: boolean
}) {
  const colors = MOOD_COLORS[mood]
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.elapsedTime
    meshRef.current.rotation.z = Math.sin(t * 0.42) * 0.08
    meshRef.current.scale.set(scale[0] * (1 + Math.sin(t * 1.7) * 0.025), scale[1] * (1 + Math.cos(t * 1.3) * 0.018), scale[2])
  })

  return (
    <mesh ref={meshRef} position={[0, 0, -0.035]}>
      {shape === 'circle' ? <circleGeometry args={[0.92, 96]} /> : <planeGeometry args={[1.2, 2.28]} />}
      <meshBasicMaterial
        color={colors.core}
        transparent
        opacity={inert ? opacity * 0.35 : opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

function PortalDepthTunnel({
  mood,
  inert,
  elongated = false,
  rings = 7,
  radius = 0.78,
  zStep = 0.085,
}: {
  mood: PortalMood
  inert?: boolean
  elongated?: boolean
  rings?: number
  radius?: number
  zStep?: number
}) {
  const tunnelRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!tunnelRef.current) return
    const t = clock.elapsedTime
    tunnelRef.current.rotation.z = t * (inert ? 0.035 : 0.11)
    tunnelRef.current.scale.setScalar(1 + Math.sin(t * 1.1) * (inert ? 0.008 : 0.022))
  })

  return (
    <group ref={tunnelRef} scale={elongated ? [0.7, 1.18, 1] : [1, 1, 1]}>
      {Array.from({ length: rings }, (_, index) => {
        const depthScale = 1 - index * 0.07
        const opacity = (inert ? 0.08 : 0.25) * (1 - index / (rings + 1))
        return (
          <mesh
            key={index}
            position={[0, 0, -0.06 - index * zStep]}
            rotation={[0, 0, index * 0.32]}
            scale={[depthScale, depthScale, 1]}
          >
            <ringGeometry args={[radius + index * 0.02, radius + 0.035 + index * 0.02, index % 2 ? 8 : 72]} />
            <meshBasicMaterial
              color={index % 2 ? colors.secondary : colors.primary}
              transparent
              opacity={opacity}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function RimHalo({
  mood,
  inert,
  scale = [1, 1, 1],
  radius = 0.9,
  thickness = 0.08,
  opacity = 0.34,
}: {
  mood: PortalMood
  inert?: boolean
  scale?: [number, number, number]
  radius?: number
  thickness?: number
  opacity?: number
}) {
  const haloRef = useRef<THREE.Mesh>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!haloRef.current) return
    const t = clock.elapsedTime
    haloRef.current.rotation.z = Math.sin(t * 0.22) * 0.05
    haloRef.current.scale.set(scale[0] * (1 + Math.sin(t * 1.25) * 0.03), scale[1] * (1 + Math.cos(t * 1.05) * 0.025), scale[2])
  })

  return (
    <mesh ref={haloRef} position={[0, 0, 0.045]}>
      <ringGeometry args={[radius, radius + thickness, 112]} />
      <meshBasicMaterial
        color={colors.secondary}
        transparent
        opacity={inert ? opacity * 0.34 : opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

function OrbitingParticles({
  mood,
  inert,
  count = 20,
  radius = 0.9,
  elongated = false,
  seed = 5,
}: {
  mood: PortalMood
  inert?: boolean
  count?: number
  radius?: number
  elongated?: boolean
  seed?: number
}) {
  const particlesRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const particles = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * Math.PI * 2 + random() * 0.16,
      radius: radius * (0.82 + random() * 0.32),
      size: 0.014 + random() * 0.026,
      z: -0.02 + random() * 0.16,
    }))
  }, [count, radius, seed])

  useFrame(({ clock }) => {
    if (!particlesRef.current) return
    const t = clock.elapsedTime
    particlesRef.current.rotation.z = t * (inert ? -0.05 : -0.18)
    particlesRef.current.position.z = Math.sin(t * 0.7 + seed) * 0.025
  })

  return (
    <group ref={particlesRef} scale={elongated ? [0.74, 1.18, 1] : [1, 1, 1]}>
      {particles.map((particle, index) => (
        <mesh
          key={index}
          position={[Math.cos(particle.angle) * particle.radius, Math.sin(particle.angle) * particle.radius, particle.z]}
        >
          <sphereGeometry args={[particle.size, 8, 8]} />
          <meshBasicMaterial
            color={index % 3 === 0 ? colors.secondary : colors.ember}
            transparent
            opacity={inert ? 0.2 : 0.82}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

function RuneRing({
  radius,
  count,
  mood,
  inert,
  elongated = false,
}: {
  radius: number
  count: number
  mood: PortalMood
  inert?: boolean
  elongated?: boolean
}) {
  const ringRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!ringRef.current) return
    ringRef.current.rotation.z = clock.elapsedTime * (inert ? 0.06 : 0.18)
  })

  return (
    <group ref={ringRef} scale={elongated ? [0.78, 1.18, 1] : [1, 1, 1]}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        const x = Math.cos(angle) * radius
        const y = Math.sin(angle) * radius
        const longRune = index % 3 === 0
        return (
          <mesh key={index} position={[x, y, 0.035]} rotation={[0, 0, angle]}>
            <boxGeometry args={[longRune ? 0.12 : 0.055, 0.025, 0.035]} />
            <meshBasicMaterial
              color={longRune ? colors.secondary : colors.primary}
              transparent
              opacity={inert ? 0.22 : 0.74}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function CrystalHalo({ mood, inert, radius = 1.18, count = 8 }: { mood: PortalMood; inert?: boolean; radius?: number; count?: number }) {
  const haloRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!haloRef.current) return
    haloRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.3) * 0.12
  })

  return (
    <group ref={haloRef}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        const x = Math.cos(angle) * radius
        const y = Math.sin(angle) * radius
        const size = index % 2 === 0 ? 0.18 : 0.11
        return (
          <mesh key={index} position={[x, y, 0.06]} rotation={[0.4, 0.2, angle]}>
            <octahedronGeometry args={[size, 0]} />
            <meshBasicMaterial
              color={index % 2 === 0 ? colors.primary : colors.secondary}
              transparent
              opacity={inert ? 0.28 : 0.78}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function SmokeWisps({ mood, inert }: { mood: PortalMood; inert?: boolean }) {
  const smokeRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!smokeRef.current) return
    const t = clock.elapsedTime
    smokeRef.current.rotation.z = Math.sin(t * 0.28) * 0.06
    smokeRef.current.position.y = -0.08 + Math.sin(t * 0.6) * 0.04
  })

  return (
    <group ref={smokeRef} position={[0, -0.08, -0.01]}>
      {[-0.78, -0.48, -0.16, 0.2, 0.52, 0.82].map((x, index) => (
        <mesh
          key={index}
          position={[x, -0.76 + index * 0.15, -0.02 - index * 0.012]}
          scale={[0.42 + index * 0.065, 0.2 + (index % 2) * 0.08, 1]}
          rotation={[0, 0, x + index * 0.22]}
        >
          <circleGeometry args={[0.5, 36]} />
          <meshBasicMaterial
            color={index % 3 === 0 ? colors.secondary : index % 2 ? colors.primary : colors.dark}
            transparent
            opacity={inert ? 0.06 : 0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

function StoneSegmentRing({ mood, inert, elongated = false }: { mood: PortalMood; inert?: boolean; elongated?: boolean }) {
  const colors = MOOD_COLORS[mood]
  return (
    <group scale={elongated ? [0.82, 1.22, 1] : [1, 1, 1]}>
      {Array.from({ length: 20 }, (_, index) => {
        const angle = (index / 20) * Math.PI * 2
        const x = Math.cos(angle) * 1.02
        const y = Math.sin(angle) * 1.02
        return (
          <mesh key={index} position={[x, y, -0.02]} rotation={[0, 0, angle]}>
            <boxGeometry args={[index % 4 === 0 ? 0.3 : 0.2, 0.11, 0.2]} />
            <meshBasicMaterial color={index % 5 === 0 ? colors.primary : colors.stone} transparent opacity={inert ? 0.48 : 0.86} />
          </mesh>
        )
      })}
    </group>
  )
}

function ThresholdRing({ inert }: { inert?: boolean }) {
  const color = inert ? '#7f8ea3' : MOOD_COLORS.arcane.primary
  return (
    <group position={[0, 1.55, 0]}>
      <StoneSegmentRing mood="arcane" inert={inert} />
      <PortalDepthTunnel mood="arcane" inert={inert} elongated rings={8} radius={0.58} zStep={0.075} />
      <RimHalo mood="arcane" inert={inert} scale={[0.78, 1.18, 1]} radius={0.82} thickness={0.16} opacity={0.28} />
      <mesh>
        <torusGeometry args={[0.9, 0.09, 16, 96]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.58 : 0.95} />
      </mesh>
      <mesh scale={[0.72, 1.18, 1]}>
        <torusGeometry args={[0.88, 0.022, 8, 72]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={inert ? 0.18 : 0.7} blending={THREE.AdditiveBlending} />
      </mesh>
      <EnergyVeil mood="arcane" scale={[0.82, 1.14, 1]} opacity={0.32} inert={inert} />
      <PortalStarfield seed={11} color="#d9fbff" accentColor="#fff5c2" width={1.38} height={1.9} count={132} depth={0.54} inert={inert} />
      <RuneRing mood="arcane" radius={0.74} count={24} inert={inert} elongated />
      <OrbitingParticles mood="arcane" inert={inert} radius={0.84} count={28} elongated seed={111} />
      <CrystalHalo mood="arcane" inert={inert} radius={1.22} count={6} />
      <mesh position={[0, 0, 0.02]} scale={[0.52, 0.52, 1]}>
        <ringGeometry args={[0.44, 0.52, 72]} />
        <meshBasicMaterial color="#fff5c2" transparent opacity={inert ? 0.16 : 0.48} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[0, -1.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 1.28, 96]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.12 : 0.34} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function VoidDoor({ inert }: { inert?: boolean }) {
  const frameColor = inert ? '#6d7484' : MOOD_COLORS.void.primary
  return (
    <group position={[0, 1.45, 0]}>
      <SmokeWisps mood="void" inert={inert} />
      <mesh position={[0, 0, -0.025]} scale={[1.08, 2.56, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#05030b" transparent opacity={inert ? 0.52 : 0.88} side={THREE.DoubleSide} />
      </mesh>
      <PortalDepthTunnel mood="void" inert={inert} elongated rings={9} radius={0.42} zStep={0.095} />
      <RimHalo mood="void" inert={inert} scale={[0.78, 1.42, 1]} radius={0.5} thickness={0.11} opacity={0.38} />
      <PortalStarfield seed={29} color="#d2c5ff" accentColor="#5ff0ff" width={1.02} height={2.42} count={146} depth={0.74} inert={inert} />
      <mesh position={[-0.62, 0, 0]}>
        <boxGeometry args={[0.18, 2.82, 0.24]} />
        <meshBasicMaterial color="#2d2639" transparent opacity={inert ? 0.62 : 0.92} />
      </mesh>
      <mesh position={[0.62, 0, 0]}>
        <boxGeometry args={[0.18, 2.82, 0.24]} />
        <meshBasicMaterial color="#2d2639" transparent opacity={inert ? 0.62 : 0.92} />
      </mesh>
      <mesh position={[-0.64, 0, 0.08]}>
        <boxGeometry args={[0.05, 2.58, 0.08]} />
        <meshBasicMaterial color={frameColor} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0.64, 0, 0.08]}>
        <boxGeometry args={[0.05, 2.58, 0.08]} />
        <meshBasicMaterial color={frameColor} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0, 1.34, 0]}>
        <boxGeometry args={[1.42, 0.2, 0.26]} />
        <meshBasicMaterial color="#3c314b" transparent opacity={inert ? 0.62 : 0.92} />
      </mesh>
      <mesh position={[0, -1.34, 0]}>
        <boxGeometry args={[1.5, 0.18, 0.26]} />
        <meshBasicMaterial color="#2a2336" transparent opacity={inert ? 0.5 : 0.82} />
      </mesh>
      {[-0.42, 0, 0.42].map((x, index) => (
        <mesh key={index} position={[x, 1.36, 0.12]} rotation={[0, 0, index * 0.4]}>
          <octahedronGeometry args={[0.1, 0]} />
          <meshBasicMaterial color={index === 1 ? '#5ff0ff' : frameColor} transparent opacity={inert ? 0.24 : 0.72} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <EnergyVeil mood="void" shape="plane" scale={[0.86, 1.08, 1]} opacity={0.2} inert={inert} />
      <OrbitingParticles mood="void" inert={inert} radius={0.52} count={24} elongated seed={229} />
      <mesh position={[0, 0.12, 0.02]} scale={[1, 1.22, 1]}>
        <ringGeometry args={[0.22, 0.48, 72]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.78} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.12, 0.03]} scale={[1, 1.22, 1]}>
        <ringGeometry args={[0.48, 0.54, 72]} />
        <meshBasicMaterial color="#5ff0ff" transparent opacity={inert ? 0.14 : 0.42} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

function HologramGate({ inert }: { inert?: boolean }) {
  const color = inert ? '#8a94a6' : MOOD_COLORS.hologram.primary
  return (
    <group position={[0, 1.48, 0]}>
      <PortalDepthTunnel mood="hologram" inert={inert} elongated rings={6} radius={0.7} zStep={0.07} />
      <PortalStarfield seed={41} color="#eaffff" accentColor="#6effe8" width={1.48} height={2.34} count={108} depth={0.48} inert={inert} />
      <mesh>
        <boxGeometry args={[1.7, 2.78, 0.035]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={inert ? 0.42 : 0.78} />
      </mesh>
      <mesh position={[0, 0, -0.018]}>
        <planeGeometry args={[1.5, 2.46]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.08 : 0.18} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {[-0.48, 0, 0.48].map(x => (
        <mesh key={`h-v-${x}`} position={[x, 0, 0.018]}>
          <boxGeometry args={[0.018, 2.58, 0.03]} />
          <meshBasicMaterial color={color} transparent opacity={0.34} />
        </mesh>
      ))}
      {[-0.72, 0, 0.72].map(y => (
        <mesh key={`h-h-${y}`} position={[0, y, 0.02]}>
          <boxGeometry args={[1.52, 0.018, 0.03]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={inert ? 0.18 : 0.34} />
        </mesh>
      ))}
      <RuneRing mood="hologram" radius={0.88} count={20} inert={inert} elongated />
      <OrbitingParticles mood="hologram" inert={inert} radius={0.78} count={18} elongated seed={341} />
      {[-0.72, 0.72].map((x, index) => (
        <mesh key={`side-node-${index}`} position={[x, 0.72 - index * 1.44, 0.06]}>
          <icosahedronGeometry args={[0.16, 0]} />
          <meshBasicMaterial color={index === 0 ? '#ffffff' : color} transparent opacity={inert ? 0.24 : 0.68} wireframe />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.04]} scale={[0.92, 1.28, 1]}>
        <ringGeometry args={[0.5, 0.56, 6]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.16 : 0.52} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <RimHalo mood="hologram" inert={inert} scale={[0.92, 1.28, 1]} radius={0.58} thickness={0.1} opacity={0.24} />
    </group>
  )
}

function SolarArch({ inert }: { inert?: boolean }) {
  const color = inert ? '#8c8370' : MOOD_COLORS.solar.primary
  const rays = Array.from({ length: 15 }, (_, index) => index)
  return (
    <group position={[0, 1.42, 0]}>
      <StoneSegmentRing mood="solar" inert={inert} elongated />
      <PortalDepthTunnel mood="solar" inert={inert} elongated rings={7} radius={0.56} zStep={0.065} />
      <RimHalo mood="solar" inert={inert} scale={[0.9, 1.3, 1]} radius={0.76} thickness={0.18} opacity={0.34} />
      <mesh scale={[0.9, 1.3, 1]}>
        <torusGeometry args={[0.82, 0.09, 16, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <PortalStarfield seed={59} color="#fff0bf" accentColor="#ff6a2b" width={1.2} height={1.94} count={118} depth={0.48} inert={inert} />
      <EnergyVeil mood="solar" scale={[0.72, 1.02, 1]} opacity={0.34} inert={inert} />
      <mesh position={[0, -1.08, 0]}>
        <boxGeometry args={[1.9, 0.16, 0.22]} />
        <meshBasicMaterial color="#ffe7a1" transparent opacity={inert ? 0.36 : 0.7} />
      </mesh>
      {rays.map(index => {
        const angle = Math.PI * (0.02 + index * 0.068)
        const x = Math.cos(angle) * 1.08
        const y = Math.sin(angle) * 1.38
        return (
          <mesh key={index} position={[x, y, 0]} rotation={[0, 0, angle]}>
            <coneGeometry args={[0.045, index % 2 ? 0.36 : 0.56, 4]} />
            <meshBasicMaterial color={index % 2 ? '#fff3b0' : '#ff6a2b'} transparent opacity={inert ? 0.28 : 0.74} blending={THREE.AdditiveBlending} />
          </mesh>
        )
      })}
      {Array.from({ length: 22 }, (_, index) => {
        const angle = (index / 22) * Math.PI * 2
        const radius = 0.42 + (index % 5) * 0.12
        return (
          <mesh key={`ember-${index}`} position={[Math.cos(angle) * radius, Math.sin(angle) * radius * 1.28, 0.055]}>
            <sphereGeometry args={[index % 3 === 0 ? 0.026 : 0.016, 8, 8]} />
            <meshBasicMaterial color={index % 2 ? '#fff3b0' : '#ff6a2b'} transparent opacity={inert ? 0.18 : 0.72} blending={THREE.AdditiveBlending} />
          </mesh>
        )
      })}
      <OrbitingParticles mood="solar" inert={inert} radius={0.74} count={30} elongated seed={459} />
      <mesh position={[0, -0.02, 0.02]}>
        <circleGeometry args={[0.66, 64]} />
        <meshBasicMaterial color="#ff6a2b" transparent opacity={inert ? 0.1 : 0.28} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

function RiftSlit({ inert }: { inert?: boolean }) {
  const color = inert ? '#87909e' : '#ff4fd8'
  const segments = [
    [-0.05, 0.96, -0.18],
    [0.08, 0.56, 0.14],
    [-0.04, 0.18, -0.1],
    [0.07, -0.22, 0.12],
    [-0.08, -0.64, -0.16],
    [0.02, -1.04, 0.08],
  ] as const
  return (
    <group position={[0, 1.52, 0]}>
      <SmokeWisps mood="rift" inert={inert} />
      <PortalDepthTunnel mood="rift" inert={inert} elongated rings={8} radius={0.36} zStep={0.09} />
      <PortalStarfield seed={73} color="#f8d6ff" accentColor="#76f8ff" width={0.88} height={2.82} count={126} depth={0.64} inert={inert} />
      <EnergyVeil mood="rift" shape="plane" scale={[0.38, 1.35, 1]} opacity={0.22} inert={inert} />
      {segments.map(([x, y, rot], index) => (
        <mesh key={index} position={[x, y, 0]} rotation={[0, 0, rot]}>
          <boxGeometry args={[index % 2 ? 0.07 : 0.14, 0.64, 0.065]} />
          <meshBasicMaterial color={index % 2 ? '#ffffff' : color} transparent opacity={inert ? 0.45 : 0.94} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.02]} scale={[0.45, 1.55, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#17001f" transparent opacity={inert ? 0.14 : 0.42} side={THREE.DoubleSide} />
      </mesh>
      {[-0.54, 0.52, -0.38, 0.42, -0.22, 0.24].map((x, index) => (
        <mesh key={`shard-${index}`} position={[x, 1.02 - index * 0.4, 0.04]} rotation={[0.4, 0.2, x]}>
          <tetrahedronGeometry args={[index % 2 ? 0.13 : 0.18, 0]} />
          <meshBasicMaterial color={index % 2 ? '#76f8ff' : color} transparent opacity={inert ? 0.28 : 0.72} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <mesh position={[0, 0.02, 0.055]} scale={[0.2, 1.62, 1]}>
        <ringGeometry args={[0.68, 0.78, 48]} />
        <meshBasicMaterial color="#76f8ff" transparent opacity={inert ? 0.1 : 0.34} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <RimHalo mood="rift" inert={inert} scale={[0.24, 1.64, 1]} radius={0.72} thickness={0.14} opacity={0.36} />
      <OrbitingParticles mood="rift" inert={inert} radius={0.56} count={26} elongated seed={573} />
    </group>
  )
}

function StargateVortex({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.48, 0]}>
      <StoneSegmentRing mood="arcane" inert={inert} />
      <PortalDepthTunnel mood="arcane" inert={inert} rings={11} radius={0.72} zStep={0.055} />
      <RimHalo mood="arcane" inert={inert} radius={0.96} thickness={0.2} opacity={0.38} />
      <PortalStarfield seed={89} color="#f8fbff" accentColor="#38bdf8" width={1.7} height={1.7} count={176} depth={0.9} inert={inert} />
      <mesh>
        <torusGeometry args={[1.02, 0.11, 18, 128]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={inert ? 0.5 : 0.95} />
      </mesh>
      <mesh scale={[0.82, 0.82, 1]} rotation={[0, 0, Math.PI / 8]}>
        <torusGeometry args={[0.95, 0.028, 10, 96]} />
        <meshBasicMaterial color="#f8fafc" transparent opacity={inert ? 0.18 : 0.72} blending={THREE.AdditiveBlending} />
      </mesh>
      <RuneRing mood="arcane" radius={0.96} count={32} inert={inert} />
      <OrbitingParticles mood="arcane" inert={inert} radius={1.05} count={36} seed={789} />
      <mesh position={[0, -1.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.82, 1.36, 120]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={inert ? 0.1 : 0.3} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function CrystalCavern({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.48, 0]}>
      <PortalDepthTunnel mood="rift" inert={inert} elongated rings={8} radius={0.58} zStep={0.08} />
      <EnergyVeil mood="rift" scale={[0.72, 1.18, 1]} opacity={0.28} inert={inert} />
      <PortalStarfield seed={97} color="#f5d0fe" accentColor="#bae6fd" width={1.28} height={2.24} count={134} depth={0.6} inert={inert} />
      <CrystalHalo mood="rift" inert={inert} radius={1.04} count={12} />
      {Array.from({ length: 9 }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1
        const y = -1.1 + index * 0.28
        const x = side * (0.46 + (index % 3) * 0.11)
        return (
          <mesh key={index} position={[x, y, 0.04]} rotation={[0.2, 0.3, side * 0.42]}>
            <octahedronGeometry args={[index % 3 === 0 ? 0.24 : 0.17, 0]} />
            <meshBasicMaterial
              color={index % 2 ? '#c084fc' : '#bae6fd'}
              transparent
              opacity={inert ? 0.32 : 0.82}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
      <RimHalo mood="rift" inert={inert} scale={[0.72, 1.34, 1]} radius={0.76} thickness={0.12} opacity={0.3} />
      <OrbitingParticles mood="rift" inert={inert} radius={0.72} count={28} elongated seed={897} />
    </group>
  )
}

function VerdantArch({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.42, 0]}>
      <SmokeWisps mood="forest" inert={inert} />
      <PortalDepthTunnel mood="forest" inert={inert} elongated rings={7} radius={0.58} zStep={0.07} />
      <EnergyVeil mood="forest" scale={[0.78, 1.18, 1]} opacity={0.24} inert={inert} />
      <PortalStarfield seed={107} color="#dcfce7" accentColor="#86efac" width={1.28} height={2.16} count={92} depth={0.4} inert={inert} />
      {[-0.78, 0.78].map((x, index) => (
        <group key={index} position={[x, -0.05, 0]}>
          <mesh rotation={[0, 0, x * 0.18]}>
            <cylinderGeometry args={[0.09, 0.17, 2.55, 10]} />
            <meshBasicMaterial color="#36533b" transparent opacity={inert ? 0.54 : 0.9} />
          </mesh>
          <mesh position={[0, 1.22, 0.02]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshBasicMaterial color="#22c55e" transparent opacity={inert ? 0.28 : 0.68} />
          </mesh>
        </group>
      ))}
      {Array.from({ length: 13 }, (_, index) => {
        const angle = Math.PI * (0.06 + index * 0.07)
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.78, Math.sin(angle) * 1.08, 0.04]} rotation={[0, 0, angle]}>
            <boxGeometry args={[0.2, 0.055, 0.09]} />
            <meshBasicMaterial color={index % 2 ? '#86efac' : '#36533b'} transparent opacity={inert ? 0.34 : 0.76} />
          </mesh>
        )
      })}
      <OrbitingParticles mood="forest" inert={inert} radius={0.78} count={34} elongated seed={907} />
      <RimHalo mood="forest" inert={inert} scale={[0.76, 1.22, 1]} radius={0.76} thickness={0.1} opacity={0.28} />
    </group>
  )
}

function MirrorPool({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.4, 0]}>
      <PortalDepthTunnel mood="water" inert={inert} elongated rings={10} radius={0.54} zStep={0.06} />
      <PortalStarfield seed={119} color="#e0f2fe" accentColor="#7dd3fc" width={1.18} height={2.25} count={104} depth={0.45} inert={inert} />
      <mesh position={[0, 0, -0.025]} scale={[0.76, 1.32, 1]}>
        <circleGeometry args={[0.88, 96]} />
        <meshBasicMaterial color="#082f49" transparent opacity={inert ? 0.32 : 0.68} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3].map(index => (
        <mesh key={index} position={[0, 0, 0.03 + index * 0.01]} scale={[0.72 + index * 0.12, 1.14 + index * 0.16, 1]}>
          <ringGeometry args={[0.42 + index * 0.08, 0.45 + index * 0.08, 96]} />
          <meshBasicMaterial color={index % 2 ? '#e0f2fe' : '#7dd3fc'} transparent opacity={inert ? 0.08 : 0.26} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <RimHalo mood="water" inert={inert} scale={[0.78, 1.28, 1]} radius={0.82} thickness={0.08} opacity={0.4} />
      <OrbitingParticles mood="water" inert={inert} radius={0.78} count={24} elongated seed={919} />
      <mesh position={[0, -1.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.94, 96]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={inert ? 0.08 : 0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function ClockworkIris({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.48, 0]}>
      <PortalDepthTunnel mood="clockwork" inert={inert} rings={8} radius={0.58} zStep={0.065} />
      <PortalStarfield seed={131} color="#fef3c7" accentColor="#facc15" width={1.22} height={1.72} count={88} depth={0.42} inert={inert} />
      <StoneSegmentRing mood="clockwork" inert={inert} />
      <RimHalo mood="clockwork" inert={inert} radius={0.86} thickness={0.14} opacity={0.34} />
      <mesh>
        <torusGeometry args={[0.88, 0.075, 10, 96]} />
        <meshBasicMaterial color="#facc15" transparent opacity={inert ? 0.46 : 0.88} />
      </mesh>
      {Array.from({ length: 18 }, (_, index) => {
        const angle = (index / 18) * Math.PI * 2
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.96, Math.sin(angle) * 0.96, 0.04]} rotation={[0, 0, angle]}>
            <boxGeometry args={[0.1, 0.24, 0.08]} />
            <meshBasicMaterial color={index % 2 ? '#fef3c7' : '#8a642c'} transparent opacity={inert ? 0.36 : 0.78} />
          </mesh>
        )
      })}
      {Array.from({ length: 7 }, (_, index) => (
        <mesh key={`iris-${index}`} position={[0, 0, 0.08]} rotation={[0, 0, (index / 7) * Math.PI * 2]}>
          <coneGeometry args={[0.22, 0.76, 3]} />
          <meshBasicMaterial color="#422006" transparent opacity={inert ? 0.34 : 0.72} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <OrbitingParticles mood="clockwork" inert={inert} radius={0.78} count={20} seed={931} />
    </group>
  )
}

function PortalGateVisualComponent({ gate }: PortalGateVisualProps) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const group = groupRef.current
    if (!group) return
    const t = clock.elapsedTime
    group.position.y = Math.sin(t * 1.4 + gate.position[0]) * 0.04
    group.scale.setScalar(gate.inert ? 0.94 : 1 + Math.sin(t * 2.2) * 0.015)
  })

  return (
    <group ref={groupRef} position={gate.position} rotation={[0, gate.rotationY ?? 0, 0]}>
      {gate.variant === 'threshold-ring' && <ThresholdRing inert={gate.inert} />}
      {gate.variant === 'void-door' && <VoidDoor inert={gate.inert} />}
      {gate.variant === 'hologram-gate' && <HologramGate inert={gate.inert} />}
      {gate.variant === 'solar-arch' && <SolarArch inert={gate.inert} />}
      {gate.variant === 'rift-slit' && <RiftSlit inert={gate.inert} />}
      {gate.variant === 'stargate-vortex' && <StargateVortex inert={gate.inert} />}
      {gate.variant === 'crystal-cavern' && <CrystalCavern inert={gate.inert} />}
      {gate.variant === 'verdant-arch' && <VerdantArch inert={gate.inert} />}
      {gate.variant === 'mirror-pool' && <MirrorPool inert={gate.inert} />}
      {gate.variant === 'clockwork-iris' && <ClockworkIris inert={gate.inert} />}
      <PortalLabel gate={gate} />
    </group>
  )
}

export const PortalGateVisual = memo(PortalGateVisualComponent)

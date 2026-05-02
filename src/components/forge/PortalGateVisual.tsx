'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useRef } from 'react'
import * as THREE from 'three'
import type { PortalGate } from '../../lib/portal-gates'

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
        {gate.targetWorldName || gate.variant.replace(/-/g, ' ')}
      </div>
    </Html>
  )
}

function ThresholdRing({ inert }: { inert?: boolean }) {
  const color = inert ? '#7f8ea3' : '#58d5ff'
  return (
    <group position={[0, 1.55, 0]}>
      <mesh>
        <torusGeometry args={[0.88, 0.045, 12, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.92} />
      </mesh>
      <mesh scale={[0.78, 1.22, 1]}>
        <torusGeometry args={[0.88, 0.014, 8, 60]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={inert ? 0.26 : 0.48} />
      </mesh>
      <mesh position={[0, 0, -0.018]}>
        <circleGeometry args={[0.82, 72]} />
        <meshBasicMaterial color="#063a56" transparent opacity={inert ? 0.16 : 0.34} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -1.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 1.12, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function VoidDoor({ inert }: { inert?: boolean }) {
  const frameColor = inert ? '#6d7484' : '#9f7cff'
  return (
    <group position={[0, 1.45, 0]}>
      <mesh position={[0, 0, -0.025]} scale={[1.08, 2.56, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#05030b" transparent opacity={inert ? 0.48 : 0.78} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-0.62, 0, 0]}>
        <boxGeometry args={[0.08, 2.72, 0.12]} />
        <meshBasicMaterial color={frameColor} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0.62, 0, 0]}>
        <boxGeometry args={[0.08, 2.72, 0.12]} />
        <meshBasicMaterial color={frameColor} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0, 1.34, 0]}>
        <boxGeometry args={[1.28, 0.08, 0.12]} />
        <meshBasicMaterial color={frameColor} transparent opacity={0.84} />
      </mesh>
      <mesh position={[0, -1.34, 0]}>
        <boxGeometry args={[1.28, 0.08, 0.12]} />
        <meshBasicMaterial color={frameColor} transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, 0.18, 0.02]}>
        <circleGeometry args={[0.28, 36]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function HologramGate({ inert }: { inert?: boolean }) {
  const color = inert ? '#8a94a6' : '#6effe8'
  return (
    <group position={[0, 1.48, 0]}>
      <mesh>
        <boxGeometry args={[1.62, 2.72, 0.035]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={inert ? 0.42 : 0.78} />
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
      <mesh position={[0, 0, -0.016]}>
        <planeGeometry args={[1.48, 2.44]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.08 : 0.16} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function SolarArch({ inert }: { inert?: boolean }) {
  const color = inert ? '#8c8370' : '#ffb84a'
  const rays = Array.from({ length: 9 }, (_, index) => index)
  return (
    <group position={[0, 1.42, 0]}>
      <mesh scale={[0.9, 1.3, 1]}>
        <torusGeometry args={[0.82, 0.052, 12, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, -1.08, 0]}>
        <boxGeometry args={[1.75, 0.12, 0.16]} />
        <meshBasicMaterial color="#ffe7a1" transparent opacity={inert ? 0.36 : 0.7} />
      </mesh>
      {rays.map(index => {
        const angle = Math.PI * (0.08 + index * 0.105)
        const x = Math.cos(angle) * 0.98
        const y = Math.sin(angle) * 1.28
        return (
          <mesh key={index} position={[x, y, 0]} rotation={[0, 0, angle]}>
            <boxGeometry args={[0.045, 0.34, 0.06]} />
            <meshBasicMaterial color="#fff3b0" transparent opacity={inert ? 0.32 : 0.72} />
          </mesh>
        )
      })}
      <mesh position={[0, -0.02, -0.02]}>
        <circleGeometry args={[0.66, 48]} />
        <meshBasicMaterial color="#ff6a2b" transparent opacity={inert ? 0.1 : 0.22} side={THREE.DoubleSide} />
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
      {segments.map(([x, y, rot], index) => (
        <mesh key={index} position={[x, y, 0]} rotation={[0, 0, rot]}>
          <boxGeometry args={[0.11, 0.58, 0.055]} />
          <meshBasicMaterial color={index % 2 ? '#ffffff' : color} transparent opacity={inert ? 0.45 : 0.88} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.02]} scale={[0.45, 1.55, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#17001f" transparent opacity={inert ? 0.14 : 0.34} side={THREE.DoubleSide} />
      </mesh>
      {[-0.42, 0.42, -0.28, 0.3].map((x, index) => (
        <mesh key={`shard-${index}`} position={[x, 0.75 - index * 0.48, 0.02]} rotation={[0, 0, x]}>
          <tetrahedronGeometry args={[0.11, 0]} />
          <meshBasicMaterial color={color} transparent opacity={inert ? 0.28 : 0.62} />
        </mesh>
      ))}
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
      <PortalLabel gate={gate} />
    </group>
  )
}

export const PortalGateVisual = memo(PortalGateVisualComponent)

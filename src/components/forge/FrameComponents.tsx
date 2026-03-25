'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FRAME COMPONENTS — Shared 3D picture frames for images + agent windows
// ─═̷─═̷─ॐ─═̷─═̷─ Extracted to break circular import with WorldObjects ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ═══════════════════════════════════════════════════════════════════════════
// FRAME STYLE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface FrameStyleDef {
  id: string
  label: string
  icon: string
  desc: string
}

export const FRAME_STYLES: FrameStyleDef[] = [
  { id: 'gilded',    label: 'Gilded',     icon: '🖼️', desc: 'Classic gold museum frame' },
  { id: 'neon',      label: 'Neon',       icon: '✨', desc: 'Glowing neon cyberpunk border' },
  { id: 'thin',      label: 'Minimal',    icon: '▫️', desc: 'Hairline black wire frame' },
  { id: 'baroque',   label: 'Baroque',    icon: '👑', desc: 'Thick ornate royal frame' },
  { id: 'hologram',  label: 'Hologram',   icon: '🔮', desc: 'Floating holographic projection' },
  { id: 'rustic',    label: 'Rustic',     icon: '🪵', desc: 'Weathered dark wood' },
  { id: 'ice',       label: 'Frozen',     icon: '🧊', desc: 'Translucent ice crystal frame' },
  { id: 'void',      label: 'Void',       icon: '🕳️', desc: 'Dark portal with swirling edge' },
]

// ═══════════════════════════════════════════════════════════════════════════
// FOUR-BAR FRAME — reusable box-based frame geometry
// ═══════════════════════════════════════════════════════════════════════════

export function FourBarFrame({ w, h, border, depth, color, roughness = 0.5, metalness = 0.3, emissive, emissiveIntensity = 0, opacity = 1, transparent = false }: {
  w: number; h: number; border: number; depth: number
  color: string; roughness?: number; metalness?: number
  emissive?: string; emissiveIntensity?: number; opacity?: number; transparent?: boolean
}) {
  const matProps = { color, roughness, metalness, ...(emissive && { emissive, emissiveIntensity }), ...(transparent && { transparent, opacity }) }
  return (
    <group position={[0, 0, -depth / 2]}>
      <mesh position={[0, (h + border) / 2, 0]}>
        <boxGeometry args={[w + border * 2, border, depth]} />
        <meshStandardMaterial {...matProps} />
      </mesh>
      <mesh position={[0, -(h + border) / 2, 0]}>
        <boxGeometry args={[w + border * 2, border, depth]} />
        <meshStandardMaterial {...matProps} />
      </mesh>
      <mesh position={[-(w + border) / 2, 0, 0]}>
        <boxGeometry args={[border, h, depth]} />
        <meshStandardMaterial {...matProps} />
      </mesh>
      <mesh position={[(w + border) / 2, 0, 0]}>
        <boxGeometry args={[border, h, depth]} />
        <meshStandardMaterial {...matProps} />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// NEON FRAME — pulsing cyberpunk border (turquoise, not purple)
// ═══════════════════════════════════════════════════════════════════════════

export function NeonFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    const t = Date.now() * 0.003
    const pulse = 1 + Math.sin(t) * 0.015
    groupRef.current.scale.set(pulse, pulse, 1)
  })
  const border = 0.015 * scale
  const depth = 0.008 * scale
  return (
    <group ref={groupRef}>
      <FourBarFrame w={w} h={h} border={border} depth={depth} color="#0ea5e9" roughness={0.1} metalness={0.9} emissive="#0ea5e9" emissiveIntensity={3} />
      <FourBarFrame w={w + border * 2} h={h + border * 2} border={border * 0.6} depth={depth * 0.5} color="#0284c7" roughness={0.2} metalness={0.5} emissive="#0284c7" emissiveIntensity={1.5} transparent opacity={0.6} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HOLOGRAM FRAME — floating corner brackets with scanline
// ═══════════════════════════════════════════════════════════════════════════

export function HologramFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    const t = Date.now() * 0.001
    groupRef.current.position.y = Math.sin(t * 1.5) * 0.02 * scale
    groupRef.current.rotation.z = Math.sin(t * 0.7) * 0.005
  })
  const gap = 0.03 * scale
  const cornerSize = 0.06 * scale
  const thickness = 0.008 * scale
  return (
    <group ref={groupRef}>
      {[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy], i) => (
        <group key={i} position={[sx * (w / 2 + gap), sy * (h / 2 + gap), 0]}>
          <mesh position={[sx * cornerSize / 2, 0, 0]}>
            <boxGeometry args={[cornerSize, thickness, thickness]} />
            <meshStandardMaterial color="#22D3EE" emissive="#22D3EE" emissiveIntensity={2} transparent opacity={0.8} metalness={0.9} roughness={0.1} />
          </mesh>
          <mesh position={[0, sy * cornerSize / 2, 0]}>
            <boxGeometry args={[thickness, cornerSize, thickness]} />
            <meshStandardMaterial color="#22D3EE" emissive="#22D3EE" emissiveIntensity={2} transparent opacity={0.8} metalness={0.9} roughness={0.1} />
          </mesh>
        </group>
      ))}
      <ScanlineBar w={w + gap * 2} h={h + gap * 2} scale={scale} />
    </group>
  )
}

function ScanlineBar({ w, h, scale }: { w: number; h: number; scale: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!ref.current) return
    const t = (Date.now() * 0.001) % 3 / 3
    ref.current.position.y = (t - 0.5) * h
    ;(ref.current.material as THREE.MeshStandardMaterial).opacity = 0.3 + Math.sin(t * Math.PI) * 0.3
  })
  return (
    <mesh ref={ref}>
      <planeGeometry args={[w, 0.005 * scale]} />
      <meshStandardMaterial color="#22D3EE" emissive="#22D3EE" emissiveIntensity={1} transparent opacity={0.3} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VOID FRAME — dark portal with swirling edge (turquoise accents, not purple)
// ═══════════════════════════════════════════════════════════════════════════

export function VoidFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.rotation.z = Math.sin(Date.now() * 0.0005) * 0.02
  })
  const border = 0.05 * scale
  const depth = 0.03 * scale
  return (
    <group ref={groupRef}>
      <FourBarFrame w={w} h={h} border={border} depth={depth} color="#0a0a0a" roughness={0.9} metalness={0.1} emissive="#0f766e" emissiveIntensity={0.4} />
      <FourBarFrame w={w} h={h} border={0.005 * scale} depth={0.003 * scale} color="#14b8a6" roughness={0.0} metalness={1.0} emissive="#14b8a6" emissiveIntensity={2.5} />
    </group>
  )
}

'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MISSION CARD 3D — A mission rendered as a physical object in the world
// ─═̷─═̷─ॐ─═̷─═̷─ Image plane + maturity-colored frame + priority bar ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { Text } from '@react-three/drei'

// ═══════════════════════════════════════════════════════════════════════════
// MATURITY ACCENT COLORS — one per band (0-8 maturity + 9 done zone)
// ═══════════════════════════════════════════════════════════════════════════
export const MATURITY_ACCENTS: Record<number, string> = {
  0: '#666666',  // Para
  1: '#0ea5e9',  // Pashyanti
  2: '#14b8a6',  // Madhyama
  3: '#f59e0b',  // Vaikhari
  4: '#22c55e',  // Built
  5: '#3b82f6',  // Reviewed
  6: '#06b6d4',  // Tested
  7: '#ec4899',  // Gamertested
  8: '#fbbf24',  // Carbontested
  9: '#a3e635',  // Done zone — lime green victory
}

export interface MissionData {
  id: number
  name: string
  description: string | null
  status: string
  maturityLevel: number
  urgency: number
  easiness: number
  impact: number
  priority: number | null
  score: number | null
  valor: number
  queuePosition: number | null
  assignedTo: string | null
  technicalSpec: string | null
  history: string | null
  imageUrl: string | null
  createdAt: string
  endedAt: string | null
  carbonDescription?: string | null
  siliconDescription?: string | null
  curatorQueuePosition?: number | null
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE CARD — mission with imageUrl
// ═══════════════════════════════════════════════════════════════════════════

function MissionImageCard({ imageUrl, maturityLevel, urgency, easiness, impact, priority }: {
  imageUrl: string; maturityLevel: number; urgency: number; easiness: number; impact: number; priority: number
}) {
  const rawTexture = useLoader(THREE.TextureLoader, imageUrl)
  const texture = useMemo(() => {
    rawTexture.colorSpace = THREE.SRGBColorSpace
    return rawTexture
  }, [rawTexture])

  const aspect = texture.image ? texture.image.width / texture.image.height : 16 / 9
  const h = 2
  const w = h * aspect
  const accent = MATURITY_ACCENTS[maturityLevel] ?? '#666'
  const border = 0.08

  return (
    <group position={[0, h / 2, 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} metalness={0.0} />
      </mesh>
      <group position={[0, 0, -0.01]}>
        <FourBarFrameSimple w={w} h={h} border={border} color={accent} />
      </group>
      <MissionPriorityBar w={w} y={-h / 2 - border - 0.1} urgency={urgency} easiness={easiness} impact={impact} priority={priority} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SOLID CARD — mission without imageUrl (fallback)
// ═══════════════════════════════════════════════════════════════════════════

function MissionSolidCard({ maturityLevel, urgency, easiness, impact, priority }: {
  maturityLevel: number; urgency: number; easiness: number; impact: number; priority: number
}) {
  const h = 2
  const w = 3
  const accent = MATURITY_ACCENTS[maturityLevel] ?? '#666'
  const border = 0.08

  return (
    <group position={[0, h / 2, 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={accent} side={THREE.DoubleSide} roughness={0.6} metalness={0.2} emissive={accent} emissiveIntensity={0.3} />
      </mesh>
      <group position={[0, 0, -0.01]}>
        <FourBarFrameSimple w={w} h={h} border={border} color={accent} />
      </group>
      <MissionPriorityBar w={w} y={-h / 2 - border - 0.1} urgency={urgency} easiness={easiness} impact={impact} priority={priority} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// FOUR BAR FRAME — emissive border mesh
// ═══════════════════════════════════════════════════════════════════════════

function FourBarFrameSimple({ w, h, border, color }: { w: number; h: number; border: number; color: string }) {
  const depth = 0.02
  const bars = useMemo(() => [
    { pos: [0, h / 2 + border / 2, 0] as [number, number, number], size: [w + border * 2, border, depth] as [number, number, number] },
    { pos: [0, -h / 2 - border / 2, 0] as [number, number, number], size: [w + border * 2, border, depth] as [number, number, number] },
    { pos: [-w / 2 - border / 2, 0, 0] as [number, number, number], size: [border, h, depth] as [number, number, number] },
    { pos: [w / 2 + border / 2, 0, 0] as [number, number, number], size: [border, h, depth] as [number, number, number] },
  ], [w, h, border])

  return (
    <>
      {bars.map((bar, i) => (
        <mesh key={i} position={bar.pos}>
          <boxGeometry args={bar.size} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} roughness={0.3} metalness={0.7} />
        </mesh>
      ))}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIORITY BAR — U/E/I mini-bars
// ═══════════════════════════════════════════════════════════════════════════

function MissionPriorityBar({ w, y, urgency, easiness, impact, priority }: {
  w: number; y: number; urgency: number; easiness: number; impact: number; priority: number
}) {
  const barH = 0.12
  const barW = w / 3
  const gap = 0.02

  return (
    <group position={[0, y, 0.01]}>
      <mesh position={[-(barW + gap), 0, 0]}>
        <planeGeometry args={[barW * (urgency / 10), barH]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[barW * (easiness / 10), barH]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[(barW + gap), 0, 0]}>
        <planeGeometry args={[barW * (impact / 10), barH]} />
        <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={0.8} />
      </mesh>
      <Text
        position={[w / 2 + 0.3, 0, 0]}
        fontSize={0.15}
        color="#999"
        anchorX="left"
        anchorY="middle"
      >
        {priority.toFixed(1)}
      </Text>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION CARD 3D — exported component
// ═══════════════════════════════════════════════════════════════════════════

export function MissionCard3D({ mission }: { mission: MissionData }) {
  const props = {
    urgency: mission.urgency,
    easiness: mission.easiness,
    impact: mission.impact,
    priority: mission.priority ?? 1,
  }

  return (
    <group>
      {mission.imageUrl ? (
        <MissionImageCard imageUrl={mission.imageUrl} maturityLevel={mission.maturityLevel} {...props} />
      ) : (
        <MissionSolidCard maturityLevel={mission.maturityLevel} {...props} />
      )}
    </group>
  )
}

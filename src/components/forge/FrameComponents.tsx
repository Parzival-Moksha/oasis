'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FRAME COMPONENTS — Shared 3D picture frames for images + agent windows
// ─═̷─═̷─ॐ─═̷─═̷─ Extracted to break circular import with WorldObjects ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useMemo } from 'react'
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
  { id: 'spaghetti', label: 'Spaghetti',  icon: '🍝', desc: 'Tangled glowing wire chaos' },
  // 'triangle' (Prism) removed — extruded geometry was broken beyond quick repair
  { id: 'fire',      label: 'Inferno',    icon: '🔥', desc: 'Animated fire-colored pulsing border' },
  { id: 'matrix',    label: 'Matrix',     icon: '💚', desc: 'Green digital rain scanlines' },
  { id: 'plasma',    label: 'Plasma',     icon: '🌈', desc: 'Color-cycling plasma glow' },
  { id: 'brutalist', label: 'Brutalist',  icon: '🏗️', desc: 'Thick concrete industrial slab' },
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

// ═══════════════════════════════════════════════════════════════════════════
// SPAGHETTI FRAME — tangled glowing tubes wrapping the image
// ═══════════════════════════════════════════════════════════════════════════

export function SpaghettiFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.rotation.z = Math.sin(Date.now() * 0.0003) * 0.01
  })
  // Generate tube paths around the frame perimeter
  const tubes = useMemo(() => {
    const paths: Array<{ points: THREE.Vector3[]; color: string }> = []
    const colors = ['#f43f5e', '#fb923c', '#facc15', '#34d399', '#38bdf8', '#a78bfa']
    for (let i = 0; i < 12; i++) {
      const color = colors[i % colors.length]
      const pts: THREE.Vector3[] = []
      const offset = (i - 6) * 0.008 * scale
      const hw = w / 2 + 0.02 * scale + offset
      const hh = h / 2 + 0.02 * scale + offset
      const wobble = () => (Math.random() - 0.5) * 0.03 * scale
      // Go around the frame with wobble
      for (let t = 0; t <= 1; t += 0.05) {
        const angle = t * Math.PI * 2
        const x = Math.cos(angle) * hw + wobble()
        const y = Math.sin(angle) * hh + wobble()
        pts.push(new THREE.Vector3(x, y, wobble()))
      }
      paths.push({ points: pts, color })
    }
    return paths
  }, [w, h, scale])
  // Pre-compute curves — avoid allocation in render path
  const curves = useMemo(() =>
    tubes.map(tube => new THREE.CatmullRomCurve3(tube.points, true))
  , [tubes])

  return (
    <group ref={groupRef}>
      {tubes.map((tube, i) => (
        <mesh key={i}>
          <tubeGeometry args={[curves[i], 40, 0.004 * scale, 5, true]} />
          <meshStandardMaterial color={tube.color} emissive={tube.color} emissiveIntensity={1.5} roughness={0.3} metalness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIANGLE/PRISM FRAME — triangular cross-section, apex at media edge
// ═══════════════════════════════════════════════════════════════════════════

export function TriangleFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  // Extruded triangle profile — apex touches the image, base extends outward
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    const d = 0.06 * scale  // depth (base width)
    const b = 0.04 * scale  // height (how far it sticks out from the image)
    s.moveTo(0, 0)          // apex at image edge
    s.lineTo(-d / 2, -b)    // bottom-left
    s.lineTo(d / 2, -b)     // bottom-right
    s.closePath()
    return s
  }, [scale])

  const topPath = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(-w / 2, h / 2, 0), new THREE.Vector3(w / 2, h / 2, 0)), [w, h])
  const botPath = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(w / 2, -h / 2, 0)), [w, h])
  const leftPath = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(-w / 2, h / 2, 0)), [w, h])
  const rightPath = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(w / 2, -h / 2, 0), new THREE.Vector3(w / 2, h / 2, 0)), [w, h])

  const extrudeSettings = { steps: 1, bevelEnabled: false, extrudePath: undefined as unknown as THREE.Curve<THREE.Vector3> }

  return (
    <group>
      {[topPath, botPath, leftPath, rightPath].map((path, i) => (
        <mesh key={i} rotation={i < 2 ? [0, 0, i === 1 ? Math.PI : 0] : [0, 0, i === 2 ? -Math.PI / 2 : Math.PI / 2]}>
          <extrudeGeometry args={[shape, { ...extrudeSettings, extrudePath: path }]} />
          <meshStandardMaterial color="#2a2a2a" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      {/* Inner edge glow */}
      <FourBarFrame w={w} h={h} border={0.003 * scale} depth={0.002 * scale} color="#e5e5e5" roughness={0.0} metalness={1.0} emissive="#e5e5e5" emissiveIntensity={0.5} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// INFERNO FRAME — animated fire-colored pulsing border
// ═══════════════════════════════════════════════════════════════════════════

export function InfernoFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const innerRef = useRef<THREE.Group>(null)
  const outerRef = useRef<THREE.Group>(null)
  useFrame(() => {
    const t = Date.now() * 0.003
    if (innerRef.current) {
      const mat = (innerRef.current.children[0] as THREE.Mesh)?.material as THREE.MeshStandardMaterial
      if (mat?.emissiveIntensity !== undefined) mat.emissiveIntensity = 2 + Math.sin(t) * 1.5
    }
    if (outerRef.current) {
      const mat = (outerRef.current.children[0] as THREE.Mesh)?.material as THREE.MeshStandardMaterial
      if (mat?.emissiveIntensity !== undefined) mat.emissiveIntensity = 1 + Math.sin(t * 1.3 + 1) * 0.8
    }
  })
  return (
    <group>
      <group ref={innerRef} position={[0, 0, 0.008 * scale]}>
        <FourBarFrame w={w} h={h} border={0.01 * scale} depth={0.005 * scale} color="#ff4500" roughness={0.1} metalness={0.8} emissive="#ff4500" emissiveIntensity={2} />
      </group>
      <group ref={outerRef} position={[0, 0, -0.01 * scale]}>
        <FourBarFrame w={w} h={h} border={0.035 * scale} depth={0.02 * scale} color="#8b0000" roughness={0.4} metalness={0.6} emissive="#ff6600" emissiveIntensity={1} />
      </group>
      <group position={[0, 0, -0.035 * scale]}>
        <FourBarFrame w={w} h={h} border={0.05 * scale} depth={0.01 * scale} color="#1a0000" roughness={0.9} metalness={0.1} />
      </group>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MATRIX FRAME — green digital rain scanlines
// ═══════════════════════════════════════════════════════════════════════════

export function MatrixFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  // Multiple vertical scanlines descending the frame
  const scanRefs = useRef<THREE.Mesh[]>([])
  useFrame(() => {
    for (let i = 0; i < scanRefs.current.length; i++) {
      const mesh = scanRefs.current[i]
      if (!mesh) continue
      const speed = 0.5 + (i * 0.15)
      const t = ((Date.now() * 0.001 * speed + i * 0.7) % 3) / 3
      mesh.position.y = (0.5 - t) * h
      ;(mesh.material as THREE.MeshStandardMaterial).opacity = 0.4 + Math.sin(t * Math.PI) * 0.4
    }
  })
  return (
    <group ref={groupRef}>
      {/* Dark base frame */}
      <FourBarFrame w={w} h={h} border={0.025 * scale} depth={0.015 * scale} color="#001a00" roughness={0.8} metalness={0.2} emissive="#003300" emissiveIntensity={0.3} />
      {/* Inner green edge */}
      <group position={[0, 0, 0.003 * scale]}>
        <FourBarFrame w={w} h={h} border={0.004 * scale} depth={0.003 * scale} color="#00ff00" roughness={0.0} metalness={1.0} emissive="#00ff00" emissiveIntensity={2} />
      </group>
      {/* Vertical scanlines — 8 lines descending at different speeds */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={i}
          ref={el => { if (el) scanRefs.current[i] = el }}
          position={[-w / 2 + (i + 0.5) * w / 8, 0, 0.005 * scale]}
        >
          <planeGeometry args={[0.003 * scale, 0.05 * scale]} />
          <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={3} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PLASMA FRAME — color-cycling glow
// ═══════════════════════════════════════════════════════════════════════════

export function PlasmaFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const outerRefs = useRef<(THREE.Mesh | null)[]>([null, null, null, null])
  const innerRefs = useRef<(THREE.Mesh | null)[]>([null, null, null, null])
  const colorA = useMemo(() => new THREE.Color(), [])
  const colorB = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    const t = Date.now() * 0.001
    // Cycle through hues — ALL bars pulse together
    colorA.setHSL((t * 0.1) % 1, 0.9, 0.5)
    colorB.setHSL((t * 0.1 + 0.33) % 1, 0.9, 0.5)
    for (const mesh of innerRefs.current) {
      if (!mesh) continue
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.emissive.copy(colorA)
      mat.color.copy(colorA)
    }
    for (const mesh of outerRefs.current) {
      if (!mesh) continue
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.emissive.copy(colorB)
      mat.color.copy(colorB)
    }
  })
  const border = 0.015 * scale
  return (
    <group>
      {/* Outer glow ring */}
      {[
        { pos: [0, (h + border) / 2, 0] as const, size: [w + border * 2, border, 0.008 * scale] as const },
        { pos: [0, -(h + border) / 2, 0] as const, size: [w + border * 2, border, 0.008 * scale] as const },
        { pos: [-(w + border) / 2, 0, 0] as const, size: [border, h, 0.008 * scale] as const },
        { pos: [(w + border) / 2, 0, 0] as const, size: [border, h, 0.008 * scale] as const },
      ].map((bar, i) => (
        <mesh key={i} ref={el => { outerRefs.current[i] = el }} position={[bar.pos[0], bar.pos[1], bar.pos[2]]}>
          <boxGeometry args={[bar.size[0], bar.size[1], bar.size[2]]} />
          <meshStandardMaterial color="#ff00ff" emissive="#ff00ff" emissiveIntensity={2} roughness={0.0} metalness={1.0} transparent opacity={0.8} />
        </mesh>
      ))}
      {/* Inner thin edge */}
      <group position={[0, 0, 0.003 * scale]}>
        {[
          { pos: [0, (h + 0.003 * scale) / 2, 0] as const, size: [w + 0.006 * scale, 0.003 * scale, 0.003 * scale] as const },
          { pos: [0, -(h + 0.003 * scale) / 2, 0] as const, size: [w + 0.006 * scale, 0.003 * scale, 0.003 * scale] as const },
          { pos: [-(w + 0.003 * scale) / 2, 0, 0] as const, size: [0.003 * scale, h, 0.003 * scale] as const },
          { pos: [(w + 0.003 * scale) / 2, 0, 0] as const, size: [0.003 * scale, h, 0.003 * scale] as const },
        ].map((bar, i) => (
          <mesh key={i} ref={el => { innerRefs.current[i] = el }} position={[bar.pos[0], bar.pos[1], bar.pos[2]]}>
            <boxGeometry args={[bar.size[0], bar.size[1], bar.size[2]]} />
            <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={3} roughness={0.0} metalness={1.0} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BRUTALIST FRAME — thick concrete industrial slab
// ═══════════════════════════════════════════════════════════════════════════

export function BrutalistFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  return (
    <group>
      <FourBarFrame w={w} h={h} border={0.08 * scale} depth={0.06 * scale} color="#555555" roughness={1.0} metalness={0.0} />
      {/* Recessed inner lip */}
      <group position={[0, 0, 0.02 * scale]}>
        <FourBarFrame w={w} h={h} border={0.015 * scale} depth={0.025 * scale} color="#333333" roughness={1.0} metalness={0.0} />
      </group>
      {/* Exposed rebar accent — thin metal lines at corners */}
      {[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy], i) => (
        <mesh key={i} position={[sx * (w / 2 + 0.04 * scale), sy * (h / 2 + 0.04 * scale), 0]}>
          <cylinderGeometry args={[0.003 * scale, 0.003 * scale, 0.08 * scale, 6]} />
          <meshStandardMaterial color="#b87333" roughness={0.3} metalness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

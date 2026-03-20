// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD OBJECTS — The shared atoms of every realm
// ─═̷─═̷─ॐ─═̷─═̷─ Objects placed in a world transcend realm boundaries ─═̷─═̷─ॐ─═̷─═̷─
// World rendering — catalog, conjured, crafted objects + placement + polling
// your placed objects follow you like memories follow a dreamer.
//
// Extracted from ForgeRealm.tsx (Feb 2026 Silicon Mother)
// Used by: Cortex realm, Forge realm, and any future realm
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import React, { Suspense, useRef, useState, useEffect, useCallback, useContext, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { TransformControls, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { useOasisStore, type ConjureVfxType, CONJURE_VFX_LIST } from '../../store/oasisStore'
import { ConjuredObjectSafe } from './ConjuredObject'
import { CraftedSceneRenderer, PrimitiveGeometry } from './CraftedSceneRenderer'
import { ConjureVFX } from './ConjureVFX'
import { PlacementVFXRenderer } from './PlacementVFX'
import { useMovement } from '../../hooks/useMovement'
// drei useAnimations removed — manual AnimationMixer for proper SkeletonUtils support
import { DragContext } from '../scene-lib'
import type { MovementPreset, AnimationConfig } from '../../lib/conjure/types'
import { extractModelStats } from './ModelPreview'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import { loadAnimationClip, loadClipFromGLTF, retargetClipForVRM, LIB_PREFIX } from '../../lib/forge/animation-library'
import { AgentWindow3D } from './AgentWindow3D'
import type { PlacementPending } from '../../store/oasisStore'
import { useInputManager } from '../../lib/input-manager'

// ░▒▓ CLIPBOARD — module-level, survives across renders, no reactivity needed ▓▒░
let _clipboard: PlacementPending | null = null

// ░▒▓ COPY TOAST — 3D floating "Copied!" text that rises and fades ▓▒░
interface CopyToast { id: string; position: [number, number, number]; startedAt: number }
let _copyToasts: CopyToast[] = []
let _copyToastListeners: Set<() => void> = new Set()
function spawnCopyToast(pos: [number, number, number]) {
  const toast: CopyToast = { id: `ct-${Date.now()}`, position: [pos[0], pos[1] + 1, pos[2]], startedAt: Date.now() }
  _copyToasts = [..._copyToasts, toast]
  _copyToastListeners.forEach(fn => fn())
  setTimeout(() => {
    _copyToasts = _copyToasts.filter(t => t.id !== toast.id)
    _copyToastListeners.forEach(fn => fn())
  }, 1200)
}

function CopyToastRenderer() {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const listener = () => forceUpdate(n => n + 1)
    _copyToastListeners.add(listener)
    return () => { _copyToastListeners.delete(listener) }
  }, [])

  return <>
    {_copyToasts.map(toast => <CopyToastItem key={toast.id} toast={toast} />)}
  </>
}

function CopyToastItem({ toast }: { toast: CopyToast }) {
  const groupRef = useRef<THREE.Group>(null)
  const startY = toast.position[1]
  useFrame(() => {
    if (!groupRef.current) return
    const elapsed = (Date.now() - toast.startedAt) / 1000
    const progress = Math.min(elapsed / 1.2, 1)
    groupRef.current.position.y = startY + progress * 1.5
  })
  return (
    <group ref={groupRef} position={toast.position}>
      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{
          color: '#22d3ee', fontFamily: 'monospace', fontWeight: 900, fontSize: '14px',
          textShadow: '0 0 8px #06b6d4, 0 0 20px #0891b2, 0 0 40px #06b6d4',
          letterSpacing: '0.2em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          animation: 'copyToastFade 1.2s ease-out forwards',
        }}>
          ✦ COPIED ✦
        </div>
        <style>{`@keyframes copyToastFade { 0% { opacity: 0; transform: scale(0.5); } 15% { opacity: 1; transform: scale(1.1); } 30% { transform: scale(1); } 100% { opacity: 0; transform: scale(0.8) translateY(-10px); } }`}</style>
      </Html>
    </group>
  )
}

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEHOLDER BOX — wireframe fallback while GLBs load (Suspense boundary)
// Prevents the black-screen-of-doom when useGLTF triggers React Suspense
// ═══════════════════════════════════════════════════════════════════════════════
function PlaceholderBox() {
  const meshRef = useRef<THREE.Mesh>(null!)
  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 2
  })
  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshBasicMaterial color="#F97316" wireframe transparent opacity={0.5} />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTABLE WRAPPER — click to select, TransformControls when selected
// Uses 'dragging-changed' event (the reliable way to coordinate with OrbitControls)
// ═══════════════════════════════════════════════════════════════════════════════

export function SelectableWrapper({ id, children, selected, onSelect, transformMode, onTransformChange, initialPosition, initialRotation, initialScale }: {
  id: string
  children: React.ReactNode
  selected: boolean
  onSelect: (id: string) => void
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  initialPosition?: [number, number, number]
  initialRotation?: [number, number, number]
  initialScale?: [number, number, number] | number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const { setIsDragging } = useContext(DragContext)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)

  // ░▒▓ Movement system — reads behavior from store, applies every frame ▓▒░
  const behavior = useOasisStore(s => s.behaviors[id])
  useMovement(groupRef, behavior?.movement, id, behavior?.moveTarget, behavior?.moveSpeed)

  // Apply initial transforms from stored overrides (position + rotation + scale)
  useEffect(() => {
    if (!groupRef.current) return
    if (initialPosition) groupRef.current.position.set(...initialPosition)
    if (initialRotation) groupRef.current.rotation.set(...initialRotation)
    if (initialScale != null) {
      if (typeof initialScale === 'number') {
        groupRef.current.scale.setScalar(initialScale)
      } else {
        groupRef.current.scale.set(...initialScale)
      }
    }
  }, [initialPosition, initialRotation, initialScale])

  // Callback ref for TransformControls — attaches dragging-changed listener
  // reliably, regardless of conditional mount timing
  const beginUndoBatch = useOasisStore(s => s.beginUndoBatch)
  const commitUndoBatch = useOasisStore(s => s.commitUndoBatch)
  const controlsCallbackRef = useCallback((controls: any) => {
    if (!controls) return
    // ░▒▓ Disable three.js built-in W/E/R keyboard handler ▓▒░
    // It conflicts with WASD movement and our R/T/Y hotkeys (R=scale in three.js vs R=translate in ours).
    // Mode is controlled exclusively via React props from the store.
    controls.setMode = () => {}
    const callback = (event: { value: boolean }) => {
      if (event.value) {
        // ░▒▓ Drag start — capture world state for undo ▓▒░
        beginUndoBatch('Transform', '🔄')
      }
      setIsDragging(event.value)
      // When drag ends, sync transform back to store + commit undo
      if (!event.value && groupRef.current) {
        const p = groupRef.current.position
        const r = groupRef.current.rotation
        const s = groupRef.current.scale
        onTransformChange(id, [p.x, p.y, p.z], [r.x, r.y, r.z], [s.x, s.y, s.z])
        // ░▒▓ Drag end — commit the batch undo command ▓▒░
        setTimeout(() => commitUndoBatch(), 50)  // after setObjectTransform fires
      }
    }
    controls.addEventListener('dragging-changed', callback)
  }, [id, setIsDragging, onTransformChange, beginUndoBatch, commitUndoBatch])

  // ─══ॐ══─ Respect visibility toggle from ObjectInspector ─══ॐ══─
  const isVisible = behavior?.visible !== false

  return (
    <>
      <group
        ref={groupRef}
        visible={isVisible}
        onClick={(e) => {
          if (isReadOnly) return  // ░▒▓ Anonymous visitors can't select/modify objects ▓▒░
          e.stopPropagation()
          onSelect(id)
          setInspectedObject(id)  // ░▒▓ One click = select + inspect (no double-click needed) ▓▒░
        }}
      >
        {/* Selection highlight ring */}
        {selected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <ringGeometry args={[1.5, 1.8, 32]} />
            <meshBasicMaterial color="#3B82F6" transparent opacity={0.4} />
          </mesh>
        )}
        {children}
      </group>

      {/* TransformControls — callback ref ensures listener attaches on mount */}
      {selected && groupRef.current && !isReadOnly && (
        <TransformControls
          ref={controlsCallbackRef}
          object={groupRef.current}
          mode={transformMode}
          size={0.6}
        />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG MODEL ERROR BOUNDARY — One bad model shall not crash the realm
// ░▒▓ Catches 404s from placed conjured assets whose GLBs went missing ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

class CatalogModelErrorBoundary extends React.Component<
  { children: React.ReactNode; path: string; name?: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; path: string; name?: string }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error) {
    console.warn(`[Forge:Catalog] Failed to load ${this.props.path}: ${error.message}`)
  }
  render() {
    if (this.state.hasError) {
      return (
        <group>
          <mesh>
            <boxGeometry args={[0.3, 0.3, 0.3]} />
            <meshBasicMaterial color="#ff6600" wireframe transparent opacity={0.5} />
          </mesh>
          <Html position={[0, 0.5, 0]} center style={{ pointerEvents: 'none' }}>
            <div className="text-[9px] text-orange-400 font-mono bg-black/80 px-1.5 py-0.5 rounded whitespace-nowrap">
              {(this.props.name || 'model').slice(0, 25)} (missing)
            </div>
          </Html>
        </group>
      )
    }
    return this.props.children
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE PLANE RENDERER — Generated images as flat textured planes in the world
// ░▒▓ A single quad, double-sided, bearing the vision Gemini dreamed ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

// ─═̷─ FRAME STYLE DEFINITIONS — 8 wildly different picture frames ─═̷─
export interface FrameStyleDef {
  id: string
  label: string
  icon: string
  desc: string
}

export const FRAME_STYLES: FrameStyleDef[] = [
  { id: 'gilded',    label: 'Gilded',     icon: '🖼️', desc: 'Classic gold museum frame' },
  { id: 'neon',      label: 'Neon',       icon: '💜', desc: 'Glowing neon cyberpunk border' },
  { id: 'thin',      label: 'Minimal',    icon: '▫️', desc: 'Hairline black wire frame' },
  { id: 'baroque',   label: 'Baroque',    icon: '👑', desc: 'Thick ornate royal frame' },
  { id: 'hologram',  label: 'Hologram',   icon: '🔮', desc: 'Floating holographic projection' },
  { id: 'rustic',    label: 'Rustic',     icon: '🪵', desc: 'Weathered dark wood' },
  { id: 'ice',       label: 'Frozen',     icon: '🧊', desc: 'Translucent ice crystal frame' },
  { id: 'void',      label: 'Void',       icon: '🕳️', desc: 'Dark portal with swirling edge' },
]

// ─═̷─ FOUR-BAR FRAME BUILDER — reusable for box-based frame geometry ─═̷─
function FourBarFrame({ w, h, border, depth, color, roughness = 0.5, metalness = 0.3, emissive, emissiveIntensity = 0, opacity = 1, transparent = false }: {
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

// ─═̷─ ANIMATED FRAME WRAPPERS ─═̷─

function NeonFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (!groupRef.current) return
    // Pulsing glow via scale oscillation
    const t = Date.now() * 0.003
    const pulse = 1 + Math.sin(t) * 0.015
    groupRef.current.scale.set(pulse, pulse, 1)
  })
  const border = 0.015 * scale
  const depth = 0.008 * scale
  return (
    <group ref={groupRef}>
      {/* Inner bright edge */}
      <FourBarFrame w={w} h={h} border={border} depth={depth} color="#A855F7" roughness={0.1} metalness={0.9} emissive="#A855F7" emissiveIntensity={3} />
      {/* Outer softer glow */}
      <FourBarFrame w={w + border * 2} h={h + border * 2} border={border * 0.6} depth={depth * 0.5} color="#7C3AED" roughness={0.2} metalness={0.5} emissive="#7C3AED" emissiveIntensity={1.5} transparent opacity={0.6} />
    </group>
  )
}

function HologramFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    const t = Date.now() * 0.001
    // Gentle float + rotation wobble
    groupRef.current.position.y = Math.sin(t * 1.5) * 0.02 * scale
    groupRef.current.rotation.z = Math.sin(t * 0.7) * 0.005
  })
  const gap = 0.03 * scale
  const cornerSize = 0.06 * scale
  const thickness = 0.008 * scale
  // Corner brackets instead of full frame
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
      {/* Scanline effect — a thin bar that scrolls vertically */}
      <ScanlineBar w={w + gap * 2} h={h + gap * 2} scale={scale} />
    </group>
  )
}

function ScanlineBar({ w, h, scale }: { w: number; h: number; scale: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!ref.current) return
    const t = (Date.now() * 0.001) % 3 / 3 // 0→1 over 3 seconds
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

function VoidFrame({ w, h, scale }: { w: number; h: number; scale: number }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current) return
    // Slow dark rotation
    groupRef.current.rotation.z = Math.sin(Date.now() * 0.0005) * 0.02
  })
  const border = 0.05 * scale
  const depth = 0.03 * scale
  return (
    <group ref={groupRef}>
      {/* Outer dark ring */}
      <FourBarFrame w={w} h={h} border={border} depth={depth} color="#0a0a0a" roughness={0.9} metalness={0.1} emissive="#4C1D95" emissiveIntensity={0.4} />
      {/* Inner bright edge — the event horizon */}
      <FourBarFrame w={w} h={h} border={0.005 * scale} depth={0.003 * scale} color="#8B5CF6" roughness={0.0} metalness={1.0} emissive="#8B5CF6" emissiveIntensity={2.5} />
    </group>
  )
}

export function ImagePlaneRenderer({ imageUrl, scale, frameStyle }: { imageUrl: string; scale: number; frameStyle?: string }) {
  const texture = useLoader(THREE.TextureLoader, imageUrl)
  texture.colorSpace = THREE.SRGBColorSpace

  const aspect = texture.image ? texture.image.width / texture.image.height : 1
  const w = scale * aspect
  const h = scale

  return (
    <group position={[0, h / 2, 0]}>
      {/* The image itself — vertical, centered */}
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} metalness={0.0} />
      </mesh>

      {/* ░▒▓ FRAME STYLES — each one a different vibe ▓▒░ */}

      {/* 1. GILDED — classic gold museum frame */}
      {frameStyle === 'gilded' && (
        <FourBarFrame w={w} h={h} border={0.04 * scale} depth={0.02 * scale} color="#8B6914" roughness={0.4} metalness={0.6} />
      )}

      {/* 2. NEON — pulsing cyberpunk glow */}
      {frameStyle === 'neon' && (
        <NeonFrame w={w} h={h} scale={scale} />
      )}

      {/* 3. MINIMAL — hairline black wire frame */}
      {frameStyle === 'thin' && (
        <FourBarFrame w={w} h={h} border={0.006 * scale} depth={0.003 * scale} color="#1a1a1a" roughness={0.9} metalness={0.0} />
      )}

      {/* 4. BAROQUE — thick ornate royal frame, double border */}
      {frameStyle === 'baroque' && (
        <>
          <FourBarFrame w={w} h={h} border={0.07 * scale} depth={0.035 * scale} color="#5C3A0E" roughness={0.3} metalness={0.7} />
          <FourBarFrame w={w + 0.01 * scale} h={h + 0.01 * scale} border={0.015 * scale} depth={0.04 * scale} color="#DAA520" roughness={0.2} metalness={0.9} />
        </>
      )}

      {/* 5. HOLOGRAM — floating corner brackets with scanline */}
      {frameStyle === 'hologram' && (
        <HologramFrame w={w} h={h} scale={scale} />
      )}

      {/* 6. RUSTIC — weathered dark wood */}
      {frameStyle === 'rustic' && (
        <FourBarFrame w={w} h={h} border={0.05 * scale} depth={0.025 * scale} color="#3E2723" roughness={0.95} metalness={0.0} />
      )}

      {/* 7. FROZEN — translucent ice crystal */}
      {frameStyle === 'ice' && (
        <FourBarFrame w={w} h={h} border={0.04 * scale} depth={0.02 * scale} color="#B3E5FC" roughness={0.05} metalness={0.1} transparent opacity={0.6} emissive="#81D4FA" emissiveIntensity={0.3} />
      )}

      {/* 8. VOID — dark portal with bright inner edge */}
      {frameStyle === 'void' && (
        <VoidFrame w={w} h={h} scale={scale} />
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG MODEL RENDERER — Static pre-made assets from ASSET_CATALOG
// ░▒▓ Clone once + kill raycasting — SelectableWrapper handles pointer events ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

export function CatalogModelRenderer({ path, scale, objectId, displayName }: { path: string; scale: number; objectId?: string; displayName?: string }) {
  const { scene, animations } = useGLTF(path)
  const sceneRef = useRef<THREE.Group>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const currentClipRef = useRef<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const [showLabel, setShowLabel] = useState(false)

  // ─═̷─═̷─🦴 SkeletonUtils.clone for proper skinned mesh + bone cloning ─═̷─═̷─🦴
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.raycast = () => {}
        // Enable vertex colors for models that use them (Kenney assets etc.)
        const mesh = child as THREE.Mesh
        if (mesh.geometry.attributes.color) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((mat) => {
            if (mat && 'vertexColors' in mat && !mat.vertexColors) {
              mat.vertexColors = true
              mat.needsUpdate = true
            }
          })
        }
      }
    })
    return clone
  }, [scene])

  // ░▒▓ Create mixer on mount — manual AnimationMixer (same pattern as Cortex) ▓▒░
  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clonedScene)
    mixerRef.current = mixer
    return () => { mixer.stopAllAction() }
  }, [clonedScene])

  // ░▒▓ Animation system — plays clips based on ObjectBehavior config ▓▒░
  // Smart auto-play: idle/passive clips only. Walk clip plays during moveTarget.
  const animConfig = useOasisStore(s => objectId ? s.behaviors[objectId]?.animation : undefined)
  const isMoving = useOasisStore(s => objectId ? !!s.behaviors[objectId]?.moveTarget : false)

  // ░▒▓ Clip name patterns — how we detect idle vs walk vs combat clips ▓▒░
  const IDLE_PATTERNS = /idle|breathe?|stand|rest|pose|wait/i
  const WALK_PATTERNS = /walk|run|move|locomotion|jog/i

  // Find best idle and walk clips from available animations
  const { idleClip, walkClip } = useMemo(() => {
    const names = animations.map(a => a.name)
    return {
      idleClip: names.find(n => IDLE_PATTERNS.test(n)) || null,
      walkClip: names.find(n => WALK_PATTERNS.test(n)) || null,
    }
  }, [animations])

  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer || animations.length === 0) return

    // ── Priority 1: Explicit behavior config from ObjectInspector ──
    let clipName = animConfig?.clipName || null
    let loop = animConfig?.loop || 'repeat'
    let speed = animConfig?.speed || 1

    // ── Priority 2: Walk animation during RTS move-to ──
    if (!clipName && isMoving && walkClip) {
      clipName = walkClip
      loop = 'repeat'
    }

    // ── Priority 3: Idle fallback — always return to idle when nothing else is active ──
    // Regex filter already prevents buildings/objects without idle-named clips from auto-playing
    if (!clipName && idleClip) {
      clipName = idleClip
    }

    // ── No suitable clip found → stop animation ──
    if (!clipName) {
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3)
        currentActionRef.current = null
        currentClipRef.current = null
      }
      return
    }

    const clip = animations.find(a => a.name === clipName)
    if (!clip) return

    // Skip if already playing the same clip
    if (currentClipRef.current === clipName) return

    const newAction = mixer.clipAction(clip)

    // Crossfade from previous
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.3)
    }

    const loopMap = {
      once: THREE.LoopOnce,
      repeat: THREE.LoopRepeat,
      pingpong: THREE.LoopPingPong,
    } as const
    newAction.setLoop(loopMap[loop] || THREE.LoopRepeat, Infinity)
    newAction.clampWhenFinished = loop === 'once'
    newAction.timeScale = speed
    newAction.reset().fadeIn(0.3).play()

    currentActionRef.current = newAction
    currentClipRef.current = clipName
  }, [animConfig?.clipName, animConfig?.loop, animConfig?.speed, animations, isMoving, idleClip, walkClip])

  // ░▒▓ Tick the mixer every frame — drives all active animations ▓▒░
  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
  })

  // ░▒▓ Bounding box proxy — 12 tris instead of per-triangle raycast on catalog GLBs ▓▒░
  const catalogProxyRef = useRef<THREE.Mesh>(null)
  const paintMode = useOasisStore(s => s.paintMode)
  const bounds = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    return { size, center }
  }, [clonedScene])

  // ░▒▓ Paint mode: disable raycasting on proxy so clicks fall through to PaintOverlay ▓▒░
  useEffect(() => {
    if (!catalogProxyRef.current) return
    if (paintMode) {
      catalogProxyRef.current.raycast = () => {}
    } else {
      catalogProxyRef.current.raycast = THREE.Mesh.prototype.raycast
    }
  }, [paintMode])

  // ░▒▓ Extract mesh stats once per clone — push to Zustand for ObjectInspector ▓▒░
  const setObjectMeshStats = useOasisStore(s => s.setObjectMeshStats)
  useEffect(() => {
    if (!objectId) return
    const stats = extractModelStats(clonedScene, animations)
    // HEAD fetch for file size — cheap, no body
    // ░▒▓ OASIS_BASE prefix for basePath-aware deployment ▓▒░
    fetch(`${OASIS_BASE}${path}`, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('content-length')
        if (cl) stats.fileSize = parseInt(cl, 10)
      })
      .catch(() => {})
      .finally(() => setObjectMeshStats(objectId, stats))
  }, [objectId, clonedScene, animations, path, setObjectMeshStats])

  // ░▒▓ Triangle count for hover label — extracted from mesh stats ▓▒░
  const objectStats = useOasisStore(s => objectId ? s.objectMeshStats[objectId] : undefined)
  const triCount = objectStats?.triangles || 0
  const labelName = displayName || (objectId ? objectId.replace(/^catalog-/, '').replace(/-\d+$/, '') : 'asset')

  return (
    <group ref={sceneRef}>
      {/* Transparent bounding box — cheap raycast target for selection */}
      {/* NOTE: visible={false} prevents R3F raycasting. opacity=0 keeps it raycastable. */}
      {/* Paint mode: raycast disabled via useEffect so clicks fall through to PaintOverlay */}
      <mesh
        ref={catalogProxyRef}
        position={[bounds.center.x * scale, bounds.center.y * scale, bounds.center.z * scale]}
        onClick={(e) => {
          e.stopPropagation()
          if (objectId) {
            useOasisStore.getState().selectObject(objectId)
            useOasisStore.getState().setInspectedObject(objectId)
          }
        }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); if (!useInputManager.getState().pointerLocked) setShowLabel(true) }}
        onPointerOut={(e) => { e.stopPropagation(); setHovered(false); setShowLabel(false) }}
      >
        <boxGeometry args={[bounds.size.x * scale, bounds.size.y * scale, bounds.size.z * scale]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <primitive object={clonedScene} scale={scale} />

      {/* Hover glow ring */}
      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.8 * scale, 1 * scale, 32]} />
          <meshBasicMaterial color="#EAB308" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}

      {/* Info label — name + triangle count, consistent with conjured/crafted */}
      {showLabel && (
        <Html position={[0, bounds.size.y * scale + 0.5, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            className="px-2 py-1 rounded text-xs whitespace-nowrap select-none pointer-events-none"
            style={{
              background: 'rgba(0,0,0,0.85)',
              border: '1px solid rgba(234,179,8,0.3)',
              color: '#EAB308',
            }}
          >
            {labelName}
            {triCount > 0 && (
              <div className="text-[10px] text-gray-400">
                {triCount >= 1000 ? `${(triCount / 1000).toFixed(1)}k` : triCount} tris
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// VRM CATALOG RENDERER — Alive NPCs with expressions, spring bones, blinking
// Uses @pixiv/three-vrm instead of useGLTF so VRM metadata (expressions,
// spring bones, lookAt) survives loading. Without this, placed avatars are
// frozen mannequins. With it, they LIVE — blink, sway, smile.
// ═══════════════════════════════════════════════════════════════════════════════

export function VRMCatalogRenderer({ path, scale, objectId, displayName }: { path: string; scale: number; objectId?: string; displayName?: string }) {
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)
  const [hovered, setHovered] = useState(false)
  const [showLabel, setShowLabel] = useState(false)
  const catalogProxyRef = useRef<THREE.Mesh>(null)
  const paintMode = useOasisStore(s => s.paintMode)
  // NOTE: RTS movement (useMovement) is handled by SelectableWrapper which wraps this component.
  // Do NOT call useMovement here — it would double-move a nested group causing drift.

  // Per-NPC blink offset — hash objectId so they don't all blink in creepy unison
  const blinkOffset = useMemo(() => {
    if (!objectId) return 0
    let hash = 0
    for (let i = 0; i < objectId.length; i++) hash = ((hash << 5) - hash + objectId.charCodeAt(i)) | 0
    return Math.abs(hash % 400) / 100 // 0-4s offset
  }, [objectId])

  // Load VRM via GLTFLoader + VRMLoaderPlugin
  // ░▒▓ #vrm suffix creates a separate cache key from useGLTF (ModelPreviewPanel) ▓▒░
  // Without this, the preview panel poisons the Three.js loader cache: it loads VRM
  // files with plain useGLTF (no VRM plugin), caching the result without VRM metadata.
  // Then VRMCatalogRenderer gets the cached non-VRM result → gltf.userData.vrm is undefined → invisible.
  // Hash fragments aren't sent to the server, so the same file is served.
  const vrmUrl = path + '#vrm'
  const gltf = useLoader(GLTFLoader, vrmUrl, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  // IBL: applied lazily in useFrame once scene.environment is ready (HDRI loads async)
  const iblAppliedRef = useRef(false)
  useEffect(() => { iblAppliedRef.current = false }, [vrm]) // reset when avatar changes

  // Extract VRM + fix non-IBL materials
  useEffect(() => {
    const loadedVrm = gltf.userData.vrm as VRM | undefined
    if (!loadedVrm) {
      console.warn('[VRM:NPC] No VRM data in', path, '— rendering as static GLB fallback')
      return
    }
    VRMUtils.rotateVRM0(loadedVrm)

    // MToon GI + shadows + MeshBasicMaterial swap (IBL envMap applied in useFrame once environment ready)
    loadedVrm.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.raycast = () => {} // kill per-tri raycast — proxy box handles clicks
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          const m = mat as unknown as Record<string, unknown>

          // MToon: GI equalization allows IBL to contribute
          if ('giEqualizationFactor' in m) m.giEqualizationFactor = 0.9

          // MeshBasicMaterial can't receive ANY light — swap to Standard
          if (mat.type === 'MeshBasicMaterial') {
            const basic = mat as THREE.MeshBasicMaterial
            mesh.material = new THREE.MeshStandardMaterial({
              color: basic.color, map: basic.map,
              transparent: basic.transparent, opacity: basic.opacity,
              side: basic.side, roughness: 0.8, metalness: 0.0,
              envMapIntensity: 1.5,
            })
            continue
          }

          if ('envMapIntensity' in m) {
            ;(mat as THREE.MeshStandardMaterial).envMapIntensity = 1.5
          }
          mat.needsUpdate = true
        }
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })

    vrmRef.current = loadedVrm
    setVrm(loadedVrm)
    console.log(`[VRM:NPC] ${displayName || path.split('/').pop()} — expressions: ${Object.keys(loadedVrm.expressionManager?.expressionMap || {}).length}, spring: ${loadedVrm.springBoneManager ? 'yes' : 'no'}`)
  }, [gltf, path, displayName])

  // ░▒▓ ANIMATION SYSTEM — Load from library, retarget for VRM skeleton ▓▒░
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const activeAnimRef = useRef<'none' | 'idle' | 'walk' | 'behavior'>('none')
  const isMoving = useOasisStore(s => objectId ? !!s.behaviors[objectId]?.moveTarget : false)
  const animConfig = useOasisStore(s => objectId ? s.behaviors[objectId]?.animation : undefined)

  // Create mixer on VRM scene
  useEffect(() => {
    if (!vrm) return
    const mixer = new THREE.AnimationMixer(vrm.scene)
    mixerRef.current = mixer
    return () => { mixer.stopAllAction(); mixerRef.current = null }
  }, [vrm])

  // ░▒▓ Load walk + idle clips from Mixamo FBX library, retarget for THIS VRM ▓▒░
  // FBX pipeline maps 52/52 bones. GLTF characters use non-Mixamo names (4/34 = useless).
  // 'idle' = "Breathing Idle" if available, falls back to 'idle-fight' (snappy but better than T-pose).
  const [walkClip, setWalkClip] = useState<THREE.AnimationClip | null>(null)
  const [idleClip, setIdleClip] = useState<THREE.AnimationClip | null>(null)
  useEffect(() => {
    if (!vrm) return
    const key = objectId || 'vrm-npc'
    loadAnimationClip('walk').then(clip => {
      if (clip) setWalkClip(retargetClipForVRM(clip, vrm, key))
    })
    // Try proper idle first, fall back to idle-fight
    loadAnimationClip('idle').then(clip => {
      if (clip) { setIdleClip(retargetClipForVRM(clip, vrm, key + '-idle')); return }
      return loadAnimationClip('idle-fight').then(fbxClip => {
        if (fbxClip) setIdleClip(retargetClipForVRM(fbxClip, vrm, key + '-idle'))
      })
    })
  }, [vrm, objectId])

  // Load explicit behavior animation (from ObjectInspector — dance, combat, etc.)
  const [behaviorClip, setBehaviorClip] = useState<THREE.AnimationClip | null>(null)
  useEffect(() => {
    const clipName = animConfig?.clipName
    if (!clipName || !vrm) { setBehaviorClip(null); return }
    if (clipName.startsWith(LIB_PREFIX)) {
      const animId = clipName.replace(LIB_PREFIX, '')
      const key = objectId || 'vrm-npc'
      loadAnimationClip(animId).then(clip => {
        if (clip) setBehaviorClip(retargetClipForVRM(clip, vrm, key))
      })
    }
  }, [animConfig?.clipName, vrm, objectId])

  // ░▒▓ Animation state machine — behavior > walk > idle ▓▒░
  // Deterministic: compute desired state, skip if already there, otherwise transition.
  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer) return

    // Determine what SHOULD play right now
    let target: 'behavior' | 'walk' | 'idle' | 'none' = 'none'
    if (behaviorClip) target = 'behavior'
    else if (isMoving && walkClip) target = 'walk'
    else if (idleClip) target = 'idle'

    // Already in correct state → no-op
    if (target === activeAnimRef.current) return

    // Fade out current action
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.3)
      currentActionRef.current = null
    }

    // Resolve clip for target state
    let clip: THREE.AnimationClip | null = null
    if (target === 'behavior') clip = behaviorClip
    else if (target === 'walk') clip = walkClip
    else if (target === 'idle') clip = idleClip

    if (clip) {
      const action = mixer.clipAction(clip)
      if (target === 'behavior') {
        const loop = animConfig?.loop || 'repeat'
        action.setLoop(loop === 'once' ? THREE.LoopOnce : loop === 'pingpong' ? THREE.LoopPingPong : THREE.LoopRepeat, Infinity)
        action.clampWhenFinished = loop === 'once'
        action.timeScale = animConfig?.speed || 1
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity)
      }
      action.reset().fadeIn(0.3).play()
      currentActionRef.current = action
    }

    activeAnimRef.current = target
    console.log(`[VRM:NPC] ${displayName || objectId} → anim: ${target}`)
  }, [isMoving, walkClip, idleClip, behaviorClip, animConfig?.loop, animConfig?.speed, displayName, objectId])

  // Animation tick — expressions + spring bones + mixer (drives idle/walk/behavior)
  useFrame((state, delta) => {
    const v = vrmRef.current
    if (!v) return

    // ░▒▓ IBL: swap MToon/Basic → Standard so IBL works (MToon is a ShaderMaterial, ignores scene.environment) ▓▒░
    if (!iblAppliedRef.current && state.scene.environment) {
      v.scene.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return
        const mesh = child as THREE.Mesh
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const newMats = mats.map(mat => {
          const m = mat as any
          if (m.type === 'MToonMaterial' || m.type === 'MeshBasicMaterial' || m.isMToonMaterial) {
            const std = new THREE.MeshStandardMaterial({
              map: m.map || m.uniforms?.map?.value || null,
              normalMap: m.normalMap || m.uniforms?.normalMap?.value || null,
              emissiveMap: m.emissiveMap || m.uniforms?.emissiveMap?.value || null,
              emissive: m.emissive || new THREE.Color(0x000000),
              color: m.color || new THREE.Color(0xffffff),
              roughness: 0.8,
              metalness: 0.0,
              envMap: state.scene.environment,
              envMapIntensity: 1.2,
              side: m.side ?? THREE.FrontSide,
              transparent: m.transparent ?? false,
              opacity: m.opacity ?? 1,
              alphaTest: m.alphaTest ?? 0,
            })
            std.needsUpdate = true
            mat.dispose()
            return std
          }
          if ('envMap' in m) { m.envMap = state.scene.environment; m.envMapIntensity = 1.2; m.needsUpdate = true }
          return mat
        })
        mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0]
      })
      iblAppliedRef.current = true
    }

    v.update(delta)
    mixerRef.current?.update(delta)

    const t = state.clock.elapsedTime + blinkOffset
    const expr = v.expressionManager

    if (expr) {
      // Blink cycle — offset per NPC so they feel independent
      const blinkPhase = t % 4
      expr.setValue('blink', (blinkPhase > 3.7 && blinkPhase < 3.9) ? 1 : 0)

      // ░▒▓ Joystick expression overrides — if set, they take priority over defaults ▓▒░
      const exprOverrides = objectId ? useOasisStore.getState().behaviors[objectId]?.expressions : undefined
      if (exprOverrides && Object.keys(exprOverrides).length > 0) {
        // Apply all expression overrides from the Joystick panel
        if (exprOverrides.happy != null) expr.setValue('happy', exprOverrides.happy)
        if (exprOverrides.angry != null) expr.setValue('angry', exprOverrides.angry)
        if (exprOverrides.sad != null) expr.setValue('sad', exprOverrides.sad)
        if (exprOverrides.surprised != null) expr.setValue('surprised', exprOverrides.surprised)
        if (exprOverrides.relaxed != null) expr.setValue('relaxed', exprOverrides.relaxed)
        // Visemes (mouth shapes)
        if (exprOverrides.aa != null) expr.setValue('aa', exprOverrides.aa)
        if (exprOverrides.ih != null) expr.setValue('ih', exprOverrides.ih)
        if (exprOverrides.ou != null) expr.setValue('ou', exprOverrides.ou)
        if (exprOverrides.ee != null) expr.setValue('ee', exprOverrides.ee)
        if (exprOverrides.oh != null) expr.setValue('oh', exprOverrides.oh)
      } else {
        // Default: subtle breathing smile
        const smileAmount = Math.sin(t * 0.3) * 0.15 + 0.1
        expr.setValue('happy', Math.max(0, smileAmount))
      }
    }

    // LookAt — eyes wander (offset per NPC too)
    if (v.lookAt && v.lookAt.target) {
      (v.lookAt.target as THREE.Object3D).position.set(
        Math.sin(t * 0.5) * 2,
        1.5 + Math.sin(t * 0.3) * 0.3,
        -3 + Math.cos(t * 0.4) * 1
      )
    }
  })

  // ░▒▓ FIXED HUMANOID PROXY BOX — VRMs are always humanoid, skip Box3.setFromObject ▓▒░
  // Box3.setFromObject uses WORLD matrices → timing-dependent → unreliable for proxy placement.
  // All VRM avatars are ~1.5-1.8m tall humanoids. A fixed box is bulletproof.
  const bounds = useMemo(() => ({
    size: new THREE.Vector3(0.6, 1.7, 0.4),
    center: new THREE.Vector3(0, 0.85, 0),
  }), [])

  // Paint mode — disable proxy raycast so clicks pass through to ground
  useEffect(() => {
    if (!catalogProxyRef.current) return
    catalogProxyRef.current.raycast = paintMode ? () => {} : THREE.Mesh.prototype.raycast
  }, [paintMode])

  // Push mesh stats to Zustand for ObjectInspector
  const setObjectMeshStats = useOasisStore(s => s.setObjectMeshStats)
  useEffect(() => {
    const target = vrm ? vrm.scene : gltf.scene
    if (!objectId || !target) return
    let tris = 0, verts = 0, meshCount = 0
    target.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        meshCount++
        const geo = mesh.geometry
        if (geo.index) tris += geo.index.count / 3
        else if (geo.attributes.position) tris += geo.attributes.position.count / 3
        if (geo.attributes.position) verts += geo.attributes.position.count
      }
    })
    const box = new THREE.Box3().setFromObject(target)
    const dims = box.getSize(new THREE.Vector3())
    // boneCount:1 → AnimationLibrarySection visible; clips:[walk] → RTS right-click guard passes
    setObjectMeshStats(objectId, { triangles: Math.floor(tris), vertices: verts, meshCount, materialCount: 0, boneCount: 1, dimensions: { w: dims.x, h: dims.y, d: dims.z }, clips: [{ name: 'walk', duration: 1 }], fileSize: 0 })
  }, [objectId, vrm, gltf.scene, setObjectMeshStats])

  const objectStats = useOasisStore(s => objectId ? s.objectMeshStats[objectId] : undefined)
  const triCount = objectStats?.triangles || 0
  const labelName = displayName || 'VRM Avatar'

  // The scene to render — VRM scene (with expressions/spring bones) or raw GLTF fallback
  const renderScene = vrm ? vrm.scene : gltf.scene

  return (
    <group ref={groupRef}>
      {/* Transparent bounding box — cheap raycast target */}
      <mesh
        ref={catalogProxyRef}
        position={[bounds.center.x * scale, bounds.center.y * scale, bounds.center.z * scale]}
        onClick={(e) => {
          e.stopPropagation()
          if (objectId) {
            useOasisStore.getState().selectObject(objectId)
            useOasisStore.getState().setInspectedObject(objectId)
          }
        }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); if (!useInputManager.getState().pointerLocked) setShowLabel(true) }}
        onPointerOut={(e) => { e.stopPropagation(); setHovered(false); setShowLabel(false) }}
      >
        <boxGeometry args={[bounds.size.x * scale, bounds.size.y * scale, bounds.size.z * scale]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <primitive object={renderScene} scale={scale} />

      {/* Hover glow ring */}
      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.8 * scale, 1 * scale, 32]} />
          <meshBasicMaterial color="#A855F7" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}

      {/* Info label */}
      {showLabel && (
        <Html position={[0, bounds.size.y * scale + 0.5, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            className="px-2 py-1 rounded text-xs whitespace-nowrap select-none pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(168,85,247,0.3)', color: '#A855F7' }}
          >
            {labelName}
            {triCount > 0 && (
              <div className="text-[10px] text-gray-400">
                {triCount >= 1000 ? `${(triCount / 1000).toFixed(1)}k` : triCount} tris • VRM
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS for transform mode (R/T/Y — avoids WASD movement conflict)
// One instance per scene — handles global key bindings
// ═══════════════════════════════════════════════════════════════════════════════

export function TransformKeyHandler() {
  const setTransformMode = useOasisStore(s => s.setTransformMode)
  const selectObject = useOasisStore(s => s.selectObject)
  const cancelPlacement = useOasisStore(s => s.cancelPlacement)
  const exitPaintMode = useOasisStore(s => s.exitPaintMode)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const input = useInputManager.getState()
      const can = input.can()

      // ░▒▓ ESCAPE — always processed, regardless of state ▓▒░
      if (e.key === 'Escape') {
        // First: let InputManager try to handle it (exits agent-focus, ui-focused, paint, placement)
        const consumed = input.handleEscape()
        if (consumed) {
          // Sync oasis store with state machine transition
          const newState = useInputManager.getState().inputState
          if (newState !== 'agent-focus') {
            useOasisStore.getState().focusAgentWindow(null)
          }
          if (newState !== 'paint') {
            // exitPaintMode only if we were in paint
            if (useOasisStore.getState().paintMode) exitPaintMode()
          }
          if (newState !== 'placement') {
            if (useOasisStore.getState().placementPending) cancelPlacement()
          }
          return
        }
        // Not consumed by state machine → deselect (we're in orbit/noclip/third-person)
        selectObject(null)
        setInspectedObject(null)
        return
      }

      // ░▒▓ ALL OTHER KEYS — check if typing in form element ▓▒░
      const tag = (e.target as HTMLElement).tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable
      if (isTyping) return  // keys go to the form, not to us

      // Block ALL edit shortcuts in read-only view mode
      const { isViewMode: vm, isViewModeEditable: vme } = useOasisStore.getState()
      if (vm && !vme) return

      const key = e.key.toLowerCase()

      // ░▒▓ Ctrl+Z / Ctrl+Shift+Z — Undo/Redo (always available) ▓▒░
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) useOasisStore.getState().redo()
        else useOasisStore.getState().undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault()
        useOasisStore.getState().redo()
        return
      }

      // ░▒▓ Ctrl+C — copy (requires clipboardShortcuts capability) ▓▒░
      if ((e.ctrlKey || e.metaKey) && key === 'c' && can.clipboardShortcuts) {
        const state = useOasisStore.getState()
        const id = state.selectedObjectId
        if (!id) return
        const objPos = state.transforms[id]?.position || [0, 0, 0]
        const catalog = state.placedCatalogAssets.find(a => a.id === id)
        if (catalog) {
          _clipboard = { type: catalog.imageUrl ? 'image' : 'catalog', catalogId: catalog.catalogId, name: catalog.name, path: catalog.glbPath, defaultScale: catalog.scale, imageUrl: catalog.imageUrl, imageFrameStyle: catalog.imageFrameStyle }
          spawnCopyToast(catalog.position || objPos as [number, number, number])
          e.preventDefault()
          return
        }
        const crafted = state.craftedScenes.find(s => s.id === id)
        if (crafted) {
          _clipboard = { type: 'crafted', name: crafted.name, sceneId: crafted.id }
          spawnCopyToast(crafted.position || objPos as [number, number, number])
          e.preventDefault()
          return
        }
        const conjuredAsset = state.conjuredAssets.find(a => a.id === id && a.glbPath)
        if (conjuredAsset) {
          _clipboard = { type: 'catalog', catalogId: conjuredAsset.id, name: conjuredAsset.displayName || conjuredAsset.prompt, path: conjuredAsset.glbPath!, defaultScale: 1 }
          spawnCopyToast(conjuredAsset.position || objPos as [number, number, number])
          e.preventDefault()
          return
        }
        return
      }
      // ░▒▓ Ctrl+V — paste (requires clipboardShortcuts capability) ▓▒░
      if ((e.ctrlKey || e.metaKey) && key === 'v' && can.clipboardShortcuts) {
        if (!_clipboard) return
        e.preventDefault()
        useOasisStore.getState().enterPlacementMode({ ..._clipboard })
        input.transition('placement')
        return
      }

      // Skip all other shortcuts if a modifier is held
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (key) {
        // ░▒▓ Transform mode — R/T/Y (requires transformShortcuts) ▓▒░
        case 'r': if (can.transformShortcuts) setTransformMode('translate'); break
        case 't': if (can.transformShortcuts) setTransformMode('rotate'); break
        case 'y': if (can.transformShortcuts) setTransformMode('scale'); break

        // ░▒▓ Enter — focus agent window (requires enterFocuses) ▓▒░
        case 'enter': {
          if (!can.enterFocuses) break
          const state = useOasisStore.getState()
          const id = state.selectedObjectId
          if (!id) break
          const isAgentWindow = state.placedAgentWindows.some(w => w.id === id)
          if (isAgentWindow) {
            input.enterAgentFocus()
            state.focusAgentWindow(id)
            e.preventDefault()
          }
          break
        }

        // ░▒▓ Delete — remove object (requires deleteShortcut) ▓▒░
        case 'delete': {
          if (!can.deleteShortcut) break
          const state = useOasisStore.getState()
          const id = state.selectedObjectId
          if (!id) break
          const isCatalog = state.placedCatalogAssets.some(a => a.id === id)
          const isCrafted = state.craftedScenes.some(s => s.id === id)
          const isConjured = state.worldConjuredAssetIds.includes(id)
          const isLight = state.worldLights.some(l => l.id === id)
          const isAgentWindow = state.placedAgentWindows.some(w => w.id === id)
          if (isCatalog) state.removeCatalogAsset(id)
          else if (isCrafted) state.removeCraftedScene(id)
          else if (isConjured) state.removeConjuredAssetFromWorld(id)
          else if (isLight) state.removeWorldLight(id)
          else if (isAgentWindow) state.removeAgentWindow(id)
          else break
          selectObject(null)
          setInspectedObject(null)
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setTransformMode, selectObject, cancelPlacement, exitPaintMode, setInspectedObject])

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD LOADER HOOK — ensures world state + conjured assets are loaded
// Idempotent: reads from localStorage + fetches from API on mount
// Also polls active conjurations — this hook lives in ForgeRealm (always mounted),
// so polling survives even when WizardConsole is closed.
// ═══════════════════════════════════════════════════════════════════════════════

const CONJURE_POLL_MS = 5000
const TERMINAL_CONJURE_STATES = ['ready', 'failed']

export function useWorldLoader() {
  const initWorlds = useOasisStore(s => s.initWorlds)
  const setConjuredAssets = useOasisStore(s => s.setConjuredAssets)
  const conjuredAssets = useOasisStore(s => s.conjuredAssets)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discoveryTickRef = useRef(0)

  // ░▒▓ Initial hydration — worlds + conjured assets ▓▒░
  useEffect(() => {
    initWorlds()

    fetch(`${OASIS_BASE}/api/conjure`)
      .then(r => r.json())
      .then(data => {
        const assets = Array.isArray(data) ? data : data.assets
        if (Array.isArray(assets)) {
          setConjuredAssets(assets)
        }
      })
      .catch(err => console.error('[World] Failed to load conjured assets:', err))
  }, [setConjuredAssets, initWorlds])

  // ░▒▓ Poll active conjurations — stable interval, no dependency churn ▓▒░
  // The interval reads from getState() directly, so it never needs to restart.
  // Previous bug: [conjuredAssets] dependency killed/restarted interval on every poll update.
  useEffect(() => {
    if (pollRef.current) return  // already polling (e.g. from Scene.tsx mount)

    pollRef.current = setInterval(async () => {
      const currentAssets = useOasisStore.getState().conjuredAssets

      // ░▒▓ Child discovery — find server-created rig/animate children not yet in store ▓▒░
      // Auto-rig pipeline creates child assets server-side. The poller only polls existing
      // store assets, so children would never appear without this discovery mechanism.
      // Runs every 3rd tick (~15s) to keep it cheap.
      discoveryTickRef.current++
      if (discoveryTickRef.current % 3 === 0) {
        try {
          const discoveryRes = await fetch(`${OASIS_BASE}/api/conjure`, { cache: 'no-store' })
          if (discoveryRes.ok) {
            const discoveryData = await discoveryRes.json()
            const serverAssets = Array.isArray(discoveryData) ? discoveryData : discoveryData.assets
            if (Array.isArray(serverAssets)) {
              const storeIds = new Set(currentAssets.map(a => a.id))
              const newChildren = serverAssets.filter((a: { id: string }) => !storeIds.has(a.id))
              if (newChildren.length > 0) {
                console.log(`[Forge:Poller] Discovered ${newChildren.length} new child asset(s): ${newChildren.map((a: { id: string }) => a.id).join(', ')}`)
                // Merge into store — spread current (preserves client positions) + append new
                useOasisStore.getState().setConjuredAssets([...currentAssets, ...newChildren])
                // ░▒▓ WORLD ISOLATION — only auto-place children whose PARENT is in this world ▓▒░
                // Without this, multi-tab scenarios auto-place children into whatever world
                // is active in EACH tab, causing assets to spawn in the wrong world.
                const currentWorldIds = useOasisStore.getState().worldConjuredAssetIds
                const newWorldIds = newChildren
                  .filter((a: { id: string; sourceAssetId?: string }) => {
                    if (currentWorldIds.includes(a.id)) return false  // already placed
                    // Only auto-place if parent is in this world (or if no parent, it's a root asset from this tab)
                    if (a.sourceAssetId) return currentWorldIds.includes(a.sourceAssetId)
                    return false  // root assets are placed by useConjure, not auto-discovery
                  })
                  .map((a: { id: string }) => a.id)
                if (newWorldIds.length > 0) {
                  useOasisStore.setState(state => ({
                    worldConjuredAssetIds: [...state.worldConjuredAssetIds, ...newWorldIds],
                  }))
                  // Offset children from origin so they don't stack on parent
                  for (let i = 0; i < newWorldIds.length; i++) {
                    const child = newChildren.find((a: { id: string }) => a.id === newWorldIds[i]) as { id: string; position?: [number, number, number] } | undefined
                    if (child?.position) {
                      useOasisStore.getState().setObjectTransform(newWorldIds[i], {
                        position: [child.position[0] + (i + 1) * 2, child.position[1], child.position[2]],
                      })
                    }
                  }
                  setTimeout(() => useOasisStore.getState().saveWorldState(), 200)
                  console.log(`[Forge:Poller] Auto-placed ${newWorldIds.length} child(ren) in world`)
                }
              }
            }
          }
        } catch { /* discovery is best-effort — don't break the poller */ }
      }

      const active = currentAssets.filter(a => !TERMINAL_CONJURE_STATES.includes(a.status))

      if (active.length === 0) return  // nothing to poll, but keep interval alive for new assets

      for (const asset of active) {
        try {
          const res = await fetch(`${OASIS_BASE}/api/conjure/${asset.id}`, {
            cache: 'no-store',  // ░▒▓ Never cache — we need real-time progress ▓▒░
          })
          if (!res.ok) {
            console.warn(`[Forge:Poller] ${asset.id} returned ${res.status}`)
            continue
          }
          const data = await res.json()
          if (data.asset) {
            // ░▒▓ Diagnostic: log progress updates so we can trace the wire ▓▒░
            const prev = useOasisStore.getState().conjuredAssets.find(a => a.id === asset.id)
            if (prev && data.asset.progress !== prev.progress) {
              console.log(`[Forge:Poller] ${asset.id} progress: ${prev.progress}% → ${data.asset.progress}%`)
            }
            // ░▒▓ Strip transform fields — position/scale/rotation are client-owned ▓▒░
            // Server sets random positions; poller must NOT overwrite client placement
            const { position: _p, scale: _s, rotation: _r, ...safeUpdates } = data.asset
            // ░▒▓ Diagnostic: log when asset transitions to ready with glbPath ▓▒░
            if (data.asset.status === 'ready' && data.asset.glbPath && asset.status !== 'ready') {
              console.log(`[Forge:Poller] ${asset.id} READY — glbPath: ${data.asset.glbPath}`)
            }
            useOasisStore.getState().updateConjuredAsset(asset.id, safeUpdates)
          }
        } catch (err) {
          console.warn(`[Forge:Poller] fetch failed for ${asset.id}:`, err)
        }
      }
    }, CONJURE_POLL_MS)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])  // ░▒▓ STABLE — no deps, reads from getState() inside interval ▓▒░
}

// ═══════════════════════════════════════════════════════════════════════════════
// GHOST PREVIEW — Actual transparent model at cursor during placement mode
// ░▒▓ See exactly WHAT you're placing and WHERE it will land ▓▒░
//
// For catalog objects: loads GLB, renders with ghostly transparent materials
// For crafted/library: renders primitives with transparency
// Subtle ground ring underneath for spatial anchoring
// ═══════════════════════════════════════════════════════════════════════════════

const GHOST_OPACITY = 0.35
const NOOP_RAYCAST_GHOST = () => {}

/** ░▒▓ Ghost GLB — loads model, makes every material transparent ▓▒░ */
function GhostGLB({ path, scale }: { path: string; scale: number }) {
  const { scene } = useGLTF(path)

  const ghostScene = useMemo(() => {
    const clone = scene.clone()
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.raycast = NOOP_RAYCAST_GHOST
        const isMulti = Array.isArray(child.material)
        const mats = isMulti ? child.material : [child.material]
        const ghostMats = mats.map((mat: THREE.Material) => {
          if (!mat) return mat
          const ghost = mat.clone()
          ghost.transparent = true
          ghost.opacity = GHOST_OPACITY
          ghost.depthWrite = false
          // Enable vertex colors for Kenney-style models
          if (child.geometry.attributes.color && 'vertexColors' in ghost) {
            ghost.vertexColors = true
          }
          return ghost
        })
        // Preserve original material shape — single or array
        child.material = isMulti ? ghostMats : ghostMats[0]
      }
    })
    return clone
  }, [scene])

  // Dispose cloned mats on unmount
  useEffect(() => {
    return () => {
      ghostScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach(m => m?.dispose())
          child.geometry?.dispose()
        }
      })
    }
  }, [ghostScene])

  return <primitive object={ghostScene} scale={scale} />
}

/** ░▒▓ Ghost crafted scene — primitives rendered transparent ▓▒░ */
function GhostCraftedScene({ sceneId }: { sceneId: string }) {
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const found = sceneLibrary.find(s => s.id === sceneId)
  if (!found) return null
  return (
    <group>
      {found.objects.map((prim, i) => (
        <mesh
          key={`ghost-${i}`}
          position={prim.position}
          rotation={prim.rotation || [0, 0, 0]}
          scale={prim.scale}
        >
          <PrimitiveGeometry type={prim.type} />
          <meshStandardMaterial
            color={prim.color}
            metalness={prim.metalness ?? 0}
            roughness={prim.roughness ?? 0.7}
            transparent
            opacity={GHOST_OPACITY}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/** ░▒▓ Subtle ground ring — spatial anchor beneath the ghost ▓▒░ */
function GhostGroundRing({ color }: { color: string }) {
  const ringRef = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.6
  })
  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[0.6, 0.75, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

/** ░▒▓ GHOST PREVIEW — composites model + ground ring at cursor ▓▒░ */
function GhostPreview({ position, pending }: {
  position: [number, number, number]
  pending: { type: string; path?: string; defaultScale?: number; sceneId?: string }
}) {
  const color = pending.type === 'catalog' ? '#FFD700'
    : pending.type === 'library' || pending.type === 'crafted' ? '#3B82F6'
    : pending.type === 'image' ? '#EC4899'
    : '#FF8C00'

  return (
    <group position={position}>
      <GhostGroundRing color={color} />

      {/* Catalog / conjured → GLB ghost */}
      {pending.path && (
        <Suspense fallback={<PlaceholderBox />}>
          <GhostGLB path={pending.path} scale={pending.defaultScale || 1} />
        </Suspense>
      )}

      {/* Library / crafted → primitive ghost */}
      {pending.sceneId && !pending.path && (
        <GhostCraftedScene sceneId={pending.sceneId} />
      )}

      {/* Fallback beam if no model available (shouldn't happen but safety) */}
      {!pending.path && !pending.sceneId && (
        <mesh position={[0, 2, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 4, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.25} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEMENT OVERLAY — Invisible ground plane that catches clicks during placement
// ░▒▓ 200x200 plane at y=0 — big enough for any reasonable camera position ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function PlacementOverlay() {
  const placementPending = useOasisStore(s => s.placementPending)
  const placeCatalogAssetAt = useOasisStore(s => s.placeCatalogAssetAt)
  const placeImageAt = useOasisStore(s => s.placeImageAt)
  const placeLibrarySceneAt = useOasisStore(s => s.placeLibrarySceneAt)
  const cancelPlacement = useOasisStore(s => s.cancelPlacement)
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null)

  const handleClick = useCallback((e: any) => {
    e.stopPropagation()
    if (!placementPending) return
    const point = e.point as THREE.Vector3
    const pos: [number, number, number] = [point.x, 0, point.z]

    if (placementPending.type === 'catalog' && placementPending.catalogId && placementPending.path) {
      placeCatalogAssetAt(placementPending.catalogId, placementPending.name, placementPending.path, placementPending.defaultScale || 1, pos)
    } else if (placementPending.type === 'conjured' && placementPending.path) {
      // ░▒▓ Conjured multi-placement — uses catalog placement system with conjured GLB path ▓▒░
      const conjId = `conjured-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      placeCatalogAssetAt(conjId, placementPending.name, placementPending.path, placementPending.defaultScale || 1, pos)
    } else if (placementPending.type === 'image' && placementPending.imageUrl) {
      placeImageAt(placementPending.name, placementPending.imageUrl, pos, placementPending.imageFrameStyle)
    } else if (placementPending.type === 'library' && placementPending.sceneId) {
      placeLibrarySceneAt(placementPending.sceneId, pos)
    } else if (placementPending.type === 'agent' && placementPending.agentType) {
      // ░▒▓ Agent window placement — create 3D interactive panel ▓▒░
      const agentWindow = {
        id: `agent-${placementPending.agentType}-${Date.now()}`,
        agentType: placementPending.agentType as import('../../store/oasisStore').AgentWindowType,
        position: [pos[0], 2.5, pos[2]] as [number, number, number],  // elevated so window floats at eye level
        rotation: [0, 0, 0] as [number, number, number],
        scale: 1,
        width: 800,
        height: 600,
        sessionId: placementPending.agentSessionId,
        label: placementPending.name,
      }
      useOasisStore.getState().addAgentWindow(agentWindow)
    } else if (placementPending.type === 'crafted' && placementPending.sceneId) {
      // ░▒▓ Crafted multi-placement — clone the crafted scene at click position ▓▒░
      // Search per-world craftedScenes first, then global sceneLibrary as fallback
      // (Assets→Crafted tab now shows sceneLibrary, so scenes may not be in per-world yet)
      const craftedScenes = useOasisStore.getState().craftedScenes
      const library = useOasisStore.getState().sceneLibrary
      const source = craftedScenes.find(s => s.id === placementPending.sceneId)
        || library.find(s => s.id === placementPending.sceneId)
      if (source) {
        const clone = { ...source, id: `${source.id}-${Date.now()}`, position: pos }
        useOasisStore.setState(state => ({
          craftedScenes: [...state.craftedScenes, clone],
          placementPending: null,
        }))
        useOasisStore.getState().spawnPlacementVfx(pos)
        setTimeout(() => useOasisStore.getState().saveWorldState(), 100)
      } else {
        cancelPlacement()
      }
    } else {
      cancelPlacement()
    }
  }, [placementPending, placeCatalogAssetAt, placeImageAt, placeLibrarySceneAt, cancelPlacement])

  const handlePointerMove = useCallback((e: any) => {
    // ░▒▓ FPS CAMERA FIX — skip R3F pointer events during pointer lock ▓▒░
    // R3F raycaster events corrupt PointerLockControls' delta tracking,
    // causing sudden 20-90° camera snaps. Guard against this.
    if (useInputManager.getState().pointerLocked) return
    const point = e.point as THREE.Vector3
    setHoverPos([point.x, 0, point.z])
  }, [])

  // Right-click = cancel placement mode
  const handleRightClick = useCallback((e: any) => {
    e.stopPropagation()
    e.nativeEvent?.preventDefault?.()
    cancelPlacement()
  }, [cancelPlacement])

  if (!placementPending) return null

  return (
    <>
      {/* Invisible click plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverPos(null)}
        onContextMenu={handleRightClick}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Ghost preview at cursor — actual transparent model */}
      {hoverPos && (
        <GhostPreview position={hoverPos} pending={placementPending} />
      )}

      {/* Placement mode HUD */}
      <Html position={[0, 3, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="text-[11px] font-mono text-yellow-400/80 bg-black/70 px-3 py-1 rounded whitespace-nowrap select-none animate-pulse">
          Click to place {placementPending.name} | ESC or R-click to cancel
        </div>
      </Html>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONJURE PREVIEW — demo a conjure spell without actually conjuring
// ─═̷─═̷─👁─═̷─═̷─ Auto-cycles progress 0→100 over 6 seconds then clears
// ═══════════════════════════════════════════════════════════════════════════════

function ConjurePreviewEffect() {
  const conjurePreview = useOasisStore(s => s.conjurePreview)
  const clearConjurePreview = useOasisStore(s => s.clearConjurePreview)
  const [progress, setProgress] = useState(0)
  const startRef = useRef(0)
  // Resolve 'random' ONCE per preview start — same issue as CraftingInProgressVFX.
  // Inline Math.random() re-rolls on every RAF-driven re-render → cycling glitch.
  const resolvedPreviewRef = useRef<Exclude<ConjureVfxType, 'random'>>('textswirl')

  useEffect(() => {
    if (!conjurePreview) { setProgress(0); return }
    startRef.current = performance.now()
    resolvedPreviewRef.current = conjurePreview.type === 'random'
      ? CONJURE_VFX_LIST[Math.floor(Math.random() * CONJURE_VFX_LIST.length)]
      : conjurePreview.type
    const PREVIEW_DURATION = 6000 // 6 seconds to show full cycle
    let rafId: number

    const tick = () => {
      const elapsed = performance.now() - startRef.current
      const p = Math.min(100, (elapsed / PREVIEW_DURATION) * 100)
      setProgress(p)
      if (p >= 100) {
        clearConjurePreview()
      } else {
        rafId = requestAnimationFrame(tick)
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [conjurePreview, clearConjurePreview])

  if (!conjurePreview) return null

  return (
    <ConjureVFX
      position={[0, 0, 0]}
      prompt="preview spell demonstration"
      progress={progress}
      vfxType={resolvedPreviewRef.current}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRAFTING VFX — Plays at origin while LLM weaves JSON primitives from tokens
// ░▒▓ Reuses the conjure VFX system — crafting is just conjuring in a lower key ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function CraftingInProgressVFX() {
  const craftingInProgress = useOasisStore(s => s.craftingInProgress)
  const craftingPrompt = useOasisStore(s => s.craftingPrompt)
  const conjureVfxType = useOasisStore(s => s.conjureVfxType)
  const allConjuredAssets = useOasisStore(s => s.conjuredAssets)
  const [progress, setProgress] = useState(0)
  const startRef = useRef(0)
  // ░▒▓ RANDOM — resolved ONCE per craft start, stored in ref.
  // Without this, re-renders (60fps from progress tick) would re-pick a new random
  // type every frame, causing the infamous 50ms VFX cycling glitch.
  const resolvedVfxRef = useRef<Exclude<ConjureVfxType, 'random'>>('textswirl')

  useEffect(() => {
    if (!craftingInProgress) { setProgress(0); return }
    startRef.current = performance.now()
    // Resolve random VFX once at craft start — stable for the entire craft duration
    resolvedVfxRef.current = conjureVfxType === 'random'
      ? CONJURE_VFX_LIST[Math.floor(Math.random() * CONJURE_VFX_LIST.length)]
      : conjureVfxType
    let rafId: number
    const tick = () => {
      // Asymptotic progress — never reaches 100, slows as it approaches
      const elapsed = (performance.now() - startRef.current) / 1000
      const p = Math.min(95, 100 * (1 - Math.exp(-elapsed / 8)))
      setProgress(p)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [craftingInProgress, conjureVfxType])

  if (!craftingInProgress) return null

  // ░▒▓ SPAWN OFFSET — place crafting VFX next to any active conjurations, not stacked on top ▓▒░
  const activeConjures = allConjuredAssets.filter(a => !['ready', 'failed'].includes(a.status)).length
  const craftX = activeConjures * 4 + (activeConjures > 0 ? 4 : 0)  // offset past all active conjurations

  return (
    <ConjureVFX
      position={[craftX, 0, 0]}
      prompt={craftingPrompt || 'crafting...'}
      progress={progress}
      vfxType={resolvedVfxRef.current}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHT HELPER ORB — Visual representation of a placed light source
// ─═̷─═̷─💡─═̷─═̷─ Click to select, drag to move. The orb IS the light. ─═̷─═̷─💡─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

const LIGHT_TYPE_EMOJI: Record<string, string> = {
  point: '💡', spot: '🔦', directional: '☀️', ambient: '🌤️', hemisphere: '🌗',
}

function LightHelperOrb({ light }: { light: import('../../lib/conjure/types').WorldLight }) {
  const orbRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  // ░▒▓ Subtle pulse animation — light orbs breathe ▓▒░
  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.5
    }
  })

  if (light.visible === false) return null

  const orbSize = light.type === 'directional' ? 0.4 : light.type === 'ambient' || light.type === 'hemisphere' ? 0.5 : 0.3

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true) }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false) }}
    >
      {/* The actual Three.js light */}
      {light.type === 'point' && (
        <pointLight color={light.color} intensity={light.intensity} />
      )}
      {light.type === 'spot' && (() => {
        const tgt = light.target || [0, -1, 0]
        // Target in LOCAL space (group already positioned at light.position)
        return (
          <spotLight
            ref={(spot: THREE.SpotLight | null) => {
              if (spot) {
                spot.target.position.set(tgt[0] * 10, tgt[1] * 10, tgt[2] * 10)
                if (!spot.target.parent) spot.parent?.add(spot.target)
              }
            }}
            color={light.color}
            intensity={light.intensity}
            angle={(light.angle || 45) * Math.PI / 180}
            penumbra={0.5}
          />
        )
      })()}
      {light.type === 'directional' && (
        <directionalLight color={light.color} intensity={light.intensity} />
      )}
      {light.type === 'ambient' && (
        <ambientLight color={light.color} intensity={light.intensity} />
      )}
      {light.type === 'hemisphere' && (
        <hemisphereLight args={[light.color, light.groundColor || '#3a5f0b', light.intensity]} />
      )}

      {/* Visual helper — cone for spot (shows direction), sphere for others */}
      {light.type === 'spot' ? (() => {
        // Cone points along -Y by default. We need to rotate it to face the target direction.
        const tgt = light.target || [0, -1, 0]
        const dir = new THREE.Vector3(tgt[0], tgt[1], tgt[2]).normalize()
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
        const euler = new THREE.Euler().setFromQuaternion(q)
        const halfAngle = ((light.angle || 45) * Math.PI / 180) / 2
        const coneHeight = 2.0
        const coneRadius = Math.tan(halfAngle) * coneHeight
        return (
          <group rotation={[euler.x, euler.y, euler.z]}>
            {/* Wireframe cone showing beam direction + angle */}
            <mesh position={[0, -coneHeight / 2, 0]}>
              <coneGeometry args={[coneRadius, coneHeight, 16, 1, true]} />
              <meshBasicMaterial color={light.color} wireframe transparent opacity={0.5} />
            </mesh>
            {/* Solid tip orb */}
            <mesh ref={orbRef}>
              <sphereGeometry args={[0.15, 8, 8]} />
              <meshBasicMaterial color={light.color} />
            </mesh>
          </group>
        )
      })() : (
        <>
          <mesh ref={orbRef}>
            <sphereGeometry args={[orbSize, 16, 16]} />
            <meshBasicMaterial color={light.color} transparent opacity={0.7} />
          </mesh>
          {/* Glow ring */}
          <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[orbSize * 1.3, orbSize * 1.6, 32]} />
            <meshBasicMaterial color={light.color} transparent opacity={0.25} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
      {/* Light type label — hover-only, styled to match Forge aesthetic */}
      {hovered && (
        <Html position={[0, orbSize + 0.4, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            className="text-[10px] font-mono px-2 py-1 rounded-md whitespace-nowrap select-none"
            style={{
              background: 'rgba(8, 8, 12, 0.88)',
              border: '1px solid rgba(250, 204, 21, 0.15)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span className="text-yellow-300">{LIGHT_TYPE_EMOJI[light.type]} {light.type}</span>
            <span className="text-gray-400 ml-1">int {light.intensity.toFixed(1)}</span>
          </div>
        </Html>
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD OBJECTS RENDERER — The shared soul of placed objects
// ─═̷─═̷─🌍─═̷─═̷─ Renders ALL Zustand-tracked objects: conjured, crafted, catalog
// + PlacementOverlay for click-to-place + PlacementVFX for spell effects
// Used by any realm that wants to show the user's placed creations
// ═══════════════════════════════════════════════════════════════════════════════

export function WorldObjectsRenderer() {
  const allConjuredAssets = useOasisStore(s => s.conjuredAssets)
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const conjureVfxType = useOasisStore(s => s.conjureVfxType)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const selectObject = useOasisStore(s => s.selectObject)
  const transformMode = useOasisStore(s => s.transformMode)
  const setObjectTransform = useOasisStore(s => s.setObjectTransform)
  const transforms = useOasisStore(s => s.transforms)
  const catalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const spawnPlacementVfx = useOasisStore(s => s.spawnPlacementVfx)

  // Per-world filtering: only show conjured assets placed in THIS world
  const worldAssets = allConjuredAssets.filter(a => worldConjuredAssetIds.includes(a.id))
  const readyAssets = worldAssets.filter(a => a.status === 'ready' && a.glbPath)
  const activeAssets = worldAssets.filter(a => !['ready', 'failed'].includes(a.status))

  // ░▒▓ Track conjured asset status transitions → fire VFX on !ready→ready ▓▒░
  // Also preload GLBs when assets become ready — primes Three.js cache before
  // the component mounts, preventing 404 cache poisoning from Next.js static
  // file latency (the "invisible until F5" bug).
  const prevStatusRef = useRef<Record<string, string>>({})
  useEffect(() => {
    for (const asset of worldAssets) {
      const prev = prevStatusRef.current[asset.id]
      if (prev && prev !== 'ready' && asset.status === 'ready') {
        if (asset.position) spawnPlacementVfx(asset.position)
        // ░▒▓ Preload GLB — clear any cached 404, then prime the loader ▓▒░
        if (asset.glbPath) {
          const url = `${OASIS_BASE}${asset.glbPath}`
          useGLTF.clear(url)
          useGLTF.preload(url)
          console.log(`[Forge:Preload] ${asset.id} — primed useGLTF cache: ${url}`)
        }
      }
      prevStatusRef.current[asset.id] = asset.status
    }
  }, [worldAssets, spawnPlacementVfx])

  // Persist transform changes to per-world localStorage
  const handleTransformChange = useCallback((id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => {
    setObjectTransform(id, { position, rotation, scale })
  }, [setObjectTransform])

  // RTS move-to: right-click on ground sends selected object to position
  // ░▒▓ Only works for assets with walk/run animations — buildings stay put ▓▒░
  const setMoveTarget = useOasisStore(s => s.setMoveTarget)
  const paintMode = useOasisStore(s => s.paintMode)
  const placementPending = useOasisStore(s => s.placementPending)
  const objectMeshStats = useOasisStore(s => s.objectMeshStats)
  const WALK_PATTERNS = /walk|run|move|locomotion|jog/i

  const handleRTSRightClick = useCallback((e: any) => {
    if (!selectedObjectId || paintMode || placementPending) return
    // Guard: only move objects that have walk/run animation clips
    const stats = objectMeshStats[selectedObjectId]
    if (!stats || !stats.clips.some(c => WALK_PATTERNS.test(c.name))) return
    e.stopPropagation()
    e.nativeEvent?.preventDefault?.()
    const point = e.point as THREE.Vector3
    setMoveTarget(selectedObjectId, [point.x, 0, point.z])
  }, [selectedObjectId, paintMode, placementPending, setMoveTarget, objectMeshStats])

  return (
    <group>
      {/* W/E/R keyboard shortcuts for transform modes + ESC for placement cancel */}
      <TransformKeyHandler />
      {/* ░▒▓ "COPIED!" floating 3D toasts ▓▒░ */}
      <CopyToastRenderer />

      {/* ░▒▓ Click-to-place overlay — only active during placement mode ▓▒░ */}
      <PlacementOverlay />

      {/* ░▒▓ RTS move-to — right-click ground sends selected object walking ▓▒░ */}
      {selectedObjectId && !paintMode && !placementPending && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.0005, 0]}
          onContextMenu={handleRTSRightClick}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}

      {/* ░▒▓ Placement spell VFX — self-removing golden effects ▓▒░ */}
      <PlacementVFXRenderer />

      {/* ░▒▓ Conjured objects — text-to-3D manifestations ▓▒░ */}
      {readyAssets.map(asset => {
        const t = transforms[asset.id]
        return (
          <SelectableWrapper
            key={asset.id}
            id={asset.id}
            selected={selectedObjectId === asset.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={handleTransformChange}
            initialPosition={t?.position || asset.position}
            initialRotation={t?.rotation}
            initialScale={t?.scale}
          >
            <Suspense fallback={<PlaceholderBox />}>
              <ConjuredObjectSafe asset={asset} />
            </Suspense>
          </SelectableWrapper>
        )
      })}

      {/* VFX for in-progress conjurations */}
      {activeAssets.map((asset, i) => {
        // ░▒▓ RANDOM — resolve to a stable VFX type per asset (hash-seeded by index) ▓▒░
        const resolvedVfx = conjureVfxType === 'random'
          ? CONJURE_VFX_LIST[i % CONJURE_VFX_LIST.length]
          : conjureVfxType
        return (
          <ConjureVFX
            key={`vfx-${asset.id}`}
            position={asset.position}
            prompt={asset.prompt}
            progress={asset.progress}
            vfxType={resolvedVfx}
          />
        )
      })}

      {/* ░▒▓ Spell preview — click a spell card to demo it at origin ▓▒░ */}
      <ConjurePreviewEffect />

      {/* ░▒▓ Crafting VFX — LLM is weaving geometry from tokens ▓▒░ */}
      <CraftingInProgressVFX />

      {/* ░▒▓ Crafted scenes — LLM-procedural geometry ▓▒░ */}
      {craftedScenes.map(scene => {
        const t = transforms[scene.id]
        return (
          <SelectableWrapper
            key={scene.id}
            id={scene.id}
            selected={selectedObjectId === scene.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={handleTransformChange}
            initialPosition={t?.position || scene.position}
            initialRotation={t?.rotation}
            initialScale={t?.scale}
          >
            <CraftedSceneRenderer scene={scene} onDelete={removeCraftedScene} />
          </SelectableWrapper>
        )
      })}

      {/* ░▒▓ Catalog assets — pre-made models from ASSET_CATALOG ▓▒░ */}
      {catalogAssets.map(ca => {
        const t = transforms[ca.id]
        return (
          <SelectableWrapper
            key={ca.id}
            id={ca.id}
            selected={selectedObjectId === ca.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={handleTransformChange}
            initialPosition={t?.position || ca.position}
            initialRotation={t?.rotation}
            initialScale={t?.scale}
          >
            <CatalogModelErrorBoundary path={ca.imageUrl || ca.glbPath} name={ca.name}>
              <Suspense fallback={<PlaceholderBox />}>
                {ca.imageUrl
                  ? <ImagePlaneRenderer imageUrl={ca.imageUrl} scale={ca.scale} frameStyle={ca.imageFrameStyle} />
                  : ca.glbPath.endsWith('.vrm')
                    ? <VRMCatalogRenderer path={ca.glbPath} scale={ca.scale} objectId={ca.id} displayName={ca.name} />
                    : <CatalogModelRenderer path={ca.glbPath} scale={ca.scale} objectId={ca.id} displayName={ca.name} />
                }
              </Suspense>
            </CatalogModelErrorBoundary>
          </SelectableWrapper>
        )
      })}

      {/* ░▒▓ Agent windows — 3D Claude Code / Merlin / DevCraft panels ▓▒░ */}
      <AgentWindowsSection
        selectedObjectId={selectedObjectId}
        selectObject={selectObject}
        transformMode={transformMode}
        onTransformChange={handleTransformChange}
      />

      {/* ░▒▓ World lights — user-placed light sources with visual orbs ▓▒░ */}
      <WorldLightsSection
        selectedObjectId={selectedObjectId}
        selectObject={selectObject}
        transformMode={transformMode}
      />

      {/* Transform mode HUD */}
      {selectedObjectId && (
        <Html position={[0, 0.5, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="text-[10px] font-mono text-blue-400/60 bg-black/60 px-2 py-0.5 rounded whitespace-nowrap select-none">
            {transformMode.toUpperCase()} | R/T/Y switch | ESC deselect
          </div>
        </Html>
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD LIGHTS SECTION — renders all per-world lights with SelectableWrapper
// Separate component to keep WorldObjectsRenderer clean + isolate light subscriptions
// ═══════════════════════════════════════════════════════════════════════════════

function WorldLightsSection({ selectedObjectId, selectObject, transformMode }: {
  selectedObjectId: string | null
  selectObject: (id: string | null) => void
  transformMode: 'translate' | 'rotate' | 'scale'
}) {
  const worldLights = useOasisStore(s => s.worldLights)
  const setWorldLightTransform = useOasisStore(s => s.setWorldLightTransform)

  const handleLightTransformChange = useCallback((id: string, position: [number, number, number], _rotation: [number, number, number], _scale: [number, number, number]) => {
    setWorldLightTransform(id, position)
  }, [setWorldLightTransform])

  if (worldLights.length === 0) return null

  // Split: positional lights (point/spot) get orbs + SelectableWrapper
  // Scene lights (ambient/hemisphere/directional) are non-positional — just render the light
  const positionalLights = worldLights.filter(l => l.type === 'point' || l.type === 'spot')
  const sceneLights = worldLights.filter(l => l.type === 'ambient' || l.type === 'hemisphere' || l.type === 'directional')

  return (
    <>
      {/* ░▒▓ Positional lights — point/spot: 3D orbs you can click + move ▓▒░ */}
      {positionalLights.map(light => (
        <SelectableWrapper
          key={light.id}
          id={light.id}
          selected={selectedObjectId === light.id}
          onSelect={selectObject}
          transformMode={transformMode}
          onTransformChange={handleLightTransformChange}
          initialPosition={light.position}
        >
          <LightHelperOrb light={light} />
        </SelectableWrapper>
      ))}
      {/* ░▒▓ Scene lights — ambient/hemisphere/directional: no orb, just the light ▓▒░ */}
      {sceneLights.map(light => (
        <group key={light.id}>
          {light.visible !== false && light.type === 'ambient' && (
            <ambientLight color={light.color} intensity={light.intensity} />
          )}
          {light.visible !== false && light.type === 'hemisphere' && (
            <hemisphereLight args={[light.color, light.groundColor || '#3a5f0b', light.intensity]} />
          )}
          {light.visible !== false && light.type === 'directional' && (
            <directionalLight position={light.position} color={light.color} intensity={light.intensity} />
          )}
        </group>
      ))}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT WINDOWS SECTION — renders 3D Claude Code / Merlin / DevCraft panels
// ═══════════════════════════════════════════════════════════════════════════════

function AgentWindowsSection({ selectedObjectId, selectObject, transformMode, onTransformChange }: {
  selectedObjectId: string | null
  selectObject: (id: string | null) => void
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
}) {
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const transforms = useOasisStore(s => s.transforms)

  if (placedAgentWindows.length === 0) return null

  return (
    <>
      {placedAgentWindows.map(win => {
        const t = transforms[win.id]
        return (
          <SelectableWrapper
            key={win.id}
            id={win.id}
            selected={selectedObjectId === win.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={onTransformChange}
            initialPosition={t?.position || win.position}
            initialRotation={t?.rotation || win.rotation}
            initialScale={t?.scale || win.scale}
          >
            <AgentWindow3D window={win} />
          </SelectableWrapper>
        )
      })}
    </>
  )
}

// ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【O̸B̸J̸E̸C̸T̸S̸】▓▓▓▓ॐ▓▓▓▓【S̸H̸A̸R̸E̸D̸】▓▓▓▓

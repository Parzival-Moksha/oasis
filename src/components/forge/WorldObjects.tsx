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
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { TransformControls, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { useOasisStore, type ConjureVfxType, CONJURE_VFX_LIST } from '../../store/oasisStore'
import { ConjuredObjectSafe } from './ConjuredObject'
import { CraftedSceneRenderer, PrimitiveGeometry } from './CraftedSceneRenderer'
import { ConjureVFX } from './ConjureVFX'
import { MarchOrderVFXRenderer } from './MarchOrderVFX'
import { PlacementVFXRenderer } from './PlacementVFX'
import { useMovement } from '../../hooks/useMovement'
// drei useAnimations removed — manual AnimationMixer for proper SkeletonUtils support
import { DragContext, SettingsContext } from '../scene-lib'
import { extractModelStats } from './ModelPreview'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import { loadAnimationClip, retargetClipForVRM, retargetUALClipForVRM, isUALAnimation, LIB_PREFIX, getCachedClip } from '../../lib/forge/animation-library'
import { MindcraftWorld } from './MindcraftWorld'
import { AgentWindow3D } from './AgentWindow3D'
import type { PlacementPending } from '../../store/oasisStore'
import { consumeRecentPointerLockRightClick, useInputManager } from '../../lib/input-manager'
import { dispatch } from '../../lib/event-bus'
import { createLipSyncController, registerLipSync, unregisterLipSync, getLipSync } from '../../lib/lip-sync'
import { clearAvatarLocomotionReady, setAvatarLocomotionReady } from '../../lib/avatar-locomotion-ready'
import { getLiveObjectTransform } from '../../lib/live-object-transforms'
import {
  deriveAvatarAnchoredWindowPlacement,
  deriveWindowAvatarAnchor,
  deriveWindowAvatarScale,
  scalarFromTransformScale,
} from '../../lib/agent-avatar-utils'

const IDLE_CLIP_PATTERNS = /idle|breathe?|stand|rest|pose|wait/i
const WALK_CLIP_PATTERNS = /walk|run|move|locomotion|jog/i
const AGENT_WORK_ANIMATION_ID = 'ual-talking'
import { resolveAgentAvatarUrl } from '../../lib/agent-avatar-catalog'
import { canReceiveMoveOrder, resolveMoveOrderObjectIds } from '../../lib/march-order'

type VRMExpressionManagerLike = {
  expressionMap?: Record<string, unknown>
  setValue: (name: string, value: number) => void
}

const VRM_EXPRESSION_ALIASES = {
  blink: ['blink', 'blink_l', 'blink_r'],
  aa: ['aa', 'a'],
  ih: ['ih', 'i'],
  ou: ['ou', 'u'],
  ee: ['ee', 'e'],
  oh: ['oh', 'o'],
  happy: ['happy', 'joy', 'fun'],
  angry: ['angry'],
  sad: ['sad', 'sorrow'],
  surprised: ['surprised'],
  relaxed: ['relaxed', 'fun'],
} as const

function setVrmExpressionValue(
  expr: VRMExpressionManagerLike,
  aliases: readonly string[],
  value: number,
) {
  const expressionMap = expr.expressionMap
  const target = expressionMap
    ? aliases.find(name => Object.prototype.hasOwnProperty.call(expressionMap, name))
    : aliases[0]
  if (!target) return
  expr.setValue(target, value)
}

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

export function SelectableWrapper({ id, children, selected, onSelect, transformMode, onTransformChange, initialPosition, initialRotation, initialScale, inspectOn = 'click', allowTransform = true, liveTransformResolver }: {
  id: string
  children: React.ReactNode
  selected: boolean
  onSelect: (id: string) => void
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
  initialPosition?: [number, number, number]
  initialRotation?: [number, number, number]
  initialScale?: [number, number, number] | number
  inspectOn?: 'click' | 'double-click'
  allowTransform?: boolean
  liveTransformResolver?: (() => { position?: [number, number, number]; rotation?: [number, number, number] } | null) | undefined
}) {
  const groupRef = useRef<THREE.Group>(null)
  const materializeRef = useRef<THREE.Group>(null)
  const { setIsDragging } = useContext(DragContext)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const isReadOnly = useOasisStore(s => s.isViewMode && !s.isViewModeEditable)
  const { settings: _sceneSettings } = useContext(SettingsContext)
  const isRp1 = _sceneSettings.rp1Mode
  const isAgentFocused = useInputManager(s => s.inputState === 'agent-focus')
  const materialization = useOasisStore(s => s.agentMaterializations[id])
  const clearAgentMaterialization = useOasisStore(s => s.clearAgentMaterialization)

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

  useFrame(() => {
    if (!groupRef.current || !liveTransformResolver) return
    const next = liveTransformResolver()
    if (!next) return
    if (next.position) groupRef.current.position.set(...next.position)
    if (next.rotation) groupRef.current.rotation.set(...next.rotation)
  })

  useFrame(() => {
    const target = materializeRef.current
    if (!target) return

    if (!materialization) {
      if (Math.abs(target.scale.x - 1) > 0.001) target.scale.setScalar(1)
      return
    }

    if (materialization.phase === 'pending' || !materialization.revealStartedAt) {
      target.scale.setScalar(materialization.minScale)
      return
    }

    const elapsed = Date.now() - materialization.revealStartedAt
    const progress = Math.min(1, Math.max(0, elapsed / materialization.revealDurationMs))
    const scale = materialization.minScale + (1 - materialization.minScale) * progress
    target.scale.setScalar(scale)
    if (progress >= 1) clearAgentMaterialization(id)
  })

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
  const handleSelect = useCallback((event: { stopPropagation: () => void }, inspectNow: boolean) => {
    if (isReadOnly || isRp1) return
    event.stopPropagation()
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    onSelect(id)
    if (inspectNow && !useInputManager.getState().pointerLocked) {
      setInspectedObject(id)
    }
  }, [id, isReadOnly, isRp1, onSelect, setInspectedObject])

  return (
    <>
      <group
        ref={groupRef}
        visible={isVisible}
        onDoubleClick={inspectOn === 'double-click' ? e => handleSelect(e, true) : undefined}
        onClick={(e) => {
          if (isReadOnly || isRp1) return  // ░▒▓ Read-only / RP1 — no selection ▓▒░
          e.stopPropagation()
          // Force-blur any focused panel input — breaks the ui-focused trance
          if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
          onSelect(id)
          if (inspectOn === 'click' && !useInputManager.getState().pointerLocked) setInspectedObject(id)
        }}
      >
        {/* Selection highlight ring — on the ground, hidden in agent-focus */}
        {selected && !isAgentFocused && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <ringGeometry args={[1.5, 1.8, 32]} />
            <meshBasicMaterial color="#3B82F6" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        )}
        <group ref={materializeRef}>
          {children}
        </group>
      </group>

      {/* TransformControls — callback ref ensures listener attaches on mount */}
      {/* Hidden in agent-focus mode — gizmo would obstruct the zoomon view */}
      {selected && allowTransform && groupRef.current && !isReadOnly && !isRp1 && !isAgentFocused && (
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

// ─═̷─ FRAME STYLE DEFINITIONS — re-exported from FrameComponents.tsx ─═̷─
import { FRAME_STYLES as _FRAME_STYLES, FourBarFrame, NeonFrame, HologramFrame, VoidFrame, SpaghettiFrame, TriangleFrame, InfernoFrame, MatrixFrame, PlasmaFrame, BrutalistFrame } from './FrameComponents'
export { FourBarFrame, NeonFrame, HologramFrame, VoidFrame, SpaghettiFrame, TriangleFrame, InfernoFrame, MatrixFrame, PlasmaFrame, BrutalistFrame }
export const FRAME_STYLES = _FRAME_STYLES
export type { FrameStyleDef } from './FrameComponents'

export function ImagePlaneRenderer({ imageUrl, scale, frameStyle, frameThickness = 1 }: { imageUrl: string; scale: number; frameStyle?: string; frameThickness?: number }) {
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

      {/* ░▒▓ ft = frame thickness multiplier (user-controlled via Joystick slider) ▓▒░ */}
      {(() => {
        const ft = frameThickness
        return <>
          {/* 1. GILDED — gold museum frame with inner accent (z-offset prevents z-fighting) */}
          {frameStyle === 'gilded' && (<>
            <group position={[0, 0, -0.015 * scale]}>
              <FourBarFrame w={w} h={h} border={0.04 * scale * ft} depth={0.025 * scale * ft} color="#B8860B" roughness={0.25} metalness={0.85} />
            </group>
            <group position={[0, 0, 0.005 * scale]}>
              <FourBarFrame w={w} h={h} border={0.008 * scale * ft} depth={0.005 * scale * ft} color="#FFD700" roughness={0.1} metalness={1.0} emissive="#DAA520" emissiveIntensity={0.3} />
            </group>
          </>)}

          {/* 2. NEON — pulsing cyberpunk glow */}
          {frameStyle === 'neon' && <NeonFrame w={w} h={h} scale={scale * ft} />}

          {/* 3. MINIMAL — hairline black wire frame */}
          {frameStyle === 'thin' && (
            <FourBarFrame w={w} h={h} border={0.006 * scale * ft} depth={0.003 * scale * ft} color="#1a1a1a" roughness={0.9} metalness={0.0} />
          )}

          {/* 4. BAROQUE — triple-layer ornate royal frame (z-offsets prevent z-fighting) */}
          {frameStyle === 'baroque' && (<>
            <group position={[0, 0, -0.025 * scale]}>
              <FourBarFrame w={w} h={h} border={0.08 * scale * ft} depth={0.04 * scale * ft} color="#3E1C00" roughness={0.3} metalness={0.7} />
            </group>
            <group position={[0, 0, 0.005 * scale]}>
              <FourBarFrame w={w} h={h} border={0.02 * scale * ft} depth={0.015 * scale * ft} color="#FFD700" roughness={0.15} metalness={0.95} emissive="#DAA520" emissiveIntensity={0.2} />
            </group>
            <group position={[0, 0, 0.02 * scale]}>
              <FourBarFrame w={w + 0.12 * scale * ft} h={h + 0.12 * scale * ft} border={0.012 * scale * ft} depth={0.006 * scale * ft} color="#B8860B" roughness={0.2} metalness={0.9} emissive="#DAA520" emissiveIntensity={0.15} />
            </group>
          </>)}

          {/* 5. HOLOGRAM — floating corner brackets with scanline */}
          {frameStyle === 'hologram' && <HologramFrame w={w} h={h} scale={scale * ft} />}

          {/* 6. RUSTIC — weathered dark wood */}
          {frameStyle === 'rustic' && (
            <FourBarFrame w={w} h={h} border={0.05 * scale * ft} depth={0.025 * scale * ft} color="#3E2723" roughness={0.95} metalness={0.0} />
          )}

          {/* 7. FROZEN — translucent ice crystal with glow */}
          {frameStyle === 'ice' && (<>
            <FourBarFrame w={w} h={h} border={0.04 * scale * ft} depth={0.02 * scale * ft} color="#B3E5FC" roughness={0.05} metalness={0.1} transparent opacity={0.5} emissive="#81D4FA" emissiveIntensity={0.6} />
            <FourBarFrame w={w} h={h} border={0.008 * scale * ft} depth={0.003 * scale * ft} color="#E1F5FE" roughness={0.0} metalness={0.0} emissive="#B3E5FC" emissiveIntensity={1.5} transparent opacity={0.3} />
          </>)}

          {/* 8. VOID — dark portal with glowing inner edge (z-offset to prevent flicker) */}
          {frameStyle === 'void' && (<>
            <group position={[0, 0, -0.005 * scale]}>
              <FourBarFrame w={w} h={h} border={0.05 * scale * ft} depth={0.035 * scale * ft} color="#050505" roughness={0.95} metalness={0.05} />
            </group>
            <group position={[0, 0, 0.002 * scale]}>
              <FourBarFrame w={w} h={h} border={0.006 * scale * ft} depth={0.003 * scale * ft} color="#14b8a6" roughness={0.0} metalness={1.0} emissive="#14b8a6" emissiveIntensity={3} />
            </group>
          </>)}

          {/* 9. SPAGHETTI — tangled glowing tubes */}
          {frameStyle === 'spaghetti' && <SpaghettiFrame w={w} h={h} scale={scale * ft} />}

          {/* 10. PRISM — triangular cross-section */}
          {frameStyle === 'triangle' && <TriangleFrame w={w} h={h} scale={scale * ft} />}

          {/* 11. INFERNO — fire-colored pulsing */}
          {frameStyle === 'fire' && <InfernoFrame w={w} h={h} scale={scale * ft} />}

          {/* 12. MATRIX — green digital rain */}
          {frameStyle === 'matrix' && <MatrixFrame w={w} h={h} scale={scale * ft} />}

          {/* 13. PLASMA — color-cycling glow */}
          {frameStyle === 'plasma' && <PlasmaFrame w={w} h={h} scale={scale * ft} />}

          {/* 14. BRUTALIST — thick concrete slab */}
          {frameStyle === 'brutalist' && <BrutalistFrame w={w} h={h} scale={scale * ft} />}
        </>
      })()}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO PLANE RENDERER — Video texture on a 3D plane
// ░▒▓ <video> element → CanvasTexture updated every frame ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

export function VideoPlaneRenderer({ objectId, videoUrl, scale, frameStyle, frameThickness = 1 }: {
  objectId?: string; videoUrl: string; scale: number; frameStyle?: string; frameThickness?: number
}) {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null)
  const textureRef = useRef<THREE.VideoTexture | null>(null)
  const [aspect, setAspect] = useState(16 / 9)
  const [progress, setProgress] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const groupRef = useRef<THREE.Group>(null!)

  // Read audio state from behaviors store (Joystick controls these)
  const audioState = useOasisStore(s => objectId ? s.behaviors[objectId]?.audioState : undefined) || 'playing'
  const audioMuted = useOasisStore(s => objectId ? s.behaviors[objectId]?.audioMuted : undefined) || false
  const audioVolume = useOasisStore(s => objectId ? s.behaviors[objectId]?.audioVolume : undefined) ?? 1
  const audioMaxDistance = useOasisStore(s => objectId ? s.behaviors[objectId]?.audioMaxDistance : undefined) ?? 15
  const audioLoop = useOasisStore(s => objectId ? s.behaviors[objectId]?.audioLoop : undefined) ?? true

  useEffect(() => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.loop = true
    video.playsInline = true
    video.autoplay = true
    video.muted = true // Required for autoplay
    video.preload = 'auto'
    // Keep the element minimally composited. Some browsers stop presenting frames
    // when the source video is fully hidden or shoved far offscreen.
    video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none;z-index:-1'
    document.body.appendChild(video)
    videoRef.current = video

    let tex: THREE.VideoTexture | null = null
    let disposed = false
    let fallbackInterval: ReturnType<typeof setInterval> | null = null
    const supportsFrameCallback = typeof (video as HTMLVideoElement & {
      requestVideoFrameCallback?: unknown
    }).requestVideoFrameCallback === 'function'
    let firstPresentedFrame = false

    const watchPresentedFrame = () => {
      if (disposed || !supportsFrameCallback) return
      ;(video as HTMLVideoElement & {
        requestVideoFrameCallback: (callback: () => void) => number
      }).requestVideoFrameCallback(() => {
        firstPresentedFrame = true
        createTexture('requestVideoFrameCallback')
        if (!tex) watchPresentedFrame()
      })
    }

    const createTexture = (trigger: string) => {
      if (tex || disposed) return
      if (!video.videoWidth || !video.videoHeight) {
        console.warn(`[VideoPlane] ${trigger} fired but videoWidth=0, deferring:`, videoUrl)
        return
      }
      if (supportsFrameCallback && !firstPresentedFrame) return
      console.log(`[VideoPlane] Texture created via "${trigger}" for:`, videoUrl,
        `readyState=${video.readyState}, videoWidth=${video.videoWidth}`)
      tex = new THREE.VideoTexture(video)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = false
      setTexture(tex)
      textureRef.current = tex
      if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null }
    }

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight)
    })

    video.addEventListener('error', (e) => {
      console.error('[VideoPlane] Load error:', videoUrl, (e.target as HTMLVideoElement)?.error)
    })

    const onCanPlay = () => {
      if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        createTexture('canplay')
      }
    }
    const onLoadedData = () => {
      if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        createTexture('loadeddata')
      }
    }
    const onPlaying = () => {
      if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        createTexture('playing')
      }
    }
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('loadeddata', onLoadedData)
    video.addEventListener('playing', onPlaying)

    watchPresentedFrame()

    video.src = videoUrl

    requestAnimationFrame(() => {
      if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        createTexture('raf-deferred')
      }
    })

    const pollStart = Date.now()
    fallbackInterval = setInterval(() => {
      if (tex || disposed) {
        if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null }
        return
      }
      if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        createTexture('fallback-interval')
      }
      if (Date.now() - pollStart > 2000 && fallbackInterval) {
        clearInterval(fallbackInterval)
        fallbackInterval = setInterval(() => {
          if (tex || disposed) {
            if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null }
            return
          }
          if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            createTexture('fallback-interval-slow')
          }
        }, 200)
      }
    }, 100)
    const fallbackTimeout = setTimeout(() => {
      if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null }
      if (!tex && !disposed && !supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        console.warn('[VideoPlane] Last-resort texture creation at readyState', video.readyState, videoUrl)
        if (video.videoWidth && video.videoHeight) createTexture('last-resort')
      }
    }, 10000)

    void video.play()
      .then(() => {
        if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          createTexture('play-resolved')
        }
      })
      .catch(() => {
        setTimeout(() => {
          void video.play()
            .then(() => {
              if (!supportsFrameCallback && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                createTexture('play-retry')
              }
            })
            .catch(() => {})
        }, 500)
      })

    // Register in audio element map so Joystick can seek
    if (objectId) _audioElements.set(objectId, video)

    return () => {
      disposed = true
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('playing', onPlaying)
      if (fallbackInterval) clearInterval(fallbackInterval)
      clearTimeout(fallbackTimeout)
      video.pause()
      video.removeAttribute('src')
      video.load()
      try { document.body.removeChild(video) } catch {}
      if (tex) tex.dispose()
      videoRef.current = null
      textureRef.current = null
      setTexture(null)
      if (objectId) _audioElements.delete(objectId)
    }
  }, [videoUrl, objectId])

  // React to audioState changes from Joystick
  useEffect(() => {
    if (!videoRef.current) return
    if (audioState === 'playing') {
      videoRef.current.muted = false // User already interacted via Joystick
      videoRef.current.play().catch(() => {})
    } else if (audioState === 'paused') {
      videoRef.current.pause()
    } else if (audioState === 'stopped') {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }, [audioState])

  // React to loop changes
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = audioLoop
  }, [audioLoop])

  // Reusable vector — avoid GC pressure from per-frame allocation
  const _worldPos = useRef(new THREE.Vector3())
  const lastProgressUpdate = useRef(0)

  // Spatial volume + progress tracking
  useFrame(({ camera }) => {
    if (!videoRef.current || !groupRef.current) return

    // Progress tracking — throttled to 4fps (250ms) to avoid React re-render spam
    const now = performance.now()
    if (now - lastProgressUpdate.current > 250) {
      lastProgressUpdate.current = now
      if (videoRef.current.duration && isFinite(videoRef.current.duration)) {
        setProgress(videoRef.current.currentTime / videoRef.current.duration)
      }
    }
    if (textureRef.current) textureRef.current.needsUpdate = true

    // Spatial volume: log falloff, hard zero at maxDist
    if (audioMuted || audioState !== 'playing') { videoRef.current.volume = 0; return }
    groupRef.current.getWorldPosition(_worldPos.current)
    const dist = camera.position.distanceTo(_worldPos.current)

    if (dist >= audioMaxDistance) { videoRef.current.volume = 0; return }
    const refDist = 0.5
    if (dist <= refDist) { videoRef.current.volume = Math.min(1, audioVolume); return }
    const logRatio = Math.log(dist / refDist) / Math.log(audioMaxDistance / refDist)
    videoRef.current.volume = Math.min(1, Math.max(0, audioVolume * (1 - logRatio)))
  })

  const seek = useCallback((frac: number) => {
    if (!videoRef.current || !videoRef.current.duration) return
    videoRef.current.currentTime = frac * videoRef.current.duration
  }, [])

  const w = scale * aspect
  const h = scale
  const barW = w * 0.9
  const barH = 0.03 * scale

  return (
    <group ref={groupRef} position={[0, h / 2, 0]}>
      {/* Video plane — NO onClick here, let SelectableWrapper handle selection */}
      <mesh key={aspect}>
        <planeGeometry args={[w, h]} />
        {texture ? (
          <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#111" side={THREE.DoubleSide} />
        )}
      </mesh>

      {/* ░▒▓ FRAMES — same styles as ImagePlaneRenderer ▓▒░ */}
      {frameStyle && (() => {
        const ft = frameThickness
        return <>
          {frameStyle === 'gilded' && (<><group position={[0, 0, -0.015 * scale]}><FourBarFrame w={w} h={h} border={0.04 * scale * ft} depth={0.025 * scale * ft} color="#B8860B" roughness={0.25} metalness={0.85} /></group><group position={[0, 0, 0.005 * scale]}><FourBarFrame w={w} h={h} border={0.008 * scale * ft} depth={0.005 * scale * ft} color="#FFD700" roughness={0.1} metalness={1.0} emissive="#DAA520" emissiveIntensity={0.3} /></group></>)}
          {frameStyle === 'neon' && <NeonFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'thin' && <FourBarFrame w={w} h={h} border={0.006 * scale * ft} depth={0.003 * scale * ft} color="#1a1a1a" roughness={0.9} metalness={0.0} />}
          {frameStyle === 'baroque' && (<><group position={[0, 0, -0.025 * scale]}><FourBarFrame w={w} h={h} border={0.08 * scale * ft} depth={0.04 * scale * ft} color="#3E1C00" roughness={0.3} metalness={0.7} /></group><group position={[0, 0, 0.005 * scale]}><FourBarFrame w={w} h={h} border={0.02 * scale * ft} depth={0.015 * scale * ft} color="#FFD700" roughness={0.15} metalness={0.95} emissive="#DAA520" emissiveIntensity={0.2} /></group></>)}
          {frameStyle === 'hologram' && <HologramFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'rustic' && <FourBarFrame w={w} h={h} border={0.05 * scale * ft} depth={0.025 * scale * ft} color="#3E2723" roughness={0.95} metalness={0.0} />}
          {frameStyle === 'ice' && (<><FourBarFrame w={w} h={h} border={0.04 * scale * ft} depth={0.02 * scale * ft} color="#B3E5FC" roughness={0.05} metalness={0.1} transparent opacity={0.5} emissive="#81D4FA" emissiveIntensity={0.6} /></>)}
          {frameStyle === 'void' && (<><group position={[0, 0, -0.005 * scale]}><FourBarFrame w={w} h={h} border={0.05 * scale * ft} depth={0.035 * scale * ft} color="#050505" roughness={0.95} metalness={0.05} /></group><group position={[0, 0, 0.002 * scale]}><FourBarFrame w={w} h={h} border={0.006 * scale * ft} depth={0.003 * scale * ft} color="#14b8a6" roughness={0.0} metalness={1.0} emissive="#14b8a6" emissiveIntensity={3} /></group></>)}
          {frameStyle === 'spaghetti' && <SpaghettiFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'triangle' && <TriangleFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'fire' && <InfernoFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'matrix' && <MatrixFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'plasma' && <PlasmaFrame w={w} h={h} scale={scale * ft} />}
          {frameStyle === 'brutalist' && <BrutalistFrame w={w} h={h} scale={scale * ft} />}
        </>
      })()}

      {/* Playback progress bar — bottom of video */}
      <group position={[0, -h / 2 - barH * 2, 0.005]}>
        {/* Background track */}
        <mesh>
          <planeGeometry args={[barW, barH]} />
          <meshBasicMaterial color="#222" transparent opacity={0.8} />
        </mesh>
        {/* Progress fill */}
        <mesh position={[-(barW * (1 - progress)) / 2, 0, 0.001]}>
          <planeGeometry args={[barW * Math.max(0.001, progress), barH]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
        {/* Seek hitbox — invisible wider bar for clicking */}
        <mesh
          position={[0, 0, 0.002]}
          onClick={(e) => {
            e.stopPropagation()
            if (!e.uv) return
            seek(e.uv.x) // UV x = 0 (left) to 1 (right)
          }}
        >
          <planeGeometry args={[barW, barH * 4]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>

      {/* Pause/stop overlay icon — visual only, play controlled from Joystick */}
      {audioState !== 'playing' && (
        <mesh position={[0, 0, 0.01]}>
          <circleGeometry args={[0.15 * scale, 32]} />
          <meshBasicMaterial color="#000" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPATIAL AUDIO ATTACHMENT — attach to ANY placed object to make it a loudspeaker
// ░▒▓ Loads audio file + plays with 3D positional falloff ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

export function SpatialAudioAttachment({ objectId, audioUrl, volume = 1, maxDistance = 15, muted = false, audioState = 'playing', loop = true }: {
  objectId?: string; audioUrl: string; volume?: number; maxDistance?: number; muted?: boolean; audioState?: 'playing' | 'paused' | 'stopped'; loop?: boolean
}) {
  const groupRef = useRef<THREE.Group>(null!)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const propsRef = useRef({ volume, maxDistance, muted, audioState })
  propsRef.current = { volume, maxDistance, muted, audioState }

  // Create HTML5 Audio element — only on URL change
  useEffect(() => {
    const audio = new Audio(audioUrl)
    audio.loop = loop
    audio.volume = 0 // Will be set by useFrame based on distance
    audioRef.current = audio
    if (objectId) _audioElements.set(objectId, audio)
    // ░▒▓ LIP SYNC — attach analyser to audio element ▓▒░
    let lipSyncCtrl: ReturnType<typeof createLipSyncController> | null = null
    if (objectId) {
      lipSyncCtrl = createLipSyncController()
      lipSyncCtrl.attachAudio(audio)
      registerLipSync(objectId, lipSyncCtrl)
    }
    // Autoplay if state is 'playing'
    if (audioState !== 'stopped' && audioState !== 'paused') {
      audio.play().catch(() => {})
    }
    return () => {
      audio.pause()
      audio.src = ''
      audioRef.current = null
      if (objectId) _audioElements.delete(objectId)
      // ░▒▓ LIP SYNC cleanup ▓▒░
      if (lipSyncCtrl) lipSyncCtrl.detach()
      if (objectId) unregisterLipSync(objectId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl])

  // Real play/pause/stop — reacts to audioState changes
  useEffect(() => {
    if (!audioRef.current) return
    if (audioState === 'playing') {
      audioRef.current.play().catch(() => {})
    } else if (audioState === 'paused') {
      audioRef.current.pause()
    } else if (audioState === 'stopped') {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }, [audioState])

  // Loop toggle
  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = loop
  }, [loop])

  // Reusable vector — avoid GC pressure
  const _audioWorldPos = useRef(new THREE.Vector3())

  // Spatial volume — log falloff, hard cutoff at maxDist
  useFrame(({ camera }) => {
    if (!audioRef.current || !groupRef.current) return
    const { volume: vol, maxDistance: maxDist, muted: isMuted, audioState: state } = propsRef.current
    if (isMuted || state === 'paused' || state === 'stopped') { audioRef.current.volume = 0; return }

    groupRef.current.getWorldPosition(_audioWorldPos.current)
    const dist = camera.position.distanceTo(_audioWorldPos.current)

    if (dist >= maxDist) { audioRef.current.volume = 0; return }
    const refDist = 0.5
    if (dist <= refDist) { audioRef.current.volume = Math.min(1, vol); return }
    const logRatio = Math.log(dist / refDist) / Math.log(maxDist / refDist)
    audioRef.current.volume = Math.min(1, Math.max(0, vol * (1 - logRatio)))
  })

  return <group ref={groupRef} />
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO SOURCE RENDERER — placeholder mesh for audio-only placements (loudspeaker)
// ░▒▓ Used when CatalogPlacement has audioUrl but no imageUrl/videoUrl/glbPath ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

export function AudioSourceRenderer({ scale }: { scale: number }) {
  const s = scale
  return (
    <group position={[0, s * 0.5, 0]}>
      {/* Speaker cabinet */}
      <mesh>
        <boxGeometry args={[s * 0.7, s, s * 0.6]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* Tweeter (front) */}
      <mesh position={[0, s * 0.22, s * 0.31]}>
        <cylinderGeometry args={[s * 0.12, s * 0.14, s * 0.04, 24]} />
        <meshStandardMaterial color="#222" roughness={0.7} metalness={0.3} />
      </mesh>
      {/* Woofer (front) */}
      <mesh position={[0, -s * 0.18, s * 0.31]}>
        <cylinderGeometry args={[s * 0.22, s * 0.25, s * 0.04, 32]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* Glow ring around woofer to signal it's an audio source */}
      <mesh position={[0, -s * 0.18, s * 0.33]}>
        <ringGeometry args={[s * 0.24, s * 0.27, 32]} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO ELEMENT REGISTRY — allows Joystick to read/seek playback position
// ═══════════════════════════════════════════════════════════════════════════════

const _audioElements = new Map<string, HTMLAudioElement>()
export function getAudioElement(objectId: string): HTMLAudioElement | null {
  return _audioElements.get(objectId) ?? null
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPATIAL AUDIO FROM BEHAVIOR — reads audioUrl from object behaviors store
// ░▒▓ Wraps SpatialAudioAttachment with Zustand subscription ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function SpatialAudioFromBehavior({ objectId }: { objectId: string }) {
  const audioUrl = useOasisStore(s => s.behaviors[objectId]?.audioUrl)
  const audioVolume = useOasisStore(s => s.behaviors[objectId]?.audioVolume)
  const audioMaxDistance = useOasisStore(s => s.behaviors[objectId]?.audioMaxDistance)
  const audioMuted = useOasisStore(s => s.behaviors[objectId]?.audioMuted)
  const audioState = useOasisStore(s => s.behaviors[objectId]?.audioState)
  const audioLoop = useOasisStore(s => s.behaviors[objectId]?.audioLoop)
  // ░▒▓ FIX: Don't mount audio during placement mode — prevents state corruption
  // when loudspeaker auto-plays before placement is confirmed ▓▒░
  const inputState = useInputManager(s => s.inputState)
  if (!audioUrl || inputState === 'placement') return null
  return <SpatialAudioAttachment objectId={objectId} audioUrl={audioUrl} volume={audioVolume} maxDistance={audioMaxDistance} muted={audioMuted} audioState={audioState} loop={audioLoop} />
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
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(clonedScene) }
  }, [clonedScene])

  // ░▒▓ Animation system — plays clips based on ObjectBehavior config ▓▒░
  // Smart auto-play: idle/passive clips only. Walk clip plays during moveTarget.
  const animConfig = useOasisStore(s => objectId ? s.behaviors[objectId]?.animation : undefined)
  const isMoving = useOasisStore(s => objectId ? !!s.behaviors[objectId]?.moveTarget : false)

  // Find best idle and walk clips from available animations
  const { idleClip, walkClip } = useMemo(() => {
    const names = animations.map(a => a.name)
    return {
      idleClip: names.find(n => IDLE_CLIP_PATTERNS.test(n)) || null,
      walkClip: names.find(n => WALK_CLIP_PATTERNS.test(n)) || null,
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

  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer || !objectId) return

    const handleFinished = () => {
      const activeAnimation = useOasisStore.getState().behaviors[objectId]?.animation
      if (!activeAnimation || activeAnimation.loop !== 'once') return
      useOasisStore.getState().setObjectBehavior(objectId, { animation: undefined })
    }

    mixer.addEventListener('finished', handleFinished)
    return () => {
      mixer.removeEventListener('finished', handleFinished)
    }
  }, [objectId])

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
            dispatch({ type: 'SELECT_OBJECT', payload: { id: objectId } })
            if (!useInputManager.getState().pointerLocked) {
              dispatch({ type: 'INSPECT_OBJECT', payload: { id: objectId } })
            }
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          if (useInputManager.getState().pointerLocked) return
          setHovered(true)
          setShowLabel(true)
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          if (useInputManager.getState().pointerLocked) return
          setHovered(false)
          setShowLabel(false)
        }}
      >
        <boxGeometry args={[
          Math.max(bounds.size.x * scale, 1),
          Math.max(bounds.size.y * scale, 1),
          Math.max(bounds.size.z * scale, 1),
        ]} />
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

export function VRMCatalogRenderer({ path, scale, objectId, displayName, activityAnimationId }: { path: string; scale: number; objectId?: string; displayName?: string; activityAnimationId?: string | null }) {
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)
  const [hovered, setHovered] = useState(false)
  const [showLabel, setShowLabel] = useState(false)
  const catalogProxyRef = useRef<THREE.Mesh>(null)
  const paintMode = useOasisStore(s => s.paintMode)
  const iblMaterials = useRef<THREE.MeshStandardMaterial[]>([])
  // Dispose IBL-swapped materials on unmount
  useEffect(() => () => { iblMaterials.current.forEach(m => m.dispose()) }, [])
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
  const activeAnimRef = useRef<'none' | 'idle' | 'walk' | 'behavior' | 'activity'>('none')
  const activeClipRef = useRef<THREE.AnimationClip | null>(null)
  const isMoving = useOasisStore(s => objectId ? !!s.behaviors[objectId]?.moveTarget : false)
  const animConfig = useOasisStore(s => objectId ? s.behaviors[objectId]?.animation : undefined)
  const clipCacheKey = useMemo(() => `${objectId || 'vrm-npc'}::${path}`, [objectId, path])

  // Create mixer on VRM scene
  useEffect(() => {
    if (!vrm) return
    const mixer = new THREE.AnimationMixer(vrm.scene)
    mixerRef.current = mixer
    currentActionRef.current = null
    activeAnimRef.current = 'none'
    activeClipRef.current = null
    return () => {
      mixer.stopAllAction()
      mixerRef.current = null
      currentActionRef.current = null
      activeAnimRef.current = 'none'
      activeClipRef.current = null
    }
  }, [vrm])

  // ░▒▓ Load walk + idle clips from Mixamo FBX library, retarget for THIS VRM ▓▒░
  // FBX pipeline maps 52/52 bones. GLTF characters use non-Mixamo names (4/34 = useless).
  // 'idle' = "Breathing Idle" if available, falls back to 'idle-fight' (snappy but better than T-pose).
  const [walkClip, setWalkClip] = useState<THREE.AnimationClip | null>(null)
  const [idleClip, setIdleClip] = useState<THREE.AnimationClip | null>(null)
  useEffect(() => {
    if (!vrm) return
    let cancelled = false
    setWalkClip(null)
    setIdleClip(null)
    const retargetFor = (clip: THREE.AnimationClip, animId: string, k: string) =>
      isUALAnimation(animId) ? retargetUALClipForVRM(clip, vrm, k) : retargetClipForVRM(clip, vrm, k)
    const retargetUsable = (clip: THREE.AnimationClip, animId: string, k: string): THREE.AnimationClip | null => {
      const retargeted = retargetFor(clip, animId, k)
      return retargeted.tracks.length > 0 ? retargeted : null
    }
    const cachedUalWalk = getCachedClip('ual-walk')
    const cachedWalk = cachedUalWalk || getCachedClip('walk')
    if (cachedWalk) {
      const animId = cachedUalWalk ? 'ual-walk' : 'walk'
      const retargeted = retargetUsable(cachedWalk, animId, clipCacheKey)
      if (retargeted) setWalkClip(retargeted)
    }
    const cachedIdle = getCachedClip('idle')
    if (cachedIdle) {
      setIdleClip(retargetFor(cachedIdle, 'idle', `${clipCacheKey}::idle`))
    }
    loadAnimationClip('ual-walk').then(clip => {
      if (cancelled) return null
      if (clip) {
        const retargeted = retargetUsable(clip, 'ual-walk', clipCacheKey)
        if (retargeted) {
          setWalkClip(retargeted)
          return null
        }
      }
      return loadAnimationClip('walk').then(fbxClip => {
        if (!fbxClip || cancelled) return
        const retargeted = retargetUsable(fbxClip, 'walk', clipCacheKey)
        if (retargeted) setWalkClip(retargeted)
      })
    })
    // Try proper idle first, fall back to idle-fight
    loadAnimationClip('idle').then(clip => {
      if (clip) {
        if (!cancelled) setIdleClip(retargetFor(clip, 'idle', `${clipCacheKey}::idle`))
        return
      }
      return loadAnimationClip('idle-fight').then(fbxClip => {
        if (fbxClip && !cancelled) setIdleClip(retargetFor(fbxClip, 'idle-fight', `${clipCacheKey}::idle`))
      })
    })
    return () => {
      cancelled = true
    }
  }, [clipCacheKey, vrm])

  // Load explicit behavior animation (from ObjectInspector — dance, combat, etc.)
  const [behaviorClip, setBehaviorClip] = useState<THREE.AnimationClip | null>(null)
  useEffect(() => {
    const clipName = animConfig?.clipName
    if (!clipName || !vrm) { setBehaviorClip(null); return }
    let cancelled = false
    setBehaviorClip(null)
    if (clipName.startsWith(LIB_PREFIX)) {
      const animId = clipName.replace(LIB_PREFIX, '')
      loadAnimationClip(animId).then(clip => {
        if (clip && !cancelled) {
          const retargeted = isUALAnimation(animId)
            ? retargetUALClipForVRM(clip, vrm, `${clipCacheKey}::behavior:${animId}`)
            : retargetClipForVRM(clip, vrm, `${clipCacheKey}::behavior:${animId}`)
          setBehaviorClip(retargeted)
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [animConfig?.clipName, clipCacheKey, vrm])

  const [activityClip, setActivityClip] = useState<THREE.AnimationClip | null>(null)
  useEffect(() => {
    const animId = activityAnimationId || ''
    if (!animId || !vrm) { setActivityClip(null); return }
    let cancelled = false
    setActivityClip(null)
    loadAnimationClip(animId).then(clip => {
      if (!clip || cancelled) return
      const retargeted = isUALAnimation(animId)
        ? retargetUALClipForVRM(clip, vrm, `${clipCacheKey}::activity:${animId}`)
        : retargetClipForVRM(clip, vrm, `${clipCacheKey}::activity:${animId}`)
      if (retargeted.tracks.length > 0) setActivityClip(retargeted)
    }).catch(() => {
      if (!cancelled) setActivityClip(null)
    })
    return () => {
      cancelled = true
    }
  }, [activityAnimationId, clipCacheKey, vrm])

  useEffect(() => {
    if (!objectId) return
    setAvatarLocomotionReady(objectId, false)
    return () => {
      clearAvatarLocomotionReady(objectId)
    }
  }, [objectId, path])

  useEffect(() => {
    if (!objectId) return
    setAvatarLocomotionReady(objectId, Boolean(vrm && walkClip))
  }, [objectId, vrm, walkClip])

  // ░▒▓ Animation state machine — behavior > walk > idle ▓▒░
  // Deterministic: compute desired state, skip if already there, otherwise transition.
  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer) return

    // Determine what SHOULD play right now
    let target: 'behavior' | 'walk' | 'activity' | 'idle' | 'none' = 'none'
    let targetClip: THREE.AnimationClip | null = null
    if (isMoving && walkClip) { target = 'walk'; targetClip = walkClip }
    else if (behaviorClip) { target = 'behavior'; targetClip = behaviorClip }
    else if (activityClip) { target = 'activity'; targetClip = activityClip }
    else if (idleClip) { target = 'idle'; targetClip = idleClip }

    // Already playing same state AND same clip → no-op
    // (clip check catches behavior-to-behavior switches like dance→combat)
    if (target === activeAnimRef.current && targetClip === activeClipRef.current) return

    // Fade out current action
    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(0.3)
      currentActionRef.current = null
    }

    // Resolve clip for target state
    let clip: THREE.AnimationClip | null = null
    if (target === 'behavior') clip = behaviorClip
    else if (target === 'walk') clip = walkClip
    else if (target === 'activity') clip = activityClip
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
        // Walk anim sped up 2x — feet were lagging behind translation (oasisspec3 fix)
        if (target === 'walk') action.timeScale = 2
        if (target === 'activity') action.timeScale = 1
      }
      action.reset().fadeIn(0.3).play()
      currentActionRef.current = action
    }

    activeAnimRef.current = target
    activeClipRef.current = targetClip
    console.log(`[VRM:NPC] ${displayName || objectId} → anim: ${target}`)
  }, [isMoving, walkClip, idleClip, behaviorClip, activityClip, animConfig?.loop, animConfig?.speed, displayName, objectId])

  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer || !objectId) return

    const handleFinished = () => {
      const activeAnimation = useOasisStore.getState().behaviors[objectId]?.animation
      if (!activeAnimation || activeAnimation.loop !== 'once') return
      useOasisStore.getState().setObjectBehavior(objectId, { animation: undefined })
    }

    mixer.addEventListener('finished', handleFinished)
    return () => {
      mixer.removeEventListener('finished', handleFinished)
    }
  }, [objectId])

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
            iblMaterials.current.push(std)
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
      setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.blink, (blinkPhase > 3.7 && blinkPhase < 3.9) ? 1 : 0)

      // ░▒▓ LIP SYNC — call controller.update() every frame, apply visemes directly ▓▒░
      const lipCtrl = objectId ? getLipSync(objectId) : null
      const lipState = lipCtrl?.isActive ? lipCtrl.update() : null
      const clearLipVisemes = () => {
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.aa, 0)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ih, 0)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ou, 0)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ee, 0)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.oh, 0)
      }

      // ░▒▓ Joystick expression overrides — if set, they take priority over defaults ▓▒░
      const exprOverrides = objectId ? useOasisStore.getState().behaviors[objectId]?.expressions : undefined
      if (lipState && (lipState.aa > 0.01 || lipState.oh > 0.01 || lipState.ee > 0.01)) {
        // Lip sync producing values → drive visemes from FFT analyser
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.aa, lipState.aa)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ih, lipState.ih)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ou, lipState.ou)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ee, lipState.ee)
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.oh, lipState.oh)
        // Still apply emotion overrides from Joystick (happy, angry, etc.)
        if (exprOverrides) {
          if (exprOverrides.happy != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.happy, exprOverrides.happy)
          if (exprOverrides.angry != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.angry, exprOverrides.angry)
          if (exprOverrides.sad != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.sad, exprOverrides.sad)
          if (exprOverrides.surprised != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.surprised, exprOverrides.surprised)
          if (exprOverrides.relaxed != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.relaxed, exprOverrides.relaxed)
        }
      } else if (exprOverrides && Object.keys(exprOverrides).length > 0) {
        clearLipVisemes()
        // No lip sync → Joystick expression overrides
        if (exprOverrides.happy != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.happy, exprOverrides.happy)
        if (exprOverrides.angry != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.angry, exprOverrides.angry)
        if (exprOverrides.sad != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.sad, exprOverrides.sad)
        if (exprOverrides.surprised != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.surprised, exprOverrides.surprised)
        if (exprOverrides.relaxed != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.relaxed, exprOverrides.relaxed)
        if (exprOverrides.aa != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.aa, exprOverrides.aa)
        if (exprOverrides.ih != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ih, exprOverrides.ih)
        if (exprOverrides.ou != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ou, exprOverrides.ou)
        if (exprOverrides.ee != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.ee, exprOverrides.ee)
        if (exprOverrides.oh != null) setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.oh, exprOverrides.oh)
      } else {
        clearLipVisemes()
        // Default: subtle breathing smile
        const smileAmount = Math.sin(t * 0.3) * 0.15 + 0.1
        setVrmExpressionValue(expr, VRM_EXPRESSION_ALIASES.happy, Math.max(0, smileAmount))
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
            dispatch({ type: 'SELECT_OBJECT', payload: { id: objectId } })
            if (!useInputManager.getState().pointerLocked) {
              dispatch({ type: 'INSPECT_OBJECT', payload: { id: objectId } })
            }
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          if (useInputManager.getState().pointerLocked) return
          setHovered(true)
          setShowLabel(true)
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          if (useInputManager.getState().pointerLocked) return
          setHovered(false)
          setShowLabel(false)
        }}
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const input = useInputManager.getState()
      const can = input.can()

      // ░▒▓ ESCAPE — always processed, regardless of state ▓▒░
      if (e.key === 'Escape') {
        const consumed = input.handleEscape()
        if (consumed) {
          // Sync oasis store — dispatch through EventBus for clean logging
          const newState = useInputManager.getState().inputState
          if (newState !== 'agent-focus') {
            dispatch({ type: 'UNFOCUS_AGENT_WINDOW' })
            dispatch({ type: 'UNFOCUS_IMAGE' })
          }
          if (newState !== 'paint' && useOasisStore.getState().paintMode) {
            dispatch({ type: 'EXIT_PAINT_MODE' })
          }
          if (newState !== 'placement' && useOasisStore.getState().placementPending) {
            dispatch({ type: 'CANCEL_PLACEMENT' })
          }
          return
        }
        // Not consumed → deselect
        dispatch({ type: 'SELECT_OBJECT', payload: { id: null } })
        dispatch({ type: 'INSPECT_OBJECT', payload: { id: null } })
        return
      }

      // ░▒▓ UI LAYER GUARD — when panels are open, keep core world navigation alive ▓▒░
      // Enter is needed for window/image zoomon, PgUp/PgDown for slides, and
      // Delete/Backspace still routes through the typing guard below.
      const isAgentWindowCycleKey = input.inputState === 'agent-focus' && (e.key === 'n' || e.key === 'N')
      if (useInputManager.getState().hasActiveUILayer() && !isAgentWindowCycleKey && !['Escape', 'Delete', 'Backspace', 'Enter', 'PageDown', 'PageUp'].includes(e.key)) return

      // ░▒▓ ALL KEYS — check if typing in form element ▓▒░
      const NON_TEXT_INPUTS = new Set(['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'])
      const tag = (e.target as HTMLElement).tagName
      const isTyping = (
        (tag === 'INPUT' && !NON_TEXT_INPUTS.has((e.target as HTMLInputElement).type))
        || tag === 'TEXTAREA'
        || tag === 'SELECT'
        || (e.target as HTMLElement).isContentEditable
      )
      if (isTyping) return  // keys go to the form, not to us (including Ctrl+Z for native undo)

      // Block ALL edit shortcuts in read-only view mode
      const { isViewMode: vm, isViewModeEditable: vme } = useOasisStore.getState()
      if (vm && !vme) return

      const key = e.key.toLowerCase()

      // ░▒▓ Ctrl+Z / Ctrl+Shift+Z — Undo/Redo via EventBus ▓▒░
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        dispatch(e.shiftKey ? { type: 'REDO' } : { type: 'UNDO' })
        return
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault()
        dispatch({ type: 'REDO' })
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
        dispatch({ type: 'ENTER_PLACEMENT', payload: { pending: { ..._clipboard } } })
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

        // ░▒▓ Enter — focus agent window OR image via EventBus ▓▒░
        case 'enter': {
          if (!can.enterFocuses) break
          const id = useOasisStore.getState().selectedObjectId
          if (!id) break
          if (useOasisStore.getState().placedAgentWindows.some(w => w.id === id)) {
            dispatch({ type: 'FOCUS_AGENT_WINDOW', payload: { id } })
            e.preventDefault()
          } else if (useOasisStore.getState().placedCatalogAssets.some(a => a.id === id && (a.imageUrl || a.videoUrl))) {
            dispatch({ type: 'FOCUS_IMAGE', payload: { id } })
            e.preventDefault()
          }
          break
        }

        // ░▒▓ PgDown/PgUp — slide navigation (cycles images by X position) ▓▒░
        case 'pagedown': {
          dispatch({ type: 'NEXT_SLIDE' })
          e.preventDefault()
          break
        }
        case 'pageup': {
          dispatch({ type: 'PREV_SLIDE' })
          e.preventDefault()
          break
        }

        case 'n': {
          if (input.inputState !== 'agent-focus') break
          dispatch({ type: e.shiftKey ? 'PREV_AGENT_WINDOW' : 'NEXT_AGENT_WINDOW' })
          e.preventDefault()
          break
        }

        // ░▒▓ Delete/Backspace — remove selected object via EventBus ▓▒░
        case 'delete':
        case 'backspace': {
          if (!can.deleteShortcut) break
          // Guard: block delete when user is typing in an input/textarea/contentEditable
          if (isTyping) break
          const id = useOasisStore.getState().selectedObjectId
          if (!id) break
          dispatch({ type: 'DELETE_OBJECT', payload: { id } })
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setTransformMode])

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
                      dispatch({ type: 'SET_OBJECT_TRANSFORM', payload: { id: newWorldIds[i], transform: {
                        position: [child.position[0] + (i + 1) * 2, child.position[1], child.position[2]],
                      } } })
                    }
                  }
                  setTimeout(() => dispatch({ type: 'SAVE_WORLD' }), 200)
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
            dispatch({ type: 'UPDATE_CONJURED_ASSET', payload: { id: asset.id, updates: safeUpdates } })
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

  // Dispose cloned materials on unmount (NOT geometries — those are shared via useGLTF cache)
  useEffect(() => {
    return () => {
      ghostScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach(m => m?.dispose())
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
  const placeVideoAt = useOasisStore(s => s.placeVideoAt)
  const placeLibrarySceneAt = useOasisStore(s => s.placeLibrarySceneAt)
  const placeLightAt = useOasisStore(s => s.placeLightAt)
  const cancelPlacement = useOasisStore(s => s.cancelPlacement)
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null)

  const handleClick = useCallback((e: any) => {
    e.stopPropagation()
    if (!placementPending) return
    const point = e.point as THREE.Vector3
    const pos: [number, number, number] = [point.x, 0, point.z]

    if (placementPending.type === 'catalog' && placementPending.catalogId && placementPending.path) {
      const placedId = placeCatalogAssetAt(placementPending.catalogId, placementPending.name, placementPending.path, placementPending.defaultScale || 1, pos)
      if (placementPending.audioUrl && placedId) {
        useOasisStore.getState().setObjectBehavior(placedId, {
          audioUrl: placementPending.audioUrl,
          audioLoop: true,
          audioMuted: false,
          audioState: 'playing',
        })
      }
    } else if (placementPending.type === 'conjured' && placementPending.path) {
      // ░▒▓ Conjured multi-placement — uses catalog placement system with conjured GLB path ▓▒░
      const conjId = `conjured-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      placeCatalogAssetAt(conjId, placementPending.name, placementPending.path, placementPending.defaultScale || 1, pos)
    } else if (placementPending.type === 'image' && placementPending.imageUrl) {
      placeImageAt(placementPending.name, placementPending.imageUrl, pos, placementPending.imageFrameStyle)
    } else if (placementPending.type === 'video' && placementPending.videoUrl) {
      placeVideoAt(placementPending.name, placementPending.videoUrl, pos)
    } else if (placementPending.type === 'library' && placementPending.sceneId) {
      placeLibrarySceneAt(placementPending.sceneId, pos)
    } else if (placementPending.type === 'light' && placementPending.lightType) {
      // Raise y slightly off the ground so the light isn't flush with the plane
      placeLightAt(placementPending.lightType, [pos[0], 3, pos[2]])
    } else if (placementPending.type === 'agent' && placementPending.agentType) {
      // ░▒▓ Agent window placement — create 3D interactive panel ▓▒░
      const defaultWindowSize = placementPending.agentType === 'anorak-pro'
        ? { width: 960, height: 720 }
        : placementPending.agentType === 'browser'
          ? { width: 1280, height: 820 }
          : { width: 800, height: 600 }
      const defaultWindowWorldHeight = defaultWindowSize.height * (8 / 400)
      const browserDefaults = placementPending.agentType === 'browser'
        ? {
            surfaceUrl: '',
          }
        : {}
      const agentWindow = {
        id: `agent-${placementPending.agentType}-${Date.now()}`,
        agentType: placementPending.agentType as import('../../store/oasisStore').AgentWindowType,
        position: [pos[0], 1 + (defaultWindowWorldHeight * 0.2) / 2, pos[2]] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: 0.2,
        width: defaultWindowSize.width,
        height: defaultWindowSize.height,
        sessionId: placementPending.agentSessionId,
        label: placementPending.name,
        renderMode: placementPending.agentRenderMode,
        ...browserDefaults,
      }
      dispatch({
        type: 'ADD_AGENT_WINDOW',
        payload: {
          agentType: agentWindow.agentType,
          position: agentWindow.position,
          sessionId: agentWindow.sessionId,
          label: agentWindow.label,
          renderMode: agentWindow.renderMode,
          width: agentWindow.width,
          height: agentWindow.height,
          surfaceUrl: agentWindow.surfaceUrl,
        },
      })
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
        try {
          const inputManager = useInputManager.getState()
          if (inputManager.inputState === 'placement') inputManager.returnToPrevious()
        } catch {}
        dispatch({ type: 'SPAWN_VFX', payload: { position: pos } })
        setTimeout(() => dispatch({ type: 'SAVE_WORLD' }), 100)
      } else {
        cancelPlacement()
      }
    } else {
      cancelPlacement()
    }
  }, [placementPending, placeCatalogAssetAt, placeImageAt, placeLightAt, placeVideoAt, placeLibrarySceneAt, cancelPlacement])

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
      onPointerOver={(e) => {
        e.stopPropagation()
        if (useInputManager.getState().pointerLocked) return
        setHovered(true)
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        if (useInputManager.getState().pointerLocked) return
        setHovered(false)
      }}
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
  const spawnMarchOrderVfx = useOasisStore(s => s.spawnMarchOrderVfx)
  const hasAgentFocus = useOasisStore(s => !!s.focusedAgentWindowId)
  const placedAgentAvatars = useOasisStore(s => s.placedAgentAvatars)

  // ░▒▓ MINDCRAFT 3D — detect if active world is the Mindcraft mission map ▓▒░
  const isMindcraftWorld = useOasisStore(s => {
    const reg = s.worldRegistry.find(w => w.id === s.activeWorldId)
    return reg?.name?.toLowerCase() === 'mindcraft'
  })

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
  const camera = useThree(s => s.camera)
  const crosshairRaycasterRef = useRef(new THREE.Raycaster())
  const crosshairPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const crosshairPointRef = useRef(new THREE.Vector3())
  const walkableAvatarIds = useMemo(
    () => placedAgentAvatars
      .map(avatar => avatar.id)
      .filter(id => canReceiveMoveOrder(objectMeshStats[id])),
    [objectMeshStats, placedAgentAvatars],
  )
  const moveOrderObjectIds = useMemo(
    () => resolveMoveOrderObjectIds(selectedObjectId, walkableAvatarIds, objectMeshStats),
    [objectMeshStats, selectedObjectId, walkableAvatarIds],
  )

  const handleRTSRightClick = useCallback((e: any) => {
    if (paintMode || placementPending || moveOrderObjectIds.length === 0) return
    e.stopPropagation()
    e.nativeEvent?.preventDefault?.()
    let point = e.point as THREE.Vector3
    if (consumeRecentPointerLockRightClick()) {
      const raycaster = crosshairRaycasterRef.current
      const plane = crosshairPlaneRef.current
      const hit = crosshairPointRef.current
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      if (raycaster.ray.intersectPlane(plane, hit)) {
        point = hit
      }
    }
    const target: [number, number, number] = [point.x, 0, point.z]
    moveOrderObjectIds.forEach((id) => setMoveTarget(id, target))
    spawnMarchOrderVfx(target)
  }, [camera, moveOrderObjectIds, paintMode, placementPending, setMoveTarget, spawnMarchOrderVfx])

  return (
    <group>
      {/* W/E/R keyboard shortcuts for transform modes + ESC for placement cancel */}
      <TransformKeyHandler />
      {/* ░▒▓ "COPIED!" floating 3D toasts ▓▒░ */}
      <CopyToastRenderer />

      {/* ░▒▓ Click-to-place overlay — only active during placement mode ▓▒░ */}
      <PlacementOverlay />

      {/* ░▒▓ RTS move-to — right-click ground sends selected object walking ▓▒░ */}
      {!paintMode && !placementPending && moveOrderObjectIds.length > 0 && (
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
      <MarchOrderVFXRenderer />

      {/* ░▒▓ MINDCRAFT 3D — mission map overlay (renders alongside normal objects) ▓▒░ */}
      {isMindcraftWorld && <MindcraftWorld />}

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
              <SpatialAudioFromBehavior objectId={asset.id} />
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
                {ca.videoUrl
                  ? <VideoPlaneRenderer objectId={ca.id} videoUrl={ca.videoUrl} scale={ca.scale} frameStyle={ca.imageFrameStyle} frameThickness={ca.imageFrameThickness} />
                  : ca.imageUrl
                    ? <ImagePlaneRenderer imageUrl={ca.imageUrl} scale={ca.scale} frameStyle={ca.imageFrameStyle} frameThickness={ca.imageFrameThickness} />
                    : !ca.glbPath && ca.audioUrl
                      ? <AudioSourceRenderer scale={ca.scale} />
                      : ca.glbPath.endsWith('.vrm')
                        ? <VRMCatalogRenderer path={ca.glbPath} scale={ca.scale} objectId={ca.id} displayName={ca.name} />
                        : <CatalogModelRenderer path={ca.glbPath} scale={ca.scale} objectId={ca.id} displayName={ca.name} />
                }
                {/* ░▒▓ SPATIAL AUDIO — read from behaviors store ▓▒░ */}
                <SpatialAudioFromBehavior objectId={ca.id} />
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

      <AgentAvatarsSection
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

      {/* Transform mode HUD — hidden in agent-focus (zoomon shows its own UI) */}
      {selectedObjectId && !hasAgentFocus && (
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
  const placedAgentAvatars = useOasisStore(s => s.placedAgentAvatars)
  const transforms = useOasisStore(s => s.transforms)

  const avatarMap = useMemo(
    () => new Map(placedAgentAvatars.map(avatar => [avatar.id, avatar])),
    [placedAgentAvatars],
  )

  if (placedAgentWindows.length === 0) return null

  return (
    <>
      {placedAgentWindows.map(win => {
        const t = transforms[win.id]
        const linkedAvatar = win.linkedAvatarId
          ? avatarMap.get(win.linkedAvatarId)
          : placedAgentAvatars.find(entry => entry.linkedWindowId === win.id)
        const avatarTransform = linkedAvatar ? (getLiveObjectTransform(linkedAvatar.id) || transforms[linkedAvatar.id]) : undefined
        const derivedPlacement = linkedAvatar && win.anchorMode && win.anchorMode !== 'detached'
          ? deriveAvatarAnchoredWindowPlacement(win, linkedAvatar, avatarTransform, win.anchorMode, t)
          : null
        return (
          <SelectableWrapper
            key={win.id}
            id={win.id}
            selected={selectedObjectId === win.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={onTransformChange}
            initialPosition={derivedPlacement?.position || t?.position || win.position}
            initialRotation={derivedPlacement?.rotation || t?.rotation || win.rotation}
            initialScale={t?.scale ?? 1}
            inspectOn="double-click"
            allowTransform={win.anchorMode === 'detached' || !linkedAvatar}
            liveTransformResolver={linkedAvatar && win.anchorMode && win.anchorMode !== 'detached'
              ? () => {
                  const currentAvatarTransform = getLiveObjectTransform(linkedAvatar.id) || transforms[linkedAvatar.id]
                  return deriveAvatarAnchoredWindowPlacement(win, linkedAvatar, currentAvatarTransform, win.anchorMode, transforms[win.id])
                }
              : undefined}
          >
            <AgentWindow3D window={win} />
          </SelectableWrapper>
        )
      })}
    </>
  )
}

function AgentAvatarsSection({ selectedObjectId, selectObject, transformMode, onTransformChange }: {
  selectedObjectId: string | null
  selectObject: (id: string | null) => void
  transformMode: 'translate' | 'rotate' | 'scale'
  onTransformChange: (id: string, position: [number, number, number], rotation: [number, number, number], scale: [number, number, number]) => void
}) {
  const placedAgentAvatars = useOasisStore(s => s.placedAgentAvatars)
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const transforms = useOasisStore(s => s.transforms)
  const liveAgentAvatarAudio = useOasisStore(s => s.liveAgentAvatarAudio)
  const agentActivity = useOasisStore(s => s.agentActivity)

  useEffect(() => {
    void loadAnimationClip('ual-walk')
    void loadAnimationClip('walk')
    void loadAnimationClip('idle')
    void loadAnimationClip('idle-fight')
    void loadAnimationClip(AGENT_WORK_ANIMATION_ID)
  }, [])

  const windowMap = useMemo(
    () => new Map(placedAgentWindows.map(window => [window.id, window])),
    [placedAgentWindows],
  )
  const sharedAvatarWinnerByType = useMemo(() => {
    const winners = new Map<string, string>()
    const scores = new Map<string, number>()
    for (const avatar of placedAgentAvatars) {
      const isSharedAvatarType = avatar.agentType === 'anorak-pro' || avatar.agentType === 'merlin' || avatar.agentType === 'realtime' || avatar.agentType === 'hermes' || avatar.agentType === 'openclaw'
      if (!isSharedAvatarType) continue
      const score = (avatar.linkedWindowId ? 0 : 100) + (transforms[avatar.id] ? 20 : 0)
      const currentScore = scores.get(avatar.agentType) ?? Number.NEGATIVE_INFINITY
      if (score > currentScore) {
        scores.set(avatar.agentType, score)
        winners.set(avatar.agentType, avatar.id)
      }
    }
    return winners
  }, [placedAgentAvatars, transforms])

  if (placedAgentAvatars.length === 0) return null

  return (
    <>
      {placedAgentAvatars.map(avatar => {
        const isSharedAvatarType = avatar.agentType === 'anorak-pro' || avatar.agentType === 'merlin' || avatar.agentType === 'realtime' || avatar.agentType === 'hermes' || avatar.agentType === 'openclaw'
        if (isSharedAvatarType && sharedAvatarWinnerByType.get(avatar.agentType) !== avatar.id) return null
        if (!avatar.avatar3dUrl) return null
        const renderAvatarUrl = resolveAgentAvatarUrl(avatar.avatar3dUrl).url

        const avatarTransform = transforms[avatar.id]
        const linkedWindow = avatar.linkedWindowId ? windowMap.get(avatar.linkedWindowId) : undefined
        const linkedWindowTransform = linkedWindow ? transforms[linkedWindow.id] : undefined
        const usesSharedAvatarPose = isSharedAvatarType
        const windowDrivesAvatar = linkedWindow && !usesSharedAvatarPose && (linkedWindow.anchorMode === 'detached' || !linkedWindow.anchorMode)
        const derivedAnchor = linkedWindow && windowDrivesAvatar && !avatarTransform
          ? deriveWindowAvatarAnchor(linkedWindow, linkedWindowTransform)
          : null
        const derivedScale = linkedWindow && windowDrivesAvatar && !avatarTransform
          ? deriveWindowAvatarScale(linkedWindow, linkedWindowTransform)
          : avatar.scale
        const renderScale = scalarFromTransformScale(avatarTransform?.scale, derivedScale)
        const audio = liveAgentAvatarAudio[avatar.id]
        const activity = agentActivity[avatar.agentType]
        const showWorkAnimation = activity?.confidence === 'explicit'
          && (activity.state === 'working' || activity.state === 'tooling')

        return (
          <SelectableWrapper
            key={`${avatar.id}:${renderAvatarUrl}`}
            id={avatar.id}
            selected={selectedObjectId === avatar.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={onTransformChange}
            initialPosition={avatarTransform?.position || derivedAnchor?.position || avatar.position}
            initialRotation={avatarTransform?.rotation || derivedAnchor?.rotation || avatar.rotation}
            initialScale={avatarTransform?.scale}
          >
            <Suspense fallback={<PlaceholderBox />}>
              <VRMCatalogRenderer
                path={renderAvatarUrl}
                scale={renderScale}
                objectId={avatar.id}
                displayName={avatar.label || 'Agent Avatar'}
                activityAnimationId={showWorkAnimation ? AGENT_WORK_ANIMATION_ID : null}
              />
              {audio?.url && (
                <SpatialAudioAttachment
                  key={`${avatar.id}-${audio.playbackId || audio.url}`}
                  objectId={avatar.id}
                  audioUrl={audio.url}
                  volume={audio.volume}
                  maxDistance={audio.maxDistance}
                  muted={audio.muted}
                  audioState={audio.state}
                  loop={audio.loop ?? false}
                />
              )}
            </Suspense>
          </SelectableWrapper>
        )
      })}
    </>
  )
}

// ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【O̸B̸J̸E̸C̸T̸S̸】▓▓▓▓ॐ▓▓▓▓【S̸H̸A̸R̸E̸D̸】▓▓▓▓

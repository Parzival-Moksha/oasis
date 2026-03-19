// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MODEL PREVIEW — Shared 3D model viewer + asset inspector
// ─══ॐ══─{ See first, then touch — the eye before the hand }─══ॐ══─
//
// Auto-frames any GLB, orbit controls, animation playback, mesh stats, "Place in World" CTA.
// Separate R3F Canvas context — safe to render in portals outside the main scene.
//
// Stats extracted from the loaded scene graph:
//   triangles, vertices, meshes, materials, bones, bounding box, animation clips
// File size fetched via HEAD request (Content-Length).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import type { AssetDefinition } from '../scene-lib/types'
import type { ModelStats, CraftedScene, CraftedPrimitive } from '../../lib/conjure/types'
import { CraftedPrimitiveMesh } from './CraftedSceneRenderer'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// Re-export ModelStats for backward compat — the type now lives in lib/conjure/types.ts
export type { ModelStats } from '../../lib/conjure/types'

// ░▒▓ Module-level backdrop state — shared across both preview panels ▓▒░
// Survives panel switches (catalog ↔ crafted) within the same session.
// Blob URLs are per-session and lightweight — no localStorage bloat.
// Default: oasislogo.jpg — branded panorama backdrop instead of flat gray.
const DEFAULT_BACKDROP = '/oasislogo.jpg'
let _sharedBackdropUrl: string | null = DEFAULT_BACKDROP
const _backdropListeners = new Set<(url: string | null) => void>()
function setSharedBackdrop(url: string | null) {
  // Revoke old blob URL to prevent memory leak
  if (_sharedBackdropUrl && _sharedBackdropUrl.startsWith('blob:')) {
    URL.revokeObjectURL(_sharedBackdropUrl)
  }
  _sharedBackdropUrl = url
  _backdropListeners.forEach(fn => fn(url))
}
/** Hook to subscribe to shared backdrop state */
function useSharedBackdrop(): [string | null, (url: string | null) => void] {
  const [url, setUrl] = useState(_sharedBackdropUrl)
  useEffect(() => {
    _backdropListeners.add(setUrl)
    return () => { _backdropListeners.delete(setUrl) }
  }, [])
  return [url, setSharedBackdrop]
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY ICONS — visual identity per asset family
// ═══════════════════════════════════════════════════════════════════════════════

export const CATEGORY_ICON: Record<string, string> = {
  platforms: '\u{1F3D7}',
  enemies:  '\u{1F916}',
  pickups:  '\u{1F48E}',
  character:'\u{1F9D1}',
  guns:     '\u{1F52B}',
  props:    '\u{1F4E6}',
  nature:   '\u{1F332}',
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESH STATS EXTRACTION — traverse a Three.js scene graph and count everything
// ░▒▓ Shared utility — called by CatalogModelRenderer, ConjuredObject, and preview ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

/** Traverse a Three.js object graph and extract mesh stats */
export function extractModelStats(root: THREE.Object3D, animations: THREE.AnimationClip[]): ModelStats {
  let triangles = 0
  let vertices = 0
  let meshCount = 0
  let boneCount = 0
  const materials = new Set<string>()

  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      boneCount++
    }
    if ((child as THREE.Mesh).isMesh) {
      meshCount++
      const mesh = child as THREE.Mesh
      const geo = mesh.geometry

      // Triangle count: indexed → index.count / 3, non-indexed → position.count / 3
      if (geo.index) {
        triangles += geo.index.count / 3
      } else if (geo.attributes.position) {
        triangles += geo.attributes.position.count / 3
      }

      if (geo.attributes.position) {
        vertices += geo.attributes.position.count
      }

      // Unique materials by uuid
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (m) materials.add(m.uuid)
      }
    }
  })

  // Bounding box
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())

  // Animation clips
  const clips = animations.map(c => ({ name: c.name, duration: c.duration }))

  return {
    triangles: Math.round(triangles),
    vertices,
    meshCount,
    materialCount: materials.size,
    boneCount,
    dimensions: {
      w: parseFloat(size.x.toFixed(2)),
      h: parseFloat(size.y.toFixed(2)),
      d: parseFloat(size.z.toFixed(2)),
    },
    clips,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ STUDIO BACKDROP — Neutral gray OR custom photo panorama █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════
// Default: neutral gray gradient (Blender/Substance style — true material colors).
// Custom: any photo → mirrored equirectangular panorama.
//
// HOW THE PHOTO-TO-PANORAMA WORKS (poor man's HDRI):
// ┌─────────────────────────────────────────────────────────────────────┐
// │  Pro approach: 360° camera / chrome sphere / Blockade Labs AI       │
// │  Our approach: mirror the photo horizontally + fade poles to gray   │
// │                                                                     │
// │  Canvas layout (2:1 aspect = equirectangular standard):             │
// │  ┌──────────┬──────────┐                                            │
// │  │  PHOTO   │  MIRROR  │  ← seamless at the 180° seam              │
// │  │  (orig)  │  (flip)  │                                            │
// │  └──────────┴──────────┘                                            │
// │  Top 15% faded to gray  ← prevents ugly pole pinch                  │
// │  Bottom 15% faded to gray                                           │
// └─────────────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════════

function createStudioGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, '#5a5f6b')
  gradient.addColorStop(0.5, '#3d4048')
  gradient.addColorStop(1, '#24262b')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 2, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  return texture
}

function StudioBackdrop({ imageUrl }: { imageUrl?: string | null }) {
  const { scene } = useThree()

  useEffect(() => {
    if (!imageUrl) {
      // ░▒▓ Default: neutral studio gray gradient ▓▒░
      const texture = createStudioGradientTexture()
      scene.background = texture
      return () => { scene.background = null; texture.dispose() }
    }

    // ░▒▓ Custom photo → mirrored equirectangular panorama ▓▒░
    let disposed = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (disposed) return
      const w = img.width
      const h = img.height
      // Equirectangular = 2:1 aspect ratio
      const canvas = document.createElement('canvas')
      canvas.width = w * 2
      canvas.height = h
      const ctx = canvas.getContext('2d')!

      // Left half: original image
      ctx.drawImage(img, 0, 0, w, h)
      // Right half: horizontally mirrored (seamless 360° wrap)
      ctx.save()
      ctx.translate(w * 2, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, w, h)
      ctx.restore()

      // Fade poles to neutral gray — prevents ugly pinch artifacts
      const poleTop = ctx.createLinearGradient(0, 0, 0, h * 0.15)
      poleTop.addColorStop(0, 'rgba(58, 62, 70, 0.85)')
      poleTop.addColorStop(1, 'rgba(58, 62, 70, 0)')
      ctx.fillStyle = poleTop
      ctx.fillRect(0, 0, canvas.width, h * 0.15)

      const poleBottom = ctx.createLinearGradient(0, h * 0.85, 0, h)
      poleBottom.addColorStop(0, 'rgba(36, 38, 43, 0)')
      poleBottom.addColorStop(1, 'rgba(36, 38, 43, 0.85)')
      ctx.fillStyle = poleBottom
      ctx.fillRect(0, h * 0.85, canvas.width, h * 0.15)

      const texture = new THREE.CanvasTexture(canvas)
      texture.mapping = THREE.EquirectangularReflectionMapping
      scene.background = texture
    }
    img.onerror = () => {
      // Fallback to studio gradient if image fails to load
      if (disposed) return
      const texture = createStudioGradientTexture()
      scene.background = texture
    }
    img.src = imageUrl

    return () => { disposed = true; scene.background = null }
  }, [scene, imageUrl])

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ AUTO-FRAMED MODEL — The lens through which we see before we touch █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

/** Animation state passed from R3F world to HTML controls */
export interface AnimationInfo {
  names: string[]
  play: (clipName: string) => void
  stop: (clipName: string) => void
  stopAll: () => void
  setSpeed: (speed: number) => void
  getIsPlaying: (clipName: string) => boolean
}

interface AutoFramedModelProps {
  path: string
  onAnimationsDetected?: (info: AnimationInfo) => void
  onStatsReady?: (stats: ModelStats) => void
  onReady?: () => void
}

export function AutoFramedModel({ path, onAnimationsDetected, onStatsReady, onReady }: AutoFramedModelProps) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const gltf = useGLTF(path)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map())

  // ░▒▓ Ref-stable callbacks — prevents camera-framing effect from re-firing
  // when parent re-renders with new inline arrow functions ▓▒░
  const onReadyRef = useRef(onReady)
  const onStatsReadyRef = useRef(onStatsReady)
  onReadyRef.current = onReady
  onStatsReadyRef.current = onStatsReady

  // SkeletonUtils.clone — proper bone/skinned mesh cloning (scene.clone breaks animations)
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(gltf.scene) as THREE.Group
    // Enable vertex colors for Kenney-style models (no textures, color in geometry)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
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
  }, [gltf.scene])

  // Manual mixer — drei's useAnimations captures stale closures, this doesn't
  useEffect(() => {
    if (!groupRef.current) return
    const mixer = new THREE.AnimationMixer(groupRef.current)
    mixerRef.current = mixer
    const actionMap = new Map<string, THREE.AnimationAction>()
    const clipNames: string[] = []
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip)
      actionMap.set(clip.name, action)
      clipNames.push(clip.name)
    }
    actionsRef.current = actionMap

    if (onAnimationsDetected && clipNames.length > 0) {
      onAnimationsDetected({
        names: clipNames,
        play: (name: string) => {
          const a = actionsRef.current.get(name)
          if (a) { a.reset().fadeIn(0.2).play() }
        },
        stop: (name: string) => {
          const a = actionsRef.current.get(name)
          if (a) { a.fadeOut(0.2); setTimeout(() => a.stop(), 200) }
        },
        stopAll: () => {
          actionsRef.current.forEach(a => { a.fadeOut(0.2); setTimeout(() => a.stop(), 200) })
        },
        setSpeed: (speed: number) => { mixer.timeScale = speed },
        getIsPlaying: (name: string) => actionsRef.current.get(name)?.isRunning() ?? false,
      })
    }

    return () => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()) }
  }, [clonedScene, gltf.animations, onAnimationsDetected])

  // Tick the mixer every frame
  useFrame((_, delta) => {
    mixerRef.current?.update(Math.min(delta, 0.05))
  })

  // Auto-frame camera + extract stats from loaded scene
  // ░▒▓ Uses ref-stable callbacks — NO deps on onReady/onStatsReady ▓▒░
  // Without this, every parent re-render creates new inline arrows,
  // re-fires this effect, and snaps the camera back to initial position
  // (the "converges back" bug that killed manual orbit + auto-rotate)
  useEffect(() => {
    if (!groupRef.current) return
    const box = new THREE.Box3().setFromObject(groupRef.current)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    groupRef.current.position.sub(center)
    const maxDim = Math.max(size.x, size.y, size.z)
    camera.position.set(0, size.y * 0.5, maxDim * 1.8)
    camera.lookAt(0, size.y * 0.3, 0)
    camera.updateProjectionMatrix()

    // ░▒▓ Extract mesh stats while we have the scene graph hot ▓▒░
    if (onStatsReadyRef.current) {
      const stats = extractModelStats(groupRef.current, gltf.animations)
      onStatsReadyRef.current(stats)
    }

    onReadyRef.current?.()
  }, [clonedScene, camera, gltf.animations])

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREVIEW LOADING SPINNER
// ═══════════════════════════════════════════════════════════════════════════════

export function PreviewLoadingSpinner({ color = '#38BDF8' }: { color?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
      <div
        className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: `${color}66`, borderTopColor: 'transparent' }}
      />
      <span className="text-[10px] text-gray-500 font-mono mt-2">loading model...</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION CONTROLS — HTML panel for clip playback + speed
// ═══════════════════════════════════════════════════════════════════════════════

export function AnimationControlsPanel({ animInfo, accentColor = '#38BDF8' }: { animInfo: AnimationInfo; accentColor?: string }) {
  const [activeClip, setActiveClip] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1.0)

  const handleClipClick = useCallback((clipName: string) => {
    if (activeClip === clipName) {
      animInfo.stop(clipName)
      setActiveClip(null)
    } else {
      if (activeClip) animInfo.stop(activeClip)
      animInfo.play(clipName)
      setActiveClip(clipName)
    }
  }, [activeClip, animInfo])

  const handleSpeedChange = useCallback((newSpeed: number) => {
    setSpeed(newSpeed)
    animInfo.setSpeed(newSpeed)
  }, [animInfo])

  return (
    <div className="px-2 py-1.5 border-t border-white/5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
      <div className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mb-1">
        Animations ({animInfo.names.length})
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {animInfo.names.map(name => {
          const isActive = activeClip === name
          return (
            <button
              key={name}
              onClick={() => handleClipClick(name)}
              className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-all duration-200 ${
                isActive
                  ? 'border'
                  : 'text-gray-500 border border-gray-700/30 hover:text-gray-300 hover:border-gray-600/50'
              }`}
              style={isActive ? { background: `${accentColor}25`, color: accentColor, borderColor: `${accentColor}50` } : undefined}
            >
              {isActive ? '\u{25A0}' : '\u{25B6}'} {name.length > 16 ? name.slice(0, 16) + '...' : name}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-gray-600 font-mono shrink-0">SPD</span>
        <input
          type="range"
          min="0.25"
          max="2.0"
          step="0.25"
          value={speed}
          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          className="flex-1 h-1 cursor-pointer"
          style={{ accentColor }}
        />
        <span className="text-[9px] text-gray-400 font-mono w-8 text-right">{speed.toFixed(2)}x</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS DISPLAY — The X-ray vision into polygon anatomy
// ═══════════════════════════════════════════════════════════════════════════════

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

function StatsPanel({ stats, fileSize, accentColor = '#38BDF8' }: { stats: ModelStats; fileSize: number | null; accentColor?: string }) {
  const statRows: { label: string; value: string; icon: string }[] = [
    { label: 'Triangles', value: formatNumber(stats.triangles), icon: '\u25B3' },
    { label: 'Vertices', value: formatNumber(stats.vertices), icon: '\u25CF' },
    { label: 'Meshes', value: stats.meshCount.toString(), icon: '\u25A6' },
    { label: 'Materials', value: stats.materialCount.toString(), icon: '\u{1F3A8}' },
  ]

  if (stats.boneCount > 0) {
    statRows.push({ label: 'Bones', value: stats.boneCount.toString(), icon: '\u{1F9B4}' })
  }

  statRows.push({
    label: 'Size',
    value: `${stats.dimensions.w} \u00D7 ${stats.dimensions.h} \u00D7 ${stats.dimensions.d}`,
    icon: '\u{1F4D0}',
  })

  if (fileSize !== null) {
    statRows.push({ label: 'File', value: formatBytes(fileSize), icon: '\u{1F4BE}' })
  }

  return (
    <div className="px-2 py-1.5 border-t border-white/5" style={{ background: 'rgba(20, 20, 20, 0.5)' }}>
      <div className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mb-1">
        Mesh Stats
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {statRows.map(row => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-[9px] text-gray-500 font-mono">{row.icon} {row.label}</span>
            <span className="text-[9px] font-mono font-medium" style={{ color: accentColor }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* Animation clip durations */}
      {stats.clips.length > 0 && (
        <div className="mt-1 pt-1 border-t border-white/5">
          <div className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mb-0.5">
            Clips ({stats.clips.length})
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {stats.clips.map(clip => (
              <div key={clip.name} className="flex items-center justify-between">
                <span className="text-[9px] text-gray-500 font-mono truncate mr-1">{clip.name.length > 14 ? clip.name.slice(0, 14) + '..' : clip.name}</span>
                <span className="text-[9px] font-mono shrink-0" style={{ color: accentColor }}>{clip.duration.toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ MODEL PREVIEW PANEL — The 3D window into form ░▒▓█
// ═══════════════════════════════════════════════════════════════════════════════

export interface ModelPreviewPanelProps {
  asset: AssetDefinition
  onBack: () => void
  onPlace: (asset: AssetDefinition) => void
  accentColor?: string
  canvasHeight?: number
}

export function ModelPreviewPanel({ asset, onBack, onPlace, accentColor = '#38BDF8', canvasHeight = 280 }: ModelPreviewPanelProps) {
  const [animInfo, setAnimInfo] = useState<AnimationInfo | null>(null)
  const [modelStats, setModelStats] = useState<ModelStats | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [backdropImage, setBackdropImage] = useSharedBackdrop()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const icon = CATEGORY_ICON[asset.category] || '\u{1F4E6}'

  const handleCanvasError = useCallback(() => { setLoadError(true) }, [])

  // Reset state when asset changes
  useEffect(() => {
    setModelStats(null)
    setFileSize(null)
    setAnimInfo(null)
    setModelReady(false)
    setLoadError(false)
    setAutoRotate(true)  // fresh model = fresh spin
  }, [asset.path])

  // ░▒▓ Fetch file size via HEAD request — cheap, no body downloaded ▓▒░
  // ░▒▓ OASIS_BASE prefix so HEAD hits correct basePath in production ▓▒░
  useEffect(() => {
    fetch(`${OASIS_BASE}${asset.path}`, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('content-length')
        if (cl) setFileSize(parseInt(cl, 10))
      })
      .catch(() => { /* non-fatal — file size just won't show */ })
  }, [asset.path])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ░▒▓ Nav bar — back + name + category ▓▒░ */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/5 flex-shrink-0"
        style={{ background: 'rgba(20, 20, 20, 0.4)' }}
      >
        <button
          onClick={onBack}
          className="text-gray-300 hover:text-white transition-all duration-150 hover:scale-110 shrink-0"
          style={{
            fontSize: '22px',
            lineHeight: 1,
            padding: '4px 8px',
            borderRadius: '6px',
            background: `${accentColor}15`,
            border: `1px solid ${accentColor}30`,
          }}
          title="Back to catalog"
        >
          &#8592;
        </button>
        <span className="text-[11px] text-gray-200 font-mono truncate flex-1">{asset.name}</span>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{ color: accentColor, background: `${accentColor}12`, border: `1px solid ${accentColor}30` }}
        >
          {icon} {asset.category}
        </span>
      </div>

      {/* ░▒▓█ THE VIEWPORT — square aspect ratio ░▒▓█ */}
      <div className="relative flex-shrink-0 w-full" style={{ aspectRatio: '1 / 1', maxHeight: canvasHeight || 400 }}>
        {loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl text-red-500/40 mb-2">{'\u{26A0}'}</span>
            <span className="text-[10px] text-gray-500 font-mono">Failed to load model</span>
            <span className="text-[9px] text-gray-700 font-mono mt-1">{asset.path}</span>
          </div>
        ) : (
          <>
            {!modelReady && <PreviewLoadingSpinner color={accentColor} />}
            <Canvas
              style={{ width: '100%', height: '100%', borderRadius: 0 }}
              camera={{ fov: 45, near: 0.01, far: 1000 }}
              onError={handleCanvasError}
            >
              <StudioBackdrop imageUrl={backdropImage} />
              <ambientLight intensity={0.7} />
              <directionalLight position={[3, 5, 2]} intensity={1.0} />
              <directionalLight position={[-3, 2, -1]} intensity={0.3} color="#b4c6e0" />
              <Environment preset="city" />
              <ContactShadows position={[0, -0.01, 0]} opacity={0.35} scale={10} blur={2.5} far={4} />
              <OrbitControls enablePan={false} autoRotate={autoRotate} autoRotateSpeed={1.5} minDistance={0.1} maxDistance={100} />
              <Suspense fallback={null}>
                <AutoFramedModel
                  path={asset.path}
                  onAnimationsDetected={setAnimInfo}
                  onStatsReady={setModelStats}
                  onReady={() => setModelReady(true)}
                />
              </Suspense>
            </Canvas>
            {/* ░▒▓ Viewport controls — bottom-right corner ▓▒░ */}
            <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1">
              {/* Custom backdrop picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setBackdropImage(URL.createObjectURL(file))
                  e.target.value = '' // reset so same file can be re-selected
                }}
              />
              {/* Reset to default backdrop */}
              {backdropImage && backdropImage !== DEFAULT_BACKDROP && (
                <button
                  onClick={() => setBackdropImage(DEFAULT_BACKDROP)}
                  className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:scale-110"
                  style={{
                    background: `${accentColor}30`,
                    border: `1px solid ${accentColor}60`,
                    color: accentColor,
                    fontSize: '12px',
                  }}
                  title="Reset to default backdrop"
                >
                  {'\u2716'}
                </button>
              )}
              {/* Upload custom backdrop */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:scale-110"
                style={{
                  background: 'rgba(40,40,40,0.8)',
                  border: '1px solid rgba(80,80,80,0.5)',
                  color: '#666',
                  fontSize: '12px',
                }}
                title="Upload custom backdrop image"
              >
                {'\u{1F5BC}'}
              </button>
              {/* Auto-rotate toggle */}
              <button
                onClick={() => setAutoRotate(prev => !prev)}
                className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:scale-110"
                style={{
                  background: autoRotate ? `${accentColor}30` : 'rgba(40,40,40,0.8)',
                  border: `1px solid ${autoRotate ? `${accentColor}60` : 'rgba(80,80,80,0.5)'}`,
                  color: autoRotate ? accentColor : '#666',
                  fontSize: '14px',
                }}
                title={autoRotate ? 'Auto-rotate ON (click to pause)' : 'Auto-rotate OFF (click to spin)'}
              >
                {autoRotate ? '\u21BB' : '\u23F8'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ░▒▓ MESH STATS — the polygon anatomy ▓▒░ */}
      {modelStats && (
        <StatsPanel stats={modelStats} fileSize={fileSize} accentColor={accentColor} />
      )}

      {/* Animation controls if the model has clips */}
      {animInfo && animInfo.names.length > 0 && (
        <AnimationControlsPanel animInfo={animInfo} accentColor={accentColor} />
      )}

      {/* ░▒▓█ PLACE IN WORLD ░▒▓█ */}
      <div className="px-2 py-2 flex-shrink-0 mt-auto">
        <button
          onClick={() => onPlace(asset)}
          className="w-full py-2 rounded-lg font-mono text-[11px] font-bold tracking-wide transition-all duration-300 hover:scale-[1.01]"
          style={{
            background: `linear-gradient(135deg, ${accentColor}22, ${accentColor}11)`,
            border: `1px solid ${accentColor}44`,
            color: accentColor,
            boxShadow: `0 0 20px ${accentColor}11`,
          }}
        >
          &#9654; Place in World
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ CRAFTED SCENE PREVIEW — Same 3D inspection for procedural primitives █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════
// Crafted scenes are LLM-generated JSON → Three.js primitives.
// They deserve the same studio treatment as GLB models: proper lighting,
// neutral backdrop, auto-framing, and full mesh stats extraction.
// ═══════════════════════════════════════════════════════════════════════════════

/** Inner R3F component: renders primitives, auto-frames camera, extracts stats */
function AutoFramedCraftedScene({ scene, onStatsReady, onReady }: {
  scene: CraftedScene
  onStatsReady?: (stats: ModelStats) => void
  onReady?: () => void
}) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const onReadyRef = useRef(onReady)
  const onStatsReadyRef = useRef(onStatsReady)
  onReadyRef.current = onReady
  onStatsReadyRef.current = onStatsReady

  // ░▒▓ Auto-frame + stats extraction — same pattern as AutoFramedModel ▓▒░
  useEffect(() => {
    if (!groupRef.current) return
    // Need a frame for geometries to exist in the scene graph
    const raf = requestAnimationFrame(() => {
      if (!groupRef.current) return
      const box = new THREE.Box3().setFromObject(groupRef.current)
      if (box.isEmpty()) {
        onReadyRef.current?.()
        return
      }
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      groupRef.current.position.sub(center)
      const maxDim = Math.max(size.x, size.y, size.z)
      camera.position.set(0, size.y * 0.5, maxDim * 1.8)
      camera.lookAt(0, size.y * 0.3, 0)
      camera.updateProjectionMatrix()

      if (onStatsReadyRef.current) {
        onStatsReadyRef.current(extractModelStats(groupRef.current, []))
      }
      onReadyRef.current?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [scene.id, camera])

  return (
    <group ref={groupRef}>
      {scene.objects.map((primitive: CraftedPrimitive, i: number) => (
        <CraftedPrimitiveMesh key={`preview-${scene.id}-${i}`} primitive={primitive} />
      ))}
    </group>
  )
}

export interface CraftedPreviewPanelProps {
  scene: CraftedScene
  onBack: () => void
  onPlace?: (scene: CraftedScene) => void
  accentColor?: string
  canvasHeight?: number
}

export function CraftedPreviewPanel({ scene, onBack, onPlace, accentColor = '#3B82F6', canvasHeight = 280 }: CraftedPreviewPanelProps) {
  const [modelStats, setModelStats] = useState<ModelStats | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [backdropImage, setBackdropImage] = useSharedBackdrop()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset on scene change
  useEffect(() => {
    setModelStats(null)
    setModelReady(false)
    setAutoRotate(true)
  }, [scene.id])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ░▒▓ Nav bar — back + name + crafted badge ▓▒░ */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/5 flex-shrink-0"
        style={{ background: 'rgba(20, 20, 20, 0.4)' }}
      >
        <button
          onClick={onBack}
          className="text-gray-300 hover:text-white transition-all duration-150 hover:scale-110 shrink-0"
          style={{
            fontSize: '22px',
            lineHeight: 1,
            padding: '4px 8px',
            borderRadius: '6px',
            background: `${accentColor}15`,
            border: `1px solid ${accentColor}30`,
          }}
          title="Back"
        >
          &#8592;
        </button>
        <span className="text-[11px] text-gray-200 font-mono truncate flex-1">{scene.name}</span>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{ color: accentColor, background: `${accentColor}12`, border: `1px solid ${accentColor}30` }}
        >
          &#9881; crafted ({scene.objects.length})
        </span>
      </div>

      {/* ░▒▓█ THE VIEWPORT ░▒▓█ */}
      <div className="relative flex-shrink-0 w-full" style={{ aspectRatio: '1 / 1', maxHeight: canvasHeight || 400 }}>
        {!modelReady && <PreviewLoadingSpinner color={accentColor} />}
        <Canvas
          style={{ width: '100%', height: '100%', borderRadius: 0 }}
          camera={{ fov: 45, near: 0.01, far: 1000 }}
        >
          <StudioBackdrop imageUrl={backdropImage} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 2]} intensity={1.0} />
          <directionalLight position={[-3, 2, -1]} intensity={0.3} color="#b4c6e0" />
          <Environment preset="city" />
          <ContactShadows position={[0, -0.01, 0]} opacity={0.35} scale={10} blur={2.5} far={4} />
          <OrbitControls enablePan={false} autoRotate={autoRotate} autoRotateSpeed={1.5} minDistance={0.1} maxDistance={100} />
          <AutoFramedCraftedScene
            scene={scene}
            onStatsReady={setModelStats}
            onReady={() => setModelReady(true)}
          />
        </Canvas>
        {/* ░▒▓ Viewport controls ▓▒░ */}
        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setBackdropImage(URL.createObjectURL(file))
              e.target.value = ''
            }}
          />
          {backdropImage && backdropImage !== DEFAULT_BACKDROP && (
            <button
              onClick={() => setBackdropImage(DEFAULT_BACKDROP)}
              className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:scale-110"
              style={{
                background: `${accentColor}30`,
                border: `1px solid ${accentColor}60`,
                color: accentColor,
                fontSize: '12px',
              }}
              title="Reset to default backdrop"
            >
              {'\u2716'}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:scale-110"
            style={{
              background: 'rgba(40,40,40,0.8)',
              border: '1px solid rgba(80,80,80,0.5)',
              color: '#666',
              fontSize: '12px',
            }}
            title="Upload custom backdrop image"
          >
            {'\u{1F5BC}'}
          </button>
          <button
            onClick={() => setAutoRotate(prev => !prev)}
            className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 hover:scale-110"
            style={{
              background: autoRotate ? `${accentColor}30` : 'rgba(40,40,40,0.8)',
              border: `1px solid ${autoRotate ? `${accentColor}60` : 'rgba(80,80,80,0.5)'}`,
              color: autoRotate ? accentColor : '#666',
              fontSize: '14px',
            }}
            title={autoRotate ? 'Auto-rotate ON' : 'Auto-rotate OFF'}
          >
            {autoRotate ? '\u21BB' : '\u23F8'}
          </button>
        </div>
      </div>

      {/* ░▒▓ MESH STATS ▓▒░ */}
      {modelStats && (
        <StatsPanel stats={modelStats} fileSize={null} accentColor={accentColor} />
      )}

      {/* ░▒▓ Prompt that birthed this scene ▓▒░ */}
      {scene.prompt && (
        <div className="px-2 py-1.5 border-t border-white/5" style={{ background: 'rgba(20, 20, 20, 0.4)' }}>
          <div className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mb-0.5">Prompt</div>
          <div className="text-[10px] text-gray-400 font-mono leading-relaxed">
            {/* Strip iterative context prefix from legacy crafted scenes */}
            {scene.prompt.includes('User wants: ') ? scene.prompt.split('User wants: ').pop() : scene.prompt}
          </div>
        </div>
      )}

      {/* ░▒▓█ PLACE IN WORLD — drops a copy of this crafted scene ░▒▓█ */}
      {onPlace && (
        <div className="px-2 py-2 flex-shrink-0 mt-auto">
          <button
            onClick={() => onPlace(scene)}
            className="w-full py-2 rounded-lg font-mono text-[11px] font-bold tracking-wide transition-all duration-300 hover:scale-[1.01]"
            style={{
              background: `linear-gradient(135deg, ${accentColor}22, ${accentColor}11)`,
              border: `1px solid ${accentColor}44`,
              color: accentColor,
              boxShadow: `0 0 20px ${accentColor}11`,
            }}
          >
            &#9654; Place in World
          </button>
        </div>
      )}
    </div>
  )
}

// ▓▓▓▓【M̸O̸D̸E̸L̸】▓▓▓▓ॐ▓▓▓▓【P̸R̸E̸V̸I̸E̸W̸】▓▓▓▓

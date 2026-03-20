'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CONJURED OBJECT — A 3D manifestation from text
// Loads GLB, handles spawn animation, click-to-select
//
// PERF NOTE (Feb 2026 Silicon Mother):
//   scene.clone() is memoized — never clone in JSX render path.
//   Raycasting disabled on actual geometry — invisible bounding box proxy
//   handles pointer events. Without this, R3F raycasts against 100k+ tris
//   per mouse move, freezing the GPU on high-poly conjurations.
//
// RESILIENCE (Feb 2026):
//   ConjuredObjectSafe wraps the inner component in an error boundary.
//   One corrupt/FBX/broken file should NEVER crash the entire 3D scene.
//   The Oasis must survive one bad file — like a city surviving one broken window.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import type { ConjuredAsset } from '../../lib/conjure/types'
import { useOasisStore } from '../../store/oasisStore'
import { extractModelStats } from './ModelPreview'
import { isLibraryAnimation, getLibraryAnimId, loadAnimationClip, getCachedClip, LIB_PREFIX, retargetClip } from '../../lib/forge/animation-library'
import { useInputManager } from '../../lib/input-manager'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

interface ConjuredObjectProps {
  asset: ConjuredAsset
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY — The Oasis's immune system for corrupt files
// ─═̷─═̷─ One bad shapeshifter shall not crash the realm ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

class ConjuredObjectErrorBoundary extends React.Component<
  { children: React.ReactNode; assetId: string; prompt: string; glbUrl?: string },
  { hasError: boolean; errorMsg: string }
> {
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(props: { children: React.ReactNode; assetId: string; prompt: string; glbUrl?: string }) {
    super(props)
    this.state = { hasError: false, errorMsg: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message }
  }
  componentDidCatch(error: Error) {
    console.warn(`[Forge:Object] ${this.props.assetId} failed to load: ${error.message}`)
    // Auto-retry: GLB might not be serveable yet (Next.js static file latency)
    // Clear Three.js loader cache so useGLTF retries the fetch instead of replaying the cached error
    if (this.retryCount < 3) {
      this.retryCount++
      console.log(`[Forge:Object] ${this.props.assetId} — retry ${this.retryCount}/3 in 2s...`)
      this.retryTimer = setTimeout(() => {
        if (this.props.glbUrl) {
          useGLTF.clear(this.props.glbUrl)
        }
        this.setState({ hasError: false, errorMsg: '' })
      }, 2000)
    }
  }
  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
  }
  render() {
    if (this.state.hasError) {
      return (
        <group>
          <mesh>
            <boxGeometry args={[0.4, 0.4, 0.4]} />
            <meshBasicMaterial color="#ff3333" wireframe transparent opacity={0.6} />
          </mesh>
          <Html position={[0, 0.6, 0]} center style={{ pointerEvents: 'none' }}>
            <div className="text-[9px] text-red-400 font-mono bg-black/80 px-1.5 py-0.5 rounded whitespace-nowrap">
              {this.props.prompt.slice(0, 20)}... (broken)
            </div>
          </Html>
        </group>
      )
    }
    return this.props.children
  }
}

/** Safe wrapper — use this in WorldObjects instead of raw ConjuredObject */
export function ConjuredObjectSafe({ asset }: ConjuredObjectProps) {
  const glbUrl = `${OASIS_BASE}${asset.glbPath || `/conjured/${asset.id}.glb`}`
  return (
    <ConjuredObjectErrorBoundary assetId={asset.id} prompt={asset.displayName || asset.prompt} glbUrl={glbUrl}>
      <ConjuredObject asset={asset} />
    </ConjuredObjectErrorBoundary>
  )
}

// ░▒▓ Noop raycast — assigned to all meshes in the GLB to prevent R3F
//     from doing per-triangle intersection tests on 30MB models ▓▒░
const NOOP_RAYCAST = () => {}

// ░▒▓ Clip name patterns — how we detect idle vs walk vs combat clips ▓▒░
const IDLE_PATTERNS = /idle|breathe?|stand|rest|pose|wait/i
const WALK_PATTERNS = /walk|run|move|locomotion|jog/i

// ░▒▓ Minimum proxy mesh dimension — prevents zero-size boxes from SkinnedMesh bind pose edge cases ▓▒░
const MIN_PROXY_DIM = 0.5

export function ConjuredObject({ asset }: ConjuredObjectProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const [showLabel, setShowLabel] = useState(false)
  const spawnProgress = useRef(0)
  const spawnDone = useRef(false)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const currentClipRef = useRef<string | null>(null)

  // Load the conjured GLB — clone ONCE, not on every render
  // ░▒▓ SkeletonUtils.clone for proper SkinnedMesh + bone cloning (rigged models) ▓▒░
  // ░▒▓ OASIS_BASE for basePath-aware GLB loading — useGLTF + HEAD fetch both need it ▓▒░
  const glbUrl = `${OASIS_BASE}${asset.glbPath || `/conjured/${asset.id}.glb`}`
  const { scene, animations } = useGLTF(glbUrl)

  const clonedScene = useMemo(() => {
    // ░▒▓ SkeletonUtils.clone handles SkinnedMesh + skeleton bindings properly ▓▒░
    // Plain scene.clone() breaks skinned meshes — bones detach, mesh collapses.
    // This was the root cause of rigged models being unselectable.
    const clone = SkeletonUtils.clone(scene) as THREE.Group
    // ░▒▓ Sanitize + kill raycasting on every child mesh ▓▒░
    // Meshy/Tripo GLBs can have broken materials: alphaTest with bad depth config,
    // DoubleSide faces that corrupt the depth buffer, transparent=true on opaque geo.
    // Without sanitization these cause entire-frame blackouts at certain camera angles.
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        child.raycast = NOOP_RAYCAST
        // ░▒▓ Material sanitizer — prevent depth buffer corruption ▓▒░
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const mat of mats) {
          if (!mat) continue
          // Force depth writes — transparent materials without depthWrite
          // create "holes" that show the clear color (black) through the scene
          mat.depthWrite = true
          mat.depthTest = true
          // Kill alphaTest — it causes discard/gl_FragDepth race conditions
          // that corrupt the depth buffer on some GPU drivers
          if (mat.alphaTest > 0 && mat.alphaTest < 1) {
            mat.alphaTest = 0
            mat.transparent = false
            mat.opacity = 1
          }
          // Force single-sided — DoubleSide backfaces write bogus depth values
          if (mat.side === THREE.DoubleSide) {
            mat.side = THREE.FrontSide
          }
          mat.needsUpdate = true
        }
      }
    })
    return clone
  }, [scene])

  // ░▒▓ AnimationMixer — smart idle/walk detection (same pattern as CatalogModelRenderer) ▓▒░
  // Instead of blindly playing the first clip forever, detect idle vs walk clips
  // and switch based on movement state. Walk stops when the character arrives.
  const { idleClip, walkClip } = useMemo(() => {
    const names = animations.map(a => a.name)
    return {
      idleClip: names.find(n => IDLE_PATTERNS.test(n)) || null,
      walkClip: names.find(n => WALK_PATTERNS.test(n)) || null,
    }
  }, [animations])

  // ░▒▓ Detect rigged character + collect bone names for retargeting ▓▒░
  const { isRigged, boneNames, skeletonKey } = useMemo(() => {
    const names: string[] = []
    clonedScene.traverse(child => {
      if ((child as THREE.Bone).isBone) names.push(child.name)
    })
    // skeletonKey = fingerprint of this naming convention (first 3 bone names sorted)
    // Used as cache key for retargeted clips
    const key = names.length > 0 ? names.slice(0, 3).sort().join(',') : ''
    if (names.length > 0) {
      console.log(`[Forge:Object] ${asset.id} bones (first 10):`, names.slice(0, 10), `| skeleton key: "${key}"`)
    }
    return { isRigged: names.length > 0, boneNames: names, skeletonKey: key }
  }, [clonedScene, asset.id])

  useEffect(() => {
    // Create mixer for baked animations OR rigged characters (library animations)
    if (animations.length === 0 && !isRigged) return
    const mixer = new THREE.AnimationMixer(clonedScene)
    mixerRef.current = mixer
    currentActionRef.current = null
    currentClipRef.current = null
    return () => { mixer.stopAllAction(); mixerRef.current = null }
  }, [clonedScene, animations, isRigged])

  // ░▒▓ Animation state machine — reacts to movement + behavior config ▓▒░
  // Supports both baked-in clips AND external library animations (lib: prefix)
  const animConfig = useOasisStore(s => s.behaviors[asset.id]?.animation)
  const isMoving = useOasisStore(s => !!s.behaviors[asset.id]?.moveTarget)
  const [externalClip, setExternalClip] = useState<THREE.AnimationClip | null>(null)

  // ░▒▓ Load external library animation when behavior config changes ▓▒░
  // Also auto-load walk animation for rigged chars (used during RTS movement)
  const [libWalkClip, setLibWalkClip] = useState<THREE.AnimationClip | null>(null)

  useEffect(() => {
    const clipName = animConfig?.clipName
    if (!clipName || !isLibraryAnimation(clipName)) {
      setExternalClip(null)
      return
    }
    const animId = getLibraryAnimId(clipName)
    const cached = getCachedClip(animId)
    if (cached) {
      setExternalClip(cached)
    } else {
      loadAnimationClip(animId).then(clip => {
        if (clip) setExternalClip(clip)
      })
    }
  }, [animConfig?.clipName])

  // Pre-load library walk for rigged chars without baked walk clip
  useEffect(() => {
    if (isRigged && !walkClip) {
      loadAnimationClip('walk').then(clip => {
        if (clip) setLibWalkClip(clip)
      })
    }
  }, [isRigged, walkClip])

  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer) return
    // Need either baked animations or an external clip
    if (animations.length === 0 && !externalClip) return

    // Priority 1: Explicit behavior config from ObjectInspector
    let clipName = animConfig?.clipName || null
    let loop = animConfig?.loop || 'repeat'
    let speed = animConfig?.speed || 1

    // Priority 2: Walk animation during RTS move-to
    // Use baked walk clip if available, otherwise use library walk for rigged chars
    if (!clipName && isMoving) {
      if (walkClip) {
        clipName = walkClip
        loop = 'repeat'
      } else if (libWalkClip) {
        clipName = libWalkClip.name  // lib:walk
        loop = 'repeat'
      }
    }

    // Priority 3: Idle fallback — always return to idle when not moving
    if (!clipName && idleClip) {
      clipName = idleClip
    }

    // Priority 4: If model has exactly 1 clip (e.g. baked walk-only from Meshy animate)
    // and there's no idle/walk pattern match, play it only while moving
    if (!clipName && animations.length === 1 && !idleClip && !walkClip) {
      if (isMoving) {
        clipName = animations[0].name
        loop = 'repeat'
      } else {
        // Not moving and no idle clip → stop animation
        if (currentActionRef.current) {
          currentActionRef.current.fadeOut(0.3)
          currentActionRef.current = null
          currentClipRef.current = null
        }
        return
      }
    }

    // No suitable clip → stop
    if (!clipName) {
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.3)
        currentActionRef.current = null
        currentClipRef.current = null
      }
      return
    }

    // Skip if already playing the same clip
    if (currentClipRef.current === clipName) return

    // Resolve clip: library animation (lib: prefix) or baked-in
    let clip: THREE.AnimationClip | undefined
    if (isLibraryAnimation(clipName)) {
      // Check explicit external clip first, then pre-loaded library walk
      clip = externalClip || undefined
      if (!clip && clipName === libWalkClip?.name) {
        clip = libWalkClip
      }
      if (!clip) return  // Still loading
      // ░▒▓ RETARGET — remap bone names to match this character's skeleton ▓▒░
      // Meshy uses "Hips", Tripo uses "mixamorigHips", library clips use "mixamorigHips"
      if (boneNames.length > 0 && skeletonKey) {
        clip = retargetClip(clip, boneNames, skeletonKey)
      }
    } else {
      clip = animations.find(a => a.name === clipName)
    }
    if (!clip) return

    const newAction = mixer.clipAction(clip)
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
  }, [animConfig?.clipName, animConfig?.loop, animConfig?.speed, animations, isMoving, idleClip, walkClip, externalClip, libWalkClip, boneNames, skeletonKey])

  // ░▒▓ Dispose cloned geometry + materials on unmount — stop VRAM leaks ▓▒░
  useEffect(() => {
    return () => {
      clonedScene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          const mat = child.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else if (mat) mat.dispose()
        }
      })
    }
  }, [clonedScene])

  // ░▒▓ Full mesh stats — extracted once, pushed to Zustand for ObjectInspector ▓▒░
  const meshStats = useMemo(() => extractModelStats(scene, animations), [scene, animations])
  const triangleCount = meshStats.triangles
  const updateConjuredAsset = useOasisStore(s => s.updateConjuredAsset)
  const setObjectMeshStats = useOasisStore(s => s.setObjectMeshStats)
  useEffect(() => {
    if (triangleCount > 0 && !asset.metadata?.triangleCount) {
      updateConjuredAsset(asset.id, {
        metadata: { ...asset.metadata, triangleCount, vertexCount: meshStats.vertices },
      })
    }
    // Push full stats to objectMeshStats for the inspector
    const stats = { ...meshStats }
    fetch(glbUrl, { method: 'HEAD' })
      .then(res => {
        const cl = res.headers.get('content-length')
        if (cl) stats.fileSize = parseInt(cl, 10)
      })
      .catch(() => {})
      .finally(() => setObjectMeshStats(asset.id, stats))
  }, [asset.id, asset.metadata, meshStats, triangleCount, glbUrl, updateConjuredAsset, setObjectMeshStats])

  // ░▒▓ Bounding box for raycast proxy — 12 tris instead of 100k+ ▓▒░
  // SkinnedMesh "bind pose" problem: vertices are stored in their REST position
  // (T-pose/A-pose). Box3.setFromObject reads those raw vertex positions, which
  // may collapse to a tiny/flat box because the skeleton hasn't posed them yet.
  // Fix: also compute bounds from BONE WORLD POSITIONS (the skeleton itself)
  // and union both. Bones always have valid transforms even before animation starts.
  const bounds = useMemo(() => {
    // Step 1: Update all skeletons so bone matrices are current
    clonedScene.traverse(child => {
      if (child instanceof THREE.SkinnedMesh && child.skeleton) {
        child.skeleton.update()
      }
    })

    // Step 2: Standard geometry-based bounds
    const box = new THREE.Box3().setFromObject(clonedScene)

    // Step 3: Union with bone positions — skeleton always has valid world transforms
    if (isRigged) {
      const boneBox = new THREE.Box3()
      const bonePos = new THREE.Vector3()
      clonedScene.traverse(child => {
        if ((child as THREE.Bone).isBone) {
          child.getWorldPosition(bonePos)
          boneBox.expandByPoint(bonePos)
        }
      })
      // Only use bone box if it has valid extent
      if (!boneBox.isEmpty()) {
        box.union(boneBox)
      }
    }

    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    // Guard against degenerate bounds — last resort minimum
    if (size.x < MIN_PROXY_DIM) size.x = MIN_PROXY_DIM
    if (size.y < MIN_PROXY_DIM) size.y = MIN_PROXY_DIM
    if (size.z < MIN_PROXY_DIM) size.z = MIN_PROXY_DIM
    // Guard against NaN/Infinity from empty scenes
    if (!isFinite(center.x)) center.x = 0
    if (!isFinite(center.y)) center.y = size.y / 2
    if (!isFinite(center.z)) center.z = 0
    console.log(`[Forge:Proxy] ${asset.id} (${asset.tier}) bounds: size=[${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}] center=[${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}]`)
    return { size, center }
  }, [clonedScene, asset.id, asset.tier, isRigged])

  // ░▒▓ Direct click handler — bypasses R3F event bubbling for reliability ▓▒░
  // Event bubbling from proxy mesh → SelectableWrapper group was unreliable for
  // dynamically-discovered child assets (rig/animate). Direct store call is bulletproof.
  const handleProxyClick = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    useOasisStore.getState().selectObject(asset.id)
    useOasisStore.getState().setInspectedObject(asset.id)
  }, [asset.id])

  // ░▒▓ Display name: behavior label (user rename) > displayName > prompt ▓▒░
  const behaviorLabel = useOasisStore(s => s.behaviors[asset.id]?.label)
  const label = behaviorLabel || asset.displayName || asset.prompt

  // ░▒▓ Paint mode: disable raycasting on proxy so clicks fall through to PaintOverlay ▓▒░
  const proxyRef = useRef<THREE.Mesh>(null)
  const paintMode = useOasisStore(s => s.paintMode)
  useEffect(() => {
    if (!proxyRef.current) return
    if (paintMode) {
      proxyRef.current.raycast = () => {}  // ghost mode — invisible to raycaster
    } else {
      proxyRef.current.raycast = THREE.Mesh.prototype.raycast  // restore
    }
  }, [paintMode])

  // Spawn animation — scale from 0 to target, then YIELD to TransformControls
  // Position is managed by parent SelectableWrapper, NOT here
  useFrame((_, delta) => {
    // ░▒▓ Tick the animation mixer for rigged models ▓▒░
    if (mixerRef.current) mixerRef.current.update(delta)

    if (!groupRef.current || spawnDone.current) return

    if (spawnProgress.current < 1) {
      spawnProgress.current = Math.min(1, spawnProgress.current + delta * 2)
      const t = spawnProgress.current
      // Elastic ease-out
      const s = t === 1 ? 1 : 1 - Math.pow(2, -10 * t) * Math.cos((t * 10 - 0.75) * ((2 * Math.PI) / 3))
      const scale = s * asset.scale
      groupRef.current.scale.setScalar(scale)
    } else {
      groupRef.current.scale.setScalar(asset.scale)
      spawnDone.current = true // Never touch scale again — TransformControls owns it
    }
  })

  return (
    <group ref={groupRef}>
      {/* ░▒▓ Transparent bounding box proxy — cheap raycast target (12 tris) ▓▒░ */}
      {/* onClick is handled DIRECTLY here instead of relying on event bubbling to */}
      {/* SelectableWrapper. Bubbling was unreliable for dynamically-discovered children. */}
      <mesh
        ref={proxyRef}
        position={[bounds.center.x, bounds.center.y, bounds.center.z]}
        onClick={handleProxyClick}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); if (!useInputManager.getState().pointerLocked) setShowLabel(true) }}
        onPointerOut={(e) => { e.stopPropagation(); setHovered(false); setShowLabel(false) }}
      >
        <boxGeometry args={[bounds.size.x, bounds.size.y, bounds.size.z]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* The actual model — raycasting disabled on all child meshes */}
      <primitive object={clonedScene} />

      {/* Hover glow ring */}
      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.8, 1, 32]} />
          <meshBasicMaterial color="#F97316" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}

      {/* Info label */}
      {showLabel && (
        <Html position={[0, 2, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            className="px-2 py-1 rounded text-xs whitespace-nowrap select-none pointer-events-none"
            style={{
              background: 'rgba(0,0,0,0.8)',
              border: '1px solid rgba(249,115,22,0.3)',
              color: '#F97316',
            }}
          >
            {label.slice(0, 40)}{label.length > 40 ? '...' : ''}
            <div className="text-[10px] text-gray-500">
              {asset.provider} / {asset.tier}
              {triangleCount > 0 && <span className="ml-1.5 text-orange-400/60">{triangleCount >= 1000 ? `${(triangleCount / 1000).toFixed(1)}k` : triangleCount} tris</span>}
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

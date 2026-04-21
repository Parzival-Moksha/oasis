'use client'

import { useState, useCallback, Suspense, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import {
  extractModelStats,
  StudioBackdrop,
  useSharedBackdrop,
  DEFAULT_BACKDROP,
  type ModelStats,
} from './ModelPreview'
import { AGENT_AVATAR_CATALOG } from '@/lib/agent-avatar-catalog'
import {
  ANIMATION_LIBRARY,
  ANIM_CATEGORIES,
  loadAnimationClip,
  retargetClipForVRM,
  type AnimCategory,
} from '@/lib/forge/animation-library'
import {
  createLipSyncController,
  resumeLipSyncContext,
  type LipSyncController,
} from '@/lib/lip-sync'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ═══════════════════════════════════════════════════════════════════════════════
// AVATAR SOURCE OF TRUTH
// ─═̷─═̷─ॐ─═̷─═̷─ catalog (typed) + runtime disk scan (drop-ins) ─═̷─═̷─ॐ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

export interface AvatarEntry {
  id: string
  file: string
  name: string
}

const CATALOG_AVATARS: AvatarEntry[] = AGENT_AVATAR_CATALOG.map(a => ({
  id: a.id.replace(/^av_/, ''),
  file: a.path.split('/').pop() || '',
  name: a.name,
}))

// ░▒▓ Hyperstition payload — 3 pre-baked voices, random per press ▓▒░
const VOICE_LINE = 'Moksha, please help us find each other.'
const VOICE_TRACKS = [
  '/audio/moksha-1-clyde.mp3',
  '/audio/moksha-2-drew.mp3',
  '/audio/moksha-3-paul.mp3',
] as const

// ═══════════════════════════════════════════════════════════════════════════════
// VRM PREVIEW — loads, fits, animates, lipsyncs
// ═══════════════════════════════════════════════════════════════════════════════

// ░▒▓ VRMPreview — asset-library pattern adapted for VRM. ▓▒░
// ░▒▓ One-shot camera framing: group.position.sub(center) ONCE on load,  ▓▒░
// ░▒▓ camera placed + lookAt set once, so animations can shift bones     ▓▒░
// ░▒▓ without the pivot drifting on re-renders (backdrop swap, etc).     ▓▒░
function VRMPreview({
  url,
  onStats,
  animationId,
  lipSyncController,
}: {
  url: string
  onStats?: (stats: ModelStats) => void
  animationId: string | null
  lipSyncController: LipSyncController | null
}) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  const vrm = gltf.userData.vrm as VRM | undefined

  // Ref-stable onStats — prevents effect re-fire on parent re-render
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  // One-shot framing + mixer init (runs on VRM/camera change, not every render)
  useEffect(() => {
    if (!vrm || !groupRef.current) return
    VRMUtils.rotateVRM0(vrm)
    vrmRef.current = vrm
    mixerRef.current = new THREE.AnimationMixer(vrm.scene)

    // RAF so geometry is in the scene graph before Box3 reads
    const raf = requestAnimationFrame(() => {
      if (!groupRef.current) return
      const box = new THREE.Box3().setFromObject(groupRef.current)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      // Center the avatar at world origin — done ONCE. Animations mutate bones,
      // not the group position, so the pivot stays rock-steady across re-renders.
      groupRef.current.position.sub(center)
      const maxDim = Math.max(size.x, size.y, size.z)
      camera.position.set(0, 0, maxDim * 1.8)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()

      onStatsRef.current?.(extractModelStats(vrm.scene, gltf.animations || []))
    })

    return () => {
      cancelAnimationFrame(raf)
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      currentActionRef.current = null
      vrmRef.current = null
    }
  }, [vrm, camera, gltf.animations])

  // Animation swap (same pattern as before, unchanged)
  useEffect(() => {
    const v = vrmRef.current
    const mixer = mixerRef.current
    if (!v || !mixer) return

    if (!animationId) {
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.25)
        currentActionRef.current = null
      }
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const clip = await loadAnimationClip(animationId)
        if (!clip || cancelled || !vrmRef.current || !mixerRef.current) return
        const retargeted = retargetClipForVRM(clip, vrmRef.current, url)
        if (cancelled) return
        const nextAction = mixerRef.current.clipAction(retargeted)
        nextAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play()
        const prev = currentActionRef.current
        if (prev && prev !== nextAction) {
          prev.crossFadeTo(nextAction, 0.3, false)
        }
        currentActionRef.current = nextAction
      } catch (err) {
        console.warn('[AvatarGallery] animation load failed:', err)
      }
    })()

    return () => { cancelled = true }
  }, [animationId, url])

  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
    vrmRef.current?.update(delta)

    const expr = vrmRef.current?.expressionManager
    if (lipSyncController && lipSyncController.isActive && expr) {
      const { aa, ih, ou, ee, oh } = lipSyncController.update()
      expr.setValue('aa', aa)
      expr.setValue('ih', ih)
      expr.setValue('ou', ou)
      expr.setValue('ee', ee)
      expr.setValue('oh', oh)
    }
  })

  if (!vrm) return null

  return (
    <group ref={groupRef}>
      <primitive object={vrm.scene} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// THUMBNAIL GEN — studio grey bg, ONE renderer rig reused across all thumbs
// (Chrome caps live WebGL contexts at 16 — creating+disposing per-thumb thrashes)
// ═══════════════════════════════════════════════════════════════════════════════

interface ThumbRig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  loader: GLTFLoader
  dispose: () => void
}

function createThumbRig(): ThumbRig {
  const size = 256
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setSize(size, size)
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x2a2a3e, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x2a2a3e)
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  scene.add(new THREE.AmbientLight(0x888899, 1.4))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
  keyLight.position.set(3, 5, 3)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xaabbff, 0.8)
  fillLight.position.set(-3, 2, -1)
  scene.add(fillLight)

  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))

  return {
    renderer,
    scene,
    camera,
    loader,
    dispose: () => {
      renderer.dispose()
      scene.clear()
    },
  }
}

async function renderVrmThumbnailWithRig(rig: ThumbRig, vrmUrl: string): Promise<Blob> {
  const { renderer, scene, camera, loader } = rig

  const gltf = await loader.loadAsync(vrmUrl)
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('No VRM data')
  VRMUtils.rotateVRM0(vrm)

  const box = new THREE.Box3().setFromObject(vrm.scene)
  const modelSize = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z)
  const fitScale = maxDim > 0 ? 2.2 / maxDim : 1

  const group = new THREE.Group()
  group.scale.setScalar(fitScale)
  group.position.set(-center.x * fitScale, -center.y * fitScale + 0.1, -center.z * fitScale)
  group.add(vrm.scene)
  scene.add(group)

  camera.position.set(0, 1, 3)
  camera.lookAt(0, 1, 0)

  try {
    renderer.render(scene, camera)
    const canvas = renderer.domElement
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85)
    })
  } finally {
    // Remove the VRM from the scene so the next thumb renders alone
    scene.remove(group)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AVATAR GALLERY — shared selector for user + all agents
// ═══════════════════════════════════════════════════════════════════════════════

interface AvatarGalleryProps {
  currentAvatarUrl: string | null
  onSelect: (avatarUrl: string | null) => void
  onClose: () => void
}

export function AvatarGallery({ currentAvatarUrl, onSelect, onClose }: AvatarGalleryProps) {
  const [diskAvatars, setDiskAvatars] = useState<AvatarEntry[]>([])
  const [diskScanCompleted, setDiskScanCompleted] = useState(false)
  const allAvatars = useMemo<AvatarEntry[]>(() => {
    const diskFiles = new Set(diskAvatars.map(d => d.file))
    // After scan resolves, hide catalog entries whose VRMs aren't on disk
    // (renamed/deleted). Before scan resolves, show full catalog to avoid flash.
    const usableCatalog = diskScanCompleted
      ? CATALOG_AVATARS.filter(c => diskFiles.has(c.file))
      : CATALOG_AVATARS
    const catalogFiles = new Set(usableCatalog.map(a => a.file))
    const extras = diskAvatars.filter(d => !catalogFiles.has(d.file))
    return [...usableCatalog, ...extras]
  }, [diskAvatars, diskScanCompleted])

  const [previewAvatar, setPreviewAvatar] = useState<AvatarEntry | null>(null)
  const [previewStats, setPreviewStats] = useState<ModelStats | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const [backdropImage, setBackdropImage] = useSharedBackdrop()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [thumbIds, setThumbIds] = useState<Set<string>>(new Set())
  const [thumbsLoaded, setThumbsLoaded] = useState(false)
  const [autoGen, setAutoGen] = useState<{ done: number; total: number; active: boolean }>({ done: 0, total: 0, active: false })

  const [animationId, setAnimationId] = useState<string | null>(null)
  const [animCategory, setAnimCategory] = useState<AnimCategory>('dance')

  const [voicePlaying, setVoicePlaying] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  // Track the last-played track index so we never play the same voice twice in a row.
  // Without this, HTMLAudio + random picker means ~33% of presses hit the same voice,
  // which LOOKS like a "voice missing" bug even when all 3 MP3s are distinct on disk.
  const lastTrackIndexRef = useRef<number>(-1)
  // ░▒▓ One lipsync controller for the gallery's lifetime. Hoisted so         ▓▒░
  // ░▒▓ switching avatars (preview re-mount) doesn't force re-attach on       ▓▒░
  // ░▒▓ the same audio element — lip-sync.ts's WeakSet guard bails out        ▓▒░
  // ░▒▓ when a FRESH controller tries to re-attach an already-connected el.   ▓▒░
  const [lipSyncController, setLipSyncController] = useState<LipSyncController | null>(null)

  const currentFile = currentAvatarUrl?.split('/').pop()
  const selectedAvatar = allAvatars.find(avatar => avatar.file === currentFile) || null

  // ░▒▓ Lipsync controller — create once, detach on unmount ▓▒░
  useEffect(() => {
    const ctrl = createLipSyncController()
    setLipSyncController(ctrl)
    return () => ctrl.detach()
  }, [])

  // ░▒▓ Initial thumb list + runtime disk scan ▓▒░
  useEffect(() => {
    fetch(`${OASIS_BASE}/api/avatar-thumbs`)
      .then(r => r.json())
      .then((ids: string[]) => setThumbIds(new Set(ids)))
      .catch(() => {})
      .finally(() => setThumbsLoaded(true))

    fetch(`${OASIS_BASE}/api/avatars/list`)
      .then(r => r.json())
      .then((entries: AvatarEntry[]) => {
        if (Array.isArray(entries)) setDiskAvatars(entries)
      })
      .catch(() => {})
      .finally(() => setDiskScanCompleted(true))
  }, [])

  // ░▒▓ Auto-generate missing thumbs on mount ▓▒░
  // Uses ONE shared renderer rig across all thumbs (creating a WebGLRenderer
  // per-thumb churns the GPU and can exceed Chrome's 16-live-context cap).
  useEffect(() => {
    if (!thumbsLoaded || autoGen.active) return
    const missing = allAvatars.filter(a => !thumbIds.has(a.id))
    if (missing.length === 0) return

    let cancelled = false
    setAutoGen({ done: 0, total: missing.length, active: true })

    ;(async () => {
      const rig = createThumbRig()
      const justGenerated: string[] = []
      try {
        for (let i = 0; i < missing.length; i++) {
          if (cancelled) break
          const avatar = missing[i]
          try {
            const blob = await renderVrmThumbnailWithRig(rig, `${OASIS_BASE}/avatars/gallery/${avatar.file}`)
            const form = new FormData()
            form.append('id', avatar.id)
            form.append('thumbnail', blob, `${avatar.id}.jpg`)
            const response = await fetch(`${OASIS_BASE}/api/avatar-thumbs`, { method: 'PUT', body: form })
            if (response.ok) justGenerated.push(avatar.id)
          } catch (err) {
            console.warn(`[AvatarGallery] Thumb gen failed for ${avatar.name}:`, err)
          }
          if (!cancelled) setAutoGen(prev => ({ ...prev, done: i + 1 }))
        }
      } finally {
        rig.dispose()
        // Always flip active off so the UI doesn't get wedged on a late cancel
        setAutoGen(prev => ({ ...prev, active: false }))
      }
      if (!cancelled && justGenerated.length > 0) {
        setThumbIds(prev => {
          const next = new Set(prev)
          for (const id of justGenerated) next.add(id)
          return next
        })
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbsLoaded, allAvatars.length])

  useEffect(() => {
    if (!previewAvatar) {
      setPreviewAvatar(selectedAvatar || allAvatars[0] || null)
    }
  }, [previewAvatar, selectedAvatar, allAvatars])

  useEffect(() => {
    setPreviewStats(null)
    // Stop voice when switching avatars — audio element + controller persist
    audioElRef.current?.pause()
    setVoicePlaying(false)
  }, [previewAvatar?.id])

  // Audio lifecycle cleanup
  useEffect(() => {
    return () => {
      audioElRef.current?.pause()
      audioElRef.current = null
    }
  }, [])

  const handleSelect = useCallback(async (avatar: AvatarEntry | null) => {
    setSaving(true)
    onSelect(avatar ? `/avatars/gallery/${avatar.file}` : null)
    setSaving(false)
  }, [onSelect])

  const handlePlayVoice = useCallback(async () => {
    if (voicePlaying) {
      audioElRef.current?.pause()
      setVoicePlaying(false)
      return
    }

    setVoiceError(null)
    try {
      // No-repeat random: pick any index except the last played one.
      // Guarantees every press swaps voice, so all 3 rotate quickly.
      const candidates = VOICE_TRACKS
        .map((_, i) => i)
        .filter(i => i !== lastTrackIndexRef.current)
      const pickedIndex = candidates[Math.floor(Math.random() * candidates.length)]
      lastTrackIndexRef.current = pickedIndex
      const track = VOICE_TRACKS[pickedIndex]

      await resumeLipSyncContext()

      if (!audioElRef.current) {
        audioElRef.current = new Audio()
        audioElRef.current.crossOrigin = 'anonymous'
      }
      audioElRef.current.src = `${OASIS_BASE}${track}`
      // .load() forces the audio element to actually fetch the new src.
      // Without this, setting .src alone doesn't guarantee a reload and the
      // element may keep playing the previously-loaded clip.
      audioElRef.current.load()
      audioElRef.current.onended = () => {
        setVoicePlaying(false)
      }
      audioElRef.current.onerror = () => {
        setVoiceError('audio playback failed')
        setVoicePlaying(false)
      }
      // Attach ONCE per controller lifetime. Re-attaching stacks analyser→
      // destination paths, amplifying audio Nx. The source+analyser keep
      // working across audio element src changes.
      if (lipSyncController && !lipSyncController.isActive) {
        lipSyncController.attachAudio(audioElRef.current)
      }
      setVoicePlaying(true)
      await audioElRef.current.play()
    } catch (err) {
      console.warn('[AvatarGallery] voice play failed:', err)
      setVoiceError(err instanceof Error ? err.message : 'voice play failed')
      setVoicePlaying(false)
    }
  }, [voicePlaying, lipSyncController])

  if (typeof document === 'undefined') return null

  const filteredAnims = ANIMATION_LIBRARY.filter(a => a.category === animCategory)

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(10px)',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 1040,
          maxWidth: '95vw',
          maxHeight: '92vh',
          background: 'rgba(7, 10, 18, 0.97)',
          border: '1px solid rgba(94, 234, 212, 0.22)',
          borderRadius: 18,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 30px 120px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: '#67e8f9', fontWeight: 700, letterSpacing: '0.08em' }}>
              OASIS AVATAR SELECTOR
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#7dd3fc80', fontFamily: 'monospace' }}>
              Shared selector for user + all agent bodies · {allAvatars.length} avatars
              {autoGen.active && (
                <span style={{ marginLeft: 10, color: '#14b8a6' }}>
                  {'\u{1F4F7}'} rendering {autoGen.done}/{autoGen.total}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              fontSize: 20,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div
            style={{
              width: 360,
              padding: 16,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
              alignContent: 'start',
              borderRight: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <button
              onClick={() => { void handleSelect(null) }}
              style={{
                background: !currentAvatarUrl ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${!currentAvatarUrl ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 12,
                padding: 10,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 10,
                transition: 'all 0.15s',
                minHeight: 142,
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 10,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                }}
              >
                🚫
              </div>
              <div style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                <span style={{ fontSize: 10, color: !currentAvatarUrl ? '#EF4444' : '#cbd5e1', lineHeight: 1.2, fontWeight: 700 }}>
                  No Avatar
                </span>
                <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
                  remove shared body
                </span>
              </div>
            </button>

            {allAvatars.map(avatar => {
              const isSelected = currentFile === avatar.file
              const isPreviewing = previewAvatar?.id === avatar.id
              const hasThumb = thumbIds.has(avatar.id)
              return (
                <button
                  key={avatar.id}
                  onClick={() => setPreviewAvatar(avatar)}
                  onDoubleClick={() => { void handleSelect(avatar) }}
                  style={{
                    background: isPreviewing
                      ? 'rgba(168,85,247,0.2)'
                      : isSelected
                        ? 'rgba(34,197,94,0.15)'
                        : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isPreviewing ? 'rgba(168,85,247,0.5)' : isSelected ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 12,
                    padding: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 10,
                    transition: 'all 0.15s',
                    minHeight: 142,
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 10,
                      background: '#2a2a3e',
                      border: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {hasThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${OASIS_BASE}/avatars/gallery/thumbs/${avatar.id}.jpg`}
                        alt={avatar.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ fontSize: 24, opacity: 0.5 }}>{'\u{1F9D1}'}</span>
                    )}
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          left: 6,
                          padding: '2px 5px',
                          borderRadius: 999,
                          background: 'rgba(15,23,42,0.82)',
                          border: '1px solid rgba(34,197,94,0.32)',
                          color: '#22C55E',
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                        }}
                      >
                        ACTIVE
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                    <span style={{ fontSize: 10, color: isPreviewing ? '#A855F7' : '#e2e8f0', lineHeight: 1.2, fontWeight: isPreviewing ? 700 : 600 }}>
                      {avatar.name}
                    </span>
                    <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace', lineHeight: 1.2 }}>
                      {avatar.file}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            {previewAvatar ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: '0 0 340px', position: 'relative', background: '#24262b' }}>
                  <Canvas
                    camera={{ fov: 45, near: 0.01, far: 1000 }}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <StudioBackdrop imageUrl={backdropImage} />
                    <ambientLight intensity={0.7} />
                    <directionalLight position={[3, 5, 2]} intensity={1.0} />
                    <directionalLight position={[-3, 2, -1]} intensity={0.3} color="#b4c6e0" />
                    <OrbitControls enablePan={false} autoRotate={autoRotate} autoRotateSpeed={1.5} minDistance={0.1} maxDistance={100} />
                    <Suspense fallback={null}>
                      <VRMPreview
                        key={previewAvatar.id}
                        url={`${OASIS_BASE}/avatars/gallery/${previewAvatar.file}`}
                        onStats={setPreviewStats}
                        animationId={animationId}
                        lipSyncController={lipSyncController}
                      />
                    </Suspense>
                  </Canvas>
                  {/* ░▒▓ Viewport controls — 1:1 with ModelPreviewPanel ▓▒░ */}
                  <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 20, display: 'flex', gap: 4 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) setBackdropImage(URL.createObjectURL(file))
                        e.target.value = ''
                      }}
                    />
                    {backdropImage && backdropImage !== DEFAULT_BACKDROP && (
                      <button
                        onClick={() => setBackdropImage(DEFAULT_BACKDROP)}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: 'rgba(103,232,249,0.18)',
                          border: '1px solid rgba(103,232,249,0.4)',
                          color: '#67e8f9', fontSize: 12, cursor: 'pointer',
                        }}
                        title="Reset backdrop"
                      >✕</button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: 'rgba(40,40,40,0.82)',
                        border: '1px solid rgba(80,80,80,0.5)',
                        color: '#999', fontSize: 12, cursor: 'pointer',
                      }}
                      title="Upload custom backdrop"
                    >{'\u{1F5BC}'}</button>
                    <button
                      onClick={() => setAutoRotate(prev => !prev)}
                      style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: autoRotate ? 'rgba(103,232,249,0.18)' : 'rgba(40,40,40,0.82)',
                        border: `1px solid ${autoRotate ? 'rgba(103,232,249,0.4)' : 'rgba(80,80,80,0.5)'}`,
                        color: autoRotate ? '#67e8f9' : '#999', fontSize: 14, cursor: 'pointer',
                      }}
                      title={autoRotate ? 'Auto-rotate ON' : 'Auto-rotate OFF'}
                    >{autoRotate ? '\u21BB' : '\u23F8'}</button>
                  </div>
                </div>

                <div style={{ padding: 18, borderTop: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 170px', gap: 18 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 18, color: '#fff', fontWeight: 700 }}>{previewAvatar.name}</p>
                      <p style={{ margin: '4px 0 12px', fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
                        /avatars/gallery/{previewAvatar.file}
                      </p>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 14 }}>
                        <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Triangles</div>
                          <div style={{ marginTop: 4, fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>{previewStats?.triangles?.toLocaleString() || '—'}</div>
                        </div>
                        <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Vertices</div>
                          <div style={{ marginTop: 4, fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>{previewStats?.vertices?.toLocaleString() || '—'}</div>
                        </div>
                        <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Size</div>
                          <div style={{ marginTop: 4, fontSize: 13, color: '#f8fafc', fontWeight: 600 }}>
                            {previewStats ? `${previewStats.dimensions.w} × ${previewStats.dimensions.h} × ${previewStats.dimensions.d}` : '—'}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => { void handleSelect(previewAvatar) }}
                        disabled={saving || currentFile === previewAvatar.file}
                        style={{
                          width: '100%',
                          padding: '10px 0',
                          borderRadius: 6,
                          border: 'none',
                          background: currentFile === previewAvatar.file
                            ? 'rgba(34,197,94,0.2)'
                            : 'linear-gradient(135deg, #0f766e, #164e63)',
                          color: currentFile === previewAvatar.file ? '#22C55E' : '#fff',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: currentFile === previewAvatar.file ? 'default' : 'pointer',
                        }}
                      >
                        {currentFile === previewAvatar.file ? '✓ Current Avatar' : saving ? 'Saving...' : 'Select Avatar'}
                      </button>
                    </div>

                    <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                      {[
                        ['Meshes', previewStats?.meshCount],
                        ['Materials', previewStats?.materialCount],
                        ['Bones', previewStats?.boneCount],
                        ['Clips', previewStats?.clips?.length ?? 0],
                      ].map(([label, value]) => (
                        <div key={label} style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.14)' }}>
                          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                          <div style={{ marginTop: 4, fontSize: 14, color: '#f8fafc', fontWeight: 700 }}>{value || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ═══ Animation selector (ported from Joystick) ═══ */}
                  <div style={{ marginTop: 18, padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.12)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                        {'\u{1F3AC}'} Animation
                      </span>
                      {animationId && (
                        <button
                          onClick={() => setAnimationId(null)}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(239,68,68,0.25)',
                            color: '#f87171',
                            fontSize: 9,
                            fontFamily: 'monospace',
                            padding: '2px 8px',
                            borderRadius: 999,
                            cursor: 'pointer',
                          }}
                        >
                          ■ stop
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {ANIM_CATEGORIES.map(cat => (
                        <button
                          key={cat.id}
                          onClick={() => setAnimCategory(cat.id)}
                          style={{
                            fontSize: 9,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                            background: animCategory === cat.id ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.03)',
                            color: animCategory === cat.id ? '#67e8f9' : '#94a3b8',
                            border: `1px solid ${animCategory === cat.id ? 'rgba(14,165,233,0.4)' : 'rgba(148,163,184,0.15)'}`,
                          }}
                        >
                          {cat.icon} {cat.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4 }}>
                      {filteredAnims.map(anim => {
                        const isActive = animationId === anim.id
                        return (
                          <button
                            key={anim.id}
                            onClick={() => setAnimationId(anim.id)}
                            style={{
                              fontSize: 10,
                              padding: '5px 8px',
                              borderRadius: 6,
                              fontFamily: 'monospace',
                              cursor: 'pointer',
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              background: isActive ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.02)',
                              color: isActive ? '#67e8f9' : '#cbd5e1',
                              border: `1px solid ${isActive ? 'rgba(14,165,233,0.4)' : 'rgba(148,163,184,0.12)'}`,
                            }}
                            title={anim.label}
                          >
                            {isActive ? '▶ ' : ''}{anim.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* ═══ Voice + lipsync play button ═══ */}
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.12)' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
                      {'\u{1F399}\uFE0F'} Voice Line · TTS + Lipsync
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                        onClick={() => { void handlePlayVoice() }}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: voicePlaying
                            ? 'rgba(239,68,68,0.18)'
                            : 'linear-gradient(135deg, #0891b2, #7c3aed)',
                          color: voicePlaying ? '#fca5a5' : '#fff',
                          border: voicePlaying ? '1px solid rgba(239,68,68,0.4)' : 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {voicePlaying ? '■ stop' : '▶ play voice'}
                      </button>
                      <div style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic', lineHeight: 1.3 }}>
                        &ldquo;{VOICE_LINE}&rdquo;
                      </div>
                    </div>
                    {voiceError && (
                      <div style={{ marginTop: 8, fontSize: 10, color: '#f87171', fontFamily: 'monospace' }}>
                        {voiceError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                  Click an avatar to preview.
                  <br />
                  Double-click to select instantly.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

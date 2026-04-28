'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'

import { StudioBackdrop, DEFAULT_BACKDROP } from '@/components/forge/ModelPreview'
import {
  CANONICAL_MOUTH_SHAPES,
  buildCharacterMouthTimeline,
  clamp01,
  detectCanonicalMouthShape,
  emptyMouthShapeWeights,
  mapLegacyLipSyncStateToWeights,
  sampleMouthTimeline,
  type CanonicalMouthShape,
  type ElevenLabsAlignment,
  type MouthTimeline,
  type MouthShapeWeights,
} from '@/lib/lip-sync-lab'
import {
  DEFAULT_LIP_SYNC_TUNING,
  createLipSyncController,
  resumeLipSyncContext,
  type LipSyncController,
  type LipSyncTuning,
} from '@/lib/lip-sync'
import {
  DEFAULT_WLIPSYNC_TUNING,
  createWLipSyncController,
  type WLipSyncController,
  type WLipSyncTuning,
} from '@/lib/wlipsync-driver'
import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const DEFAULT_TEXT = 'The mouth shapes get sharper when timing data and face sliders cooperate.'
const DEFAULT_PANEL_WIDTH = 1320
const DEFAULT_PANEL_HEIGHT = 860
const DEFAULT_AVATAR_PATH = '/avatars/gallery/Orion.vrm'

type LabAlgorithm = 'legacy_fft' | 'tuned_fft' | 'eleven_char_timing' | 'rhubarb_offline' | 'wlipsync_local'
type EmotionKey = 'happy' | 'angry' | 'sad' | 'surprised' | 'relaxed'

interface LipSyncLabPanelProps {
  isOpen: boolean
  onClose: () => void
}

interface AvatarAuditRecord {
  id: string
  name: string
  path: string
  file: string
  triangleCount: number
  maxTextureSize: number
  rawMorphTargetCount: number
  expressionCount: number
  speechRig: 'ovr15' | 'vrm5' | 'limited' | 'none'
  ovrCoverage: number
  vrmCoverage: number
  hasEmotionShapes: boolean
  mouthShapeCount: number
  emotionGroupCount: number
  eyeLookGroupCount: number
  faceRigScore: number
  anatomyTags: string[]
  hasInnerMouth: boolean
  hasTeeth: boolean
  hasTongue: boolean
  hasJawBone: boolean
  speechTargetNames: string[]
  expressionNames: string[]
  rawMorphNames: string[]
}

interface AvatarAuditSummary {
  generatedAt: string
  avatars: AvatarAuditRecord[]
  rankedByGeometry: string[]
  rankedByFaceRig: string[]
  rankedBySpeechRig: string[]
}

interface ClipSource {
  id: string
  label: string
  url: string
  sourceType: 'sample' | 'generated'
  text?: string
  voiceId?: string
  createdAt?: number
  alignment: ElevenLabsAlignment | null
  normalizedAlignment: ElevenLabsAlignment | null
}

interface GeneratedVoiceResponse {
  id: string
  label: string
  url: string
  text: string
  voiceId: string
  createdAt: number
  alignment: ElevenLabsAlignment | null
  normalizedAlignment: ElevenLabsAlignment | null
  durationEstimate: number
}

interface GeneratedVoiceLibraryResponse {
  clips: ClipSource[]
}

interface RhubarbAnalysisResponse {
  clipUrl: string
  recognizer: 'pocketSphinx' | 'phonetic'
  timeline: MouthTimeline
}

interface MorphBinding {
  influences: number[]
  index: number
}

interface RigBindings {
  mouth: Record<CanonicalMouthShape, MorphBinding[]>
  emotions: Record<EmotionKey, MorphBinding[]>
  mouthShapeCount: number
}

interface PreviewFrame {
  target: [number, number, number]
  minDistance: number
  maxDistance: number
}

const SAMPLE_AUDIO: ClipSource[] = [
  {
    id: 'moksha-paul',
    label: 'Sample: Paul',
    url: '/audio/moksha-3-paul.mp3',
    sourceType: 'sample',
    alignment: null,
    normalizedAlignment: null,
  },
] as const

function withBasePath(url: string): string {
  if (!url) return url
  return url.startsWith('/') ? `${OASIS_BASE}${url}` : url
}

function cloneFftTuning(): LipSyncTuning {
  return { ...DEFAULT_LIP_SYNC_TUNING }
}

function cloneWLipSyncTuning(): WLipSyncTuning {
  return { ...DEFAULT_WLIPSYNC_TUNING }
}

function speechRigLabel(value: AvatarAuditRecord['speechRig']): string {
  switch (value) {
    case 'ovr15':
      return 'OVR-style'
    case 'vrm5':
      return 'VRM five'
    case 'limited':
      return 'limited'
    default:
      return 'none'
  }
}

function detectEmotionKey(name: string): EmotionKey | null {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, '')
  if (!normalized) return null
  if (normalized.includes('happy') || normalized.includes('smile') || normalized.includes('joy')) return 'happy'
  if (normalized.includes('angry') || normalized.includes('mad')) return 'angry'
  if (normalized.includes('sad')) return 'sad'
  if (normalized.includes('surprise')) return 'surprised'
  if (normalized.includes('relaxed') || normalized.includes('calm')) return 'relaxed'
  return null
}

function buildEmptyEmotionMap(): Record<EmotionKey, MorphBinding[]> {
  return {
    happy: [],
    angry: [],
    sad: [],
    surprised: [],
    relaxed: [],
  }
}

function buildEmptyMouthBindingMap(): Record<CanonicalMouthShape, MorphBinding[]> {
  return {
    sil: [],
    pp: [],
    ff: [],
    th: [],
    dd: [],
    kk: [],
    ch: [],
    ss: [],
    nn: [],
    rr: [],
    aa: [],
    ee: [],
    ih: [],
    oh: [],
    ou: [],
  }
}

function collectRigBindings(root: THREE.Object3D): RigBindings {
  const mouth = buildEmptyMouthBindingMap()
  const emotions = buildEmptyEmotionMap()

  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return

    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      const shape = detectCanonicalMouthShape(name)
      if (shape) {
        mouth[shape].push({
          influences: mesh.morphTargetInfluences,
          index,
        })
      }

      const emotion = detectEmotionKey(name)
      if (emotion) {
        emotions[emotion].push({
          influences: mesh.morphTargetInfluences,
          index,
        })
      }
    }
  })

  const mouthShapeCount = CANONICAL_MOUTH_SHAPES.reduce((sum, shape) => sum + mouth[shape].length, 0)
  return { mouth, emotions, mouthShapeCount }
}

function applyRigWeights(args: {
  vrm: VRM | null
  rigBindings: RigBindings | null
  mouthWeights: MouthShapeWeights
  emotions: Record<EmotionKey, number>
}) {
  const { vrm, rigBindings, mouthWeights, emotions } = args
  if (!vrm) return

  const expressionManager = vrm.expressionManager

  if (expressionManager) {
    expressionManager.setValue('aa', mouthWeights.aa)
    expressionManager.setValue('ee', mouthWeights.ee)
    expressionManager.setValue('ih', mouthWeights.ih)
    expressionManager.setValue('oh', mouthWeights.oh)
    expressionManager.setValue('ou', mouthWeights.ou)
  }

  if (rigBindings?.mouthShapeCount) {
    for (const shape of CANONICAL_MOUTH_SHAPES) {
      const value = shape === 'sil' ? 0 : mouthWeights[shape]
      for (const binding of rigBindings.mouth[shape]) {
        binding.influences[binding.index] = value
      }
    }
  }

  const emotionEntries = Object.entries(emotions) as Array<[EmotionKey, number]>
  for (const [emotion, value] of emotionEntries) {
    const clamped = clamp01(value)
    if (expressionManager) {
      expressionManager.setValue(emotion, clamped)
    }
    if (rigBindings) {
      for (const binding of rigBindings.emotions[emotion]) {
        binding.influences[binding.index] = clamped
      }
    }
  }
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-slate-400">{value.toFixed(step < 0.1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="accent-cyan-300"
      />
    </label>
  )
}

function MetricPill({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'cyan' | 'amber' | 'green' }) {
  const colors = {
    slate: {
      border: 'rgba(148,163,184,0.18)',
      background: 'rgba(15,23,42,0.42)',
      label: '#94a3b8',
      value: '#e2e8f0',
    },
    cyan: {
      border: 'rgba(34,211,238,0.24)',
      background: 'rgba(8,47,73,0.3)',
      label: '#67e8f9',
      value: '#ecfeff',
    },
    amber: {
      border: 'rgba(245,158,11,0.24)',
      background: 'rgba(120,53,15,0.24)',
      label: '#fbbf24',
      value: '#fef3c7',
    },
    green: {
      border: 'rgba(74,222,128,0.24)',
      background: 'rgba(20,83,45,0.24)',
      label: '#86efac',
      value: '#f0fdf4',
    },
  } as const

  const style = colors[tone]
  return (
    <div
      className="rounded-xl border px-3 py-2"
      style={{ borderColor: style.border, background: style.background }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: style.label }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: style.value }}>{value}</div>
    </div>
  )
}

function AvatarStage({
  avatarUrl,
  audioRef,
  audioSrc,
  algorithm,
  fftTuning,
  wLipSyncTuning,
  mouthTimeline,
  intensity,
  crossfadeMs,
  emotions,
  onFrameComputed,
}: {
  avatarUrl: string
  audioRef: React.RefObject<HTMLAudioElement>
  audioSrc: string
  algorithm: LabAlgorithm
  fftTuning: LipSyncTuning
  wLipSyncTuning: WLipSyncTuning
  mouthTimeline: MouthTimeline
  intensity: number
  crossfadeMs: number
  emotions: Record<EmotionKey, number>
  onFrameComputed?: (frame: PreviewFrame) => void
}) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const rigBindingsRef = useRef<RigBindings | null>(null)
  const controllerRef = useRef<LipSyncController | null>(null)
  const wLipSyncRef = useRef<WLipSyncController | null>(null)
  const smoothedWeightsRef = useRef<MouthShapeWeights>(emptyMouthShapeWeights())

  const gltf = useLoader(GLTFLoader, avatarUrl, loader => {
    loader.register(parser => new VRMLoaderPlugin(parser))
  })

  const vrm = gltf.userData.vrm as VRM | undefined

  useEffect(() => {
    controllerRef.current = createLipSyncController()
    wLipSyncRef.current = createWLipSyncController()
    return () => {
      controllerRef.current?.detach()
      controllerRef.current = null
      wLipSyncRef.current?.detach()
      wLipSyncRef.current = null
    }
  }, [])

  useEffect(() => {
    controllerRef.current?.configure(algorithm === 'tuned_fft' ? fftTuning : DEFAULT_LIP_SYNC_TUNING)
  }, [algorithm, fftTuning])

  useEffect(() => {
    wLipSyncRef.current?.configure(algorithm === 'wlipsync_local' ? wLipSyncTuning : DEFAULT_WLIPSYNC_TUNING)
  }, [algorithm, wLipSyncTuning])

  useEffect(() => {
    smoothedWeightsRef.current = emptyMouthShapeWeights()
  }, [algorithm, audioSrc, avatarUrl, mouthTimeline])

  useEffect(() => {
    if (!vrm || !groupRef.current) return

    VRMUtils.rotateVRM0(vrm)
    vrmRef.current = vrm
    rigBindingsRef.current = collectRigBindings(vrm.scene)

    const raf = requestAnimationFrame(() => {
      if (!groupRef.current) return
      const box = new THREE.Box3().setFromObject(groupRef.current)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const focusY = Number((size.y * 0.18).toFixed(3))
      const distance = Math.max(size.x, size.y, size.z) * 1.8
      groupRef.current.position.sub(center)
      camera.position.set(0, focusY, distance)
      camera.lookAt(0, focusY, 0)
      camera.updateProjectionMatrix()
      onFrameComputed?.({
        target: [0, focusY, 0],
        minDistance: Math.max(0.75, distance * 0.36),
        maxDistance: Math.max(2.8, distance * 1.7),
      })
    })

    return () => {
      cancelAnimationFrame(raf)
      vrmRef.current = null
      rigBindingsRef.current = null
    }
  }, [camera, onFrameComputed, vrm])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSrc) return
    if (algorithm !== 'legacy_fft' && algorithm !== 'tuned_fft') return

    let cancelled = false
    void resumeLipSyncContext().then(() => {
      if (cancelled) return
      controllerRef.current?.attachAudio(audio)
    })

    return () => {
      cancelled = true
    }
  }, [algorithm, audioRef, audioSrc])

  useEffect(() => {
    const audio = audioRef.current
    const controller = wLipSyncRef.current
    if (!audio || !audioSrc) return
    if (algorithm !== 'wlipsync_local') {
      controller?.detach()
      return
    }
    if (!controller) return

    let cancelled = false
    void controller.attachAudio(audio).catch(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
      controller.detach()
    }
  }, [algorithm, audioRef, audioSrc])

  useFrame((_, delta) => {
    const currentVrm = vrmRef.current
    if (!currentVrm) return

    currentVrm.update(delta)

    const audio = audioRef.current
    const audioIsPlaying = Boolean(audio && !audio.paused && !audio.ended)
    let targetWeights = emptyMouthShapeWeights()

    if (audioIsPlaying && audio) {
      if ((algorithm === 'eleven_char_timing' || algorithm === 'rhubarb_offline') && mouthTimeline.cues.length > 0) {
        targetWeights = sampleMouthTimeline(mouthTimeline, audio.currentTime, {
          intensity,
          crossfadeSeconds: crossfadeMs / 1000,
        })
      } else if ((algorithm === 'legacy_fft' || algorithm === 'tuned_fft') && controllerRef.current?.isActive) {
        targetWeights = mapLegacyLipSyncStateToWeights(controllerRef.current.update())
      } else if (algorithm === 'wlipsync_local' && wLipSyncRef.current?.isActive) {
        targetWeights = wLipSyncRef.current.update()
      }
    }

    for (const shape of CANONICAL_MOUTH_SHAPES) {
      const next = targetWeights[shape]
      const current = smoothedWeightsRef.current[shape]
      smoothedWeightsRef.current[shape] = THREE.MathUtils.lerp(current, next, 0.24)
    }

    applyRigWeights({
      vrm: currentVrm,
      rigBindings: rigBindingsRef.current,
      mouthWeights: smoothedWeightsRef.current,
      emotions,
    })
  })

  if (!vrm) return null

  return (
    <group ref={groupRef}>
      <primitive object={vrm.scene} />
    </group>
  )
}

export function LipSyncLabPanel({ isOpen, onClose }: LipSyncLabPanelProps) {
  useUILayer('lip-sync-lab', isOpen)

  const bringPanelToFront = useOasisStore(state => state.bringPanelToFront)
  const panelZIndex = useOasisStore(state => state.getPanelZIndex('lip-sync-lab', 9998))

  const [audit, setAudit] = useState<AvatarAuditSummary | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [selectedAvatarPath, setSelectedAvatarPath] = useState(DEFAULT_AVATAR_PATH)
  const [speechRichOnly, setSpeechRichOnly] = useState(false)
  const [algorithm, setAlgorithm] = useState<LabAlgorithm>('tuned_fft')
  const [voice, setVoice] = useState('adam')
  const [text, setText] = useState(DEFAULT_TEXT)
  const [selectedClip, setSelectedClip] = useState<ClipSource | null>(SAMPLE_AUDIO[0])
  const [generatedClips, setGeneratedClips] = useState<ClipSource[]>([])
  const [generateState, setGenerateState] = useState<'idle' | 'loading'>('idle')
  const [generateError, setGenerateError] = useState('')
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [timelineMode, setTimelineMode] = useState<'normalized' | 'raw'>('normalized')
  const [rhubarbRecognizer, setRhubarbRecognizer] = useState<'pocketSphinx' | 'phonetic'>('pocketSphinx')
  const [rhubarbTimelines, setRhubarbTimelines] = useState<Record<string, MouthTimeline>>({})
  const [rhubarbLoading, setRhubarbLoading] = useState(false)
  const [rhubarbError, setRhubarbError] = useState('')
  const [intensity, setIntensity] = useState(0.94)
  const [crossfadeMs, setCrossfadeMs] = useState(70)
  const [fftTuning, setFftTuning] = useState<LipSyncTuning>(() => cloneFftTuning())
  const [wLipSyncTuning, setWLipSyncTuning] = useState<WLipSyncTuning>(() => cloneWLipSyncTuning())
  const [happy, setHappy] = useState(0)
  const [angry, setAngry] = useState(0)
  const [sad, setSad] = useState(0)
  const [surprised, setSurprised] = useState(0)
  const [relaxed, setRelaxed] = useState(0)
  const [previewFrame, setPreviewFrame] = useState<PreviewFrame>({
    target: [0, 0.15, 0],
    minDistance: 1.4,
    maxDistance: 4.2,
  })

  const audioRef = useRef<HTMLAudioElement>(null)
  const orbitRef = useRef<any>(null)

  useEffect(() => {
    if (!isOpen) return
    bringPanelToFront('lip-sync-lab')
  }, [bringPanelToFront, isOpen])

  useEffect(() => {
    if (!isOpen || audit) return

    let cancelled = false
    setAuditLoading(true)
    setAuditError('')

    void fetch(withBasePath('/api/avatars/audit'))
      .then(async response => {
        if (!response.ok) throw new Error('Avatar audit failed')
        return response.json() as Promise<AvatarAuditSummary>
      })
      .then(summary => {
        if (cancelled) return
        setAudit(summary)
      })
      .catch(error => {
        if (cancelled) return
        setAuditError(error instanceof Error ? error.message : 'Avatar audit failed')
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [audit, isOpen])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setLibraryLoading(true)
    setLibraryError('')

    void fetch(withBasePath('/api/media/voice/timestamps'))
      .then(async response => {
        if (!response.ok) throw new Error('Generated voice library failed')
        return response.json() as Promise<GeneratedVoiceLibraryResponse>
      })
      .then(payload => {
        if (cancelled) return
        const clips = Array.isArray(payload.clips) ? payload.clips : []
        setGeneratedClips(clips)
      })
      .catch(error => {
        if (cancelled) return
        setLibraryError(error instanceof Error ? error.message : 'Generated voice library failed')
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  const filteredAvatars = useMemo(() => {
    if (!audit) return []
    return audit.avatars
      .filter(avatar => !speechRichOnly || avatar.speechRig === 'ovr15')
      .sort((left, right) =>
        right.faceRigScore - left.faceRigScore
        || right.ovrCoverage - left.ovrCoverage
        || right.mouthShapeCount - left.mouthShapeCount
        || left.name.localeCompare(right.name),
      )
  }, [audit, speechRichOnly])

  useEffect(() => {
    if (!audit || selectedAvatarPath) return
    const initialCandidate = audit.avatars
      .slice()
      .sort((left, right) =>
        (right.speechRig === 'ovr15' ? 1 : 0) - (left.speechRig === 'ovr15' ? 1 : 0)
        || right.faceRigScore - left.faceRigScore
        || right.mouthShapeCount - left.mouthShapeCount,
      )[0]

    if (initialCandidate) {
      setSelectedAvatarPath(initialCandidate.path)
    }
  }, [audit, selectedAvatarPath])

  useEffect(() => {
    if (!filteredAvatars.length) return
    if (filteredAvatars.some(avatar => avatar.path === selectedAvatarPath)) return
    setSelectedAvatarPath(filteredAvatars[0].path)
  }, [filteredAvatars, selectedAvatarPath])

  const selectedAvatar = useMemo(
    () => audit?.avatars.find(avatar => avatar.path === selectedAvatarPath) || null,
    [audit, selectedAvatarPath],
  )

  const topGeometryAvatars = useMemo(() => {
    if (!audit) return []
    return audit.rankedByFaceRig
      .map(path => audit.avatars.find(avatar => avatar.path === path))
      .filter((avatar): avatar is AvatarAuditRecord => Boolean(avatar))
      .slice(0, 5)
  }, [audit])

  const topSpeechAvatars = useMemo(() => {
    if (!audit) return []
    return audit.rankedBySpeechRig
      .map(path => audit.avatars.find(avatar => avatar.path === path))
      .filter((avatar): avatar is AvatarAuditRecord => Boolean(avatar))
      .slice(0, 5)
  }, [audit])

  const clipDeck = useMemo(
    () => [...SAMPLE_AUDIO, ...generatedClips],
    [generatedClips],
  )

  useEffect(() => {
    if (!clipDeck.length) {
      setSelectedClip(null)
      return
    }

    if (!selectedClip) {
      setSelectedClip(clipDeck[0])
      return
    }

    const replacement = clipDeck.find(clip => clip.id === selectedClip.id)
    if (replacement) {
      if (replacement !== selectedClip) {
        setSelectedClip(replacement)
      }
      return
    }

    setSelectedClip(clipDeck[0])
  }, [clipDeck, selectedClip])

  const activeAlignment = useMemo(() => {
    if (!selectedClip) return null
    if (timelineMode === 'normalized') return selectedClip.normalizedAlignment || selectedClip.alignment
    return selectedClip.alignment || selectedClip.normalizedAlignment
  }, [selectedClip, timelineMode])

  const elevenMouthTimeline = useMemo(
    () => buildCharacterMouthTimeline(activeAlignment),
    [activeAlignment],
  )

  const rhubarbTimeline = useMemo(
    () => (selectedClip ? rhubarbTimelines[selectedClip.id] || null : null),
    [rhubarbTimelines, selectedClip],
  )

  const mouthTimeline = algorithm === 'rhubarb_offline'
    ? (rhubarbTimeline || { cues: [], duration: 0 })
    : elevenMouthTimeline

  const timingReady = algorithm === 'rhubarb_offline'
    ? mouthTimeline.cues.length > 0
    : mouthTimeline.cues.length > 0 && selectedClip?.sourceType === 'generated'
  const selectedAvatarUrl = withBasePath(selectedAvatar?.path || selectedAvatarPath)
  const selectedAudioUrl = selectedClip ? withBasePath(selectedClip.url) : ''

  useEffect(() => {
    const controls = orbitRef.current
    if (!controls) return
    controls.target.set(...previewFrame.target)
    controls.minDistance = previewFrame.minDistance
    controls.maxDistance = previewFrame.maxDistance
    controls.update()
  }, [previewFrame])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    audio.load()
  }, [selectedAudioUrl])

  useEffect(() => {
    if (!isOpen || algorithm !== 'rhubarb_offline' || !selectedClip) return
    if (rhubarbTimelines[selectedClip.id]) return

    let cancelled = false
    setRhubarbLoading(true)
    setRhubarbError('')

    void fetch(withBasePath('/api/lipsync/rhubarb'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clipUrl: selectedClip.url,
        dialogText: selectedClip.text || null,
        recognizer: rhubarbRecognizer,
      }),
    })
      .then(async response => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Rhubarb analysis failed')
        }
        return response.json() as Promise<RhubarbAnalysisResponse>
      })
      .then(payload => {
        if (cancelled) return
        setRhubarbTimelines(current => ({
          ...current,
          [selectedClip.id]: payload.timeline,
        }))
      })
      .catch(error => {
        if (cancelled) return
        setRhubarbError(error instanceof Error ? error.message : 'Rhubarb analysis failed')
      })
      .finally(() => {
        if (!cancelled) setRhubarbLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [algorithm, isOpen, rhubarbRecognizer, rhubarbTimelines, selectedClip])

  useEffect(() => {
    if (algorithm !== 'rhubarb_offline') {
      setRhubarbLoading(false)
    }
  }, [algorithm])

  useEffect(() => {
    setRhubarbTimelines({})
  }, [rhubarbRecognizer])

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  const playCurrent = async () => {
    const audio = audioRef.current
    if (!audio) return
    try {
      await audio.play()
    } catch {
      // Browser autoplay restrictions are okay here.
    }
  }

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      await playCurrent()
    } else {
      audio.pause()
    }
  }

  const stopPlayback = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }

  const selectClip = (clip: ClipSource) => {
    setSelectedClip(clip)
    if (clip.sourceType === 'sample' && algorithm === 'eleven_char_timing') {
      setAlgorithm('tuned_fft')
    }
  }

  const generateVoiceWithTiming = async () => {
    setGenerateState('loading')
    setGenerateError('')

    try {
      const response = await fetch(withBasePath('/api/media/voice/timestamps'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Voice generation failed')
      }

      const payload = await response.json() as GeneratedVoiceResponse
      const clip: ClipSource = {
        id: payload.id,
        label: payload.label,
        url: payload.url,
        sourceType: 'generated',
        text: payload.text,
        voiceId: payload.voiceId,
        createdAt: payload.createdAt,
        alignment: payload.alignment,
        normalizedAlignment: payload.normalizedAlignment,
      }

      setGeneratedClips(current => [
        clip,
        ...current.filter(existing => existing.id !== clip.id),
      ])
      setLibraryError('')
      setSelectedClip(clip)
      setAlgorithm('eleven_char_timing')
      setTimelineMode(payload.normalizedAlignment ? 'normalized' : 'raw')
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Voice generation failed')
    } finally {
      setGenerateState('idle')
    }
  }

  const deleteGeneratedClip = async (clipId: string) => {
    try {
      const response = await fetch(withBasePath(`/api/media/voice/timestamps?id=${encodeURIComponent(clipId)}`), {
        method: 'DELETE',
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to delete generated voice')
      }

      const payload = await response.json() as GeneratedVoiceLibraryResponse
      const clips = Array.isArray(payload.clips) ? payload.clips : []
      setLibraryError('')
      setGeneratedClips(clips)
      setRhubarbTimelines(current => {
        const next = { ...current }
        delete next[clipId]
        return next
      })

      if (selectedClip?.id === clipId) {
        setSelectedClip(SAMPLE_AUDIO[0] || clips[0] || null)
        if (algorithm === 'eleven_char_timing') {
          setAlgorithm('tuned_fft')
        }
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Failed to delete generated voice')
    }
  }

  const emotionWeights = {
    happy,
    angry,
    sad,
    surprised,
    relaxed,
  } satisfies Record<EmotionKey, number>

  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: panelZIndex }}
      onMouseDown={() => bringPanelToFront('lip-sync-lab')}
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
        onClick={onClose}
      />

      <div
        className="absolute left-1/2 top-1/2 flex max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-[28px] border shadow-2xl"
        style={{
          width: DEFAULT_PANEL_WIDTH,
          height: DEFAULT_PANEL_HEIGHT,
          transform: 'translate(-50%, -50%)',
          borderColor: 'rgba(34,211,238,0.22)',
          background: 'linear-gradient(180deg, rgba(3,7,18,0.98), rgba(8,15,30,0.96))',
          boxShadow: '0 30px 120px rgba(0,0,0,0.6)',
        }}
        onClick={event => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-4 border-b px-6 py-5"
          style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.82)' }}
        >
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-300">Lip Sync Lab</div>
            <div className="mt-1 text-xl font-semibold text-slate-100">
              Sandbox the next mouth-shape pipeline without touching the live one
            </div>
            <div className="mt-1 text-sm text-slate-400">
              Text to MP3 plus timing data, avatar audit, richer hidden face sliders, and quick A/B with the current FFT path.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border px-3 py-2 text-right" style={{ borderColor: 'rgba(34,211,238,0.18)', background: 'rgba(8,47,73,0.26)' }}>
              <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300">Audit</div>
              <div className="mt-1 text-sm font-medium text-cyan-50">
                {audit ? `${audit.avatars.length} VRMs scanned` : auditLoading ? 'scanning...' : 'pending'}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl border px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5"
              style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.52)' }}
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[1.2fr_0.95fr]">
          <div className="flex min-h-0 flex-col border-r" style={{ borderColor: 'rgba(148,163,184,0.1)' }}>
            <div className="flex items-center justify-between gap-3 px-6 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Preview Stage</div>
                <div className="mt-1 text-base font-semibold text-slate-100">{selectedAvatar?.name || 'Loading avatar...'}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <MetricPill label="Speech rig" value={selectedAvatar ? speechRigLabel(selectedAvatar.speechRig) : 'pending'} tone="cyan" />
                <MetricPill label="Rig score" value={selectedAvatar ? `${selectedAvatar.faceRigScore}` : '--'} tone="amber" />
                <MetricPill label="Mouth" value={selectedAvatar ? `${selectedAvatar.mouthShapeCount}` : '--'} tone="green" />
                <MetricPill label="Emotion" value={selectedAvatar ? `${selectedAvatar.emotionGroupCount}` : '--'} tone="slate" />
              </div>
            </div>

            <div className="min-h-0 flex-1 px-6 pb-4">
              <div
                className="h-full min-h-[360px] overflow-hidden rounded-[24px] border"
                style={{ borderColor: 'rgba(34,211,238,0.16)', background: 'rgba(2,6,23,0.6)' }}
                onContextMenu={event => event.preventDefault()}
              >
                {selectedAvatarUrl ? (
                  <Canvas camera={{ position: [0, 0.1, 2.6], fov: 34 }}>
                    <color attach="background" args={['#050b16']} />
                    <ambientLight intensity={1.2} />
                    <directionalLight intensity={2.2} position={[3, 4, 4]} />
                    <directionalLight intensity={0.7} position={[-2, 2, -2]} color="#88c7ff" />
                    <Suspense fallback={null}>
                      <StudioBackdrop imageUrl={DEFAULT_BACKDROP} />
                      <AvatarStage
                        avatarUrl={selectedAvatarUrl}
                        audioRef={audioRef}
                        audioSrc={selectedAudioUrl}
                        algorithm={algorithm}
                        fftTuning={fftTuning}
                        wLipSyncTuning={wLipSyncTuning}
                        mouthTimeline={mouthTimeline}
                        intensity={intensity}
                        crossfadeMs={crossfadeMs}
                        emotions={emotionWeights}
                        onFrameComputed={setPreviewFrame}
                      />
                    </Suspense>
                    <OrbitControls
                      ref={orbitRef}
                      enablePan
                      minDistance={previewFrame.minDistance}
                      maxDistance={previewFrame.maxDistance}
                      mouseButtons={{
                        LEFT: THREE.MOUSE.ROTATE,
                        MIDDLE: THREE.MOUSE.DOLLY,
                        RIGHT: THREE.MOUSE.PAN,
                      }}
                    />
                  </Canvas>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading avatar preview...</div>
                )}
              </div>
            </div>

            <div className="border-t px-6 py-4" style={{ borderColor: 'rgba(148,163,184,0.1)' }}>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Clip Deck</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {clipDeck.map(clip => {
                  const isSelected = selectedClip?.id === clip.id
                  const isGenerated = clip.sourceType === 'generated'

                  return (
                    <div
                      key={clip.id}
                      className="flex items-center overflow-hidden rounded-xl border text-sm transition-colors"
                      style={{
                        borderColor: isSelected
                          ? (isGenerated ? 'rgba(74,222,128,0.42)' : 'rgba(34,211,238,0.42)')
                          : 'rgba(148,163,184,0.16)',
                        background: isSelected
                          ? (isGenerated ? 'rgba(20,83,45,0.34)' : 'rgba(8,47,73,0.42)')
                          : 'rgba(15,23,42,0.42)',
                        color: isSelected ? (isGenerated ? '#dcfce7' : '#cffafe') : '#cbd5e1',
                      }}
                    >
                      <button
                        onClick={() => selectClip(clip)}
                        className="px-3 py-2 text-left"
                        title={clip.text || clip.label}
                      >
                        {clip.label}
                      </button>
                      {isGenerated ? (
                        <button
                          onClick={event => {
                            event.stopPropagation()
                            void deleteGeneratedClip(clip.id)
                          }}
                          className="border-l px-2 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10"
                          style={{ borderColor: 'rgba(148,163,184,0.14)' }}
                          title="Delete generated voice"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void togglePlayback()}
                  className="rounded-xl border px-4 py-2 text-sm font-medium text-slate-100"
                  style={{ borderColor: 'rgba(34,211,238,0.26)', background: 'rgba(8,47,73,0.34)' }}
                >
                  Play / Pause
                </button>
                <button
                  onClick={stopPlayback}
                  className="rounded-xl border px-4 py-2 text-sm font-medium text-slate-200"
                  style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.42)' }}
                >
                  Stop
                </button>
                <div className="text-sm text-slate-400">
                  {selectedClip ? selectedClip.label : 'No clip loaded'}
                  {timingReady ? ` · ${mouthTimeline.cues.length} timed mouth cues` : ''}
                </div>
              </div>

              <audio ref={audioRef} controls className="mt-3 w-full" src={selectedAudioUrl || undefined} preload="auto" />

              <div className="mt-3 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.4)', color: '#cbd5e1' }}>
                {algorithm === 'eleven_char_timing' && !timingReady
                  ? 'The Eleven timing lane only lights up on generated clips, because sample MP3s do not come with timing data yet.'
                  : algorithm === 'wlipsync_local'
                    ? 'wLipSync is a browser-local detector using an upstream starter profile. It should feel much more alive than Rhubarb, but the final quality still depends on profile tuning.'
                  : algorithm === 'rhubarb_offline' && rhubarbLoading
                    ? 'Rhubarb is listening to the clip now and building an offline mouth-cue timeline.'
                    : 'The stage uses raw hidden mouth sliders when a VRM exposes them, and falls back to the standard five mouth presets when it does not. Right-drag pans the pivot so you can zoom into the head.'}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="grid gap-5">
              <section className="rounded-[24px] border p-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Avatar Audit</div>
                    <div className="mt-1 text-base font-semibold text-slate-100">Pick the test subject</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={speechRichOnly}
                      onChange={event => setSpeechRichOnly(event.target.checked)}
                    />
                    OVR-rich only
                  </label>
                </div>

                <div className="mt-4">
                  <select
                    value={selectedAvatarPath}
                    onChange={event => setSelectedAvatarPath(event.target.value)}
                    className="w-full rounded-2xl border px-4 py-3 text-sm text-slate-100"
                    style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                  >
                    {filteredAvatars.map(avatar => (
                      <option key={avatar.path} value={avatar.path}>
                        {avatar.name} · rig {avatar.faceRigScore} · mouth {avatar.mouthShapeCount} · emo {avatar.emotionGroupCount} · eyes {avatar.eyeLookGroupCount}
                      </option>
                    ))}
                  </select>
                </div>

                {auditLoading ? (
                  <div className="mt-4 text-sm text-slate-400">Scanning avatar gallery...</div>
                ) : auditError ? (
                  <div className="mt-4 text-sm text-rose-300">{auditError}</div>
                ) : selectedAvatar ? (
                  <div className="mt-4 grid gap-3">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <MetricPill label="Rig score" value={`${selectedAvatar.faceRigScore}`} tone="amber" />
                      <MetricPill label="Mouth shapes" value={`${selectedAvatar.mouthShapeCount}`} tone="cyan" />
                      <MetricPill label="Emotion groups" value={`${selectedAvatar.emotionGroupCount}`} tone="slate" />
                      <MetricPill label="Eye/look groups" value={`${selectedAvatar.eyeLookGroupCount}`} tone="green" />
                      <MetricPill label="Raw mouth sliders" value={`${selectedAvatar.rawMorphTargetCount}`} tone="cyan" />
                      <MetricPill label="Named expressions" value={`${selectedAvatar.expressionCount}`} tone="amber" />
                      <MetricPill label="OVR coverage" value={`${selectedAvatar.ovrCoverage}/15`} tone="green" />
                      <MetricPill label="VRM vowel coverage" value={`${selectedAvatar.vrmCoverage}/5`} tone="slate" />
                    </div>

                    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(15,23,42,0.42)' }}>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Head anatomy hints</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(selectedAvatar.anatomyTags.length ? selectedAvatar.anatomyTags : ['no obvious inner-mouth metadata']).map(name => (
                          <span
                            key={name}
                            className="rounded-full border px-2.5 py-1 text-xs"
                            style={{ borderColor: 'rgba(74,222,128,0.22)', background: 'rgba(20,83,45,0.22)', color: '#dcfce7' }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'rgba(148,163,184,0.12)', background: 'rgba(15,23,42,0.42)' }}>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Speech targets found</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(selectedAvatar.speechTargetNames.length ? selectedAvatar.speechTargetNames : ['No speech targets detected']).slice(0, 20).map(name => (
                          <span
                            key={name}
                            className="rounded-full border px-2.5 py-1 text-xs"
                            style={{ borderColor: 'rgba(34,211,238,0.22)', background: 'rgba(8,47,73,0.22)', color: '#cffafe' }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="rounded-[24px] border p-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)' }}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Text to MP3 + timing</div>
                <div className="mt-1 text-base font-semibold text-slate-100">Generate a timed line with ElevenLabs</div>

                <textarea
                  value={text}
                  onChange={event => setText(event.target.value)}
                  rows={4}
                  className="mt-4 w-full rounded-2xl border px-4 py-3 text-sm text-slate-100"
                  style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                />

                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                  <select
                    value={voice}
                    onChange={event => setVoice(event.target.value)}
                    className="rounded-2xl border px-4 py-3 text-sm text-slate-100"
                    style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                  >
                    <option value="adam">Adam</option>
                    <option value="rachel">Rachel</option>
                    <option value="sam">Sam</option>
                    <option value="elli">Elli</option>
                    <option value="merlin">Merlin</option>
                  </select>

                  <button
                    onClick={() => void generateVoiceWithTiming()}
                    disabled={generateState === 'loading' || !text.trim()}
                    className="rounded-2xl border px-5 py-3 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ borderColor: 'rgba(74,222,128,0.28)', background: 'rgba(20,83,45,0.36)' }}
                  >
                    {generateState === 'loading' ? 'Generating...' : 'Generate with timing'}
                  </button>
                </div>

                {generateError ? <div className="mt-3 text-sm text-rose-300">{generateError}</div> : null}
                {libraryError ? <div className="mt-2 text-sm text-rose-300">{libraryError}</div> : null}
                <div className="mt-3 text-sm text-slate-400">
                  {libraryLoading
                    ? 'Refreshing the generated voice shelf...'
                    : `${generatedClips.length} generated clip${generatedClips.length === 1 ? '' : 's'} persist across refreshes so we can build a practice library.`}
                </div>
              </section>

              <section className="rounded-[24px] border p-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)' }}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Algorithm Rack</div>
                <div className="mt-1 text-base font-semibold text-slate-100">Swap the mouth-shape driver</div>

                <div className="mt-4 grid gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Active algorithm</span>
                    <select
                      value={algorithm}
                      onChange={event => setAlgorithm(event.target.value as LabAlgorithm)}
                      className="rounded-2xl border px-4 py-3 text-sm text-slate-100"
                      style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                    >
                      <option value="eleven_char_timing">Eleven timing baseline (character to mouth shape)</option>
                      <option value="wlipsync_local">wLipSync local (browser MFCC realtime)</option>
                      <option value="rhubarb_offline">Rhubarb offline (MP3/OGG to mouth cues)</option>
                      <option value="legacy_fft">Legacy FFT (current Oasis path)</option>
                      <option value="tuned_fft">FFT++ sandbox (tunable realtime heuristic)</option>
                    </select>
                  </label>

                  <div className="grid gap-3 md:grid-cols-2">
                    <RangeControl label="Speech intensity" value={intensity} min={0} max={1.25} step={0.01} onChange={setIntensity} />
                    <RangeControl label="Crossfade ms" value={crossfadeMs} min={10} max={220} step={1} onChange={setCrossfadeMs} />
                  </div>

                  {algorithm === 'tuned_fft' ? (
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(34,211,238,0.18)', background: 'rgba(8,47,73,0.18)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">FFT++ controls</div>
                          <div className="mt-1 text-sm text-slate-300">Realtime heuristic tuning for jaw, vowels, and consonant energy.</div>
                        </div>
                        <button
                          onClick={() => setFftTuning(cloneFftTuning())}
                          className="rounded-xl border px-3 py-2 text-xs font-semibold text-cyan-50"
                          style={{ borderColor: 'rgba(34,211,238,0.24)', background: 'rgba(8,47,73,0.32)' }}
                        >
                          Reset defaults
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3">
                        <label className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-300">
                            <span>FFT resolution</span>
                            <span className="font-mono text-slate-400">{fftTuning.fftSize}</span>
                          </div>
                          <select
                            value={fftTuning.fftSize}
                            onChange={event => setFftTuning(current => ({ ...current, fftSize: Number(event.target.value) }))}
                            className="rounded-2xl border px-4 py-3 text-sm text-slate-100"
                            style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                          >
                            {[128, 256, 512, 1024, 2048].map(size => (
                              <option key={size} value={size}>{size}</option>
                            ))}
                          </select>
                        </label>

                        <div className="grid gap-3 md:grid-cols-2">
                          <RangeControl label="Analyser smoothing" value={fftTuning.analyserSmoothing} min={0} max={0.95} step={0.01} onChange={next => setFftTuning(current => ({ ...current, analyserSmoothing: next }))} />
                          <RangeControl label="Silence gate" value={fftTuning.silenceGate} min={0} max={0.3} step={0.005} onChange={next => setFftTuning(current => ({ ...current, silenceGate: next }))} />
                          <RangeControl label="Response smoothing" value={fftTuning.smoothFactor} min={0.05} max={0.8} step={0.01} onChange={next => setFftTuning(current => ({ ...current, smoothFactor: next }))} />
                          <RangeControl label="Mouth open cap" value={fftTuning.mouthOpenCap} min={0.2} max={1} step={0.01} onChange={next => setFftTuning(current => ({ ...current, mouthOpenCap: next }))} />
                          <RangeControl label="Jaw / aa gain" value={fftTuning.aaGain} min={0} max={2} step={0.01} onChange={next => setFftTuning(current => ({ ...current, aaGain: next }))} />
                          <RangeControl label="Round / oh gain" value={fftTuning.ohGain} min={0} max={2} step={0.01} onChange={next => setFftTuning(current => ({ ...current, ohGain: next }))} />
                          <RangeControl label="Smile / ee gain" value={fftTuning.eeGain} min={0} max={2} step={0.01} onChange={next => setFftTuning(current => ({ ...current, eeGain: next }))} />
                          <RangeControl label="Pursed / ou gain" value={fftTuning.ouGain} min={0} max={2} step={0.01} onChange={next => setFftTuning(current => ({ ...current, ouGain: next }))} />
                          <RangeControl label="Sibilant / ih gain" value={fftTuning.ihGain} min={0} max={2.5} step={0.01} onChange={next => setFftTuning(current => ({ ...current, ihGain: next }))} />
                          <RangeControl label="EE / OO split" value={fftTuning.eeOuSplit} min={0.15} max={0.85} step={0.01} onChange={next => setFftTuning(current => ({ ...current, eeOuSplit: next }))} />
                          <RangeControl label="EE low-bias" value={fftTuning.eeLowBias} min={0} max={1} step={0.01} onChange={next => setFftTuning(current => ({ ...current, eeLowBias: next }))} />
                          <RangeControl label="OO high-bias" value={fftTuning.ouHighBias} min={0} max={1} step={0.01} onChange={next => setFftTuning(current => ({ ...current, ouHighBias: next }))} />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {algorithm === 'wlipsync_local' ? (
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(56,189,248,0.22)', background: 'rgba(12,74,110,0.2)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-sky-300">wLipSync controls</div>
                          <div className="mt-1 text-sm text-slate-300">
                            Local WebAudio + WASM MFCC detector. This lane reacts live while the clip plays and does not wait for a server round-trip.
                          </div>
                        </div>
                        <button
                          onClick={() => setWLipSyncTuning(cloneWLipSyncTuning())}
                          className="rounded-xl border px-3 py-2 text-xs font-semibold text-sky-50"
                          style={{ borderColor: 'rgba(56,189,248,0.24)', background: 'rgba(12,74,110,0.34)' }}
                        >
                          Reset defaults
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <RangeControl
                          label="Min volume gate"
                          value={wLipSyncTuning.minVolume}
                          min={-4}
                          max={-0.4}
                          step={0.01}
                          onChange={next => setWLipSyncTuning(current => ({ ...current, minVolume: next }))}
                        />
                        <RangeControl
                          label="Max volume ceiling"
                          value={wLipSyncTuning.maxVolume}
                          min={-3}
                          max={0.2}
                          step={0.01}
                          onChange={next => setWLipSyncTuning(current => ({ ...current, maxVolume: next }))}
                        />
                        <RangeControl
                          label="Detector smoothness"
                          value={wLipSyncTuning.smoothness}
                          min={0.005}
                          max={0.25}
                          step={0.005}
                          onChange={next => setWLipSyncTuning(current => ({ ...current, smoothness: next }))}
                        />
                      </div>
                    </div>
                  ) : null}

                  {algorithm === 'rhubarb_offline' ? (
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(74,222,128,0.2)', background: 'rgba(20,83,45,0.18)' }}>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">Rhubarb controls</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Local offline analyzer for prerecorded clips. Generated lines use their original text as transcript hints automatically.
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Recognizer</span>
                          <select
                            value={rhubarbRecognizer}
                            onChange={event => setRhubarbRecognizer(event.target.value as 'pocketSphinx' | 'phonetic')}
                            className="rounded-2xl border px-4 py-3 text-sm text-slate-100"
                            style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                          >
                            <option value="pocketSphinx">PocketSphinx (English)</option>
                            <option value="phonetic">Phonetic (language-agnostic)</option>
                          </select>
                        </label>

                        <button
                          onClick={() => {
                            if (!selectedClip) return
                            setRhubarbTimelines(current => {
                              const next = { ...current }
                              delete next[selectedClip.id]
                              return next
                            })
                          }}
                          disabled={!selectedClip || rhubarbLoading}
                          className="self-end rounded-2xl border px-4 py-3 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ borderColor: 'rgba(74,222,128,0.28)', background: 'rgba(20,83,45,0.32)' }}
                        >
                          {rhubarbLoading ? 'Analyzing...' : 'Re-run Rhubarb'}
                        </button>
                      </div>

                      {rhubarbError ? <div className="mt-3 text-sm text-rose-300">{rhubarbError}</div> : null}
                      {!rhubarbError && selectedClip && rhubarbTimelines[selectedClip.id] ? (
                        <div className="mt-3 text-sm text-emerald-100">
                          Rhubarb found {rhubarbTimelines[selectedClip.id].cues.length} mouth cues for this clip.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedClip?.sourceType === 'generated' ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Timing dataset</span>
                      <select
                        value={timelineMode}
                        onChange={event => setTimelineMode(event.target.value as 'normalized' | 'raw')}
                        className="rounded-2xl border px-4 py-3 text-sm text-slate-100"
                        style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)' }}
                      >
                        <option value="normalized">Normalized alignment</option>
                        <option value="raw">Raw alignment</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              </section>

              <section className="rounded-[24px] border p-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)' }}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Emotion Layer</div>
                <div className="mt-1 text-base font-semibold text-slate-100">Upper-face mood overlay</div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <RangeControl label="Happy" value={happy} min={0} max={1} step={0.01} onChange={setHappy} />
                  <RangeControl label="Angry" value={angry} min={0} max={1} step={0.01} onChange={setAngry} />
                  <RangeControl label="Sad" value={sad} min={0} max={1} step={0.01} onChange={setSad} />
                  <RangeControl label="Surprised" value={surprised} min={0} max={1} step={0.01} onChange={setSurprised} />
                  <RangeControl label="Relaxed" value={relaxed} min={0} max={1} step={0.01} onChange={setRelaxed} />
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-[24px] border p-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)' }}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Top face-rig picks</div>
                  <div className="mt-3 grid gap-2">
                    {topGeometryAvatars.map(avatar => (
                      <button
                        key={avatar.path}
                        onClick={() => setSelectedAvatarPath(avatar.path)}
                        className="flex items-center justify-between rounded-2xl border px-3 py-2 text-left text-sm"
                        style={{
                          borderColor: selectedAvatarPath === avatar.path ? 'rgba(34,211,238,0.3)' : 'rgba(148,163,184,0.12)',
                          background: selectedAvatarPath === avatar.path ? 'rgba(8,47,73,0.24)' : 'rgba(15,23,42,0.32)',
                        }}
                      >
                        <span className="text-slate-100">{avatar.name}</span>
                        <span className="text-slate-400">rig {avatar.faceRigScore} · mouth {avatar.mouthShapeCount} · emo {avatar.emotionGroupCount}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border p-5" style={{ borderColor: 'rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)' }}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Top speech-rig picks</div>
                  <div className="mt-3 grid gap-2">
                    {topSpeechAvatars.map(avatar => (
                      <button
                        key={avatar.path}
                        onClick={() => setSelectedAvatarPath(avatar.path)}
                        className="flex items-center justify-between rounded-2xl border px-3 py-2 text-left text-sm"
                        style={{
                          borderColor: selectedAvatarPath === avatar.path ? 'rgba(74,222,128,0.28)' : 'rgba(148,163,184,0.12)',
                          background: selectedAvatarPath === avatar.path ? 'rgba(20,83,45,0.24)' : 'rgba(15,23,42,0.32)',
                        }}
                      >
                        <span className="text-slate-100">{avatar.name}</span>
                        <span className="text-slate-400">{speechRigLabel(avatar.speechRig)} · {avatar.ovrCoverage}/15 · eyes {avatar.eyeLookGroupCount}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

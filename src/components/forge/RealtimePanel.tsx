'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import {
  createLipSyncController,
  registerLipSync,
  resumeLipSyncContext,
  unregisterLipSync,
  type LipSyncController,
} from '@/lib/lip-sync'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { getCameraSnapshot } from '@/lib/camera-bridge'
import { getLiveObjectTransform } from '@/lib/live-object-transforms'
import { PLAYER_AVATAR_LIPSYNC_ID, getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { useOasisStore } from '@/store/oasisStore'
import {
  REALTIME_AGENT_TYPE,
  REALTIME_MODELS,
  REALTIME_VAD_EAGERNESS,
  REALTIME_VAD_MODES,
  REALTIME_VOICES,
  clampRealtimePanelSettings,
  type RealtimeLocalSession,
  type RealtimePanelSize,
  type RealtimePanelSettings,
  type RealtimeSessionSettings,
  type RealtimeTranscriptMessage,
  type RealtimeVadEagerness,
  type RealtimeVadMode,
  type RealtimeVoiceConfigPayload,
  type RealtimeVoiceSessionPayload,
} from '@/lib/realtime-voice'
import {
  deleteRealtimeSession,
  hydrateRealtimeStore,
  listRealtimeSessions,
  readActiveRealtimeSessionId,
  readRealtimePanelPosition,
  readRealtimePanelSize,
  readRealtimePanelSettings,
  upsertRealtimeSession,
  writeActiveRealtimeSessionId,
  writeRealtimePanelPosition,
  writeRealtimePanelSize,
  writeRealtimePanelSettings,
} from '@/lib/realtime-session-store'
import { createWLipSyncLegacyController } from '@/lib/wlipsync-driver'

interface RealtimePanelProps {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'
type AssistantSource = 'audio' | 'text'
const CANCELLED_CONNECT = '__realtime_connect_cancelled__'

const MIN_PANEL_WIDTH = 400
const MIN_PANEL_HEIGHT = 420
const HEADER_HEIGHT = 56
const MIN_DRAG_Y = 24
const RESIZE_HANDLE_SIZE = 22
const REALTIME_PROMPT_VERSION_MARKER = 'merlin-realtime-v3'
const LEGACY_NO_TOOLS_MARKERS = [
  'do **not** have tools',
  "hands aren't wired in yet",
  "don't have tools wired in",
  'do not have tools',
]
const REALTIME_TOOL_NAMES = new Set([
  'get_world_info',
  'get_world_state',
  'search_assets',
  'place_object',
  'get_craft_guide',
  'craft_scene',
  'get_craft_job',
  'walk_avatar_to',
])

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatSessionCounts(session: RealtimeLocalSession): string {
  const userCount = session.messages.filter(message => message.role === 'user').length
  const assistantCount = session.messages.filter(message => message.role === 'assistant').length
  return `${userCount}u/${assistantCount}a`
}

function shouldUpgradeLegacyInstructions(value: string): boolean {
  const lower = value.toLowerCase()
  return !lower.includes(REALTIME_PROMPT_VERSION_MARKER)
    || LEGACY_NO_TOOLS_MARKERS.some(marker => lower.includes(marker))
}

function buildReplayHistory(messages: RealtimeTranscriptMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((message): message is RealtimeTranscriptMessage & { role: 'user' | 'assistant' } =>
      (message.role === 'user' || message.role === 'assistant') && Boolean(message.content.trim()),
    )
    .filter(message => {
      if (message.role !== 'assistant') return true
      return !shouldUpgradeLegacyInstructions(message.content)
    })
    .map(message => ({
      role: message.role,
      content: message.content.trim(),
    }))
}

function summarizeJson(value: unknown, maxLength = 260): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (!raw) return ''
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 3)}...` : raw
}

function gainFromDb(db: number): number {
  return Math.pow(10, db / 20)
}

function setAudioPosition(node: PannerNode | AudioListener, position: [number, number, number]) {
  const modernNode = node as PannerNode & AudioListener & {
    positionX?: AudioParam
    positionY?: AudioParam
    positionZ?: AudioParam
    setPosition?: (x: number, y: number, z: number) => void
  }
  if (modernNode.positionX && modernNode.positionY && modernNode.positionZ) {
    modernNode.positionX.value = position[0]
    modernNode.positionY.value = position[1]
    modernNode.positionZ.value = position[2]
    return
  }
  modernNode.setPosition?.(position[0], position[1], position[2])
}

function setAudioOrientation(node: AudioListener, forward: [number, number, number], up: [number, number, number] = [0, 1, 0]) {
  const modernNode = node as AudioListener & {
    forwardX?: AudioParam
    forwardY?: AudioParam
    forwardZ?: AudioParam
    upX?: AudioParam
    upY?: AudioParam
    upZ?: AudioParam
    setOrientation?: (x: number, y: number, z: number, upX: number, upY: number, upZ: number) => void
  }
  if (modernNode.forwardX && modernNode.forwardY && modernNode.forwardZ && modernNode.upX && modernNode.upY && modernNode.upZ) {
    modernNode.forwardX.value = forward[0]
    modernNode.forwardY.value = forward[1]
    modernNode.forwardZ.value = forward[2]
    modernNode.upX.value = up[0]
    modernNode.upY.value = up[1]
    modernNode.upZ.value = up[2]
    return
  }
  modernNode.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2])
}

function formatSessionLabel(session: RealtimeLocalSession): string {
  const date = new Date(session.updatedAt)
  const time = Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : session.title
  return `${session.title} · ${time}`
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.trim()
  const expanded = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized
  const parts = expanded.match(/[0-9a-f]{2}/gi)?.map(part => parseInt(part, 16))
  if (!parts || parts.length < 3) return [20, 9, 31]
  return [parts[0], parts[1], parts[2]]
}

function buildNewSession(args: {
  worldId: string
  worldName: string
  settings: RealtimeSessionSettings
}): RealtimeLocalSession {
  const now = Date.now()
  return {
    id: makeId('realtime'),
    title: `Realtime ${new Date(now).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
    createdAt: now,
    updatedAt: now,
    worldId: args.worldId,
    worldName: args.worldName,
    settings: args.settings,
    messages: [
      {
        id: makeId('system'),
        role: 'system',
        content: `New realtime voice session for ${args.worldName}.`,
        status: 'done',
        timestamp: now,
      },
    ],
  }
}

function messageTone(role: RealtimeTranscriptMessage['role']) {
  switch (role) {
    case 'assistant':
      return {
        border: 'rgba(168,85,247,0.28)',
        background: 'rgba(88,28,135,0.16)',
        label: '#d8b4fe',
      }
    case 'user':
      return {
        border: 'rgba(34,211,238,0.26)',
        background: 'rgba(8,51,68,0.2)',
        label: '#67e8f9',
      }
    case 'tool':
      return {
        border: 'rgba(250,204,21,0.24)',
        background: 'rgba(91,33,182,0.08)',
        label: '#fcd34d',
      }
    default:
      return {
        border: 'rgba(148,163,184,0.22)',
        background: 'rgba(15,23,42,0.28)',
        label: '#cbd5e1',
      }
  }
}

function CallStatusBadge({ state, listening, speaking }: { state: ConnectionState; listening: boolean; speaking: boolean }) {
  const label = state === 'connecting'
    ? 'connecting'
    : state === 'connected'
      ? speaking
        ? 'speaking'
        : listening
          ? 'listening'
          : 'live'
      : state === 'error'
        ? 'error'
        : 'idle'
  const styles = state === 'error'
    ? { color: '#fda4af', border: 'rgba(244,63,94,0.32)', background: 'rgba(127,29,29,0.22)' }
    : state === 'connected'
      ? { color: '#6ee7b7', border: 'rgba(16,185,129,0.28)', background: 'rgba(6,78,59,0.2)' }
      : state === 'connecting'
        ? { color: '#fbbf24', border: 'rgba(245,158,11,0.28)', background: 'rgba(120,53,15,0.18)' }
        : { color: '#cbd5e1', border: 'rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.22)' }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.16em]"
      style={{ color: styles.color, borderColor: styles.border, background: styles.background }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: styles.color }} />
      {label}
    </span>
  )
}

export function RealtimePanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
}: RealtimePanelProps) {
  useUILayer('realtime', isOpen && !embedded)

  const [config, setConfig] = useState<RealtimeVoiceConfigPayload | null>(null)
  const [configError, setConfigError] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [position, setPosition] = useState(() => readRealtimePanelPosition())
  const [size, setSize] = useState<RealtimePanelSize>(() => readRealtimePanelSize())
  const [panelSettings, setPanelSettings] = useState<RealtimePanelSettings>(() => readRealtimePanelSettings())
  const [sessions, setSessions] = useState<RealtimeLocalSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [messages, setMessages] = useState<RealtimeTranscriptMessage[]>([])
  const [sessionSettings, setSessionSettings] = useState<RealtimeSessionSettings | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [connectionDetail, setConnectionDetail] = useState('Voice line dormant.')
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const bringPanelToFront = useOasisStore(state => state.bringPanelToFront)
  const panelZIndex = useOasisStore(state => state.getPanelZIndex('realtime', 9998))
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const activeWorldName = useOasisStore(state => state.worldRegistry.find(world => world.id === state.activeWorldId)?.name || 'Current world')
  const realtimeAvatar = useOasisStore(state => state.placedAgentAvatars.find(entry => entry.agentType === REALTIME_AGENT_TYPE) || null)
  const transforms = useOasisStore(state => state.transforms)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lipSyncRef = useRef<LipSyncController | null>(null)
  const localMicLipSyncRef = useRef<LipSyncController | null>(null)
  const outputAudioContextRef = useRef<AudioContext | null>(null)
  const outputAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const outputGainNodeRef = useRef<GainNode | null>(null)
  const outputPannerNodeRef = useRef<PannerNode | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const assistantMessageIdRef = useRef<string>('')
  const userMessageByItemIdRef = useRef<Map<string, string>>(new Map())
  const pendingUserMessageIdRef = useRef<string>('')
  const assistantSourceByResponseRef = useRef<Map<string, AssistantSource>>(new Map())
  const toolMessageByCallIdRef = useRef<Map<string, string>>(new Map())
  const toolStartedAtRef = useRef<Map<string, number>>(new Map())
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null)
  const connectAttemptRef = useRef(0)
  const peerReadyRef = useRef(false)
  const dataChannelReadyRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const [expandedToolIds, setExpandedToolIds] = useState<string[]>([])
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const selectedSession = useMemo(
    () => sessions.find(session => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  )

  const applySession = useCallback((session: RealtimeLocalSession | null) => {
    if (!session) return
    setSelectedSessionId(session.id)
    setMessages(session.messages)
    setSessionSettings(session.settings)
    setExpandedToolIds([])
    writeActiveRealtimeSessionId(session.id)
  }, [])

  const persistSession = useCallback((updater: (session: RealtimeLocalSession) => RealtimeLocalSession) => {
    setSessions(current => {
      const next = current.map(session => session.id === selectedSessionId ? updater(session) : session)
      const updated = next.find(session => session.id === selectedSessionId) || null
      if (updated) {
        upsertRealtimeSession(updated)
      }
      return next.sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [selectedSessionId])

  const updateMessage = useCallback((messageId: string, updater: (message: RealtimeTranscriptMessage) => RealtimeTranscriptMessage) => {
    setMessages(current => {
      const next = current.map(message => message.id === messageId ? updater(message) : message)
      persistSession(session => ({
        ...session,
        messages: next.slice(-160),
        updatedAt: Date.now(),
      }))
      return next
    })
  }, [persistSession])

  const appendMessage = useCallback((message: RealtimeTranscriptMessage) => {
    setMessages(current => {
      const next = [...current, message].slice(-160)
      persistSession(session => ({
        ...session,
        messages: next,
        updatedAt: Date.now(),
      }))
      return next
    })
  }, [persistSession])

  const appendSystemMessage = useCallback((content: string) => {
    appendMessage({
      id: makeId('system'),
      role: 'system',
      content,
      status: 'done',
      timestamp: Date.now(),
    })
  }, [appendMessage])

  const scrollTranscriptToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    autoScrollRef.current = true
    setShowJumpToLatest(false)
  }, [])

  const toggleToolExpanded = useCallback((messageId: string) => {
    setExpandedToolIds(current =>
      current.includes(messageId)
        ? current.filter(id => id !== messageId)
        : [...current, messageId],
    )
  }, [])

  const ensureOutputAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') return null
    let ctx = outputAudioContextRef.current
    if (!ctx || ctx.state === 'closed') {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      outputAudioContextRef.current = ctx
    }
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }
    return ctx
  }, [])

  const applyPlaybackGain = useCallback(() => {
    if (outputGainNodeRef.current) {
      outputGainNodeRef.current.gain.value = gainFromDb(panelSettings.gainDb)
    }
  }, [panelSettings.gainDb])

  const syncSpatialAudioFrame = useCallback(() => {
    const ctx = outputAudioContextRef.current
    const panner = outputPannerNodeRef.current
    if (!ctx || !panner || !panelSettings.spatialAudioEnabled) return

    const listenerSource = getCameraSnapshot() || (() => {
      const pose = getPlayerAvatarPose()
      return pose ? { position: pose.position, forward: pose.forward } : null
    })()

    if (listenerSource) {
      setAudioPosition(ctx.listener, listenerSource.position)
      setAudioOrientation(ctx.listener, listenerSource.forward)
    }

    const liveTransform = realtimeAvatar?.id
      ? (getLiveObjectTransform(realtimeAvatar.id) || transforms[realtimeAvatar.id])
      : null
    const sourcePosition = Array.isArray(liveTransform?.position) && liveTransform.position.length >= 3
      ? [Number(liveTransform.position[0]), Number(liveTransform.position[1]) + 1.45, Number(liveTransform.position[2])] as [number, number, number]
      : realtimeAvatar
        ? [realtimeAvatar.position[0], realtimeAvatar.position[1] + 1.45, realtimeAvatar.position[2]] as [number, number, number]
        : listenerSource?.position || [0, 1.45, 0]

    setAudioPosition(panner, sourcePosition)
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'linear'
    panner.refDistance = 1
    panner.maxDistance = panelSettings.spatialAudioRange
    panner.rolloffFactor = 1
    panner.coneInnerAngle = 360
    panner.coneOuterAngle = 360
    panner.coneOuterGain = 1
  }, [panelSettings.spatialAudioEnabled, panelSettings.spatialAudioRange, realtimeAvatar, transforms])

  const attachRemotePlaybackStream = useCallback(async (stream: MediaStream | null) => {
    if (!stream) return
    const ctx = await ensureOutputAudioContext()
    if (!ctx) return

    if (outputAudioSourceRef.current) {
      try { outputAudioSourceRef.current.disconnect() } catch {}
      outputAudioSourceRef.current = null
    }
    if (outputGainNodeRef.current) {
      try { outputGainNodeRef.current.disconnect() } catch {}
      outputGainNodeRef.current = null
    }
    if (outputPannerNodeRef.current) {
      try { outputPannerNodeRef.current.disconnect() } catch {}
      outputPannerNodeRef.current = null
    }

    const source = ctx.createMediaStreamSource(stream)
    const gainNode = ctx.createGain()
    gainNode.gain.value = gainFromDb(panelSettings.gainDb)
    source.connect(gainNode)
    if (panelSettings.spatialAudioEnabled) {
      const panner = ctx.createPanner()
      gainNode.connect(panner)
      panner.connect(ctx.destination)
      outputPannerNodeRef.current = panner
      syncSpatialAudioFrame()
    } else {
      gainNode.connect(ctx.destination)
    }

    outputAudioSourceRef.current = source
    outputGainNodeRef.current = gainNode
  }, [ensureOutputAudioContext, panelSettings.gainDb, panelSettings.spatialAudioEnabled, syncSpatialAudioFrame])

  const detachLocalMicLipSync = useCallback(() => {
    const ctrl = localMicLipSyncRef.current
    if (!ctrl) return
    unregisterLipSync(PLAYER_AVATAR_LIPSYNC_ID, ctrl)
    ctrl.detach()
    localMicLipSyncRef.current = null
  }, [])

  const attachLocalMicLipSync = useCallback((stream: MediaStream | null) => {
    if (!stream) return
    let ctrl = localMicLipSyncRef.current
    if (!ctrl) {
      ctrl = createWLipSyncLegacyController()
      localMicLipSyncRef.current = ctrl
    }

    registerLipSync(PLAYER_AVATAR_LIPSYNC_ID, ctrl)
    void resumeLipSyncContext().then(() => {
      if (localMicLipSyncRef.current !== ctrl) return
      ctrl?.attachStream(stream)
    }).catch(() => {})
  }, [])

  const refreshSessionsFromStorage = useCallback(async (configPayload: RealtimeVoiceConfigPayload | null) => {
    await hydrateRealtimeStore()
    const existing = listRealtimeSessions().map(session => {
      if (!configPayload) return session
      const legacyInstructions = session.settings.instructions || ''
      const nextSettings: RealtimeSessionSettings = {
        model: session.settings.model || configPayload.model,
        voice: session.settings.voice || configPayload.defaultVoice,
        vadMode: session.settings.vadMode || configPayload.defaultVadMode,
        vadEagerness: session.settings.vadEagerness || configPayload.defaultVadEagerness,
        instructions: !legacyInstructions || shouldUpgradeLegacyInstructions(legacyInstructions)
          ? configPayload.promptTemplate
          : legacyInstructions,
      }
      const changed = nextSettings.model !== session.settings.model
        || nextSettings.voice !== session.settings.voice
        || nextSettings.vadMode !== session.settings.vadMode
        || nextSettings.vadEagerness !== session.settings.vadEagerness
        || nextSettings.instructions !== session.settings.instructions
      const normalized: RealtimeLocalSession = {
        ...session,
        settings: nextSettings,
      }
      if (changed) {
        upsertRealtimeSession(normalized)
      }
      return normalized
    })
    if (existing.length > 0) {
      setSessions(existing)
      const remembered = readActiveRealtimeSessionId()
      const preferred = existing.find(session => session.id === remembered) || existing[0]
      applySession(preferred)
      return
    }

    if (!configPayload) return
    const initialSettings: RealtimeSessionSettings = {
      model: configPayload.model,
      voice: configPayload.defaultVoice,
      vadMode: configPayload.defaultVadMode,
      vadEagerness: configPayload.defaultVadEagerness,
      instructions: configPayload.promptTemplate,
    }
    const fresh = buildNewSession({
      worldId: activeWorldId,
      worldName: activeWorldName,
      settings: initialSettings,
    })
    upsertRealtimeSession(fresh)
    setSessions([fresh])
    applySession(fresh)
  }, [activeWorldId, activeWorldName, applySession])

  useEffect(() => {
    let cancelled = false
    async function loadConfig() {
      try {
        const response = await fetch('/api/realtime/config', { cache: 'no-store' })
        const payload = await response.json() as RealtimeVoiceConfigPayload
        if (cancelled) return
        if (!response.ok) {
          throw new Error('Failed to load realtime config.')
        }
        setConfig(payload)
        await refreshSessionsFromStorage(payload)
      } catch (error) {
        if (cancelled) return
        setConfigError(error instanceof Error ? error.message : 'Failed to load realtime config.')
      }
    }
    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [refreshSessionsFromStorage])

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (!event.key || (event.key !== 'oasis-realtime-voice-store-v1' && event.key !== 'oasis-realtime-active-session')) return
      refreshSessionsFromStorage(config)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [config, refreshSessionsFromStorage])

  useEffect(() => {
    writeRealtimePanelSettings(panelSettings)
  }, [panelSettings])

  useEffect(() => {
    if (!embedded) {
      writeRealtimePanelPosition(position)
    }
  }, [embedded, position])

  useEffect(() => {
    if (!embedded) {
      writeRealtimePanelSize(size)
    }
  }, [embedded, size])

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollTranscriptToBottom()
    }
  }, [messages, scrollTranscriptToBottom])

  useEffect(() => {
    scrollTranscriptToBottom()
  }, [selectedSessionId, scrollTranscriptToBottom])

  useEffect(() => {
    applyPlaybackGain()
  }, [applyPlaybackGain])

  useEffect(() => {
    if (!remoteStreamRef.current) return
    void attachRemotePlaybackStream(remoteStreamRef.current)
  }, [attachRemotePlaybackStream, panelSettings.spatialAudioEnabled, panelSettings.spatialAudioRange])

  useEffect(() => {
    if (!panelSettings.spatialAudioEnabled) return
    let rafId = 0
    const tick = () => {
      syncSpatialAudioFrame()
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [panelSettings.spatialAudioEnabled, syncSpatialAudioFrame])

  useEffect(() => {
    if (!realtimeAvatar?.id || !audioRef.current) return

    const audioEl = audioRef.current
    const ctrl = createLipSyncController()
    lipSyncRef.current = ctrl
    registerLipSync(realtimeAvatar.id, ctrl)

    const attachCurrentSource = () => {
      void resumeLipSyncContext().then(() => {
        if (remoteStreamRef.current) {
          ctrl.attachStream(remoteStreamRef.current)
          return
        }
        if (!ctrl.isActive && (audioEl.srcObject || audioEl.currentSrc || audioEl.src)) {
          ctrl.attachAudio(audioEl)
        }
      }).catch(() => {})
    }

    attachCurrentSource()
    audioEl.addEventListener('play', attachCurrentSource)

    return () => {
      audioEl.removeEventListener('play', attachCurrentSource)
      unregisterLipSync(realtimeAvatar.id, ctrl)
      ctrl.detach()
      if (lipSyncRef.current === ctrl) {
        lipSyncRef.current = null
      }
    }
  }, [realtimeAvatar?.id])

  const markUiFocus = useCallback(() => {
    if (embedded) return
    const input = useInputManager.getState()
    if (input.pointerLocked) input.releasePointerLock()
    if (input.inputState === 'orbit' || input.inputState === 'noclip' || input.inputState === 'third-person') {
      input.enterUIFocus()
    }
    bringPanelToFront('realtime')
  }, [bringPanelToFront, embedded])

  const disconnect = useCallback((options?: { keepDetail?: boolean; preserveState?: boolean }) => {
    connectAttemptRef.current += 1
    peerReadyRef.current = false
    dataChannelReadyRef.current = false
    assistantMessageIdRef.current = ''
    pendingUserMessageIdRef.current = ''
    userMessageByItemIdRef.current.clear()
    assistantSourceByResponseRef.current.clear()
    toolMessageByCallIdRef.current.clear()
    toolStartedAtRef.current.clear()

    const dataChannel = dataChannelRef.current
    dataChannelRef.current = null
    if (dataChannel) {
      dataChannel.onmessage = null
      dataChannel.onopen = null
      dataChannel.onclose = null
      try { dataChannel.close() } catch {}
    }

    const peer = peerRef.current
    peerRef.current = null
    if (peer) {
      peer.ontrack = null
      peer.onconnectionstatechange = null
      try { peer.close() } catch {}
    }

    const stream = localStreamRef.current
    localStreamRef.current = null
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
    }
    detachLocalMicLipSync()

    remoteStreamRef.current = null

    if (outputAudioSourceRef.current) {
      try { outputAudioSourceRef.current.disconnect() } catch {}
      outputAudioSourceRef.current = null
    }
    if (outputGainNodeRef.current) {
      try { outputGainNodeRef.current.disconnect() } catch {}
      outputGainNodeRef.current = null
    }
    if (outputPannerNodeRef.current) {
      try { outputPannerNodeRef.current.disconnect() } catch {}
      outputPannerNodeRef.current = null
    }

    if (audioRef.current) {
      try {
        audioRef.current.pause()
      } catch {}
      audioRef.current.srcObject = null
    }

    lipSyncRef.current?.detach()

    setListening(false)
    setSpeaking(false)
    if (!options?.preserveState) {
      setConnectionState('idle')
    }
    if (!options?.keepDetail) {
      setConnectionDetail('Voice line dormant.')
    }
  }, [detachLocalMicLipSync])

  useEffect(() => {
    return () => disconnect()
  }, [disconnect])

  const createFreshSession = useCallback(() => {
    if (!config) return
    const next = buildNewSession({
      worldId: activeWorldId,
      worldName: activeWorldName,
      settings: sessionSettings || {
        model: config.model,
        voice: config.defaultVoice,
        vadMode: config.defaultVadMode,
        vadEagerness: config.defaultVadEagerness,
        instructions: config.promptTemplate,
      },
    })
    upsertRealtimeSession(next)
    const nextSessions = [next, ...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    setSessions(nextSessions)
    applySession(next)
  }, [activeWorldId, activeWorldName, applySession, config, sessionSettings, sessions])

  const removeCurrentSession = useCallback(() => {
    if (!selectedSession) return
    const deletingId = selectedSession.id
    deleteRealtimeSession(deletingId)
    const remaining = listRealtimeSessions()
    setSessions(remaining)
    if (selectedSessionId === deletingId) {
      if (remaining.length > 0) {
        applySession(remaining[0])
      } else if (config) {
        const fallback = buildNewSession({
          worldId: activeWorldId,
          worldName: activeWorldName,
          settings: {
            model: config.model,
            voice: config.defaultVoice,
            vadMode: config.defaultVadMode,
            vadEagerness: config.defaultVadEagerness,
            instructions: config.promptTemplate,
          },
        })
        upsertRealtimeSession(fallback)
        setSessions([fallback])
        applySession(fallback)
      }
    }
  }, [activeWorldId, activeWorldName, applySession, config, selectedSession, selectedSessionId])

  const persistSettings = useCallback((nextSettings: RealtimeSessionSettings) => {
    setSessionSettings(nextSettings)
    persistSession(session => ({
      ...session,
      settings: nextSettings,
      updatedAt: Date.now(),
    }))
  }, [persistSession])

  const syncSessionMeta = useCallback(() => {
    persistSession(session => ({
      ...session,
      worldId: activeWorldId,
      worldName: activeWorldName,
      updatedAt: Date.now(),
    }))
  }, [activeWorldId, activeWorldName, persistSession])

  useEffect(() => {
    if (!selectedSessionId) return
    syncSessionMeta()
  }, [activeWorldId, activeWorldName, selectedSessionId, syncSessionMeta])

  const connect = useCallback(async () => {
    if (!config || !sessionSettings || !selectedSession) return
    if (connectionState === 'connecting') return
    markUiFocus()
    disconnect({ keepDetail: true })
    const attemptId = connectAttemptRef.current
    setConnectionState('connecting')
    setConnectionDetail('Opening voice line... wait for LIVE before speaking.')

    const ensureActiveAttempt = () => {
      if (connectAttemptRef.current !== attemptId) {
        throw new Error(CANCELLED_CONNECT)
      }
    }

    const markReadyIfLive = () => {
      if (connectAttemptRef.current !== attemptId) return
      if (peerReadyRef.current && dataChannelReadyRef.current) {
        setConnectionState('connected')
        setConnectionDetail('Voice line live. You can speak now.')
      }
    }

    try {
      await ensureOutputAudioContext()
      const playerContext = {
        avatar: getPlayerAvatarPose(),
        camera: getCameraSnapshot(),
      }
      const history = buildReplayHistory(selectedSession.messages)

      const bootstrapResponse = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worldId: activeWorldId,
          model: sessionSettings.model,
          voice: sessionSettings.voice,
          vadMode: sessionSettings.vadMode,
          vadEagerness: sessionSettings.vadEagerness,
          instructions: sessionSettings.instructions,
          history,
          playerContext,
        }),
      })
      ensureActiveAttempt()
      const bootstrap = await bootstrapResponse.json() as RealtimeVoiceSessionPayload | { error?: string; detail?: string }
      if (!bootstrapResponse.ok || !('clientSecret' in bootstrap)) {
        throw new Error((bootstrap as { detail?: string; error?: string }).detail || (bootstrap as { error?: string }).error || 'Failed to bootstrap realtime session.')
      }
      ensureActiveAttempt()

      const pc = new RTCPeerConnection()
      peerRef.current = pc

      const remoteAudio = audioRef.current
      pc.ontrack = event => {
        const stream = event.streams[0] || null
        remoteStreamRef.current = stream
        if (stream && lipSyncRef.current) {
          void resumeLipSyncContext().then(() => {
            lipSyncRef.current?.attachStream(stream)
          }).catch(() => {})
        }
        void attachRemotePlaybackStream(stream)
        if (remoteAudio) {
          remoteAudio.muted = true
          remoteAudio.srcObject = stream
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          peerReadyRef.current = true
          markReadyIfLive()
          return
        }
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          setConnectionState(state === 'failed' ? 'error' : 'idle')
          setConnectionDetail(state === 'failed' ? 'Voice line faltered.' : 'Voice line closed.')
          disconnect({ keepDetail: true, preserveState: true })
        }
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      ensureActiveAttempt()
      localStreamRef.current = mediaStream
      attachLocalMicLipSync(mediaStream)
      for (const track of mediaStream.getTracks()) {
        pc.addTrack(track, mediaStream)
      }

      const dataChannel = pc.createDataChannel('oai-events')
      dataChannelRef.current = dataChannel

      const ensureUserMessage = (itemId: string) => {
        const mapped = userMessageByItemIdRef.current.get(itemId)
        if (mapped) return mapped
        if (pendingUserMessageIdRef.current) {
          userMessageByItemIdRef.current.set(itemId, pendingUserMessageIdRef.current)
          return pendingUserMessageIdRef.current
        }
        const messageId = makeId('user')
        userMessageByItemIdRef.current.set(itemId, messageId)
        pendingUserMessageIdRef.current = messageId
        appendMessage({
          id: messageId,
          role: 'user',
          content: '',
          status: 'streaming',
          timestamp: Date.now(),
        })
        return messageId
      }

      const ensureAssistantMessage = (responseId: string) => {
        if (assistantMessageIdRef.current) return assistantMessageIdRef.current
        const messageId = makeId('assistant')
        assistantMessageIdRef.current = messageId
        appendMessage({
          id: messageId,
          role: 'assistant',
          content: '',
          status: 'streaming',
          timestamp: Date.now(),
        })
        if (!assistantSourceByResponseRef.current.has(responseId)) {
          assistantSourceByResponseRef.current.set(responseId, 'audio')
        }
        return messageId
      }

      const sendRealtimeEvent = (payload: Record<string, unknown>) => {
        if (dataChannel.readyState !== 'open') {
          throw new Error('Realtime control channel is not open.')
        }
        dataChannel.send(JSON.stringify(payload))
      }

      const ensureToolMessage = (call: { callId: string; name: string; input: Record<string, unknown> }) => {
        const existingId = toolMessageByCallIdRef.current.get(call.callId)
        if (existingId) return existingId
        const messageId = makeId('tool')
        toolMessageByCallIdRef.current.set(call.callId, messageId)
        toolStartedAtRef.current.set(call.callId, Date.now())
        appendMessage({
          id: messageId,
          role: 'tool',
          content: '',
          status: 'streaming',
          timestamp: Date.now(),
          toolCallId: call.callId,
          toolName: call.name,
          toolState: 'running',
          toolInputSummary: summarizeJson(call.input, 120),
          toolInput: call.input,
        })
        return messageId
      }

      const executeRealtimeToolCalls = async (calls: Array<{
        name: string
        callId: string
        argumentsJson: string
      }>) => {
        for (const call of calls) {
          let output: Record<string, unknown>

          if (!REALTIME_TOOL_NAMES.has(call.name)) {
            output = { ok: false, error: `Tool ${call.name} is unavailable in this realtime session.` }
          } else {
            let parsedArgs: Record<string, unknown> = {}
            if (call.argumentsJson.trim()) {
              try {
                parsedArgs = JSON.parse(call.argumentsJson) as Record<string, unknown>
              } catch {
                parsedArgs = {}
              }
            }

            const toolArgs: Record<string, unknown> = { ...parsedArgs }
            if (call.name === 'walk_avatar_to' && !toolArgs.agentType && !toolArgs.agent) {
              toolArgs.agentType = REALTIME_AGENT_TYPE
            }
            if ((call.name === 'place_object' || call.name === 'craft_scene') && !toolArgs.actorAgentType) {
              toolArgs.actorAgentType = REALTIME_AGENT_TYPE
            }

            const messageId = ensureToolMessage({ callId: call.callId, name: call.name, input: toolArgs })

            try {
              const toolResponse = await fetch('/api/oasis-tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tool: call.name,
                  args: toolArgs,
                }),
              })

              const result = await toolResponse.json() as Record<string, unknown>
              output = result
              updateMessage(messageId, message => ({
                ...message,
                status: 'done',
                toolState: toolResponse.ok && result.ok !== false ? 'done' : 'failed',
                toolOutput: result,
                toolDurationMs: Date.now() - (toolStartedAtRef.current.get(call.callId) || Date.now()),
              }))
            } catch (error) {
              output = {
                ok: false,
                error: error instanceof Error ? error.message : 'Realtime tool execution failed.',
              }
              updateMessage(messageId, message => ({
                ...message,
                status: 'done',
                toolState: 'failed',
                toolOutput: output,
                toolDurationMs: Date.now() - (toolStartedAtRef.current.get(call.callId) || Date.now()),
              }))
            }
          }

          if (!REALTIME_TOOL_NAMES.has(call.name)) {
            const messageId = ensureToolMessage({ callId: call.callId, name: call.name, input: {} })
            updateMessage(messageId, message => ({
              ...message,
              status: 'done',
              toolState: 'failed',
              toolOutput: output,
              toolDurationMs: Date.now() - (toolStartedAtRef.current.get(call.callId) || Date.now()),
            }))
          }

          sendRealtimeEvent({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: call.callId,
              output: JSON.stringify(output),
            },
          })
        }

        if (calls.length > 0) {
          sendRealtimeEvent({ type: 'response.create' })
        }
      }

      dataChannel.onmessage = event => {
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          return
        }
        const eventType = typeof payload.type === 'string' ? payload.type : ''
        if (!eventType) return

        if (eventType === 'session.created' || eventType === 'session.updated') {
          if (peerReadyRef.current && dataChannelReadyRef.current) {
            setConnectionDetail('Voice line live. You can speak now.')
          }
          return
        }

        if (eventType === 'input_audio_buffer.speech_started') {
          setListening(true)
          if (!pendingUserMessageIdRef.current) {
            const messageId = makeId('user')
            pendingUserMessageIdRef.current = messageId
            appendMessage({
              id: messageId,
              role: 'user',
              content: '',
              status: 'streaming',
              timestamp: Date.now(),
            })
          }
          return
        }

        if (eventType === 'input_audio_buffer.speech_stopped') {
          setListening(false)
          return
        }

        if (eventType === 'conversation.item.input_audio_transcription.delta') {
          const itemId = typeof payload.item_id === 'string' ? payload.item_id : ''
          const delta = typeof payload.delta === 'string' ? payload.delta : ''
          if (!itemId || !delta) return
          const messageId = ensureUserMessage(itemId)
          updateMessage(messageId, message => ({
            ...message,
            content: `${message.content}${delta}`,
            status: 'streaming',
          }))
          return
        }

        if (eventType === 'conversation.item.input_audio_transcription.completed') {
          const itemId = typeof payload.item_id === 'string' ? payload.item_id : ''
          const transcript = typeof payload.transcript === 'string' ? payload.transcript : ''
          if (!itemId) return
          const messageId = ensureUserMessage(itemId)
          updateMessage(messageId, message => ({
            ...message,
            content: transcript || message.content,
            status: 'done',
          }))
          pendingUserMessageIdRef.current = ''
          return
        }

        if (eventType === 'response.output_audio.delta') {
          setSpeaking(true)
          return
        }

        if (eventType === 'response.output_audio.done') {
          setSpeaking(false)
          return
        }

        if (eventType === 'response.output_audio_transcript.delta' || eventType === 'response.output_text.delta') {
          const responseId = typeof payload.response_id === 'string' ? payload.response_id : 'assistant-live'
          const nextSource: AssistantSource = eventType === 'response.output_audio_transcript.delta' ? 'audio' : 'text'
          const currentSource = assistantSourceByResponseRef.current.get(responseId)
          if (currentSource && currentSource !== nextSource) {
            if (currentSource === 'audio' && nextSource === 'text') return
          } else {
            assistantSourceByResponseRef.current.set(responseId, nextSource)
          }
          const delta = typeof payload.delta === 'string' ? payload.delta : ''
          if (!delta) return
          const messageId = ensureAssistantMessage(responseId)
          updateMessage(messageId, message => ({
            ...message,
            content: `${message.content}${delta}`,
            status: 'streaming',
          }))
          return
        }

        if (eventType === 'response.done') {
          setSpeaking(false)
          const responseRecord = payload.response && typeof payload.response === 'object'
            ? payload.response as Record<string, unknown>
            : null
          const outputs = Array.isArray(responseRecord?.output) ? responseRecord.output : []
          const functionCalls = outputs
            .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
            .filter(entry => entry.type === 'function_call')

          const messageId = assistantMessageIdRef.current
          if (messageId) {
            updateMessage(messageId, message => ({ ...message, status: 'done' }))
            assistantMessageIdRef.current = ''
          }
          if (functionCalls.length > 0) {
            const calls = functionCalls
              .map(call => ({
                name: typeof call.name === 'string' ? call.name : '',
                callId: typeof call.call_id === 'string' ? call.call_id : '',
                argumentsJson: typeof call.arguments === 'string' ? call.arguments : '{}',
              }))
              .filter(call => call.name && call.callId)
            void executeRealtimeToolCalls(calls)
          }
          return
        }

        if (eventType === 'error') {
          const detail = typeof payload.error === 'object' && payload.error
            ? JSON.stringify(payload.error)
            : 'Realtime voice error.'
          setConnectionState('error')
          setConnectionDetail(detail)
          appendSystemMessage(detail)
        }
      }

      dataChannel.onclose = () => {
        setConnectionDetail('Voice line closed.')
      }

      dataChannel.onopen = () => {
        dataChannelReadyRef.current = true
        setConnectionDetail('Negotiating voice line... wait for LIVE before speaking.')
        markReadyIfLive()
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      ensureActiveAttempt()

      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(bootstrap.model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${bootstrap.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      })

      if (!sdpResponse.ok) {
        throw new Error(await sdpResponse.text())
      }
      ensureActiveAttempt()

      const answer = {
        type: 'answer' as const,
        sdp: await sdpResponse.text(),
      }
      ensureActiveAttempt()
      await pc.setRemoteDescription(answer)
      ensureActiveAttempt()

      const refreshedSession: RealtimeLocalSession = {
        ...selectedSession,
        worldId: activeWorldId,
        worldName: activeWorldName,
        settings: {
          ...sessionSettings,
          voice: bootstrap.voice,
          model: bootstrap.model,
          vadEagerness: bootstrap.vadEagerness,
        },
        updatedAt: Date.now(),
      }
      upsertRealtimeSession(refreshedSession)
      setSessions(current => current.map(session => session.id === refreshedSession.id ? refreshedSession : session).sort((a, b) => b.updatedAt - a.updatedAt))
      setSessionSettings(refreshedSession.settings)
    } catch (error) {
      disconnect({ keepDetail: true })
      if (error instanceof Error && error.message === CANCELLED_CONNECT) {
        return
      }
      setConnectionState('error')
      const detail = error instanceof Error ? error.message : 'Failed to summon realtime voice.'
      setConnectionDetail(detail)
      appendSystemMessage(detail)
    }
  }, [activeWorldId, activeWorldName, appendMessage, appendSystemMessage, attachLocalMicLipSync, attachRemotePlaybackStream, config, connectionState, disconnect, ensureOutputAudioContext, markUiFocus, selectedSession, sessionSettings, updateMessage])

  const handleSessionChange = useCallback((nextId: string) => {
    if (!nextId) return
    if (connectionState === 'connected' || connectionState === 'connecting') {
      disconnect({ keepDetail: true })
    }
    const nextSession = sessions.find(session => session.id === nextId) || null
    applySession(nextSession)
  }, [applySession, connectionState, disconnect, sessions])

  const startDrag = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (embedded) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, option, [data-no-drag], [data-resize-handle]')) return
    markUiFocus()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    }
    const handleMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setPosition({
        x: Math.max(16, drag.originX + (moveEvent.clientX - drag.startX)),
        y: Math.max(MIN_DRAG_Y, drag.originY + (moveEvent.clientY - drag.startY)),
      })
    }
    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [embedded, markUiFocus, position.x, position.y])

  const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (embedded) return
    event.preventDefault()
    event.stopPropagation()
    markUiFocus()
    setIsResizing(true)
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originW: size.w,
      originH: size.h,
    }
  }, [embedded, markUiFocus, size.h, size.w])

  const handleResize = useCallback((event: MouseEvent) => {
    if (embedded || !isResizing || !resizeRef.current) return
    const next = {
      w: Math.max(MIN_PANEL_WIDTH, resizeRef.current.originW + (event.clientX - resizeRef.current.startX)),
      h: Math.max(MIN_PANEL_HEIGHT, resizeRef.current.originH + (event.clientY - resizeRef.current.startY)),
    }
    setSize(next)
  }, [embedded, isResizing])

  useEffect(() => {
    if (embedded) return
    if (!isResizing) return

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeRef.current = null
    }

    document.addEventListener('mousemove', handleResize)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [embedded, handleResize, isResizing])

  const [r, g, b] = hexToRgb(panelSettings.bgColor)
  const shellStyle = {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${panelSettings.opacity})`,
    backdropFilter: panelSettings.blur > 0 ? `blur(${panelSettings.blur}px)` : undefined,
  }
  const headerFill = `rgba(${r}, ${g}, ${b}, ${Math.min(1, panelSettings.opacity + 0.08)})`
  const sectionFill = `rgba(${r}, ${g}, ${b}, ${Math.max(0.08, panelSettings.opacity * 0.3)})`
  const fieldFill = `rgba(${Math.max(0, r - 10)}, ${Math.max(0, g - 8)}, ${Math.max(0, b - 8)}, ${Math.max(0.12, panelSettings.opacity * 0.44)})`

  const panelBody = (
    <div
      className={`${embedded ? 'relative h-full w-full' : 'fixed'} flex flex-col overflow-hidden rounded-2xl border shadow-2xl`}
      onMouseDown={markUiFocus}
      style={{
        position: embedded ? 'relative' : 'fixed',
        left: embedded ? undefined : position.x,
        top: embedded ? undefined : position.y,
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        zIndex: embedded ? undefined : panelZIndex,
        borderColor: 'rgba(168,85,247,0.26)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(168,85,247,0.08)',
        color: '#f5f3ff',
        ...shellStyle,
      }}
    >
      <audio ref={audioRef} autoPlay className="hidden" />

      <div
        className="flex items-center justify-between px-4 border-b select-none"
        onMouseDown={startDrag}
        style={{
          height: HEADER_HEIGHT,
          borderColor: 'rgba(168,85,247,0.18)',
          background: `linear-gradient(180deg, ${headerFill}, rgba(${r}, ${g}, ${b}, ${Math.max(0.18, panelSettings.opacity * 0.76)}))`,
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[18px] font-semibold tracking-[0.24em] text-violet-100">REALTIME</div>
            <div className="text-[11px] text-violet-200/70">Merlin-flavored voice sandbox</div>
          </div>
          <CallStatusBadge state={connectionState} listening={listening} speaking={speaking} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfigOpen(open => !open)}
            className="rounded-md border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.16em]"
            style={{ borderColor: 'rgba(196,181,253,0.22)', background: 'rgba(91,33,182,0.14)', color: '#e9d5ff' }}
          >
            config
          </button>
          <button
            onClick={() => setSettingsOpen(open => !open)}
            className="rounded-md border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.16em]"
            style={{ borderColor: 'rgba(196,181,253,0.22)', background: 'rgba(76,29,149,0.14)', color: '#e9d5ff' }}
          >
            settings
          </button>
          {!hideCloseButton && (
            <button
              onClick={onClose}
              className="rounded-md border px-2 py-1 text-[12px] font-mono uppercase tracking-[0.14em]"
              style={{ borderColor: 'rgba(196,181,253,0.16)', color: '#f5d0fe', background: 'rgba(0,0,0,0.22)' }}
            >
              x
            </button>
          )}
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          background: 'transparent',
        }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(168,85,247,0.12)', background: sectionFill, flexShrink: 0 }}>
          <div className="flex items-center gap-2">
            <select
              value={selectedSessionId}
              disabled={connectionState === 'connected' || connectionState === 'connecting'}
              onChange={event => handleSessionChange(event.target.value)}
              className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: 'rgba(196,181,253,0.18)',
                background: fieldFill,
                color: '#f5f3ff',
              }}
            >
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {formatSessionLabel(session)} - {formatSessionCounts(session)}
                </option>
              ))}
            </select>
            <button
              onClick={createFreshSession}
              disabled={!config || connectionState === 'connected' || connectionState === 'connecting'}
              className="rounded-lg border px-3 py-2 text-xs font-mono uppercase tracking-[0.16em] disabled:opacity-40"
              style={{ borderColor: 'rgba(139,92,246,0.24)', background: `rgba(${r}, ${g}, ${b}, ${Math.max(0.16, panelSettings.opacity * 0.34)})`, color: '#ddd6fe' }}
            >
              + new
            </button>
            <button
              onClick={removeCurrentSession}
              disabled={!selectedSession || sessions.length <= 1 || connectionState === 'connected' || connectionState === 'connecting'}
              className="rounded-lg border px-3 py-2 text-xs font-mono uppercase tracking-[0.16em] disabled:opacity-40"
              style={{ borderColor: 'rgba(244,114,182,0.24)', background: 'rgba(131,24,67,0.14)', color: '#fbcfe8' }}
              title="Delete this saved realtime session"
            >
              delete
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-violet-100/65">
            <span>world: {selectedSession?.worldName || activeWorldName}</span>
            <span>turns: {selectedSession ? formatSessionCounts(selectedSession) : '0u/0a'}</span>
            <span>model: {sessionSettings?.model || config?.model || REALTIME_MODELS[0]}</span>
            <span>voice: {sessionSettings?.voice || config?.defaultVoice || 'marin'}</span>
            <span>gain: +{panelSettings.gainDb}dB</span>
            <span>spatial: {panelSettings.spatialAudioEnabled ? `on/${panelSettings.spatialAudioRange}m` : 'off'}</span>
            <span>
              vad: {(sessionSettings?.vadMode || config?.defaultVadMode || 'semantic_vad')}
              {(sessionSettings?.vadMode || config?.defaultVadMode || 'semantic_vad') === 'semantic_vad'
                ? `/${sessionSettings?.vadEagerness || config?.defaultVadEagerness || REALTIME_VAD_EAGERNESS[0]}`
                : ''}
            </span>
            <span>body: {realtimeAvatar?.label || 'unembodied'}</span>
          </div>
        </div>

        {configOpen && (
          <div className="px-4 py-3 border-b space-y-3" style={{ borderColor: 'rgba(168,85,247,0.12)', background: sectionFill, flexShrink: 0 }}>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
                model
                <select
                  value={sessionSettings?.model || config?.model || REALTIME_MODELS[0]}
                  disabled={!config || connectionState === 'connected' || connectionState === 'connecting'}
                  onChange={event => sessionSettings && persistSettings({ ...sessionSettings, model: event.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50"
                  style={{ borderColor: 'rgba(196,181,253,0.18)', background: fieldFill, color: '#f5f3ff' }}
                >
                  {(config?.models || REALTIME_MODELS).map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
                voice
                <select
                  value={sessionSettings?.voice || config?.defaultVoice || REALTIME_VOICES[0]}
                  disabled={!config || connectionState === 'connected' || connectionState === 'connecting'}
                  onChange={event => sessionSettings && persistSettings({ ...sessionSettings, voice: event.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50"
                  style={{ borderColor: 'rgba(196,181,253,0.18)', background: fieldFill, color: '#f5f3ff' }}
                >
                  {(config?.voices || REALTIME_VOICES).map(voice => (
                    <option key={voice} value={voice}>{voice}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
                vad
                <select
                  value={sessionSettings?.vadMode || config?.defaultVadMode || REALTIME_VAD_MODES[0]}
                  disabled={!config || connectionState === 'connected' || connectionState === 'connecting'}
                  onChange={event => sessionSettings && persistSettings({ ...sessionSettings, vadMode: event.target.value as RealtimeVadMode })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50"
                  style={{ borderColor: 'rgba(196,181,253,0.18)', background: fieldFill, color: '#f5f3ff' }}
                >
                  <option value="semantic_vad">semantic_vad</option>
                  <option value="server_vad">server_vad</option>
                </select>
              </label>
              <label className="text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
                vad eagerness
                <select
                  value={sessionSettings?.vadEagerness || config?.defaultVadEagerness || REALTIME_VAD_EAGERNESS[0]}
                  disabled={
                    !config
                    || connectionState === 'connected'
                    || connectionState === 'connecting'
                    || (sessionSettings?.vadMode || config?.defaultVadMode || REALTIME_VAD_MODES[0]) !== 'semantic_vad'
                  }
                  onChange={event => sessionSettings && persistSettings({ ...sessionSettings, vadEagerness: event.target.value as RealtimeVadEagerness })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50"
                  style={{ borderColor: 'rgba(196,181,253,0.18)', background: fieldFill, color: '#f5f3ff' }}
                >
                  {(REALTIME_VAD_EAGERNESS as readonly string[]).map(level => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
              instruction scroll
              <textarea
                value={sessionSettings?.instructions || config?.promptTemplate || ''}
                disabled={!sessionSettings}
                onChange={event => sessionSettings && persistSettings({ ...sessionSettings, instructions: event.target.value })}
                rows={10}
                className="mt-1 w-full rounded-xl border px-3 py-3 text-[12px] leading-5 outline-none disabled:opacity-50"
                style={{
                  borderColor: 'rgba(196,181,253,0.18)',
                  background: fieldFill,
                  color: '#ede9fe',
                  resize: 'vertical',
                }}
              />
            </label>
            <div className="text-[11px] text-violet-100/55">
              Model, voice, and VAD changes apply on the next call. The active voice cannot be changed mid-session.
            </div>
          </div>
        )}

        {settingsOpen && (
          <div className="px-4 py-3 border-b space-y-3" style={{ borderColor: 'rgba(168,85,247,0.12)', background: sectionFill, flexShrink: 0 }}>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
              background
              <input
                type="color"
                value={panelSettings.bgColor}
                onChange={event => setPanelSettings(current => clampRealtimePanelSettings({ ...current, bgColor: event.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border p-1"
                style={{ borderColor: 'rgba(196,181,253,0.18)', background: fieldFill }}
              />
            </label>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
              opacity
              <input
                type="range"
                min="0.2"
                max="1"
                step="0.02"
                value={panelSettings.opacity}
                onChange={event => setPanelSettings(current => clampRealtimePanelSettings({ ...current, opacity: Number(event.target.value) }))}
                className="mt-1 w-full"
              />
            </label>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
              blur
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={panelSettings.blur}
                onChange={event => setPanelSettings(current => clampRealtimePanelSettings({ ...current, blur: Number(event.target.value) }))}
                className="mt-1 w-full"
              />
            </label>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
              volume boost (+{panelSettings.gainDb} dB)
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={panelSettings.gainDb}
                onChange={event => setPanelSettings(current => clampRealtimePanelSettings({ ...current, gainDb: Number(event.target.value) }))}
                className="mt-1 w-full"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-[11px] uppercase tracking-[0.16em] text-violet-200/75" style={{ borderColor: 'rgba(196,181,253,0.18)', background: fieldFill }}>
              <span>spatial sound</span>
              <button
                type="button"
                onClick={() => setPanelSettings(current => clampRealtimePanelSettings({ ...current, spatialAudioEnabled: !current.spatialAudioEnabled }))}
                className="rounded-full border px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em]"
                style={{
                  borderColor: panelSettings.spatialAudioEnabled ? 'rgba(34,197,94,0.28)' : 'rgba(148,163,184,0.24)',
                  background: panelSettings.spatialAudioEnabled ? 'rgba(21,128,61,0.18)' : 'rgba(15,23,42,0.24)',
                  color: panelSettings.spatialAudioEnabled ? '#86efac' : '#cbd5e1',
                }}
              >
                {panelSettings.spatialAudioEnabled ? 'on' : 'off'}
              </button>
            </label>
            <label className="block text-[11px] uppercase tracking-[0.16em] text-violet-200/75">
              fade to silence ({panelSettings.spatialAudioRange} m)
              <input
                type="range"
                min="10"
                max="100"
                step="1"
                value={panelSettings.spatialAudioRange}
                disabled={!panelSettings.spatialAudioEnabled}
                onChange={event => setPanelSettings(current => clampRealtimePanelSettings({ ...current, spatialAudioRange: Number(event.target.value) }))}
                className="mt-1 w-full disabled:opacity-50"
              />
            </label>
          </div>
        )}

        <div className="px-4 py-3 border-b text-[12px]" style={{ borderColor: 'rgba(168,85,247,0.12)', color: '#ddd6fe', background: sectionFill, flexShrink: 0 }}>
          <div>{connectionDetail}</div>
          <div className="mt-1 text-violet-100/55">
            Voice, transcript, lipsync, and apprentice tools are live: world info, world state, asset search, placing, crafting, and walking.
          </div>
          {configError && <div className="mt-2 text-rose-300">{configError}</div>}
          {config && !config.configured && (
            <div className="mt-2 text-amber-300">OPENAI_API_KEY is missing on the server, so the voice line cannot open yet.</div>
          )}
        </div>

        <div
          ref={transcriptRef}
          onScroll={event => {
            const el = event.currentTarget
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
            autoScrollRef.current = nearBottom
            setShowJumpToLatest(!nearBottom)
          }}
          className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3"
        >
          {messages.length === 0 ? (
            <div className="rounded-2xl border px-4 py-5 text-sm" style={{ borderColor: 'rgba(196,181,253,0.14)', background: `rgba(${r}, ${g}, ${b}, ${Math.max(0.1, panelSettings.opacity * 0.22)})`, color: '#ddd6fe' }}>
              When you open the call, your voice and Merlin’s voice will both stream into this transcript.
            </div>
          ) : (
            messages.map(message => {
              if (message.role === 'tool') {
                const expanded = expandedToolIds.includes(message.id)
                const state = message.toolState || 'running'
                const palette = state === 'done'
                  ? { border: 'rgba(16,185,129,0.28)', background: 'rgba(6,78,59,0.16)', label: '#86efac' }
                  : state === 'failed'
                    ? { border: 'rgba(244,63,94,0.28)', background: 'rgba(127,29,29,0.16)', label: '#fda4af' }
                    : { border: 'rgba(250,204,21,0.28)', background: 'rgba(120,53,15,0.16)', label: '#fde68a' }

                return (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => toggleToolExpanded(message.id)}
                    className="w-full rounded-2xl border px-4 py-3 text-left transition"
                    style={{ borderColor: palette.border, background: palette.background }}
                  >
                    <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em]">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true">
                          {state === 'done' ? '✅' : state === 'failed' ? '❌' : '⏳'}
                        </span>
                        <span style={{ color: palette.label }}>{message.toolName || 'tool'}</span>
                        <span className="text-violet-100/50">{message.toolInputSummary || 'no args'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-violet-100/40">
                        {typeof message.toolDurationMs === 'number' && <span>{message.toolDurationMs}ms</span>}
                        <span>{formatTimestamp(message.timestamp)}</span>
                      </div>
                    </div>
                    {expanded && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-violet-100/50">input</div>
                          <pre className="overflow-x-auto rounded-xl border px-3 py-3 text-[11px] leading-5 text-violet-50/88" style={{ borderColor: 'rgba(196,181,253,0.14)', background: 'rgba(15,23,42,0.28)' }}>
{JSON.stringify(message.toolInput ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-violet-100/50">output</div>
                          <pre className="overflow-x-auto rounded-xl border px-3 py-3 text-[11px] leading-5 text-violet-50/88" style={{ borderColor: 'rgba(196,181,253,0.14)', background: 'rgba(15,23,42,0.28)' }}>
{JSON.stringify(message.toolOutput ?? {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </button>
                )
              }

              const tone = messageTone(message.role)
              return (
                <div
                  key={message.id}
                  className="rounded-2xl border px-4 py-3"
                  style={{ borderColor: tone.border, background: tone.background }}
                >
                  <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.16em]">
                    <span style={{ color: tone.label }}>{message.role}</span>
                    <span className="text-violet-100/40">{formatTimestamp(message.timestamp)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-[14px] leading-6 text-violet-50/92">
                    {message.content || (message.status === 'streaming' ? '...' : '')}
                  </div>
                </div>
              )
            })
          )}
          {showJumpToLatest && (
            <button
              type="button"
              onClick={() => scrollTranscriptToBottom('smooth')}
              className="sticky bottom-0 ml-auto mt-3 rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.16em]"
              style={{
                borderColor: 'rgba(34,211,238,0.26)',
                background: 'rgba(8,51,68,0.84)',
                color: '#a5f3fc',
              }}
            >
              auto-scroll
            </button>
          )}
        </div>

        <div className="border-t px-4 py-4" style={{ borderColor: 'rgba(168,85,247,0.12)', background: sectionFill, flexShrink: 0 }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (connectionState === 'connected') {
                  disconnect()
                  return
                }
                if (connectionState === 'connecting') return
                void connect()
              }}
              disabled={!config || !config.configured || !sessionSettings}
              className="rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:opacity-40"
              style={{
                borderColor: connectionState === 'connected'
                  ? 'rgba(244,114,182,0.3)'
                  : connectionState === 'connecting'
                    ? 'rgba(250,204,21,0.32)'
                  : 'rgba(34,211,238,0.28)',
                background: connectionState === 'connected'
                  ? 'rgba(131,24,67,0.18)'
                  : connectionState === 'connecting'
                    ? 'rgba(113,63,18,0.24)'
                  : 'linear-gradient(135deg, rgba(37,99,235,0.25), rgba(124,58,237,0.24))',
                color: connectionState === 'connected'
                  ? '#fbcfe8'
                  : connectionState === 'connecting'
                    ? '#fde68a'
                    : '#e0f2fe',
              }}
            >
              {connectionState === 'connected' ? 'Hang Up' : connectionState === 'connecting' ? 'Opening...' : 'Start Talking'}
            </button>
            <div className="text-[12px] text-violet-100/55">
              Audio + text transcript are both live. Keyboard input stays asleep in phase 1.
            </div>
          </div>
        </div>
      </div>

      {!embedded && (
        <div
          data-resize-handle
          onMouseDown={startResize}
          className="absolute bottom-0 right-0 cursor-se-resize"
          style={{
            width: RESIZE_HANDLE_SIZE,
            height: RESIZE_HANDLE_SIZE,
            background: 'linear-gradient(135deg, transparent 50%, rgba(192,132,252,0.44) 50%)',
            borderRadius: '0 0 1rem 0',
          }}
        />
      )}
    </div>
  )

  if (embedded) return panelBody
  if (!isOpen || typeof document === 'undefined') return null
  return createPortal(panelBody, document.body)
}

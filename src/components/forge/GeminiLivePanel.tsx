'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getCameraSnapshot } from '@/lib/camera-bridge'
import {
  createLipSyncController,
  registerLipSync,
  resumeLipSyncContext,
  unregisterLipSync,
  type LipSyncController,
} from '@/lib/lip-sync'
import { getLiveObjectTransform } from '@/lib/live-object-transforms'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { useUILayer } from '@/lib/input-manager'
import {
  base64ToBytes,
  extractPcmSampleRate,
  float32ToPcm16Base64,
  pcm16Base64ToFloat32,
  resampleFloat32,
} from '@/lib/gemini-live-audio'
import {
  DEFAULT_GEMINI_LIVE_PANEL_SETTINGS,
  GEMINI_AGENT_TYPE,
  GEMINI_LIVE_INPUT_SAMPLE_RATE,
  GEMINI_LIVE_MODELS,
  GEMINI_LIVE_OUTPUT_SAMPLE_RATE,
  GEMINI_LIVE_PANEL_SETTINGS_KEY,
  GEMINI_LIVE_VOICES,
  clampGeminiLivePanelSettings,
  type GeminiLiveConfigPayload,
  type GeminiLiveConnectionState,
  type GeminiLivePanelSettings,
  type GeminiLiveSessionPayload,
} from '@/lib/gemini-live'
import { useOasisStore } from '@/store/oasisStore'

interface GeminiLivePanelProps {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
}

interface GeminiTranscriptMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  status: 'streaming' | 'done'
  timestamp: number
  toolCallId?: string
  toolName?: string
  toolState?: 'running' | 'done' | 'failed' | 'cancelled'
  toolInputSummary?: string
  toolInput?: unknown
  toolOutput?: unknown
  toolDurationMs?: number
}

type GeminiPanelTab = 'stream' | 'config' | 'settings'

interface GeminiFunctionCall {
  id: string
  name: string
  args: Record<string, unknown>
}

const GEMINI_TOOL_NAMES = new Set([
  'get_world_info',
  'get_world_state',
  'search_assets',
  'place_object',
  'create_spatial_web_object',
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
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
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

function rgbaFromHex(hex: string, alpha: number): string {
  const clean = hex.trim().replace(/^#/, '')
  const expanded = clean.length === 3
    ? clean.split('').map(char => `${char}${char}`).join('')
    : clean
  const parsed = Number.parseInt(expanded, 16)
  if (!Number.isFinite(parsed)) return `rgba(6,17,26,${alpha})`
  const r = (parsed >> 16) & 255
  const g = (parsed >> 8) & 255
  const b = parsed & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function buildGeminiWebSocketUrl(endpoint: string, accessToken: string): string {
  const separator = endpoint.includes('?') ? '&' : '?'
  return `${endpoint}${separator}access_token=${encodeURIComponent(accessToken)}`
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function extractGeminiCalls(payload: Record<string, unknown>): GeminiFunctionCall[] {
  const toolCall = payload.toolCall && typeof payload.toolCall === 'object'
    ? payload.toolCall as Record<string, unknown>
    : null
  const functionCalls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : []
  return functionCalls
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map(entry => {
      const name = typeof entry.name === 'string' ? entry.name : ''
      const id = typeof entry.id === 'string'
        ? entry.id
        : typeof entry.callId === 'string'
          ? entry.callId
          : makeId('gemini-call')
      return {
        id,
        name,
        args: parseJsonObject(entry.args),
      }
    })
    .filter(call => call.name)
}

function readPanelSettings(): GeminiLivePanelSettings {
  if (typeof window === 'undefined') return DEFAULT_GEMINI_LIVE_PANEL_SETTINGS
  try {
    const raw = window.localStorage.getItem(GEMINI_LIVE_PANEL_SETTINGS_KEY)
    return clampGeminiLivePanelSettings(raw ? JSON.parse(raw) as Partial<GeminiLivePanelSettings> : null)
  } catch {
    return DEFAULT_GEMINI_LIVE_PANEL_SETTINGS
  }
}

function StatusBadge({ state, listening, speaking }: { state: GeminiLiveConnectionState; listening: boolean; speaking: boolean }) {
  const active = state === 'connected'
  const palette = state === 'error'
    ? { color: '#fda4af', border: 'rgba(244,63,94,0.32)', background: 'rgba(127,29,29,0.2)' }
    : active
      ? { color: '#86efac', border: 'rgba(16,185,129,0.32)', background: 'rgba(6,78,59,0.18)' }
      : state === 'starting'
        ? { color: '#fbbf24', border: 'rgba(245,158,11,0.32)', background: 'rgba(120,53,15,0.18)' }
        : { color: '#a5f3fc', border: 'rgba(34,211,238,0.28)', background: 'rgba(8,51,68,0.18)' }

  const label = active
    ? speaking ? 'speaking' : listening ? 'listening' : 'live'
    : state === 'starting'
      ? 'starting'
      : state

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.16em]"
      style={{ color: palette.color, borderColor: palette.border, background: palette.background }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: palette.color }} />
      {label}
    </span>
  )
}

function messageTone(role: GeminiTranscriptMessage['role']) {
  switch (role) {
    case 'assistant':
      return { border: 'rgba(34,211,238,0.28)', background: 'rgba(8,51,68,0.18)', label: '#a5f3fc' }
    case 'user':
      return { border: 'rgba(16,185,129,0.24)', background: 'rgba(6,78,59,0.16)', label: '#86efac' }
    case 'tool':
      return { border: 'rgba(245,158,11,0.26)', background: 'rgba(120,53,15,0.16)', label: '#fcd34d' }
    default:
      return { border: 'rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.28)', label: '#cbd5e1' }
  }
}

export function GeminiLivePanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
}: GeminiLivePanelProps) {
  useUILayer('gemini-live', isOpen && !embedded)

  const [config, setConfig] = useState<GeminiLiveConfigPayload | null>(null)
  const [configError, setConfigError] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(GEMINI_LIVE_MODELS[0])
  const [selectedVoice, setSelectedVoice] = useState<string>(GEMINI_LIVE_VOICES[0])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [activeTab, setActiveTab] = useState<GeminiPanelTab>('stream')
  const [panelSettings, setPanelSettings] = useState<GeminiLivePanelSettings>(() => readPanelSettings())
  const [connectionState, setConnectionState] = useState<GeminiLiveConnectionState>('idle')
  const [connectionDetail, setConnectionDetail] = useState('Idle.')
  const [session, setSession] = useState<GeminiLiveSessionPayload | null>(null)
  const [messages, setMessages] = useState<GeminiTranscriptMessage[]>([
    {
      id: makeId('gemini-system'),
      role: 'system',
      content: 'Gemini Live lab initialized.',
      status: 'done',
      timestamp: Date.now(),
    },
  ])
  const [expandedToolIds, setExpandedToolIds] = useState<string[]>([])
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const connectAttemptRef = useRef(0)
  const sessionRef = useRef<GeminiLiveSessionPayload | null>(null)
  const inputAudioContextRef = useRef<AudioContext | null>(null)
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const inputSilentGainRef = useRef<GainNode | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const outputAudioContextRef = useRef<AudioContext | null>(null)
  const outputGainNodeRef = useRef<GainNode | null>(null)
  const outputPannerNodeRef = useRef<PannerNode | null>(null)
  const outputDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const outputScheduleTimeRef = useRef(0)
  const outputSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const lipSyncRef = useRef<LipSyncController | null>(null)
  const userMessageIdRef = useRef('')
  const assistantMessageIdRef = useRef('')
  const toolMessageByCallIdRef = useRef<Map<string, string>>(new Map())
  const toolStartedAtRef = useRef<Map<string, number>>(new Map())

  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const activeWorldName = useOasisStore(state => state.worldRegistry.find(world => world.id === state.activeWorldId)?.name || 'Current world')
  const transforms = useOasisStore(state => state.transforms)
  const geminiAvatar = useOasisStore(state => state.placedAgentAvatars.find(entry => entry.agentType === GEMINI_AGENT_TYPE) || null)
  const enterPlacementMode = useOasisStore(state => state.enterPlacementMode)
  const startAgentWork = useOasisStore(state => state.startAgentWork)
  const setAgentWorkTool = useOasisStore(state => state.setAgentWorkTool)
  const finishAgentWork = useOasisStore(state => state.finishAgentWork)
  const failAgentWork = useOasisStore(state => state.failAgentWork)

  const modelOptions = useMemo(() => {
    return config?.models?.length ? config.models : [...GEMINI_LIVE_MODELS]
  }, [config])

  const voiceOptions = useMemo(() => {
    return config?.voices?.length ? config.voices : [...GEMINI_LIVE_VOICES]
  }, [config])

  const appendMessage = useCallback((message: Omit<GeminiTranscriptMessage, 'id' | 'timestamp'> & Partial<Pick<GeminiTranscriptMessage, 'id' | 'timestamp'>>) => {
    const id = message.id || makeId(`gemini-${message.role}`)
    setMessages(current => [
      ...current,
      {
        ...message,
        id,
        timestamp: message.timestamp || Date.now(),
      },
    ].slice(-120))
    return id
  }, [])

  const updateMessage = useCallback((id: string, updater: (message: GeminiTranscriptMessage) => GeminiTranscriptMessage) => {
    setMessages(current => current.map(message => message.id === id ? updater(message) : message))
  }, [])

  const ensureUserMessage = useCallback(() => {
    if (userMessageIdRef.current) return userMessageIdRef.current
    const id = appendMessage({
      role: 'user',
      content: '',
      status: 'streaming',
    })
    userMessageIdRef.current = id
    return id
  }, [appendMessage])

  const ensureAssistantMessage = useCallback(() => {
    if (assistantMessageIdRef.current) return assistantMessageIdRef.current
    const id = appendMessage({
      role: 'assistant',
      content: '',
      status: 'streaming',
    })
    assistantMessageIdRef.current = id
    return id
  }, [appendMessage])

  const ensureToolMessage = useCallback((call: GeminiFunctionCall) => {
    const existingId = toolMessageByCallIdRef.current.get(call.id)
    if (existingId) return existingId
    const id = appendMessage({
      role: 'tool',
      content: '',
      status: 'streaming',
      toolCallId: call.id,
      toolName: call.name,
      toolState: 'running',
      toolInput: call.args,
      toolInputSummary: summarizeJson(call.args, 160),
    })
    toolMessageByCallIdRef.current.set(call.id, id)
    toolStartedAtRef.current.set(call.id, Date.now())
    return id
  }, [appendMessage])

  const clearOutputQueue = useCallback(() => {
    for (const source of outputSourcesRef.current) {
      try { source.stop() } catch {}
      try { source.disconnect() } catch {}
    }
    outputSourcesRef.current = []
    const ctx = outputAudioContextRef.current
    outputScheduleTimeRef.current = ctx ? ctx.currentTime : 0
    setSpeaking(false)
  }, [])

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

    const liveTransform = geminiAvatar?.id
      ? (getLiveObjectTransform(geminiAvatar.id) || transforms[geminiAvatar.id])
      : null
    const sourcePosition = Array.isArray(liveTransform?.position) && liveTransform.position.length >= 3
      ? [Number(liveTransform.position[0]), Number(liveTransform.position[1]) + 1.45, Number(liveTransform.position[2])] as [number, number, number]
      : geminiAvatar
        ? [geminiAvatar.position[0], geminiAvatar.position[1] + 1.45, geminiAvatar.position[2]] as [number, number, number]
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
  }, [geminiAvatar, panelSettings.spatialAudioEnabled, panelSettings.spatialAudioRange, transforms])

  const attachOutputStreamToLipSync = useCallback((stream: MediaStream | null) => {
    const ctrl = lipSyncRef.current
    if (!stream || !ctrl) return
    void resumeLipSyncContext().then(() => {
      if (lipSyncRef.current !== ctrl) return
      ctrl.attachStream(stream)
    }).catch(() => {})
  }, [])

  const reconnectOutputGraph = useCallback(() => {
    const ctx = outputAudioContextRef.current
    const gainNode = outputGainNodeRef.current
    const destination = outputDestinationRef.current
    if (!ctx || !gainNode || !destination) return

    try { gainNode.disconnect() } catch {}
    if (outputPannerNodeRef.current) {
      try { outputPannerNodeRef.current.disconnect() } catch {}
      outputPannerNodeRef.current = null
    }

    gainNode.gain.value = gainFromDb(panelSettings.gainDb)
    if (panelSettings.spatialAudioEnabled) {
      const panner = ctx.createPanner()
      outputPannerNodeRef.current = panner
      gainNode.connect(panner)
      panner.connect(ctx.destination)
      syncSpatialAudioFrame()
    } else {
      gainNode.connect(ctx.destination)
    }
    gainNode.connect(destination)
  }, [panelSettings.gainDb, panelSettings.spatialAudioEnabled, syncSpatialAudioFrame])

  const ensureOutputAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') return null
    let ctx = outputAudioContextRef.current
    if (!ctx || ctx.state === 'closed') {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      outputAudioContextRef.current = ctx
      outputScheduleTimeRef.current = ctx.currentTime
    }
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }

    if (!outputGainNodeRef.current) {
      outputGainNodeRef.current = ctx.createGain()
    }
    if (!outputDestinationRef.current) {
      outputDestinationRef.current = ctx.createMediaStreamDestination()
      if (audioRef.current) {
        audioRef.current.srcObject = outputDestinationRef.current.stream
        audioRef.current.muted = true
        void audioRef.current.play().catch(() => {})
      }
      attachOutputStreamToLipSync(outputDestinationRef.current.stream)
    }
    reconnectOutputGraph()
    return ctx
  }, [attachOutputStreamToLipSync, reconnectOutputGraph])

  const scheduleOutputAudio = useCallback(async (base64: string, mimeType: unknown) => {
    const ctx = await ensureOutputAudioContext()
    const gainNode = outputGainNodeRef.current
    if (!ctx || !gainNode) return

    const sampleRate = extractPcmSampleRate(mimeType, GEMINI_LIVE_OUTPUT_SAMPLE_RATE)
    const samples = Float32Array.from(pcm16Base64ToFloat32(base64))
    if (samples.length === 0) return

    const buffer = ctx.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(samples, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gainNode)
    outputSourcesRef.current.push(source)
    source.onended = () => {
      outputSourcesRef.current = outputSourcesRef.current.filter(entry => entry !== source)
      try { source.disconnect() } catch {}
      if (outputSourcesRef.current.length === 0) setSpeaking(false)
    }

    const startAt = Math.max(ctx.currentTime + 0.02, outputScheduleTimeRef.current)
    source.start(startAt)
    outputScheduleTimeRef.current = startAt + buffer.duration
    setSpeaking(true)
  }, [ensureOutputAudioContext])

  const stopMicrophone = useCallback(() => {
    const ws = websocketRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
      } catch {}
    }

    if (inputProcessorRef.current) {
      inputProcessorRef.current.onaudioprocess = null
      try { inputProcessorRef.current.disconnect() } catch {}
      inputProcessorRef.current = null
    }
    if (inputSourceRef.current) {
      try { inputSourceRef.current.disconnect() } catch {}
      inputSourceRef.current = null
    }
    if (inputSilentGainRef.current) {
      try { inputSilentGainRef.current.disconnect() } catch {}
      inputSilentGainRef.current = null
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(() => {})
      inputAudioContextRef.current = null
    }
    micStreamRef.current?.getTracks().forEach(track => track.stop())
    micStreamRef.current = null
    setListening(false)
  }, [])

  const stopOutputAudio = useCallback(() => {
    clearOutputQueue()
    if (outputGainNodeRef.current) {
      try { outputGainNodeRef.current.disconnect() } catch {}
      outputGainNodeRef.current = null
    }
    if (outputPannerNodeRef.current) {
      try { outputPannerNodeRef.current.disconnect() } catch {}
      outputPannerNodeRef.current = null
    }
    outputDestinationRef.current = null
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(() => {})
      outputAudioContextRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null
    }
    lipSyncRef.current?.detach()
  }, [clearOutputQueue])

  const disconnect = useCallback((options?: { silent?: boolean }) => {
    connectAttemptRef.current += 1
    const activeSession = sessionRef.current
    stopMicrophone()
    stopOutputAudio()

    const ws = websocketRef.current
    websocketRef.current = null
    if (ws) {
      try { ws.close() } catch {}
    }

    userMessageIdRef.current = ''
    assistantMessageIdRef.current = ''
    toolMessageByCallIdRef.current.clear()
    toolStartedAtRef.current.clear()
    setListening(false)
    setSpeaking(false)
    setSession(null)
    sessionRef.current = null
    if (activeSession?.sessionId) finishAgentWork(GEMINI_AGENT_TYPE, activeSession.sessionId)
    if (!options?.silent) {
      setConnectionState('stopped')
      setConnectionDetail('Stopped locally.')
      appendMessage({ role: 'system', content: 'Gemini Live conversation stopped.', status: 'done' })
    }
  }, [appendMessage, finishAgentWork, stopMicrophone, stopOutputAudio])

  const startMicrophone = useCallback(async (ws: WebSocket, attempt: number) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser microphone capture is unavailable.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    if (connectAttemptRef.current !== attempt || websocketRef.current !== ws) {
      stream.getTracks().forEach(track => track.stop())
      return
    }

    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('Web Audio is unavailable in this browser.')
    }

    const ctx = new AC()
    await ctx.resume().catch(() => {})
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const silentGain = ctx.createGain()
    silentGain.gain.value = 0

    processor.onaudioprocess = event => {
      if (connectAttemptRef.current !== attempt || ws.readyState !== WebSocket.OPEN) return
      const input = event.inputBuffer.getChannelData(0)
      const resampled = resampleFloat32(input, ctx.sampleRate, GEMINI_LIVE_INPUT_SAMPLE_RATE)
      if (resampled.length === 0) return
      ws.send(JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: `audio/pcm;rate=${GEMINI_LIVE_INPUT_SAMPLE_RATE}`,
            data: float32ToPcm16Base64(resampled),
          },
        },
      }))
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(ctx.destination)

    micStreamRef.current = stream
    inputAudioContextRef.current = ctx
    inputSourceRef.current = source
    inputProcessorRef.current = processor
    inputSilentGainRef.current = silentGain
    setListening(true)
  }, [])

  const executeGeminiToolCalls = useCallback(async (calls: GeminiFunctionCall[], ws: WebSocket, attempt: number) => {
    const responses: Array<{ id: string; name: string; response: Record<string, unknown> }> = []

    for (const call of calls) {
      const toolArgs: Record<string, unknown> = { ...call.args }
      if (!toolArgs.worldId && activeWorldId) toolArgs.worldId = activeWorldId
      if (call.name === 'walk_avatar_to' && !toolArgs.agentType && !toolArgs.agent) {
        toolArgs.agentType = GEMINI_AGENT_TYPE
      }
      if ((call.name === 'place_object' || call.name === 'create_spatial_web_object' || call.name === 'craft_scene') && !toolArgs.actorAgentType) {
        toolArgs.actorAgentType = GEMINI_AGENT_TYPE
      }

      const normalizedCall = { ...call, args: toolArgs }
      const messageId = ensureToolMessage(normalizedCall)
      const runId = call.id || makeId('gemini-tool')
      startAgentWork(GEMINI_AGENT_TYPE, runId, sessionRef.current?.sessionId)
      setAgentWorkTool(GEMINI_AGENT_TYPE, runId, call.name)

      let output: Record<string, unknown>
      if (!GEMINI_TOOL_NAMES.has(call.name)) {
        output = { ok: false, error: `Tool ${call.name} is unavailable in this Gemini Live session.` }
      } else {
        try {
          const response = await fetch('/api/oasis-tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: call.name,
              args: toolArgs,
            }),
          })
          const result = await response.json().catch(() => ({})) as Record<string, unknown>
          output = result
          updateMessage(messageId, message => ({
            ...message,
            status: 'done',
            toolState: response.ok && result.ok !== false ? 'done' : 'failed',
            toolOutput: result,
            toolDurationMs: Date.now() - (toolStartedAtRef.current.get(call.id) || Date.now()),
          }))
          if (response.ok && result.ok !== false) {
            finishAgentWork(GEMINI_AGENT_TYPE, runId)
          } else {
            failAgentWork(GEMINI_AGENT_TYPE, runId)
          }
        } catch (error) {
          output = {
            ok: false,
            error: error instanceof Error ? error.message : 'Gemini Live tool execution failed.',
          }
          updateMessage(messageId, message => ({
            ...message,
            status: 'done',
            toolState: 'failed',
            toolOutput: output,
            toolDurationMs: Date.now() - (toolStartedAtRef.current.get(call.id) || Date.now()),
          }))
          failAgentWork(GEMINI_AGENT_TYPE, runId)
        }
      }

      if (!GEMINI_TOOL_NAMES.has(call.name)) {
        updateMessage(messageId, message => ({
          ...message,
          status: 'done',
          toolState: 'failed',
          toolOutput: output,
          toolDurationMs: Date.now() - (toolStartedAtRef.current.get(call.id) || Date.now()),
        }))
        failAgentWork(GEMINI_AGENT_TYPE, runId)
      }

      responses.push({
        id: call.id,
        name: call.name,
        response: output,
      })
    }

    if (responses.length > 0 && connectAttemptRef.current === attempt && websocketRef.current === ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: responses,
        },
      }))
    }
  }, [activeWorldId, ensureToolMessage, failAgentWork, finishAgentWork, setAgentWorkTool, startAgentWork, updateMessage])

  const handleGeminiServerMessage = useCallback(async (payload: Record<string, unknown>, ws: WebSocket, attempt: number) => {
    if (payload.setupComplete !== undefined) {
      setConnectionState('connected')
      setConnectionDetail('Gemini Live is connected. Speak now.')
      appendMessage({ role: 'system', content: 'Gemini Live setup complete. Microphone is streaming.', status: 'done' })
      try {
        await startMicrophone(ws, attempt)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Microphone start failed.'
        setConnectionState('error')
        setConnectionDetail(message)
        appendMessage({ role: 'system', content: message, status: 'done' })
      }
      return
    }

    if (payload.error) {
      const detail = typeof payload.error === 'object' ? JSON.stringify(payload.error) : String(payload.error)
      setConnectionState('error')
      setConnectionDetail(detail)
      appendMessage({ role: 'system', content: detail, status: 'done' })
      return
    }

    if (payload.goAway && typeof payload.goAway === 'object') {
      appendMessage({ role: 'system', content: `Gemini goAway: ${JSON.stringify(payload.goAway)}`, status: 'done' })
    }

    if (payload.toolCallCancellation && typeof payload.toolCallCancellation === 'object') {
      const ids = Array.isArray((payload.toolCallCancellation as Record<string, unknown>).ids)
        ? (payload.toolCallCancellation as { ids: unknown[] }).ids.filter((id): id is string => typeof id === 'string')
        : []
      for (const id of ids) {
        const messageId = toolMessageByCallIdRef.current.get(id)
        if (!messageId) continue
        updateMessage(messageId, message => ({
          ...message,
          status: 'done',
          toolState: 'cancelled',
          content: 'Cancelled by Gemini.',
        }))
      }
    }

    const calls = extractGeminiCalls(payload)
    if (calls.length > 0) {
      void executeGeminiToolCalls(calls, ws, attempt)
    }

    const serverContent = payload.serverContent && typeof payload.serverContent === 'object'
      ? payload.serverContent as Record<string, unknown>
      : null
    if (!serverContent) return

    if (serverContent.interrupted) {
      clearOutputQueue()
      const assistantId = assistantMessageIdRef.current
      if (assistantId) {
        updateMessage(assistantId, message => ({ ...message, status: 'done' }))
        assistantMessageIdRef.current = ''
      }
      return
    }

    const inputText = typeof (serverContent.inputTranscription as Record<string, unknown> | undefined)?.text === 'string'
      ? String((serverContent.inputTranscription as Record<string, unknown>).text)
      : ''
    if (inputText) {
      const messageId = ensureUserMessage()
      updateMessage(messageId, message => ({
        ...message,
        content: `${message.content}${inputText}`,
        status: 'streaming',
      }))
    }

    const outputText = typeof (serverContent.outputTranscription as Record<string, unknown> | undefined)?.text === 'string'
      ? String((serverContent.outputTranscription as Record<string, unknown>).text)
      : ''
    if (outputText) {
      const userId = userMessageIdRef.current
      if (userId) {
        updateMessage(userId, message => ({ ...message, status: 'done' }))
        userMessageIdRef.current = ''
      }
      const messageId = ensureAssistantMessage()
      updateMessage(messageId, message => ({
        ...message,
        content: `${message.content}${outputText}`,
        status: 'streaming',
      }))
    }

    const modelTurn = serverContent.modelTurn && typeof serverContent.modelTurn === 'object'
      ? serverContent.modelTurn as Record<string, unknown>
      : null
    const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : []
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string' && record.text) {
        const messageId = ensureAssistantMessage()
        updateMessage(messageId, message => ({
          ...message,
          content: `${message.content}${record.text}`,
          status: 'streaming',
        }))
      }
      const inlineData = record.inlineData && typeof record.inlineData === 'object'
        ? record.inlineData as Record<string, unknown>
        : null
      const data = typeof inlineData?.data === 'string' ? inlineData.data : ''
      const mimeType = typeof inlineData?.mimeType === 'string' ? inlineData.mimeType : ''
      if (data && mimeType.includes('audio')) {
        void scheduleOutputAudio(data, mimeType)
      } else if (data && !mimeType) {
        const maybeBytes = base64ToBytes(data)
        if (maybeBytes.byteLength > 0) void scheduleOutputAudio(data, `audio/pcm;rate=${GEMINI_LIVE_OUTPUT_SAMPLE_RATE}`)
      }
    }

    if (serverContent.generationComplete || serverContent.turnComplete) {
      const assistantId = assistantMessageIdRef.current
      if (assistantId) {
        updateMessage(assistantId, message => ({ ...message, status: 'done' }))
        assistantMessageIdRef.current = ''
      }
      const userId = userMessageIdRef.current
      if (userId) {
        updateMessage(userId, message => ({ ...message, status: 'done' }))
        userMessageIdRef.current = ''
      }
    }
  }, [
    appendMessage,
    clearOutputQueue,
    ensureAssistantMessage,
    ensureUserMessage,
    executeGeminiToolCalls,
    scheduleOutputAudio,
    startMicrophone,
    updateMessage,
  ])

  const startSession = useCallback(async () => {
    if (connectionState === 'starting' || connectionState === 'connected') return
    disconnect({ silent: true })
    const attempt = connectAttemptRef.current
    setConnectionState('starting')
    setConnectionDetail('Minting Gemini Live token.')
    setSession(null)
    sessionRef.current = null

    try {
      const response = await fetch('/api/gemini-live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          voice: selectedVoice,
          systemInstruction: systemPrompt,
          worldId: activeWorldId,
          worldName: activeWorldName,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || `Session request failed (${response.status})`)
      }

      const manifest = payload as GeminiLiveSessionPayload
      sessionRef.current = manifest
      setSession(manifest)
      startAgentWork(GEMINI_AGENT_TYPE, manifest.sessionId, manifest.sessionId)
      appendMessage({ role: 'system', content: `Ephemeral token ready for ${manifest.model} / ${manifest.voice}.`, status: 'done' })
      setConnectionDetail('Opening Gemini Live WebSocket.')

      const ws = new WebSocket(buildGeminiWebSocketUrl(manifest.websocketEndpoint, manifest.accessToken))
      websocketRef.current = ws

      ws.onopen = () => {
        if (connectAttemptRef.current !== attempt) {
          try { ws.close() } catch {}
          return
        }
        setConnectionDetail('Sending Live setup.')
        ws.send(JSON.stringify(manifest.setupMessage))
      }

      ws.onmessage = event => {
        void (async () => {
          let text = ''
          if (typeof event.data === 'string') {
            text = event.data
          } else if (event.data instanceof Blob) {
            text = await event.data.text()
          } else if (event.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(event.data)
          }
          if (!text) return
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(text) as Record<string, unknown>
          } catch {
            return
          }
          if (connectAttemptRef.current !== attempt || websocketRef.current !== ws) return
          await handleGeminiServerMessage(parsed, ws, attempt)
        })()
      }

      ws.onerror = () => {
        if (connectAttemptRef.current !== attempt) return
        setConnectionState('error')
        setConnectionDetail('Gemini Live WebSocket error.')
        appendMessage({ role: 'system', content: 'Gemini Live WebSocket error.', status: 'done' })
        failAgentWork(GEMINI_AGENT_TYPE, manifest.sessionId)
      }

      ws.onclose = event => {
        if (connectAttemptRef.current !== attempt) return
        stopMicrophone()
        clearOutputQueue()
        finishAgentWork(GEMINI_AGENT_TYPE, manifest.sessionId)
        websocketRef.current = null
        sessionRef.current = null
        setSession(null)
        setConnectionState(event.wasClean ? 'stopped' : 'error')
        setConnectionDetail(event.wasClean ? 'Gemini Live socket closed.' : `Gemini Live socket closed (${event.code}).`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnectionState('error')
      setConnectionDetail(message)
      appendMessage({ role: 'system', content: `Session start failed: ${message}`, status: 'done' })
    }
  }, [
    activeWorldId,
    activeWorldName,
    appendMessage,
    clearOutputQueue,
    connectionState,
    disconnect,
    failAgentWork,
    finishAgentWork,
    handleGeminiServerMessage,
    selectedModel,
    selectedVoice,
    startAgentWork,
    stopMicrophone,
    systemPrompt,
  ])

  const placeGeminiWindow = useCallback(() => {
    enterPlacementMode({
      type: 'agent',
      name: 'Gemini',
      agentType: GEMINI_AGENT_TYPE,
      agentRenderMode: 'live-html',
    })
    if (!embedded) onClose()
  }, [embedded, enterPlacementMode, onClose])

  const toggleToolExpanded = useCallback((messageId: string) => {
    setExpandedToolIds(current =>
      current.includes(messageId)
        ? current.filter(id => id !== messageId)
        : [...current, messageId],
    )
  }, [])

  useEffect(() => {
    if (!isOpen && !embedded) return
    let cancelled = false
    setConfigError('')

    fetch('/api/gemini-live/config', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(payload?.error || `Config request failed (${response.status})`)
        }
        return payload as GeminiLiveConfigPayload
      })
      .then(payload => {
        if (cancelled) return
        setConfig(payload)
        setSelectedModel(current => payload.models.includes(current) ? current : payload.model)
        setSelectedVoice(current => payload.voices.includes(current) ? current : payload.defaultVoice)
        setSystemPrompt(current => current.trim() ? current : payload.promptTemplate)
      })
      .catch(error => {
        if (cancelled) return
        setConfigError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [embedded, isOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(GEMINI_LIVE_PANEL_SETTINGS_KEY, JSON.stringify(panelSettings))
    } catch {}
  }, [panelSettings])

  useEffect(() => {
    reconnectOutputGraph()
  }, [reconnectOutputGraph])

  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

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
    if (!geminiAvatar?.id) return
    const ctrl = createLipSyncController()
    lipSyncRef.current = ctrl
    registerLipSync(geminiAvatar.id, ctrl)
    attachOutputStreamToLipSync(outputDestinationRef.current?.stream || null)

    return () => {
      unregisterLipSync(geminiAvatar.id, ctrl)
      ctrl.detach()
      if (lipSyncRef.current === ctrl) lipSyncRef.current = null
    }
  }, [attachOutputStreamToLipSync, geminiAvatar?.id])

  useEffect(() => {
    return () => disconnect({ silent: true })
  }, [disconnect])

  const configured = Boolean(config?.configured)
  const canStart = configured && connectionState !== 'starting' && connectionState !== 'connected'
  const containerStyle = embedded
    ? {
        position: 'relative' as const,
        width: '100%',
        height: '100%',
        borderRadius: 0,
      }
    : {
        position: 'fixed' as const,
        top: 92,
        left: 88,
        width: 500,
        maxWidth: 'calc(100vw - 112px)',
        height: 'min(790px, calc(100vh - 128px))',
        borderRadius: 16,
        zIndex: 9998,
      }

  const tabButton = (tab: GeminiPanelTab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      className="rounded-lg border px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.14em] transition"
      style={{
        borderColor: activeTab === tab ? 'rgba(34,211,238,0.42)' : 'rgba(148,163,184,0.18)',
        background: activeTab === tab ? 'rgba(34,211,238,0.16)' : 'rgba(15,23,42,0.36)',
        color: activeTab === tab ? '#cffafe' : 'rgba(224,242,254,0.62)',
      }}
    >
      {label}
    </button>
  )

  const streamTab = (
    <>
      <div className="border-b px-4 py-3" style={{ borderColor: 'rgba(34,211,238,0.12)', background: 'rgba(2,6,23,0.22)' }}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-100/62">
          <span>env: {configured ? 'configured' : 'missing'}</span>
          <span>transport: {session?.transport || 'idle'}</span>
          <span>tools: {config?.toolDeclarations.length ?? 0}</span>
        </div>
        <div className="mt-2 text-[12px] leading-5 text-cyan-50/82">{connectionDetail}</div>
        {configError && <div className="mt-2 text-[12px] text-rose-300">{configError}</div>}
        {config && !configured && (
          <div className="mt-2 text-[12px] text-amber-300">GEMINI_API_KEY is missing on the server.</div>
        )}
      </div>

      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map(message => {
          const tone = messageTone(message.role)
          const expanded = expandedToolIds.includes(message.id)
          return (
            <div
              key={message.id}
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: tone.border, background: tone.background }}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.16em]">
                <span style={{ color: tone.label }}>
                  {message.role === 'tool' && message.toolName ? `${message.toolName} / ${message.toolState || 'tool'}` : message.role}
                </span>
                <span className="text-cyan-100/35">{formatTimestamp(message.timestamp)}</span>
              </div>
              {message.role === 'tool' ? (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleToolExpanded(message.id)}
                    className="w-full rounded-lg border px-2 py-1.5 text-left text-[11px] text-amber-100/82"
                    style={{ borderColor: 'rgba(245,158,11,0.22)', background: 'rgba(15,23,42,0.3)' }}
                  >
                    {message.toolInputSummary || message.toolName || 'tool call'}
                  </button>
                  {expanded && (
                    <pre className="mt-2 max-h-56 overflow-auto rounded-lg border p-2 text-[10px] leading-4 text-cyan-50/78" style={{ borderColor: 'rgba(148,163,184,0.18)', background: 'rgba(2,6,23,0.42)' }}>
                      {JSON.stringify({ input: message.toolInput, output: message.toolOutput, durationMs: message.toolDurationMs }, null, 2)}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-[13px] leading-5 text-cyan-50/90">{message.content || (message.status === 'streaming' ? '...' : '')}</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t px-4 py-4" style={{ borderColor: 'rgba(34,211,238,0.12)', background: 'rgba(2,6,23,0.32)' }}>
        <button
          onClick={connectionState === 'connected' || connectionState === 'starting' ? () => disconnect() : startSession}
          disabled={connectionState === 'connected' || connectionState === 'starting' ? false : !canStart}
          className="w-full rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] transition disabled:opacity-40"
          style={{
            borderColor: connectionState === 'connected' || connectionState === 'starting' ? 'rgba(251,146,60,0.36)' : 'rgba(34,211,238,0.32)',
            background: connectionState === 'connected' || connectionState === 'starting'
              ? 'rgba(124,45,18,0.2)'
              : 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(16,185,129,0.18))',
            color: connectionState === 'connected' || connectionState === 'starting' ? '#fed7aa' : '#cffafe',
          }}
        >
          {connectionState === 'connected' ? 'Stop Conversation' : connectionState === 'starting' ? 'Cancel Start' : 'Start Conversation'}
        </button>
      </div>
    </>
  )

  const configTab = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        model
        <select
          value={selectedModel}
          disabled={connectionState === 'starting' || connectionState === 'connected'}
          onChange={event => setSelectedModel(event.target.value)}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-xs outline-none disabled:opacity-50"
          style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(8,13,24,0.92)', color: '#ecfeff' }}
        >
          {modelOptions.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      </label>

      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        voice
        <select
          value={selectedVoice}
          disabled={connectionState === 'starting' || connectionState === 'connected'}
          onChange={event => setSelectedVoice(event.target.value)}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-xs outline-none disabled:opacity-50"
          style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(8,13,24,0.92)', color: '#ecfeff' }}
        >
          {voiceOptions.map(voice => (
            <option key={voice} value={voice}>{voice}</option>
          ))}
        </select>
      </label>

      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        system prompt
        <textarea
          value={systemPrompt}
          disabled={connectionState === 'starting' || connectionState === 'connected'}
          onChange={event => setSystemPrompt(event.target.value)}
          className="mt-1 h-72 w-full resize-none rounded-lg border px-3 py-2 text-xs leading-5 outline-none disabled:opacity-50"
          style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(8,13,24,0.92)', color: '#ecfeff' }}
        />
      </label>

      <button
        onClick={placeGeminiWindow}
        className="rounded-lg border px-3 py-2 text-[10px] font-mono uppercase tracking-[0.14em] transition hover:-translate-y-0.5"
        style={{ borderColor: 'rgba(16,185,129,0.28)', background: 'rgba(6,78,59,0.22)', color: '#bbf7d0' }}
      >
        place 3D
      </button>
    </div>
  )

  const settingsTab = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        bg color
        <input
          type="color"
          value={panelSettings.bgColor}
          onChange={event => setPanelSettings(current => clampGeminiLivePanelSettings({ ...current, bgColor: event.target.value }))}
          className="mt-1 h-10 w-full rounded-lg border"
          style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(8,13,24,0.92)' }}
        />
      </label>

      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        opacity {Math.round(panelSettings.opacity * 100)}%
        <input
          type="range"
          min="0.25"
          max="1"
          step="0.01"
          value={panelSettings.opacity}
          onChange={event => setPanelSettings(current => clampGeminiLivePanelSettings({ ...current, opacity: Number(event.target.value) }))}
          className="mt-2 w-full"
        />
      </label>

      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        volume boost {panelSettings.gainDb.toFixed(0)} db
        <input
          type="range"
          min="-12"
          max="20"
          step="1"
          value={panelSettings.gainDb}
          onChange={event => setPanelSettings(current => clampGeminiLivePanelSettings({ ...current, gainDb: Number(event.target.value) }))}
          className="mt-2 w-full"
        />
      </label>

      <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/70">
        <input
          type="checkbox"
          checked={panelSettings.spatialAudioEnabled}
          onChange={event => setPanelSettings(current => clampGeminiLivePanelSettings({ ...current, spatialAudioEnabled: event.target.checked }))}
        />
        spatial sound
      </label>

      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
        max range {panelSettings.spatialAudioRange.toFixed(0)}m
        <input
          type="range"
          min="6"
          max="100"
          step="1"
          value={panelSettings.spatialAudioRange}
          disabled={!panelSettings.spatialAudioEnabled}
          onChange={event => setPanelSettings(current => clampGeminiLivePanelSettings({ ...current, spatialAudioRange: Number(event.target.value) }))}
          className="mt-2 w-full disabled:opacity-40"
        />
      </label>
    </div>
  )

  const panelBody = (
    <div
      data-ui-panel=""
      className="flex flex-col overflow-hidden border shadow-2xl"
      style={{
        ...containerStyle,
        borderColor: 'rgba(34,211,238,0.22)',
        background: rgbaFromHex(panelSettings.bgColor, panelSettings.opacity),
        boxShadow: embedded ? 'none' : '0 22px 80px rgba(0,0,0,0.55), 0 0 40px rgba(34,211,238,0.16)',
        color: '#e0f2fe',
      }}
    >
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'rgba(34,211,238,0.16)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-black" style={{ borderColor: 'rgba(34,211,238,0.34)', color: '#67e8f9', background: 'rgba(8,51,68,0.3)' }}>
              G
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100">Gemini Live Lab</div>
              <div className="text-[11px] text-cyan-100/55">{activeWorldName}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge state={connectionState} listening={listening} speaking={speaking} />
          {!hideCloseButton && !embedded && (
            <button
              onClick={onClose}
              className="rounded-lg border px-2 py-1 text-xs text-cyan-100/70 transition hover:text-white"
              style={{ borderColor: 'rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.35)' }}
              aria-label="Close Gemini Live lab"
            >
              x
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b px-4 py-3" style={{ borderColor: 'rgba(34,211,238,0.12)', background: 'rgba(2,6,23,0.24)' }}>
        {tabButton('stream', 'stream')}
        {tabButton('config', 'config')}
        {tabButton('settings', 'settings')}
      </div>

      {activeTab === 'stream' ? streamTab : activeTab === 'config' ? configTab : settingsTab}
    </div>
  )

  if (embedded) return panelBody
  if (!isOpen || typeof document === 'undefined') return null
  return createPortal(panelBody, document.body)
}

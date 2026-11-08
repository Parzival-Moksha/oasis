import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { registerLipSync, unregisterLipSync, resumeLipSyncContext, type LipSyncController } from '@/lib/lip-sync'
import { PLAYER_AVATAR_LIPSYNC_ID } from '@/lib/player-avatar-runtime'
import { createWLipSyncLegacyController } from '@/lib/wlipsync-driver'
import {
  isLiveDictationSupported,
  joinDictation,
  startLiveDictation,
  type DictationLine,
  type LiveDictation,
} from '@/lib/voice/live-dictation'

// ░▒▓ The mic on every agent text box: live dictation (Moonshine Medium Streaming in the agent engine). ▓▒░
// Words arrive while you talk (onLiveText); the whole dictation goes to onTranscript once it has settled.
// Replaced the record-then-transcribe faster-whisper path (2026-11-08): that one waited for the whole
// clip and took ~20 s to load and read it.

export type VoiceBackendState = 'idle' | 'loading' | 'ready' | 'error'

export interface UseAgentVoiceInputOptions {
  enabled?: boolean
  /** Kept for old call sites; live dictation goes to the agent engine instead. */
  transcribeEndpoint?: string
  statusEndpoint?: string
  onTranscript: (transcript: string) => void
  /** The dictation so far, every time a line grows or settles (empty string when it starts). */
  onLiveText?: (text: string) => void
  focusTargetRef?: RefObject<{ focus: () => void } | null>
  enablePlayerLipSync?: boolean
  lang?: string
}

export interface AgentVoiceInputController {
  supported: boolean
  ready: boolean
  warming: boolean
  backendState: VoiceBackendState
  backendMessage: string
  listening: boolean
  transcribing: boolean
  /** Mic loudness 0..1, for a level meter (live dictation only). */
  level?: number
  error: string
  clearError: () => void
  stop: () => void
  toggle: () => Promise<void>
}

export function useAgentVoiceInput({
  enabled = true,
  onTranscript,
  onLiveText,
  focusTargetRef,
  enablePlayerLipSync = false,
  lang = 'en',
}: UseAgentVoiceInputOptions): AgentVoiceInputController {
  const dictationRef = useRef<LiveDictation | null>(null)
  const startingRef = useRef(false)
  const linesRef = useRef(new Map<number, DictationLine>())
  const lipSyncRef = useRef<LipSyncController | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onLiveTextRef = useRef(onLiveText)
  onTranscriptRef.current = onTranscript
  onLiveTextRef.current = onLiveText

  const [supported, setSupported] = useState(false)
  const [backendState, setBackendState] = useState<VoiceBackendState>('idle')
  const [backendMessage, setBackendMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState('')

  const stopPlayerLipSync = useCallback(() => {
    const ctrl = lipSyncRef.current
    if (!ctrl) return
    unregisterLipSync(PLAYER_AVATAR_LIPSYNC_ID, ctrl)
    ctrl.detach()
    lipSyncRef.current = null
  }, [])

  const startPlayerLipSync = useCallback(async (stream: MediaStream) => {
    if (!enablePlayerLipSync) return
    let ctrl = lipSyncRef.current
    if (!ctrl) {
      ctrl = createWLipSyncLegacyController()
      lipSyncRef.current = ctrl
    }
    registerLipSync(PLAYER_AVATAR_LIPSYNC_ID, ctrl)
    await resumeLipSyncContext().catch(() => null)
    if (lipSyncRef.current !== ctrl) return
    ctrl.attachStream(stream)
  }, [enablePlayerLipSync])

  const clearError = useCallback(() => setError(''), [])

  const stop = useCallback(() => {
    const dictation = dictationRef.current
    if (!dictation) return
    setListening(false)
    setTranscribing(true)
    stopPlayerLipSync()
    dictation.stop()
  }, [stopPlayerLipSync])

  const toggle = useCallback(async () => {
    if (!enabled) return
    if (dictationRef.current) {
      stop()
      return
    }
    if (startingRef.current) return
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setError('Mic input needs localhost or HTTPS. Open Oasis locally or behind HTTPS and try again.')
      return
    }
    if (!isLiveDictationSupported()) {
      setError('Browser microphone capture is unavailable here.')
      return
    }
    setError('')
    linesRef.current = new Map()
    startingRef.current = true
    setBackendState('loading')
    setBackendMessage('Connecting to the voice helper…')
    onLiveTextRef.current?.('')
    let finished = false
    try {
      const dictation = await startLiveDictation({
        lang,
        onStream: stream => { void startPlayerLipSync(stream) },
        onStatus: text => { setBackendState('loading'); setBackendMessage(text) },
        onReady: () => { setBackendState('ready'); setBackendMessage('') },
        onLevel: value => setLevel(value),
        onError: text => { setError(text); setBackendState('error'); setBackendMessage(text) },
        onLine: line => {
          linesRef.current.set(line.line, line)
          if (line.text) setBackendState('ready')
          onLiveTextRef.current?.(joinDictation(linesRef.current))
        },
        onDone: () => {
          finished = true
          dictationRef.current = null
          setListening(false)
          setTranscribing(false)
          setLevel(0)
          stopPlayerLipSync()
          setBackendState(current => (current === 'error' ? current : 'idle'))
          setBackendMessage('')
          const transcript = joinDictation(linesRef.current)
          if (transcript) {
            onTranscriptRef.current(transcript)
            window.setTimeout(() => focusTargetRef?.current?.focus(), 80)
          }
        },
      })
      if (!finished) {
        dictationRef.current = dictation
        setListening(true)
      }
    } catch (nextError) {
      stopPlayerLipSync()
      setListening(false)
      setBackendState('error')
      setError(nextError instanceof Error ? nextError.message : 'Unable to access the microphone.')
    } finally {
      startingRef.current = false
    }
  }, [enabled, focusTargetRef, lang, startPlayerLipSync, stop, stopPlayerLipSync])

  useEffect(() => {
    setSupported(isLiveDictationSupported())
  }, [enabled])

  useEffect(() => {
    if (enabled) return
    dictationRef.current?.cancel()
    dictationRef.current = null
    stopPlayerLipSync()
    setListening(false)
  }, [enabled, stopPlayerLipSync])

  useEffect(() => () => {
    dictationRef.current?.cancel()
    dictationRef.current = null
    stopPlayerLipSync()
  }, [stopPlayerLipSync])

  return {
    supported,
    // The helper wakes on the first press; the button is always usable.
    ready: supported,
    warming: false,
    backendState,
    backendMessage,
    listening,
    transcribing,
    level,
    error,
    clearError,
    stop,
    toggle,
  }
}

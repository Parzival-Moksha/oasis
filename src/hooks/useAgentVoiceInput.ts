import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { VoiceBackendState } from '@/lib/voice/local-stt'

export interface UseAgentVoiceInputOptions {
  enabled?: boolean
  transcribeEndpoint: string
  statusEndpoint?: string
  onTranscript: (transcript: string) => void
  focusTargetRef?: RefObject<{ focus: () => void } | null>
}

export interface AgentVoiceInputController {
  supported: boolean
  ready: boolean
  warming: boolean
  backendState: VoiceBackendState
  backendMessage: string
  listening: boolean
  transcribing: boolean
  error: string
  clearError: () => void
  stop: () => void
  toggle: () => Promise<void>
}

interface VoiceBackendRefreshResult {
  state: VoiceBackendState
  message: string
}

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function isVoiceInputSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

function preferredRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return RECORDER_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

export function useAgentVoiceInput({
  enabled = true,
  transcribeEndpoint,
  statusEndpoint = transcribeEndpoint,
  onTranscript,
  focusTargetRef,
}: UseAgentVoiceInputOptions): AgentVoiceInputController {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  const [supported, setSupported] = useState(false)
  const [backendState, setBackendState] = useState<VoiceBackendState>('idle')
  const [backendMessage, setBackendMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState('')

  const stopRecordingStream = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
    recordingStreamRef.current = null
  }, [])

  const clearError = useCallback(() => {
    setError('')
  }, [])

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])

  const transcribeRecordedAudio = useCallback(async (audioBlob: Blob, fileName: string) => {
    setTranscribing(true)
    setError('')

    try {
      const form = new FormData()
      form.append('audio', audioBlob, fileName)

      const response = await fetch(transcribeEndpoint, {
        method: 'POST',
        body: form,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }

      const transcript = typeof data?.transcript === 'string' ? data.transcript.trim() : ''
      if (!transcript) {
        throw new Error('The transcription backend returned an empty transcript.')
      }

      onTranscript(transcript)
      window.setTimeout(() => focusTargetRef?.current?.focus(), 80)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Voice transcription failed.')
    } finally {
      setTranscribing(false)
    }
  }, [focusTargetRef, onTranscript, transcribeEndpoint])

  const refreshBackendStatus = useCallback(async (options?: { warm?: boolean }): Promise<VoiceBackendRefreshResult> => {
    if (!enabled || !isVoiceInputSupported()) {
      setBackendState('idle')
      setBackendMessage('')
      return {
        state: 'idle',
        message: '',
      }
    }

    if (options?.warm) {
      setBackendState(current => current === 'ready' ? current : 'loading')
    }

    try {
      const url = new URL(statusEndpoint, window.location.origin)
      if (options?.warm) {
        url.searchParams.set('warm', '1')
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }

      const nextState = data?.state === 'ready' || data?.state === 'loading' || data?.state === 'error'
        ? data.state as VoiceBackendState
        : 'idle'
      const nextMessage = typeof data?.message === 'string' ? data.message : ''

      setBackendState(nextState)
      setBackendMessage(nextMessage)
      if (nextState === 'ready') {
        setError(current => (
          current === 'Voice model is still loading. Wait for mic ready and try again.'
            ? ''
            : current
        ))
      }
      return {
        state: nextState,
        message: nextMessage,
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Unable to load the voice model.'
      setBackendState('error')
      setBackendMessage(message)
      return {
        state: 'error',
        message,
      }
    }
  }, [enabled, statusEndpoint])

  const toggle = useCallback(async () => {
    if (!enabled) return

    if (listening) {
      mediaRecorderRef.current?.stop()
      return
    }

    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setError('Mic input needs localhost or HTTPS. Open Oasis locally or behind HTTPS and try again.')
      return
    }

    if (!isVoiceInputSupported()) {
      setError('Browser microphone capture is unavailable here.')
      return
    }

    const statusResult = backendState === 'ready'
      ? { state: 'ready' as const, message: backendMessage }
      : await refreshBackendStatus({ warm: true })
    if (statusResult.state !== 'ready') {
      setError(statusResult.message || 'Voice model is still loading. Wait for mic ready and try again.')
      return
    }

    setError('')

    try {
      const permissionStatus = typeof navigator.permissions?.query === 'function'
        ? await navigator.permissions.query({ name: 'microphone' as PermissionName })
        : null
      if (permissionStatus?.state === 'denied') {
        setError('Microphone access is blocked in the browser. In Brave, click the lock icon in the address bar and allow the microphone for this site.')
        return
      }
    } catch {
      // Permissions API is optional.
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordingStreamRef.current = stream

      const recorderMimeType = preferredRecorderMimeType()
      const recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream)

      recordedChunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setListening(false)
        stopRecordingStream()
        setError('Microphone recording failed.')
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || recorderMimeType || 'audio/webm'
        const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm'
        const audioBlob = new Blob(recordedChunksRef.current, { type: mimeType })
        recordedChunksRef.current = []
        mediaRecorderRef.current = null
        setListening(false)
        stopRecordingStream()
        if (audioBlob.size > 0) {
          void transcribeRecordedAudio(audioBlob, `oasis-voice.${extension}`)
        }
      }

      recorder.start()
      setListening(true)
    } catch (nextError) {
      stopRecordingStream()
      const message = nextError instanceof Error ? nextError.message : 'Unable to access the microphone.'
      setListening(false)
      setError(message)
    }
  }, [backendMessage, backendState, enabled, listening, refreshBackendStatus, stopRecordingStream, transcribeRecordedAudio])

  useEffect(() => {
    setSupported(isVoiceInputSupported())
  }, [enabled])

  useEffect(() => {
    if (!enabled || !supported) {
      setBackendState('idle')
      setBackendMessage('')
      return
    }

    void refreshBackendStatus()
  }, [enabled, refreshBackendStatus, supported])

  useEffect(() => {
    if (enabled) return
    recordedChunksRef.current = []
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    stopRecordingStream()
    setListening(false)
  }, [enabled, stopRecordingStream])

  useEffect(() => {
    return () => {
      recordedChunksRef.current = []
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      stopRecordingStream()
    }
  }, [stopRecordingStream])

  return {
    supported,
    ready: backendState === 'ready',
    warming: backendState === 'loading',
    backendState,
    backendMessage,
    listening,
    transcribing,
    error,
    clearError,
    stop,
    toggle,
  }
}

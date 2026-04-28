'use client'

import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  DEFAULT_LIP_SYNC_TUNING,
  createLipSyncController,
  registerLipSync,
  resumeLipSyncContext,
  unregisterLipSync,
  type LipSyncController,
  type LipSyncState,
  type LipSyncTuning,
} from '../../lib/lip-sync'
import {
  buildCharacterMouthTimeline,
  mapMouthWeightsToLegacyLipSyncState,
  sampleMouthTimeline,
  type ElevenLabsAlignment,
} from '../../lib/lip-sync-lab'

export type MediaType = 'image' | 'audio' | 'video'

type GalleryMediaType = Extract<MediaType, 'image' | 'video'>
const LOCAL_GENERATED_MEDIA_PATHS = [
  '/generated-images/',
  '/generated-voices/',
  '/generated-videos/',
  '/generated-music/',
  '/merlin/screenshots/',
]
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

interface GeneratedVoiceTimingData {
  alignment: ElevenLabsAlignment | null
  normalizedAlignment: ElevenLabsAlignment | null
}

const generatedVoiceTimingCache = new Map<string, GeneratedVoiceTimingData | null>()
const ZERO_LIP_SYNC_STATE: LipSyncState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

interface GalleryEntry {
  url: string
  mediaType: GalleryMediaType
  prompt?: string
}

interface GalleryState {
  entries: GalleryEntry[]
  index: number
}

interface MediaBubbleProps {
  url: string
  mediaType: MediaType
  prompt?: string
  compact?: boolean
  autoPlay?: boolean
  avatarLipSyncTargetId?: string | null
  galleryScopeId?: string
}

export function resolveMediaUrl(url: string): string {
  if (typeof window !== 'undefined') {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url
    if (url.startsWith('http')) {
      try {
        const parsed = new URL(url)
        const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname)
        if ((isLoopback || parsed.origin === window.location.origin) && isLocalGeneratedMediaPath(parsed.pathname)) {
          return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
        }
      } catch {
        return url
      }
      return url
    }

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
    const normalizedUrl = url.startsWith(basePath) || !url.startsWith('/')
      ? url
      : `${basePath}${url}`
    return `${window.location.origin}${normalizedUrl}`
  }
  return url
}

export function isLocalGeneratedMediaPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase()
  return LOCAL_GENERATED_MEDIA_PATHS.some(path => normalized.includes(path))
}

export function shouldProxyMediaUrl(url: string, mediaType: MediaType): boolean {
  if (mediaType === 'video') return false
  if (typeof window === 'undefined') return false

  const resolved = resolveMediaUrl(url)
  if (!resolved || resolved.startsWith('blob:') || resolved.startsWith('data:')) return false

  try {
    const parsed = new URL(resolved, window.location.origin)
    const sameOrigin = parsed.origin === window.location.origin
    const isGeneratedMedia = isLocalGeneratedMediaPath(parsed.pathname)
    return sameOrigin && isGeneratedMedia
  } catch {
    return false
  }
}

function stripBasePath(pathname: string): string {
  if (OASIS_BASE && pathname.startsWith(OASIS_BASE)) {
    return pathname.slice(OASIS_BASE.length) || '/'
  }
  return pathname
}

export function resolveGeneratedVoiceLookupPath(url: string): string | null {
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const resolved = new URL(resolveMediaUrl(url), baseOrigin)
    const normalizedPath = stripBasePath(resolved.pathname)
    if (!normalizedPath.startsWith('/generated-voices/')) return null
    return normalizedPath
  } catch {
    return null
  }
}

async function fetchGeneratedVoiceTimingData(lookupPath: string): Promise<GeneratedVoiceTimingData | null> {
  if (generatedVoiceTimingCache.has(lookupPath)) {
    return generatedVoiceTimingCache.get(lookupPath) ?? null
  }

  const response = await fetch(
    `${OASIS_BASE}/api/media/voice/timestamps?url=${encodeURIComponent(lookupPath)}`,
    { cache: 'no-store' },
  )
  if (!response.ok) {
    throw new Error(`Generated voice metadata lookup failed: HTTP ${response.status}`)
  }

  const payload = await response.json() as { clip?: GeneratedVoiceTimingData | null }
  const clip = payload.clip || null
  generatedVoiceTimingCache.set(lookupPath, clip)
  return clip
}

function createTimedLipSyncController(timing: GeneratedVoiceTimingData): LipSyncController {
  const preferredAlignment = timing.normalizedAlignment || timing.alignment
  const timeline = buildCharacterMouthTimeline(preferredAlignment)
  let active = false
  let currentElement: HTMLMediaElement | null = null

  return {
    get isActive() {
      return active
    },
    attachAudio(el: HTMLMediaElement) {
      currentElement = el
      active = true
    },
    attachStream(_stream: MediaStream) {
      currentElement = null
      active = false
    },
    configure(_tuning: Partial<LipSyncTuning>) {
      // Timing-driven clips do not use FFT tuning.
    },
    getTuning() {
      return { ...DEFAULT_LIP_SYNC_TUNING }
    },
    update(): LipSyncState {
      if (!active || !currentElement || !timeline.cues.length) return { ...ZERO_LIP_SYNC_STATE }
      if (currentElement.paused || currentElement.ended) return { ...ZERO_LIP_SYNC_STATE }

      const weights = sampleMouthTimeline(timeline, currentElement.currentTime, {
        intensity: 1,
        crossfadeSeconds: 0.07,
      })
      return mapMouthWeightsToLegacyLipSyncState(weights)
    },
    detach() {
      currentElement = null
      active = false
    },
  }
}

function normalizeGalleryPrompt(prompt?: string): string | undefined {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : ''
  return trimmed || undefined
}

function isGalleryMediaType(mediaType: MediaType): mediaType is GalleryMediaType {
  return mediaType === 'image' || mediaType === 'video'
}

function readGalleryEntries(scopeId: string): GalleryEntry[] {
  if (typeof document === 'undefined' || !scopeId) return []

  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-media-gallery-scope][data-media-gallery-url][data-media-gallery-type]')
  )
  const entries: GalleryEntry[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    if (node.dataset.mediaGalleryScope !== scopeId) continue

    const url = node.dataset.mediaGalleryUrl?.trim() || ''
    const typeValue = node.dataset.mediaGalleryType?.trim()
    const mediaType = typeValue === 'image' || typeValue === 'video' ? typeValue : null
    if (!url || !mediaType) continue

    const key = `${mediaType}:${url}`
    if (seen.has(key)) continue
    seen.add(key)

    entries.push({
      url,
      mediaType,
      prompt: normalizeGalleryPrompt(node.dataset.mediaGalleryPrompt),
    })
  }

  return entries
}

function buildGalleryState(current: GalleryEntry, scopeId?: string): GalleryState {
  const scopedEntries = scopeId ? readGalleryEntries(scopeId) : []
  if (scopedEntries.length > 0) {
    const index = scopedEntries.findIndex(entry => entry.url === current.url && entry.mediaType === current.mediaType)
    if (index >= 0) {
      return { entries: scopedEntries, index }
    }
  }

  return {
    entries: [current],
    index: 0,
  }
}

export function MediaBubble({
  url,
  mediaType,
  prompt,
  compact,
  autoPlay = false,
  avatarLipSyncTargetId = null,
  galleryScopeId,
}: MediaBubbleProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [proxiedUrl, setProxiedUrl] = useState('')
  const [gallery, setGallery] = useState<GalleryState | null>(null)
  const [timingData, setTimingData] = useState<GeneratedVoiceTimingData | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lipSyncRef = useRef<LipSyncController | null>(null)
  const directResolved = resolveMediaUrl(url) + (retryCount ? `${url.includes('?') ? '&' : '?'}r=${retryCount}` : '')
  const proxyMedia = shouldProxyMediaUrl(url, mediaType)
  const resolved = proxyMedia ? proxiedUrl : directResolved
  const generatedVoiceLookupPath = useMemo(
    () => (mediaType === 'audio' ? resolveGeneratedVoiceLookupPath(url) : null),
    [mediaType, url],
  )
  const hasTimingLipSync = Boolean(timingData?.normalizedAlignment || timingData?.alignment)
  const maxH = compact ? 200 : 300
  const normalizedPrompt = normalizeGalleryPrompt(prompt)
  const activeGalleryEntry = gallery ? gallery.entries[gallery.index] : null

  useEffect(() => {
    setLoading(true)
    setError(false)
  }, [mediaType, directResolved, proxyMedia])

  useEffect(() => {
    if (mediaType !== 'audio' || !generatedVoiceLookupPath) {
      setTimingData(null)
      return
    }

    let cancelled = false
    setTimingData(generatedVoiceTimingCache.get(generatedVoiceLookupPath) ?? null)

    void fetchGeneratedVoiceTimingData(generatedVoiceLookupPath)
      .then(clip => {
        if (!cancelled) setTimingData(clip)
      })
      .catch(() => {
        if (!cancelled) setTimingData(null)
      })

    return () => {
      cancelled = true
    }
  }, [generatedVoiceLookupPath, mediaType])

  useEffect(() => {
    if (!proxyMedia) {
      setProxiedUrl('')
      return
    }

    const controller = new AbortController()
    let objectUrl = ''

    async function loadLocalMedia() {
      try {
        const response = await fetch(directResolved, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        objectUrl = URL.createObjectURL(blob)
        setProxiedUrl(objectUrl)
        if (mediaType === 'image') {
          setLoading(false)
        }
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return
        setError(true)
        setLoading(false)
      }
    }

    setProxiedUrl('')
    void loadLocalMedia()

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [directResolved, mediaType, proxyMedia])

  useEffect(() => {
    if (!gallery) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGallery(null)
        return
      }
      if (event.key === 'ArrowLeft') {
        setGallery(current => {
          if (!current || current.entries.length < 2) return current
          const nextIndex = (current.index - 1 + current.entries.length) % current.entries.length
          return { ...current, index: nextIndex }
        })
        return
      }
      if (event.key === 'ArrowRight') {
        setGallery(current => {
          if (!current || current.entries.length < 2) return current
          const nextIndex = (current.index + 1) % current.entries.length
          return { ...current, index: nextIndex }
        })
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [gallery])

  useEffect(() => {
    if (mediaType !== 'audio' || !avatarLipSyncTargetId || !audioRef.current) return

    const ctrl = hasTimingLipSync && timingData
      ? createTimedLipSyncController(timingData)
      : createLipSyncController()
    lipSyncRef.current = ctrl

    const audio = audioRef.current
    if (audio && !audio.paused && !audio.ended) {
      void resumeLipSyncContext().finally(() => {
        if (lipSyncRef.current !== ctrl || !audioRef.current) return
        if (!ctrl.isActive) {
          ctrl.attachAudio(audioRef.current)
        }
        registerLipSync(avatarLipSyncTargetId, ctrl)
      })
    }

    return () => {
      unregisterLipSync(avatarLipSyncTargetId, ctrl)
      ctrl.detach()
      if (lipSyncRef.current === ctrl) {
        lipSyncRef.current = null
      }
    }
  }, [avatarLipSyncTargetId, hasTimingLipSync, mediaType, resolved, timingData])

  useEffect(() => {
    if (mediaType !== 'audio' || !audioRef.current || !resolved) return
    audioRef.current.load()
  }, [mediaType, resolved])

  const activateLipSync = () => {
    if (!avatarLipSyncTargetId || !lipSyncRef.current || !audioRef.current) return

    const ctrl = lipSyncRef.current
    void resumeLipSyncContext().finally(() => {
      if (!ctrl.isActive && audioRef.current) {
        ctrl.attachAudio(audioRef.current)
      }
      registerLipSync(avatarLipSyncTargetId, ctrl)
    })
  }

  const deactivateLipSync = () => {
    if (!avatarLipSyncTargetId || !lipSyncRef.current) return
    unregisterLipSync(avatarLipSyncTargetId, lipSyncRef.current, { detach: false })
  }

  const openGallery = () => {
    if (!resolved || !isGalleryMediaType(mediaType)) return
    setGallery(buildGalleryState({
      url: resolved,
      mediaType,
      prompt: normalizedPrompt,
    }, galleryScopeId))
  }

  const shiftGallery = (delta: number) => {
    setGallery(current => {
      if (!current || current.entries.length < 2) return current
      const nextIndex = (current.index + delta + current.entries.length) % current.entries.length
      return { ...current, index: nextIndex }
    })
  }

  const galleryAttributes = galleryScopeId && resolved && isGalleryMediaType(mediaType)
    ? {
        'data-media-gallery-scope': galleryScopeId,
        'data-media-gallery-url': resolved,
        'data-media-gallery-type': mediaType,
        ...(normalizedPrompt ? { 'data-media-gallery-prompt': normalizedPrompt } : {}),
      }
    : {}

  if (error) {
    const fallbackHref = resolved || directResolved || resolveMediaUrl(url)
    return (
      <div className="border border-red-500/30 bg-red-900/10 rounded p-3 my-1">
        <div className="text-xs font-mono text-red-400 mb-1">Failed to load {mediaType}</div>
        {prompt && <div className="text-xs text-gray-500 truncate">{prompt}</div>}
        <div className="mt-1 flex items-center gap-3">
          <button
            onClick={() => {
              setError(false)
              setLoading(true)
              setRetryCount(current => current + 1)
            }}
            className="text-xs font-mono text-[#14b8a6] hover:underline"
          >
            Retry
          </button>
          {fallbackHref && (
            <a
              href={fallbackHref}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-mono text-gray-400 hover:text-[#14b8a6] hover:underline"
            >
              Open
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="my-1">
      {loading && mediaType !== 'audio' && (
        <div className="animate-pulse bg-[#222] rounded" style={{ height: compact ? 120 : 180, maxWidth: 400 }} />
      )}

      {loading && mediaType === 'audio' && (
        <div className="bg-[#111] rounded p-2 border-l-2 border-[#14b8a6]" style={{ maxWidth: 400 }}>
          <div className="text-[11px] text-gray-400 font-mono">Loading audio...</div>
        </div>
      )}

      {mediaType === 'image' && resolved && (
        <div className="relative inline-block" {...galleryAttributes}>
          <img
            src={resolved}
            alt={prompt || 'Generated image'}
            loading="eager"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false)
              setError(true)
            }}
            onClick={openGallery}
            className="rounded cursor-pointer hover:opacity-90 transition-opacity border-l-2 border-[#14b8a6]"
            style={{
              maxHeight: maxH,
              maxWidth: '100%',
              objectFit: 'contain',
              opacity: loading ? 0 : 1,
              visibility: loading ? 'hidden' : 'visible',
            }}
          />
        </div>
      )}

      {mediaType === 'audio' && resolved && (
        <div className="bg-[#111] rounded p-2 border-l-2 border-[#14b8a6]" style={{ maxWidth: 400 }}>
          <audio
            ref={audioRef}
            src={resolved}
            controls
            preload="metadata"
            autoPlay={autoPlay}
            className="w-full h-8"
            onCanPlay={() => setLoading(false)}
            onPlay={activateLipSync}
            onPause={deactivateLipSync}
            onEnded={deactivateLipSync}
            onError={() => {
              deactivateLipSync()
              setLoading(false)
              setError(true)
            }}
          />
        </div>
      )}

      {mediaType === 'video' && resolved && (
        <div className="relative inline-block" {...galleryAttributes}>
          <video
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={() => setLoading(false)}
            onError={() => {
              setLoading(false)
              setError(true)
            }}
            onDoubleClick={openGallery}
            className="rounded border-l-2 border-[#14b8a6]"
            style={{
              maxHeight: maxH,
              maxWidth: '100%',
              opacity: loading ? 0 : 1,
              visibility: loading ? 'hidden' : 'visible',
            }}
          >
            <source src={resolved} />
          </video>
          <button
            type="button"
            onClick={openGallery}
            className="absolute top-2 right-2 rounded bg-black/75 px-2 py-1 text-[10px] font-mono text-white hover:bg-black/90"
          >
            Open
          </button>
        </div>
      )}

      {prompt && !loading && (
        <div className="text-xs text-gray-400 mt-0.5 truncate" style={{ maxWidth: 400 }} title={prompt}>
          {prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt}
        </div>
      )}

      {gallery && activeGalleryEntry && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100000] bg-black/95 flex items-center justify-center p-4"
          onClick={() => setGallery(null)}
        >
          <button
            type="button"
            onClick={event => {
              event.stopPropagation()
              setGallery(null)
            }}
            className="absolute top-4 right-4 rounded bg-black/75 px-3 py-2 text-sm font-mono text-white hover:bg-black/90"
          >
            x
          </button>

          {gallery.entries.length > 1 && (
            <button
              type="button"
              onClick={event => {
                event.stopPropagation()
                shiftGallery(-1)
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded bg-black/75 px-3 py-4 text-lg font-mono text-white hover:bg-black/90"
            >
              {'<'}
            </button>
          )}

          <div
            className="max-w-[96vw] max-h-[96vh] flex flex-col items-center gap-3"
            onClick={event => event.stopPropagation()}
          >
            {activeGalleryEntry.mediaType === 'image' ? (
              <img
                src={activeGalleryEntry.url}
                alt={activeGalleryEntry.prompt || 'Expanded image'}
                className="max-w-[92vw] max-h-[84vh] object-contain"
              />
            ) : (
              <video
                src={activeGalleryEntry.url}
                controls
                autoPlay
                playsInline
                className="max-w-[92vw] max-h-[84vh] rounded"
              />
            )}

            {(activeGalleryEntry.prompt || gallery.entries.length > 1) && (
              <div className="flex items-center gap-3 text-sm text-gray-200">
                {activeGalleryEntry.prompt && (
                  <div className="max-w-[70vw] text-center">{activeGalleryEntry.prompt}</div>
                )}
                {gallery.entries.length > 1 && (
                  <div className="font-mono text-xs text-gray-400">
                    {gallery.index + 1} / {gallery.entries.length}
                  </div>
                )}
              </div>
            )}
          </div>

          {gallery.entries.length > 1 && (
            <button
              type="button"
              onClick={event => {
                event.stopPropagation()
                shiftGallery(1)
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded bg-black/75 px-3 py-4 text-lg font-mono text-white hover:bg-black/90"
            >
              {'>'}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

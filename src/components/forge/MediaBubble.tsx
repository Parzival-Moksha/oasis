// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MEDIA BUBBLE — Inline image/audio/video renderer for Anorak chat
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useEffect, useRef } from 'react'
import { createLipSyncController, registerLipSync, unregisterLipSync, type LipSyncController } from '../../lib/lip-sync'

export type MediaType = 'image' | 'audio' | 'video'

interface MediaBubbleProps {
  url: string
  mediaType: MediaType
  prompt?: string
  compact?: boolean
  autoPlay?: boolean
  avatarLipSyncTargetId?: string | null
}

export function resolveMediaUrl(url: string): string {
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url
  if (typeof window !== 'undefined') {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
    const normalizedUrl = url.startsWith(basePath) || !url.startsWith('/')
      ? url
      : `${basePath}${url}`
    return `${window.location.origin}${normalizedUrl}`
  }
  return url
}

export function shouldProxyMediaUrl(url: string, mediaType: MediaType): boolean {
  if (mediaType === 'video') return false
  if (typeof window === 'undefined') return false

  const resolved = resolveMediaUrl(url)
  if (!resolved || resolved.startsWith('blob:') || resolved.startsWith('data:')) return false

  try {
    const parsed = new URL(resolved, window.location.origin)
    const sameOrigin = parsed.origin === window.location.origin
    const pathname = parsed.pathname.toLowerCase()
    const isGeneratedMedia =
      pathname.startsWith('/generated-images/')
      || pathname.startsWith('/generated-voices/')
      || pathname.startsWith('/merlin/screenshots/')
    return sameOrigin && isGeneratedMedia
  } catch {
    return false
  }
}

export function MediaBubble({
  url,
  mediaType,
  prompt,
  compact,
  autoPlay = false,
  avatarLipSyncTargetId = null,
}: MediaBubbleProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [proxiedUrl, setProxiedUrl] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lipSyncRef = useRef<LipSyncController | null>(null)
  const directResolved = resolveMediaUrl(url) + (retryCount ? `${url.includes('?') ? '&' : '?'}r=${retryCount}` : '')
  const proxyMedia = shouldProxyMediaUrl(url, mediaType)
  const resolved = proxyMedia ? proxiedUrl : directResolved
  const maxH = compact ? 200 : 300

  useEffect(() => {
    setLoading(true)
    setError(false)
  }, [mediaType, directResolved, proxyMedia])

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
    if (!lightbox) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightbox])

  useEffect(() => {
    if (mediaType !== 'audio' || !avatarLipSyncTargetId || !audioRef.current) return

    const ctrl = createLipSyncController()
    ctrl.attachAudio(audioRef.current)
    lipSyncRef.current = ctrl

    return () => {
      unregisterLipSync(avatarLipSyncTargetId, ctrl)
      ctrl.detach()
      if (lipSyncRef.current === ctrl) {
        lipSyncRef.current = null
      }
    }
  }, [avatarLipSyncTargetId, mediaType, resolved])

  useEffect(() => {
    if (mediaType !== 'audio' || !audioRef.current || !resolved) return
    audioRef.current.load()
  }, [mediaType, resolved])

  const activateLipSync = () => {
    if (!avatarLipSyncTargetId || !lipSyncRef.current) return
    registerLipSync(avatarLipSyncTargetId, lipSyncRef.current)
  }

  const deactivateLipSync = () => {
    if (!avatarLipSyncTargetId || !lipSyncRef.current) return
    unregisterLipSync(avatarLipSyncTargetId, lipSyncRef.current, { detach: false })
  }

  if (error) {
    return (
      <div className="border border-red-500/30 bg-red-900/10 rounded p-3 my-1">
        <div className="text-xs font-mono text-red-400 mb-1">Failed to load {mediaType}</div>
        {prompt && <div className="text-xs text-gray-500 truncate">{prompt}</div>}
        <button onClick={() => { setError(false); setLoading(true); setRetryCount(c => c + 1) }}
          className="text-xs font-mono text-[#14b8a6] hover:underline mt-1">Retry</button>
      </div>
    )
  }

  return (
    <div className="my-1">
      {/* Loading pulse */}
      {loading && mediaType !== 'audio' && (
        <div className="animate-pulse bg-[#222] rounded" style={{ height: compact ? 120 : 180, maxWidth: 400 }} />
      )}

      {loading && mediaType === 'audio' && (
        <div className="bg-[#111] rounded p-2 border-l-2 border-[#14b8a6]" style={{ maxWidth: 400 }}>
          <div className="text-[11px] text-gray-400 font-mono">Loading audio...</div>
        </div>
      )}

      {/* Image */}
      {mediaType === 'image' && resolved && (
        <>
          <img src={resolved} alt={prompt || 'Generated image'}
            loading="lazy"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true) }}
            onClick={() => setLightbox(true)}
            className="rounded cursor-pointer hover:opacity-90 transition-opacity border-l-2 border-[#14b8a6]"
            style={{ maxHeight: maxH, display: loading ? 'none' : 'block', maxWidth: '100%', objectFit: 'contain' }} />
          {lightbox && (
            <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center cursor-pointer" onClick={() => setLightbox(false)}>
              <img src={resolved} alt={prompt || 'Generated image'} className="max-w-[90vw] max-h-[90vh] object-contain" />
            </div>
          )}
        </>
      )}

      {/* Audio */}
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
            onError={() => { deactivateLipSync(); setLoading(false); setError(true) }}>
          </audio>
        </div>
      )}

      {/* Video */}
      {mediaType === 'video' && resolved && (
        <video controls preload="metadata" playsInline
          onLoadedMetadata={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true) }}
          className="rounded border-l-2 border-[#14b8a6]"
          style={{ maxHeight: maxH, display: loading ? 'none' : 'block', maxWidth: '100%' }}>
          <source src={resolved} />
        </video>
      )}

      {/* Caption */}
      {prompt && !loading && (
        <div className="text-xs text-gray-400 mt-0.5 truncate" style={{ maxWidth: 400 }} title={prompt}>
          {prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt}
        </div>
      )}
    </div>
  )
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MEDIA BUBBLE — Inline image/audio/video renderer for Anorak chat
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useEffect } from 'react'

export type MediaType = 'image' | 'audio' | 'video'

interface MediaBubbleProps {
  url: string
  mediaType: MediaType
  prompt?: string
  compact?: boolean
}

export function resolveMediaUrl(url: string): string {
  if (url.startsWith('http')) return url
  if (typeof window !== 'undefined') return `${window.location.origin}${url}`
  return url
}

export function MediaBubble({ url, mediaType, prompt, compact }: MediaBubbleProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const resolved = resolveMediaUrl(url) + (retryCount ? `?r=${retryCount}` : '')
  const maxH = compact ? 200 : 300

  useEffect(() => {
    if (!lightbox) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightbox])

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

      {/* Image */}
      {mediaType === 'image' && (
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
      {mediaType === 'audio' && (
        <div className="bg-[#111] rounded p-2 border-l-2 border-[#14b8a6]" style={{ maxWidth: 400 }}>
          <audio controls preload="metadata" className="w-full h-8"
            onCanPlay={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true) }}>
            <source src={resolved} />
          </audio>
        </div>
      )}

      {/* Video */}
      {mediaType === 'video' && (
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

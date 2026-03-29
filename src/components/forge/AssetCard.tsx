// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ASSET CARD — Unified visual card for every asset type in the Wizard Console
// ─══ॐ══─{ One card to rule them all, one card to find them }─══ॐ══─
//
// Used across ALL WizardConsole tabs: Conjure, Craft, Assets (catalog/conjured/
// crafted/images), Media, and Placed. Replaces GalleryItem, inline catalog
// buttons, media item divs, and placed object rows.
//
// Visual design:
//   ┌─────────────────┐
//   │     THUMBNAIL   [X]  ← small red delete, always visible
//   │                  │
//   │         [↓][▦][⛶][🖼]  ← bottom-right: download, tile, view, frame
//   ├─────────────────┤
//   │ Name        badge│  ← truncated name + type pill
//   │ subtitle         │  ← provider/count/date
//   └─────────────────┘
//
// Click behavior is delegated to the parent via callbacks.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type AssetCardType =
  | 'conjured'
  | 'crafted'
  | 'catalog'
  | 'media-image'
  | 'media-video'
  | 'media-audio'
  | 'placed'

export interface AssetCardProps {
  id: string
  name: string
  type: AssetCardType
  thumbnailUrl?: string
  modelUrl?: string
  mediaUrl?: string
  isInWorld?: boolean
  onDelete?: (id: string) => void
  onPlace?: (id: string) => void
  onClick?: (id: string) => void
  onDownload?: (id: string, url: string) => void
  /** Use image as ground tile texture */
  onUseAsTile?: (id: string) => void
  /** Open fullscreen lightbox view */
  onViewFullscreen?: (id: string, url: string) => void
  /** Place image/video with a frame around it */
  onPlaceWithFrame?: (id: string) => void
  compact?: boolean
  /** Type badge text override (e.g. 'meshy / refine', '12 primitives') */
  subtitle?: string
  /** Accent border color when highlighted (e.g. in-world items) */
  accentColor?: string
  /** Extra badge elements (rig/anim pills, placed count, etc.) */
  badges?: React.ReactNode
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE BADGE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const TYPE_CONFIG: Record<AssetCardType, { label: string; color: string; bgColor: string; borderColor: string }> = {
  conjured:      { label: 'conjured',  color: '#FB923C', bgColor: 'rgba(249,115,22,0.15)', borderColor: 'rgba(249,115,22,0.3)' },
  crafted:       { label: 'crafted',   color: '#93C5FD', bgColor: 'rgba(59,130,246,0.15)',  borderColor: 'rgba(59,130,246,0.3)' },
  catalog:       { label: 'catalog',   color: '#FDE047', bgColor: 'rgba(234,179,8,0.15)',   borderColor: 'rgba(234,179,8,0.3)' },
  'media-image': { label: 'image',     color: '#F9A8D4', bgColor: 'rgba(236,72,153,0.15)',  borderColor: 'rgba(236,72,153,0.3)' },
  'media-video': { label: 'video',     color: '#F9A8D4', bgColor: 'rgba(236,72,153,0.15)',  borderColor: 'rgba(236,72,153,0.3)' },
  'media-audio': { label: 'audio',     color: '#F9A8D4', bgColor: 'rgba(236,72,153,0.15)',  borderColor: 'rgba(236,72,153,0.3)' },
  placed:        { label: 'placed',    color: '#22D3EE', bgColor: 'rgba(6,182,212,0.15)',   borderColor: 'rgba(6,182,212,0.3)' },
}

// ═══════════════════════════════════════════════════════════════════════════════
// THUMBNAIL RENDERER — per-type visual (with autoplay hover for video/audio)
// ═══════════════════════════════════════════════════════════════════════════════

function CardThumbnail({ type, thumbnailUrl, mediaUrl, name }: {
  type: AssetCardType
  thumbnailUrl?: string
  mediaUrl?: string
  name: string
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Image thumbnail (catalog, conjured, crafted, media-image, placed)
  if (type !== 'media-video' && type !== 'media-audio' && thumbnailUrl && !imgFailed) {
    const src = thumbnailUrl.startsWith('http') || thumbnailUrl.startsWith('data:') || thumbnailUrl.startsWith('blob:')
      ? thumbnailUrl
      : `${OASIS_BASE}${thumbnailUrl}`
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className="w-full h-full object-cover"
        onError={() => setImgFailed(true)}
        loading="lazy"
      />
    )
  }

  // Video with autoplay on hover
  if (type === 'media-video' && mediaUrl) {
    return (
      <video
        ref={videoRef}
        src={mediaUrl}
        preload="metadata"
        playsInline
        muted
        loop
        className="w-full h-full object-cover"
        onMouseEnter={() => videoRef.current?.play().catch(() => {})}
        onMouseLeave={() => { if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0 } }}
      />
    )
  }

  // Audio with autoplay on hover — show waveform-style visual
  if (type === 'media-audio' && mediaUrl) {
    return (
      <AudioThumbnail mediaUrl={mediaUrl} name={name} />
    )
  }

  // Image thumbnail for remaining cases (video with thumbnail, etc.)
  if (thumbnailUrl && !imgFailed) {
    const src = thumbnailUrl.startsWith('http') || thumbnailUrl.startsWith('data:') || thumbnailUrl.startsWith('blob:')
      ? thumbnailUrl
      : `${OASIS_BASE}${thumbnailUrl}`
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className="w-full h-full object-cover"
        onError={() => setImgFailed(true)}
        loading="lazy"
      />
    )
  }

  // Fallback icons per type
  const fallbacks: Record<AssetCardType, { emoji: string; color: string }> = {
    conjured:      { emoji: '\u{1F52E}', color: 'text-orange-400/40' },
    crafted:       { emoji: '\u{1F3A8}', color: 'text-blue-400/40' },
    catalog:       { emoji: '\u{1F4E6}', color: 'text-yellow-400/40' },
    'media-image': { emoji: '\u{1F5BC}', color: 'text-pink-400/40' },
    'media-video': { emoji: '\u{1F3AC}', color: 'text-pink-400/40' },
    'media-audio': { emoji: '\u{1F3B5}', color: 'text-pink-400/40' },
    placed:        { emoji: '\u{1F4CD}', color: 'text-cyan-400/40' },
  }
  const fb = fallbacks[type]
  return <span className={`text-2xl ${fb.color}`}>{fb.emoji}</span>
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO THUMBNAIL — visual with autoplay on hover
// ═══════════════════════════════════════════════════════════════════════════════

function AudioThumbnail({ mediaUrl, name }: { mediaUrl: string; name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const handleMouseEnter = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {})
      setPlaying(true)
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setPlaying(false)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <audio ref={audioRef} src={mediaUrl} preload="metadata" />
      <span className={`text-2xl transition-transform ${playing ? 'scale-110' : ''}`}>
        {playing ? '\u{1F50A}' : '\u{1F3B5}'}
      </span>
      <div className="text-[8px] text-gray-500 font-mono mt-1 px-2 text-center truncate w-full">{name}</div>
      {playing && (
        <div className="absolute bottom-1 left-1 right-1 flex items-end justify-center gap-px h-3">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-pink-400/60 rounded-t"
              style={{
                animation: `audio-bar 0.5s ease-in-out ${i * 0.1}s infinite alternate`,
                height: '30%',
              }}
            />
          ))}
          <style>{`@keyframes audio-bar { from { height: 20% } to { height: 100% } }`}</style>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSET CARD
// ═══════════════════════════════════════════════════════════════════════════════

export function AssetCard({
  id,
  name,
  type,
  thumbnailUrl,
  modelUrl,
  mediaUrl,
  isInWorld,
  onDelete,
  onPlace,
  onClick,
  onDownload,
  onUseAsTile,
  onViewFullscreen,
  onPlaceWithFrame,
  compact,
  subtitle,
  accentColor,
  badges,
}: AssetCardProps) {
  const config = TYPE_CONFIG[type]
  const highlighted = isInWorld && accentColor

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't trigger if clicking action buttons
    if ((e.target as HTMLElement).closest('[data-card-action]')) return
    if (onClick) {
      onClick(id)
    } else if (onPlace) {
      onPlace(id)
    }
  }, [id, onClick, onPlace])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDelete) onDelete(id)
  }, [id, onDelete])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDownload && (mediaUrl || thumbnailUrl)) {
      onDownload(id, mediaUrl || thumbnailUrl || '')
    }
  }, [id, mediaUrl, thumbnailUrl, onDownload])

  const handleUseAsTile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onUseAsTile) onUseAsTile(id)
  }, [id, onUseAsTile])

  const handleViewFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onViewFullscreen) onViewFullscreen(id, mediaUrl || thumbnailUrl || '')
  }, [id, mediaUrl, thumbnailUrl, onViewFullscreen])

  const handlePlaceWithFrame = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onPlaceWithFrame) onPlaceWithFrame(id)
  }, [id, onPlaceWithFrame])

  const hasBottomActions = onDownload || onUseAsTile || onViewFullscreen || onPlaceWithFrame

  return (
    <div
      className={`relative rounded-lg border overflow-hidden group transition-all duration-200 cursor-pointer hover:scale-[1.02] ${
        compact ? 'text-[9px]' : ''
      }`}
      style={{
        background: highlighted ? undefined : 'rgba(15, 15, 15, 0.8)',
        borderColor: highlighted
          ? `${accentColor}4D`  // ~30% opacity
          : 'rgba(255, 255, 255, 0.06)',
        ...(highlighted ? { backgroundColor: `${accentColor}0D` } : {}), // ~5% fill
      }}
      onClick={handleClick}
    >
      {/* ── THUMBNAIL AREA ── */}
      <div
        className="aspect-square flex items-center justify-center relative overflow-hidden"
        style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      >
        <CardThumbnail
          type={type}
          thumbnailUrl={thumbnailUrl}
          mediaUrl={mediaUrl}
          name={name}
        />

        {/* Delete X — always visible, small, top-right */}
        {onDelete && (
          <button
            data-card-action="delete"
            onClick={handleDelete}
            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-red-400/60 hover:text-red-300 text-[10px] flex items-center justify-center transition-colors z-10"
            title={`Delete ${name}`}
          >
            &#10005;
          </button>
        )}

        {/* Bottom-right action row: download, tile, view, frame */}
        {hasBottomActions && (
          <div className="absolute bottom-0.5 right-0.5 flex gap-0.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
            {onDownload && (
              <button
                data-card-action="download"
                onClick={handleDownload}
                className="w-5 h-5 rounded bg-black/70 text-gray-400 hover:text-white text-[10px] flex items-center justify-center transition-colors"
                title="Download"
              >
                &#8595;
              </button>
            )}
            {onUseAsTile && (
              <button
                data-card-action="tile"
                onClick={handleUseAsTile}
                className="w-5 h-5 rounded bg-black/70 text-emerald-400/70 hover:text-emerald-300 text-[10px] flex items-center justify-center transition-colors"
                title="Use as ground tile"
              >
                &#9638;
              </button>
            )}
            {onViewFullscreen && (
              <button
                data-card-action="view"
                onClick={handleViewFullscreen}
                className="w-5 h-5 rounded bg-black/70 text-gray-400 hover:text-white text-[10px] flex items-center justify-center transition-colors"
                title="View fullscreen"
              >
                &#9974;
              </button>
            )}
            {onPlaceWithFrame && (
              <button
                data-card-action="frame"
                onClick={handlePlaceWithFrame}
                className="w-5 h-5 rounded bg-black/70 text-yellow-400/70 hover:text-yellow-300 text-[10px] flex items-center justify-center transition-colors"
                title="Place with frame"
              >
                &#9645;
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── INFO AREA ── */}
      <div className={compact ? 'p-1' : 'p-1.5'}>
        {/* Name row */}
        <div
          className="text-[9px] text-gray-400 group-hover:text-gray-200 truncate transition-colors"
          title={name}
        >
          {name}
        </div>

        {/* Subtitle + type badge row */}
        <div className="flex items-center justify-between mt-0.5 gap-1">
          {subtitle ? (
            <div className="text-[8px] text-gray-500 truncate flex-1 min-w-0">{subtitle}</div>
          ) : (
            <div className="flex-1" />
          )}
          <span
            className="text-[7px] font-mono px-1 py-px rounded flex-shrink-0"
            style={{
              background: config.bgColor,
              color: config.color,
              border: `1px solid ${config.borderColor}`,
            }}
          >
            {config.label}
          </span>
        </div>

        {/* In-world indicator */}
        {isInWorld && (
          <div className="text-[8px] mt-0.5" style={{ color: accentColor || config.color, opacity: 0.6 }}>
            in world
          </div>
        )}

        {/* Extra badges (rig/anim pills, etc.) */}
        {badges && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {badges}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGEN ALL BUTTON — "Regenerate All" for per-tab batch thumbnails
// ═══════════════════════════════════════════════════════════════════════════════

export function RegenAllButton({ onClick, running, done, total }: {
  onClick: () => void
  running: boolean
  done?: number
  total?: number
}) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      className="text-[9px] px-1.5 py-0.5 rounded font-mono text-gray-500 border border-gray-700/30 hover:text-yellow-400 hover:border-yellow-500/40 disabled:opacity-30 transition-colors"
      title="Regenerate thumbnails for all assets in this tab"
    >
      {running && done != null && total != null
        ? `${done}/${total}`
        : '\u{1F4F7} Regen All'}
    </button>
  )
}

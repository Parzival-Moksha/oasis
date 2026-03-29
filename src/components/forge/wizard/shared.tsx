// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WIZARD SHARED — Sub-components and constants used across tabs
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState } from 'react'
import type { ConjureStatus, ConjuredAsset, RemeshQuality } from '../../../lib/conjure/types'
import { PROVIDERS, REMESH_PRESETS } from '../../../lib/conjure/types'

export const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// Re-export unified AssetCard for use in all wizard tabs
export { AssetCard, RegenAllButton } from '../AssetCard'
export type { AssetCardProps, AssetCardType } from '../AssetCard'

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS BADGE — Visual feedback for conjuration progress
// ═══════════════════════════════════════════════════════════════════════════════

export const STATUS_STYLES: Record<ConjureStatus, { bg: string; text: string; label: string }> = {
  queued: { bg: 'rgba(156, 163, 175, 0.2)', text: '#9CA3AF', label: 'Queued' },
  generating: { bg: 'rgba(251, 191, 36, 0.2)', text: '#FBBF24', label: 'Forging...' },
  refining: { bg: 'rgba(168, 85, 247, 0.2)', text: '#A855F7', label: 'Refining' },
  downloading: { bg: 'rgba(59, 130, 246, 0.2)', text: '#3B82F6', label: 'Pulling' },
  ready: { bg: 'rgba(34, 197, 94, 0.2)', text: '#22C55E', label: 'Ready' },
  failed: { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444', label: 'Failed' },
}

export function StatusBadge({ status, progress }: { status: ConjureStatus; progress: number }) {
  const style = STATUS_STYLES[status]
  const isActive = status === 'generating' || status === 'refining' || status === 'downloading'
  return (
    <div
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${isActive ? 'animate-pulse' : ''}`}
      style={{ background: style.bg, color: style.text }}
    >
      {style.label}{isActive && progress > 0 ? ` ${Math.round(progress)}%` : ''}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSET THUMBNAIL — <img> with graceful emoji fallback
// ─═̷─═̷─ Every creation deserves a face, even if the portrait isn't ready yet ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

export function AssetThumb({ src, fallback, alt }: { src: string; fallback: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return <span className="text-xl opacity-30">{fallback}</span>
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHT TOOLTIP — styled HTML tooltip for light type buttons
// Native title= is ugly single-line garbage. This is The Forge.
// ═══════════════════════════════════════════════════════════════════════════════

export const LIGHT_TOOLTIPS: Record<string, { icon: string; name: string; tagline: string; details: string[] }> = {
  directional: {
    icon: '☀️', name: 'Directional (Sun)',
    tagline: 'Parallel rays from infinitely far away',
    details: ['Casts real shadows', 'Azimuth + Elevation controls', 'The main outdoor light source'],
  },
  ambient: {
    icon: '🌤️', name: 'Ambient',
    tagline: 'Uniform light from everywhere',
    details: ['No shadows, no direction', 'Fills dark areas so nothing is pure black', 'Start low: 0.3–1.0'],
  },
  hemisphere: {
    icon: '🌗', name: 'Hemisphere',
    tagline: 'Sky color above, ground color below',
    details: ['Natural gradient lighting', 'Mimics outdoor atmosphere', 'Great for nature scenes'],
  },
  environment: {
    icon: '🌐', name: 'IBL (Image-Based)',
    tagline: 'Uses the sky background as a light source',
    details: ['Realistic PBR reflections', 'Makes metallic materials shine', 'Usually keep one per scene'],
  },
  point: {
    icon: '💡', name: 'Point',
    tagline: 'Radiates equally in all directions',
    details: ['Like a light bulb', 'Place near objects for local highlights', '3D-positioned in world'],
  },
  spot: {
    icon: '🔦', name: 'Spot',
    tagline: 'Cone-shaped beam aimed at a target',
    details: ['Angle controls cone width', 'Azimuth + Elevation aim direction', 'Intensity up to 5000 — dramatic'],
  },
}

export function LightTooltipWrap({ type, children, className }: { type: string; children: React.ReactNode; className?: string }) {
  const [show, setShow] = useState(false)
  const tip = LIGHT_TOOLTIPS[type]
  if (!tip) return <>{children}</>
  return (
    <div className={className || 'relative'} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div
          className="absolute z-[9999] bottom-full left-1/2 mb-2 pointer-events-none"
          style={{ transform: 'translateX(-50%)' }}
        >
          <div
            className="w-52 rounded-lg p-2.5 text-[10px] leading-relaxed shadow-lg"
            style={{
              background: 'rgba(8, 8, 12, 0.92)',
              border: '1px solid rgba(250, 204, 21, 0.15)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">{tip.icon}</span>
              <span className="text-[11px] font-semibold text-yellow-300">{tip.name}</span>
            </div>
            <div className="text-gray-300 mb-1.5">{tip.tagline}</div>
            {tip.details.map((d, i) => (
              <div key={i} className="flex items-start gap-1 text-gray-400">
                <span className="text-yellow-500/60 text-[8px] mt-[2px]">▸</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
          {/* Arrow */}
          <div
            className="w-2 h-2 mx-auto"
            style={{
              background: 'rgba(8, 8, 12, 0.92)',
              borderRight: '1px solid rgba(250, 204, 21, 0.15)',
              borderBottom: '1px solid rgba(250, 204, 21, 0.15)',
              transform: 'rotate(45deg) translateY(-4px)',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// GALLERY ITEM — Each conjured asset in the grid
// ═══════════════════════════════════════════════════════════════════════════════

export function GalleryItem({ asset, onDelete, isInWorld, onPlace, onRemove, onTexture, onRemesh, onRig, onRename, pricing }: {
  asset: ConjuredAsset
  onDelete: (id: string) => void
  isInWorld: boolean
  onPlace: (id: string) => void
  onRemove: (id: string) => void
  onTexture?: (id: string) => void
  onRemesh?: (id: string, quality: RemeshQuality) => void
  onRig?: (id: string) => void
  onRename?: (id: string, name: string) => void
  pricing?: Record<string, number>
}) {
  const provider = PROVIDERS.find(p => p.name === asset.provider)
  const isActive = !['ready', 'failed'].includes(asset.status)
  const fileSizeKB = asset.metadata?.fileSizeBytes ? (asset.metadata.fileSizeBytes / 1024).toFixed(0) : null
  const [remeshOpen, setRemeshOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(asset.displayName || asset.prompt)
  const displayLabel = asset.displayName || asset.prompt

  // ░▒▓ Determine which post-processing buttons to show ▓▒░
  // Texture: Meshy-only (Tripo textures during generation with pbr: true)
  const canTexture = asset.status === 'ready' && asset.provider === 'meshy'
    && asset.tier === 'preview' && asset.action !== 'texture'
  // Remesh: Meshy + Tripo — any ready asset that isn't already a remesh
  const canRemesh = asset.status === 'ready'
    && (asset.provider === 'meshy' || asset.provider === 'tripo')
    && asset.action !== 'remesh'
  // Rig: Meshy + Tripo — only character-mode assets (humanoids conjured for rigging)
  // Lineage: base → rig. Rig = anim now (library animations handle dance moves)
  const canRig = asset.status === 'ready'
    && (asset.provider === 'meshy' || asset.provider === 'tripo')
    && asset.action !== 'rig' && asset.action !== 'animate'
    && asset.characterMode === true

  return (
    <div
      className="relative rounded-lg border overflow-hidden group transition-all duration-200 hover:scale-[1.02]"
      style={{
        background: 'rgba(20, 20, 20, 0.8)',
        borderColor: asset.status === 'ready'
          ? 'rgba(34, 197, 94, 0.3)'
          : asset.status === 'failed'
            ? 'rgba(239, 68, 68, 0.3)'
            : 'rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Thumbnail / placeholder */}
      <div className="aspect-square flex items-center justify-center relative overflow-hidden"
        style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      >
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl.startsWith('http') ? asset.thumbnailUrl : `${OASIS_BASE}${asset.thumbnailUrl}`} alt={asset.displayName || asset.prompt} className="w-full h-full object-cover" />
        ) : isActive ? (
          <div className="flex flex-col items-center gap-1">
            <div className="text-2xl animate-spin-slow">✨</div>
            {asset.progress > 0 && (
              <div className="w-3/4 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all duration-500 rounded-full"
                  style={{ width: `${asset.progress}%` }}
                />
              </div>
            )}
          </div>
        ) : asset.status === 'ready' ? (
          <div className="flex flex-col items-center gap-1">
            <div className="text-3xl text-green-400/60">&#9878;</div>
            {fileSizeKB && (
              <div className="text-[9px] text-gray-400 font-mono">{fileSizeKB} KB</div>
            )}
          </div>
        ) : (
          <div className="text-2xl text-red-500">&#10006;</div>
        )}

        {/* Delete button (top-right, on hover) — with confirmation */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            const name = asset.displayName || asset.prompt?.slice(0, 30) || asset.id
            if (window.confirm(`Delete "${name}"? This removes the GLB file permanently.`)) {
              onDelete(asset.id)
            }
          }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-gray-400 hover:text-red-400 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          &#10005;
        </button>

        {/* Tier + action badge (top-left) */}
        <div className="absolute top-1 left-1 text-[8px] font-mono px-1 py-0.5 rounded bg-black/60 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
          {asset.action && asset.action !== 'conjure' ? asset.action : asset.tier}
        </div>
      </div>

      {/* Info — click name to rename */}
      <div className="p-1.5">
        {isEditing ? (
          <input
            autoFocus
            className="text-[10px] text-gray-200 bg-gray-800/80 border border-gray-600 rounded px-1 py-0.5 w-full font-mono outline-none focus:border-orange-500/50"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => {
              setIsEditing(false)
              const trimmed = editName.trim()
              if (trimmed && trimmed !== (asset.displayName || asset.prompt) && onRename) {
                onRename(asset.id, trimmed)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setEditName(asset.displayName || asset.prompt); setIsEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="text-[10px] text-gray-300 truncate cursor-pointer hover:text-orange-300 transition-colors"
            title={`${displayLabel} (click to rename)`}
            onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditName(asset.displayName || asset.prompt) }}
          >
            {displayLabel}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-gray-400 font-mono">{provider?.displayName || asset.provider}</span>
            {asset.action === 'rig' && (
              <span className="px-1 py-px rounded text-[7px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">{'\u2699'}rig</span>
            )}
            {asset.action === 'animate' && (
              <span className="px-1 py-px rounded text-[7px] font-mono bg-green-500/20 text-green-400 border border-green-500/30">{'\uD83C\uDFC3'}anim</span>
            )}
          </div>
          <StatusBadge status={asset.status} progress={asset.progress} />
        </div>
        {asset.status === 'failed' && asset.errorMessage && (
          <div className="text-[9px] text-red-400/70 mt-0.5 truncate" title={asset.errorMessage}>
            {asset.errorMessage}
          </div>
        )}
        {asset.completedAt && (
          <div className="text-[8px] text-gray-500 mt-0.5 font-mono">
            {new Date(asset.completedAt).toLocaleDateString()}
          </div>
        )}

        {/* ░▒▓ Action buttons row ▓▒░ */}
        {asset.status === 'ready' && (
          <div className="flex gap-1 mt-1">
            {/* Place — always available, allows multiple copies of same asset */}
            <button
              onClick={(e) => { e.stopPropagation(); onPlace(asset.id) }}
              className="flex-1 text-[10px] py-0.5 rounded border transition-colors font-mono text-emerald-400/70 border-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 bg-emerald-500/5"
            >
              + place{isInWorld ? ' another' : ''}
            </button>

            {/* Texture button — for untextured meshy previews */}
            {canTexture && onTexture && (
              <button
                onClick={(e) => { e.stopPropagation(); onTexture(asset.id) }}
                className="text-[10px] py-0.5 px-1.5 rounded border transition-colors font-mono text-purple-400/80 border-purple-500/20 hover:text-purple-300 hover:border-purple-500/40 bg-purple-500/5"
                title={`Add PBR textures (${pricing?.post_texture ?? 0.5} cr)`}
              >
                Texture <span className="text-[8px] opacity-60">{pricing?.post_texture ?? 0.5}cr</span>
              </button>
            )}

            {/* Remesh button — for textured meshy assets */}
            {canRemesh && onRemesh && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setRemeshOpen(!remeshOpen) }}
                  className="text-[10px] py-0.5 px-1.5 rounded border transition-colors font-mono text-cyan-400/80 border-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/40 bg-cyan-500/5"
                  title={`Retopologize (${pricing?.post_remesh ?? 0.25} cr)`}
                >
                  Remesh <span className="text-[8px] opacity-60">{pricing?.post_remesh ?? 0.25}cr</span> &#9660;
                </button>
                {remeshOpen && (
                  <div
                    className="absolute bottom-full right-0 mb-1 rounded-lg border border-gray-700/50 overflow-hidden z-10"
                    style={{ background: 'rgba(15, 15, 15, 0.95)' }}
                  >
                    {(Object.entries(REMESH_PRESETS) as [RemeshQuality, { polycount: number; label: string }][]).map(([quality, preset]) => (
                      <button
                        key={quality}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRemeshOpen(false)
                          onRemesh(asset.id, quality)
                        }}
                        className="block w-full text-left text-[10px] px-3 py-1.5 font-mono text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors whitespace-nowrap"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ░▒▓ Rig button — breathe a skeleton into the sculpture ▓▒░ */}
            {canRig && onRig && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  // Warn about high-poly models (Meshy rig limit: 300k faces)
                  const tris = asset.metadata?.triangleCount || 0
                  if (tris > 300000) {
                    if (!window.confirm(`This model has ${Math.round(tris / 1000)}k triangles — Meshy rig limit is 300k. Remesh first to reduce poly count, then rig. Continue anyway?`)) return
                  }
                  onRig(asset.id)
                }}
                className="text-[10px] py-0.5 px-1.5 rounded border transition-colors font-mono text-amber-400/80 border-amber-500/20 hover:text-amber-300 hover:border-amber-500/40 bg-amber-500/5"
                title={`Auto-rig: add Mixamo skeleton (${pricing?.post_rig ?? 0.75} cr). Models >300k faces must be remeshed first.`}
              >
                &#9760; Rig <span className="text-[8px] opacity-60">{pricing?.post_rig ?? 0.75}cr</span>
              </button>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WIZARD CONSOLE — The Forge's conjuring interface
// ─═̷─═̷─ॐ─═̷─═̷─{ Speak the spell, choose the forge, cast into being }─═̷─═̷─ॐ─═̷─═̷─
// Draggable/resizable popup (follows CuratorStreamPopup pattern)
// Three providers, one dream. Text goes in, GLB comes out.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useConjure } from '../../hooks/useConjure'
import { useOasisStore } from '../../store/oasisStore'
import { PROVIDERS, REMESH_PRESETS, LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_STEP, type ProviderName, type ConjuredAsset, type ConjureStatus, type CraftedScene, type RemeshQuality, type WorldLightType, type GeneratedImage } from '../../lib/conjure/types'
import type { PlacementVfxType } from '../../store/oasisStore'
import { dispatch } from '../../lib/event-bus'
import { useContext } from 'react'
import { ASSET_CATALOG, SKY_BACKGROUNDS } from '../scene-lib/constants'
import { SettingsContext } from '../scene-lib/contexts'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { AvatarGallery } from './AvatarGallery'
import type { AssetDefinition } from '../scene-lib/types'
import { awardXp } from '../../hooks/useXp'
import { ModelPreviewPanel, CraftedPreviewPanel } from './ModelPreview'
import { generateSingleCraftedThumbnail, useCraftedThumbnailGenerator, useCatalogThumbnailGenerator, usePortalThumbnailGenerator } from '../../hooks/useThumbnailGenerator'
import { usePricing, getConjurePriceKey } from '../../hooks/usePricing'
import { extractPartialCraftData } from '../../lib/craft-stream'
import { addToSceneLibrary, getSceneLibrary } from '../../lib/forge/scene-library'
import { derivePlayerCastSpawn } from '../../lib/player-avatar-runtime'
import { findMissingLocalGeneratedImageIds, localGeneratedImageExists } from '../../lib/generated-images'
import { useUILayer } from '@/lib/input-manager'
import { AssetCard, RegenAllButton } from './AssetCard'
import { DeleteButton } from './DeleteButton'
import { getAgentWindowRendererMeta } from '../../lib/agent-window-renderers'
import { deriveAvatarAnchoredWindowPlacement } from '../../lib/agent-avatar-utils'
import { getLiveObjectTransform } from '../../lib/live-object-transforms'
import { PORTAL_GATE_VARIANT_DEFS, type PortalAction, type PortalGateVariant } from '../../lib/portal-gates'
import { portalThumbPath } from '../../lib/portal-thumbnails'
import { PortalTransitionSettingsPanel } from './PortalTransitionSettingsPanel'
import { createSpatialWebObjectFromTemplate, SPATIAL_WEB_ASSET_TEMPLATES } from '../../lib/spatial-web-presets'
import { useOasisCapabilities } from '@/lib/oasis-mode-client'
import { MusicBody } from './spelltabs/bodies/MusicBody'
import { VideoBody } from './spelltabs/bodies/VideoBody'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

function readCols(key: string, fallback: number): number {
  try { const v = parseInt(localStorage.getItem(`oasis-wizard-cols-${key}`) || ''); return v >= 1 && v <= 6 ? v : fallback } catch { return fallback }
}

interface ConfirmDeleteState {
  requestId: string
  itemName: string
  placedCount?: number
  worldCount?: number
  loadingUsage?: boolean
  onConfirm: () => void | Promise<void>
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS BADGE — Visual feedback for conjuration progress
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_STYLES: Record<ConjureStatus, { bg: string; text: string; label: string }> = {
  queued: { bg: 'rgba(156, 163, 175, 0.2)', text: '#9CA3AF', label: 'Queued' },
  generating: { bg: 'rgba(251, 191, 36, 0.2)', text: '#FBBF24', label: 'Forging...' },
  refining: { bg: 'rgba(168, 85, 247, 0.2)', text: '#A855F7', label: 'Refining' },
  downloading: { bg: 'rgba(59, 130, 246, 0.2)', text: '#3B82F6', label: 'Pulling' },
  ready: { bg: 'rgba(34, 197, 94, 0.2)', text: '#22C55E', label: 'Ready' },
  failed: { bg: 'rgba(239, 68, 68, 0.2)', text: '#EF4444', label: 'Failed' },
}

function StatusBadge({ status, progress }: { status: ConjureStatus; progress: number }) {
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

function _AssetThumb({ fallback }: { src: string; fallback: string; alt: string }) {
  return <span className="text-xl opacity-30">{fallback}</span>
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHT TOOLTIP — styled HTML tooltip for light type buttons
// Native title= is ugly single-line garbage. This is The Forge.
// ═══════════════════════════════════════════════════════════════════════════════

const LIGHT_TOOLTIPS: Record<string, { icon: string; name: string; tagline: string; details: string[] }> = {
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

function LightTooltipWrap({ type, children, className }: { type: string; children: React.ReactNode; className?: string }) {
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

function GalleryItem({ asset, onDelete, onRequestDelete, onPreview, isInWorld, onPlace, onTexture, onRemesh, onRig, onRename, pricing }: {
  asset: ConjuredAsset
  onDelete: (id: string) => void
  onRequestDelete?: (id: string, name: string) => void
  onPreview?: (asset: ConjuredAsset) => void
  isInWorld: boolean
  onPlace: (id: string) => void
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
      className={`relative rounded-lg border overflow-hidden group transition-all duration-200 hover:scale-[1.02] ${
        asset.status === 'ready' ? 'cursor-pointer' : ''
      }`}
      style={{
        background: 'rgba(20, 20, 20, 0.8)',
        borderColor: asset.status === 'ready'
          ? 'rgba(34, 197, 94, 0.3)'
          : asset.status === 'failed'
            ? 'rgba(239, 68, 68, 0.3)'
            : 'rgba(255, 255, 255, 0.08)',
      }}
      onClick={() => {
        if (asset.status === 'ready') onPreview?.(asset)
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
        <DeleteButton
          onClick={(e) => {
            e.stopPropagation()
            const name = asset.displayName || asset.prompt?.slice(0, 30) || asset.id
            if (onRequestDelete) onRequestDelete(asset.id, name)
            else onDelete(asset.id)
          }}
          title={`Delete ${displayLabel}`}
        />

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

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGINE TAB — Text-to-image via Gemini, ground textures, gallery
// ═══════════════════════════════════════════════════════════════════════════════

const IMAGINE_MODELS = [
  { key: 'gemini-flash', label: 'Gemini Flash', desc: 'Google — fast multimodal' },
  { key: 'riverflow', label: 'Riverflow v2', desc: 'Sourceful — fast diffusion' },
  { key: 'flux-klein', label: 'FLUX Klein', desc: 'Black Forest Labs — 4B param' },
  { key: 'seedream', label: 'Seedream 4.5', desc: 'ByteDance — high quality' },
] as const

interface InFlightImage {
  id: string
  prompt: string
  model: string
  startedAt: number
  error?: string
}

// ─═̷─ Prompt scaffold disabled 2026-05-20. The wrapping text ("4-sided
// building elevation, orthographic, full façade, …") was confusing nano-banana
// into producing collage layouts (4 mini-pics tiled on one image) instead of a
// single textured façade. The toggle now ONLY controls how the result is
// rendered in-world (cube vs flat plane) — the prompt is passed through raw.
// Keep the function shape so the call site below doesn't need to change. ─═̷─
function applyBuildingFraming(rawPrompt: string): string {
  return rawPrompt.trim()
}

function ImagineTab({ cols, setLightboxUrl, onRequestDelete }: { cols: number; setLightboxUrl: (url: string | null) => void; onRequestDelete: (image: GeneratedImage, placedCount: number) => void }) {
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>('gemini-flash')
  const [buildingMode, setBuildingMode] = useState(false)
  const [inFlight, setInFlight] = useState<InFlightImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const generatedImages = useOasisStore(s => s.generatedImages)
  const addGeneratedImage = useOasisStore(s => s.addGeneratedImage)
  const removeGeneratedImage = useOasisStore(s => s.removeGeneratedImage)
  const addCustomGroundPreset = useOasisStore(s => s.addCustomGroundPreset)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const { pricing } = usePricing()
  const imagineCost = pricing['imagine'] ?? 0.05

  useEffect(() => {
    let cancelled = false

    findMissingLocalGeneratedImageIds(generatedImages, url => localGeneratedImageExists(url, OASIS_BASE))
      .then(missingIds => {
        if (cancelled) return
        for (const id of missingIds) {
          removeGeneratedImage(id)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [generatedImages, removeGeneratedImage])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    const flightId = `flight_${Date.now()}`
    const capturedPrompt = prompt.trim()
    const capturedModel = selectedModel
    const wireBuilding = buildingMode
    const wirePrompt = wireBuilding ? applyBuildingFraming(capturedPrompt) : capturedPrompt
    setInFlight(prev => [...prev, { id: flightId, prompt: capturedPrompt, model: capturedModel, startedAt: Date.now() }])
    setPrompt('')
    setError(null)
    try {
      const res = await fetch(`${OASIS_BASE}/api/imagine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: wirePrompt, model: capturedModel }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: data.error || `Error ${res.status}` } : f))
        return
      }
      const data = await res.json()
      addGeneratedImage({
        id: data.id,
        prompt: data.prompt,
        url: data.url,
        tileUrl: data.tileUrl,
        createdAt: data.createdAt,
      })
      awardXp('GENERATE_IMAGE')
    } catch (e) {
      setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: (e as Error).message } : f))
      return
    }
    // Remove from in-flight on success
    setInFlight(prev => prev.filter(f => f.id !== flightId))
  }, [prompt, selectedModel, buildingMode, addGeneratedImage])

  const handleUseAsTile = useCallback((imageId: string) => {
    const image = generatedImages.find(i => i.id === imageId)
    if (!image) return
    const presetId = `custom_${image.id}`
    // Check if already registered
    if (!customGroundPresets.some(p => p.id === presetId)) {
      addCustomGroundPreset({
        id: presetId,
        name: image.prompt.slice(0, 20),
        icon: '\u{1F3A8}',
        color: '#888888',
        assetName: '',
        tileRepeat: 8,
        customTextureUrl: image.tileUrl,
      })
    }
    enterPaintMode(presetId)
  }, [generatedImages, customGroundPresets, addCustomGroundPreset, enterPaintMode])

  return (
    <>
      <div className="space-y-3">
        {/* Prompt input */}
        <div>
          <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1.5">
            <div className="text-[10px] text-pink-400/60 uppercase tracking-widest font-mono">
              Text to Image
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {/* ░▒▓ 4-sided building toggle — routes the prompt through Conjure-style
                  façade framing so the image works as a building panel ▓▒░ */}
              <label
                className="flex items-center gap-1 cursor-pointer rounded px-1.5 py-0.5"
                style={{
                  border: `1px solid ${buildingMode ? 'rgba(245, 158, 11, 0.6)' : 'rgba(120, 120, 120, 0.3)'}`,
                }}
                title="Generate as 4-sided building (Conjure-style façade framing)"
              >
                <input
                  type="checkbox"
                  checked={buildingMode}
                  onChange={e => setBuildingMode(e.target.checked)}
                  className="w-3 h-3 rounded accent-amber-500"
                />
                <span className="text-[10px] font-mono" style={{ color: buildingMode ? '#FBBF24' : '#9CA3AF' }}>
                  4-sided building
                </span>
              </label>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="text-[10px] bg-black/60 border border-pink-500/20 rounded px-1.5 py-0.5 text-pink-300 font-mono focus:outline-none focus:border-pink-500/50 cursor-pointer"
              >
                {IMAGINE_MODELS.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGenerate() }}
              placeholder={buildingMode
                ? "describe the building (e.g. wooden tea house, paper screens)..."
                : "Describe what you see..."}
              className="flex-1 bg-black/60 border border-pink-500/20 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500/50 font-mono"
            />
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-30"
              style={{
                background: buildingMode
                  ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.3), rgba(236, 72, 153, 0.3))'
                  : 'linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(168, 85, 247, 0.3))',
                color: buildingMode ? '#FCD34D' : '#F9A8D4',
                border: `1px solid ${buildingMode ? 'rgba(245, 158, 11, 0.4)' : 'rgba(236, 72, 153, 0.3)'}`,
              }}
              title={buildingMode ? 'Generate as 4-sided building façade' : 'Generate image'}
            >
              {inFlight.length > 0 ? `Imagine (${inFlight.length})` : (buildingMode ? 'Conjure 🏛️' : 'Imagine')}
              {imagineCost > 0 && (
                <span className="ml-1 opacity-60 text-[9px]">{imagineCost}cr</span>
              )}
            </button>
          </div>
          {error && (
            <div className="mt-1 text-[10px] text-red-400 font-mono">{error}</div>
          )}
        </div>

        {/* In-flight generations */}
        {inFlight.length > 0 && (
          <div>
            <div className="text-[10px] text-pink-400/60 uppercase tracking-widest font-mono mb-1.5">
              Generating ({inFlight.length})
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {inFlight.map(f => (
                <div key={f.id} className="relative rounded-lg overflow-hidden border border-pink-500/20 bg-black/40">
                  <div className="w-full aspect-square flex flex-col items-center justify-center p-2">
                    {f.error ? (
                      <>
                        <div className="text-red-400 text-lg mb-1">{'\u2715'}</div>
                        <div className="text-[9px] text-red-400 font-mono text-center">{f.error}</div>
                        <button
                          onClick={() => setInFlight(prev => prev.filter(x => x.id !== f.id))}
                          className="mt-1 text-[9px] text-gray-400 hover:text-gray-200 font-mono"
                        >dismiss</button>
                      </>
                    ) : (
                      <>
                        <div className="text-2xl mb-2 animate-pulse">{'\u{1F3A8}'}</div>
                        <div className="text-[9px] text-pink-300 font-mono text-center line-clamp-2">{f.prompt}</div>
                        <div className="text-[8px] text-gray-500 font-mono mt-1">
                          {IMAGINE_MODELS.find(m => m.key === f.model)?.label || f.model}
                        </div>
                        {/* Pulsing progress bar */}
                        <div className="w-full mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500 animate-pulse rounded-full" style={{ width: `${Math.min(90, ((Date.now() - f.startedAt) / 300))}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gallery — unified AssetCard grid */}
        {generatedImages.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-widest font-mono mb-1.5">
              Gallery ({generatedImages.length})
            </div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {[...generatedImages].reverse().map(img => {
                const placedCount = placedCatalogAssets.filter(ca => ca.imageUrl === img.url).length
                const isPlaced = placedCount > 0
                return (
                  <AssetCard
                    key={img.id}
                    id={img.id}
                    name={img.prompt}
                    type="media-image"
                    thumbnailUrl={img.url}
                    mediaUrl={img.url}
                    isInWorld={isPlaced}
                    accentColor="#EC4899"
                    subtitle={new Date(img.createdAt).toLocaleDateString()}
                    onClick={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url })}
                    onDelete={() => onRequestDelete(img, placedCount)}
                    onDownload={(_, url) => {
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `${img.prompt.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'oasis-image'}.${url.split('.').pop() || 'png'}`
                      a.click()
                    }}
                    onUseAsTile={() => handleUseAsTile(img.id)}
                    onViewFullscreen={() => setLightboxUrl(img.url)}
                    onPlaceWithFrame={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url, imageFrameStyle: 'gilded' })}
                  />
                )
              })}
            </div>
          </div>
        )}

        {generatedImages.length === 0 && inFlight.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <div className="text-3xl mb-2">{'\u{1F3A8}'}</div>
            <div className="text-xs">No images generated yet</div>
            <div className="text-[10px] mt-1 text-gray-500">Type a prompt and hit Imagine</div>
          </div>
        )}

        {/* Custom ground textures summary */}
        {customGroundPresets.length > 0 && (
          <div className="border-t border-gray-700/30 pt-2">
            <div className="text-[10px] text-emerald-400/60 uppercase tracking-widest font-mono mb-1">
              Custom Tile Textures ({customGroundPresets.length})
            </div>
            <div className="text-[9px] text-gray-500 font-mono">
              Available in World tab {'\u2192'} Ground palette
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA TAB — Upload, browse, manage all media (images, videos, audio)
// ░▒▓ Sub-tabs: Generate (Imagine), Images, Videos, Audio ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

interface MediaItem {
  name: string; url: string; type: 'image' | 'video' | 'audio'; size: number; createdAt: string
}

function MediaLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center cursor-pointer"
      onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="fullscreen" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()} />
      <button className="absolute top-4 right-4 text-white/60 hover:text-white text-3xl cursor-pointer"
        onClick={onClose}>&times;</button>
    </div>
  )
}

function MediaTab({ cols, onRequestDelete }: { cols: number; onRequestDelete: (target: { url: string; name: string; placedCount: number }, onConfirm: () => Promise<void>) => void }) {
  const [subTab, setSubTab] = useState<'generate' | 'image' | 'video' | 'audio'>('generate')
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const behaviors = useOasisStore(s => s.behaviors)
  const addCustomGroundPreset = useOasisStore(s => s.addCustomGroundPreset)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const removeGeneratedImage = useOasisStore(s => s.removeGeneratedImage)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch media list
  const fetchMedia = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/media/list')
      if (res.ok) {
        const { items } = await res.json()
        setMediaItems(items)
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchMedia() }, [fetchMedia])

  // Upload handler
  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      await fetch('/api/media/upload', { method: 'POST', body: formData })
    }
    fetchMedia() // Refresh list
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [fetchMedia])

  // Delete handler
  const handleDelete = useCallback(async (url: string) => {
    await fetch('/api/media/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    fetchMedia()
  }, [fetchMedia])

  // Use-as-tile handler for uploaded images
  const handleUseAsTile = useCallback((imageUrl: string) => {
    const presetId = `custom_media_${imageUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-30)}`
    if (!customGroundPresets.some(p => p.id === presetId)) {
      const name = mediaItems.find(m => m.url === imageUrl)?.name || 'media tile'
      addCustomGroundPreset({
        id: presetId,
        name: name.slice(0, 20),
        icon: '\u{1F3A8}',
        color: '#888888',
        assetName: '',
        tileRepeat: 8,
        customTextureUrl: imageUrl,
      })
    }
    enterPaintMode(presetId)
  }, [mediaItems, customGroundPresets, addCustomGroundPreset, enterPaintMode])

  // Count placed instances — check all media URL fields
  const countPlaced = useCallback((url: string) => {
    let count = placedCatalogAssets.filter(a =>
      a.imageUrl === url || a.videoUrl === url || a.audioUrl === url
    ).length
    // Also check behaviors (audio attached via behavior system)
    for (const b of Object.values(behaviors)) {
      if (b && b.audioUrl === url) count++
    }
    return count
  }, [placedCatalogAssets, behaviors])

  const filtered = mediaItems.filter(m => subTab === 'generate' ? false : m.type === subTab)
  const formatSize = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`

  const subTabs = [
    { key: 'generate' as const, label: 'Generate', icon: '\u{1F3A8}' },
    { key: 'image' as const, label: 'Images', icon: '\u{1F5BC}' },
    { key: 'video' as const, label: 'Videos', icon: '\u{1F3AC}' },
    { key: 'audio' as const, label: 'Audio', icon: '\u{1F3B5}' },
  ]

  return (
    <div className="space-y-3">
      {/* Sub-tab pills */}
      <div className="flex gap-1 flex-wrap">
        {subTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              subTab === t.key
                ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40'
                : 'text-gray-400 border border-gray-700/30 hover:text-white hover:border-gray-500/50'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
        {/* Upload button */}
        <label className="text-[10px] px-2 py-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition-colors cursor-pointer ml-auto">
          + Upload
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            onChange={e => handleUpload(e.target.files)}
            className="hidden"
          />
        </label>
      </div>

      {/* Generate sub-tab = ImagineTab (passes cols + lightbox) */}
      {subTab === 'generate' && (
        <ImagineTab
          cols={cols}
          setLightboxUrl={setLightboxUrl}
          onRequestDelete={(image, placedCount) => {
            onRequestDelete(
              { url: image.url, name: image.prompt.slice(0, 30) || 'generated image', placedCount },
              async () => { removeGeneratedImage(image.id) }
            )
          }}
        />
      )}

      {/* Media browser */}
      {subTab !== 'generate' && (
        <>
          {loading && <div className="text-[10px] text-gray-500 text-center py-4">Loading...</div>}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <div className="text-3xl mb-2">{subTabs.find(t => t.key === subTab)?.icon}</div>
              <div className="text-xs">No {subTab} files uploaded</div>
              <div className="text-[10px] mt-1 text-gray-500">Drag & drop or use Upload button</div>
            </div>
          )}

          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {filtered.map(item => {
              const placedCount = countPlaced(item.url)
              const mediaType = item.type === 'image' ? 'media-image' as const
                : item.type === 'video' ? 'media-video' as const
                : 'media-audio' as const
              return (
                <AssetCard
                  key={item.url}
                  id={item.url}
                  name={item.name}
                  type={mediaType}
                  thumbnailUrl={item.type === 'image' ? item.url : undefined}
                  mediaUrl={item.url}
                  isInWorld={placedCount > 0}
                  accentColor="#EC4899"
                  subtitle={formatSize(item.size)}
                  onClick={() => {
                    if (item.type === 'image') {
                      // Click = placement mode (NOT lightbox)
                      enterPlacementMode({ type: 'image', name: item.name, imageUrl: item.url })
                    } else if (item.type === 'video') {
                      // Click on video = placement mode
                      enterPlacementMode({ type: 'video', name: item.name, videoUrl: item.url })
                    } else if (item.type === 'audio') {
                      enterPlacementMode({
                        type: 'catalog',
                        catalogId: 'kf_speaker',
                        name: item.name.replace(/\.[^.]+$/, '') || 'Loudspeaker',
                        path: '/models/kenney-furniture/speaker.glb',
                        defaultScale: 2,
                        audioUrl: item.url,
                      })
                    }
                  }}
                  onDelete={() => {
                    onRequestDelete(
                      { url: item.url, name: item.name, placedCount },
                      async () => { await handleDelete(item.url) }
                    )
                  }}
                  onDownload={item.type === 'image' ? (_, url) => {
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${item.name}`
                    a.click()
                  } : undefined}
                  onUseAsTile={item.type === 'image' ? () => handleUseAsTile(item.url) : undefined}
                  onViewFullscreen={item.type === 'image' ? () => setLightboxUrl(item.url) : undefined}
                  onPlaceWithFrame={item.type === 'image' ? () => enterPlacementMode({ type: 'image', name: item.name, imageUrl: item.url, imageFrameStyle: 'gilded' }) : undefined}
                  badges={placedCount > 0 ? (
                    <span className="text-[8px] text-sky-400 font-mono">{placedCount} placed</span>
                  ) : undefined}
                />
              )
            })}
          </div>
        </>
      )}

      {/* Delete confirmation modal — portaled to escape overflow:hidden */}

      {/* Image lightbox — portaled to escape overflow:hidden */}
      {lightboxUrl && typeof document !== 'undefined' && createPortal(
        <MediaLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />,
        document.body
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIZARD CONSOLE — Main popup component
// ═══════════════════════════════════════════════════════════════════════════════

// Note: settings has been moved to the global Config menu
// (src/components/forge/config/ConfigMenu.tsx). Do not re-add 'settings' here.
export type WizardMode = 'conjure' | 'craft' | 'world' | 'assets' | 'placed' | 'agents' | 'media' | 'music' | 'video'
type WizardAssetSubTab = 'catalog' | 'portals' | 'spatial' | 'conjured' | 'crafted' | 'images'

const WIZARD_ASSET_SUBTABS = new Set<WizardAssetSubTab>(['catalog', 'portals', 'spatial', 'conjured', 'crafted', 'images'])

function isWizardAssetSubTab(value: unknown): value is WizardAssetSubTab {
  return typeof value === 'string' && WIZARD_ASSET_SUBTABS.has(value as WizardAssetSubTab)
}

interface WizardConsoleProps {
  isOpen: boolean
  onClose: () => void
  variant?: 'local' | 'hosted'
  /** Optional initial tab; if set while isOpen flips true, WizCon opens on that tab. */
  initialTab?: WizardMode
}

const WIZARD_TABS = [
  { key: 'conjure', label: 'Conjure', icon: '✨', color: 'orange', title: 'Text-to-3D conjuring' },
  { key: 'craft', label: 'Craft', icon: '⚒️', color: 'blue', title: 'LLM procedural geometry' },
  { key: 'world', label: 'World', icon: '🌍', color: 'emerald', title: 'Sky, ground, terrain' },
  { key: 'assets', label: 'Assets', icon: '📦', color: 'yellow', title: 'Pre-made 3D asset catalog' },
  { key: 'placed', label: 'Placed', icon: '📍', color: 'cyan', title: 'All objects placed in this world' },
  { key: 'agents', label: 'Agents', icon: '💻', color: 'purple', title: '3D agent windows in this world' },
  { key: 'media', label: 'Media', icon: '🎬', color: 'pink', title: 'Images, videos, audio — upload & manage' },
  { key: 'music', label: 'Music', icon: '🎵', color: 'violet', title: 'Text-to-music generation' },
  { key: 'video', label: 'Video', icon: '🎞️', color: 'rose', title: 'Text-to-video generation' },
] as const satisfies ReadonlyArray<{
  key: WizardMode
  label: string
  icon: string
  color: 'orange' | 'blue' | 'emerald' | 'yellow' | 'cyan' | 'purple' | 'pink' | 'violet' | 'rose'
  title: string
}>

const WIZARD_TAB_ORDER: WizardMode[] = ['world', 'assets', 'media', 'music', 'video', 'agents', 'craft', 'conjure', 'placed']
const WIZARD_TAB_LABEL_OVERRIDES: Partial<Record<WizardMode, string>> = {
  agents: '3D Agents',
  craft: 'Crafting',
  conjure: 'Conjuring',
}
const ORDERED_WIZARD_TABS = WIZARD_TAB_ORDER
  .map(key => WIZARD_TABS.find(tab => tab.key === key))
  .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))
  .map(tab => ({ ...tab, label: WIZARD_TAB_LABEL_OVERRIDES[tab.key] || tab.label }))

const HOSTED_WIZARD_MODES = new Set<WizardMode>(['world', 'assets', 'placed'])
const ADMIN_WIZARD_MODES = new Set<WizardMode>(['media', 'music', 'video', 'agents', 'craft', 'conjure'])

export function WizardConsole({ isOpen, onClose, variant = 'local', initialTab }: WizardConsoleProps) {
  useUILayer('wizard-console', isOpen)
  const capabilities = useOasisCapabilities()
  const hostedVariant = variant === 'hosted'
  const canUseAdminTabs = !hostedVariant || capabilities.canUseFullWizard || capabilities.canUseAdminPanels
  // ─═̷─ Position & size state — persisted to localStorage ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 60, y: 80 }
    try {
      const saved = localStorage.getItem('oasis-wizard-pos')
      return saved ? JSON.parse(saved) : { x: 60, y: 80 }
    } catch { return { x: 60, y: 80 } }
  })
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { width: 400, height: 560 }
    try {
      const saved = localStorage.getItem('oasis-wizard-size')
      return saved ? JSON.parse(saved) : { width: 400, height: 560 }
    } catch { return { width: 400, height: 560 } }
  })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ width: 0, height: 0, x: 0, y: 0 })
  // ░▒▓ Adaptive tabs — measure overflow, downgrade to icon-only when needed ▓▒░
  const tabStripRef = useRef<HTMLDivElement>(null)
  const [showTabLabels, setShowTabLabels] = useState(size.width >= 720)

  // ░▒▓ Persist window geometry to localStorage on drag/resize end ▓▒░
  useEffect(() => {
    if (!isDragging && !isResizing) {
      localStorage.setItem('oasis-wizard-pos', JSON.stringify(position))
      localStorage.setItem('oasis-wizard-size', JSON.stringify(size))
    }
  }, [isDragging, isResizing, position, size])

  // ░▒▓ Tab label overflow detection — try labels at wide sizes, downgrade if overflow ▓▒░
  useEffect(() => { setShowTabLabels(size.width >= 720) }, [size.width])
  useEffect(() => {
    const el = tabStripRef.current
    if (!el || !showTabLabels) return
    // After render with labels: if content overflows, switch to icons only
    requestAnimationFrame(() => {
      if (el.scrollWidth > el.clientWidth + 4) setShowTabLabels(false)
    })
  }, [showTabLabels, size.width])

  // ─═̷─ Wizard state ─═̷─
  const [mode, setMode] = useState<WizardMode>(initialTab || 'world')
  useEffect(() => {
    if (initialTab && isOpen) setMode(initialTab)
  }, [initialTab, isOpen])
  const visibleTabs = ORDERED_WIZARD_TABS.filter(tab => {
    if (canUseAdminTabs) return true
    return HOSTED_WIZARD_MODES.has(tab.key) && !ADMIN_WIZARD_MODES.has(tab.key)
  })
  const [provider, setProvider] = useState<ProviderName>('meshy')
  const [tier, setTier] = useState(PROVIDERS[0].tiers[1]?.id || PROVIDERS[0].tiers[0].id)  // Default: textured (refine)
  const [prompt, setPrompt] = useState('')
  const [isCasting, setIsCasting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visibleTabs.some(tab => tab.key === mode)) setMode('world')
  }, [mode, visibleTabs])
  // ░▒▓ Character pipeline — A-pose mode for riggable output ▓▒░
  const [characterMode, setCharacterMode] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null) // thumbnail for dropped files
  const imageFileRef = useRef<HTMLInputElement>(null)

  // ░▒▓ Collapsible conjure sections — Text-to-3D vs Image-to-3D ▓▒░
  type ConjureSection = 'text' | 'image'
  const [conjureExpanded, setConjureExpanded] = useState<ConjureSection>('text')

  // ░▒▓ Image-to-3D section has its own provider/tier/char state ▓▒░
  const [imgProvider, setImgProvider] = useState<ProviderName>('tripo')
  const [imgTier, setImgTier] = useState(PROVIDERS.find(p => p.name === 'tripo')?.tiers[3]?.id || 'premium')  // Default: v3.1
  const [imgCharacterMode, setImgCharacterMode] = useState(false)
  const [imgPrompt, setImgPrompt] = useState('')  // optional prompt hint for image-to-3D

  // ░▒▓ Auto-pipeline — chain rig after conjure completes ▓▒░
  // (Auto-animate removed: library animations handle all dance moves locally)
  const [autoRig, setAutoRig] = useState(false)
  // Same for image section
  const [imgAutoRig, setImgAutoRig] = useState(false)

  // ░▒▓ Grid column counts — per-tab, localStorage-persisted ▓▒░
  const [colsCatalog, setColsCatalog] = useState(() => readCols('catalog', 3))
  const [colsCrafted, setColsCrafted] = useState(() => readCols('crafted', 3))
  const [colsConjured, setColsConjured] = useState(() => readCols('conjured', 3))
  const [colsMedia, setColsMedia] = useState(() => readCols('media', 3))
  const updateCols = (key: string, v: number, setter: (v: number) => void) => {
    setter(v); try { localStorage.setItem(`oasis-wizard-cols-${key}`, String(v)) } catch {}
  }

  // ░▒▓ Convert dropped/selected image file to base64 data URI ▓▒░
  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUri = reader.result as string
      setImageUrl(dataUri)
      setImagePreview(dataUri)
    }
    reader.readAsDataURL(file)
  }, [])

  // ─═̷─ Conjuration engine ─═̷─
  const { conjuredAssets, startConjure, processAsset, deleteAsset, activeCount } = useConjure()
  const updateConjuredAsset = useOasisStore(s => s.updateConjuredAsset)

  // ░▒▓ Rename — PATCH to server + update local store ▓▒░
  const renameAsset = useCallback(async (id: string, displayName: string) => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/conjure/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      })
      if (res.ok) {
        updateConjuredAsset(id, { displayName })
      }
    } catch (err) {
      console.error('[Forge] Rename failed:', err)
    }
  }, [updateConjuredAsset])

  // ─═̷─ Craft engine ─═̷─
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const addCraftedScene = useOasisStore(s => s.addCraftedScene)
  const updateCraftedScene = useOasisStore(s => s.updateCraftedScene)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const deleteFromLibrary = useOasisStore(s => s.deleteFromLibrary)
  const [activeCrafts, setActiveCrafts] = useState(0)


  // ─═̷─ Texture paint entrypoints ─═̷─
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const exitPaintMode = useOasisStore(s => s.exitPaintMode)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const terrainBrushRadius = useOasisStore(s => s.terrainBrushRadius)
  const terrainBrushIntensity = useOasisStore(s => s.terrainBrushIntensity)
  const terrainBrushDirection = useOasisStore(s => s.terrainBrushDirection)
  const setTerrainBrushPanelOpen = useOasisStore(s => s.setTerrainBrushPanelOpen)
  const setTerrainBrushMode = useOasisStore(s => s.setTerrainBrushMode)

  // ─═̷─ World sky ─═̷─
  const worldSkyBackground = useOasisStore(s => s.worldSkyBackground)
  const setWorldSkyBackground = useOasisStore(s => s.setWorldSkyBackground)
  // ─═̷─ World lights ─═̷─
  const worldLights = useOasisStore(s => s.worldLights)
  const addWorldLight = useOasisStore(s => s.addWorldLight)
  const updateWorldLight = useOasisStore(s => s.updateWorldLight)
  const removeWorldLight = useOasisStore(s => s.removeWorldLight)

  // ─═̷─ Sky background (from SettingsContext) ─═̷─
  const { settings, updateSetting } = useContext(SettingsContext)

  // ─═̷─ Iterative craft state ─═̷─
  const [craftHistory, setCraftHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])

  // ─═̷─ World management ─═̷─
  const exportCurrentWorld = useOasisStore(s => s.exportCurrentWorld)
  const importWorldFromJson = useOasisStore(s => s.importWorldFromJson)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const [deleteConfirm, setDeleteConfirm] = useState<ConfirmDeleteState | null>(null)

  const requestPermanentDelete = useCallback((options: {
    itemName: string
    placedCount?: number
    worldCount?: number
    usageUrl?: string
    onConfirm: () => void | Promise<void>
  }) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setDeleteConfirm({
      requestId,
      itemName: options.itemName,
      placedCount: options.placedCount,
      worldCount: options.worldCount,
      loadingUsage: !!options.usageUrl,
      onConfirm: async () => {
        await options.onConfirm()
        setDeleteConfirm(null)
      },
    })

    if (!options.usageUrl) return

    fetch(options.usageUrl)
      .then(r => r.json())
      .then((usage: { totalCount: number; worldCount: number }) => {
        setDeleteConfirm(prev => prev?.requestId === requestId
          ? { ...prev, placedCount: usage.totalCount, worldCount: usage.worldCount, loadingUsage: false }
          : prev)
      })
      .catch(() => {
        setDeleteConfirm(prev => prev?.requestId === requestId
          ? { ...prev, loadingUsage: false }
          : prev)
      })
  }, [])

  // ─═̷─ Transform controls ─═̷─
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const selectObject = useOasisStore(s => s.selectObject)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const setCameraLookAt = useOasisStore(s => s.setCameraLookAt)
  const transforms = useOasisStore(s => s.transforms)

  // ─═̷─ Catalog + placement state ─═̷─
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const removeConjuredAssetFromWorld = useOasisStore(s => s.removeConjuredAssetFromWorld)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const portalGates = useOasisStore(s => s.portalGates)
  const removePortalGate = useOasisStore(s => s.removePortalGate)
  const spatialWebObjects = useOasisStore(s => s.spatialWebObjects)
  const removeSpatialWebObject = useOasisStore(s => s.removeSpatialWebObject)
  const seedSpatialWebRsvpDemo = useOasisStore(s => s.seedSpatialWebRsvpDemo)
  const removeCatalogAsset = useOasisStore(s => s.removeCatalogAsset)
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const removeAgentWindow = useOasisStore(s => s.removeAgentWindow)
  const focusAgentWindow = useOasisStore(s => s.focusAgentWindow)
  const paintStrokes = useOasisStore(s => s.paintStrokes)
  const removePaintStroke = useOasisStore(s => s.removePaintStroke)
  const playPaintStroke = useOasisStore(s => s.playPaintStroke)
  const updatePaintStroke = useOasisStore(s => s.updatePaintStroke)
  const text3dObjects = useOasisStore(s => s.text3dObjects)
  const removeText3dObject = useOasisStore(s => s.removeText3dObject)
  const generatedImages = useOasisStore(s => s.generatedImages)
  const removeGeneratedImage = useOasisStore(s => s.removeGeneratedImage)
  const addCustomGroundPreset = useOasisStore(s => s.addCustomGroundPreset)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const [assetCategory, setAssetCategory] = useState<string>('all')
  const [assetSubTab, setAssetSubTab] = useState<WizardAssetSubTab>('catalog')
  const [portalTargetWorldId, setPortalTargetWorldId] = useState('')
  const [portalActionPreset, setPortalActionPreset] = useState<'load_world' | 'create_private' | 'create_public' | 'create_ffa' | 'external_url' | 'locked_message'>('load_world')
  const [portalExternalUrl, setPortalExternalUrl] = useState('https://conjure.04515.xyz/?portal=true&from=oasis')
  const [portalLockedMessage, setPortalLockedMessage] = useState('This portal is not open yet.')
  const [previewAsset, setPreviewAsset] = useState<AssetDefinition | null>(null)
  const [previewConjured, setPreviewConjured] = useState<ConjuredAsset | null>(null)
  const [previewCrafted, setPreviewCrafted] = useState<CraftedScene | null>(null)
  const [assetsLightboxUrl, setAssetsLightboxUrl] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScrollTop = useRef(0)

  useEffect(() => {
    const onOpenWizardAssetsTab = (event: Event) => {
      const detail = (event as CustomEvent<{ assetSubTab?: unknown; subTab?: unknown }>).detail
      const candidate = detail?.assetSubTab ?? detail?.subTab
      if (!isWizardAssetSubTab(candidate)) return
      setMode('assets')
      setAssetSubTab(candidate)
    }
    window.addEventListener('oasis:open-wizard-assets-tab', onOpenWizardAssetsTab as EventListener)
    return () => window.removeEventListener('oasis:open-wizard-assets-tab', onOpenWizardAssetsTab as EventListener)
  }, [])

  const placeSpatialWebTemplate = useCallback((template: typeof SPATIAL_WEB_ASSET_TEMPLATES[number]) => {
    enterPlacementMode({
      type: 'spatialWeb',
      name: template.label,
      spatialWebObject: createSpatialWebObjectFromTemplate(template),
    })
  }, [enterPlacementMode])

  // ░▒▓ Catch orphan crafted scenes without thumbnails on mount ▓▒░
  useCraftedThumbnailGenerator()
  const portalThumbVersion = usePortalThumbnailGenerator()

  // ░▒▓ Catalog thumbnail generator — manual trigger for 100+ GLB renders ▓▒░
  const catalogThumbGen = useCatalogThumbnailGenerator()

  // ░▒▓ Clear preview + exit paint mode when switching tabs ▓▒░
  useEffect(() => {
    setPreviewAsset(null)
    setPreviewConjured(null)
    setPreviewCrafted(null)
    if (mode !== 'world') exitPaintMode()
  }, [mode, exitPaintMode])

  // ─═̷─ Model selector (craft + voice) ─═̷─
  const craftModel = useOasisStore(s => s.craftModel)
  const setCraftModel = useOasisStore(s => s.setCraftModel)

  // ─═̷─ VFX settings + preview ─═̷─
  const conjureVfxType = useOasisStore(s => s.conjureVfxType)
  const setConjureVfxType = useOasisStore(s => s.setConjureVfxType)
  const placementVfxType = useOasisStore(s => s.placementVfxType)
  const setPlacementVfxType = useOasisStore(s => s.setPlacementVfxType)
  const placementVfxDuration = useOasisStore(s => s.placementVfxDuration)
  const setPlacementVfxDuration = useOasisStore(s => s.setPlacementVfxDuration)
  const previewPlacementSpell = useOasisStore(s => s.previewPlacementSpell)
  const startConjurePreview = useOasisStore(s => s.startConjurePreview)
  const placementPending = useOasisStore(s => s.placementPending)
  const cancelPlacement = useOasisStore(s => s.cancelPlacement)
  // Panel opacity driven by system-level uiOpacity setting (Settings gear menu)
  const opacity = settings.uiOpacity

  // ─═̷─ Collapsible world-tab sections ─═̷─
  type WorldSection = 'sky' | 'terrainBrush' | 'lights' | 'terrain'
  const [collapsedSections, setCollapsedSections] = useState<Set<WorldSection>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = JSON.parse(localStorage.getItem('oasis-world-collapsed') || '[]')
      return new Set(stored as WorldSection[])
    } catch { return new Set() }
  })
  const toggleSection = (section: WorldSection) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section); else next.add(section)
      localStorage.setItem('oasis-world-collapsed', JSON.stringify([...next]))
      return next
    })
  }
  const terrainReliefActive = terrainHeights.some(height => Math.abs(height) > 0.001)

  // Update tier when provider changes
  const selectedProvider = PROVIDERS.find(p => p.name === provider) || PROVIDERS[0]
  const selectedTier = selectedProvider.tiers.find(t => t.id === tier) || selectedProvider.tiers[0]

  const handleProviderChange = useCallback((newProvider: ProviderName) => {
    setProvider(newProvider)
    const p = PROVIDERS.find(pp => pp.name === newProvider)
    // Default to LAST tier (best quality) when switching providers
    if (p) setTier(p.tiers[p.tiers.length - 1].id)
  }, [])

  const handleImgProviderChange = useCallback((newProvider: ProviderName) => {
    setImgProvider(newProvider)
    const p = PROVIDERS.find(pp => pp.name === newProvider)
    if (p) setImgTier(p.tiers[p.tiers.length - 1].id)
  }, [])

  // Provider objects for image section
  const imgSelectedProvider = PROVIDERS.find(p => p.name === imgProvider) || PROVIDERS[0]
  const imgSelectedTier = imgSelectedProvider.tiers.find(t => t.id === imgTier) || imgSelectedProvider.tiers[0]

  // ░▒▓ Dynamic pricing from admin dashboard ▓▒░
  const { pricing } = usePricing()
  const p = useCallback((key: string, fallback: number = 1) => {
    return pricing[key] ?? fallback
  }, [pricing])
  // Conjure price lookup — e.g. conjure_meshy_refine
  const conjurePrice = useCallback((prov: string, t: string) => {
    return p(getConjurePriceKey(prov, t))
  }, [p])

  // ░▒▓ Animation preset is hardcoded — walk is the universal default ▓▒░
  // Meshy: downloads free walk+run GLBs from rig result. Tripo: animate_retarget with 'walk'.

  // ═══════════════════════════════════════════════════════════════════════════
  // CAST THE SPELL
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════
  // CAST THE SPELL — Text-to-3D
  // ═══════════════════════════════════════════════════════════════════════
  const handleCast = useCallback(async () => {
    if (!prompt.trim() || isCasting) return
    setError(null)
    setIsCasting(true)

    try {
      const options: Record<string, unknown> = {}
      if (characterMode) {
        options.characterMode = true
        options.characterOptions = { poseMode: 'a-pose' as const, topology: 'quad' as const, symmetry: true }
      }
      // ░▒▓ Auto-pipeline flag — backend chains rig after conjure ▓▒░
      if (characterMode && autoRig) {
        options.autoRig = true
      }

      await startConjure(prompt.trim(), provider, tier, Object.keys(options).length > 0 ? options as never : undefined)
      setPrompt('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Conjuration failed')
    } finally {
      setIsCasting(false)
    }
  }, [prompt, isCasting, provider, tier, startConjure, characterMode, autoRig])

  // ═══════════════════════════════════════════════════════════════════════
  // CAST THE SPELL — Image-to-3D
  // ═══════════════════════════════════════════════════════════════════════
  const handleImageCast = useCallback(async () => {
    if (!imageUrl.trim() || isCasting) return
    setError(null)
    setIsCasting(true)

    try {
      const options: Record<string, unknown> = {
        imageUrl: imageUrl.trim(),
      }
      // Optional prompt hint for image-to-3D
      const castPrompt = imgPrompt.trim() || 'image to 3D'
      if (imgCharacterMode) {
        options.characterMode = true
        options.characterOptions = { poseMode: 'a-pose' as const, topology: 'quad' as const, symmetry: true }
      }
      if (imgCharacterMode && imgAutoRig) {
        options.autoRig = true
      }

      await startConjure(castPrompt, imgProvider, imgTier, options as never)
      setImageUrl('')
      setImagePreview(null)
      setImgPrompt('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Conjuration failed')
    } finally {
      setIsCasting(false)
    }
  }, [imageUrl, isCasting, imgProvider, imgTier, imgPrompt, imgCharacterMode, imgAutoRig, startConjure])

  // ═══════════════════════════════════════════════════════════════════════════
  // CRAFT — LLM procedural geometry
  // ═══════════════════════════════════════════════════════════════════════════

  const setCraftingState = useOasisStore(s => s.setCraftingState)

  const handleCraft = useCallback(async () => {
    if (!prompt.trim()) return
    setError(null)
    // Capture prompt and clear immediately — allows firing next craft right away
    const craftPrompt = prompt.trim()
    setPrompt('')
    setActiveCrafts(n => n + 1)
    setCraftingState(true, craftPrompt)
    // ░▒▓ WORLD ISOLATION — capture origin world at craft start ▓▒░
    const originWorldId = useOasisStore.getState().activeWorldId

    // Build iterative context — include previous scene if exists
    const lastScene = craftedScenes[craftedScenes.length - 1]
    const iterativePrompt = lastScene && craftHistory.length > 0
      ? `Previous scene "${lastScene.name}" had ${lastScene.objects.length} objects: ${JSON.stringify(lastScene.objects.slice(0, 5))}...\n\nUser wants: ${craftPrompt}`
      : craftPrompt

    // ░▒▓ STREAMING CRAFT — objects materialize one by one as the LLM thinks ▓▒░
    // 1. Create placeholder scene (triggers VFX, offset, undo)
    // 2. Stream tokens, parse partial JSON, update scene incrementally
    // 3. Finalize: library save, thumbnail, XP, world save
    const sceneId = `craft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const spawn = derivePlayerCastSpawn(4)
    const placeholderScene: CraftedScene = {
      id: sceneId,
      name: 'Crafting...',
      prompt: craftPrompt,
      objects: [],
      position: spawn.position,
      model: craftModel,
      createdAt: new Date().toISOString(),
    }

    try {
      const isCC = craftModel.startsWith('cc-')
      const res = await fetch(`${OASIS_BASE}/api/craft/${isCC ? 'cc' : 'stream'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: iterativePrompt, model: craftModel }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      if (!res.body) throw new Error('No stream body')

      // Add placeholder scene to world — VFX plays, position offset calculated.
      // Guard: only add if we're still in the origin world. If the user switched worlds
      // while the fetch was in-flight, don't contaminate the new world with this craft.
      // The isolation block at stream-end will still save the result to the origin world.
      if (useOasisStore.getState().activeWorldId === originWorldId) {
        addCraftedScene(placeholderScene)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let lastObjectCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        accumulated += decoder.decode(value, { stream: true })

        // Extract complete objects from the partial JSON stream
        const partial = extractPartialCraftData(accumulated)

        // Update scene name as soon as we parse it
        if (partial.name && partial.name !== 'Crafting...') {
          updateCraftedScene(sceneId, { name: partial.name })
        }

        // New objects found — update the scene so they materialize in the 3D view
        if (partial.objects.length > lastObjectCount) {
          updateCraftedScene(sceneId, { objects: [...partial.objects] })
          lastObjectCount = partial.objects.length
        }
      }

      // ░▒▓ FINALIZE — stream complete, do the post-craft housekeeping ▓▒░
      const finalParsed = extractPartialCraftData(accumulated)
      const finalScene: CraftedScene = {
        id: sceneId,
        name: finalParsed.name || 'Unnamed Scene',
        prompt: craftPrompt,
        objects: finalParsed.objects,
        position: spawn.position,
        createdAt: placeholderScene.createdAt,
        model: craftModel,
      }

      if (finalParsed.objects.length === 0) {
        // LLM returned garbage — remove the placeholder
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
        throw new Error('LLM returned no valid objects')
      }

      // Final update with cleaned data
      updateCraftedScene(sceneId, { name: finalScene.name, objects: finalScene.objects })

      // ░▒▓ WORLD ISOLATION — if user switched worlds mid-craft ▓▒░
      const currentWorldId = useOasisStore.getState().activeWorldId
      if (currentWorldId !== originWorldId) {
        console.log(`[Forge:Craft:Stream] World changed during craft (${originWorldId} → ${currentWorldId}). Moving result to origin.`)
        // Remove from current world's store, save to origin via API
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
        try {
          const { loadWorld, saveWorld } = await import('../../lib/forge/world-persistence')
          const originState = await loadWorld(originWorldId)
          if (originState) {
            // Filter out the placeholder (sceneId) in case it snuck into an older
            // remote-sync save path during the world switch save, then append the
            // completed final scene.
            const withoutPlaceholder = (originState.craftedScenes || []).filter((s: { id: string }) => s.id !== sceneId)
            await saveWorld({ ...originState, craftedScenes: [...withoutPlaceholder, finalScene] }, originWorldId)
          }
        } catch (saveErr) {
          console.error('[Forge:Craft:Stream] Failed to save to origin world:', saveErr)
        }
      }

      // Update scene library with the FINAL version (not the empty placeholder)
      addToSceneLibrary(finalScene).then(() =>
        getSceneLibrary().then(lib => useOasisStore.setState({ sceneLibrary: lib }))
      )
      // Thumbnail
      generateSingleCraftedThumbnail(finalScene).catch(() => {})
      // XP
      awardXp('CRAFT_SCENE', originWorldId)
      // Save world state
      dispatch({ type: 'SAVE_WORLD' })
      // Track conversation for iterative mode
      setCraftHistory(prev => [
        ...prev,
        { role: 'user', content: craftPrompt },
        { role: 'assistant', content: `Created "${finalScene.name}" with ${finalScene.objects.length} primitives` },
      ])

      console.log(`[Forge:Craft:Stream] Done: "${finalScene.name}" — ${finalScene.objects.length} objects streamed in`)

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Craft failed')
      // Clean up placeholder if it exists and has no objects
      const existing = useOasisStore.getState().craftedScenes.find(s => s.id === sceneId)
      if (existing && existing.objects.length === 0) {
        dispatch({ type: 'REMOVE_CRAFTED_SCENE', payload: { id: sceneId } })
      }
    } finally {
      setActiveCrafts(n => {
        const next = n - 1
        if (next <= 0) setCraftingState(false)
        return Math.max(0, next)
      })
    }
  }, [prompt, addCraftedScene, updateCraftedScene, craftedScenes, craftHistory, craftModel, setCraftingState])

  // ═══════════════════════════════════════════════════════════════════════════
  // TERRAIN — LLM terrain generation
  // ═══════════════════════════════════════════════════════════════════════════


  // Enter key to cast/craft (Shift+Enter for newline) — terrain has its own inline input in World tab
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (mode === 'craft') handleCraft()
      else handleCast()
    }
  }, [mode, handleCast, handleCraft])

  // Enter key for image section prompt
  const handleImageKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleImageCast()
    }
  }, [handleImageCast])

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG HANDLERS (same pattern as CuratorStreamPopup)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return
    if ((e.target as HTMLElement).closest('button')) return
    if ((e.target as HTMLElement).closest('select')) return
    if ((e.target as HTMLElement).closest('textarea')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    e.preventDefault()
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragStart.current.x)),
      y: Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragStart.current.y)),
    })
  }, [isDragging, size])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  // ═══════════════════════════════════════════════════════════════════════════
  // RESIZE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    resizeStart.current = { width: size.width, height: size.height, x: e.clientX, y: e.clientY }
    e.preventDefault()
    e.stopPropagation()
  }, [size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const deltaX = e.clientX - resizeStart.current.x
    const deltaY = e.clientY - resizeStart.current.y
    setSize({
      width: Math.max(350, resizeStart.current.width + deltaX),
      height: Math.max(400, resizeStart.current.height + deltaY),
    })
  }, [isResizing])

  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  // Global mouse events for drag/resize
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isDragging, isResizing, handleDrag, handleDragEnd, handleResize, handleResizeEnd])

  if (!isOpen) return null

  const forgeColor = '#F97316' // orange-500

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — The portal opens
  // ═══════════════════════════════════════════════════════════════════════════

  return createPortal(
    <div
      data-menu-portal="wizard-console"
      data-ui-panel
      className="fixed rounded-xl border overflow-hidden shadow-2xl flex flex-col"
      style={{
        zIndex: useOasisStore.getState().getPanelZIndex('wizard', 9999),
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        backgroundColor: `rgba(0, 0, 0, ${opacity})`,
        borderColor: activeCount > 0 ? `${forgeColor}66` : 'rgba(100, 100, 100, 0.3)',
        boxShadow: activeCount > 0
          ? `0 0 30px ${forgeColor}33, 0 0 60px ${forgeColor}11`
          : '0 0 20px rgba(0, 0, 0, 0.5)',
      }}
      onMouseDown={(e) => { e.stopPropagation(); useOasisStore.getState().bringPanelToFront('wizard') }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ─═̷─═̷─ HEADER — Draggable ─═̷─═̷─ */}
      <div
        className="px-3 py-2 border-b border-gray-700/50 flex items-center justify-between cursor-move select-none flex-shrink-0"
        onMouseDown={handleDragStart}
        style={{
          background: activeCount > 0
            ? `linear-gradient(135deg, ${forgeColor}22 0%, rgba(0,0,0,0) 100%)`
            : 'rgba(30, 30, 30, 0.5)',
        }}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg">🧙‍♂️</span>
          {size.width >= 520 && <span className="text-sm tracking-widest" style={{ color: forgeColor, fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", fontWeight: 700, fontVariant: 'small-caps', letterSpacing: '0.15em' }}>{hostedVariant ? 'World Console' : 'Wizard Console'}</span>}
          {activeCount > 0 && (
            <span className="text-yellow-400 text-xs animate-pulse">&#9679; {activeCount}</span>
          )}
        </div>

        <div className="flex items-center gap-1 min-w-0 flex-1 ml-2 overflow-hidden">
          {/* ░▒▓ Adaptive tab strip — icons always, labels when there's room ▓▒░ */}
          <div ref={tabStripRef} className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1 pb-0.5" style={{ scrollbarWidth: 'none' }}>
            {visibleTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setMode(tab.key)}
                className={`inline-flex min-w-fit flex-shrink-0 items-center justify-center text-xs px-1.5 py-0.5 rounded transition-colors whitespace-nowrap ${
                  mode === tab.key
                    ? `bg-${tab.color}-500/20 text-${tab.color}-400 border border-${tab.color}-500/50`
                    : 'text-gray-300 border border-transparent hover:text-white'
                }`}
                title={tab.title}
                style={mode === tab.key ? {
                  backgroundColor: `rgba(${tab.color === 'orange' ? '249,115,22' : tab.color === 'blue' ? '59,130,246' : tab.color === 'emerald' ? '16,185,129' : tab.color === 'yellow' ? '234,179,8' : tab.color === 'cyan' ? '6,182,212' : tab.color === 'purple' ? '168,85,247' : tab.color === 'violet' ? '139,92,246' : tab.color === 'rose' ? '244,63,94' : '236,72,153'}, 0.2)`,
                  color: `rgb(${tab.color === 'orange' ? '251,146,60' : tab.color === 'blue' ? '96,165,250' : tab.color === 'emerald' ? '52,211,153' : tab.color === 'yellow' ? '250,204,21' : tab.color === 'cyan' ? '34,211,238' : tab.color === 'purple' ? '192,132,252' : tab.color === 'violet' ? '196,181,253' : tab.color === 'rose' ? '253,164,175' : '244,114,182'})`,
                  borderColor: `rgba(${tab.color === 'orange' ? '249,115,22' : tab.color === 'blue' ? '59,130,246' : tab.color === 'emerald' ? '16,185,129' : tab.color === 'yellow' ? '234,179,8' : tab.color === 'cyan' ? '6,182,212' : tab.color === 'purple' ? '168,85,247' : tab.color === 'violet' ? '139,92,246' : tab.color === 'rose' ? '244,63,94' : '236,72,153'}, 0.5)`,
                } : undefined}
              >
                <span className="flex-shrink-0 text-sm leading-none">{tab.icon}</span>{showTabLabels && <span className="ml-1">{tab.label}</span>}
              </button>
            ))}
          </div>
          {/* ░▒▓ Fixed controls — NEVER shrink, always visible ▓▒░ */}
          {/* The old gear/settings button moved to the global Config menu
              (rail "CONFIG" → src/components/forge/config/ConfigMenu.tsx). */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors text-lg leading-none ml-1"
            >
              &#215;
            </button>
          </div>
        </div>
      </div>

      {/* ─═̷─═̷─ PLACEMENT MODE INDICATOR ─═̷─═̷─ */}
      {placementPending && (
        <div className="px-3 py-1.5 border-b border-yellow-700/30 flex items-center justify-between flex-shrink-0 animate-pulse"
          style={{ background: 'rgba(60, 40, 0, 0.3)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-yellow-400 text-sm">&#9670;</span>
            <span className="text-[10px] text-yellow-300 font-mono">PLACEMENT MODE</span>
            <span className="text-[9px] text-yellow-500/60 font-mono">click ground to place {placementPending.name}</span>
          </div>
          <button
            onClick={() => cancelPlacement()}
            className="text-[9px] text-gray-400 hover:text-red-400 font-mono border border-gray-700/30 rounded px-1.5 py-0.5"
          >
            ESC cancel
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
           ░▒▓█ CONJURE SECTIONS — Text-to-3D + Image-to-3D █▓▒░
           Two collapsible sections, each with own provider/tier/char/pipeline
           ═══════════════════════════════════════════════════════════════════ */}
      {mode === 'conjure' && (
        <div className="border-b border-gray-700/30 flex-shrink-0">

          {/* ░▒▓ TEXT-TO-3D SECTION ▓▒░ */}
          <div>
            <button
              onClick={() => setConjureExpanded(conjureExpanded === 'text' ? 'image' : 'text')}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-orange-500/5 transition-colors cursor-pointer"
              style={{ background: conjureExpanded === 'text' ? 'rgba(249, 115, 22, 0.06)' : 'rgba(20, 20, 20, 0.5)' }}
            >
              <span className="text-[11px] text-orange-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
                <span className={`text-xs text-orange-400/70 transition-transform duration-150 inline-block ${conjureExpanded === 'text' ? 'rotate-90' : ''}`}>&#9654;</span>
                Text to 3D
              </span>
              <span className="text-[9px] text-gray-400 font-mono">
                {selectedProvider.displayName} / {selectedTier.name}
              </span>
            </button>
            {conjureExpanded === 'text' && (
              <div className="px-3 pb-2 space-y-2" style={{ background: 'rgba(20, 20, 20, 0.3)' }}>
                {/* Provider + Tier row */}
                <div className="flex items-center gap-2 pt-1">
                  <select value={provider} onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
                    className="text-[11px] bg-black/60 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:border-orange-500/50 focus:outline-none cursor-pointer">
                    {PROVIDERS.map(p => <option key={p.name} value={p.name}>{p.displayName}</option>)}
                  </select>
                  <select value={tier} onChange={(e) => setTier(e.target.value)}
                    className="text-[11px] bg-black/60 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:border-orange-500/50 focus:outline-none cursor-pointer">
                    {selectedProvider.tiers.map(t => { const cost = conjurePrice(selectedProvider.name, t.id); return <option key={t.id} value={t.id}>{t.name} ({cost} cr)</option> })}
                  </select>
                  <span className="text-[9px] text-orange-400/70 font-mono ml-auto">~{selectedTier.estimatedSeconds}s | {conjurePrice(provider, tier)} cr</span>
                </div>

                {/* Stuff / Character toggle + auto-pipeline */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded overflow-hidden border border-gray-700/40">
                    <button onClick={() => { setCharacterMode(false); setAutoRig(false) }}
                      className={`text-[10px] px-2 py-0.5 font-mono transition-colors ${!characterMode ? 'bg-orange-500/20 text-orange-300' : 'text-gray-400 hover:text-gray-300 bg-black/30'}`}
                      title="Object/stuff mode — standard 3D model">
                      {'\uD83D\uDCE6'} Stuff
                    </button>
                    <button onClick={() => setCharacterMode(true)}
                      className={`text-[10px] px-2 py-0.5 font-mono transition-colors ${characterMode ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-gray-300 bg-black/30'}`}
                      title="Character mode: A-pose, quad topology, symmetric mesh (riggable)">
                      {'\uD83E\uDDCD'} Character
                    </button>
                  </div>
                  {characterMode && (
                    <>
                      <label className="flex items-center gap-1 cursor-pointer" title={`Auto-rig after generation completes (${p('post_rig', 0.75)} cr)`}>
                        <input type="checkbox" checked={autoRig} onChange={(e) => setAutoRig(e.target.checked)}
                          className="w-3 h-3 rounded border-gray-600 bg-black/60 accent-amber-500" />
                        <span className="text-[10px] text-amber-400/70 font-mono">Auto-rig ({p('post_rig', 0.75)} cr)</span>
                      </label>
                    </>
                  )}
                </div>

                {/* Prompt + Cast button */}
                <div className="flex gap-2">
                  <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={handleKeyDown}
                    disabled={isCasting} rows={2}
                    placeholder="a crystal dragon perched on a floating rock..."
                    className="flex-1 text-xs bg-black/60 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
                  <button onClick={handleCast} disabled={!prompt.trim() || isCasting}
                    className="px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed self-end"
                    style={{ background: `${forgeColor}33`, color: forgeColor, border: `1px solid ${forgeColor}55` }}
                    title={`Costs ${conjurePrice(provider, tier)}${autoRig ? ` + ${p('post_rig', 0.75)} rig` : ''} credits`}>
                    {isCasting ? '...' : characterMode ? (autoRig ? '\uD83E\uDDCD\u2192\u2699' : 'Cast \uD83E\uDDCD') : 'Cast \u2728'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ░▒▓ IMAGE-TO-3D SECTION ▓▒░ */}
          <div className="border-t border-gray-700/20">
            <button
              onClick={() => setConjureExpanded(conjureExpanded === 'image' ? 'text' : 'image')}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-pink-500/5 transition-colors cursor-pointer"
              style={{ background: conjureExpanded === 'image' ? 'rgba(236, 72, 153, 0.06)' : 'rgba(20, 20, 20, 0.5)' }}
            >
              <span className="text-[11px] text-pink-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
                <span className={`text-xs text-pink-400/70 transition-transform duration-150 inline-block ${conjureExpanded === 'image' ? 'rotate-90' : ''}`}>&#9654;</span>
                Image to 3D
                {imageUrl.trim() && <span className="text-[8px] text-pink-400 ml-1">&#9679;</span>}
              </span>
              <span className="text-[9px] text-gray-400 font-mono">
                {imgSelectedProvider.displayName} / {imgSelectedTier.name}
              </span>
            </button>
            {conjureExpanded === 'image' && (
              <div className="px-3 pb-2 space-y-2" style={{ background: 'rgba(20, 20, 20, 0.3)' }}>
                {/* Drop zone / file picker */}
                <div
                  className="flex items-center gap-2 mt-1 cursor-pointer rounded border border-dashed border-pink-700/40 hover:border-pink-500/60 px-2 py-1.5 transition-colors"
                  onClick={() => imageFileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const file = e.dataTransfer.files[0]; if (file) handleImageFile(file) }}
                >
                  {imagePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagePreview} alt="preview" className="w-10 h-10 rounded object-cover border border-pink-500/30" />
                  ) : (
                    <span className="text-pink-500/50 text-lg">&#128247;</span>
                  )}
                  <span className="text-[10px] text-pink-400/60 font-mono flex-1">
                    {imagePreview ? 'Image loaded' : 'Drop image or click to browse'}
                  </span>
                  {imageUrl.trim() && (
                    <button onClick={(e) => { e.stopPropagation(); setImageUrl(''); setImagePreview(null) }}
                      className="text-[10px] text-pink-500 hover:text-pink-300">&#215;</button>
                  )}
                </div>
                <input ref={imageFileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImageFile(file) }} />

                {/* URL paste input */}
                <input type="text" value={imageUrl.startsWith('data:') ? '' : imageUrl}
                  onChange={(e) => { setImageUrl(e.target.value); setImagePreview(null) }}
                  placeholder="or paste public image URL..."
                  className="w-full text-[11px] bg-black/60 border border-pink-700/30 rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:border-pink-500/50 focus:outline-none font-mono" />

                {/* Provider + Tier row */}
                <div className="flex items-center gap-2">
                  <select value={imgProvider} onChange={(e) => handleImgProviderChange(e.target.value as ProviderName)}
                    className="text-[11px] bg-black/60 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:border-pink-500/50 focus:outline-none cursor-pointer">
                    {PROVIDERS.map(p => <option key={p.name} value={p.name}>{p.displayName}</option>)}
                  </select>
                  <select value={imgTier} onChange={(e) => setImgTier(e.target.value)}
                    className="text-[11px] bg-black/60 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:border-pink-500/50 focus:outline-none cursor-pointer">
                    {imgSelectedProvider.tiers.map(t => { const cost = conjurePrice(imgSelectedProvider.name, t.id); return <option key={t.id} value={t.id}>{t.name} ({cost} cr)</option> })}
                  </select>
                  <span className="text-[9px] text-orange-400/70 font-mono ml-auto">~{imgSelectedTier.estimatedSeconds}s | {conjurePrice(imgProvider, imgTier)} cr</span>
                </div>

                {/* Stuff / Character toggle + auto-pipeline */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded overflow-hidden border border-gray-700/40">
                    <button onClick={() => { setImgCharacterMode(false); setImgAutoRig(false) }}
                      className={`text-[10px] px-2 py-0.5 font-mono transition-colors ${!imgCharacterMode ? 'bg-pink-500/20 text-pink-300' : 'text-gray-400 hover:text-gray-300 bg-black/30'}`}
                      title="Object/stuff mode — standard 3D model">
                      {'\uD83D\uDCE6'} Stuff
                    </button>
                    <button onClick={() => setImgCharacterMode(true)}
                      className={`text-[10px] px-2 py-0.5 font-mono transition-colors ${imgCharacterMode ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-gray-300 bg-black/30'}`}
                      title="Character mode: A-pose, quad topology, symmetric mesh (riggable)">
                      {'\uD83E\uDDCD'} Character
                    </button>
                  </div>
                  {imgCharacterMode && (
                    <>
                      <label className="flex items-center gap-1 cursor-pointer" title={`Auto-rig after generation completes (${p('post_rig', 0.75)} cr)`}>
                        <input type="checkbox" checked={imgAutoRig} onChange={(e) => setImgAutoRig(e.target.checked)}
                          className="w-3 h-3 rounded border-gray-600 bg-black/60 accent-amber-500" />
                        <span className="text-[10px] text-amber-400/70 font-mono">Auto-rig ({p('post_rig', 0.75)} cr)</span>
                      </label>
                    </>
                  )}
                </div>

                {/* Optional prompt hint + Cast button */}
                <div className="flex gap-2">
                  <input type="text" value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)}
                    onKeyDown={handleImageKeyDown}
                    placeholder="optional: describe the object..."
                    className="flex-1 text-xs bg-black/60 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-pink-500/50" />
                  <button onClick={handleImageCast} disabled={!imageUrl.trim() || isCasting}
                    className="px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed self-end"
                    style={{ background: '#EC489933', color: '#EC4899', border: '1px solid #EC489955' }}
                    title={`Costs ${conjurePrice(imgProvider, imgTier)}${imgAutoRig ? ` + ${p('post_rig', 0.75)} rig` : ''} credits`}>
                    {isCasting ? '...' : imgCharacterMode ? (imgAutoRig ? '\uD83D\uDCF7\u2192\u2699' : 'Cast \uD83D\uDCF7\uD83E\uDDCD') : 'Cast \uD83D\uDCF7'}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ─═̷─═̷─ CRAFT MODE info bar + model selector + animated toggle ─═̷─═̷─ */}
      {mode === 'craft' && (
        <div className="px-3 py-2 border-b border-gray-700/30 flex items-center justify-between flex-shrink-0"
          style={{ background: 'rgba(20, 20, 20, 0.5)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-400/70 font-mono">LLM craft</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500 font-mono">{craftedScenes.length} scene{craftedScenes.length !== 1 ? 's' : ''}</span>
            <select
              value={craftModel}
              onChange={(e) => setCraftModel(e.target.value)}
              className="text-[10px] bg-black/60 border border-blue-700/30 rounded px-1.5 py-0.5 text-blue-300 font-mono cursor-pointer focus:outline-none focus:border-blue-500/50 appearance-none"
              style={{ backgroundImage: 'none' }}
              title="LLM model for crafting + terrain"
            >
              <option value="google/gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite Preview</option>
              <option value="google/gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
              <option value="cc-opus">CC Opus</option>
              <option value="cc-sonnet">CC Sonnet</option>
              <option value="anthropic/claude-sonnet-4-6">Sonnet 4.6</option>
              <option value="anthropic/claude-haiku-4-5">Haiku 4.5</option>
              <option value="z-ai/glm-5">GLM-5</option>
              <option value="x-ai/grok-4.20-beta">Grok 4.20 Beta</option>
              <option value="nvidia/nemotron-3-super-120b-a12b:free">Nemotron 3 Super 120B A12B</option>
              <option value="qwen/qwen3.5-397b-a17b">Qwen 3.5 397B A17B</option>
              <option value="liquid/lfm-2-24b-a2b">LFM 2 24B A2B</option>
              <option value="openai/gpt-5.4">GPT-5.4</option>
              <option value="google/gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
              <option value="minimax/minimax-m2.7">Minimax M2.7</option>
            </select>
          </div>
        </div>
      )}

      {/* Terrain info bar removed — now inline in World tab */}

      {/* Transform controls bar moved to ObjectInspector — R/T/Y hotkeys still work globally */}

      {/* ─═̷─═̷─ CRAFT SPELL INPUT (only in craft mode — conjure has inline inputs) ─═̷─═̷─ */}
      {mode === 'craft' && (
      <div className="px-3 py-2 flex gap-2 flex-shrink-0">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="craft a red house with a blue door and chimney..."
          className="flex-1 text-xs bg-black/60 border border-blue-700/40 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500/50"
        />
        <button
          onClick={handleCraft}
          disabled={!prompt.trim()}
          className="px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed self-end"
          style={{ background: '#3B82F633', color: '#3B82F6', border: '1px solid #3B82F655' }}
          title="Craft scene from description"
        >
          {activeCrafts > 0 ? `Craft \u2699 (${activeCrafts})` : 'Craft \u2699'}
        </button>
      </div>
      )}

      {/* Error display */}
      {error && (
        <div className="px-3 pb-1 flex-shrink-0">
          <div className={`text-[10px] rounded px-2 py-1 ${
            error.includes('Insufficient credits')
              ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
              : 'text-red-400 bg-red-500/10 border border-red-500/20'
          }`}>
            {error}
            <button
              onClick={() => setError(null)}
              className={`ml-2 ${error.includes('Insufficient credits') ? 'text-amber-500 hover:text-amber-300' : 'text-red-500 hover:text-red-300'}`}
            >
              &#215;
            </button>
          </div>
        </div>
      )}

      {/* ─══ॐ══─ GALLERY / WORLD / ASSETS / PLACED / SETTINGS ─══ॐ══─ */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {mode === 'world' ? (
          <div className="space-y-4">

            {/* ░▒▓█ SKY BACKGROUND — The heavens above █▓▒░ */}
            <div>
              <button onClick={() => toggleSection('sky')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-indigo-500/20 bg-indigo-950/40 hover:bg-indigo-900/30 hover:border-indigo-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
                <span className="text-[11px] text-indigo-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
                  <span className={`text-xs text-indigo-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('sky') ? '' : 'rotate-90'}`}>&#9654;</span>
                  Sky Background
                </span>
                <span className="text-[10px] text-indigo-400/50 font-mono">
                  {SKY_BACKGROUNDS.find(s => s.id === worldSkyBackground)?.name || 'Procedural Stars'}
                </span>
              </button>
              {!collapsedSections.has('sky') && (
                <div className="grid grid-cols-2 gap-1.5">
                  {SKY_BACKGROUNDS.map(sky => {
                    const isActive = worldSkyBackground === sky.id
                    return (
                      <button
                        key={sky.id}
                        onClick={() => setWorldSkyBackground(sky.id)}
                        className={`rounded-lg border px-2 py-1.5 transition-all duration-200 text-left ${
                          isActive
                            ? 'border-indigo-500/60 bg-indigo-500/10'
                            : 'border-gray-700/30 bg-black/40 hover:border-indigo-500/30 hover:bg-indigo-500/5'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{sky.path ? (sky.path.endsWith('.exr') ? '\u{1F30C}' : '\u{1F303}') : '\u2728'}</span>
                          <span className={`text-[10px] font-medium ${isActive ? 'text-indigo-300' : 'text-gray-400'}`}>
                            {sky.name}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ░▒▓█ TERRAIN BRUSH — elevation + texture window █▓▒░ */}
            <div>
              <button onClick={() => toggleSection('terrainBrush')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-teal-500/20 bg-teal-950/40 hover:bg-teal-900/30 hover:border-teal-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
                <span className="text-[11px] text-teal-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
                  <span className={`text-xs text-teal-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('terrainBrush') ? '' : 'rotate-90'}`}>&#9654;</span>
                  Terrain Brush
                </span>
                <span className="text-[10px] text-teal-400/50 font-mono">
                  {terrainReliefActive ? 'relief active' : `${terrainBrushDirection} ${terrainBrushRadius.toFixed(1)}m`}
                </span>
              </button>
              {!collapsedSections.has('terrainBrush') && (
                <div className="rounded-lg border border-teal-500/20 bg-black/30 p-2.5 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => { setTerrainBrushPanelOpen(true); setTerrainBrushMode('sculpt') }}
                      className="rounded-md border border-amber-400/35 bg-amber-400/10 px-2 py-2 text-[10px] font-bold text-amber-200 hover:bg-amber-400/18"
                    >
                      Open elevation
                    </button>
                    <button
                      onClick={() => { setTerrainBrushPanelOpen(true); setTerrainBrushMode('texture') }}
                      className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-2 text-[10px] font-bold text-emerald-200 hover:bg-emerald-400/18"
                    >
                      Open texture
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-mono text-teal-100/45">
                    <span>radius {terrainBrushRadius.toFixed(1)}m</span>
                    <span>intensity {terrainBrushIntensity.toFixed(1)}/s</span>
                    <span>{terrainReliefActive ? 'saved relief' : 'flat'}</span>
                  </div>
                </div>
              )}
            </div>


            {/* ░▒▓█ LIGHTS — World illumination controls █▓▒░ */}
            <div>
              <button onClick={() => toggleSection('lights')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-yellow-500/20 bg-yellow-950/40 hover:bg-yellow-900/30 hover:border-yellow-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
                <span className="text-[11px] text-yellow-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
                  <span className={`text-xs text-yellow-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('lights') ? '' : 'rotate-90'}`}>&#9654;</span>
                  Lights
                </span>
                <span className="text-[10px] text-yellow-400/50 font-mono">
                  {worldLights.length} source{worldLights.length !== 1 ? 's' : ''}
                </span>
              </button>
              {!collapsedSections.has('lights') && (<>

              {/* ── Scene lights: ambient / hemisphere / directional / environment (inline controls) ── */}
              {worldLights.filter(l => l.type === 'ambient' || l.type === 'hemisphere' || l.type === 'directional' || l.type === 'environment').map(light => {
                // For directional: derive azimuth/elevation from position vector
                const pos = light.position || [30, 40, 20]
                const dist = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]) || 50
                const elevation = Math.asin(Math.min(1, Math.max(-1, pos[1] / dist))) * 180 / Math.PI
                const azimuth = ((Math.atan2(pos[0], pos[2]) * 180 / Math.PI) + 360) % 360

                return (
                  <LightTooltipWrap key={light.id} type={light.type} className="relative mb-2">
                  <div className="p-2 rounded-lg border border-gray-700/30 bg-black/30">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{light.type === 'ambient' ? '🌫️' : light.type === 'hemisphere' ? '🌗' : light.type === 'environment' ? '🌐' : '☀️'}</span>
                        <span className="text-[10px] font-medium text-gray-300">
                          {light.type === 'ambient' ? 'Ambient' : light.type === 'hemisphere' ? 'Hemisphere' : light.type === 'environment' ? 'Environment (IBL)' : 'Sun'}
                        </span>
                      </div>
                      <button
                        onClick={() => removeWorldLight(light.id)}
                        className="w-5 h-5 flex items-center justify-center rounded bg-red-500/10 border border-red-500/20 text-red-400/70 hover:bg-red-500/30 hover:text-red-300 hover:border-red-400/40 text-sm font-bold transition-all"
                        title="Remove light"
                      >
                        &#215;
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {/* Color (not for environment — IBL uses preset) */}
                      {light.type !== 'environment' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">{light.type === 'hemisphere' ? 'Sky' : 'Color'}</span>
                        <input
                          type="color"
                          value={light.color}
                          onChange={e => updateWorldLight(light.id, { color: e.target.value })}
                          className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                        />
                        <span className="text-[8px] text-gray-400 font-mono">{light.color}</span>
                      </div>
                      )}
                      {/* Ground color (hemisphere only) */}
                      {light.type === 'hemisphere' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-500 font-mono w-10">Gnd</span>
                          <input
                            type="color"
                            value={light.groundColor || '#3a5f0b'}
                            onChange={e => updateWorldLight(light.id, { groundColor: e.target.value })}
                            className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                          />
                          <span className="text-[8px] text-gray-400 font-mono">{light.groundColor || '#3a5f0b'}</span>
                        </div>
                      )}
                      {/* Intensity — per-type max from LIGHT_INTENSITY_MAX */}
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Int</span>
                        <input
                          type="range"
                          min={0}
                          max={LIGHT_INTENSITY_MAX[light.type]}
                          step={LIGHT_INTENSITY_STEP[light.type]}
                          value={light.intensity}
                          onChange={e => updateWorldLight(light.id, { intensity: parseFloat(e.target.value) })}
                          className="flex-1 h-1 accent-yellow-500"
                        />
                        <span className="text-[9px] text-yellow-400/70 font-mono w-8 text-right">{light.intensity.toFixed(1)}</span>
                      </div>
                      {/* Azimuth + Elevation (directional/sun only) */}
                      {light.type === 'directional' && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-gray-500 font-mono w-10">Azim</span>
                            <input
                              type="range"
                              min={0}
                              max={360}
                              step={1}
                              value={Math.round(azimuth)}
                              onChange={e => {
                                const a = parseFloat(e.target.value) * Math.PI / 180
                                const el = Math.round(elevation) * Math.PI / 180
                                const r = 50
                                updateWorldLight(light.id, { position: [
                                  r * Math.cos(el) * Math.sin(a),
                                  r * Math.sin(el),
                                  r * Math.cos(el) * Math.cos(a),
                                ] as [number, number, number] })
                              }}
                              className="flex-1 h-1 accent-orange-500"
                            />
                            <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(azimuth)}°</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-gray-500 font-mono w-10">Elev</span>
                            <input
                              type="range"
                              min={5}
                              max={90}
                              step={1}
                              value={Math.round(elevation)}
                              onChange={e => {
                                const el = parseFloat(e.target.value) * Math.PI / 180
                                const a = Math.round(azimuth) * Math.PI / 180
                                const r = 50
                                updateWorldLight(light.id, { position: [
                                  r * Math.cos(el) * Math.sin(a),
                                  r * Math.sin(el),
                                  r * Math.cos(el) * Math.cos(a),
                                ] as [number, number, number] })
                              }}
                              className="flex-1 h-1 accent-orange-500"
                            />
                            <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(elevation)}°</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  </LightTooltipWrap>
                )
              })}

              {/* Add scene light buttons — with styled HTML tooltips */}
              <div className="flex gap-1.5 mb-2 flex-wrap">
                <LightTooltipWrap type="directional" className="relative flex-1">
                  <button
                    onClick={() => addWorldLight('directional')}
                    className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
                  >
                    + Sun
                  </button>
                </LightTooltipWrap>
                <LightTooltipWrap type="ambient" className="relative flex-1">
                  <button
                    onClick={() => addWorldLight('ambient')}
                    className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
                  >
                    + Ambient
                  </button>
                </LightTooltipWrap>
                <LightTooltipWrap type="hemisphere" className="relative flex-1">
                  <button
                    onClick={() => addWorldLight('hemisphere')}
                    className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
                  >
                    + Hemi
                  </button>
                </LightTooltipWrap>
                {!worldLights.some(l => l.type === 'environment') && (
                  <LightTooltipWrap type="environment" className="relative flex-1">
                    <button
                      onClick={() => addWorldLight('environment')}
                      className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
                    >
                      + IBL
                    </button>
                  </LightTooltipWrap>
                )}
              </div>

              {/* ── Positional lights: point / spot (3D-placed orbs) ── */}
              <div className="text-[9px] text-gray-400 font-mono mb-1">Place in world:</div>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { type: 'point' as WorldLightType, icon: '💡', label: 'Point', desc: 'Omni glow' },
                  { type: 'spot' as WorldLightType, icon: '🔦', label: 'Spot', desc: 'Cone beam' },
                ]).map(light => (
                  <LightTooltipWrap key={light.type} type={light.type} className="relative">
                    <button
                      onClick={() => addWorldLight(light.type)}
                      className="w-full rounded-lg border border-gray-700/30 bg-black/40 hover:border-yellow-500/40 hover:bg-yellow-500/5 p-2 transition-all duration-200 text-left group"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{light.icon}</span>
                        <div>
                          <div className="text-[10px] font-medium text-gray-400 group-hover:text-yellow-300 transition-colors">
                            {light.label}
                          </div>
                          <div className="text-[8px] text-gray-400">{light.desc}</div>
                        </div>
                      </div>
                    </button>
                  </LightTooltipWrap>
                ))}
              </div>

              {/* ── Existing positional lights: inline controls ── */}
              {worldLights.filter(l => l.type === 'point' || l.type === 'spot').map(light => (
                <LightTooltipWrap key={light.id} type={light.type} className="relative mt-1.5">
                <div className="p-2 rounded-lg border border-gray-700/30 bg-black/30">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{light.type === 'point' ? '💡' : '🔦'}</span>
                      <span className="text-[10px] font-medium text-gray-300">
                        {light.type === 'point' ? 'Point' : 'Spot'}
                      </span>
                      <span className="text-[8px] text-gray-400 font-mono">
                        ({light.position.map(v => Math.round(v)).join(', ')})
                      </span>
                    </div>
                    <button
                      onClick={() => removeWorldLight(light.id)}
                      className="text-[9px] text-red-400/50 hover:text-red-300 font-mono"
                      title="Remove light"
                    >
                      &#215;
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {/* Color */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 font-mono w-10">Color</span>
                      <input
                        type="color"
                        value={light.color}
                        onChange={e => updateWorldLight(light.id, { color: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-[8px] text-gray-400 font-mono">{light.color}</span>
                    </div>
                    {/* Intensity — per-type max from LIGHT_INTENSITY_MAX */}
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 font-mono w-10">Int</span>
                      <input
                        type="range"
                        min={0}
                        max={LIGHT_INTENSITY_MAX[light.type]}
                        step={LIGHT_INTENSITY_STEP[light.type]}
                        value={light.intensity}
                        onChange={e => updateWorldLight(light.id, { intensity: parseFloat(e.target.value) })}
                        className="flex-1 h-1 accent-yellow-500"
                      />
                      <span className="text-[9px] text-yellow-400/70 font-mono w-8 text-right">{light.intensity.toFixed(1)}</span>
                    </div>
                    {/* Spot angle + direction (azimuth/elevation) */}
                    {light.type === 'spot' && (() => {
                      const tgt = light.target || [0, -1, 0]
                      const tLen = Math.sqrt(tgt[0] * tgt[0] + tgt[1] * tgt[1] + tgt[2] * tgt[2]) || 1
                      const spotElev = Math.asin(Math.min(1, Math.max(-1, tgt[1] / tLen))) * 180 / Math.PI
                      const spotAzim = ((Math.atan2(tgt[0], tgt[2]) * 180 / Math.PI) + 360) % 360
                      return (<>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Angle</span>
                        <input
                          type="range"
                          min={5}
                          max={90}
                          step={1}
                          value={light.angle ?? 45}
                          onChange={e => updateWorldLight(light.id, { angle: parseFloat(e.target.value) })}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(light.angle ?? 45)}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Azim</span>
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={1}
                          value={Math.round(spotAzim)}
                          onChange={e => {
                            const a = parseFloat(e.target.value) * Math.PI / 180
                            const el = Math.round(spotElev) * Math.PI / 180
                            updateWorldLight(light.id, { target: [
                              Math.cos(el) * Math.sin(a),
                              Math.sin(el),
                              Math.cos(el) * Math.cos(a),
                            ] as [number, number, number] })
                          }}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(spotAzim)}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Elev</span>
                        <input
                          type="range"
                          min={-90}
                          max={90}
                          step={1}
                          value={Math.round(spotElev)}
                          onChange={e => {
                            const el = parseFloat(e.target.value) * Math.PI / 180
                            const a = Math.round(spotAzim) * Math.PI / 180
                            updateWorldLight(light.id, { target: [
                              Math.cos(el) * Math.sin(a),
                              Math.sin(el),
                              Math.cos(el) * Math.cos(a),
                            ] as [number, number, number] })
                          }}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(spotElev)}°</span>
                      </div>
                      </>)
                    })()}
                  </div>
                </div>
                </LightTooltipWrap>
              ))}
              </>)}
            </div>


            {/* ░▒▓█ WORLD IMPORT/EXPORT █▓▒░ */}
            <div className="flex gap-2 pt-2 border-t border-gray-800/50">
              <button
                onClick={async () => {
                  const json = await exportCurrentWorld()
                  if (!json) return
                  const blob = new Blob([json], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  const worldName = worldRegistry.find(w => w.id === activeWorldId)?.name || 'world'
                  a.href = url
                  a.download = `${worldName.replace(/\s+/g, '-').toLowerCase()}.oasis.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="text-[10px] text-blue-400/70 hover:text-blue-300 font-mono border border-blue-500/20 rounded px-2 py-0.5"
              >
                Export world
              </button>
              <label
                className="text-[10px] text-blue-400/70 hover:text-blue-300 font-mono border border-blue-500/20 rounded px-2 py-0.5 cursor-pointer"
              >
                Import world
                <input
                  type="file"
                  accept=".json,.oasis.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = async () => {
                      const result = await importWorldFromJson(reader.result as string)
                      if (!result) setError('Failed to import world — invalid format')
                    }
                    reader.readAsText(file)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>

          </div>
        ) : mode === 'assets' ? (
          previewAsset ? (
            /* ░▒▓█ 3D PREVIEW — Catalog asset █▓▒░ */
            <ModelPreviewPanel
              asset={previewAsset}
              onBack={() => {
                setPreviewAsset(null)
                requestAnimationFrame(() => {
                  if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current
                })
              }}
              onPlace={(a) => {
                enterPlacementMode({ type: 'catalog', catalogId: a.id, name: a.name, path: a.path, defaultScale: a.defaultScale })
                setPreviewAsset(null)
              }}
              accentColor="#EAB308"
              canvasHeight={400}
            />
          ) : previewConjured ? (
            /* ░▒▓█ 3D PREVIEW — Conjured GLB model █▓▒░ */
            <ModelPreviewPanel
              asset={{
                id: previewConjured.id,
                name: previewConjured.displayName || previewConjured.prompt.slice(0, 40),
                path: previewConjured.glbPath ? `${OASIS_BASE}${previewConjured.glbPath}` : '',
                category: 'props',
                defaultScale: previewConjured.scale ?? 1,
              }}
              onBack={() => {
                setPreviewConjured(null)
                requestAnimationFrame(() => {
                  if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current
                })
              }}
              onPlace={() => {
                enterPlacementMode({
                  type: 'conjured',
                  name: (previewConjured.displayName || previewConjured.prompt).slice(0, 24),
                  path: previewConjured.glbPath ? `${OASIS_BASE}${previewConjured.glbPath}` : undefined,
                  defaultScale: previewConjured.scale ?? 1,
                })
                setPreviewConjured(null)
              }}
              accentColor="#F97316"
              canvasHeight={400}
            />
          ) : previewCrafted ? (
            /* ░▒▓█ 3D PREVIEW — Crafted primitive scene █▓▒░ */
            <CraftedPreviewPanel
              scene={previewCrafted}
              onBack={() => {
                setPreviewCrafted(null)
                requestAnimationFrame(() => {
                  if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current
                })
              }}
              onPlace={(scene) => {
                enterPlacementMode({
                  type: 'crafted',
                  sceneId: scene.id,
                  name: scene.name,
                })
                setPreviewCrafted(null)
              }}
              accentColor="#3B82F6"
              canvasHeight={400}
            />
          ) : (
          <>
            {/* ═══════════════════════════════════════════════════════════════════
                SUB-TAB BAR — Catalog / Conjured / Crafted
                ─═̷─═̷─ Three galleries under one roof ─═̷─═̷─
                ═══════════════════════════════════════════════════════════════════ */}
            <div className="flex items-center gap-1 mb-2">
              {([
                { key: 'catalog' as const, label: 'Catalog', count: ASSET_CATALOG.length, color: 'yellow' },
                { key: 'portals' as const, label: 'Portals', count: PORTAL_GATE_VARIANT_DEFS.length, color: 'cyan' },
                { key: 'spatial' as const, label: 'Spatial', count: SPATIAL_WEB_ASSET_TEMPLATES.length, color: 'cyan' },
                { key: 'conjured' as const, label: 'Conjured', count: conjuredAssets.filter(a => a.status === 'ready').length, color: 'orange' },
                { key: 'crafted' as const, label: 'Crafted', count: sceneLibrary.length, color: 'blue' },
                { key: 'images' as const, label: 'Images', count: generatedImages.length, color: 'pink' },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setAssetSubTab(tab.key)}
                  className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
                    assetSubTab === tab.key
                      ? `bg-${tab.color}-500/20 text-${tab.color}-300 border border-${tab.color}-500/40`
                      : 'text-gray-400 border border-gray-700/30 hover:text-gray-200 hover:border-gray-600/50'
                  }`}
                  style={assetSubTab === tab.key ? {
                    background: tab.color === 'yellow' ? 'rgba(234,179,8,0.15)' : tab.color === 'orange' ? 'rgba(249,115,22,0.15)' : tab.color === 'pink' ? 'rgba(236,72,153,0.15)' : tab.color === 'cyan' ? 'rgba(34,211,238,0.15)' : 'rgba(59,130,246,0.15)',
                    color: tab.color === 'yellow' ? '#FDE047' : tab.color === 'orange' ? '#FB923C' : tab.color === 'pink' ? '#F9A8D4' : tab.color === 'cyan' ? '#67E8F9' : '#93C5FD',
                    borderColor: tab.color === 'yellow' ? 'rgba(234,179,8,0.4)' : tab.color === 'orange' ? 'rgba(249,115,22,0.4)' : tab.color === 'pink' ? 'rgba(236,72,153,0.4)' : tab.color === 'cyan' ? 'rgba(34,211,238,0.4)' : 'rgba(59,130,246,0.4)',
                  } : {}}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-1 opacity-60">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ░▒▓ CATALOG SUB-TAB — Pre-made Quaternius models ▓▒░ */}
            {assetSubTab === 'catalog' && (
              <>
                {/* Category filter pills + generate thumbs button */}
                <div className="flex flex-wrap gap-1 mb-2 items-center">
                  {['all', ...Array.from(new Set(ASSET_CATALOG.map(a => a.category)))].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setAssetCategory(cat)}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                        assetCategory === cat
                          ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                          : 'text-gray-400 border border-gray-700/30 hover:text-gray-200 hover:border-gray-600/50'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                  <div className="ml-auto">
                    <RegenAllButton
                      onClick={() => catalogThumbGen.generate()}
                      running={catalogThumbGen.running}
                      done={catalogThumbGen.done}
                      total={catalogThumbGen.total}
                    />
                  </div>
                </div>

                {/* Catalog grid — unified AssetCard */}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCatalog}, minmax(0, 1fr))` }}>
                  {ASSET_CATALOG
                    .filter(a => assetCategory === 'all' || a.category === assetCategory)
                    .map(asset => (
                    <AssetCard
                      key={asset.id}
                      id={asset.id}
                      name={asset.name}
                      type="catalog"
                      thumbnailUrl={`/thumbs/${asset.id}.jpg`}
                      modelUrl={asset.path}
                      subtitle={asset.category}
                      onClick={() => {
                        if (scrollRef.current) savedScrollTop.current = scrollRef.current.scrollTop
                        setPreviewAsset(asset)
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {/* ░▒▓ CONJURED SUB-TAB — Text-to-3D creations ▓▒░ */}
            {assetSubTab === 'portals' && (() => {
              const targetWorlds = worldRegistry.filter(world =>
                world.id !== activeWorldId &&
                world.visibility !== 'core' &&
                world.visibility !== 'template'
              )
              const selectedTarget = portalTargetWorldId
                ? targetWorlds.find(world => world.id === portalTargetWorldId)
                : undefined
              const buildPortalAction = (): PortalAction | undefined => {
                if (portalActionPreset === 'load_world') {
                  return selectedTarget
                    ? { type: 'load_world', worldId: selectedTarget.id, worldName: selectedTarget.name }
                    : undefined
                }
                if (portalActionPreset === 'create_private') {
                  return { type: 'create_world', visibility: 'private', promptForName: true, name: 'New Private World' }
                }
                if (portalActionPreset === 'create_public') {
                  return { type: 'create_world', visibility: 'public', promptForName: true, name: 'New Public World' }
                }
                if (portalActionPreset === 'create_ffa') {
                  return { type: 'create_world', visibility: 'ffa', promptForName: true, name: 'New FFA World' }
                }
                if (portalActionPreset === 'external_url') {
                  const url = portalExternalUrl.trim()
                  return url
                    ? { type: 'external_url', url, label: 'External world', returnUrl: 'current', requiresConfirm: true }
                    : undefined
                }
                return { type: 'locked_message', message: portalLockedMessage.trim() || 'This portal is not open yet.' }
              }
              const portalAction = buildPortalAction()
              const canPlacePortal = Boolean(portalAction)
              const portalSubtitle = portalAction?.type === 'load_world'
                ? selectedTarget?.name || 'choose target'
                : portalAction?.type === 'create_world'
                  ? `create ${portalAction.visibility || 'private'}`
                  : portalAction?.type === 'external_url'
                    ? 'external URL'
                    : 'locked'
              return (
                <>
                  <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-2 mb-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-cyan-300 font-mono uppercase tracking-wider">Portal actions</div>
                        <div className="text-[9px] text-gray-500">Place world, creation, external, or locked gates.</div>
                      </div>
                      <select
                        value={portalActionPreset}
                        onChange={event => setPortalActionPreset(event.target.value as typeof portalActionPreset)}
                        className="min-w-0 max-w-[160px] rounded border border-cyan-500/25 bg-black/60 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none"
                      >
                        <option value="load_world">Existing world</option>
                        <option value="create_private">Create private</option>
                        <option value="create_public">Create public</option>
                        <option value="create_ffa">Create FFA</option>
                        <option value="external_url">External URL</option>
                        <option value="locked_message">Locked message</option>
                      </select>
                    </div>
                    {portalActionPreset === 'load_world' && (
                      <select
                        value={selectedTarget?.id || ''}
                        onChange={event => setPortalTargetWorldId(event.target.value)}
                        className="w-full rounded border border-cyan-500/25 bg-black/60 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none"
                      >
                        <option value="">{targetWorlds.length === 0 ? 'No target worlds' : 'Choose target world'}</option>
                        {targetWorlds.map(world => (
                          <option key={world.id} value={world.id}>{world.name}</option>
                        ))}
                      </select>
                    )}
                    {portalActionPreset === 'external_url' && (
                      <input
                        value={portalExternalUrl}
                        onChange={event => setPortalExternalUrl(event.target.value)}
                        className="w-full rounded border border-cyan-500/25 bg-black/60 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none"
                        placeholder="https://conjure.04515.xyz/?portal=true&from=oasis"
                      />
                    )}
                    {portalActionPreset === 'locked_message' && (
                      <input
                        value={portalLockedMessage}
                        onChange={event => setPortalLockedMessage(event.target.value)}
                        className="w-full rounded border border-cyan-500/25 bg-black/60 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none"
                        placeholder="Reach level 5 to enter."
                      />
                    )}
                  </div>
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCatalog}, minmax(0, 1fr))` }}>
                    {PORTAL_GATE_VARIANT_DEFS.map(style => (
                      <AssetCard
                        key={style.id}
                        id={style.id}
                        name={style.label}
                        type="portal"
                        thumbnailUrl={`${portalThumbPath(style.id)}?v=${portalThumbVersion}`}
                        accentColor={style.accent}
                        subtitle={portalSubtitle}
                        onClick={() => canPlacePortal && enterPlacementMode({
                          type: 'portal',
                          name: portalAction?.type === 'load_world'
                            ? `Portal to ${selectedTarget?.name || 'world'}`
                            : portalAction?.type === 'create_world'
                              ? `Portal to create ${portalAction.visibility || 'private'}`
                              : portalAction?.type === 'external_url'
                                ? 'Portal to external URL'
                                : 'Locked portal',
                          portalVariant: style.id as PortalGateVariant,
                          portalAction,
                          portalTargetWorldId: selectedTarget?.id,
                          portalTargetWorldName: selectedTarget?.name,
                          portalDirection: portalAction?.type === 'load_world' ? 'two-way' : 'one-way',
                        })}
                      />
                    ))}
                  </div>
                </>
              )
            })()}

            {assetSubTab === 'spatial' && (
              <>
                <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-2 mb-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-cyan-300 font-mono uppercase tracking-wider">Spatial web primitives</div>
                      <div className="text-[9px] text-gray-500">Place 3D form controls for voice-built sites, menus, and kiosks.</div>
                    </div>
                    <button
                      type="button"
                      onClick={seedSpatialWebRsvpDemo}
                      className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-cyan-100 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/15"
                    >
                      RSVP demo
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCatalog}, minmax(0, 1fr))` }}>
                  {SPATIAL_WEB_ASSET_TEMPLATES.map(template => (
                    <AssetCard
                      key={template.id}
                      id={template.id}
                      name={template.label}
                      type="spatial"
                      subtitle={template.subtitle}
                      accentColor={template.accentColor}
                      onClick={() => placeSpatialWebTemplate(template)}
                    />
                  ))}
                </div>
              </>
            )}

            {assetSubTab === 'conjured' && (
              <>
                {conjuredAssets.filter(a => a.status === 'ready').length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <div className="text-3xl mb-2">{'\u{1F52E}'}</div>
                    <div className="text-xs">No conjured assets yet</div>
                    <div className="text-[10px] mt-1 text-gray-500">Use the Conjure tab to create 3D models from text</div>
                  </div>
                ) : (
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsConjured}, minmax(0, 1fr))` }}>
                    {[...conjuredAssets].filter(a => a.status === 'ready').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(asset => (
                      <AssetCard
                        key={asset.id}
                        id={asset.id}
                        name={asset.displayName || asset.prompt.slice(0, 30)}
                        type="conjured"
                        thumbnailUrl={asset.thumbnailUrl || undefined}
                        modelUrl={asset.glbPath ? `${OASIS_BASE}${asset.glbPath}` : undefined}
                        isInWorld={worldConjuredAssetIds.includes(asset.id)}
                        accentColor="#F97316"
                        subtitle={`${asset.provider} / ${asset.tier}`}
                        onClick={() => {
                          savedScrollTop.current = scrollRef.current?.scrollTop ?? 0
                          setPreviewConjured(asset)
                        }}
                        onDelete={() => {
                          requestPermanentDelete({
                            itemName: asset.displayName || asset.prompt.slice(0, 30),
                            usageUrl: `${OASIS_BASE}/api/worlds/asset-usage?url=${encodeURIComponent(asset.id)}&currentWorldId=${encodeURIComponent(activeWorldId)}&type=conjured`,
                            onConfirm: () => deleteAsset(asset.id),
                          })
                        }}
                        badges={<>
                          {asset.action === 'rig' && (
                            <span className="px-1 py-px rounded text-[7px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">{'\u2699'} rigged</span>
                          )}
                          {asset.action === 'animate' && (
                            <span className="px-1 py-px rounded text-[7px] font-mono bg-green-500/20 text-green-400 border border-green-500/30">{'\uD83C\uDFC3'} anim</span>
                          )}
                          {asset.characterMode && !asset.action && (
                            <span className="px-1 py-px rounded text-[7px] font-mono bg-purple-500/15 text-purple-400/60">{'\uD83E\uDDCD'}</span>
                          )}
                        </>}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ░▒▓ CRAFTED SUB-TAB — Global scene library (not per-world) ▓▒░ */}
            {assetSubTab === 'crafted' && (
              <>
                {sceneLibrary.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <div className="text-3xl mb-2">{'\u{1F3A8}'}</div>
                    <div className="text-xs">No crafted scenes yet</div>
                    <div className="text-[10px] mt-1 text-gray-500">Use the Craft tab to build scenes from text</div>
                  </div>
                ) : (
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCrafted}, minmax(0, 1fr))` }}>
                    {[...sceneLibrary].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(scene => {
                      const isInWorld = craftedScenes.some(s => s.id === scene.id)
                      return (
                        <AssetCard
                          key={scene.id}
                          id={scene.id}
                          name={scene.name}
                          type="crafted"
                          thumbnailUrl={scene.thumbnailUrl || `/crafted-thumbs/${scene.id}.jpg`}
                          isInWorld={isInWorld}
                          accentColor="#3B82F6"
                          subtitle={`${scene.objects.length} primitives`}
                          onClick={() => {
                            savedScrollTop.current = scrollRef.current?.scrollTop ?? 0
                            setPreviewCrafted(scene)
                          }}
                          onDelete={() => {
                            requestPermanentDelete({
                              itemName: scene.name,
                              onConfirm: async () => { await deleteFromLibrary(scene.id) },
                            })
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {/* ░▒▓ IMAGES SUB-TAB — Generated images from Imagine ▓▒░ */}
            {assetSubTab === 'images' && (
              <>
                {generatedImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                    <div className="text-3xl mb-2">{'\u{1F3A8}'}</div>
                    <div className="text-xs">No generated images yet</div>
                    <div className="text-[10px] mt-1 text-gray-500">Use the Imagine tab to generate images</div>
                  </div>
                ) : (
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsMedia}, minmax(0, 1fr))` }}>
                      {[...generatedImages].reverse().map(img => {
                        const placedCount = placedCatalogAssets.filter(ca => ca.imageUrl === img.url).length
                        const isPlaced = placedCount > 0
                        return (
                          <AssetCard
                            key={img.id}
                          id={img.id}
                          name={img.prompt}
                          type="media-image"
                          thumbnailUrl={img.url}
                          mediaUrl={img.url}
                            isInWorld={isPlaced}
                            accentColor="#EC4899"
                            subtitle={new Date(img.createdAt).toLocaleDateString()}
                            onClick={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url })}
                            onDelete={() => {
                              requestPermanentDelete({
                                itemName: img.prompt.slice(0, 30) || 'generated image',
                                placedCount,
                                usageUrl: `${OASIS_BASE}/api/worlds/asset-usage?url=${encodeURIComponent(img.url)}&currentWorldId=${encodeURIComponent(activeWorldId)}&type=media`,
                                onConfirm: async () => { removeGeneratedImage(img.id) },
                              })
                            }}
                          onDownload={(_, url) => {
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${img.prompt.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'oasis-image'}.${url.split('.').pop() || 'png'}`
                            a.click()
                          }}
                          onUseAsTile={() => {
                            const presetId = `custom_${img.id}`
                            if (!customGroundPresets.some(p => p.id === presetId)) {
                              addCustomGroundPreset({
                                id: presetId,
                                name: img.prompt.slice(0, 20),
                                icon: '\u{1F3A8}',
                                color: '#888888',
                                assetName: '',
                                tileRepeat: 8,
                                customTextureUrl: img.tileUrl,
                              })
                            }
                            enterPaintMode(presetId)
                          }}
                          onViewFullscreen={() => setAssetsLightboxUrl(img.url)}
                          onPlaceWithFrame={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url, imageFrameStyle: 'gilded' })}
                        />
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
          )

        ) : mode === 'placed' ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
                ── Placed Objects ──
              </span>
              <span className="text-[10px] text-cyan-500/60 font-mono">
                {worldConjuredAssetIds.length + placedCatalogAssets.length + craftedScenes.length + portalGates.length + spatialWebObjects.length + worldLights.length + placedAgentWindows.length} total
              </span>
            </div>

            {worldConjuredAssetIds.length === 0 && placedCatalogAssets.length === 0 && craftedScenes.length === 0 && portalGates.length === 0 && spatialWebObjects.length === 0 && worldLights.length === 0 && placedAgentWindows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <div className="text-3xl mb-2">&#128203;</div>
                <div className="text-xs">No objects placed yet</div>
                <div className="text-[10px] mt-1 text-gray-500">Conjure, craft, or add from the Asset catalog</div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* ── CONJURED ── */}
                {worldConjuredAssetIds.length > 0 && (
                  <>
                    <div className="text-[9px] text-purple-400/60 uppercase tracking-wider font-mono mt-1 mb-0.5">✨ Conjured ({worldConjuredAssetIds.length})</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsConjured}, minmax(0, 1fr))` }}>
                      {worldConjuredAssetIds.map(id => {
                        const asset = conjuredAssets.find(a => a.id === id)
                        if (!asset || asset.status !== 'ready') return null
                        return (
                          <AssetCard
                            key={id}
                            id={id}
                            name={(asset.displayName || asset.prompt).slice(0, 30)}
                            type="placed"
                            thumbnailUrl={asset.thumbnailUrl || undefined}
                            subtitle={asset.provider}
                            accentColor={selectedObjectId === id ? '#3B82F6' : '#F97316'}
                            isInWorld
                            onClick={() => {
                              if (selectedObjectId === id) { selectObject(null); setInspectedObject(null) }
                              else {
                                selectObject(id); setInspectedObject(id)
                                const pos = transforms[id]?.position || asset?.position
                                if (pos) setCameraLookAt(pos)
                              }
                            }}
                            onDelete={() => removeConjuredAssetFromWorld(id)}
                          />
                        )
                      })}
                    </div>
                  </>
                )}

                {/* ── CATALOG ── */}
                {placedCatalogAssets.length > 0 && (
                  <>
                    <div className="text-[9px] text-cyan-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">📦 Catalog ({placedCatalogAssets.length})</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCatalog}, minmax(0, 1fr))` }}>
                      {placedCatalogAssets.map(ca => (
                        <AssetCard
                          key={ca.id}
                          id={ca.id}
                          name={ca.name}
                          type="placed"
                          thumbnailUrl={ca.imageUrl || (ca.catalogId ? `/thumbs/${ca.catalogId}.jpg` : undefined)}
                          subtitle={ca.imageUrl ? 'image' : 'catalog'}
                          accentColor={selectedObjectId === ca.id ? '#3B82F6' : '#06B6D4'}
                          isInWorld
                          onClick={() => {
                            if (selectedObjectId === ca.id) { selectObject(null); setInspectedObject(null) }
                            else {
                              selectObject(ca.id); setInspectedObject(ca.id)
                              const pos = transforms[ca.id]?.position || ca.position
                              if (pos) setCameraLookAt(pos)
                            }
                          }}
                          onDelete={() => removeCatalogAsset(ca.id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* ── CRAFTED ── */}
                {craftedScenes.length > 0 && (
                  <>
                    <div className="text-[9px] text-amber-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">⚒️ Crafted ({craftedScenes.length})</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCrafted}, minmax(0, 1fr))` }}>
                      {craftedScenes.map(scene => (
                        <AssetCard
                          key={scene.id}
                          id={scene.id}
                          name={scene.name}
                          type="placed"
                          thumbnailUrl={scene.thumbnailUrl || `/crafted-thumbs/${scene.id}.jpg`}
                          subtitle={`${scene.objects.length} prims`}
                          accentColor={selectedObjectId === scene.id ? '#3B82F6' : '#3B82F6'}
                          isInWorld
                          onClick={() => {
                            if (selectedObjectId === scene.id) { selectObject(null); setInspectedObject(null) }
                            else {
                              selectObject(scene.id); setInspectedObject(scene.id)
                              const pos = transforms[scene.id]?.position || scene.position
                              if (pos) setCameraLookAt(pos)
                            }
                          }}
                          onDelete={() => removeCraftedScene(scene.id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* ── LIGHTS — keep as list rows (no thumbnails for lights) ── */}
                {portalGates.length > 0 && (
                  <>
                    <div className="text-[9px] text-cyan-300/70 uppercase tracking-wider font-mono mt-2 mb-0.5">Portals ({portalGates.length})</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCatalog}, minmax(0, 1fr))` }}>
                      {portalGates.map(gate => (
                        <AssetCard
                          key={gate.id}
                          id={gate.id}
                          name={gate.targetWorldName ? `Portal to ${gate.targetWorldName}` : 'Portal gate'}
                          type="placed"
                          subtitle={gate.variant.replace(/-/g, ' ')}
                          accentColor={selectedObjectId === gate.id ? '#3B82F6' : '#22D3EE'}
                          isInWorld
                          onClick={() => {
                            if (selectedObjectId === gate.id) { selectObject(null); setInspectedObject(null) }
                            else {
                              selectObject(gate.id); setInspectedObject(gate.id)
                              const pos = transforms[gate.id]?.position || gate.position
                              if (pos) setCameraLookAt(pos)
                            }
                          }}
                          onDelete={() => removePortalGate(gate.id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {spatialWebObjects.length > 0 && (
                  <>
                    <div className="text-[9px] text-cyan-300/70 uppercase tracking-wider font-mono mt-2 mb-0.5">WWW Spatial Web ({spatialWebObjects.length})</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCatalog}, minmax(0, 1fr))` }}>
                      {spatialWebObjects.map(object => (
                        <AssetCard
                          key={object.id}
                          id={object.id}
                          name={object.label}
                          type="placed"
                          subtitle={object.type}
                          accentColor={selectedObjectId === object.id ? '#3B82F6' : (object.accentColor || '#22D3EE')}
                          isInWorld
                          onClick={() => {
                            if (selectedObjectId === object.id) { selectObject(null); setInspectedObject(null) }
                            else {
                              selectObject(object.id); setInspectedObject(object.id)
                              const pos = transforms[object.id]?.position || object.position
                              if (pos) setCameraLookAt(pos)
                            }
                          }}
                          onDelete={() => removeSpatialWebObject(object.id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* ── PAINT STROKES — wizardry tubes/lines drawn in 3-space ── */}
                {paintStrokes.length > 0 && (
                  <div className="text-[9px] text-fuchsia-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">🪄 Strokes ({paintStrokes.length})</div>
                )}
                {paintStrokes.map(stroke => {
                  const isSelected = selectedObjectId === stroke.id
                  const pointCount = Math.floor(stroke.points.length / 3)
                  const firstPos: [number, number, number] | null = pointCount > 0
                    ? [stroke.points[0], stroke.points[1], stroke.points[2]]
                    : null
                  return (
                    <div
                      key={stroke.id}
                      className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                        isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-fuchsia-500/30'
                      }`}
                      style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                      onClick={() => {
                        if (isSelected) { selectObject(null); setInspectedObject(null) }
                        else {
                          selectObject(stroke.id); setInspectedObject(stroke.id)
                          if (firstPos) setCameraLookAt(firstPos)
                        }
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">🪄</span>
                        <span className="text-[11px] text-gray-200">{stroke.mode === '3d' ? 'tube' : 'line'}</span>
                        <span className="text-[9px] text-gray-400">{pointCount} pts</span>
                        <div className="w-3 h-3 rounded-full border border-gray-700/30" style={{ backgroundColor: stroke.color }} />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); playPaintStroke(stroke.id, 4, Boolean(stroke.playbackLoop)) }}
                          className="text-[9px] text-fuchsia-300 hover:text-fuchsia-200 font-mono transition-colors"
                          title="Play back this stroke over 4s"
                        >
                          ▶
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updatePaintStroke(stroke.id, { playbackLoop: !stroke.playbackLoop }) }}
                          className={`rounded border px-1 text-[8px] font-mono uppercase transition-colors ${stroke.playbackLoop ? 'border-fuchsia-300/70 text-fuchsia-100' : 'border-white/10 text-gray-500 hover:text-fuchsia-200'}`}
                          title="Toggle looping playback"
                        >
                          Loop
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removePaintStroke(stroke.id) }}
                          className="text-gray-500 hover:text-red-400 text-xs"
                        >
                          &#10005;
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* ── 3D TEXT — extruded shiny words placed in 3-space ── */}
                {text3dObjects.length > 0 && (
                  <div className="text-[9px] text-amber-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">🔤 Text ({text3dObjects.length})</div>
                )}
                {text3dObjects.map(t3d => {
                  const isSelected = selectedObjectId === t3d.id
                  const pos = transforms[t3d.id]?.position || t3d.position
                  const preview = t3d.text.replace(/\s+/g, ' ').trim().slice(0, 28) || '(empty)'
                  return (
                    <div
                      key={t3d.id}
                      className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                        isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-amber-500/30'
                      }`}
                      style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                      onClick={() => {
                        if (isSelected) { selectObject(null); setInspectedObject(null) }
                        else {
                          selectObject(t3d.id); setInspectedObject(t3d.id)
                          if (pos) setCameraLookAt(pos)
                        }
                      }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm">🔤</span>
                        <span className="text-[11px] text-gray-200 truncate" title={t3d.text}>{preview}</span>
                        <div className="w-3 h-3 rounded-full border border-gray-700/30 shrink-0" style={{ backgroundColor: t3d.color }} />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeText3dObject(t3d.id) }}
                        className="text-gray-500 hover:text-red-400 text-xs shrink-0"
                      >
                        &#10005;
                      </button>
                    </div>
                  )
                })}

                {worldLights.length > 0 && (
                  <div className="text-[9px] text-yellow-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">💡 Lights ({worldLights.length})</div>
                )}
                {worldLights.map(light => {
                  const isSelected = selectedObjectId === light.id
                  const emoji = light.type === 'point' ? '💡' : light.type === 'spot' ? '🔦' : light.type === 'directional' ? '☀️' : light.type === 'hemisphere' ? '🌗' : light.type === 'ambient' ? '🌤️' : '🌐'
                  return (
                    <LightTooltipWrap key={light.id} type={light.type} className="relative">
                      <div
                        className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                          isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-cyan-500/30'
                        }`}
                        style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                        onClick={() => {
                          if (isSelected) { selectObject(null); setInspectedObject(null) }
                          else {
                            selectObject(light.id); setInspectedObject(light.id)
                            if (light.position) setCameraLookAt(light.position)
                          }
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{emoji}</span>
                          <span className="text-[11px] text-gray-200">{light.type}</span>
                          <span className="text-[9px] text-gray-400">int {light.intensity.toFixed(1)}</span>
                          <div className="w-3 h-3 rounded-full border border-gray-700/30" style={{ backgroundColor: light.color }} />
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeWorldLight(light.id) }}
                          className="text-gray-500 hover:text-red-400 text-xs"
                        >
                          &#10005;
                        </button>
                      </div>
                    </LightTooltipWrap>
                  )
                })}

                {/* ── AGENTS — keep as list rows (agent windows have no thumbnails) ── */}
                {placedAgentWindows.length > 0 && (
                  <div className="text-[9px] text-sky-400/60 uppercase tracking-wider font-mono mt-2 mb-0.5">💻 Agents ({placedAgentWindows.length})</div>
                )}
                {placedAgentWindows.map(win => {
                  const isSelected = selectedObjectId === win.id
                  const agentIcon = win.agentType === 'anorak' ? '💻' : win.agentType === 'anorak-pro' ? '🔮' : win.agentType === 'hermes' ? '☤' : win.agentType === 'openclaw' ? '🦞' : win.agentType === 'merlin' ? '🧙' : win.agentType === 'realtime' ? '🗣️' : win.agentType === 'npc' ? 'NPC' : win.agentType === 'parzival' ? '🧿' : '⚡'
                  const agentColor = win.agentType === 'anorak' ? 'text-sky-400' : win.agentType === 'anorak-pro' ? 'text-teal-400' : win.agentType === 'hermes' ? 'text-rose-400' : win.agentType === 'openclaw' ? 'text-cyan-300' : win.agentType === 'merlin' ? 'text-purple-400' : win.agentType === 'realtime' ? 'text-violet-300' : win.agentType === 'npc' ? 'text-orange-300' : win.agentType === 'parzival' ? 'text-violet-400' : 'text-green-400'
                  const agentIconResolved = win.agentType === 'browser' ? 'WWW' : win.agentType === 'codex' ? '⌘' : agentIcon
                  const agentColorResolved = win.agentType === 'browser' ? 'text-orange-400' : win.agentType === 'codex' ? 'text-emerald-400' : agentColor
                  const pos = transforms[win.id]?.position || win.position
                  return (
                    <div
                      key={win.id}
                      className={`rounded-lg border p-2 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                        isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-purple-500/30'
                      }`}
                      style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                      onClick={() => {
                        if (isSelected) { selectObject(null); setInspectedObject(null) }
                        else {
                          selectObject(win.id); setInspectedObject(win.id)
                          if (pos) setCameraLookAt(pos)
                        }
                      }}
                    >
                      <div>
                        <span className={`text-[10px] font-mono mr-1 ${agentColorResolved}`}>{agentIconResolved}</span>
                        <span className="text-[11px] text-gray-200">{win.label || win.agentType}</span>
                        <span className="text-[9px] text-gray-400 ml-1.5">agent</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); selectObject(win.id); focusAgentWindow(win.id) }}
                          className="text-[9px] text-purple-400 hover:text-purple-300 font-mono transition-colors"
                          title="Focus this window"
                        >
                          focus
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeAgentWindow(win.id) }}
                          className="text-gray-500 hover:text-red-400 text-xs"
                        >
                          &#10005;
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>

        ) : mode === 'agents' ? (
          <AgentsTabContent
            enterPlacementMode={enterPlacementMode}
            selectObject={selectObject}
            setInspectedObject={setInspectedObject}
            setCameraLookAt={setCameraLookAt}
            selectedObjectId={selectedObjectId}
            transforms={transforms}
          />

        /* The 'settings' branch was removed when the global Config menu
           absorbed it. See src/components/forge/config/ConfigMenu.tsx. */

        ) : mode === 'media' ? (
          <MediaTab
            cols={colsMedia}
            onRequestDelete={(target, onConfirm) => {
              requestPermanentDelete({
                itemName: target.name,
                placedCount: target.placedCount,
                usageUrl: `${OASIS_BASE}/api/worlds/asset-usage?url=${encodeURIComponent(target.url)}&currentWorldId=${encodeURIComponent(activeWorldId)}&type=media`,
                onConfirm,
              })
            }}
          />

        ) : mode === 'music' ? (
          <MusicBody />

        ) : mode === 'video' ? (
          <VideoBody />

        ) : mode === 'conjure' ? previewConjured ? (
          <ModelPreviewPanel
            asset={{
              id: previewConjured.id,
              name: previewConjured.displayName || previewConjured.prompt.slice(0, 40),
              path: previewConjured.glbPath ? `${OASIS_BASE}${previewConjured.glbPath}` : '',
              category: 'props',
              defaultScale: previewConjured.scale ?? 1,
            }}
            onBack={() => {
              setPreviewConjured(null)
              requestAnimationFrame(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current
              })
            }}
            onPlace={() => {
              enterPlacementMode({
                type: 'conjured',
                name: (previewConjured.displayName || previewConjured.prompt).slice(0, 24),
                path: previewConjured.glbPath ? `${OASIS_BASE}${previewConjured.glbPath}` : undefined,
                defaultScale: previewConjured.scale ?? 1,
              })
              setPreviewConjured(null)
            }}
            accentColor="#F97316"
            canvasHeight={400}
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
                ── Asset Library ({conjuredAssets.length}) ──
              </span>
            </div>

            {conjuredAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <div className="text-3xl mb-2">&#9878;</div>
                <div className="text-xs">No objects conjured yet</div>
                <div className="text-[10px] mt-1 text-gray-500">Type a spell above and cast it</div>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${colsConjured}, minmax(0, 1fr))` }}>
                {[...conjuredAssets]
                .filter(asset => {
                  // Hide parent assets when a ready child exists (lineage collapse)
                  // e.g. hide base model when rig is ready, hide rig when animate is ready
                  const hasReadyChild = conjuredAssets.some(
                    c => c.sourceAssetId === asset.id && c.status === 'ready'
                  )
                  return !hasReadyChild
                })
                .sort((a, b) => {
                  // In-progress on tippy top, newest first within each group
                  const aActive = !['ready', 'failed'].includes(a.status) ? 1 : 0
                  const bActive = !['ready', 'failed'].includes(b.status) ? 1 : 0
                  if (bActive !== aActive) return bActive - aActive
                  // Within same group: newest first by createdAt
                  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                }).map(asset => (
                  <GalleryItem
                    key={asset.id}
                    asset={asset}
                    onDelete={deleteAsset}
                    onRequestDelete={(id, name) => {
                      requestPermanentDelete({
                        itemName: name,
                        usageUrl: `${OASIS_BASE}/api/worlds/asset-usage?url=${encodeURIComponent(id)}&currentWorldId=${encodeURIComponent(activeWorldId)}&type=conjured`,
                        onConfirm: () => deleteAsset(id),
                      })
                    }}
                    onPreview={(previewAsset) => {
                      savedScrollTop.current = scrollRef.current?.scrollTop ?? 0
                      setPreviewConjured(previewAsset)
                    }}
                    isInWorld={worldConjuredAssetIds.includes(asset.id)}
                    onPlace={(id) => {
                      const a = conjuredAssets.find(c => c.id === id)
                      if (!a || !a.glbPath) return
                      enterPlacementMode({
                        type: 'conjured',
                        name: (a.displayName || a.prompt).slice(0, 24),
                        path: `${OASIS_BASE}${a.glbPath}`,
                        defaultScale: a.scale ?? 1,
                      })
                    }}
                    onTexture={(id) => processAsset(id, 'texture').catch((e: Error) => setError(e.message))}
                    onRemesh={(id, quality) => {
                      const preset = REMESH_PRESETS[quality]
                      processAsset(id, 'remesh', { targetPolycount: preset.polycount, topology: 'quad' }).catch((e: Error) => setError(e.message))
                    }}
                    onRig={(id) => processAsset(id, 'rig').catch((e: Error) => setError(e.message))}
                    onRename={renameAsset}
                    pricing={pricing}
                  />
                ))}
              </div>
            )}
          </>
        ) : previewCrafted ? (
          <CraftedPreviewPanel
            scene={previewCrafted}
            onBack={() => {
              setPreviewCrafted(null)
              requestAnimationFrame(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current
              })
            }}
            onPlace={(scene) => {
              if (sceneLibrary.some(entry => entry.id === scene.id)) {
                enterPlacementMode({ type: 'library', sceneId: scene.id, name: scene.name })
              } else {
                enterPlacementMode({ type: 'crafted', sceneId: scene.id, name: scene.name })
              }
              setPreviewCrafted(null)
            }}
            accentColor="#3B82F6"
            canvasHeight={400}
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
                ── Crafted Scenes ({craftedScenes.length}) ──
              </span>
            </div>

            {/* Craft conversation history */}
            {craftHistory.length > 0 && (
              <div className="mb-2 space-y-1 max-h-32 overflow-y-auto">
                {craftHistory.map((msg, i) => (
                  <div key={i} className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                    msg.role === 'user'
                      ? 'text-blue-300/70 bg-blue-500/5'
                      : 'text-green-300/70 bg-green-500/5'
                  }`}>
                    <span className="text-gray-400">{msg.role === 'user' ? 'you' : 'llm'}:</span> {msg.content}
                  </div>
                ))}
              </div>
            )}

            {craftedScenes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <div className="text-3xl mb-2">&#9881;</div>
                <div className="text-xs">No crafted scenes placed here yet</div>
                <div className="text-[10px] mt-1 text-gray-500">Craft a new scene above, or place one from the library below.</div>
              </div>
            ) : (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCrafted}, minmax(0, 1fr))` }}>
                {[...craftedScenes].slice().reverse().map(scene => (
                  <AssetCard
                    key={scene.id}
                    id={scene.id}
                    name={scene.name}
                    type="crafted"
                    thumbnailUrl={scene.thumbnailUrl || `/crafted-thumbs/${scene.id}.jpg`}
                    isInWorld
                    accentColor="#3B82F6"
                    subtitle={`${scene.objects.length} primitives`}
                    onClick={() => {
                      savedScrollTop.current = scrollRef.current?.scrollTop ?? 0
                      setPreviewCrafted(scene)
                    }}
                    onDelete={() => removeCraftedScene(scene.id)}
                  />
                ))}
              </div>
            )}

            {/* ─═̷─═̷─ SCENE LIBRARY — The permanent archive ─═̷─═̷─ */}
            {sceneLibrary.length > 0 && (
              <>
                <div className="flex items-center justify-between mt-4 mb-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
                    ── Library ({sceneLibrary.length}) ──
                  </span>
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${colsCrafted}, minmax(0, 1fr))` }}>
                  {[...sceneLibrary].slice().reverse().map(scene => {
                    const isInWorld = craftedScenes.some(s => s.id === scene.id)
                    return (
                      <AssetCard
                        key={scene.id}
                        id={scene.id}
                        name={scene.name}
                        type="crafted"
                        thumbnailUrl={scene.thumbnailUrl || `/crafted-thumbs/${scene.id}.jpg`}
                        isInWorld={isInWorld}
                        accentColor="#8B5CF6"
                        subtitle={`${scene.objects.length} primitives`}
                        onClick={() => {
                          savedScrollTop.current = scrollRef.current?.scrollTop ?? 0
                          setPreviewCrafted(scene)
                        }}
                        onDelete={() => {
                          requestPermanentDelete({
                            itemName: scene.name,
                            onConfirm: async () => { await deleteFromLibrary(scene.id) },
                          })
                        }}
                        badges={
                          <button
                            data-card-action="place"
                            onClick={(e) => {
                              e.stopPropagation()
                              enterPlacementMode({ type: 'library', sceneId: scene.id, name: scene.name })
                            }}
                            className="px-1 py-px rounded text-[7px] font-mono bg-emerald-500/15 text-emerald-300/80 border border-emerald-500/25 hover:text-emerald-200 transition-colors"
                            title="Place a copy"
                          >
                            + place
                          </button>
                        }
                      />
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ─═̷─═̷─ RESIZE HANDLE ─═̷─═̷─ */}
      <div
        className="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex-shrink-0"
        onMouseDown={handleResizeStart}
        style={{
          background: `linear-gradient(135deg, transparent 50%, ${forgeColor}44 50%)`,
        }}
      />

      <DeleteConfirmModal
        isOpen={!!deleteConfirm}
        itemName={deleteConfirm?.itemName || ''}
        placedCount={deleteConfirm?.placedCount}
        worldCount={deleteConfirm?.worldCount}
        loadingUsage={deleteConfirm?.loadingUsage}
        onConfirm={() => { if (deleteConfirm) void deleteConfirm.onConfirm() }}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Assets tab image lightbox — portaled */}
      {assetsLightboxUrl && (
        <MediaLightbox url={assetsLightboxUrl} onClose={() => setAssetsLightboxUrl(null)} />
      )}
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS TAB — 3D agent windows management + placement
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_TYPES = [
  { type: 'browser' as const, label: 'Browser', icon: 'WWW', color: '#f97316', desc: 'Live 3D browser surface with real typing and selection' },
  { type: 'openclaw' as const, label: 'OpenClaw', icon: '🦞', color: '#22d3ee', desc: 'Gateway-native peer — local first, MCP-ready, transport next' },
  { type: 'anorak' as const, label: 'Anorak', icon: '💻', color: '#38bdf8', desc: 'Claude Code agent — full multi-turn sessions' },
  { type: 'anorak-pro' as const, label: 'Anorak Pro', icon: '🔮', color: '#14b8a6', desc: 'Autonomous dev pipeline — curator, coder, reviewer, tester' },
  { type: 'hermes' as const, label: 'Hermes', icon: '☤', color: '#fb7185', desc: 'Embodied co-builder — remote tool agent inside the Oasis' },
  { type: 'merlin' as const, label: 'Merlin', icon: '🧙', color: '#a855f7', desc: 'World-builder agent — place objects, set sky' },
  { type: 'realtime' as const, label: 'Realtime', icon: '🗣️', color: '#c084fc', desc: 'Voice sandbox — WebRTC speech, transcript, lipsync' },
  { type: 'npc' as const, label: 'Fire Guardian', icon: 'NPC', color: '#fb923c', desc: 'Quest NPC - realtime voice, gated tools, progression hooks' },
  { type: 'devcraft' as const, label: 'DevCraft', icon: '⚡', color: '#22c55e', desc: 'Mission management + gamification' },
  { type: 'parzival' as const, label: 'Parzival', icon: '🧿', color: '#c084fc', desc: 'Autonomous brain — modes, missions, thought stream' },
] as const

const DEPLOYABLE_AGENT_TYPES = [
  ...AGENT_TYPES.slice(0, 3),
  { type: 'codex' as const, label: 'Codex', icon: '⌘', color: '#10b981', desc: 'OpenAI coding agent — local exec threads inside the Oasis' },
  ...AGENT_TYPES.slice(3),
] as const

function AgentsTabContent({ enterPlacementMode, selectObject, setInspectedObject, setCameraLookAt, selectedObjectId, transforms }: {
  enterPlacementMode: (pending: import('../../store/oasisStore').PlacementPending) => void
  selectObject: (id: string | null) => void
  setInspectedObject: (id: string | null) => void
  setCameraLookAt: (pos: [number, number, number]) => void
  selectedObjectId: string | null
  transforms: Record<string, { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }>
}) {
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const placedAgentAvatars = useOasisStore(s => s.placedAgentAvatars)
  const removeAgentWindow = useOasisStore(s => s.removeAgentWindow)
  const setAgentWindowAnchorMode = useOasisStore(s => s.setAgentWindowAnchorMode)
  const focusAgentWindow = useOasisStore(s => s.focusAgentWindow)
  const assignAvatarToAgentWindow = useOasisStore(s => s.assignAvatarToAgentWindow)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const [avatarPickerWindowId, setAvatarPickerWindowId] = useState<string | null>(null)

  const activeAvatar = avatarPickerWindowId
    ? placedAgentAvatars.find(entry => entry.linkedWindowId === avatarPickerWindowId) || null
    : null

  return (
    <>
      {/* ░▒▓ DEPLOY NEW AGENT ▓▒░ */}
      <div className="mb-3">
        <span className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
          ── Deploy Agent ──
        </span>
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          {DEPLOYABLE_AGENT_TYPES.map(agent => (
            <button
              key={agent.type}
              onClick={() => enterPlacementMode({
                type: 'agent',
                name: agent.label,
                agentType: agent.type,
                ...(agent.type === 'npc' ? { npcId: 'quest-zero-fire-guardian' } : {}),
              })}
              className="rounded-lg border border-gray-700/30 bg-black/40 hover:border-gray-600/50 p-2 text-left transition-all duration-200 group"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-lg group-hover:scale-110 transition-transform">{agent.icon}</span>
                <span className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.label}</span>
              </div>
              <div className="text-[8px] text-gray-500 mt-1 leading-tight">{agent.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ░▒▓ PLACED AGENTS ▓▒░ */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-gray-300 uppercase tracking-widest font-mono">
          ── Deployed ({placedAgentWindows.length}) ──
        </span>
      </div>

      {placedAgentWindows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
          <div className="text-3xl mb-2">💻</div>
          <div className="text-xs">No agents deployed</div>
          <div className="text-[10px] mt-1 text-gray-500">Click an agent above, then click the ground to place</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {placedAgentWindows.map(win => {
            const isSelected = selectedObjectId === win.id
            const isFocused = focusedAgentWindowId === win.id
            const agent = DEPLOYABLE_AGENT_TYPES.find(a => a.type === win.agentType) || DEPLOYABLE_AGENT_TYPES.find(a => a.type === 'anorak') || DEPLOYABLE_AGENT_TYPES[0]
            const rendererMeta = getAgentWindowRendererMeta(win.renderMode)
            const assignedAvatar = win.linkedAvatarId
              ? placedAgentAvatars.find(entry => entry.id === win.linkedAvatarId) || null
              : placedAgentAvatars.find(entry => entry.linkedWindowId === win.id) || null
            const avatarTransform = assignedAvatar ? (getLiveObjectTransform(assignedAvatar.id) || transforms[assignedAvatar.id]) : undefined
            const derivedPlacement = assignedAvatar && win.anchorMode && win.anchorMode !== 'detached'
              ? deriveAvatarAnchoredWindowPlacement(win, assignedAvatar, avatarTransform, win.anchorMode, transforms[win.id])
              : null
            const pos = derivedPlacement?.position || transforms[win.id]?.position || win.position
            return (
              <div
                key={win.id}
                className={`rounded-lg border p-2 cursor-pointer transition-all duration-200 ${
                  isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700/20 hover:border-purple-500/30'
                }`}
                style={{ background: isSelected ? undefined : 'rgba(15, 15, 15, 0.8)' }}
                onClick={() => {
                  if (isSelected) { selectObject(null); setInspectedObject(null) }
                  else {
                    selectObject(win.id); setInspectedObject(win.id)
                    if (pos) setCameraLookAt(pos)
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{agent.icon}</span>
                    <div>
                      <span className="text-[11px] font-bold" style={{ color: agent.color }}>{win.label || agent.label}</span>
                      {win.sessionId && <span className="text-[8px] text-gray-600 font-mono ml-1.5">{win.sessionId.slice(0, 8)}</span>}
                      <span className="text-[8px] text-gray-500 font-mono ml-1.5">{rendererMeta.shortLabel}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setAvatarPickerWindowId(win.id)
                      }}
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono border transition-colors hover:bg-cyan-500/10"
                      style={{
                        color: assignedAvatar ? '#22d3ee' : '#cbd5e1',
                        borderColor: assignedAvatar ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.12)',
                      }}
                      title="Assign a companion avatar to this agent window"
                    >
                      avatar
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        selectObject(win.id)
                        focusAgentWindow(isFocused ? null : win.id)
                      }}
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono border transition-colors hover:bg-purple-500/20"
                      style={{ color: agent.color, borderColor: `${agent.color}33` }}
                      title="Focus — fly camera to this window"
                    >
                      {isFocused ? 'unfollow' : 'follow'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeAgentWindow(win.id) }}
                      className="text-gray-500 hover:text-red-400 text-xs transition-colors"
                      title="Remove from world"
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
                {assignedAvatar && (
                  <div className="mt-1 flex items-center gap-1">
                    {(['detached', 'next-to', 'above'] as const).map(mode => {
                      const isActive = (win.anchorMode || 'detached') === mode
                      return (
                        <button
                          key={mode}
                          onClick={(e) => {
                            e.stopPropagation()
                            setAgentWindowAnchorMode(win.id, mode)
                          }}
                          className={`text-[8px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                            isActive
                              ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
                              : 'border-white/10 text-gray-500 hover:border-cyan-400/25 hover:text-cyan-100'
                          }`}
                          title={mode === 'detached' ? 'Window keeps its own world transform' : mode === 'next-to' ? 'Window rides beside the avatar' : 'Window rides above the avatar'}
                        >
                          {mode}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1 text-[8px] text-gray-500 font-mono">
                  <span>pos: [{pos.map(v => v.toFixed(1)).join(', ')}]</span>
                  <span>scale: {(() => { const s = transforms[win.id]?.scale; return typeof s === 'number' ? s.toFixed(2) : Array.isArray(s) ? s[0].toFixed(2) : win.scale.toFixed(2) })()}</span>
                  <span>render: {rendererMeta.shortLabel}</span>
                  {assignedAvatar && <span>anchor: {win.anchorMode || 'detached'}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {avatarPickerWindowId && (
        <AvatarGallery
          currentAvatarUrl={activeAvatar?.avatar3dUrl || null}
          onSelect={(avatarUrl) => {
            assignAvatarToAgentWindow(avatarPickerWindowId, avatarUrl)
            setAvatarPickerWindowId(null)
          }}
          onClose={() => setAvatarPickerWindowId(null)}
        />
      )}

    </>
  )
}

// ▓▓▓▓【W̸I̸Z̸A̸R̸D̸】▓▓▓▓ॐ▓▓▓▓【C̸O̸N̸S̸O̸L̸E̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓

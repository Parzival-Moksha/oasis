// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GENERATE PIC BODY — Text-to-image panel body, shared by:
//   • Wizard Console Media → Generate sub-tab (with optional building toggle)
//   • Text-to-Pic spelltab (toggle OFF by default)
//   • Text-to-Pic-Building spelltab (toggle ON by default)
// ─═̷─ Hits POST /api/imagine. When the building toggle is ON, the prompt is
// augmented with the Conjure-style "4-sided building" framing so the resulting
// image works well as a textured architectural panel. Generated images go into
// the shared oasisStore.generatedImages list so the existing placement, frame,
// and ground-tile pipelines all keep working. ─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOasisStore } from '../../../../store/oasisStore'
import { usePricing } from '../../../../hooks/usePricing'
import { awardXp } from '../../../../hooks/useXp'
import { deriveImageTitle } from '../../../../lib/conjure/derive-image-title'
import { buildImagePlacementPending } from '../../../../lib/forge/placement-builders'
import { CollapsibleSection, scrollIntoViewOnFocus } from '../SpellTabFrame'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

const IMAGINE_MODELS = [
  { key: 'nano-banana-2',   label: 'Nano Banana 2',   desc: 'Google — fast, default' },
  { key: 'nano-banana-pro', label: 'Nano Banana Pro', desc: 'Google — premium' },
  { key: 'gpt-image-2',     label: 'GPT Image 2',     desc: 'OpenAI — premium' },
  { key: 'seedream',        label: 'Seedream 4.5',    desc: 'ByteDance — high quality' },
  { key: 'riverflow',       label: 'Riverflow v2',    desc: 'Sourceful — fast diffusion' },
  { key: 'flux-klein',      label: 'FLUX Klein',      desc: 'Black Forest Labs — 4B param' },
] as const

// ─═̷─ Prompt scaffold disabled 2026-05-20. The wrapping copy was making
// nano-banana produce 2×2 collage layouts (4 mini-pics on one image) instead
// of a clean façade. The toggle now only affects how the placed image
// renders in-world (4-sided cube vs flat plane); the prompt is passed
// through raw so the image model just generates what the user asks for. ─═̷─
function applyBuildingFraming(rawPrompt: string): string {
  return rawPrompt.trim()
}

interface InFlightImage {
  id: string
  prompt: string
  model: string
  startedAt: number
  buildingMode: boolean
  error?: string
}

export interface GeneratePicBodyProps {
  /** When true: render a "4-sided building" toggle pre-set to ON and prepend conjure framing to the prompt. */
  defaultBuildingMode?: boolean
  /** When false, hide the building toggle entirely (used by wizcon Media tab if we ever want to). Default: visible. */
  showBuildingToggle?: boolean
  defaultExpandNew?: boolean
  defaultExpandGallery?: boolean
  /** Optional override for the accent color — defaults to pink. */
  accentColor?: string
}

export function GeneratePicBody({
  defaultBuildingMode = false,
  showBuildingToggle = true,
  defaultExpandNew = true,
  defaultExpandGallery = true,
  accentColor = '#EC4899',
}: GeneratePicBodyProps) {
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>('nano-banana-2')
  const [buildingMode, setBuildingMode] = useState(defaultBuildingMode)
  const [inFlight, setInFlight] = useState<InFlightImage[]>([])
  const [progressNow, setProgressNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [expandNew, setExpandNew] = useState(defaultExpandNew)
  const [expandGallery, setExpandGallery] = useState(defaultExpandGallery)

  const generatedImages = useOasisStore(s => s.generatedImages)
  const addGeneratedImage = useOasisStore(s => s.addGeneratedImage)
  const removeGeneratedImage = useOasisStore(s => s.removeGeneratedImage)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const addCustomGroundPreset = useOasisStore(s => s.addCustomGroundPreset)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const { pricing } = usePricing()
  const imagineCost = pricing['imagine'] ?? 0.05

  useEffect(() => {
    if (inFlight.length === 0) return
    const id = window.setInterval(() => setProgressNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [inFlight.length])

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim()
    if (!text) return
    const flightId = `flight_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const finalPrompt = buildingMode ? applyBuildingFraming(text) : text
    setInFlight(prev => [
      ...prev,
      { id: flightId, prompt: text, model: selectedModel, startedAt: Date.now(), buildingMode },
    ])
    setPrompt('')
    setError(null)
    try {
      const res = await fetch(`${OASIS_BASE}/api/imagine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, model: selectedModel }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Image generation failed' }))
        const msg = data.error || `Error ${res.status}`
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
        setError(msg)
        return
      }
      const data = await res.json()
      addGeneratedImage({
        id: data.id,
        prompt: data.prompt || finalPrompt,
        url: data.url,
        tileUrl: data.tileUrl,
        createdAt: data.createdAt,
        title: typeof data.title === 'string' ? data.title : deriveImageTitle(data.prompt || finalPrompt),
      })
      awardXp('GENERATE_IMAGE')
      setInFlight(prev => prev.filter(f => f.id !== flightId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Image generation failed'
      setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
      setError(msg)
    }
  }, [prompt, selectedModel, buildingMode, addGeneratedImage])

  const handleUseAsTile = useCallback((image: { id: string; prompt: string; tileUrl: string; url: string }) => {
    const presetId = `custom_${image.id}`
    if (!customGroundPresets.some(p => p.id === presetId)) {
      addCustomGroundPreset({
        id: presetId,
        name: image.prompt.slice(0, 20),
        icon: '\u{1F3A8}',
        color: '#888888',
        assetName: '',
        tileRepeat: 8,
        customTextureUrl: image.tileUrl || image.url,
      })
    }
    enterPaintMode(presetId)
  }, [customGroundPresets, addCustomGroundPreset, enterPaintMode])

  const sortedImages = [...generatedImages].reverse()

  return (
    <div className="space-y-2">
      <CollapsibleSection
        label="New Image"
        accentColor={accentColor}
        expanded={expandNew}
        onToggle={() => setExpandNew(e => !e)}
        rightSlot={`${IMAGINE_MODELS.find(m => m.key === selectedModel)?.label || selectedModel}${buildingMode ? ' · building' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="text-[10px] bg-black/60 rounded px-2 py-1 text-pink-200 font-mono focus:outline-none cursor-pointer"
            style={{ border: `1px solid ${accentColor}55` }}
          >
            {IMAGINE_MODELS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          {showBuildingToggle && (
            <label
              className="flex items-center gap-1 cursor-pointer rounded px-1.5 py-1"
              style={{ border: `1px solid ${buildingMode ? accentColor : 'rgba(120, 120, 120, 0.3)'}` }}
              title="Frame prompt as a flat 4-sided building façade (Conjure-style)"
            >
              <input
                type="checkbox"
                checked={buildingMode}
                onChange={e => setBuildingMode(e.target.checked)}
                className="w-3 h-3 rounded accent-amber-500"
              />
              <span className="text-[10px] font-mono" style={{ color: buildingMode ? accentColor : '#9CA3AF' }}>
                4-sided building
              </span>
            </label>
          )}
        </div>

        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onFocus={scrollIntoViewOnFocus}
          rows={3}
          placeholder={buildingMode
            ? "describe the building... e.g. 'a wooden Edo-period tea house, warm wood, paper screens'"
            : "describe the image..."}
          className="w-full text-xs bg-black/60 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none font-mono"
          style={{ border: `1px solid ${accentColor}55` }}
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-mono" style={{ color: `${accentColor}aa` }}>
            {imagineCost > 0 ? `${imagineCost} cr` : ''}
          </span>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(168, 85, 247, 0.3))',
              color: '#F9A8D4',
              border: `1px solid ${accentColor}55`,
            }}
          >
            {inFlight.length > 0 ? `Imagine (${inFlight.length})` : (buildingMode ? 'Conjure \u{1F3DB}️' : 'Imagine \u{1F3A8}')}
          </button>
        </div>

        {error && (
          <div className="text-[10px] text-red-400 font-mono">{error}</div>
        )}

        {inFlight.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {inFlight.map(f => {
              const progress = Math.max(4, Math.min(99, ((progressNow - f.startedAt) / 15000) * 100))
              const circumference = 2 * Math.PI * 17
              const dashOffset = circumference * (1 - progress / 100)
              return (
              <div key={f.id} className="rounded-md border border-pink-500/20 bg-black/40 p-2">
                {f.error ? (
                  <div className="flex flex-col items-center text-center">
                    <span className="text-red-400 text-base">{'✕'}</span>
                    <div className="text-[9px] text-red-400 font-mono">{f.error}</div>
                    <button
                      onClick={() => setInFlight(prev => prev.filter(x => x.id !== f.id))}
                      className="mt-1 text-[9px] text-gray-400 hover:text-gray-200 font-mono"
                    >dismiss</button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-2 flex h-12 w-12 items-center justify-center">
                      <svg className="absolute inset-0 h-12 w-12 -rotate-90 animate-spin" viewBox="0 0 44 44" aria-hidden="true">
                        <circle cx="22" cy="22" r="17" fill="none" stroke="rgba(236,72,153,0.16)" strokeWidth="4" />
                        <circle
                          cx="22"
                          cy="22"
                          r="17"
                          fill="none"
                          stroke={accentColor}
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={circumference}
                          strokeDashoffset={dashOffset}
                        />
                      </svg>
                      <span className="text-[10px] font-black text-pink-100">{Math.round(progress)}%</span>
                    </div>
                    <span className="text-[10px] text-pink-100 font-mono">Image generating</span>
                    <span className="text-[8px] text-pink-300/80 font-mono">hang on tight</span>
                    <span className="text-[9px] text-pink-300 font-mono line-clamp-2">{f.prompt}</span>
                    {f.buildingMode && (
                      <span className="text-[8px] text-amber-400/70 font-mono mt-0.5">building</span>
                    )}
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label={`Gallery (${generatedImages.length})`}
        accentColor={accentColor}
        expanded={expandGallery}
        onToggle={() => setExpandGallery(e => !e)}
      >
        {generatedImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-gray-400">
            <div className="text-2xl mb-1">{'\u{1F3A8}'}</div>
            <div className="text-xs">No images generated yet</div>
            <div className="text-[10px] mt-1 text-gray-500">Type a prompt and hit Imagine</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {sortedImages.map(img => {
              const placedCount = placedCatalogAssets.filter(ca => ca.imageUrl === img.url).length
              const isPlaced = placedCount > 0
              const placementName = img.title || img.prompt.slice(0, 24)
              return (
                <div
                  key={img.id}
                  className="group relative rounded-md overflow-hidden border bg-black/40"
                  style={{ borderColor: isPlaced ? `${accentColor}80` : 'rgba(120, 120, 120, 0.3)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.title || img.prompt}
                    title={img.prompt}
                    className="w-full aspect-square object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-stretch justify-center gap-1 p-2">
                    <button
                      onClick={() => {
                        enterPlacementMode(buildImagePlacementPending({ name: placementName, imageUrl: img.url }))
                        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
                      }}
                      className="text-[10px] py-1 rounded font-mono"
                      style={{ background: `${accentColor}33`, color: '#fff', border: `1px solid ${accentColor}55` }}
                    >
                      Place
                    </button>
                    <button
                      onClick={() => {
                        enterPlacementMode(buildImagePlacementPending({ name: placementName, imageUrl: img.url, frameStyle: 'building' }))
                        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
                      }}
                      className="text-[10px] py-1 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-mono"
                      title="Place as a 4-sided textured building"
                    >
                      3D
                    </button>
                    <button
                      onClick={() => {
                        handleUseAsTile(img)
                        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('oasis:close-spelltabs'))
                      }}
                      className="text-[10px] py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 font-mono"
                    >
                      Use as tile
                    </button>
                    <button
                      onClick={() => removeGeneratedImage(img.id)}
                      className="text-[10px] py-1 rounded bg-red-500/10 text-red-300 border border-red-500/20 font-mono"
                    >
                      Delete
                    </button>
                  </div>
                  {img.title && (
                    <div className="absolute left-0 right-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/85 to-transparent pointer-events-none">
                      <div className="text-[9px] text-gray-200 font-mono line-clamp-1">{img.title}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}

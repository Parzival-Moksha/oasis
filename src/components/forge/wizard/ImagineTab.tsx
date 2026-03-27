// ═══════════════════════════════════════════════════════════════════════════════
// IMAGINE TAB — Text-to-image via Gemini, ground textures, gallery
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useCallback, useRef } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import { usePricing } from '../../../hooks/usePricing'
import { awardXp } from '../../../hooks/useXp'
import { OASIS_BASE } from './shared'

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

export function ImagineTab() {
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>('gemini-flash')
  const [inFlight, setInFlight] = useState<InFlightImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const generatedImages = useOasisStore(s => s.generatedImages)
  const addGeneratedImage = useOasisStore(s => s.addGeneratedImage)
  const removeGeneratedImage = useOasisStore(s => s.removeGeneratedImage)
  const addCustomGroundPreset = useOasisStore(s => s.addCustomGroundPreset)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const { pricing } = usePricing()
  const imagineCost = pricing['imagine'] ?? 0.05
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${OASIS_BASE}/api/media/upload`, { method: 'POST', body: formData })
        if (!res.ok) continue
        const { url, name } = await res.json()
        addGeneratedImage({
          id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          prompt: name || file.name,
          url,
          tileUrl: url,
          createdAt: new Date().toISOString(),
        })
      } catch (e) { console.error('[Upload]', e) }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [addGeneratedImage])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    const flightId = `flight_${Date.now()}`
    const capturedPrompt = prompt.trim()
    const capturedModel = selectedModel
    setInFlight(prev => [...prev, { id: flightId, prompt: capturedPrompt, model: capturedModel, startedAt: Date.now() }])
    setPrompt('')
    setError(null)
    try {
      const res = await fetch(`${OASIS_BASE}/api/imagine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: capturedPrompt, model: capturedModel }),
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
  }, [prompt, selectedModel, addGeneratedImage])

  const handleUseAsTile = useCallback((image: { id: string; prompt: string; tileUrl: string; url: string }) => {
    const presetId = `custom_${image.id}`
    // Check if already registered
    if (!customGroundPresets.some(p => p.id === presetId)) {
      addCustomGroundPreset({
        id: presetId,
        name: image.prompt.slice(0, 20),
        icon: '🎨',
        color: '#888888',
        assetName: '',
        tileRepeat: 1,
        customTextureUrl: image.tileUrl,
      })
    }
    enterPaintMode(presetId)
  }, [customGroundPresets, addCustomGroundPreset, enterPaintMode])

  return (
    <>
      <div className="space-y-3">
        {/* Prompt input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] text-pink-400/60 uppercase tracking-widest font-mono">
              Text to Image
            </div>
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
          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGenerate() }}
              placeholder="Describe what you see..."
              className="flex-1 bg-black/60 border border-pink-500/20 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500/50 font-mono"
            />
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(168, 85, 247, 0.3))',
                color: '#F9A8D4',
                border: '1px solid rgba(236, 72, 153, 0.3)',
              }}
            >
              {inFlight.length > 0 ? `Imagine (${inFlight.length})` : 'Imagine'}
              {imagineCost > 0 && (
                <span className="ml-1 opacity-60 text-[9px]">{imagineCost}cr</span>
              )}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 rounded-lg text-xs font-bold transition-all"
              style={{
                background: 'rgba(14, 165, 233, 0.15)',
                color: '#7dd3fc',
                border: '1px solid rgba(14, 165, 233, 0.3)',
              }}
              title="Upload images from disk"
            >
              {uploading ? '...' : '+'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={e => handleUpload(e.target.files)}
              className="hidden"
            />
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
            <div className="grid grid-cols-2 gap-2 mb-2">
              {inFlight.map(f => (
                <div key={f.id} className="relative rounded-lg overflow-hidden border border-pink-500/20 bg-black/40">
                  <div className="w-full aspect-square flex flex-col items-center justify-center p-2">
                    {f.error ? (
                      <>
                        <div className="text-red-400 text-lg mb-1">✕</div>
                        <div className="text-[9px] text-red-400 font-mono text-center">{f.error}</div>
                        <button
                          onClick={() => setInFlight(prev => prev.filter(x => x.id !== f.id))}
                          className="mt-1 text-[9px] text-gray-400 hover:text-gray-200 font-mono"
                        >dismiss</button>
                      </>
                    ) : (
                      <>
                        <div className="text-2xl mb-2 animate-pulse">🎨</div>
                        <div className="text-[9px] text-pink-300 font-mono text-center line-clamp-2">{f.prompt}</div>
                        <div className="text-[8px] text-gray-500 font-mono mt-1">
                          {IMAGINE_MODELS.find(m => m.key === f.model)?.label || f.model}
                        </div>
                        {/* Animated progress bar — CSS animation from 0% to 90% over 30s */}
                        <div className="w-full mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full" style={{ width: '90%', animation: 'imagine-progress 30s ease-out forwards' }} />
                          <style>{`@keyframes imagine-progress { from { width: 0% } to { width: 90% } }`}</style>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gallery */}
        {generatedImages.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-widest font-mono mb-1.5">
              Gallery ({generatedImages.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[...generatedImages].reverse().map(img => (
                <div key={img.id} className="group relative rounded-lg overflow-hidden border border-gray-700/30 bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.prompt}
                    className="w-full aspect-square object-cover"
                    loading="lazy"
                  />
                  {/* Hover actions overlay */}
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2">
                    <div className="text-[9px] text-gray-300 font-mono text-center line-clamp-2 mb-1">{img.prompt}</div>
                    <div className="flex gap-1 w-full">
                      <button
                        onClick={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url })}
                        className="flex-1 text-[10px] px-2 py-1 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30 hover:bg-pink-500/30 transition-colors font-mono"
                      >
                        Place
                      </button>
                      <button
                        onClick={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url, imageFrameStyle: 'gilded' })}
                        className="text-[10px] px-2 py-1 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 hover:bg-yellow-500/30 transition-colors font-mono"
                        title="Place with golden frame"
                      >
                        🖼️
                      </button>
                    </div>
                    <button
                      onClick={() => handleUseAsTile(img)}
                      className="w-full text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors font-mono"
                    >
                      Use as tile
                    </button>
                    <button
                      onClick={() => removeGeneratedImage(img.id)}
                      className="w-full text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400/60 border border-red-500/20 hover:bg-red-500/20 hover:text-red-300 transition-colors font-mono"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {generatedImages.length === 0 && inFlight.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <div className="text-3xl mb-2">🎨</div>
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
              Available in World tab → Ground palette
            </div>
          </div>
        )}
      </div>
    </>
  )
}

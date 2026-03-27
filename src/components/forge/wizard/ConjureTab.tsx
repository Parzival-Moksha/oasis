// ═══════════════════════════════════════════════════════════════════════════════
// CONJURE TAB — Text-to-3D + Image-to-3D sections and asset gallery
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useRef, useCallback } from 'react'
import { useConjure } from '../../../hooks/useConjure'
import { useOasisStore } from '../../../store/oasisStore'
import { PROVIDERS, REMESH_PRESETS, type ProviderName } from '../../../lib/conjure/types'
import { usePricing, getConjurePriceKey } from '../../../hooks/usePricing'
import { OASIS_BASE, GalleryItem } from './shared'

const FORGE_COLOR = '#F97316'

interface ConjureTabProps {
  setError: (error: string | null) => void
}

export function ConjureTabHeader({ setError }: ConjureTabProps) {
  const forgeColor = FORGE_COLOR
  // ─═̷─ Wizard state ─═̷─
  const [provider, setProvider] = useState<ProviderName>('meshy')
  const [tier, setTier] = useState(PROVIDERS[0].tiers[1]?.id || PROVIDERS[0].tiers[0].id)
  const [conjurePrompt, setConjurePrompt] = useState('')
  const [isCastingText, setIsCastingText] = useState(false)
  const [isCastingImage, setIsCastingImage] = useState(false)
  const [characterMode, setCharacterMode] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const imageFileRef = useRef<HTMLInputElement>(null)

  // ░▒▓ Collapsible conjure sections — Text-to-3D vs Image-to-3D ▓▒░
  type ConjureSection = 'text' | 'image'
  const [conjureExpanded, setConjureExpanded] = useState<ConjureSection>('text')

  // ░▒▓ Image-to-3D section has its own provider/tier/char state ▓▒░
  const [imgProvider, setImgProvider] = useState<ProviderName>('tripo')
  const [imgTier, setImgTier] = useState(PROVIDERS.find(p => p.name === 'tripo')?.tiers[3]?.id || 'premium')
  const [imgCharacterMode, setImgCharacterMode] = useState(false)
  const [imgPrompt, setImgPrompt] = useState('')

  // ░▒▓ Auto-pipeline — chain rig after conjure completes ▓▒░
  const [autoRig, setAutoRig] = useState(false)
  const [imgAutoRig, setImgAutoRig] = useState(false)

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
  const { startConjure } = useConjure()

  // Update tier when provider changes
  const selectedProvider = PROVIDERS.find(p => p.name === provider) || PROVIDERS[0]
  const selectedTier = selectedProvider.tiers.find(t => t.id === tier) || selectedProvider.tiers[0]

  const handleProviderChange = useCallback((newProvider: ProviderName) => {
    setProvider(newProvider)
    const p = PROVIDERS.find(pp => pp.name === newProvider)
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
  const conjurePrice = useCallback((prov: string, t: string) => {
    return p(getConjurePriceKey(prov, t))
  }, [p])

  // ═══════════════════════════════════════════════════════════════════════
  // CAST THE SPELL — Text-to-3D
  // ═══════════════════════════════════════════════════════════════════════
  const handleCast = useCallback(async () => {
    if (!conjurePrompt.trim() || isCastingText) return
    setError(null)
    setIsCastingText(true)

    try {
      const options: Record<string, unknown> = {}
      if (characterMode) {
        options.characterMode = true
        options.characterOptions = { poseMode: 'a-pose' as const, topology: 'quad' as const, symmetry: true }
      }
      if (characterMode && autoRig) {
        options.autoRig = true
      }

      await startConjure(conjurePrompt.trim(), provider, tier, Object.keys(options).length > 0 ? options as never : undefined)
      setConjurePrompt('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Conjuration failed')
    } finally {
      setIsCastingText(false)
    }
  }, [conjurePrompt, isCastingText, provider, tier, startConjure, characterMode, autoRig, setError])

  // ═══════════════════════════════════════════════════════════════════════
  // CAST THE SPELL — Image-to-3D
  // ═══════════════════════════════════════════════════════════════════════
  const handleImageCast = useCallback(async () => {
    if (!imageUrl.trim() || isCastingImage) return
    setError(null)
    setIsCastingImage(true)

    try {
      const options: Record<string, unknown> = {
        imageUrl: imageUrl.trim(),
      }
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
      setIsCastingImage(false)
    }
  }, [imageUrl, isCastingImage, imgProvider, imgTier, imgPrompt, imgCharacterMode, imgAutoRig, startConjure, setError])

  // Enter key handlers
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCast()
    }
  }, [handleCast])

  const handleImageKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleImageCast()
    }
  }, [handleImageCast])

  return (
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
              <textarea value={conjurePrompt} onChange={(e) => setConjurePrompt(e.target.value)} onKeyDown={handleKeyDown}
                disabled={isCastingText} rows={2}
                placeholder="a crystal dragon perched on a floating rock..."
                className="flex-1 text-xs bg-black/60 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
              <button onClick={handleCast} disabled={!conjurePrompt.trim() || isCastingText}
                className="px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed self-end"
                style={{ background: `${forgeColor}33`, color: forgeColor, border: `1px solid ${forgeColor}55` }}
                title={`Costs ${conjurePrice(provider, tier)}${autoRig ? ` + ${p('post_rig', 0.75)} rig` : ''} credits`}>
                {isCastingText ? '...' : characterMode ? (autoRig ? '\uD83E\uDDCD\u2192\u2699' : 'Cast \uD83E\uDDCD') : 'Cast \u2728'}
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
              <button onClick={handleImageCast} disabled={!imageUrl.trim() || isCastingImage}
                className="px-3 py-2 rounded-lg text-sm font-bold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed self-end"
                style={{ background: '#EC489933', color: '#EC4899', border: '1px solid #EC489955' }}
                title={`Costs ${conjurePrice(imgProvider, imgTier)}${imgAutoRig ? ` + ${p('post_rig', 0.75)} rig` : ''} credits`}>
                {isCastingImage ? '...' : imgCharacterMode ? (imgAutoRig ? '\uD83D\uDCF7\u2192\u2699' : 'Cast \uD83D\uDCF7\uD83E\uDDCD') : 'Cast \uD83D\uDCF7'}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

export function ConjureTabContent({ setError }: { setError: (error: string | null) => void }) {
  const { conjuredAssets, processAsset, deleteAsset } = useConjure()
  const updateConjuredAsset = useOasisStore(s => s.updateConjuredAsset)
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const removeConjuredAssetFromWorld = useOasisStore(s => s.removeConjuredAssetFromWorld)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const { pricing } = usePricing()

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

  return (
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
        <div className="grid grid-cols-2 gap-2">
          {[...conjuredAssets]
          .filter(asset => {
            const hasReadyChild = conjuredAssets.some(
              c => c.sourceAssetId === asset.id && c.status === 'ready'
            )
            return !hasReadyChild
          })
          .sort((a, b) => {
            const aActive = !['ready', 'failed'].includes(a.status) ? 1 : 0
            const bActive = !['ready', 'failed'].includes(b.status) ? 1 : 0
            if (bActive !== aActive) return bActive - aActive
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          }).map(asset => (
            <GalleryItem
              key={asset.id}
              asset={asset}
              onDelete={deleteAsset}
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
              onRemove={removeConjuredAssetFromWorld}
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
  )
}

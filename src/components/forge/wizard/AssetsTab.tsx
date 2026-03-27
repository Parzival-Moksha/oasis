// ═══════════════════════════════════════════════════════════════════════════════
// ASSETS TAB — Catalog, conjured, crafted, images sub-tabs + 3D preview
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useRef, useCallback } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import { useConjure } from '../../../hooks/useConjure'
import type { ConjuredAsset, CraftedScene } from '../../../lib/conjure/types'
import type { AssetDefinition } from '../../scene-lib/types'
import { ASSET_CATALOG } from '../../scene-lib/constants'
import { ModelPreviewPanel, CraftedPreviewPanel } from '../ModelPreview'
import { useCraftedThumbnailGenerator, useCatalogThumbnailGenerator } from '../../../hooks/useThumbnailGenerator'
import { OASIS_BASE, AssetThumb } from './shared'

export function AssetsTab() {
  const { conjuredAssets } = useConjure()

  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const generatedImages = useOasisStore(s => s.generatedImages)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const updateConjuredAsset = useOasisStore(s => s.updateConjuredAsset)

  const [assetCategory, setAssetCategory] = useState<string>('all')
  const [assetSubTab, setAssetSubTab] = useState<'catalog' | 'conjured' | 'crafted' | 'images'>('catalog')
  const [previewAsset, setPreviewAsset] = useState<AssetDefinition | null>(null)
  const [previewConjured, setPreviewConjured] = useState<ConjuredAsset | null>(null)
  const [previewCrafted, setPreviewCrafted] = useState<CraftedScene | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScrollTop = useRef(0)

  // ░▒▓ Catch orphan crafted scenes without thumbnails on mount ▓▒░
  useCraftedThumbnailGenerator()

  // ░▒▓ Catalog thumbnail generator — manual trigger for 100+ GLB renders ▓▒░
  const catalogThumbGen = useCatalogThumbnailGenerator()

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

  if (previewAsset) {
    return (
      <div>
        <ModelPreviewPanel
          asset={previewAsset}
          onBack={() => {
            setPreviewAsset(null)
            requestAnimationFrame(() => {
              const scrollParent = scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null
              if (scrollParent) scrollParent.scrollTop = savedScrollTop.current
            })
          }}
          onPlace={(a) => {
            enterPlacementMode({ type: 'catalog', catalogId: a.id, name: a.name, path: a.path, defaultScale: a.defaultScale })
            setPreviewAsset(null)
          }}
          accentColor="#EAB308"
          canvasHeight={400}
        />
      </div>
    )
  }

  if (previewConjured) {
    return (
      <div>
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
              const scrollParent = scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null
              if (scrollParent) scrollParent.scrollTop = savedScrollTop.current
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
      </div>
    )
  }

  if (previewCrafted) {
    return (
      <div>
        <CraftedPreviewPanel
          scene={previewCrafted}
          onBack={() => {
            setPreviewCrafted(null)
            requestAnimationFrame(() => {
              const scrollParent = scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null
              if (scrollParent) scrollParent.scrollTop = savedScrollTop.current
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
      </div>
    )
  }

  return (
    <div ref={scrollRef}>
      {/* ═══════════════════════════════════════════════════════════════════
          SUB-TAB BAR — Catalog / Conjured / Crafted
          ─═̷─═̷─ Three galleries under one roof ─═̷─═̷─
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-1 mb-2">
        {([
          { key: 'catalog' as const, label: 'Catalog', count: ASSET_CATALOG.length, color: 'yellow' },
          { key: 'conjured' as const, label: 'Conjured', count: conjuredAssets.filter(a => a.status === 'ready').length, color: 'orange' },
          { key: 'crafted' as const, label: 'Crafted', count: sceneLibrary.length, color: 'blue' },
          { key: 'images' as const, label: 'Images', count: generatedImages.length, color: 'pink' },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setAssetSubTab(tab.key)}
            className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
              assetSubTab === tab.key
                ? 'border'
                : 'text-gray-400 border border-gray-700/30 hover:text-gray-200 hover:border-gray-600/50'
            }`}
            style={assetSubTab === tab.key ? {
              background: tab.color === 'yellow' ? 'rgba(234,179,8,0.15)' : tab.color === 'orange' ? 'rgba(249,115,22,0.15)' : tab.color === 'pink' ? 'rgba(236,72,153,0.15)' : 'rgba(59,130,246,0.15)',
              color: tab.color === 'yellow' ? '#FDE047' : tab.color === 'orange' ? '#FB923C' : tab.color === 'pink' ? '#F9A8D4' : '#93C5FD',
              borderColor: tab.color === 'yellow' ? 'rgba(234,179,8,0.4)' : tab.color === 'orange' ? 'rgba(249,115,22,0.4)' : tab.color === 'pink' ? 'rgba(236,72,153,0.4)' : 'rgba(59,130,246,0.4)',
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
            <button
              onClick={() => catalogThumbGen.generate()}
              disabled={catalogThumbGen.running}
              className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-mono text-yellow-500/50 border border-yellow-500/20 hover:text-yellow-400 hover:border-yellow-500/40 disabled:opacity-30 transition-colors"
              title="Render thumbnails for all catalog assets (takes ~1 min)"
            >
              {catalogThumbGen.running
                ? `${catalogThumbGen.done}/${catalogThumbGen.total}`
                : '\u{1F4F7}'}
            </button>
          </div>

          {/* Catalog grid — thumbnails with emoji fallback */}
          <div className="grid grid-cols-3 gap-1.5">
            {ASSET_CATALOG
              .filter(a => assetCategory === 'all' || a.category === assetCategory)
              .map(asset => (
              <button
                key={asset.id}
                onClick={() => {
                  const scrollParent = scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null
                  if (scrollParent) savedScrollTop.current = scrollParent.scrollTop
                  setPreviewAsset(asset)
                }}
                className="rounded-lg border p-1.5 transition-all duration-200 text-left hover:border-yellow-500/40 hover:bg-yellow-500/5 group"
                style={{
                  background: 'rgba(15, 15, 15, 0.8)',
                  borderColor: 'rgba(255, 255, 255, 0.06)',
                }}
                title={`${asset.name} (${asset.category}) — click to preview`}
              >
                <div className="w-full aspect-square rounded bg-black/40 flex items-center justify-center mb-1 overflow-hidden">
                  <AssetThumb
                    src={`${OASIS_BASE}/thumbs/${asset.id}.jpg`}
                    fallback={asset.category === 'enemies' ? '\u{1F916}' : asset.category === 'guns' ? '\u{1F52B}' : asset.category === 'pickups' ? '\u{1F48E}' : asset.category === 'character' ? '\u{1F9D1}' : asset.category === 'nature' ? '\u{1F332}' : asset.category === 'props' ? '\u{1F4E6}' : asset.category === 'scifi' ? '\u{1F680}' : asset.category === 'fantasy' ? '\u{1F9D9}' : asset.category === 'village' ? '\u{1F3E0}' : asset.category === 'avatar' ? '\u{1F9D1}' : '\u{1F3D7}'}
                    alt={asset.name}
                  />
                </div>
                <div className="text-[9px] text-gray-400 group-hover:text-gray-200 truncate transition-colors">
                  {asset.name}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ░▒▓ CONJURED SUB-TAB — Text-to-3D creations ▓▒░ */}
      {assetSubTab === 'conjured' && (
        <>
          {conjuredAssets.filter(a => a.status === 'ready').length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <div className="text-3xl mb-2">{'\u{1F52E}'}</div>
              <div className="text-xs">No conjured assets yet</div>
              <div className="text-[10px] mt-1 text-gray-500">Use the Conjure tab to create 3D models from text</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {[...conjuredAssets].filter(a => a.status === 'ready').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(asset => (
                <button
                  key={asset.id}
                  onClick={() => {
                    const scrollParent = scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null
                    savedScrollTop.current = scrollParent?.scrollTop ?? 0
                    setPreviewConjured(asset)
                  }}
                  className={`rounded-lg border p-1.5 transition-all duration-200 text-left group ${
                    worldConjuredAssetIds.includes(asset.id)
                      ? 'border-orange-500/30 bg-orange-500/5'
                      : 'hover:border-orange-500/40 hover:bg-orange-500/5'
                  }`}
                  style={{
                    background: worldConjuredAssetIds.includes(asset.id) ? undefined : 'rgba(15, 15, 15, 0.8)',
                    borderColor: worldConjuredAssetIds.includes(asset.id) ? undefined : 'rgba(255, 255, 255, 0.06)',
                  }}
                  title={`${asset.displayName || asset.prompt} — click to preview`}
                >
                  <div className="w-full aspect-square rounded bg-black/40 flex items-center justify-center mb-1 overflow-hidden">
                    <AssetThumb
                      src={asset.thumbnailUrl
                        ? (asset.thumbnailUrl.startsWith('http') ? asset.thumbnailUrl : `${OASIS_BASE}${asset.thumbnailUrl}`)
                        : ''}
                      fallback={'\u{1F52E}'}
                      alt={asset.displayName || asset.prompt}
                    />
                  </div>
                  <div
                    className="text-[9px] text-gray-400 group-hover:text-gray-200 truncate transition-colors cursor-text"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      const name = window.prompt('Rename asset:', asset.displayName || asset.prompt)
                      if (name && name.trim()) renameAsset(asset.id, name.trim())
                    }}
                    title="Double-click to rename"
                  >
                    {asset.displayName || asset.prompt.slice(0, 30)}
                  </div>
                  <div className="text-[8px] text-gray-400 truncate flex items-center gap-1 flex-wrap">
                    <span>{asset.provider} / {asset.tier}</span>
                    {asset.action === 'rig' && (
                      <span className="px-1 py-px rounded text-[7px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">{'\u2699'} rigged</span>
                    )}
                    {asset.action === 'animate' && (
                      <span className="px-1 py-px rounded text-[7px] font-mono bg-green-500/20 text-green-400 border border-green-500/30">{'\uD83C\uDFC3'} anim</span>
                    )}
                    {asset.characterMode && !asset.action && (
                      <span className="px-1 py-px rounded text-[7px] font-mono bg-purple-500/15 text-purple-400/60">{'\uD83E\uDDCD'}</span>
                    )}
                    {worldConjuredAssetIds.includes(asset.id) && (
                      <span className="text-orange-400/60">placed</span>
                    )}
                  </div>
                </button>
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
            <div className="grid grid-cols-2 gap-1.5">
              {[...sceneLibrary].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(scene => {
                const isInWorld = craftedScenes.some(s => s.id === scene.id)
                return (
                  <button
                    key={scene.id}
                    onClick={() => {
                      const scrollParent = scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null
                      savedScrollTop.current = scrollParent?.scrollTop ?? 0
                      setPreviewCrafted(scene)
                    }}
                    className={`rounded-lg border p-1.5 transition-all duration-200 text-left group ${
                      isInWorld
                        ? 'border-blue-500/30 bg-blue-500/5'
                        : 'hover:border-blue-500/40 hover:bg-blue-500/5'
                    }`}
                    style={{
                      background: isInWorld ? undefined : 'rgba(15, 15, 15, 0.8)',
                      borderColor: isInWorld ? undefined : 'rgba(255, 255, 255, 0.06)',
                    }}
                    title={`${scene.name} — click to preview`}
                  >
                    <div className="w-full aspect-square rounded bg-black/40 flex items-center justify-center mb-1 overflow-hidden">
                      <AssetThumb
                        src={scene.thumbnailUrl
                          ? (scene.thumbnailUrl.startsWith('http') ? scene.thumbnailUrl : `${OASIS_BASE}${scene.thumbnailUrl}`)
                          : `${OASIS_BASE}/crafted-thumbs/${scene.id}.jpg`}
                        fallback={'\u{1F3A8}'}
                        alt={scene.name}
                      />
                    </div>
                    <div className="text-[9px] text-gray-400 group-hover:text-gray-200 truncate transition-colors">
                      {scene.name}
                    </div>
                    <div className="text-[8px] text-gray-400 truncate">
                      {scene.objects.length} primitives
                      {isInWorld && (
                        <span className="ml-1 text-blue-400/60">placed</span>
                      )}
                    </div>
                  </button>
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
              <div className="text-3xl mb-2">🎨</div>
              <div className="text-xs">No generated images yet</div>
              <div className="text-[10px] mt-1 text-gray-500">Use the Imagine tab to generate images</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {[...generatedImages].reverse().map(img => {
                const isPlaced = placedCatalogAssets.some(ca => ca.imageUrl === img.url)
                return (
                  <div
                    key={img.id}
                    className={`rounded-lg border p-1.5 transition-all duration-200 text-left group cursor-pointer ${
                      isPlaced ? 'border-pink-500/30 bg-pink-500/5' : 'hover:border-pink-500/40 hover:bg-pink-500/5'
                    }`}
                    style={{
                      background: isPlaced ? undefined : 'rgba(15, 15, 15, 0.8)',
                      borderColor: isPlaced ? undefined : 'rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div className="w-full aspect-square rounded bg-black/40 flex items-center justify-center mb-1 overflow-hidden relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" loading="lazy" />
                      {/* Hover actions */}
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-2">
                        <button
                          onClick={() => enterPlacementMode({ type: 'image', name: img.prompt.slice(0, 24), imageUrl: img.url })}
                          className="w-full text-[10px] px-2 py-1 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30 hover:bg-pink-500/30 transition-colors font-mono"
                        >
                          Place in world
                        </button>
                      </div>
                    </div>
                    <div className="text-[9px] text-gray-400 group-hover:text-gray-200 truncate transition-colors">
                      {img.prompt}
                    </div>
                    <div className="text-[8px] text-gray-400 truncate">
                      {new Date(img.createdAt).toLocaleDateString()}
                      {isPlaced && <span className="ml-1 text-pink-400/60">placed</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

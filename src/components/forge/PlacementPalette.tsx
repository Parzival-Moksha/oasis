'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useConjure } from '@/hooks/useConjure'
import { useCatalogThumbnailGenerator, useCraftedThumbnailGenerator, usePortalThumbnailGenerator } from '@/hooks/useThumbnailGenerator'
import type { ConjuredAsset, CraftedScene } from '@/lib/conjure/types'
import { createSpatialWebObjectFromTemplate, SPATIAL_WEB_ASSET_TEMPLATES } from '@/lib/spatial-web-presets'
import { PORTAL_GATE_VARIANT_DEFS, type PortalAction, type PortalGateVariant } from '@/lib/portal-gates'
import { portalThumbPath } from '@/lib/portal-thumbnails'
import { useOasisStore } from '@/store/oasisStore'
import { ASSET_CATALOG } from '@/components/scene-lib/constants'
import type { AssetDefinition } from '@/components/scene-lib/types'

import { AssetCard } from './AssetCard'
import { CraftedPreviewPanel, ModelPreviewPanel } from './ModelPreview'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

type PaletteTab = 'catalog' | 'portal' | 'spatial' | 'conjured' | 'crafted' | 'media'

interface MediaItem {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
  size: number
  createdAt: string
}

interface PlacementPaletteProps {
  showConjured?: boolean
  columns?: number
  onPlace?: () => void
}

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

export function PlacementPalette({ showConjured = true, columns = 3, onPlace }: PlacementPaletteProps) {
  const [tab, setTab] = useState<PaletteTab>('catalog')
  const [category, setCategory] = useState('all')
  const [portalActionPreset, setPortalActionPreset] = useState<'load_world' | 'create_private' | 'create_public' | 'create_ffa' | 'external_url' | 'locked_message'>('load_world')
  const [portalTargetWorldId, setPortalTargetWorldId] = useState('')
  const [portalExternalUrl, setPortalExternalUrl] = useState('https://conjure.04515.xyz/?portal=true&from=oasis')
  const [portalLockedMessage, setPortalLockedMessage] = useState('This portal is not open yet.')
  const [previewAsset, setPreviewAsset] = useState<AssetDefinition | null>(null)
  const [previewConjured, setPreviewConjured] = useState<ConjuredAsset | null>(null)
  const [previewCrafted, setPreviewCrafted] = useState<CraftedScene | null>(null)
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaKind, setMediaKind] = useState<'image' | 'video' | 'audio'>('image')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { conjuredAssets } = useConjure()
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const seedSpatialWebRsvpDemo = useOasisStore(s => s.seedSpatialWebRsvpDemo)
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const behaviors = useOasisStore(s => s.behaviors)

  useCraftedThumbnailGenerator()
  const catalogThumbGen = useCatalogThumbnailGenerator()
  const portalThumbVersion = usePortalThumbnailGenerator()

  const readyConjured = useMemo(
    () => conjuredAssets.filter(asset => asset.status === 'ready'),
    [conjuredAssets],
  )
  const availableTabs = useMemo(() => ([
    { key: 'catalog' as const, label: 'Catalog', count: ASSET_CATALOG.length, color: '#FDE047' },
    { key: 'portal' as const, label: 'Portal', count: PORTAL_GATE_VARIANT_DEFS.length, color: '#67E8F9' },
    { key: 'spatial' as const, label: 'Spatial', count: SPATIAL_WEB_ASSET_TEMPLATES.length, color: '#A5F3FC' },
    ...(showConjured ? [{ key: 'conjured' as const, label: 'Conjured', count: readyConjured.length, color: '#FB923C' }] : []),
    { key: 'crafted' as const, label: 'Crafted', count: sceneLibrary.length, color: '#93C5FD' },
    { key: 'media' as const, label: 'Media', count: mediaItems.length, color: '#F9A8D4' },
  ]), [mediaItems.length, readyConjured.length, sceneLibrary.length, showConjured])

  useEffect(() => {
    if (!showConjured && tab === 'conjured') setTab('catalog')
  }, [showConjured, tab])

  const finishPlacement = useCallback(() => {
    onPlace?.()
  }, [onPlace])

  const fetchMedia = useCallback(async () => {
    setMediaLoading(true)
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/list`, { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json() as { items?: MediaItem[] }
        setMediaItems(json.items || [])
      }
    } catch {
      setMediaItems([])
    } finally {
      setMediaLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'media') void fetchMedia()
  }, [fetchMedia, tab])

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      await fetch(`${OASIS_BASE}/api/media/upload`, { method: 'POST', body: formData })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    await fetchMedia()
  }, [fetchMedia])

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
      return url ? { type: 'external_url', url, label: 'External world', returnUrl: 'current', requiresConfirm: true } : undefined
    }
    return { type: 'locked_message', message: portalLockedMessage.trim() || 'This portal is not open yet.' }
  }

  if (previewAsset) {
    return (
      <ModelPreviewPanel
        asset={previewAsset}
        onBack={() => setPreviewAsset(null)}
        onPlace={(asset) => {
          enterPlacementMode({ type: 'catalog', catalogId: asset.id, name: asset.name, path: asset.path, defaultScale: asset.defaultScale })
          setPreviewAsset(null)
          finishPlacement()
        }}
        accentColor="#EAB308"
        canvasHeight={360}
      />
    )
  }

  if (previewConjured) {
    return (
      <ModelPreviewPanel
        asset={{
          id: previewConjured.id,
          name: previewConjured.displayName || previewConjured.prompt.slice(0, 40),
          path: previewConjured.glbPath ? `${OASIS_BASE}${previewConjured.glbPath}` : '',
          category: 'props',
          defaultScale: previewConjured.scale ?? 1,
        }}
        onBack={() => setPreviewConjured(null)}
        onPlace={() => {
          enterPlacementMode({
            type: 'conjured',
            name: (previewConjured.displayName || previewConjured.prompt).slice(0, 24),
            path: previewConjured.glbPath ? `${OASIS_BASE}${previewConjured.glbPath}` : undefined,
            defaultScale: previewConjured.scale ?? 1,
          })
          setPreviewConjured(null)
          finishPlacement()
        }}
        accentColor="#F97316"
        canvasHeight={360}
      />
    )
  }

  if (previewCrafted) {
    return (
      <CraftedPreviewPanel
        scene={previewCrafted}
        onBack={() => setPreviewCrafted(null)}
        onPlace={(scene) => {
          enterPlacementMode({ type: 'crafted', sceneId: scene.id, name: scene.name })
          setPreviewCrafted(null)
          finishPlacement()
        }}
        accentColor="#3B82F6"
        canvasHeight={360}
      />
    )
  }

  const portalAction = buildPortalAction()
  const portalSubtitle = portalAction?.type === 'load_world'
    ? selectedTarget?.name || 'choose target'
    : portalAction?.type === 'create_world'
      ? `create ${portalAction.visibility || 'private'}`
      : portalAction?.type === 'external_url'
        ? 'external URL'
        : 'locked'
  const mediaFiltered = mediaItems.filter(item => item.type === mediaKind)
  const countPlacedMedia = (url: string) => {
    let count = placedCatalogAssets.filter(item =>
      item.imageUrl === url || item.videoUrl === url || item.audioUrl === url
    ).length
    for (const behavior of Object.values(behaviors)) {
      if (behavior?.audioUrl === url) count++
    }
    return count
  }

  return (
    <div className="space-y-3 max-[700px]:space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5 max-[700px]:gap-1">
        {availableTabs.map(item => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className="rounded-md border px-2 py-2 text-left font-mono transition max-[700px]:px-1.5 max-[700px]:py-1.5"
              style={{
                borderColor: active ? `${item.color}99` : 'rgba(255,255,255,0.12)',
                background: active ? `${item.color}1f` : 'rgba(255,255,255,0.045)',
                color: active ? '#fff' : 'rgba(255,255,255,0.62)',
              }}
            >
              <span className="block text-[10px] font-black uppercase tracking-[0.12em] max-[700px]:text-[8px] max-[700px]:tracking-[0.08em]">{item.label}</span>
              <span className="mt-0.5 block text-[9px] text-white/36 max-[700px]:hidden">{item.count} ready</span>
            </button>
          )
        })}
      </div>

      {tab === 'catalog' && (
        <>
          <div className="flex flex-wrap items-center gap-1 max-[700px]:max-h-16 max-[700px]:overflow-y-auto">
            {['all', ...Array.from(new Set(ASSET_CATALOG.map(asset => asset.category)))].map(item => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className="rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.08em] transition max-[700px]:px-1.5 max-[700px]:py-0.5 max-[700px]:text-[8px]"
                style={{
                  borderColor: category === item ? 'rgba(250,204,21,0.48)' : 'rgba(255,255,255,0.10)',
                  background: category === item ? 'rgba(250,204,21,0.14)' : 'rgba(255,255,255,0.04)',
                  color: category === item ? '#FDE047' : 'rgba(255,255,255,0.54)',
                }}
              >
                {item}
              </button>
            ))}
            {catalogThumbGen.running && catalogThumbGen.total > 0 && (
              <span className="ml-auto rounded border border-yellow-300/20 px-2 py-1 text-[9px] font-mono text-yellow-100/60">
                thumbs {catalogThumbGen.done}/{catalogThumbGen.total}
              </span>
            )}
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {ASSET_CATALOG
              .filter(asset => category === 'all' || asset.category === category)
              .map(asset => (
                <AssetCard
                  key={asset.id}
                  id={asset.id}
                  name={asset.name}
                  type="catalog"
                  thumbnailUrl={`/thumbs/${asset.id}.jpg`}
                  modelUrl={asset.path}
                  subtitle={asset.category}
                  compact
                  onClick={() => setPreviewAsset(asset)}
                />
              ))}
          </div>
        </>
      )}

      {tab === 'portal' && (
        <>
          <div className="space-y-2 rounded-md border border-cyan-300/15 bg-cyan-300/5 p-2 max-[700px]:space-y-1 max-[700px]:p-1.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100 max-[700px]:text-[8px]">Portal actions</div>
                <div className="text-[9px] text-white/36 max-[700px]:hidden">World gates, creation gates, external gates.</div>
              </div>
              <select
                value={portalActionPreset}
                onChange={event => setPortalActionPreset(event.target.value as typeof portalActionPreset)}
                className="max-w-[160px] rounded border border-cyan-300/25 bg-black/70 px-2 py-1 text-[10px] text-cyan-100 outline-none"
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
                className="w-full rounded border border-cyan-300/25 bg-black/70 px-2 py-1 text-[10px] text-cyan-100 outline-none"
              >
                <option value="">{targetWorlds.length === 0 ? 'No target worlds' : 'Choose target world'}</option>
                {targetWorlds.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}
              </select>
            )}
            {portalActionPreset === 'external_url' && (
              <input
                value={portalExternalUrl}
                onChange={event => setPortalExternalUrl(event.target.value)}
                className="w-full rounded border border-cyan-300/25 bg-black/70 px-2 py-1 text-[10px] text-cyan-100 outline-none"
              />
            )}
            {portalActionPreset === 'locked_message' && (
              <input
                value={portalLockedMessage}
                onChange={event => setPortalLockedMessage(event.target.value)}
                className="w-full rounded border border-cyan-300/25 bg-black/70 px-2 py-1 text-[10px] text-cyan-100 outline-none"
              />
            )}
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {PORTAL_GATE_VARIANT_DEFS.map(style => (
              <AssetCard
                key={style.id}
                id={style.id}
                name={style.label}
                type="portal"
                thumbnailUrl={`${portalThumbPath(style.id)}?v=${portalThumbVersion}`}
                accentColor={style.accent}
                subtitle={portalSubtitle}
                compact
                onClick={() => {
                  if (!portalAction) return
                  enterPlacementMode({
                    type: 'portal',
                    name: portalAction.type === 'load_world'
                      ? `Portal to ${selectedTarget?.name || 'world'}`
                      : portalAction.type === 'create_world'
                        ? `Portal to create ${portalAction.visibility || 'private'}`
                        : portalAction.type === 'external_url'
                          ? 'Portal to external URL'
                          : 'Locked portal',
                    portalVariant: style.id as PortalGateVariant,
                    portalAction,
                    portalTargetWorldId: selectedTarget?.id,
                    portalTargetWorldName: selectedTarget?.name,
                    portalDirection: portalAction.type === 'load_world' ? 'two-way' : 'one-way',
                  })
                  finishPlacement()
                }}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'spatial' && (
        <>
          <div className="flex items-center gap-2 rounded-md border border-cyan-300/15 bg-cyan-300/5 p-2 max-[700px]:p-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100 max-[700px]:text-[8px]">A2UI-ish spatial controls</div>
              <div className="text-[9px] text-white/36 max-[700px]:hidden">Buttons, sliders, fields, selectors, output panels.</div>
            </div>
            <button
              type="button"
              onClick={() => { seedSpatialWebRsvpDemo(); finishPlacement() }}
              className="rounded border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100"
            >
              RSVP demo
            </button>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {SPATIAL_WEB_ASSET_TEMPLATES.map(template => (
              <AssetCard
                key={template.id}
                id={template.id}
                name={template.label}
                type="spatial"
                subtitle={template.subtitle}
                accentColor={template.accentColor}
                compact
                onClick={() => {
                  enterPlacementMode({
                    type: 'spatialWeb',
                    name: template.label,
                    spatialWebObject: createSpatialWebObjectFromTemplate(template),
                  })
                  finishPlacement()
                }}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'conjured' && showConjured && (
        readyConjured.length === 0 ? (
          <div className="py-10 text-center text-xs text-white/40">No conjured assets yet.</div>
        ) : (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {[...readyConjured].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(asset => (
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
                compact
                onClick={() => setPreviewConjured(asset)}
              />
            ))}
          </div>
        )
      )}

      {tab === 'crafted' && (
        sceneLibrary.length === 0 ? (
          <div className="py-10 text-center text-xs text-white/40">No crafted scenes yet.</div>
        ) : (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {[...sceneLibrary].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(scene => (
              <AssetCard
                key={scene.id}
                id={scene.id}
                name={scene.name}
                type="crafted"
                thumbnailUrl={scene.thumbnailUrl || `/crafted-thumbs/${scene.id}.jpg`}
                isInWorld={craftedScenes.some(item => item.id === scene.id)}
                accentColor="#3B82F6"
                subtitle={`${scene.objects.length} primitives`}
                compact
                onClick={() => setPreviewCrafted(scene)}
              />
            ))}
          </div>
        )
      )}

      {tab === 'media' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            {(['image', 'video', 'audio'] as const).map(kind => (
              <button
                key={kind}
                onClick={() => setMediaKind(kind)}
                className="rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em]"
                style={{
                  borderColor: mediaKind === kind ? 'rgba(249,168,212,0.56)' : 'rgba(255,255,255,0.10)',
                  background: mediaKind === kind ? 'rgba(236,72,153,0.16)' : 'rgba(255,255,255,0.04)',
                  color: mediaKind === kind ? '#F9A8D4' : 'rgba(255,255,255,0.54)',
                }}
              >
                {kind}
              </button>
            ))}
            <label className="ml-auto cursor-pointer rounded border border-sky-300/25 bg-sky-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-sky-100">
              Upload
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={event => { void handleUpload(event.target.files) }}
              />
            </label>
          </div>
          {mediaLoading ? (
            <div className="py-10 text-center text-xs text-white/40">Loading media...</div>
          ) : mediaFiltered.length === 0 ? (
            <div className="py-10 text-center text-xs text-white/40">No {mediaKind} files yet.</div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {mediaFiltered.map(item => {
                const placedCount = countPlacedMedia(item.url)
                const type = item.type === 'image'
                  ? 'media-image'
                  : item.type === 'video'
                    ? 'media-video'
                    : 'media-audio'
                return (
                  <AssetCard
                    key={item.url}
                    id={item.url}
                    name={item.name}
                    type={type}
                    thumbnailUrl={item.type === 'image' ? item.url : undefined}
                    mediaUrl={item.url}
                    isInWorld={placedCount > 0}
                    subtitle={formatSize(item.size)}
                    accentColor="#EC4899"
                    compact
                    badges={placedCount > 0 ? <span className="text-[8px] text-pink-200/70">{placedCount} placed</span> : undefined}
                    onClick={() => {
                      if (item.type === 'image') {
                        enterPlacementMode({ type: 'image', name: item.name, imageUrl: item.url })
                      } else if (item.type === 'video') {
                        enterPlacementMode({ type: 'video', name: item.name, videoUrl: item.url })
                      } else {
                        enterPlacementMode({
                          type: 'catalog',
                          catalogId: 'kf_speaker',
                          name: item.name.replace(/\.[^.]+$/, '') || 'Loudspeaker',
                          path: '/models/kenney-furniture/speaker.glb',
                          defaultScale: 2,
                          audioUrl: item.url,
                        })
                      }
                      finishPlacement()
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

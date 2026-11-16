'use client'

// ░▒▓ CRAFTED GALLERY — every crafted scene as a thumbnail, not a list of names ▓▒░
// The Text to 3D tab and the wizard's Craft tab show this: the scenes in this world and the library, newest
// first, as a grid of thumbnails with a column count (− / +, remembered). A scene without a thumbnail gets one
// rendered once and cached (useCraftedThumbnailGenerator, /crafted-thumbs); one whose saved thumbnail file is gone
// (made on another machine, or cleaned out) is rendered again (repairMissingThumbnails). Click a tile to place it (a copy,
// click-to-place); the ⓘ on a tile opens the preview: rotating, with triangles, size and data size. × removes a
// scene from this world, or deletes a library-only one.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { useOasisStore } from '../../store/oasisStore'
import type { CraftedScene } from '../../lib/conjure/types'
import { generateSingleCraftedThumbnail, useCraftedThumbnailGenerator } from '../../hooks/useThumbnailGenerator'
import { AssetCard } from './AssetCard'
import { CraftedPreviewPanel } from './ModelPreview'

const COLUMNS_KEY = 'oasis.craftedGallery.columns'
const MIN_COLUMNS = 2
const MAX_COLUMNS = 6
const columnListeners = new Set<() => void>()

function readColumns(fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(COLUMNS_KEY))
    return value >= MIN_COLUMNS && value <= MAX_COLUMNS ? value : fallback
  } catch {
    return fallback
  }
}

function writeColumns(value: number) {
  try { window.localStorage.setItem(COLUMNS_KEY, String(value)) } catch { /* private mode */ }
  columnListeners.forEach(listener => listener())
}

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ─── thumbnails a library entry points at but that are gone ─────────────────
// The generator only renders scenes without a thumbnailUrl. A url whose file is missing (404) is checked once
// a session and rendered again; the tile then loads it with a ?v= so the browser doesn't keep the miss.
const checkedThumbs = new Set<string>()
const thumbVersions = new Map<string, number>()
const thumbListeners = new Set<() => void>()
let thumbTick = 0
let repairing = false
const REPAIRS_PER_SESSION = 200

export async function repairMissingThumbnails(scenes: readonly CraftedScene[]): Promise<number> {
  if (repairing || typeof window === 'undefined') return 0
  repairing = true
  let repaired = 0
  try {
    for (const scene of scenes) {
      if (!scene.thumbnailUrl || checkedThumbs.has(scene.id) || checkedThumbs.size >= REPAIRS_PER_SESSION) continue
      checkedThumbs.add(scene.id)
      const url = scene.thumbnailUrl.startsWith('/') ? `${OASIS_BASE}${scene.thumbnailUrl}` : scene.thumbnailUrl
      const there = await fetch(url, { method: 'HEAD', cache: 'no-store' }).then(res => res.ok).catch(() => true)
      if (there) continue
      await generateSingleCraftedThumbnail(scene)
      thumbVersions.set(scene.id, Date.now())
      thumbTick += 1
      repaired += 1
      thumbListeners.forEach(listener => listener())
    }
  } finally {
    repairing = false
  }
  return repaired
}

/** In this world first, then the library; newest first; each scene once. */
export function galleryScenes(inWorld: readonly CraftedScene[], library: readonly CraftedScene[]): Array<{ scene: CraftedScene; inWorld: boolean }> {
  const seen = new Set<string>()
  const out: Array<{ scene: CraftedScene; inWorld: boolean }> = []
  const newest = (a: CraftedScene, b: CraftedScene) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  for (const scene of [...inWorld].sort(newest)) {
    if (seen.has(scene.id) || !scene.objects?.length) continue
    seen.add(scene.id)
    out.push({ scene, inWorld: true })
  }
  for (const scene of [...library].sort(newest)) {
    if (seen.has(scene.id) || !scene.objects?.length) continue
    seen.add(scene.id)
    out.push({ scene, inWorld: false })
  }
  return out
}

export function CraftedGallery({ defaultColumns = 3, accentColor = '#3B82F6', previewHeight = 320 }: { defaultColumns?: number; accentColor?: string; previewHeight?: number }) {
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const sceneLibrary = useOasisStore(s => s.sceneLibrary)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const deleteFromLibrary = useOasisStore(s => s.deleteFromLibrary)
  const [preview, setPreview] = useState<CraftedScene | null>(null)
  const columns = useSyncExternalStore(
    listener => { columnListeners.add(listener); return () => { columnListeners.delete(listener) } },
    () => readColumns(defaultColumns),
    () => defaultColumns,
  )

  useCraftedThumbnailGenerator()
  useSyncExternalStore(
    listener => { thumbListeners.add(listener); return () => { thumbListeners.delete(listener) } },
    () => thumbTick,
    () => 0,
  )

  const items = useMemo(() => galleryScenes(craftedScenes, sceneLibrary), [craftedScenes, sceneLibrary])
  useEffect(() => { void repairMissingThumbnails(items.map(item => item.scene)) }, [items])
  const place = (scene: CraftedScene) => enterPlacementMode({ type: 'crafted', sceneId: scene.id, name: scene.name })

  if (preview) {
    return (
      <div className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-black/40" data-crafted-preview>
        <CraftedPreviewPanel
          scene={preview}
          onBack={() => setPreview(null)}
          onPlace={scene => { place(scene); setPreview(null) }}
          accentColor={accentColor}
          canvasHeight={previewHeight}
        />
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-gray-400">
        <div className="mb-1 text-2xl">{'⚙'}</div>
        <div className="text-xs">No crafted scenes yet</div>
        <div className="mt-1 text-[10px] text-gray-500">Describe a scene and hit Craft</div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5" data-crafted-gallery>
      <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-gray-500">
        <span>click to place · ⓘ details</span>
        <span className="flex items-center gap-1">
          <button type="button" aria-label="Fewer columns" disabled={columns <= MIN_COLUMNS} onClick={() => writeColumns(columns - 1)} className="h-4 w-4 rounded border border-white/15 leading-none text-gray-300 hover:bg-white/10 disabled:opacity-30">−</button>
          <span className="w-10 text-center normal-case tracking-normal">{columns} cols</span>
          <button type="button" aria-label="More columns" disabled={columns >= MAX_COLUMNS} onClick={() => writeColumns(columns + 1)} className="h-4 w-4 rounded border border-white/15 leading-none text-gray-300 hover:bg-white/10 disabled:opacity-30">+</button>
        </span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map(({ scene, inWorld }) => {
          const version = thumbVersions.get(scene.id)
          const thumb = scene.thumbnailUrl || `/crafted-thumbs/${scene.id}.jpg`
          return (
          <AssetCard
            key={`${scene.id}:${version || 0}`}
            id={scene.id}
            name={scene.name}
            type="crafted"
            thumbnailUrl={version ? `${thumb.split('?')[0]}?v=${version}` : thumb}
            isInWorld={inWorld}
            accentColor={accentColor}
            subtitle={`${scene.objects.length} primitives`}
            compact={columns >= 4}
            onClick={() => place(scene)}
            onInfo={() => setPreview(scene)}
            onDelete={() => (inWorld ? removeCraftedScene(scene.id) : deleteFromLibrary(scene.id))}
            deleteTitle={inWorld ? `Remove ${scene.name} from this world (stays in the library)` : `Delete ${scene.name} from the library`}
          />
          )
        })}
      </div>
    </div>
  )
}

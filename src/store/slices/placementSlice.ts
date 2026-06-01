import type { CatalogPlacement, CraftedScene } from '../../lib/conjure/types'
import { PLACEMENT_VFX_LIST, type PlacementPending, type PlacementVfxType } from '../../lib/forge/placement-types'
import { worldMutationBus } from '../../lib/world-mutation-bus'
import { applyCatalogPlacementUpdateCommand } from '../../lib/world-commands/catalog-placement'
import { awardXp } from '../../hooks/useXp'

export interface ActivePlacementVfxState {
  id: string
  position: [number, number, number]
  type: PlacementVfxType
  startedAt: number
  duration: number
}

export interface PlacementSlice {
  enterPlacementMode: (pending: PlacementPending) => void
  cancelPlacement: () => void
  placeCatalogAssetAt: (
    catalogId: string,
    name: string,
    path: string,
    defaultScale: number,
    position: [number, number, number],
    audioUrl?: string,
  ) => string
  placeImageAt: (
    name: string,
    imageUrl: string,
    position: [number, number, number],
    frameStyle?: string,
    frameThickness?: number,
    mediaOpacity?: number,
  ) => void
  placeVideoAt: (
    name: string,
    videoUrl: string,
    position: [number, number, number],
    frameStyle?: string,
    frameThickness?: number,
    mediaOpacity?: number,
  ) => void
  updateCatalogPlacement: (id: string, updates: Partial<CatalogPlacement>) => void
  placeLibrarySceneAt: (sceneId: string, position: [number, number, number]) => void
  setPlacementVfxType: (type: PlacementVfxType) => void
  setPlacementVfxDuration: (duration: number) => void
  spawnPlacementVfx: (position: [number, number, number], typeOverride?: PlacementVfxType) => void
  removePlacementVfx: (id: string) => void
  previewPlacementSpell: (type: PlacementVfxType) => void
}

interface PlacementSliceState extends PlacementSlice {
  activeWorldId: string
  placedCatalogAssets: CatalogPlacement[]
  craftedScenes: CraftedScene[]
  sceneLibrary: CraftedScene[]
  placementPending: PlacementPending | null
  placementVfxType: PlacementVfxType
  placementVfxDuration: number
  activePlacementVfx: ActivePlacementVfxState[]
  saveWorldState: () => void
}

type PlacementSet<TState extends PlacementSliceState> = (
  partial: Partial<TState> | ((state: TState) => Partial<TState>),
) => void

interface CreatePlacementSliceDeps<TState extends PlacementSliceState> {
  set: PlacementSet<TState>
  get: () => TState
  withUndo: (label: string, icon: string, fn: () => void) => void
  persist: (key: string, value: string) => void
  exitPlacementIfActive: () => void
  saveDelayMs?: number
  now?: () => number
  random?: () => number
  performanceNow?: () => number
  commandActorId?: string
  playPlacementSound?: () => void
}

export function isRealtimeUnsafeMediaUrl(url: string): boolean {
  return url.startsWith('blob:') || (url.startsWith('data:') && url.length > 16 * 1024)
}

export function resolvePlacementVfxType(
  requestedType: PlacementVfxType | undefined,
  currentType: PlacementVfxType,
  random = Math.random,
): Exclude<PlacementVfxType, 'random'> {
  const requested = requestedType === 'random' || (requestedType && PLACEMENT_VFX_LIST.includes(requestedType as Exclude<PlacementVfxType, 'random'>))
    ? requestedType
    : currentType
  if (requested !== 'random') return requested as Exclude<PlacementVfxType, 'random'>
  const index = Math.min(PLACEMENT_VFX_LIST.length - 1, Math.max(0, Math.floor(random() * PLACEMENT_VFX_LIST.length)))
  return PLACEMENT_VFX_LIST[index]
}

export function createPlacementSlice<TState extends PlacementSliceState>({
  set,
  get,
  withUndo,
  persist,
  exitPlacementIfActive,
  saveDelayMs = 100,
  now = Date.now,
  random = Math.random,
  performanceNow = () => performance.now(),
  commandActorId = 'local-user',
  playPlacementSound = () => {
    try { require('../../lib/audio-manager').useAudioManager.getState().play('place') } catch {}
  },
}: CreatePlacementSliceDeps<TState>): PlacementSlice {
  const scheduleSave = () => setTimeout(() => get().saveWorldState(), saveDelayMs)

  const broadcastPlacementIfRealtimeSafe = (
    placement: CatalogPlacement,
    mediaKind: 'image' | 'video',
  ) => {
    const url = mediaKind === 'image' ? placement.imageUrl || '' : placement.videoUrl || ''
    if (!isRealtimeUnsafeMediaUrl(url)) {
      worldMutationBus.broadcast({ kind: 'object_added', payload: placement })
      return
    }
    console.info(`[oasis-bus] skipping ${mediaKind} broadcast (local-only URL)`)
  }

  return {
    enterPlacementMode: (pending) => {
      if (pending.path && pending.type !== 'image') {
        import('@react-three/drei').then(drei => drei.useGLTF.preload(pending.path!))
      }
      set({ placementPending: pending } as Partial<TState>)
      try {
        const im = require('../../lib/input-manager').useInputManager.getState()
        const stack = [...im._uiLayerStack]
        for (const id of stack) im.popUILayer(id)
        im.transition('placement')
        const prevCameraState = im._previousCameraState
        const prevAllowedLock = prevCameraState === 'noclip' || prevCameraState === 'third-person'
        if (!im.pointerLocked && prevAllowedLock) im.requestPointerLock()
      } catch {}
    },

    cancelPlacement: () => {
      set({ placementPending: null } as Partial<TState>)
      try { require('../../lib/input-manager').useInputManager.getState().returnToPrevious() } catch {}
    },

    placeCatalogAssetAt: (catalogId, name, path, defaultScale, position, audioUrl) => {
      let placedId = ''
      let placedPlacement: CatalogPlacement | null = null
      withUndo(`Place ${name}`, '\uD83D\uDCE6', () => {
        placedId = `catalog-${catalogId}-${now()}`
        const placement: CatalogPlacement = {
          id: placedId,
          catalogId,
          name,
          glbPath: path,
          position,
          scale: defaultScale,
          ...(audioUrl ? { audioUrl, audioVolume: 1, audioMaxDistance: 15, audioMuted: false } : {}),
        }
        placedPlacement = placement
        set(state => ({
          placedCatalogAssets: [...state.placedCatalogAssets, placement],
          placementPending: null,
        } as Partial<TState>))
      })
      if (placedPlacement) {
        worldMutationBus.broadcast({ kind: 'object_added', payload: placedPlacement })
      }
      exitPlacementIfActive()
      get().spawnPlacementVfx(position)
      scheduleSave()
      awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
      return placedId
    },

    placeImageAt: (name, imageUrl, position, frameStyle, frameThickness, mediaOpacity) => {
      let placedPlacement: CatalogPlacement | null = null
      withUndo(`Place ${name}`, '\uD83D\uDDBC\uFE0F', () => {
        const id = `image-${now()}`
        const placementScale = frameStyle === 'building' ? 5 : 1
        const placement: CatalogPlacement = {
          id,
          catalogId: 'generated-image',
          name,
          glbPath: '',
          position,
          scale: placementScale,
          imageUrl,
          ...(frameStyle && { imageFrameStyle: frameStyle }),
          ...(frameThickness !== undefined && { imageFrameThickness: frameThickness }),
          ...(mediaOpacity !== undefined && { mediaOpacity }),
        }
        placedPlacement = placement
        set(state => ({
          placedCatalogAssets: [...state.placedCatalogAssets, placement],
          placementPending: null,
        } as Partial<TState>))
      })
      if (placedPlacement) broadcastPlacementIfRealtimeSafe(placedPlacement, 'image')
      exitPlacementIfActive()
      get().spawnPlacementVfx(position)
      scheduleSave()
      awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
    },

    placeVideoAt: (name, videoUrl, position, frameStyle, frameThickness, mediaOpacity) => {
      let placedPlacement: CatalogPlacement | null = null
      withUndo(`Place video ${name}`, '\uD83C\uDFA5', () => {
        const id = `video-${now()}`
        const placement: CatalogPlacement = {
          id,
          catalogId: 'video',
          name,
          glbPath: '',
          position,
          scale: 2,
          videoUrl,
          ...(frameStyle && { imageFrameStyle: frameStyle }),
          ...(frameThickness !== undefined && { imageFrameThickness: frameThickness }),
          ...(mediaOpacity !== undefined && { mediaOpacity }),
        }
        placedPlacement = placement
        set(state => ({
          placedCatalogAssets: [...state.placedCatalogAssets, placement],
          placementPending: null,
        } as Partial<TState>))
      })
      if (placedPlacement) broadcastPlacementIfRealtimeSafe(placedPlacement, 'video')
      exitPlacementIfActive()
      get().spawnPlacementVfx(position)
      scheduleSave()
      awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
    },

    updateCatalogPlacement: (id, updates) => {
      const result = applyCatalogPlacementUpdateCommand(get().placedCatalogAssets, id, updates, {
        worldId: get().activeWorldId,
        actorId: commandActorId,
      })
      set({ placedCatalogAssets: result.placements } as Partial<TState>)
      if (result.legacyMutation) worldMutationBus.broadcast(result.legacyMutation)
      scheduleSave()
    },

    placeLibrarySceneAt: (sceneId, position) => {
      const scene = get().sceneLibrary.find(entry => entry.id === sceneId)
      if (!scene) return
      withUndo('Place scene', '\uD83C\uDFAD', () => {
        const clone: CraftedScene = { ...scene, id: `${scene.id}-${now()}`, position }
        set(state => ({
          craftedScenes: [...state.craftedScenes, clone],
          placementPending: null,
        } as Partial<TState>))
      })
      exitPlacementIfActive()
      get().spawnPlacementVfx(position)
      scheduleSave()
    },

    setPlacementVfxType: (type) => {
      persist('oasis-placement-vfx', type)
      set({ placementVfxType: type } as Partial<TState>)
    },

    setPlacementVfxDuration: (duration) => {
      const clamped = Math.max(0.5, Math.min(4.5, duration))
      persist('oasis-placement-duration', String(clamped))
      set({ placementVfxDuration: clamped } as Partial<TState>)
    },

    spawnPlacementVfx: (position, typeOverride) => {
      const { placementVfxType, placementVfxDuration } = get()
      const vfx: ActivePlacementVfxState = {
        id: `vfx-${now()}-${random().toString(36).slice(2, 6)}`,
        position,
        type: resolvePlacementVfxType(typeOverride, placementVfxType, random),
        startedAt: performanceNow(),
        duration: placementVfxDuration,
      }
      set(state => ({ activePlacementVfx: [...state.activePlacementVfx, vfx] } as Partial<TState>))
      playPlacementSound()
    },

    removePlacementVfx: (id) => {
      set(state => ({
        activePlacementVfx: state.activePlacementVfx.filter(vfx => vfx.id !== id),
      } as Partial<TState>))
    },

    previewPlacementSpell: (type) => {
      const { placementVfxDuration } = get()
      const vfx: ActivePlacementVfxState = {
        id: `preview-${now()}-${random().toString(36).slice(2, 6)}`,
        position: [0, 0, 0],
        type: resolvePlacementVfxType(type, 'random', random),
        startedAt: performanceNow(),
        duration: placementVfxDuration,
      }
      set(state => ({ activePlacementVfx: [...state.activePlacementVfx, vfx] } as Partial<TState>))
    },
  }
}

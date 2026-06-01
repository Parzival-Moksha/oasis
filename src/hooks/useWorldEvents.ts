'use client'

import { useEffect, useRef } from 'react'
import type { CatalogPlacement, ConjuredAsset, CraftedScene, ObjectBehavior, WorldLight } from '@/lib/conjure/types'
import { cancelPendingSave, getActiveWorldId, getWorldRegistry } from '@/lib/forge/world-persistence'
import type { WorldEvent } from '@/lib/mcp/world-events'
import { useOasisStore } from '@/store/oasisStore'
import type { AgentAvatar, AgentWindow, AgentWindowType } from '@/lib/agent-window-types'
import type { SpatialWebObject } from '@/lib/spatial-web'
import type { PortalGate } from '@/lib/portal-gates'
import { readEmbodiedAgentSettingsFromStorage, type EmbodiedAgentSettings } from '@/lib/agent-action-settings'
import { SPELL_CAST_DURATION_MS, SPELL_CAST_SOUND_URL, withSpellCastAnimation, withoutSpellCastAnimation } from '@/lib/spell-casting'
import { getLiveObjectTransform } from '@/lib/live-object-transforms'
import { resolveAgentAvatarUrl } from '@/lib/agent-avatar-catalog'

const RECONNECT_DELAY_MS = 3000
const REMOTE_RELOAD_POLL_MS = 60
const REMOTE_CONJURE_DISTANCE_M = 1.8
const DEFAULT_AVATAR_MOVE_SPEED = 3

type RemoteWorldEvent = Pick<WorldEvent, 'type' | 'worldId' | 'data' | 'timestamp'>

const MANIFESTED_EVENT_TYPES = new Set([
  'object_added',
  'scene_crafted',
  'object_modified',
  'agent_window_added',
  'light_added',
  'light_modified',
])

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readEventPosition(data?: Record<string, unknown>): [number, number, number] | null {
  if (!Array.isArray(data?.position) || data.position.length < 3) return null
  const [x, y, z] = data.position.map(Number)
  if (![x, y, z].every(Number.isFinite)) return null
  return [x, y, z]
}

function readTransform(value: unknown): { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number } | null {
  const record = asRecord(value)
  if (!record) return null
  const position = readEventPosition(record)
  const rotation = Array.isArray(record.rotation) && record.rotation.length >= 3
    ? [Number(record.rotation[0]), Number(record.rotation[1]), Number(record.rotation[2])] as [number, number, number]
    : undefined
  const scale = Array.isArray(record.scale)
    ? [Number(record.scale[0]), Number(record.scale[1]), Number(record.scale[2])] as [number, number, number]
    : typeof record.scale === 'number'
      ? record.scale
      : undefined
  // At least one field must be present
  if (!position && !rotation && scale === undefined) return null
  return {
    ...(position ? { position } : {}),
    ...(rotation && rotation.every(Number.isFinite) ? { rotation } : {}),
    ...(scale !== undefined ? { scale } : {}),
  }
}

function readCatalogPlacement(value: unknown): CatalogPlacement | null {
  const record = asRecord(value)
  if (!record || typeof record.id !== 'string' || typeof record.catalogId !== 'string' || typeof record.name !== 'string' || typeof record.glbPath !== 'string') {
    return null
  }
  const position = readEventPosition(record)
  if (!position) return null
  const rotation = Array.isArray(record.rotation) && record.rotation.length >= 3
    ? [Number(record.rotation[0]), Number(record.rotation[1]), Number(record.rotation[2])] as [number, number, number]
    : undefined
  const scale = typeof record.scale === 'number' ? record.scale : Number(record.scale)
  return {
    id: record.id,
    catalogId: record.catalogId,
    name: record.name,
    glbPath: record.glbPath,
    position,
    ...(rotation && rotation.every(Number.isFinite) ? { rotation } : {}),
    scale: Number.isFinite(scale) ? scale : 1,
    ...(typeof record.imageUrl === 'string' ? { imageUrl: record.imageUrl } : {}),
    ...(typeof record.videoUrl === 'string' ? { videoUrl: record.videoUrl } : {}),
    ...(typeof record.audioUrl === 'string' ? { audioUrl: record.audioUrl } : {}),
    ...(typeof record.imageFrameStyle === 'string' ? { imageFrameStyle: record.imageFrameStyle } : {}),
  }
}

function readCraftedScene(value: unknown): CraftedScene | null {
  const record = asRecord(value)
  if (!record || typeof record.id !== 'string' || typeof record.name !== 'string' || !Array.isArray(record.objects)) return null
  const position = readEventPosition(record)
  return {
    id: record.id,
    name: record.name,
    prompt: typeof record.prompt === 'string' ? record.prompt : 'mcp-tool',
    objects: cloneValue(record.objects) as CraftedScene['objects'],
    position: position || [0, 0, 0],
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    ...(typeof record.thumbnailUrl === 'string' ? { thumbnailUrl: record.thumbnailUrl } : {}),
  }
}

function readConjuredAsset(value: unknown): ConjuredAsset | null {
  const record = asRecord(value)
  if (!record || typeof record.id !== 'string' || typeof record.prompt !== 'string' || typeof record.provider !== 'string' || typeof record.tier !== 'string') {
    return null
  }
  const position = readEventPosition(record) || [0, 0, 0]
  const rotation = Array.isArray(record.rotation) && record.rotation.length >= 3
    ? [Number(record.rotation[0]), Number(record.rotation[1]), Number(record.rotation[2])] as [number, number, number]
    : [0, 0, 0] as [number, number, number]
  const scale = Number(record.scale)
  const progress = Number(record.progress)
  return {
    id: record.id,
    prompt: record.prompt,
    provider: record.provider as ConjuredAsset['provider'],
    tier: record.tier,
    providerTaskId: typeof record.providerTaskId === 'string' ? record.providerTaskId : '',
    status: typeof record.status === 'string' ? record.status as ConjuredAsset['status'] : 'queued',
    progress: Number.isFinite(progress) ? progress : 0,
    position,
    scale: Number.isFinite(scale) ? scale : 1,
    rotation: rotation.every(Number.isFinite) ? rotation : [0, 0, 0],
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    ...(typeof record.displayName === 'string' ? { displayName: record.displayName } : {}),
    ...(typeof record.glbPath === 'string' ? { glbPath: record.glbPath } : {}),
    ...(typeof record.thumbnailUrl === 'string' ? { thumbnailUrl: record.thumbnailUrl } : {}),
    ...(typeof record.errorMessage === 'string' ? { errorMessage: record.errorMessage } : {}),
    ...(typeof record.completedAt === 'string' ? { completedAt: record.completedAt } : {}),
    ...(typeof record.characterMode === 'boolean' ? { characterMode: record.characterMode } : {}),
    ...(typeof record.autoRig === 'boolean' ? { autoRig: record.autoRig } : {}),
    ...(typeof record.autoAnimate === 'boolean' ? { autoAnimate: record.autoAnimate } : {}),
    ...(typeof record.animationPreset === 'string' ? { animationPreset: record.animationPreset } : {}),
    ...(typeof record.sourceAssetId === 'string' ? { sourceAssetId: record.sourceAssetId } : {}),
    ...(typeof record.action === 'string' ? { action: record.action as ConjuredAsset['action'] } : {}),
  }
}

function readWorldLight(value: unknown): WorldLight | null {
  const record = asRecord(value)
  const position = readEventPosition(record || undefined)
  if (!record || typeof record.id !== 'string' || typeof record.type !== 'string' || typeof record.color !== 'string' || !position) return null
  const intensity = Number(record.intensity)
  return {
    id: record.id,
    type: record.type as WorldLight['type'],
    color: record.color,
    intensity: Number.isFinite(intensity) ? intensity : 1,
    position,
    visible: record.visible !== false,
    ...(record.type === 'hemisphere' && typeof record.groundColor === 'string' ? { groundColor: record.groundColor } : {}),
    ...(record.type === 'spot' && Array.isArray(record.target) ? { target: cloneValue(record.target) as [number, number, number] } : {}),
    ...(record.type === 'spot' && Number.isFinite(Number(record.angle)) ? { angle: Number(record.angle) } : {}),
  }
}

function readAgentAvatar(value: unknown): AgentAvatar | null {
  const record = asRecord(value)
  const position = readEventPosition(record || undefined)
  if (!record || typeof record.id !== 'string' || typeof record.agentType !== 'string' || typeof record.avatar3dUrl !== 'string' || !position) return null
  const avatarResolution = resolveAgentAvatarUrl(record.avatar3dUrl)
  const rotation = Array.isArray(record.rotation) && record.rotation.length >= 3
    ? [Number(record.rotation[0]), Number(record.rotation[1]), Number(record.rotation[2])] as [number, number, number]
    : [0, 0, 0] as [number, number, number]
  const scale = Number(record.scale)
  return {
    id: record.id,
    agentType: record.agentType as AgentAvatar['agentType'],
    avatar3dUrl: avatarResolution.url,
    position,
    rotation: rotation.every(Number.isFinite) ? rotation : [0, 0, 0],
    scale: Number.isFinite(scale) ? scale : 1,
    ...(typeof record.linkedWindowId === 'string' ? { linkedWindowId: record.linkedWindowId } : {}),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(typeof record.ownerId === 'string' ? { ownerId: record.ownerId } : {}),
  }
}

function readAgentWindow(value: unknown): AgentWindow | null {
  const record = asRecord(value)
  const position = readEventPosition(record || undefined)
  if (!record || typeof record.id !== 'string' || typeof record.agentType !== 'string' || !position) return null
  const rotation = Array.isArray(record.rotation) && record.rotation.length >= 3
    ? [Number(record.rotation[0]), Number(record.rotation[1]), Number(record.rotation[2])] as [number, number, number]
    : [0, 0, 0] as [number, number, number]
  const scale = Number(record.scale)
  const width = Number(record.width)
  const height = Number(record.height)
  const frameThickness = Number(record.frameThickness)
  const windowOpacity = Number(record.windowOpacity)
  const windowBlur = Number(record.windowBlur)
  const renderMode = record.renderMode === 'hybrid-snapdom' || record.renderMode === 'hybrid-foreign-object' || record.renderMode === 'live-html'
    ? record.renderMode
    : undefined
  const browserSurfaceMode = record.browserSurfaceMode === 'desktop-capture' ? 'desktop-capture' : record.browserSurfaceMode === 'live-browser' ? 'live-browser' : undefined
  return {
    id: record.id,
    agentType: record.agentType as AgentWindow['agentType'],
    position,
    rotation: rotation.every(Number.isFinite) ? rotation : [0, 0, 0],
    scale: Number.isFinite(scale) ? scale : 0.15,
    width: Number.isFinite(width) ? width : 800,
    height: Number.isFinite(height) ? height : 600,
    ...(renderMode ? { renderMode } : {}),
    ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(typeof record.linkedAvatarId === 'string' ? { linkedAvatarId: record.linkedAvatarId } : {}),
    ...(typeof record.anchorMode === 'string' ? { anchorMode: record.anchorMode as AgentWindow['anchorMode'] } : {}),
    ...(browserSurfaceMode ? { browserSurfaceMode } : {}),
    ...(typeof record.surfaceUrl === 'string' ? { surfaceUrl: record.surfaceUrl } : {}),
    ...(typeof record.captureSourceId === 'string' ? { captureSourceId: record.captureSourceId } : {}),
    ...(typeof record.captureSourceName === 'string' ? { captureSourceName: record.captureSourceName } : {}),
    ...(Number.isFinite(Number(record.captureFps)) ? { captureFps: Number(record.captureFps) } : {}),
    ...(typeof record.frameStyle === 'string' ? { frameStyle: record.frameStyle } : {}),
    ...(Number.isFinite(frameThickness) ? { frameThickness } : {}),
    ...(Number.isFinite(windowOpacity) ? { windowOpacity } : {}),
    ...(Number.isFinite(windowBlur) ? { windowBlur } : {}),
    ...(typeof record.ownerId === 'string' ? { ownerId: record.ownerId } : {}),
  }
}

function remoteAgentOwnerKey(ownerId?: string): string {
  return ownerId?.trim() || 'legacy'
}

function sameRemoteAgentOwner(a?: string, b?: string): boolean {
  return remoteAgentOwnerKey(a) === remoteAgentOwnerKey(b)
}

function isSharedRemoteAgentAvatarType(agentType: string): boolean {
  return agentType === 'anorak-pro'
    || agentType === 'merlin'
    || agentType === 'realtime'
    || agentType === 'hermes'
    || agentType === 'openclaw'
    || agentType === 'gemini'
}

function readSpatialWebObject(value: unknown): SpatialWebObject | null {
  const record = asRecord(value)
  const position = readEventPosition(record || undefined)
  if (!record || typeof record.id !== 'string' || typeof record.type !== 'string' || typeof record.label !== 'string' || !position) return null
  return cloneValue({
    ...record,
    position,
  }) as SpatialWebObject
}

function readPortalGate(value: unknown): PortalGate | null {
  const record = asRecord(value)
  const position = readEventPosition(record || undefined)
  if (!record || typeof record.id !== 'string' || typeof record.variant !== 'string' || !position) return null
  return cloneValue({
    ...record,
    position,
  }) as PortalGate
}

function readBehavior(value: unknown): ObjectBehavior | null {
  const record = asRecord(value)
  if (!record) return null
  return cloneValue(record) as unknown as ObjectBehavior
}

function countLoadedObjects(state: {
  placedCatalogAssets: CatalogPlacement[]
  worldConjuredAssetIds?: string[]
  craftedScenes: CraftedScene[]
  portalGates?: PortalGate[]
  spatialWebObjects?: SpatialWebObject[]
}): number {
  return state.placedCatalogAssets.length + state.craftedScenes.length + (state.worldConjuredAssetIds?.length || 0) + (state.portalGates?.length || 0) + (state.spatialWebObjects?.length || 0)
}

function readStoreObjectPosition(state: ReturnType<typeof useOasisStore.getState>, objectId: string): [number, number, number] | null {
  const transformPosition = state.transforms[objectId]?.position
  if (Array.isArray(transformPosition) && transformPosition.length >= 3) {
    return [Number(transformPosition[0]), Number(transformPosition[1]), Number(transformPosition[2])]
  }

  const placement = state.placedCatalogAssets.find(entry => entry.id === objectId)
  if (placement) return placement.position

  const scene = state.craftedScenes.find(entry => entry.id === objectId)
  if (scene) return scene.position

  const spatialWebObject = state.spatialWebObjects.find(entry => entry.id === objectId)
  if (spatialWebObject) return spatialWebObject.position

  const portalGate = state.portalGates.find(entry => entry.id === objectId)
  if (portalGate) return portalGate.position

  const avatar = state.placedAgentAvatars.find(entry => entry.id === objectId)
  if (avatar) return avatar.position

  const agentWindow = state.placedAgentWindows.find(entry => entry.id === objectId)
  if (agentWindow) return agentWindow.position

  return null
}

function readActorAgentType(data?: Record<string, unknown>): string {
  return typeof data?.actorAgentType === 'string' ? data.actorAgentType.toLowerCase() : ''
}

function readObjectIdFromEvent(event: RemoteWorldEvent): string | null {
  const data = event.data || {}
  if (typeof data.objectId === 'string') return data.objectId
  if (typeof data.id === 'string') return data.id
  if (typeof data.avatarId === 'string') return data.avatarId
  if (typeof data.lightId === 'string') return data.lightId
  return null
}

function planarDistance(a: [number, number, number], b: [number, number, number]): number {
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  return Math.sqrt(dx * dx + dz * dz)
}

function computeStandOffTarget(actorPosition: [number, number, number], targetPosition: [number, number, number], standOffDistance = REMOTE_CONJURE_DISTANCE_M): [number, number, number] {
  const dx = targetPosition[0] - actorPosition[0]
  const dz = targetPosition[2] - actorPosition[2]
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance <= standOffDistance || distance === 0) return targetPosition
  const ratio = (distance - standOffDistance) / distance
  return [
    actorPosition[0] + dx * ratio,
    actorPosition[1],
    actorPosition[2] + dz * ratio,
  ]
}

export function useWorldEvents() {
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remoteReloadWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedRemoteRefreshRef = useRef(false)
  const eventQueueRef = useRef<RemoteWorldEvent[]>([])
  const processingQueueRef = useRef(false)
  const actorPositionRef = useRef(new Map<string, [number, number, number]>())
  const needsRemoteReloadRef = useRef(false)
  const disposedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    disposedRef.current = false
    const actorPositions = actorPositionRef.current

    const clearRemoteReloadWatch = () => {
      if (!remoteReloadWatchRef.current) return
      clearTimeout(remoteReloadWatchRef.current)
      remoteReloadWatchRef.current = null
    }

    const scheduleRemoteReload = () => {
      const store = useOasisStore.getState()
      if (store._isReceivingRemoteUpdate) {
        queuedRemoteRefreshRef.current = true
        if (!remoteReloadWatchRef.current) {
          remoteReloadWatchRef.current = setTimeout(() => {
            remoteReloadWatchRef.current = null
            scheduleRemoteReload()
          }, REMOTE_RELOAD_POLL_MS)
        }
        return
      }

      clearRemoteReloadWatch()
      store.loadWorldState({ silent: true, remote: true })
      remoteReloadWatchRef.current = setTimeout(() => {
        remoteReloadWatchRef.current = null
        const latestStore = useOasisStore.getState()
        if (latestStore._isReceivingRemoteUpdate) {
          queuedRemoteRefreshRef.current = true
          scheduleRemoteReload()
          return
        }
        if (queuedRemoteRefreshRef.current) {
          queuedRemoteRefreshRef.current = false
          scheduleRemoteReload()
        }
      }, REMOTE_RELOAD_POLL_MS)
    }

    const applyRemoteWorldEvent = (event: RemoteWorldEvent): boolean => {
      const data = event.data || {}

      switch (event.type) {
        case 'object_added': {
          const spatialWebObject = readSpatialWebObject(data.spatialWebObject)
          if (spatialWebObject) {
            useOasisStore.setState(state => {
              const spatialWebObjects = [
                ...state.spatialWebObjects.filter(entry => entry.id !== spatialWebObject.id),
                cloneValue(spatialWebObject),
              ]
              return {
                spatialWebObjects,
                _loadedObjectCount: countLoadedObjects({ placedCatalogAssets: state.placedCatalogAssets, craftedScenes: state.craftedScenes, worldConjuredAssetIds: state.worldConjuredAssetIds, portalGates: state.portalGates, spatialWebObjects }),
              }
            })
            return true
          }

          const portalGate = readPortalGate(data.portalGate)
          if (portalGate) {
            useOasisStore.setState(state => {
              const portalGates = [
                ...state.portalGates.filter(entry => entry.id !== portalGate.id),
                cloneValue(portalGate),
              ]
              return {
                portalGates,
                _loadedObjectCount: countLoadedObjects({ placedCatalogAssets: state.placedCatalogAssets, craftedScenes: state.craftedScenes, worldConjuredAssetIds: state.worldConjuredAssetIds, portalGates, spatialWebObjects: state.spatialWebObjects }),
              }
            })
            return true
          }

          const placement = readCatalogPlacement(data.placement || data.catalogPlacement)
          if (!placement) return false
          useOasisStore.setState(state => {
            const placedCatalogAssets = [
              ...state.placedCatalogAssets.filter(entry => entry.id !== placement.id),
              cloneValue(placement),
            ]
            return {
              placedCatalogAssets,
              _loadedObjectCount: countLoadedObjects({ placedCatalogAssets, craftedScenes: state.craftedScenes, worldConjuredAssetIds: state.worldConjuredAssetIds, portalGates: state.portalGates, spatialWebObjects: state.spatialWebObjects }),
            }
          })
          return true
        }

        case 'conjured_asset_added': {
          const assetId = typeof data.assetId === 'string' ? data.assetId : ''
          if (!assetId) return false
          const asset = readConjuredAsset(data.asset)
          const transform = readTransform(data.transform)
          useOasisStore.setState(state => {
            const conjuredAssets = asset
              ? [
                  ...state.conjuredAssets.filter(entry => entry.id !== asset.id),
                  cloneValue(asset),
                ]
              : state.conjuredAssets
            const worldConjuredAssetIds = state.worldConjuredAssetIds.includes(assetId)
              ? state.worldConjuredAssetIds
              : [...state.worldConjuredAssetIds, assetId]
            const transforms = transform
              ? { ...state.transforms, [assetId]: cloneValue(transform) }
              : state.transforms
            return {
              conjuredAssets,
              worldConjuredAssetIds,
              transforms,
              _loadedObjectCount: countLoadedObjects({ placedCatalogAssets: state.placedCatalogAssets, craftedScenes: state.craftedScenes, worldConjuredAssetIds, portalGates: state.portalGates, spatialWebObjects: state.spatialWebObjects }),
            }
          })
          return true
        }

        case 'scene_crafted':
        case 'scene_craft_progress': {
          const scene = readCraftedScene(data.scene)
          if (!scene) return false
          const transform = readTransform(data.transform)
          useOasisStore.setState(state => {
            const craftedScenes = [
              ...state.craftedScenes.filter(entry => entry.id !== scene.id),
              cloneValue(scene),
            ]
            const transforms = transform
              ? { ...state.transforms, [scene.id]: cloneValue(transform) }
              : state.transforms
            return {
              craftedScenes,
              transforms,
              _loadedObjectCount: countLoadedObjects({ placedCatalogAssets: state.placedCatalogAssets, craftedScenes, worldConjuredAssetIds: state.worldConjuredAssetIds, portalGates: state.portalGates, spatialWebObjects: state.spatialWebObjects }),
            }
          })
          return true
        }

        case 'object_modified': {
          const objectId = typeof data.objectId === 'string' ? data.objectId : ''
          if (!objectId) return false
          const placement = readCatalogPlacement(data.placement)
          const scene = readCraftedScene(data.scene)
          const avatar = readAgentAvatar(data.avatar)
          const agentWindow = readAgentWindow(data.window || data.agentWindow)
          const spatialWebObject = readSpatialWebObject(data.spatialWebObject)
          const portalGate = readPortalGate(data.portalGate)
          const transform = readTransform(data.transform)
          const behavior = readBehavior(data.behavior)

          useOasisStore.setState(state => {
            const placedCatalogAssets = placement
              ? [
                  ...state.placedCatalogAssets.filter(entry => entry.id !== placement.id),
                  cloneValue(placement),
                ]
              : state.placedCatalogAssets

            const craftedScenes = scene
              ? [
                  ...state.craftedScenes.filter(entry => entry.id !== scene.id),
                  cloneValue(scene),
                ]
              : state.craftedScenes

            const placedAgentAvatars = avatar
              ? [
                  ...state.placedAgentAvatars.filter(entry => entry.id !== avatar.id),
                  cloneValue(avatar),
                ]
              : state.placedAgentAvatars

            const placedAgentWindows = agentWindow
              ? [
                  ...state.placedAgentWindows.filter(entry => entry.id !== agentWindow.id),
                  cloneValue(agentWindow),
                ]
              : state.placedAgentWindows

            const spatialWebObjects = spatialWebObject
              ? [
                  ...state.spatialWebObjects.filter(entry => entry.id !== spatialWebObject.id),
                  cloneValue(spatialWebObject),
                ]
              : state.spatialWebObjects

            const portalGates = portalGate
              ? [
                  ...state.portalGates.filter(entry => entry.id !== portalGate.id),
                  cloneValue(portalGate),
                ]
              : state.portalGates

            let transforms = state.transforms
            if (avatar) {
              const { [avatar.id]: _removedAvatarTransform, ...remainingTransforms } = state.transforms
              transforms = remainingTransforms
            } else if (transform) {
              transforms = { ...state.transforms, [objectId]: cloneValue(transform) }
            }

            const behaviors = behavior
              ? { ...state.behaviors, [objectId]: cloneValue(behavior) }
              : state.behaviors

            return {
              placedCatalogAssets,
              craftedScenes,
              placedAgentAvatars,
              placedAgentWindows,
              portalGates,
              spatialWebObjects,
              transforms,
              behaviors,
              _loadedObjectCount: countLoadedObjects({ placedCatalogAssets, craftedScenes, worldConjuredAssetIds: state.worldConjuredAssetIds, portalGates, spatialWebObjects }),
            }
          })
          return true
        }

        case 'object_removed': {
          const objectId = typeof data.objectId === 'string' ? data.objectId : ''
          if (!objectId) return false
          const linkedAvatarIds = Array.isArray(data.linkedAvatarIds)
            ? data.linkedAvatarIds.filter((entry): entry is string => typeof entry === 'string')
            : []
          const removedAvatarIds = new Set([objectId, ...linkedAvatarIds])
          useOasisStore.setState(state => {
            const placedCatalogAssets = state.placedCatalogAssets.filter(entry => entry.id !== objectId)
            const craftedScenes = state.craftedScenes.filter(entry => entry.id !== objectId)
            const placedAgentAvatars = state.placedAgentAvatars.filter(entry => !removedAvatarIds.has(entry.id) && entry.linkedWindowId !== objectId)
            const placedAgentWindows = state.placedAgentWindows.filter(entry => entry.id !== objectId)
            const portalGates = state.portalGates.filter(entry => entry.id !== objectId)
            const spatialWebObjects = state.spatialWebObjects.filter(entry => entry.id !== objectId)
            const worldConjuredAssetIds = state.worldConjuredAssetIds.filter(id => id !== objectId)
            const transforms = { ...state.transforms }
            delete transforms[objectId]
            for (const avatarId of linkedAvatarIds) delete transforms[avatarId]
            const { [objectId]: _removedBehavior, ...behaviors } = state.behaviors
            const liveAgentAvatarAudio = { ...state.liveAgentAvatarAudio }
            delete liveAgentAvatarAudio[objectId]
            for (const avatarId of linkedAvatarIds) delete liveAgentAvatarAudio[avatarId]
            return {
              placedCatalogAssets,
              craftedScenes,
              worldConjuredAssetIds,
              placedAgentAvatars,
              placedAgentWindows,
              portalGates,
              spatialWebObjects,
              transforms,
              behaviors,
              liveAgentAvatarAudio,
              selectedObjectId: removedAvatarIds.has(state.selectedObjectId || '') ? null : state.selectedObjectId,
              inspectedObjectId: removedAvatarIds.has(state.inspectedObjectId || '') ? null : state.inspectedObjectId,
              _loadedObjectCount: countLoadedObjects({ placedCatalogAssets, craftedScenes, worldConjuredAssetIds, portalGates, spatialWebObjects }),
            }
          })
          return true
        }

        case 'conjured_asset_removed': {
          const assetId = typeof data.assetId === 'string' ? data.assetId : ''
          if (!assetId) return false
          const deleteRegistry = data.deleteRegistry === true
          useOasisStore.setState(state => {
            const worldConjuredAssetIds = state.worldConjuredAssetIds.filter(id => id !== assetId)
            const conjuredAssets = deleteRegistry
              ? state.conjuredAssets.filter(asset => asset.id !== assetId)
              : state.conjuredAssets
            const { [assetId]: _removedTransform, ...transforms } = state.transforms
            const { [assetId]: _removedBehavior, ...behaviors } = state.behaviors
            return {
              worldConjuredAssetIds,
              conjuredAssets,
              transforms,
              behaviors,
              selectedObjectId: state.selectedObjectId === assetId ? null : state.selectedObjectId,
              inspectedObjectId: state.inspectedObjectId === assetId ? null : state.inspectedObjectId,
              _loadedObjectCount: countLoadedObjects({ placedCatalogAssets: state.placedCatalogAssets, craftedScenes: state.craftedScenes, worldConjuredAssetIds, portalGates: state.portalGates, spatialWebObjects: state.spatialWebObjects }),
            }
          })
          return true
        }

        case 'sky_changed': {
          if (typeof data.presetId !== 'string') return false
          useOasisStore.setState({ worldSkyBackground: data.presetId })
          return true
        }

        case 'ground_changed': {
          if (typeof data.presetId !== 'string') return false
          useOasisStore.setState({ groundPresetId: data.presetId })
          return true
        }

        case 'tiles_painted': {
          const tiles = Array.isArray(data.tiles) ? data.tiles : []
          if (tiles.length === 0) return false
          useOasisStore.setState(state => {
            const groundTiles = { ...state.groundTiles }
            for (const tile of tiles) {
              const record = asRecord(tile)
              if (!record) continue
              const x = Number(record.x)
              const z = Number(record.z)
              const presetId = typeof record.presetId === 'string' ? record.presetId : ''
              if (!Number.isFinite(x) || !Number.isFinite(z) || !presetId) continue
              groundTiles[`${Math.floor(x)},${Math.floor(z)}`] = presetId
            }
            return { groundTiles }
          })
          return true
        }

        case 'light_added': {
          const light = readWorldLight(data.light)
          if (!light) return false
          useOasisStore.setState(state => ({
            worldLights: [
              ...state.worldLights.filter(entry => entry.id !== light.id),
              cloneValue(light),
            ],
          }))
          return true
        }

        case 'light_modified': {
          const light = readWorldLight(data.light)
          if (!light) return false
          useOasisStore.setState(state => ({
            worldLights: [
              ...state.worldLights.filter(entry => entry.id !== light.id),
              cloneValue(light),
            ],
          }))
          return true
        }

        case 'behavior_set': {
          const objectId = typeof data.objectId === 'string' ? data.objectId : ''
          const behavior = readBehavior(data.behavior)
          if (!objectId || !behavior) return false
          useOasisStore.setState(state => ({
            behaviors: { ...state.behaviors, [objectId]: cloneValue(behavior) },
          }))
          return true
        }

        case 'agent_window_added': {
          const agentWindow = readAgentWindow(data.window || data.agentWindow)
          if (!agentWindow) return false
          useOasisStore.setState(state => ({
            placedAgentWindows: [
              ...state.placedAgentWindows.filter(entry => entry.id !== agentWindow.id),
              cloneValue(agentWindow),
            ],
          }))
          actorPositionRef.current.set(agentWindow.id, agentWindow.position)
          return true
        }

        case 'agent_avatar_set': {
          const avatar = readAgentAvatar(data.avatar)
          if (!avatar) return false
          const isSharedAvatarType = isSharedRemoteAgentAvatarType(avatar.agentType)
          useOasisStore.setState(state => {
            const { [avatar.id]: _removedAvatarTransform, ...transforms } = state.transforms
            return {
              placedAgentAvatars: [
                ...state.placedAgentAvatars.filter(entry =>
                  entry.id !== avatar.id
                  && (!isSharedAvatarType || entry.agentType !== avatar.agentType || !sameRemoteAgentOwner(entry.ownerId, avatar.ownerId)),
                ),
                cloneValue(avatar),
              ],
              transforms,
            }
          })
          actorPositionRef.current.set(avatar.id, avatar.position)

          // Auto-spawn 3D window for agent avatars that don't have one yet
          if (isSharedAvatarType) {
            const store = useOasisStore.getState()
            const hasWindow = store.placedAgentWindows.some(w =>
              w.linkedAvatarId === avatar.id
              || (w.agentType === avatar.agentType && sameRemoteAgentOwner(w.ownerId, avatar.ownerId))
            )
            if (!hasWindow) {
              const windowId = `agent-${avatar.agentType}-${Date.now()}`
              useOasisStore.setState(state => ({
                placedAgentWindows: [
                  ...state.placedAgentWindows,
                  {
                id: windowId,
                agentType: avatar.agentType as AgentWindowType,
                position: avatar.position,
                rotation: [0, 0, 0],
                scale: 0.15,
                width: 800,
                height: 600,
                renderMode: 'live-html',
                frameStyle: avatar.agentType === 'hermes' ? 'fire' : undefined,
                frameThickness: avatar.agentType === 'hermes' ? 6 : undefined,
                linkedAvatarId: avatar.id,
                anchorMode: 'next-to',
                    ownerId: avatar.ownerId,
                  },
                ],
              }))
            }
          }
          return true
        }

        case 'agent_avatar_walk': {
          const avatarId = typeof data.avatarId === 'string' ? data.avatarId : ''
          const target = Array.isArray(data.target) && data.target.length >= 3
            ? [Number(data.target[0]), Number(data.target[1]), Number(data.target[2])] as [number, number, number]
            : null
          if (!avatarId || !target || !target.every(Number.isFinite)) return false
          const behavior = readBehavior(data.behavior)
          useOasisStore.setState(state => {
            const existing = state.behaviors[avatarId] || { visible: true, movement: { type: 'static' as const } }
            return {
              behaviors: {
                ...state.behaviors,
                [avatarId]: behavior || { ...existing, moveTarget: target, moveSpeed: Number(data.moveSpeed) || DEFAULT_AVATAR_MOVE_SPEED },
              },
            }
          })
          return true
        }

        case 'agent_avatar_animation': {
          const avatarId = typeof data.avatarId === 'string' ? data.avatarId : ''
          const behavior = readBehavior(data.behavior)
          if (!avatarId || !behavior) return false
          useOasisStore.setState(state => ({
            behaviors: { ...state.behaviors, [avatarId]: cloneValue(behavior) },
          }))
          return true
        }

        case 'world_switch': {
          // Handled in processRemoteEvent (needs async). Return true to prevent needsRemoteReload.
          return true
        }

        case 'world_cleared': {
          useOasisStore.setState({
            craftedScenes: [],
            placedCatalogAssets: [],
            worldConjuredAssetIds: [],
            spatialWebObjects: [],
            placedAgentAvatars: [],
            placedAgentWindows: [],
            worldLights: [],
            transforms: {},
            behaviors: {},
            groundTiles: {},
            liveAgentAvatarAudio: {},
            selectedObjectId: null,
            inspectedObjectId: null,
            _loadedObjectCount: 0,
          })
          actorPositionRef.current.clear()
          return true
        }

        case 'world_saved':
          // Intentional no-op — world_saved is valid but handled by the
          // remote reload fallback path, not an explicit handler.
          return false

        case 'generated_image_added': {
          const record = asRecord(data.image)
          if (!record) return false
          const id = typeof record.id === 'string' ? record.id : ''
          const url = typeof record.url === 'string' ? record.url : ''
          const tileUrl = typeof record.tileUrl === 'string' ? record.tileUrl : url
          const prompt = typeof record.prompt === 'string' ? record.prompt : ''
          const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
          const title = typeof record.title === 'string' ? record.title : undefined
          if (!id || !url) return false
          useOasisStore.getState().addGeneratedImage({ id, prompt, url, tileUrl, createdAt, ...(title ? { title } : {}) })
          return true
        }

        default:
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[WorldEvents] unhandled event type: ${event.type}`)
          }
          return false
      }
    }

    const resolveActorAvatarId = (event: RemoteWorldEvent): string | null => {
      const actorAgentType = readActorAgentType(event.data)
      if (!actorAgentType) return null
      const state = useOasisStore.getState()
      const avatar = state.placedAgentAvatars.find(entry => entry.agentType === actorAgentType)
      return avatar?.id || null
    }

    const readKnownObjectPosition = (objectId: string): [number, number, number] | null => {
      const livePosition = getLiveObjectTransform(objectId)?.position
      if (Array.isArray(livePosition) && livePosition.length >= 3) {
        return [Number(livePosition[0]), Number(livePosition[1]), Number(livePosition[2])]
      }
      const storePosition = readStoreObjectPosition(useOasisStore.getState(), objectId)
      if (storePosition) return storePosition
      return actorPositionRef.current.get(objectId) || null
    }

    const readManifestPositionFromPayload = (data?: Record<string, unknown>): [number, number, number] | null => {
      if (!data) return null
      const explicit = readEventPosition(data)
      if (explicit) return explicit

      const placement = readCatalogPlacement(data.placement || data.catalogPlacement)
      if (placement) return placement.position

      const scene = readCraftedScene(data.scene)
      if (scene) return scene.position

      const spatialWebObject = readSpatialWebObject(data.spatialWebObject)
      if (spatialWebObject) return spatialWebObject.position

      const agentWindow = readAgentWindow(data.window || data.agentWindow)
      if (agentWindow) return agentWindow.position

      const transform = readTransform(data.transform)
      if (transform?.position) return transform.position

      const light = readWorldLight(data.light)
      if (light) return light.position

      const avatar = readAgentAvatar(data.avatar)
      if (avatar) return avatar.position

      return null
    }

    const resolveManifestPosition = (event: RemoteWorldEvent): [number, number, number] | null => {
      const explicit = readManifestPositionFromPayload(event.data)
      if (explicit) return explicit
      const objectId = readObjectIdFromEvent(event)
      if (!objectId) return null
      return readStoreObjectPosition(useOasisStore.getState(), objectId)
    }

    const waitForActorArrival = async (
      actorAvatarId: string,
      targetPosition: [number, number, number],
      timeoutMs: number,
    ): Promise<[number, number, number] | null> => {
      const deadline = Date.now() + Math.max(250, timeoutMs)
      while (!disposedRef.current && Date.now() < deadline) {
        const currentPosition = readKnownObjectPosition(actorAvatarId)
        if (currentPosition && planarDistance(currentPosition, targetPosition) <= 0.18) {
          return currentPosition
        }
        await wait(60)
      }
      return readKnownObjectPosition(actorAvatarId)
    }

    const maybeWalkActorIntoPlace = async (
      event: RemoteWorldEvent,
      targetPosition: [number, number, number] | null,
      agentSettings: EmbodiedAgentSettings,
    ) => {
      if (!targetPosition) return
      const actorAvatarId = resolveActorAvatarId(event)
      if (!actorAvatarId) return
      const affectedObjectId = readObjectIdFromEvent(event)
      if (affectedObjectId && affectedObjectId === actorAvatarId) return

      const store = useOasisStore.getState()
      const currentPosition = readKnownObjectPosition(actorAvatarId)
      if (!currentPosition) return

      const walkTarget = computeStandOffTarget(currentPosition, targetPosition)
      if (planarDistance(currentPosition, walkTarget) <= 0.18) {
        actorPositionRef.current.set(actorAvatarId, currentPosition)
        return
      }
      const moveSpeed = Number(store.behaviors[actorAvatarId]?.moveSpeed) || agentSettings.agentWalkSpeed || DEFAULT_AVATAR_MOVE_SPEED

      useOasisStore.setState(state => {
        const existing = state.behaviors[actorAvatarId] || { visible: true, movement: { type: 'static' as const } }
        return {
          behaviors: {
            ...state.behaviors,
            [actorAvatarId]: {
              ...existing,
              moveTarget: walkTarget,
              moveSpeed,
            },
          },
        }
      })

      const travelTimeMs = Math.max(250, (planarDistance(currentPosition, walkTarget) / moveSpeed) * 1000)
      const arrivedPosition = await waitForActorArrival(actorAvatarId, walkTarget, travelTimeMs + 1200)
      actorPositionRef.current.set(actorAvatarId, arrivedPosition || walkTarget)
    }

    const playManifestSequence = async (
      event: RemoteWorldEvent,
      manifestPosition: [number, number, number] | null,
      agentSettings: EmbodiedAgentSettings,
      materializedObjectId: string | null,
    ) => {
      if (!manifestPosition) return
      await maybeWalkActorIntoPlace(event, manifestPosition, agentSettings)
      if (disposedRef.current) return

      if (materializedObjectId) {
        useOasisStore.getState().revealAgentMaterialization(materializedObjectId)
      }
      useOasisStore.getState().spawnPlacementVfx(manifestPosition)

      const actorAvatarId = resolveActorAvatarId(event)
      if (actorAvatarId) {
        useOasisStore.setState(state => {
          const existing = state.behaviors[actorAvatarId]
          return {
            behaviors: {
              ...state.behaviors,
              [actorAvatarId]: withSpellCastAnimation(existing),
            },
          }
        })
        useOasisStore.getState().setAgentAvatarAudio(actorAvatarId, {
          url: SPELL_CAST_SOUND_URL,
          volume: 0.9,
          maxDistance: 14,
          state: 'playing',
          loop: true,
          playbackId: `spellcast-${event.timestamp || Date.now()}`,
        })
      }

      await wait(Math.max(0, agentSettings.agentConjureDurationMs || SPELL_CAST_DURATION_MS))
      if (disposedRef.current) return

      if (actorAvatarId) {
        useOasisStore.getState().setAgentAvatarAudio(actorAvatarId, null)
        useOasisStore.setState(state => {
          const existing = state.behaviors[actorAvatarId]
          const nextBehavior = withoutSpellCastAnimation(existing)
          if (!nextBehavior) return state
          return {
            behaviors: {
              ...state.behaviors,
              [actorAvatarId]: nextBehavior,
            },
          }
        })
      }
    }

    const processRemoteEvent = async (event: RemoteWorldEvent) => {
      if (event.worldId && event.worldId !== getActiveWorldId()) return

      const agentSettings = readEmbodiedAgentSettingsFromStorage()
      const manifestPosition = resolveManifestPosition(event)
      const shouldManifest = agentSettings.agentActionMode === 'embodied' && MANIFESTED_EVENT_TYPES.has(event.type) && !!manifestPosition
      const materializedObjectId = shouldManifest ? readObjectIdFromEvent(event) : null
      if (materializedObjectId) {
        useOasisStore.getState().startAgentMaterialization(materializedObjectId)
      }

      const applied = applyRemoteWorldEvent(event)
      if (shouldManifest && manifestPosition && applied) {
        // Keep actor choreography from blocking remote world updates and input for seconds.
        void playManifestSequence(event, manifestPosition, agentSettings, materializedObjectId).catch(error => {
          console.warn('[WorldEvents] Manifest sequence failed:', error)
        }).finally(() => {
          if (materializedObjectId) {
            useOasisStore.getState().revealAgentMaterialization(materializedObjectId)
          }
        })
      } else if (materializedObjectId) {
        useOasisStore.getState().clearAgentMaterialization(materializedObjectId)
      }
      if (!applied) {
        needsRemoteReloadRef.current = true
      }
    }

    const processQueuedEvents = async () => {
      if (processingQueueRef.current) return
      processingQueueRef.current = true
      needsRemoteReloadRef.current = false
      cancelPendingSave()
      useOasisStore.setState({ _isReceivingRemoteUpdate: true })

      try {
        while (!disposedRef.current && eventQueueRef.current.length > 0) {
          const next = eventQueueRef.current.shift()
          if (!next) continue
          await processRemoteEvent(next)
        }
      } finally {
        processingQueueRef.current = false
        useOasisStore.setState({ _isReceivingRemoteUpdate: false })
        if (!disposedRef.current && needsRemoteReloadRef.current) {
          scheduleRemoteReload()
        }
      }
    }

    const enqueueRemoteEvent = (event: RemoteWorldEvent) => {
      eventQueueRef.current.push(event)
      if (!processingQueueRef.current) {
        void processQueuedEvents()
      }
    }

    function connect() {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      const es = new EventSource('/api/world-events')
      esRef.current = es

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type: string; worldId?: string; data?: Record<string, unknown>; timestamp?: number }
          if (parsed.type === 'heartbeat' || parsed.type === 'connected') return

          const activeWorldId = getActiveWorldId()

          // ═══ world_switch — bypass queue entirely, execute immediately ═══
          if (parsed.type === 'world_switch') {
            if (parsed.worldId && parsed.worldId !== activeWorldId) return
            const targetWorldId = parsed.data?.targetWorldId as string | undefined
            console.warn(`[WorldEvents] 🌍 world_switch! target=${targetWorldId} current=${activeWorldId}`)
            if (targetWorldId && targetWorldId !== activeWorldId) {
              getWorldRegistry().then(registry => {
                useOasisStore.setState({ worldRegistry: registry })
                useOasisStore.getState().switchWorld(targetWorldId)
                console.warn(`[WorldEvents] 🌍 switchWorld() done → ${targetWorldId}`)
              }).catch(err => console.error('[WorldEvents] world_switch failed:', err))
            }
            return
          }

          if (parsed.worldId && parsed.worldId !== activeWorldId) return

          console.log(`[WorldEvents] queued ${parsed.type}`)
          enqueueRemoteEvent({
            type: parsed.type as RemoteWorldEvent['type'],
            worldId: parsed.worldId || activeWorldId,
            data: parsed.data,
            timestamp: parsed.timestamp || Date.now(),
          })
        } catch {
          // Ignore malformed events.
        }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    connect()

    return () => {
      disposedRef.current = true
      clearRemoteReloadWatch()
      eventQueueRef.current = []
      actorPositions.clear()
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [])
}

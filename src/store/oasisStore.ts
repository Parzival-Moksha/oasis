// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Zustand State Store
// The memory of the Oasis
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { create } from 'zustand'
import type { ConjuredAsset, CraftedScene, CatalogPlacement, RealmId, ObjectBehavior, WorldLight, WorldLightType, GeneratedImage } from '../lib/conjure/types'
import { DEFAULT_WORLD_LIGHTS } from '../lib/conjure/types'
import type { TerrainParams } from '../lib/forge/terrain-generator'
import {
  loadWorld, debouncedSaveWorld, saveWorld,
  getWorldRegistry, getActiveWorldId, setActiveWorldId,
  createWorld, deleteWorld, exportWorld, importWorld,
  cancelPendingSave,
  loadPublicWorld,
  type WorldMeta,
} from '../lib/forge/world-persistence'
import { addToSceneLibrary, getSceneLibrary, removeFromSceneLibrary } from '../lib/forge/scene-library'
import { awardXp } from '../hooks/useXp'
import { getCameraSnapshot } from '../lib/camera-bridge'
import {
  deriveAvatarAnchoredWindowPlacement,
  deriveHermesAvatarSpawn,
  deriveStandaloneAgentAvatarSpawn,
  deriveWindowAvatarAnchor,
  deriveWindowAvatarScale,
  type LinkedWindowAnchorMode,
} from '../lib/agent-avatar-utils'
import { DEFAULT_AGENT_AVATAR_URL, getDefaultAgentAvatarUrl, resolveAgentAvatarUrl, sanitizeAgentAvatarList } from '../lib/agent-avatar-catalog'
import {
  foldTransformIntoAgentAvatar,
  isSharedAgentAvatarType as isSharedAgentAvatarWorldType,
  normalizeAgentAvatarTransforms,
  type AgentAvatarTransformMap,
} from '../lib/agent-avatar-world-state'
import { DEFAULT_AGENT_WINDOW_RENDER_MODE, type AgentWindowRenderMode } from '../lib/agent-window-renderers'

const MAX_ACTIVE_MARCH_ORDER_VFX = 8

// ─═̷─═̷─🏗️ SSR-SAFE LOCALSTORAGE ─═̷─═̷─🏗️
// Next.js pre-renders on the server where `window` doesn't exist.
// These two helpers mean we write `typeof window` exactly once — here — instead
// of scattering the guard across every localStorage read/write in the store.
const isBrowser = typeof window !== 'undefined'
const stored  = (key: string): string | null => isBrowser ? localStorage.getItem(key) : null

type RemoteSubscription = { unsubscribe: () => void }
const persist = (key: string, value: string): void => { if (isBrowser) localStorage.setItem(key, value) }

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─═̷─═̷─🪄 VFX TYPES — the language of materialization ─═̷─═̷─🪄
export type ConjureVfxType =
  | 'textswirl' | 'arcane' | 'vortex'
  | 'quantumassembly' | 'primordialcauldron' | 'stellarnursery' | 'chronoforge' | 'abyssalemergence'
  | 'realitystorm' | 'riftstorm' | 'cataclysm'
  | 'random'

export const CONJURE_VFX_LIST: Exclude<ConjureVfxType, 'random'>[] = ['realitystorm', 'riftstorm', 'cataclysm', 'vortex', 'quantumassembly', 'stellarnursery', 'chronoforge', 'abyssalemergence']

export type PlacementVfxType =
  | 'runeflash' | 'sparkburst' | 'portalring' | 'sigilpulse'
  | 'quantumcollapse' | 'phoenixascension' | 'dimensionalrift' | 'crystalgenesis'
  | 'meteorimpact' | 'arcanebloom' | 'voidanchor' | 'stellarforge'
  | 'realitydetonation' | 'dimensionalmaw' | 'hexstorm' | 'singularitydrop'
  | 'random'

const PLACEMENT_VFX_LIST: Exclude<PlacementVfxType, 'random'>[] = ['realitydetonation', 'dimensionalmaw', 'hexstorm', 'singularitydrop', 'quantumcollapse', 'phoenixascension', 'dimensionalrift', 'crystalgenesis', 'meteorimpact', 'arcanebloom', 'voidanchor', 'stellarforge']

export interface PlacementPending {
  type: 'catalog' | 'conjured' | 'crafted' | 'library' | 'image' | 'video' | 'agent' | 'light'
  catalogId?: string
  name: string
  path?: string
  defaultScale?: number
  sceneId?: string
  /** For image placements — URL to the generated image texture */
  imageUrl?: string
  /** For video placements */
  videoUrl?: string
  /** For speaker placements sourced from uploaded audio */
  audioUrl?: string
  /** Frame style ID for image/video placements */
  imageFrameStyle?: string
  /** For agent window placements */
  agentType?: AgentWindowType
  /** Carry over session ID from existing panel */
  agentSessionId?: string
  /** Projection technique used for the 3D window */
  agentRenderMode?: AgentWindowRenderMode
  /** For light placements — which placeable light type */
  lightType?: 'point' | 'spot'
}

export interface ActivePlacementVfx {
  id: string
  position: [number, number, number]
  type: PlacementVfxType
  startedAt: number
  duration: number
}

export interface ActiveMarchOrderVfx {
  id: string
  position: [number, number, number]
  startedAt: number
  duration: number
}

export interface AgentMaterialization {
  objectId: string
  phase: 'pending' | 'revealing'
  minScale: number
  startedAt: number
  revealStartedAt: number | null
  revealDurationMs: number
}

export type AgentActivityStateName = 'idle' | 'working' | 'tooling' | 'error'

export interface AgentActivity {
  agentKey: string
  state: AgentActivityStateName
  runId: string
  sessionId?: string
  activeTool?: string
  startedAt: number
  updatedAt: number
  confidence: 'explicit'
}

// ─═̷─═̷─💻 AGENT WINDOW — placeable interactive panels in 3D ─═̷─═̷─💻
export type BrowserSurfaceMode = 'live-browser' | 'desktop-capture'
export type AgentWindowType = 'anorak' | 'codex' | 'anorak-pro' | 'merlin' | 'realtime' | 'hermes' | 'openclaw' | 'devcraft' | 'parzival' | 'browser' | 'mission'

export interface AgentWindow {
  id: string                              // e.g. 'agent-anorak-1710859200000'
  agentType: AgentWindowType
  renderMode?: AgentWindowRenderMode
  linkedAvatarId?: string
  anchorMode?: LinkedWindowAnchorMode
  position: [number, number, number]
  rotation: [number, number, number]      // euler angles
  scale: number                           // uniform scale (default 1)
  width: number                           // px width of HTML content (default 800)
  height: number                          // px height of HTML content (default 600)
  sessionId?: string                      // claude code session ID (anorak only)
  label?: string                          // user-assignable name
  browserSurfaceMode?: BrowserSurfaceMode // live iframe now, host capture bridge later
  surfaceUrl?: string                     // URL for browser surfaces / offscreen Chromium targets
  captureSourceId?: string                // host-provided native/browser surface ID
  captureSourceName?: string              // last selected host source name
  captureFps?: number                     // preferred host capture rate (1-60)
  frameStyle?: string                     // picture frame style id (gilded, neon, hologram, etc.)
  frameThickness?: number                 // frame thickness multiplier (default 1, range 0.2-150)
  windowOpacity?: number                  // window background opacity (default 1, range 0-1, dims to black)
  windowBlur?: number                     // backdrop blur in px (default 0, range 0-20)
}

export type AgentAvatarType = AgentWindowType | 'hermes'

export interface AgentAvatar {
  id: string
  agentType: AgentAvatarType
  avatar3dUrl: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  linkedWindowId?: string
  label?: string
}

export interface AgentAvatarAudioState {
  url: string
  volume?: number
  maxDistance?: number
  muted?: boolean
  state?: 'playing' | 'paused' | 'stopped'
  loop?: boolean
  playbackId?: string
}

function defaultAgentAvatarLabel(agentType: AgentAvatarType): string {
  switch (agentType) {
    case 'anorak':
      return 'Anorak'
    case 'codex':
      return 'Codex'
    case 'anorak-pro':
      return 'Anorak Pro'
    case 'merlin':
      return 'Merlin'
    case 'realtime':
      return 'Realtime'
    case 'devcraft':
      return 'DevCraft'
    case 'parzival':
      return 'Parzival'
    case 'browser':
      return 'Browser'
    case 'mission':
      return 'Mission'
    case 'hermes':
      return 'Hermes'
    case 'openclaw':
      return 'OpenClaw'
    default:
      return 'Agent'
  }
}

function isSharedAgentAvatarType(agentType: string): agentType is AgentAvatarType {
  return isSharedAgentAvatarWorldType(agentType)
}

function scoreSharedAgentAvatarCandidate(avatar: AgentAvatar, transforms: AgentAvatarTransformMap): number {
  let score = 0
  if (!avatar.linkedWindowId) score += 100
  if (transforms[avatar.id]) score += 20
  if (avatar.avatar3dUrl && avatar.avatar3dUrl !== DEFAULT_AGENT_AVATAR_URL) score += 10
  if (avatar.label) score += 5
  return score
}

function normalizeSharedAgentAvatarWorldState(args: {
  windows: AgentWindow[]
  avatars: AgentAvatar[]
  transforms: AgentAvatarTransformMap
}): {
  windows: AgentWindow[]
  avatars: AgentAvatar[]
  transforms: AgentAvatarTransformMap
  changed: boolean
} {
  const { windows, avatars, transforms } = args
  const sharedGroups = new Map<AgentAvatarType, AgentAvatar[]>()

  for (const avatar of avatars) {
    if (!isSharedAgentAvatarType(avatar.agentType)) continue
    const group = sharedGroups.get(avatar.agentType) || []
    group.push(avatar)
    sharedGroups.set(avatar.agentType, group)
  }

  const winnerByType = new Map<AgentAvatarType, AgentAvatar>()
  const remappedAvatarIds = new Map<string, string>()

  for (const [agentType, group] of sharedGroups.entries()) {
    if (group.length === 0) continue
    const winner = group.reduce((best, candidate) =>
      scoreSharedAgentAvatarCandidate(candidate, transforms) > scoreSharedAgentAvatarCandidate(best, transforms)
        ? candidate
        : best,
    )
    const normalizedWinner: AgentAvatar = {
      ...winner,
      linkedWindowId: undefined,
      label: winner.label || defaultAgentAvatarLabel(agentType),
    }
    winnerByType.set(agentType, normalizedWinner)
    for (const avatar of group) remappedAvatarIds.set(avatar.id, normalizedWinner.id)
  }

  let changed = false
  const emittedSharedTypes = new Set<AgentAvatarType>()
  const nextAvatars: AgentAvatar[] = []
  const nextTransforms: AgentAvatarTransformMap = { ...transforms }

  for (const avatar of avatars) {
    if (!isSharedAgentAvatarType(avatar.agentType)) {
      nextAvatars.push(avatar)
      continue
    }

    if (emittedSharedTypes.has(avatar.agentType)) {
      changed = true
      continue
    }

    emittedSharedTypes.add(avatar.agentType)
    const winner = winnerByType.get(avatar.agentType)
    if (!winner) continue
    if (winner.id !== avatar.id || avatar.linkedWindowId || winner.label !== avatar.label) changed = true
    const folded = foldTransformIntoAgentAvatar(winner, nextTransforms[winner.id])
    if (folded.changed) changed = true
    if (Object.prototype.hasOwnProperty.call(nextTransforms, winner.id)) {
      delete nextTransforms[winner.id]
      changed = true
    }
    nextAvatars.push(folded.avatar)
  }

  const nextWindows = windows.map(window => {
    if (!isSharedAgentAvatarType(window.agentType)) {
      const remappedLinkedAvatarId = window.linkedAvatarId ? remappedAvatarIds.get(window.linkedAvatarId) : undefined
      if (remappedLinkedAvatarId && remappedLinkedAvatarId !== window.linkedAvatarId) {
        changed = true
        return { ...window, linkedAvatarId: remappedLinkedAvatarId }
      }
      return window
    }

    const winner = winnerByType.get(window.agentType)
    if (!winner) {
      if (window.linkedAvatarId && remappedAvatarIds.has(window.linkedAvatarId)) {
        changed = true
        return { ...window, linkedAvatarId: undefined }
      }
      return window
    }

    const remappedLinkedAvatarId = window.linkedAvatarId ? (remappedAvatarIds.get(window.linkedAvatarId) || window.linkedAvatarId) : winner.id
    if (remappedLinkedAvatarId !== window.linkedAvatarId) {
      changed = true
      return { ...window, linkedAvatarId: remappedLinkedAvatarId }
    }
    return window
  })

  for (const [avatarId, winnerId] of remappedAvatarIds.entries()) {
    if (avatarId === winnerId) continue
    if (Object.prototype.hasOwnProperty.call(nextTransforms, avatarId)) {
      delete nextTransforms[avatarId]
      changed = true
    }
  }

  const normalizedAvatarTransforms = normalizeAgentAvatarTransforms(nextAvatars, nextTransforms)
  if (normalizedAvatarTransforms.changed) changed = true

  return {
    windows: nextWindows,
    avatars: normalizedAvatarTransforms.avatars,
    transforms: changed ? normalizedAvatarTransforms.transforms : transforms,
    changed,
  }
}

// ─═̷─═̷─⏪ UNDO/REDO — Time travel for world edits ─═̷─═̷─⏪
// Full-snapshot approach: each command stores complete world state before + after.
// Simple, correct, no stale closures. ~50KB per snapshot × 20 max = ~2MB. Fine.
export interface WorldSnapshot {
  placedCatalogAssets: CatalogPlacement[]
  worldConjuredAssetIds: string[]
  craftedScenes: CraftedScene[]
  transforms: Record<string, { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }>
  behaviors: Record<string, ObjectBehavior>
  groundTiles: Record<string, string>
  worldLights: WorldLight[]
  terrainParams: TerrainParams | null
}

export interface UndoCommand {
  label: string
  icon: string
  timestamp: number
  before: WorldSnapshot
  after: WorldSnapshot
}

const MAX_UNDO_STACK = 20

function captureWorldSnapshot(state: { placedCatalogAssets: CatalogPlacement[]; worldConjuredAssetIds: string[]; craftedScenes: CraftedScene[]; transforms: Record<string, any>; behaviors: Record<string, ObjectBehavior>; groundTiles: Record<string, string>; worldLights: WorldLight[]; terrainParams: TerrainParams | null }): WorldSnapshot {
  // structuredClone for deep copy — no shared references between snapshots
  return structuredClone({
    placedCatalogAssets: state.placedCatalogAssets,
    worldConjuredAssetIds: state.worldConjuredAssetIds,
    craftedScenes: state.craftedScenes,
    transforms: state.transforms,
    behaviors: state.behaviors,
    groundTiles: state.groundTiles,
    worldLights: state.worldLights,
    terrainParams: state.terrainParams,
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════════

interface OasisState {
  // ─═̷─═̷─⚙️ VISUAL SETTINGS ─═̷─═̷─⚙️
  fpsCounterEnabled: boolean
  fpsCounterFontSize: number  // px
  streamOpacity: number       // 0.1-1.0 — ThoughtStream (stashed for Merlin)

  // ─═̷─═̷─🧠 AI MODEL SETTINGS ─═̷─═̷─🧠
  craftModel: string                        // OpenRouter model ID for craft + terrain
  voiceModel: string                        // placeholder for Merlin voice model

  // ─═̷─═̷─🔥 REALM STATE ─═̷─═̷─🔥
  activeRealm: RealmId
  conjuredAssets: ConjuredAsset[]           // global asset registry (server-side)
  worldConjuredAssetIds: string[]           // which conjured assets are in THIS world
  craftedScenes: CraftedScene[]
  conjureVfxType: ConjureVfxType
  placedCatalogAssets: CatalogPlacement[]  // pre-made assets placed in THIS world

  // ─═̷─═̷─🪄 PLACEMENT MODE + VFX ─═̷─═̷─🪄
  placementPending: PlacementPending | null   // what we're about to place (null = not in placement mode)
  placementVfxType: PlacementVfxType
  placementVfxDuration: number                // seconds, 0.5-4.5
  activePlacementVfx: ActivePlacementVfx[]    // currently playing VFX instances
  activeMarchOrderVfx: ActiveMarchOrderVfx[]  // right-click move-order markers
  agentMaterializations: Record<string, AgentMaterialization>

  // ─═̷─═̷─🌍 TERRAIN + WORLD STATE ─═̷─═̷─🌍
  terrainParams: TerrainParams | null
  terrainLoading: boolean
  groundPresetId: string                    // 'none', 'grass', 'sand', etc. (base/default ground)
  groundTiles: Record<string, string>       // sparse: "x,z" → presetId (painted tiles)
  paintMode: boolean
  paintBrushPresetId: string | null
  paintBrushSize: number                    // 1, 3, or 5
  selectedObjectId: string | null      // id of selected crafted scene or asset
  inspectedObjectId: string | null     // id of object with inspector open (double-click)
  transformMode: 'translate' | 'rotate' | 'scale'
  cameraLookAt: [number, number, number] | null  // set to lerp camera to this position
  transforms: Record<string, {        // object id → transform overrides (all fields optional for partial overrides)
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number] | number
  }>
  behaviors: Record<string, ObjectBehavior>  // object id → movement/animation/label
  objectMeshStats: Record<string, import('../lib/conjure/types').ModelStats>  // ░▒▓ per-object mesh anatomy — extracted once when GLB loads ▓▒░
  worldLights: WorldLight[]            // per-world placeable light sources
  worldSkyBackground: string           // per-world sky preset ID (was global in SettingsContext)
  activeWorldId: string
  worldRegistry: WorldMeta[]
  _worldReady: boolean               // ░▒▓ GUARD: true after first successful world load ▓▒░
  _loadedObjectCount: number         // ░▒▓ SANITY CHECK: object count at load time — blocks catastrophic overwrites ▓▒░
  _realtimeChannel: RemoteSubscription | null  // ░▒▓ remote event subscription handle for cleanup ▓▒░
  _isReceivingRemoteUpdate: boolean  // ░▒▓ true while applying remote payload — prevents save loop ▓▒░

  // ─═̷─═̷─📋 MINDCRAFT 3D — mission map selected mission ─═̷─═̷─📋
  mindcraftSelectedMissionId: number | null
  setMindcraftSelectedMissionId: (id: number | null) => void

  // ─═̷─═̷─🧑 AVATAR — RPM 3D avatar ─═̷─═̷─🧑
  avatar3dUrl: string | null

  // ─═̷─═̷─🖼️ IMAGINE — text-to-image gallery ─═̷─═̷─🖼️
  generatedImages: GeneratedImage[]
  customGroundPresets: import('../lib/forge/ground-textures').GroundPreset[]
  addGeneratedImage: (image: GeneratedImage) => void
  removeGeneratedImage: (id: string) => void
  addCustomGroundPreset: (preset: import('../lib/forge/ground-textures').GroundPreset) => void
  removeCustomGroundPreset: (id: string) => void

  // ─═̷─═̷─👁️ VIEW MODE — read-only access to other users' worlds ─═̷─═̷─👁️
  isViewMode: boolean
  viewingWorldMeta: { name: string; icon: string; creator_name?: string; creator_avatar?: string; visibility?: string } | null
  /** True when viewing a public_edit world — editing tools stay enabled */
  isViewModeEditable: boolean
  /** The world ID being viewed (needed for saving to public_edit worlds) */
  viewingWorldId: string | null

  // ─═̷─═̷─🪟 PANEL Z-ORDERING — last clicked = highest z-index ─═̷─═̷─🪟
  _panelZCounter: number
  _panelZMap: Record<string, number>
  bringPanelToFront: (panelName: string) => void
  getPanelZIndex: (panelName: string, defaultZ: number) => number

  // ─═̷─═̷─⚙️ SETTINGS ACTIONS ─═̷─═̷─⚙️
  setFpsCounterEnabled: (enabled: boolean) => void
  setFpsCounterFontSize: (size: number) => void
  setStreamOpacity: (opacity: number) => void
  setCraftModel: (model: string) => void
  setVoiceModel: (model: string) => void

  // ─═̷─═̷─🔥 REALM ACTIONS ─═̷─═̷─🔥
  setActiveRealm: (realm: RealmId) => void
  setConjuredAssets: (assets: ConjuredAsset[]) => void
  addConjuredAsset: (asset: ConjuredAsset) => void
  updateConjuredAsset: (id: string, updates: Partial<ConjuredAsset>) => void
  removeConjuredAsset: (id: string) => void
  placeConjuredAssetInWorld: (assetId: string) => void
  removeConjuredAssetFromWorld: (assetId: string) => void
  addCraftedScene: (scene: CraftedScene) => void
  removeCraftedScene: (id: string) => void
  updateCraftedScene: (id: string, updates: Partial<CraftedScene>) => void
  setConjureVfxType: (type: ConjureVfxType) => void
  placeCatalogAsset: (catalogId: string, name: string, path: string, defaultScale: number) => void
  removeCatalogAsset: (id: string) => void

  // ─═̷─═̷─🪄 PLACEMENT + VFX ACTIONS ─═̷─═̷─🪄
  enterPlacementMode: (pending: PlacementPending) => void
  cancelPlacement: () => void
  placeCatalogAssetAt: (catalogId: string, name: string, path: string, defaultScale: number, position: [number, number, number]) => string
  placeImageAt: (name: string, imageUrl: string, position: [number, number, number], frameStyle?: string) => void
  placeVideoAt: (name: string, videoUrl: string, position: [number, number, number]) => void
  updateCatalogPlacement: (id: string, updates: Partial<import('../lib/conjure/types').CatalogPlacement>) => void
  placeLibrarySceneAt: (sceneId: string, position: [number, number, number]) => void
  setPlacementVfxType: (type: PlacementVfxType) => void
  setPlacementVfxDuration: (duration: number) => void
  spawnPlacementVfx: (position: [number, number, number]) => void
  removePlacementVfx: (id: string) => void
  startAgentMaterialization: (objectId: string) => void
  revealAgentMaterialization: (objectId: string) => void
  clearAgentMaterialization: (objectId: string) => void
  spawnMarchOrderVfx: (position: [number, number, number]) => void
  removeMarchOrderVfx: (id: string) => void
  previewPlacementSpell: (type: PlacementVfxType) => void
  conjurePreview: { type: ConjureVfxType; startedAt: number } | null
  startConjurePreview: (type: ConjureVfxType) => void
  clearConjurePreview: () => void

  // ─═̷─═̷─🔮 CRAFTING VFX — LLM generation in progress ─═̷─═̷─🔮
  craftingInProgress: boolean
  craftingPrompt: string | null
  setCraftingState: (inProgress: boolean, prompt?: string | null) => void

  // ─═̷─═̷─📚 SCENE LIBRARY ─═̷─═̷─📚
  sceneLibrary: CraftedScene[]
  refreshSceneLibrary: () => void
  placeLibraryScene: (sceneId: string) => void
  deleteFromLibrary: (sceneId: string) => void

  // ─═̷─═̷─🌍 TERRAIN + WORLD ACTIONS ─═̷─═̷─🌍
  setTerrainParams: (params: TerrainParams | null) => void
  setTerrainLoading: (loading: boolean) => void
  setGroundPreset: (presetId: string) => void
  enterPaintMode: (presetId: string) => void
  exitPaintMode: () => void
  setPaintBrushSize: (size: number) => void
  paintGroundArea: (cx: number, cz: number) => void
  eraseGroundTile: (x: number, z: number) => void
  clearAllGroundTiles: () => void
  selectObject: (id: string | null) => void
  setInspectedObject: (id: string | null) => void
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void
  setCameraLookAt: (position: [number, number, number] | null) => void
  setObjectTransform: (id: string, transform: { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }) => void
  setAgentAvatarTransform: (id: string, transform: { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }) => void
  setObjectBehavior: (id: string, behavior: Partial<ObjectBehavior>) => void
  setObjectMeshStats: (id: string, stats: import('../lib/conjure/types').ModelStats) => void
  /** RTS-style: send selected object to a target position */
  setMoveTarget: (id: string, target: [number, number, number]) => void
  /** Clear moveTarget when object arrives */
  clearMoveTarget: (id: string) => void
  // ─═̷─═̷─🌅 SKY ACTION ─═̷─═̷─🌅
  setWorldSkyBackground: (id: string) => void
  // ─═̷─═̷─💡 LIGHT ACTIONS ─═̷─═̷─💡
  addWorldLight: (type: WorldLightType) => void
  /** Place a point or spot light at a specific world position (called from PlacementOverlay click). */
  placeLightAt: (type: 'point' | 'spot', position: [number, number, number]) => void
  removeWorldLight: (id: string) => void
  updateWorldLight: (id: string, updates: Partial<WorldLight>) => void
  setWorldLightTransform: (id: string, position: [number, number, number]) => void

  loadWorldState: (options?: { silent?: boolean; remote?: boolean }) => void
  saveWorldState: () => void
  switchWorld: (worldId: string) => void
  createNewWorld: (name: string, icon?: string) => string   // returns new world id
  deleteWorldById: (worldId: string) => void
  refreshWorldRegistry: () => void
  exportCurrentWorld: () => Promise<string | null>
  importWorldFromJson: (json: string) => Promise<string | null>  // returns new world id or null
  initWorlds: () => Promise<void>                                // hydrate registry + scene library on mount
  setAvatar3dUrl: (url: string | null) => void
  enterViewMode: (worldId: string, allowEdit?: boolean) => void   // load a public world (allowEdit=false for anonymous)
  exitViewMode: () => void                                       // return to user's own world

  // ─═̷─═̷─💻 3D AGENT WINDOWS — placeable Claude Code / Merlin / DevCraft in-world ─═̷─═̷─💻
  placedAgentWindows: AgentWindow[]
  placedAgentAvatars: AgentAvatar[]
  liveAgentAvatarAudio: Record<string, AgentAvatarAudioState>
  agentActivity: Record<string, AgentActivity>
  focusedAgentWindowId: string | null       // when set, camera locks to fill viewport with this window
  focusedImageId: string | null             // when set, camera locks to fill viewport with this image
  _preFocusCameraState: { position: [number, number, number]; target: [number, number, number] } | null
  addAgentWindow: (window: AgentWindow) => void
  removeAgentWindow: (id: string) => void
  updateAgentWindow: (id: string, partial: Partial<AgentWindow>) => void
  setAgentWindowAnchorMode: (id: string, anchorMode: LinkedWindowAnchorMode) => void
  assignAvatarToAgentWindow: (windowId: string, avatarUrl: string | null) => string | null
  assignSharedAgentAvatar: (agentType: AgentAvatarType, avatarUrl: string | null, options?: { preferredWindowId?: string | null }) => string | null
  assignHermesAvatar: (avatarUrl: string | null) => string | null
  assignMerlinAvatar: (avatarUrl: string | null) => string | null
  setAgentAvatarAudio: (avatarId: string, audio: AgentAvatarAudioState | null) => void
  startAgentWork: (agentKey: string, runId: string, sessionId?: string) => void
  setAgentWorkTool: (agentKey: string, runId: string, activeTool: string | null) => void
  finishAgentWork: (agentKey: string, runId: string) => void
  failAgentWork: (agentKey: string, runId: string) => void
  focusAgentWindow: (id: string | null) => void
  focusImage: (id: string | null) => void
  navigateAgentWindow: (direction: 1 | -1) => void
  navigateSlide: (direction: 1 | -1) => void

  // ─═̷─═̷─⏪ UNDO/REDO ─═̷─═̷─⏪
  undoStack: UndoCommand[]
  redoStack: UndoCommand[]
  _undoBatch: { label: string; icon: string; before: WorldSnapshot } | null
  _isUndoRedoing: boolean
  undo: () => void
  redo: () => void
  beginUndoBatch: (label: string, icon: string) => void
  commitUndoBatch: () => void
}

export const useOasisStore = create<OasisState>((set, get) => {
  // Expose store to CDP MCP for player tests
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__OASIS_STORE__ = { getState: () => get(), setState: set }
  }

  // ░▒▓ withUndo — wraps any world-mutating action with undo snapshot capture ▓▒░
  const withUndo = (label: string, icon: string, fn: () => void) => {
    if (get()._isUndoRedoing) { fn(); return }
    const before = captureWorldSnapshot(get())
    fn()
    const after = captureWorldSnapshot(get())
    set(state => ({
      undoStack: [...state.undoStack, { label, icon, timestamp: Date.now(), before, after }].slice(-MAX_UNDO_STACK),
      redoStack: [],  // new action clears redo stack
    }))
  }

  const exitPlacementIfActive = () => {
    try {
      const inputManager = require('../lib/input-manager').useInputManager.getState()
      if (inputManager.inputState === 'placement') inputManager.returnToPrevious()
    } catch {}
  }

  const deriveSharedAvatarSpawn = (
    agentType: AgentAvatarType,
    preferredWindowId?: string | null,
  ): { position: [number, number, number]; rotation: [number, number, number]; scale: number } => {
    const preferredWindow = preferredWindowId
      ? get().placedAgentWindows.find(entry => entry.id === preferredWindowId)
      : get().placedAgentWindows.find(entry => entry.agentType === agentType)

    if (preferredWindow) {
      const preferredWindowTransform = get().transforms[preferredWindow.id]
      const anchor = deriveWindowAvatarAnchor(preferredWindow, preferredWindowTransform)
      return {
        position: anchor.position,
        rotation: anchor.rotation,
        scale: deriveWindowAvatarScale(preferredWindow, preferredWindowTransform),
      }
    }

    return agentType === 'hermes' || agentType === 'openclaw' || agentType === 'realtime'
      ? deriveHermesAvatarSpawn(getCameraSnapshot())
      : deriveStandaloneAgentAvatarSpawn(getCameraSnapshot())
  }

  const assignSharedAgentAvatar = (
    agentType: AgentAvatarType,
    avatarUrl: string | null,
    options?: { preferredWindowId?: string | null },
  ): string | null => {
    const existingAvatar = get().placedAgentAvatars.find(entry => entry.agentType === agentType) || null

    if (!avatarUrl) {
      if (!existingAvatar) return null
      set(state => {
        const nextTransforms = { ...state.transforms }
        const nextAudio = { ...state.liveAgentAvatarAudio }
        delete nextTransforms[existingAvatar.id]
        delete nextAudio[existingAvatar.id]
        return {
          placedAgentWindows: state.placedAgentWindows.map(entry =>
            entry.agentType === agentType
              ? { ...entry, linkedAvatarId: undefined, anchorMode: 'detached' }
              : entry,
          ),
          placedAgentAvatars: state.placedAgentAvatars.filter(entry => entry.id !== existingAvatar.id),
          liveAgentAvatarAudio: nextAudio,
          transforms: nextTransforms,
          selectedObjectId: state.selectedObjectId === existingAvatar.id ? null : state.selectedObjectId,
          inspectedObjectId: state.inspectedObjectId === existingAvatar.id ? null : state.inspectedObjectId,
        }
      })
      setTimeout(() => get().saveWorldState(), 100)
      return null
    }

    const sanitizedAvatarUrl = resolveAgentAvatarUrl(avatarUrl).url
    const spawn = deriveSharedAvatarSpawn(agentType, options?.preferredWindowId)

    if (existingAvatar) {
      set(state => ({
        placedAgentWindows: state.placedAgentWindows.map(entry => {
          if (entry.agentType !== agentType) return entry
          const shouldSnapTarget = options?.preferredWindowId === entry.id
          return {
            ...entry,
            linkedAvatarId: existingAvatar.id,
            anchorMode: shouldSnapTarget && (!entry.anchorMode || entry.anchorMode === 'detached')
              ? 'next-to'
              : entry.anchorMode,
          }
        }),
        placedAgentAvatars: state.placedAgentAvatars
          .filter(entry => entry.id === existingAvatar.id || entry.agentType !== agentType)
          .map(entry =>
            entry.id === existingAvatar.id
              ? {
                  ...entry,
                  avatar3dUrl: sanitizedAvatarUrl,
                  linkedWindowId: undefined,
                  label: entry.label || defaultAgentAvatarLabel(agentType),
                  position: entry.position || spawn.position,
                  rotation: entry.rotation || spawn.rotation,
                  scale: entry.scale || spawn.scale,
                }
              : entry,
          ),
      }))
      setTimeout(() => get().saveWorldState(), 100)
      return existingAvatar.id
    }

    // ░▒▓ Stable singleton ID per agentType — Hermes/Merlin MCP tools address  ▓▒░
    // ░▒▓ their body by this fixed name. A timestamp suffix orphaned older    ▓▒░
    // ░▒▓ bodies instead of replacing them (now handled by existingAvatar     ▓▒░
    // ░▒▓ branch above — but the create path must use the same stable form). ▓▒░
    const avatarId = `agent-avatar-${agentType}`
    set(state => ({
      placedAgentWindows: state.placedAgentWindows.map(entry => {
        if (entry.agentType !== agentType) return entry
        const shouldSnapTarget = options?.preferredWindowId === entry.id
        return {
          ...entry,
          linkedAvatarId: avatarId,
          anchorMode: shouldSnapTarget && (!entry.anchorMode || entry.anchorMode === 'detached')
            ? 'next-to'
            : entry.anchorMode,
        }
      }),
      placedAgentAvatars: [
        ...state.placedAgentAvatars.filter(entry => entry.agentType !== agentType),
        {
          id: avatarId,
          agentType,
          avatar3dUrl: sanitizedAvatarUrl,
          position: spawn.position,
          rotation: spawn.rotation,
          scale: spawn.scale,
          label: defaultAgentAvatarLabel(agentType),
        },
      ],
    }))
    setTimeout(() => get().saveWorldState(), 100)
    return avatarId
  }

  return ({
  // ─═̷─═̷─⚙️ VISUAL SETTINGS ─═̷─═̷─⚙️
  fpsCounterEnabled: true,
  fpsCounterFontSize: 14,
  streamOpacity: 0.85,

  // ─═̷─═̷─🧠 AI MODEL SETTINGS ─═̷─═̷─🧠
  craftModel: stored('oasis-craft-model') || 'cc-opus',
  voiceModel: stored('oasis-voice-model') || 'merlin-v1',

  // ─═̷─═̷─🔥 REALM STATE ─═̷─═̷─🔥
  activeRealm: 'forge' as RealmId,
  conjuredAssets: [],
  worldConjuredAssetIds: [],
  craftedScenes: [],
  conjureVfxType: (stored('oasis-vfx') as ConjureVfxType) || 'random',
  placedCatalogAssets: [],
  sceneLibrary: [],

  // ─═̷─═̷─🪄 PLACEMENT MODE + VFX ─═̷─═̷─🪄
  placementPending: null,
  placementVfxType: (stored('oasis-placement-vfx') as PlacementVfxType) || 'random',
  placementVfxDuration: parseFloat(stored('oasis-placement-duration') || '2.2'),
  activePlacementVfx: [],
  activeMarchOrderVfx: [],
  agentMaterializations: {},
  conjurePreview: null,
  craftingInProgress: false,
  craftingPrompt: null,

  // ─═̷─═̷─🌍 TERRAIN + WORLD STATE ─═̷─═̷─🌍
  terrainParams: null,
  terrainLoading: false,
  groundPresetId: 'none',
  groundTiles: {},
  paintMode: false,
  paintBrushPresetId: null,
  paintBrushSize: 1,
  selectedObjectId: null,
  inspectedObjectId: null,
  transformMode: 'translate' as const,
  cameraLookAt: null,
  transforms: {},
  behaviors: {},
  objectMeshStats: {},
  worldLights: [],
  worldSkyBackground: 'night007',
  activeWorldId: isBrowser ? getActiveWorldId() : 'forge-default',
  worldRegistry: [],
  _worldReady: false,  // ░▒▓ GUARD: prevents saving empty state before world load completes ▓▒░
  _loadedObjectCount: 0,  // ░▒▓ SANITY CHECK: set on load, checked on save — blocks catastrophic nukes ▓▒░
  _realtimeChannel: null,
  _isReceivingRemoteUpdate: false,

  // ─═̷─═̷─📋 MINDCRAFT 3D ─═̷─═̷─📋
  mindcraftSelectedMissionId: null as number | null,
  setMindcraftSelectedMissionId: (id: number | null) => set({ mindcraftSelectedMissionId: id }),

  // ─═̷─═̷─💻 3D AGENT WINDOWS ─═̷─═̷─💻
  placedAgentWindows: [],
  placedAgentAvatars: [],
  liveAgentAvatarAudio: {},
  agentActivity: {},
  focusedAgentWindowId: null,
  focusedImageId: null,
  _preFocusCameraState: null,

  // ─═̷─═̷─🧑 AVATAR ─═̷─═̷─🧑
  avatar3dUrl: DEFAULT_AGENT_AVATAR_URL, // Default avatar for local mode

  // ─═̷─═̷─🖼️ IMAGINE — text-to-image ─═̷─═̷─🖼️
  generatedImages: JSON.parse(stored('oasis-generated-images') || '[]') as GeneratedImage[],
  customGroundPresets: JSON.parse(stored('oasis-custom-ground') || '[]') as import('../lib/forge/ground-textures').GroundPreset[],

  // ─═̷─═̷─👁️ VIEW MODE ─═̷─═̷─👁️
  isViewMode: false,
  viewingWorldMeta: null,
  isViewModeEditable: false,
  viewingWorldId: null,

  // ─═̷─═̷─⏪ UNDO/REDO STATE ─═̷─═̷─⏪
  undoStack: [],
  redoStack: [],
  _undoBatch: null,
  _isUndoRedoing: false,

  // ─═̷─═̷─⚙️ SETTINGS ACTIONS ─═̷─═̷─⚙️
  setFpsCounterEnabled: (fpsCounterEnabled) => set({ fpsCounterEnabled }),
  setFpsCounterFontSize: (fpsCounterFontSize) => set({ fpsCounterFontSize }),
  setStreamOpacity: (streamOpacity) => set({ streamOpacity: Math.max(0.1, Math.min(1, streamOpacity)) }),
  setCraftModel: (craftModel) => {
    persist('oasis-craft-model', craftModel)
    set({ craftModel })
  },
  setVoiceModel: (voiceModel) => {
    persist('oasis-voice-model', voiceModel)
    set({ voiceModel })
  },

  // ─═̷─═̷─🔥 REALM ACTIONS ─═̷─═̷─🔥
  setActiveRealm: (activeRealm) => {
    persist('oasis-realm', activeRealm)
    set({ activeRealm })
  },
  setConjuredAssets: (conjuredAssets) => set({ conjuredAssets }),
  addConjuredAsset: (asset) => set((state) => ({ conjuredAssets: [...state.conjuredAssets, asset] })),
  updateConjuredAsset: (id, updates) => set((state) => ({
    conjuredAssets: state.conjuredAssets.map(a => a.id === id ? { ...a, ...updates } : a),
  })),
  removeConjuredAsset: (id) => set((state) => ({
    conjuredAssets: state.conjuredAssets.filter(a => a.id !== id),
  })),
  placeConjuredAssetInWorld: (assetId) => {
    withUndo('Place conjured', '✨', () => {
      set((state) => ({
        worldConjuredAssetIds: state.worldConjuredAssetIds.includes(assetId)
          ? state.worldConjuredAssetIds
          : [...state.worldConjuredAssetIds, assetId],
      }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  setAgentAvatarTransform: (id, transform) => {
    set((state) => {
      const avatarIndex = state.placedAgentAvatars.findIndex(avatar => avatar.id === id)
      if (avatarIndex < 0) return state

      const nextTransforms = { ...state.transforms }
      delete nextTransforms[id]

      const folded = foldTransformIntoAgentAvatar(state.placedAgentAvatars[avatarIndex], transform)
      const nextAvatars = [...state.placedAgentAvatars]
      nextAvatars[avatarIndex] = folded.avatar

      return {
        placedAgentAvatars: nextAvatars,
        transforms: nextTransforms,
      }
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeConjuredAssetFromWorld: (assetId) => {
    withUndo('Remove conjured', '🗑️', () => {
      set((state) => ({
        worldConjuredAssetIds: state.worldConjuredAssetIds.filter(id => id !== assetId),
      }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  addCraftedScene: (scene) => {
    // ░▒▓ Spawn at the position already set on the scene (derived from avatar forward) ▓▒░
    withUndo('Add crafted', '🔮', () => {
      set((state) => ({ craftedScenes: [...state.craftedScenes, scene] }))
    })
    // Persist to library — survives deletion from world
    addToSceneLibrary(scene).then(() =>
      getSceneLibrary().then(lib => set({ sceneLibrary: lib }))
    )
    // ░▒▓ Spell VFX on materialization ▓▒░
    get().spawnPlacementVfx(scene.position)
    // Auto-save world on scene add
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeCraftedScene: (id) => {
    withUndo('Remove crafted', '🗑️', () => {
      set((state) => ({
        craftedScenes: state.craftedScenes.filter(s => s.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  updateCraftedScene: (id, updates) => set((state) => ({
    craftedScenes: state.craftedScenes.map(s => s.id === id ? { ...s, ...updates } : s),
  })),
  setConjureVfxType: (conjureVfxType) => {
    persist('oasis-vfx', conjureVfxType)
    set({ conjureVfxType })
  },

  // ─═̷─═̷─📦 CATALOG ASSET ACTIONS ─═̷─═̷─📦
  placeCatalogAsset: (catalogId, name, path, defaultScale) => {
    withUndo(`Place ${name}`, '📦', () => {
      const id = `catalog-${catalogId}-${Date.now()}`
      const placement: CatalogPlacement = {
        id,
        catalogId,
        name,
        glbPath: path,
        position: [(Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8],
        scale: defaultScale,
      }
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
      }))
    })
    setTimeout(() => get().saveWorldState(), 100)
    // XP for placing objects
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
  },
  removeCatalogAsset: (id) => {
    const asset = get().placedCatalogAssets.find(a => a.id === id)
    withUndo(`Delete ${asset?.name || 'object'}`, '🗑️', () => {
      set(state => ({
        placedCatalogAssets: state.placedCatalogAssets.filter(a => a.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },

  // ─═̷─═̷─📚 SCENE LIBRARY ACTIONS ─═̷─═̷─📚
  refreshSceneLibrary: () => {
    getSceneLibrary().then(lib => set({ sceneLibrary: lib }))
  },
  placeLibraryScene: (sceneId) => {
    const library = get().sceneLibrary
    const scene = library.find(s => s.id === sceneId)
    if (!scene) return
    withUndo('Place scene', '🎭', () => {
      const clone: CraftedScene = {
        ...scene,
        id: `${scene.id}-${Date.now()}`,
        position: [(Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6],
      }
      set((state) => ({ craftedScenes: [...state.craftedScenes, clone] }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  deleteFromLibrary: (sceneId) => {
    removeFromSceneLibrary(sceneId).then(() =>
      getSceneLibrary().then(lib => set({ sceneLibrary: lib }))
    )
  },

  // ─═̷─═̷─🪄 PLACEMENT + VFX ACTIONS ─═̷─═̷─🪄
  // ░▒▓ The ritual of placing objects into the world ▓▒░
  enterPlacementMode: (pending) => {
    // ░▒▓ Preload GLB while user picks a spot — kills Suspense flash ▓▒░
    if (pending.path && pending.type !== 'image') {
      import('@react-three/drei').then(drei => drei.useGLTF.preload(pending.path!))
    }
    set({ placementPending: pending })
    // ░▒▓ FIX: Clear ALL UI layers before transitioning — can't be in a panel AND placing objects.
    // This ensures _uiLayerStack is empty so pointer lock isn't blocked on placement exit. ▓▒░
    try {
      const im = require('../lib/input-manager').useInputManager.getState()
      const stack = [...im._uiLayerStack]
      for (const id of stack) im.popUILayer(id)
      im.transition('placement')
    } catch {}
  },
  cancelPlacement: () => {
    set({ placementPending: null })
    try { require('../lib/input-manager').useInputManager.getState().returnToPrevious() } catch {}
  },

  placeCatalogAssetAt: (catalogId, name, path, defaultScale, position) => {
    let placedId = ''
    withUndo(`Place ${name}`, '📦', () => {
      placedId = `catalog-${catalogId}-${Date.now()}`
      const placement: CatalogPlacement = { id: placedId, catalogId, name, glbPath: path, position, scale: defaultScale }
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
        placementPending: null,
      }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
    return placedId
  },

  placeImageAt: (name, imageUrl, position, frameStyle) => {
    withUndo(`Place ${name}`, '🖼️', () => {
      const id = `image-${Date.now()}`
      const placement: CatalogPlacement = { id, catalogId: 'generated-image', name, glbPath: '', position, scale: 1, imageUrl, ...(frameStyle && { imageFrameStyle: frameStyle }) }
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
        placementPending: null,
      }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
  },

  placeVideoAt: (name: string, videoUrl: string, position: [number, number, number]) => {
    withUndo(`Place video ${name}`, '🎬', () => {
      const id = `video-${Date.now()}`
      const placement: CatalogPlacement = { id, catalogId: 'video', name, glbPath: '', position, scale: 2, videoUrl }
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
        placementPending: null,
      }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
  },

  updateCatalogPlacement: (id, updates) => {
    set(state => ({
      placedCatalogAssets: state.placedCatalogAssets.map(ca =>
        ca.id === id ? { ...ca, ...updates } : ca
      ),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },

  placeLibrarySceneAt: (sceneId, position) => {
    const library = get().sceneLibrary
    const scene = library.find(s => s.id === sceneId)
    if (!scene) return
    withUndo('Place scene', '🎭', () => {
      const clone: CraftedScene = { ...scene, id: `${scene.id}-${Date.now()}`, position }
      set(state => ({
        craftedScenes: [...state.craftedScenes, clone],
        placementPending: null,
      }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
  },

  setPlacementVfxType: (type) => {
    persist('oasis-placement-vfx', type)
    set({ placementVfxType: type })
  },

  setPlacementVfxDuration: (duration) => {
    const clamped = Math.max(0.5, Math.min(4.5, duration))
    persist('oasis-placement-duration', String(clamped))
    set({ placementVfxDuration: clamped })
  },

  spawnPlacementVfx: (position) => {
    const { placementVfxType, placementVfxDuration } = get()
    const resolvedType = placementVfxType === 'random'
      ? PLACEMENT_VFX_LIST[Math.floor(Math.random() * PLACEMENT_VFX_LIST.length)]
      : placementVfxType
    const vfx: ActivePlacementVfx = {
      id: `vfx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position,
      type: resolvedType,
      startedAt: performance.now(),
      duration: placementVfxDuration,
    }
    set(state => ({ activePlacementVfx: [...state.activePlacementVfx, vfx] }))
    // Play placement sound
    try { require('../lib/audio-manager').useAudioManager.getState().play('place') } catch {}
  },

  removePlacementVfx: (id) => {
    set(state => ({ activePlacementVfx: state.activePlacementVfx.filter(v => v.id !== id) }))
  },

  startAgentMaterialization: (objectId) => {
    if (!objectId) return
    const now = Date.now()
    set(state => ({
      agentMaterializations: {
        ...state.agentMaterializations,
        [objectId]: {
          objectId,
          phase: 'pending',
          minScale: 0.25,
          startedAt: now,
          revealStartedAt: null,
          revealDurationMs: 1500,
        },
      },
    }))
  },

  revealAgentMaterialization: (objectId) => {
    if (!objectId) return
    set(state => {
      const current = state.agentMaterializations[objectId]
      if (!current || current.phase === 'revealing') return state
      return {
        agentMaterializations: {
          ...state.agentMaterializations,
          [objectId]: {
            ...current,
            phase: 'revealing',
            revealStartedAt: Date.now(),
          },
        },
      }
    })
  },

  clearAgentMaterialization: (objectId) => {
    if (!objectId) return
    set(state => {
      if (!state.agentMaterializations[objectId]) return state
      const { [objectId]: _removed, ...rest } = state.agentMaterializations
      return { agentMaterializations: rest }
    })
  },

  spawnMarchOrderVfx: (position) => {
    const vfx: ActiveMarchOrderVfx = {
      id: `march-order-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position,
      startedAt: performance.now(),
      duration: 2.05,
    }
    set(state => ({
      activeMarchOrderVfx: [
        ...state.activeMarchOrderVfx.slice(-(MAX_ACTIVE_MARCH_ORDER_VFX - 1)),
        vfx,
      ],
    }))
  },
  removeMarchOrderVfx: (id) => {
    set(state => ({ activeMarchOrderVfx: state.activeMarchOrderVfx.filter(v => v.id !== id) }))
  },

  // ─═̷─═̷─👁 SPELL PREVIEW — see the magic before you commit ─═̷─═̷─👁
  previewPlacementSpell: (type) => {
    const { placementVfxDuration } = get()
    const resolvedType = type === 'random'
      ? PLACEMENT_VFX_LIST[Math.floor(Math.random() * PLACEMENT_VFX_LIST.length)]
      : type
    const vfx: ActivePlacementVfx = {
      id: `preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: [0, 0, 0],
      type: resolvedType,
      startedAt: performance.now(),
      duration: placementVfxDuration,
    }
    set(state => ({ activePlacementVfx: [...state.activePlacementVfx, vfx] }))
  },
  startConjurePreview: (type) => {
    set({ conjurePreview: { type, startedAt: Date.now() } })
  },
  clearConjurePreview: () => {
    set({ conjurePreview: null })
  },
  setCraftingState: (inProgress, prompt = null) => {
    set({ craftingInProgress: inProgress, craftingPrompt: inProgress ? (prompt ?? null) : null })
  },

  // ─═̷─═̷─🌍 TERRAIN + WORLD ACTIONS ─═̷─═̷─🌍
  setTerrainParams: (terrainParams) => {
    withUndo('Terrain', '🏔️', () => set({ terrainParams }))
    setTimeout(() => get().saveWorldState(), 100)
  },
  setTerrainLoading: (terrainLoading) => set({ terrainLoading }),
  setGroundPreset: (groundPresetId) => {
    set({ groundPresetId })
    setTimeout(() => get().saveWorldState(), 100)
  },
  // ─═̷─═̷─🎨 PAINT MODE — tile-by-tile ground painting ─═̷─═̷─🎨
  enterPaintMode: (presetId) => {
    set({ paintMode: true, paintBrushPresetId: presetId, placementPending: null })
    try { require('../lib/input-manager').useInputManager.getState().transition('paint') } catch {}
  },
  exitPaintMode: () => {
    set({ paintMode: false, paintBrushPresetId: null })
    try { require('../lib/input-manager').useInputManager.getState().returnToPrevious() } catch {}
  },
  setPaintBrushSize: (size) => {
    set({ paintBrushSize: Math.max(1, Math.min(5, size)) })
  },
  paintGroundArea: (cx, cz) => {
    const { paintBrushPresetId, paintBrushSize, groundTiles } = get()
    if (!paintBrushPresetId) return
    const half = Math.floor(paintBrushSize / 2)
    const newTiles = { ...groundTiles }
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const tx = Math.floor(cx) + dx
        const tz = Math.floor(cz) + dz
        // Clamp to world bounds: -50 to +49
        if (tx < -50 || tx > 49 || tz < -50 || tz > 49) continue
        newTiles[`${tx},${tz}`] = paintBrushPresetId
      }
    }
    set({ groundTiles: newTiles })
    get().saveWorldState()
  },
  eraseGroundTile: (x, z) => {
    const { groundTiles } = get()
    const key = `${Math.floor(x)},${Math.floor(z)}`
    if (!(key in groundTiles)) return
    const newTiles = { ...groundTiles }
    delete newTiles[key]
    set({ groundTiles: newTiles })
    get().saveWorldState()
  },
  clearAllGroundTiles: () => {
    withUndo('Clear all tiles', '🧹', () => {
      set({ groundTiles: {} })
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  // ─═̷─═̷─🖼️ IMAGINE ACTIONS ─═̷─═̷─🖼️
  addGeneratedImage: (image) => {
    set(s => {
      const next = [...s.generatedImages, image]
      persist('oasis-generated-images', JSON.stringify(next))
      return { generatedImages: next }
    })
  },
  removeGeneratedImage: (id) => {
    set(s => {
      const next = s.generatedImages.filter(i => i.id !== id)
      persist('oasis-generated-images', JSON.stringify(next))
      return { generatedImages: next }
    })
  },
  addCustomGroundPreset: (preset) => {
    set(s => {
      // Don't add duplicates
      if (s.customGroundPresets.some(p => p.id === preset.id)) return s
      const next = [...s.customGroundPresets, preset]
      persist('oasis-custom-ground', JSON.stringify(next))
      return { customGroundPresets: next }
    })
  },
  removeCustomGroundPreset: (id) => {
    set(s => {
      const next = s.customGroundPresets.filter(p => p.id !== id)
      persist('oasis-custom-ground', JSON.stringify(next))
      return { customGroundPresets: next }
    })
  },

  selectObject: (selectedObjectId) => set({ selectedObjectId }),
  setInspectedObject: (inspectedObjectId) => set({ inspectedObjectId }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setCameraLookAt: (cameraLookAt) => set({ cameraLookAt }),
  setObjectBehavior: (id, partial) => {
    // Only push undo for meaningful changes (not ephemeral moveTarget/moveSpeed)
    const isUndoable = partial.movement || partial.animation || partial.visible !== undefined || partial.label !== undefined
    if (isUndoable) {
      withUndo('Change behavior', '⚙️', () => {
        set((state) => {
          const existing = state.behaviors[id] || { movement: { type: 'static' as const }, visible: true }
          return { behaviors: { ...state.behaviors, [id]: { ...existing, ...partial } } }
        })
      })
    } else {
      set((state) => {
        const existing = state.behaviors[id] || { movement: { type: 'static' as const }, visible: true }
        return { behaviors: { ...state.behaviors, [id]: { ...existing, ...partial } } }
      })
    }
    setTimeout(() => get().saveWorldState(), 100)
  },
  setObjectMeshStats: (id, stats) => {
    set((state) => ({ objectMeshStats: { ...state.objectMeshStats, [id]: stats } }))
  },
  setMoveTarget: (id, target) => {
    set((state) => {
      const existing = state.behaviors[id] || { movement: { type: 'static' as const }, visible: true }
      return {
        behaviors: { ...state.behaviors, [id]: { ...existing, moveTarget: target, moveSpeed: existing.moveSpeed || 3 } },
      }
    })
  },
  clearMoveTarget: (id) => {
    set((state) => {
      const existing = state.behaviors[id]
      if (!existing) return state
      const { moveTarget: _moveTarget, ...rest } = existing
      return {
        behaviors: { ...state.behaviors, [id]: rest as ObjectBehavior },
      }
    })
    // Final position is synced by the caller after arrival.
    setTimeout(() => get().saveWorldState(), 100)
  },
  setObjectTransform: (id, transform) => {
    if (get().placedAgentAvatars.some(avatar => avatar.id === id)) {
      get().setAgentAvatarTransform(id, transform)
      return
    }

    set((state) => ({
      transforms: { ...state.transforms, [id]: transform },
    }))
    // Use the canonical saveWorldState — never assemble payload manually
    setTimeout(() => get().saveWorldState(), 100)
  },
  // ─═̷─═̷─🌅 SKY — per-world sky preset ─═̷─═̷─🌅
  setWorldSkyBackground: (id) => {
    set({ worldSkyBackground: id })
    setTimeout(() => get().saveWorldState(), 100)
  },
  // ─═̷─═̷─💡 LIGHT CRUD — placeable light sources, per-world ─═̷─═̷─💡
  addWorldLight: (type) => {
    // Only allow one environment light per world
    if (type === 'environment' && get().worldLights.some(l => l.type === 'environment')) return
    // Point + spot are spatial lights — let the user pick the spot with a
    // click, same UX as placing a catalog asset (oasisspec3 request).
    if (type === 'point' || type === 'spot') {
      get().enterPlacementMode({ type: 'light', name: `${type} light`, lightType: type })
      return
    }
    withUndo(`Add ${type} light`, '💡', () => {
      const light: WorldLight = {
        id: `light-${type}-${Date.now()}`,
        type,
        color: type === 'hemisphere' ? '#87CEEB' : type === 'ambient' ? '#B0C4DE' : type === 'environment' ? '#ffffff' : '#FFF5E6',
        intensity: type === 'ambient' ? 0.4 : type === 'hemisphere' ? 0.3 : type === 'directional' ? 1.2 : 1.0,
        position: type === 'directional' ? [30, 40, 20] : [0, 5, 0],
        ...(type === 'hemisphere' ? { groundColor: '#3a5f0b' } : {}),
        visible: true,
      }
      set(s => ({ worldLights: [...s.worldLights, light] }))
    })
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('ADD_LIGHT', get().activeWorldId)
  },
  placeLightAt: (type, position) => {
    withUndo(`Place ${type} light`, '💡', () => {
      const light: WorldLight = {
        id: `light-${type}-${Date.now()}`,
        type,
        color: '#FFF5E6',
        intensity: 100,
        position,
        ...(type === 'spot' ? { angle: 45, target: [position[0], 0, position[2]] } : {}),
        visible: true,
      }
      set(s => ({ worldLights: [...s.worldLights, light], placementPending: null }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('ADD_LIGHT', get().activeWorldId)
  },
  removeWorldLight: (id) => {
    withUndo('Remove light', '🗑️', () => {
      set(s => ({ worldLights: s.worldLights.filter(l => l.id !== id) }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  updateWorldLight: (id, updates) => {
    set(s => ({
      worldLights: s.worldLights.map(l => l.id === id ? { ...l, ...updates } : l),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },
  setWorldLightTransform: (id, position) => {
    set(s => ({
      worldLights: s.worldLights.map(l => l.id === id ? { ...l, position } : l),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },

  loadWorldState: (options: { silent?: boolean; remote?: boolean } = {}) => {
    if (get().isViewMode) return // don't overwrite viewed world with user's own data
    const keepWorldReady = options.silent === true && get()._worldReady
    const markRemote = options.remote === true

    // ░▒▓ CRITICAL: Cancel any pending saves BEFORE loading ▓▒░
    // Without this, a debounced save of stale/empty state can fire AFTER
    // the load starts, overwriting the world we're about to read.
    cancelPendingSave()
    set({
      ...(keepWorldReady ? {} : { _worldReady: false }),
      ...(markRemote ? { _isReceivingRemoteUpdate: true } : {}),
    }) // Block saves until load completes unless this is a silent remote refresh

    // Helper: seed default lights with proper IDs (for fresh/old worlds)
    const seedDefaultLights = (): WorldLight[] =>
      DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))

    loadWorld().then(world => {
      if (get().isViewMode) return // check again after async — view mode may have been entered during fetch
      if (!world) {
        set({
          _worldReady: true,
          _isReceivingRemoteUpdate: false,
          _loadedObjectCount: 0,
          terrainParams: null,
          groundPresetId: 'none',
          groundTiles: {},
          craftedScenes: [],
          worldConjuredAssetIds: [],
          placedCatalogAssets: [],
          transforms: {},
          behaviors: {},
          worldLights: seedDefaultLights(),
          worldSkyBackground: 'night007',
          placedAgentWindows: [],
          placedAgentAvatars: [],
          liveAgentAvatarAudio: {},
        })
        console.log('[World] No data — initialized empty world')
        return
      }
      // If lights field is undefined (old world never had lights) → seed with defaults
      // If lights is an array (even empty = user chose darkness) → respect it
      const lights = world.lights !== undefined ? world.lights : seedDefaultLights()
      // Merge world's custom ground presets into user's collection (no duplicates)
      const existingCustomIds = new Set(get().customGroundPresets.map(p => p.id))
      const newCustom = (world.customGroundPresets || []).filter((p: import('../lib/forge/ground-textures').GroundPreset) => !existingCustomIds.has(p.id))
      const mergedCustom = [...get().customGroundPresets, ...newCustom]
      if (newCustom.length > 0) persist('oasis-custom-ground', JSON.stringify(mergedCustom))
      const loadedObjCount = (world.conjuredAssetIds?.length || 0) + (world.catalogPlacements?.length || 0) + (world.craftedScenes?.length || 0)
      const sanitizedAgentAvatars = sanitizeAgentAvatarList(world.agentAvatars || [])
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: world.agentWindows || [],
        avatars: sanitizedAgentAvatars.entries,
        transforms: world.transforms || {},
      })
      set({
        _worldReady: true,
        _isReceivingRemoteUpdate: false,
        _loadedObjectCount: loadedObjCount,
        terrainParams: world.terrain || null,
        groundPresetId: world.groundPresetId || 'none',
        groundTiles: world.groundTiles || {},
        craftedScenes: world.craftedScenes || [],
        worldConjuredAssetIds: world.conjuredAssetIds || [],
        placedCatalogAssets: world.catalogPlacements || [],
        transforms: normalizedAgentWorldState.transforms,
        behaviors: world.behaviors || {},
        worldLights: lights,
        worldSkyBackground: world.skyBackgroundId || 'night007',
        customGroundPresets: mergedCustom,
        placedAgentWindows: normalizedAgentWorldState.windows,
        placedAgentAvatars: normalizedAgentWorldState.avatars,
        liveAgentAvatarAudio: {},
      })
      if ((sanitizedAgentAvatars.changed || normalizedAgentWorldState.changed) && !get().isViewMode) {
        console.warn('[World] Repaired invalid agent avatar URLs while loading the active world.')
        void saveWorld({
          terrain: world.terrain || null,
          groundPresetId: world.groundPresetId || 'none',
          groundTiles: world.groundTiles || {},
          craftedScenes: world.craftedScenes || [],
          conjuredAssetIds: world.conjuredAssetIds || [],
          catalogPlacements: world.catalogPlacements || [],
          transforms: normalizedAgentWorldState.transforms,
          behaviors: world.behaviors || {},
          lights,
          skyBackgroundId: world.skyBackgroundId || 'night007',
          ...(Array.isArray(world.customGroundPresets) && world.customGroundPresets.length > 0 ? { customGroundPresets: world.customGroundPresets } : {}),
          agentWindows: normalizedAgentWorldState.windows,
          agentAvatars: normalizedAgentWorldState.avatars,
        }, get().activeWorldId)
      }
      console.log('[World] Loaded:', world.savedAt, '| objects:', loadedObjCount, '| preset:', world.groundPresetId || 'none', '| tiles:', Object.keys(world.groundTiles || {}).length, '| catalog:', world.catalogPlacements?.length || 0, '| lights:', lights.length, '| sky:', world.skyBackgroundId || 'night007', '| agents:', (world.agentWindows || []).length, '| avatars:', sanitizedAgentAvatars.entries.length)
    }).catch(error => {
      console.error('[World] Load failed:', error)
      set({
        _worldReady: true,
        _isReceivingRemoteUpdate: false,
      })
    })

    // World mutation fanout now comes from the shared SSE world-events bus.
    // Scene.tsx mounts useWorldEvents(), so the store no longer opens its own
    // event channel here.
    if (isBrowser) {
      get()._realtimeChannel?.unsubscribe()
      set({ _realtimeChannel: null })
    }
  },
  saveWorldState: () => {
    // Don't save read-only viewed worlds — but DO save public_edit worlds
    if (get().isViewMode && !get().isViewModeEditable) return
    // Skip saves while applying a remote update — prevents echo loop
    if (get()._isReceivingRemoteUpdate) return
    // ░▒▓ CRITICAL GUARD: never save until world has loaded from server ▓▒░
    if (!get()._worldReady) {
      console.warn('[World] ⚠️ Save blocked — world not loaded yet (preventing empty-state overwrite)')
      return
    }
    const { terrainParams, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, transforms, behaviors, worldLights, worldSkyBackground, viewingWorldId, customGroundPresets, placedAgentWindows, placedAgentAvatars, _loadedObjectCount } = get()
    const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
      windows: placedAgentWindows,
      avatars: placedAgentAvatars,
      transforms,
    })
    if (normalizedAgentWorldState.changed) {
      set({
        transforms: normalizedAgentWorldState.transforms,
        placedAgentWindows: normalizedAgentWorldState.windows,
        placedAgentAvatars: normalizedAgentWorldState.avatars,
      })
    }

    // ░▒▓ SANITY CHECK: block saves that would catastrophically reduce object count ▓▒░
    // If we loaded 5+ objects and now have 0, something is wrong (stale tab, empty init, etc.)
    const currentObjCount = (worldConjuredAssetIds?.length || 0) + (placedCatalogAssets?.length || 0) + (craftedScenes?.length || 0)
    if (_loadedObjectCount >= 5 && currentObjCount === 0) {
      console.error(`[World] 🚨 NUKE BLOCKED — loaded ${_loadedObjectCount} objects but trying to save 0. This is the anorak2 protection.`)
      return
    }

    // Only include customGroundPresets in save if any tiles reference them
    const usedCustomIds = new Set(Object.values(groundTiles).filter(id => id.startsWith('custom_')))
    const relevantCustom = customGroundPresets.filter(p => usedCustomIds.has(p.id))
    const worldState = {
      terrain: terrainParams,
      groundPresetId,
      groundTiles,
      craftedScenes,
      conjuredAssetIds: worldConjuredAssetIds,
      catalogPlacements: placedCatalogAssets,
      transforms: normalizedAgentWorldState.transforms,
      behaviors,
      lights: worldLights,
      skyBackgroundId: worldSkyBackground,
      ...(relevantCustom.length > 0 && { customGroundPresets: relevantCustom }),
      agentWindows: normalizedAgentWorldState.windows,
      agentAvatars: normalizedAgentWorldState.avatars,
    }
    // If editing a public_edit world, save to THAT world (not user's own)
    if (get().isViewModeEditable && viewingWorldId) {
      saveWorld(worldState, viewingWorldId) // direct save to viewed world
    } else {
      debouncedSaveWorld(worldState)
    }
  },

  // ─═̷─═̷─🌍 MULTI-WORLD ACTIONS ─═̷─═̷─🌍
  switchWorld: (worldId) => {
    // Exit view mode if active — user clicked one of their own worlds
    if (get().isViewMode) {
      set({ isViewMode: false, isViewModeEditable: false, viewingWorldId: null, viewingWorldMeta: null })
    }
    // ░▒▓ RACE CONDITION FIX — kill any pending debounced saves from the OLD world ▓▒░
    // Without this, a stale save timer can fire AFTER the new world loads,
    // overwriting the new world's lights/sky with the old world's stale state.
    cancelPendingSave()
    // Tear down Realtime subscription for the old world
    get()._realtimeChannel?.unsubscribe()
    set({ _realtimeChannel: null })
    // Save current world first (immediate, not debounced) — but ONLY if world was loaded
    if (get()._worldReady) {
      const { terrainParams, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, transforms, behaviors, worldLights, worldSkyBackground, activeWorldId, placedAgentAvatars, placedAgentWindows } = get()
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: placedAgentWindows,
        avatars: placedAgentAvatars,
        transforms,
      })
      // ░▒▓ Filter out in-progress craft placeholders — objects.length === 0 means
      // the LLM hasn't materialized anything yet. Using objects.length (not name)
      // because the scene name gets updated mid-stream before objects arrive.
      const completedScenes = craftedScenes.filter(s => s.objects.length > 0)
      saveWorld({ terrain: terrainParams, groundPresetId, groundTiles, craftedScenes: completedScenes, conjuredAssetIds: worldConjuredAssetIds, catalogPlacements: placedCatalogAssets, transforms: normalizedAgentWorldState.transforms, behaviors, lights: worldLights, skyBackgroundId: worldSkyBackground, agentWindows: normalizedAgentWorldState.windows, agentAvatars: normalizedAgentWorldState.avatars }, activeWorldId)
    }

    // ░▒▓ Block saves during transition — prevents empty state nuke ▓▒░
    set({ _worldReady: false })

    // Switch to new world
    setActiveWorldId(worldId)
    loadWorld(worldId).then(world => {
      // Seed defaults for old worlds that never had lights (lights field undefined)
      const defaultLights: WorldLight[] = DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))
      const lights = world?.lights !== undefined ? (world?.lights || []) : defaultLights
      const switchObjCount = (world?.conjuredAssetIds?.length || 0) + (world?.catalogPlacements?.length || 0) + (world?.craftedScenes?.length || 0)
      const sanitizedAgentAvatars = sanitizeAgentAvatarList(world?.agentAvatars || [])
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: world?.agentWindows || [],
        avatars: sanitizedAgentAvatars.entries,
        transforms: world?.transforms || {},
      })

      set({
        _worldReady: true,
        _loadedObjectCount: switchObjCount,
        activeWorldId: worldId,
        terrainParams: world?.terrain || null,
        groundPresetId: world?.groundPresetId || 'none',
        groundTiles: world?.groundTiles || {},
        craftedScenes: world?.craftedScenes || [],
        worldConjuredAssetIds: world?.conjuredAssetIds || [],
        placedCatalogAssets: world?.catalogPlacements || [],
        transforms: normalizedAgentWorldState.transforms,
        behaviors: world?.behaviors || {},
        worldLights: lights,
        worldSkyBackground: world?.skyBackgroundId || 'night007',
        placedAgentWindows: normalizedAgentWorldState.windows,
        placedAgentAvatars: normalizedAgentWorldState.avatars,
        liveAgentAvatarAudio: {},
        selectedObjectId: null,
        inspectedObjectId: null,
        paintMode: false,
        paintBrushPresetId: null,
        activeRealm: 'forge' as RealmId,
        // Clear undo/redo — snapshots are world-scoped, can't leak across worlds
        undoStack: [],
        redoStack: [],
        _undoBatch: null,
      })
      persist('oasis-realm', 'forge')
      console.log(`[World] Switched to: ${worldId}`, world ? `(terrain: ${!!world.terrain}, scenes: ${world.craftedScenes?.length || 0}, assets: ${world.conjuredAssetIds?.length || 0}, catalog: ${world.catalogPlacements?.length || 0}, sky: ${world.skyBackgroundId || 'night007'})` : '(empty)')

      if (world && (sanitizedAgentAvatars.changed || normalizedAgentWorldState.changed)) {
        void saveWorld({
          terrain: world.terrain || null,
          groundPresetId: world.groundPresetId || 'none',
          groundTiles: world.groundTiles || {},
          craftedScenes: world.craftedScenes || [],
          conjuredAssetIds: world.conjuredAssetIds || [],
          catalogPlacements: world.catalogPlacements || [],
          transforms: normalizedAgentWorldState.transforms,
          behaviors: world.behaviors || {},
          lights,
          skyBackgroundId: world.skyBackgroundId || 'night007',
          ...(Array.isArray(world.customGroundPresets) && world.customGroundPresets.length > 0 ? { customGroundPresets: world.customGroundPresets } : {}),
          agentWindows: normalizedAgentWorldState.windows,
          agentAvatars: normalizedAgentWorldState.avatars,
        }, worldId)
      }

      // Shared SSE world-events fanout handles remote tool updates.
      if (isBrowser) {
        set({ _realtimeChannel: null })
      }
    })
  },

  createNewWorld: (name, icon = '🌍') => {
    // Save current world first — only if world was loaded (prevent empty-state nuke)
    cancelPendingSave()
    if (get()._worldReady) {
      const { terrainParams, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, transforms, behaviors, worldLights, worldSkyBackground, activeWorldId, placedAgentAvatars, placedAgentWindows } = get()
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: placedAgentWindows,
        avatars: placedAgentAvatars,
        transforms,
      })
      saveWorld({ terrain: terrainParams, groundPresetId, groundTiles, craftedScenes, conjuredAssetIds: worldConjuredAssetIds, catalogPlacements: placedCatalogAssets, transforms: normalizedAgentWorldState.transforms, behaviors, lights: worldLights, skyBackgroundId: worldSkyBackground, agentWindows: normalizedAgentWorldState.windows, agentAvatars: normalizedAgentWorldState.avatars }, activeWorldId)
    }

    // Create and switch to new world (async) — seed with default lights so it's not pitch black
    createWorld(name, icon).then(meta => {
      const defaultLights: WorldLight[] = DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))
      setActiveWorldId(meta.id)
      return getWorldRegistry().then(registry => {
        set({
          _worldReady: true,  // New world is "loaded" — it's empty by definition
          _loadedObjectCount: 0,
          activeWorldId: meta.id,
          worldRegistry: registry,
          terrainParams: null,
          groundPresetId: 'none',
          groundTiles: {},
          craftedScenes: [],
          worldConjuredAssetIds: [],
          placedCatalogAssets: [],
          placedAgentWindows: [],
          placedAgentAvatars: [],
          liveAgentAvatarAudio: {},
          transforms: {},
          behaviors: {},
          worldLights: defaultLights,
          worldSkyBackground: 'night007',
          selectedObjectId: null,
          paintMode: false,
          paintBrushPresetId: null,
          activeRealm: 'forge' as RealmId,
          // Fresh world = fresh undo history
          undoStack: [],
          redoStack: [],
          _undoBatch: null,
        })
        persist('oasis-realm', 'forge')
        console.log(`[World] Created new world: "${name}" (${meta.id})`)
      })
    })
    return '' // id available async via worldRegistry
  },

  deleteWorldById: (worldId) => {
    const { activeWorldId } = get()
    deleteWorld(worldId).then(() =>
      getWorldRegistry().then(registry => {
        set({ worldRegistry: registry })
        if (worldId === activeWorldId && registry.length > 0) {
          get().switchWorld(registry[0].id)
        }
      })
    )
  },

  refreshWorldRegistry: () => {
    getWorldRegistry().then(registry => set({ worldRegistry: registry }))
  },

  exportCurrentWorld: async () => {
    return exportWorld(get().activeWorldId)
  },

  importWorldFromJson: async (json) => {
    const meta = await importWorld(json)
    if (!meta) return null
    const registry = await getWorldRegistry()
    set({ worldRegistry: registry })
    get().switchWorld(meta.id)
    return meta.id
  },

  // ─═̷─═̷─ॐ─═̷─═̷─ INIT — hydrate from server on mount ─═̷─═̷─ॐ─═̷─═̷─
  initWorlds: async () => {
    const [registry, library] = await Promise.all([
      getWorldRegistry(),
      getSceneLibrary(),
    ])

    // If stored activeWorldId doesn't exist in the registry (e.g. old 'forge-default'
    // from an earlier persistence layout), switch to the first available world
    const currentId = get().activeWorldId
    const worldExists = registry.some(w => w.id === currentId)
    if (!worldExists && registry.length > 0) {
      const firstWorld = registry[0]
      setActiveWorldId(firstWorld.id)
      set({ worldRegistry: registry, sceneLibrary: library, activeWorldId: firstWorld.id })
    } else {
      set({ worldRegistry: registry, sceneLibrary: library })
    }

    // Load active world state
    get().loadWorldState()
  },

  setAvatar3dUrl: (url) => set({ avatar3dUrl: url }),

  // ─═̷─═̷─🪟 PANEL Z-ORDERING ─═̷─═̷─🪟
  _panelZCounter: 0,
  _panelZMap: {},
  bringPanelToFront: (panelName) => {
    const next = get()._panelZCounter + 1
    set({ _panelZCounter: next, _panelZMap: { ...get()._panelZMap, [panelName]: next } })
  },
  getPanelZIndex: (panelName, defaultZ) => {
    const order = get()._panelZMap[panelName]
    if (!order) return defaultZ
    // Base z = 9990, each click adds 1. Max panels ~10, so z-range 9990-10000.
    return 9990 + order
  },

  // ─═̷─═̷─💻 3D AGENT WINDOWS — place, focus, interact ─═̷─═̷─💻
  addAgentWindow: (window) => {
    set(state => {
      const sharedAvatar = isSharedAgentAvatarType(window.agentType)
        ? state.placedAgentAvatars.find(entry => entry.agentType === window.agentType) || null
        : null
      return ({
      placedAgentWindows: [
        ...state.placedAgentWindows,
        {
          ...window,
          linkedAvatarId: window.linkedAvatarId || sharedAvatar?.id,
          renderMode: window.renderMode || DEFAULT_AGENT_WINDOW_RENDER_MODE,
          anchorMode: window.anchorMode || (sharedAvatar ? 'next-to' : 'detached'),
        },
      ],
      placementPending: null,
      })
    })
    exitPlacementIfActive()
    const placedWindow = get().placedAgentWindows.find(entry => entry.id === window.id)
    if (placedWindow && !placedWindow.linkedAvatarId) {
      get().assignAvatarToAgentWindow(placedWindow.id, getDefaultAgentAvatarUrl(placedWindow.agentType))
    }
    get().spawnPlacementVfx(window.position)
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeAgentWindow: (id) => {
    set(state => {
      const linkedAvatarIds = state.placedAgentAvatars
        .filter(entry => entry.linkedWindowId === id)
        .map(entry => entry.id)
      const linkedAvatarIdSet = new Set(linkedAvatarIds)
      const nextTransforms = { ...state.transforms }
      const nextAudio = { ...state.liveAgentAvatarAudio }
      for (const avatarId of linkedAvatarIds) {
        delete nextTransforms[avatarId]
        delete nextAudio[avatarId]
      }
      return {
        placedAgentWindows: state.placedAgentWindows.filter(w => w.id !== id),
        placedAgentAvatars: state.placedAgentAvatars.filter(entry => entry.linkedWindowId !== id),
        liveAgentAvatarAudio: nextAudio,
        transforms: nextTransforms,
        focusedAgentWindowId: state.focusedAgentWindowId === id ? null : state.focusedAgentWindowId,
        selectedObjectId: linkedAvatarIdSet.has(state.selectedObjectId || '') ? null : state.selectedObjectId,
        inspectedObjectId: linkedAvatarIdSet.has(state.inspectedObjectId || '') ? null : state.inspectedObjectId,
      }
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  updateAgentWindow: (id, partial) => {
    set(state => ({
      placedAgentWindows: state.placedAgentWindows.map(w => w.id === id ? { ...w, ...partial } : w),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },
  setAgentWindowAnchorMode: (id, anchorMode) => {
    set(state => {
      const targetWindow = state.placedAgentWindows.find(entry => entry.id === id)
      if (!targetWindow) return state

      let frozenPosition = targetWindow.position
      let frozenRotation = targetWindow.rotation

      if (anchorMode === 'detached' && targetWindow.anchorMode && targetWindow.anchorMode !== 'detached' && targetWindow.linkedAvatarId) {
        const linkedAvatar = state.placedAgentAvatars.find(entry => entry.id === targetWindow.linkedAvatarId)
        if (linkedAvatar) {
          const avatarTransform = state.transforms[linkedAvatar.id]
          const derivedPlacement = deriveAvatarAnchoredWindowPlacement(
            targetWindow,
            linkedAvatar,
            avatarTransform,
            targetWindow.anchorMode,
          )
          frozenPosition = derivedPlacement.position
          frozenRotation = derivedPlacement.rotation
        }
      }

      return {
        placedAgentWindows: state.placedAgentWindows.map(entry =>
          entry.id === id
            ? {
                ...entry,
                anchorMode,
                position: anchorMode === 'detached' ? frozenPosition : entry.position,
                rotation: anchorMode === 'detached' ? frozenRotation : entry.rotation,
              }
            : entry,
        ),
      }
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  assignAvatarToAgentWindow: (windowId, avatarUrl) => {
    const window = get().placedAgentWindows.find(entry => entry.id === windowId)
    if (!window) return null

    if (isSharedAgentAvatarType(window.agentType)) {
      return assignSharedAgentAvatar(window.agentType, avatarUrl, { preferredWindowId: windowId })
    }

    const existingAvatar = get().placedAgentAvatars.find(entry => entry.linkedWindowId === windowId)

    if (!avatarUrl) {
      if (!existingAvatar) return null
      set(state => {
        const nextTransforms = { ...state.transforms }
        const nextAudio = { ...state.liveAgentAvatarAudio }
        delete nextTransforms[existingAvatar.id]
        delete nextAudio[existingAvatar.id]
        return {
          placedAgentWindows: state.placedAgentWindows.map(entry =>
            entry.id === windowId
              ? { ...entry, linkedAvatarId: undefined, anchorMode: 'detached' }
              : entry
          ),
          placedAgentAvatars: state.placedAgentAvatars.filter(entry => entry.id !== existingAvatar.id),
          liveAgentAvatarAudio: nextAudio,
          transforms: nextTransforms,
          selectedObjectId: state.selectedObjectId === existingAvatar.id ? null : state.selectedObjectId,
          inspectedObjectId: state.inspectedObjectId === existingAvatar.id ? null : state.inspectedObjectId,
        }
      })
      setTimeout(() => get().saveWorldState(), 100)
      return null
    }

    const sanitizedAvatarUrl = resolveAgentAvatarUrl(avatarUrl).url
    const windowTransform = get().transforms[windowId]
    const anchor = deriveWindowAvatarAnchor(window, windowTransform)
    const scale = deriveWindowAvatarScale(window, windowTransform)

    if (existingAvatar) {
      set(state => ({
        placedAgentWindows: state.placedAgentWindows.map(entry =>
          entry.id === windowId
            ? {
                ...entry,
                linkedAvatarId: existingAvatar.id,
                anchorMode: entry.anchorMode && entry.anchorMode !== 'detached' ? entry.anchorMode : 'next-to',
              }
            : entry
        ),
        placedAgentAvatars: state.placedAgentAvatars.map(entry =>
          entry.id === existingAvatar.id
            ? {
                ...entry,
                avatar3dUrl: sanitizedAvatarUrl,
                linkedWindowId: windowId,
                label: entry.label || window.label || defaultAgentAvatarLabel(window.agentType),
                position: entry.position || anchor.position,
                rotation: entry.rotation || anchor.rotation,
                scale: entry.scale || scale,
              }
            : entry
        ),
      }))
      setTimeout(() => get().saveWorldState(), 100)
      return existingAvatar.id
    }

    const avatarId = `agent-avatar-${windowId}`
    set(state => ({
      placedAgentWindows: state.placedAgentWindows.map(entry =>
        entry.id === windowId
          ? {
              ...entry,
              linkedAvatarId: avatarId,
              anchorMode: entry.anchorMode && entry.anchorMode !== 'detached' ? entry.anchorMode : 'next-to',
            }
          : entry
      ),
      placedAgentAvatars: [
        ...state.placedAgentAvatars,
        {
          id: avatarId,
          agentType: window.agentType,
          avatar3dUrl: sanitizedAvatarUrl,
          linkedWindowId: windowId,
          position: anchor.position,
          rotation: anchor.rotation,
          scale,
          label: window.label || defaultAgentAvatarLabel(window.agentType),
        },
      ],
    }))
    setTimeout(() => get().saveWorldState(), 100)
    return avatarId
  },
  assignSharedAgentAvatar: (agentType, avatarUrl, options) => {
    return assignSharedAgentAvatar(agentType, avatarUrl, options)
  },
  assignHermesAvatar: (avatarUrl) => {
    return assignSharedAgentAvatar('hermes', avatarUrl)
  },
  assignMerlinAvatar: (avatarUrl) => {
    return assignSharedAgentAvatar('merlin', avatarUrl)
  },
  setAgentAvatarAudio: (avatarId, audio) => {
    set(state => {
      const nextAudio = { ...state.liveAgentAvatarAudio }
      if (!audio) {
        delete nextAudio[avatarId]
      } else {
        nextAudio[avatarId] = audio
      }
      return { liveAgentAvatarAudio: nextAudio }
    })
  },
  startAgentWork: (agentKey, runId, sessionId) => {
    if (!agentKey || !runId) return
    const now = Date.now()
    set(state => ({
      agentActivity: {
        ...state.agentActivity,
        [agentKey]: {
          agentKey,
          runId,
          sessionId,
          state: 'working',
          startedAt: now,
          updatedAt: now,
          confidence: 'explicit',
        },
      },
    }))
  },
  setAgentWorkTool: (agentKey, runId, activeTool) => {
    if (!agentKey || !runId) return
    set(state => {
      const current = state.agentActivity[agentKey]
      if (!current || current.runId !== runId) return state
      return {
        agentActivity: {
          ...state.agentActivity,
          [agentKey]: {
            ...current,
            state: activeTool ? 'tooling' : 'working',
            activeTool: activeTool || undefined,
            updatedAt: Date.now(),
          },
        },
      }
    })
  },
  finishAgentWork: (agentKey, runId) => {
    if (!agentKey || !runId) return
    set(state => {
      const current = state.agentActivity[agentKey]
      if (!current || current.runId !== runId) return state
      return {
        agentActivity: {
          ...state.agentActivity,
          [agentKey]: {
            ...current,
            state: 'idle',
            activeTool: undefined,
            updatedAt: Date.now(),
          },
        },
      }
    })
  },
  failAgentWork: (agentKey, runId) => {
    if (!agentKey || !runId) return
    set(state => {
      const current = state.agentActivity[agentKey]
      if (!current || current.runId !== runId) return state
      return {
        agentActivity: {
          ...state.agentActivity,
          [agentKey]: {
            ...current,
            state: 'error',
            activeTool: undefined,
            updatedAt: Date.now(),
          },
        },
      }
    })
  },
  focusAgentWindow: (id) => {
    if (id) {
      try { require('../lib/input-manager').useInputManager.getState().enterAgentFocus() } catch {}
      set({ focusedAgentWindowId: id, focusedImageId: null })
    } else {
      try {
        const im = require('../lib/input-manager').useInputManager.getState()
        if (im.inputState === 'agent-focus') im.returnToPrevious()
      } catch {}
      set({ focusedAgentWindowId: null })
    }
  },

  // Agent window navigation - mirrors slide ordering for 3D windows.
  navigateAgentWindow: (direction) => {
    const { placedAgentWindows, placedAgentAvatars, transforms, focusedAgentWindowId } = get()
    if (placedAgentWindows.length === 0) return

    const positionForWindow = (window: AgentWindow): [number, number, number] => {
      const windowTransform = transforms[window.id]
      const linkedAvatar = window.linkedAvatarId
        ? placedAgentAvatars.find(entry => entry.id === window.linkedAvatarId) || null
        : placedAgentAvatars.find(entry => entry.linkedWindowId === window.id) || null

      if (linkedAvatar && window.anchorMode && window.anchorMode !== 'detached') {
        return deriveAvatarAnchoredWindowPlacement(
          window,
          linkedAvatar,
          transforms[linkedAvatar.id],
          window.anchorMode,
          windowTransform,
        ).position
      }

      return windowTransform?.position || window.position
    }

    const sorted = [...placedAgentWindows].sort((a, b) => {
      const [ax, ay, az] = positionForWindow(a)
      const [bx, by, bz] = positionForWindow(b)
      if (Math.abs(ax - bx) > 0.5) return ax - bx
      if (Math.abs(az - bz) > 0.5) return az - bz
      if (Math.abs(ay - by) > 0.5) return ay - by
      return a.id.localeCompare(b.id)
    })

    const currentIdx = focusedAgentWindowId
      ? sorted.findIndex(window => window.id === focusedAgentWindowId)
      : -1
    let nextIdx = currentIdx === -1
      ? (direction === 1 ? 0 : sorted.length - 1)
      : currentIdx + direction

    if (nextIdx < 0) nextIdx = sorted.length - 1
    if (nextIdx >= sorted.length) nextIdx = 0

    get().focusAgentWindow(sorted[nextIdx].id)
  },

  // Image focus - camera locks to fill viewport with image.
  focusImage: (id) => {
    if (id) {
      // Reuse agent-focus input state — same UX (ESC to exit, no orbit controls)
      try { require('../lib/input-manager').useInputManager.getState().enterAgentFocus() } catch {}
      set({ focusedImageId: id, focusedAgentWindowId: null })
    } else {
      try {
        const im = require('../lib/input-manager').useInputManager.getState()
        if (im.inputState === 'agent-focus') im.returnToPrevious()
      } catch {}
      set({ focusedImageId: null })
    }
  },

  // ─═̷─═̷─📄 SLIDE NAVIGATION — PgUp/PgDown cycles through images by X position ─═̷─═̷─📄
  navigateSlide: (direction) => {
    const { placedCatalogAssets, transforms, focusedImageId } = get()
    // Collect all image + video placements (anything that's a "slide")
    const images = placedCatalogAssets.filter(a => a.imageUrl || a.videoUrl)
    if (images.length === 0) return

    // Sort by X position (left to right), break ties by Z
    const sorted = [...images].sort((a, b) => {
      const ax = transforms[a.id]?.position?.[0] ?? a.position[0]
      const bx = transforms[b.id]?.position?.[0] ?? b.position[0]
      if (Math.abs(ax - bx) > 0.5) return ax - bx
      const az = transforms[a.id]?.position?.[2] ?? a.position[2]
      const bz = transforms[b.id]?.position?.[2] ?? b.position[2]
      return az - bz
    })

    // Find current index
    const currentIdx = focusedImageId ? sorted.findIndex(img => img.id === focusedImageId) : -1

    // Navigate
    let nextIdx: number
    if (currentIdx === -1) {
      // Not focused on any image — go to first (PgDown) or last (PgUp)
      nextIdx = direction === 1 ? 0 : sorted.length - 1
    } else {
      nextIdx = currentIdx + direction
      // Wrap around
      if (nextIdx < 0) nextIdx = sorted.length - 1
      if (nextIdx >= sorted.length) nextIdx = 0
    }

    // Focus the target image
    get().focusImage(sorted[nextIdx].id)
  },

  // ─═̷─═̷─👁️ VIEW MODE — peek into someone else's world (read-only) ─═̷─═̷─👁️
  enterViewMode: (worldId, allowEdit = true) => {
    // Save current world before entering view mode (if not already viewing)
    if (!get().isViewMode && get()._worldReady) {
      cancelPendingSave()
      const { terrainParams, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, transforms, behaviors, worldLights, worldSkyBackground, activeWorldId, placedAgentAvatars, placedAgentWindows } = get()
      saveWorld({ terrain: terrainParams, groundPresetId, groundTiles, craftedScenes, conjuredAssetIds: worldConjuredAssetIds, catalogPlacements: placedCatalogAssets, transforms, behaviors, lights: worldLights, skyBackgroundId: worldSkyBackground, agentWindows: placedAgentWindows, agentAvatars: placedAgentAvatars }, activeWorldId)
    }

    // Set view mode flag IMMEDIATELY — prevents initWorlds/loadWorldState from overwriting
    set({ isViewMode: true, isViewModeEditable: false, viewingWorldId: worldId, viewingWorldMeta: { name: 'Loading...', icon: '⏳' } })

    loadPublicWorld(worldId).then(result => {
      if (!result) {
        console.error(`[ViewMode] World ${worldId} not found or not public`)
        set({ isViewMode: false, isViewModeEditable: false, viewingWorldId: null, viewingWorldMeta: null })
        return
      }
      const { state, meta } = result
      // Only allow editing if caller permits AND world is public_edit
      const isEditable = allowEdit && meta.visibility === 'public_edit'
      const defaultLights: WorldLight[] = DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))
      const lights = state.lights !== undefined ? state.lights : defaultLights
      const viewObjCount = (state.conjuredAssetIds?.length || 0) + (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0)
      const sanitizedAgentAvatars = sanitizeAgentAvatarList(state.agentAvatars || [])
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: state.agentWindows || [],
        avatars: sanitizedAgentAvatars.entries,
        transforms: state.transforms || {},
      })
      set({
        _worldReady: isEditable, // Only allow saves for authenticated public_edit
        _loadedObjectCount: viewObjCount,
        isViewModeEditable: isEditable,
        viewingWorldMeta: { name: meta.name, icon: meta.icon, creator_name: meta.creator_name, creator_avatar: meta.creator_avatar, visibility: meta.visibility },
        terrainParams: state.terrain || null,
        groundPresetId: state.groundPresetId || 'none',
        groundTiles: state.groundTiles || {},
        craftedScenes: state.craftedScenes || [],
        worldConjuredAssetIds: state.conjuredAssetIds || [],
        placedCatalogAssets: state.catalogPlacements || [],
        transforms: normalizedAgentWorldState.transforms,
        behaviors: state.behaviors || {},
        worldLights: lights,
        worldSkyBackground: state.skyBackgroundId || 'night007',
        placedAgentWindows: normalizedAgentWorldState.windows,
        placedAgentAvatars: normalizedAgentWorldState.avatars,
        liveAgentAvatarAudio: {},
        selectedObjectId: null,
        inspectedObjectId: null,
        paintMode: false,
        paintBrushPresetId: null,
      })
      console.log(`[ViewMode] Entered: "${meta.name}" by ${meta.creator_name || 'unknown'}`)
    })
  },

  exitViewMode: () => {
    if (!get().isViewMode) return
    set({ isViewMode: false, isViewModeEditable: false, viewingWorldId: null, viewingWorldMeta: null })
    // Reload user's own active world
    get().loadWorldState()
    console.log('[ViewMode] Exited — back to own world')
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ░▒▓█ UNDO/REDO — The temporal cortex of world editing █▓▒░
  // Full-snapshot commands: each entry stores world state before + after.
  // Batch mechanism for continuous ops (drag transforms, paint strokes).
  // Ctrl+Z / Ctrl+Shift+Z keyboard bindings in TransformKeyHandler.
  // ═══════════════════════════════════════════════════════════════════════════════

  undo: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return
    const command = undoStack[undoStack.length - 1]
    set(state => ({
      _isUndoRedoing: true,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, command].slice(-MAX_UNDO_STACK),
      // ░▒▓ Restore world state from before snapshot ▓▒░
      ...command.before,
    }))
    set({ _isUndoRedoing: false })
    // Persist the restored state
    setTimeout(() => get().saveWorldState(), 100)
  },

  redo: () => {
    const { redoStack } = get()
    if (redoStack.length === 0) return
    const command = redoStack[redoStack.length - 1]
    set(state => ({
      _isUndoRedoing: true,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, command].slice(-MAX_UNDO_STACK),
      // ░▒▓ Re-apply world state from after snapshot ▓▒░
      ...command.after,
    }))
    set({ _isUndoRedoing: false })
    setTimeout(() => get().saveWorldState(), 100)
  },

  // ─═̷─═̷─ BATCH — for continuous ops (drag transforms, paint strokes) ─═̷─═̷─
  // Call beginUndoBatch on drag start / paint start,
  // commitUndoBatch on drag end / paint end.
  beginUndoBatch: (label, icon) => {
    set({ _undoBatch: { label, icon, before: captureWorldSnapshot(get()) } })
  },

  commitUndoBatch: () => {
    const batch = get()._undoBatch
    if (!batch) return
    const after = captureWorldSnapshot(get())
    set(state => ({
      _undoBatch: null,
      undoStack: [...state.undoStack, {
        label: batch.label,
        icon: batch.icon,
        timestamp: Date.now(),
        before: batch.before,
        after,
      }].slice(-MAX_UNDO_STACK),
      redoStack: [],  // new action clears redo stack
    }))
  },
})})  // }) closes return ({...}), }) closes arrow function + create()

// ▓▓▓▓【0̸4̸5̸1̸5̸】▓▓▓▓ॐ▓▓▓▓【O̸A̸S̸I̸S̸】▓▓▓▓

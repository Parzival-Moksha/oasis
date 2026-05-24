// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Zustand State Store
// The memory of the Oasis
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { create } from 'zustand'
import type { ConjuredAsset, CraftedScene, CatalogPlacement, RealmId, ObjectBehavior, ObjectInteractionAction, WorldLight, WorldLightType, GeneratedImage } from '../lib/conjure/types'
import { DEFAULT_WORLD_LIGHTS } from '../lib/conjure/types'
import type { TerrainParams } from '../lib/forge/terrain-generator'
import {
  applyTerrainBrush,
  createFlatTerrainHeights,
  normalizeTerrainHeights,
  type TerrainBrushDirection,
  type TerrainBrushMode,
} from '../lib/forge/terrain-brush'
import {
  loadWorld, debouncedSaveWorld, saveWorld,
  getWorldRegistry, getActiveWorldId, setActiveWorldId,
  getServerActiveWorld,
  createWorld, deleteWorld, exportWorld, importWorld,
  cancelPendingSave,
  loadPublicWorld,
  type WorldMeta,
} from '../lib/forge/world-persistence'
import { worldMutationBus } from '../lib/world-mutation-bus'
import type { SpellId } from '../lib/spellbook'

// Per-client throttle for terrain-brush broadcasts. Module-level (one per
// browser tab) is correct here — we want this user's brush rate-limited
// independently of any other globals.
const terrainBroadcastClock = { lastAt: 0 }
import {
  WELCOME_HUB_WORLD_ID,
  isWelcomeHubWorld,
  layoutPortalAreaGates,
  portalRotationTowardCenter,
  resolveWelcomeHubPortalGates,
  type PortalAction,
  type PortalGate,
  type PortalGateVariant,
} from '../lib/portal-gates'
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
import { DEFAULT_PROFILE_AVATAR_3D_URL } from '../lib/profile-defaults'
import {
  foldTransformIntoAgentAvatar,
  isSharedAgentAvatarType as isSharedAgentAvatarWorldType,
  normalizeAgentAvatarTransforms,
  type AgentAvatarTransformMap,
} from '../lib/agent-avatar-world-state'
import { DEFAULT_AGENT_WINDOW_RENDER_MODE, type AgentWindowRenderMode } from '../lib/agent-window-renderers'
import { useAudioManager, type SoundEvent } from '../lib/audio-manager'
import {
  SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT,
  buildSpatialWebSubmission,
  getNextSpatialWebValue,
  resolveSpatialWebObjectPosition,
  summarizeSpatialWebSubmission,
  type SpatialWebEventName,
  type SpatialWebObject,
  type SpatialWebValue,
} from '../lib/spatial-web'
import { createPortalZeroGoogleFormsAltar, createPortalZeroGoogleTestAltar } from '../lib/spatial-web-presets'
import { getViewerUserIdClient } from '../lib/viewer-identity-client'
import type { PaintStroke } from '../lib/forge/paint-stroke'
import type { Text3DObject } from '../lib/forge/text-3d-object'

export interface ObjectHtmlOverlay {
  objectId: string
  title: string
  url?: string
  html?: string
  opacity: number
}

const SPATIAL_WEB_WORLD_TOOL_ALLOWLIST = new Set([
  'set_sky',
  'set_ground_preset',
  'paint_ground_tiles',
  'add_light',
  'modify_light',
  'modify_object',
  'set_behavior',
  'place_object',
  'place_agent_window',
  'place_browser_window',
  'create_spatial_web_object',
  'create_world_from_google_form',
  'create_test_world_from_google_form',
  'create_portal_gate',
  'self_craft_scene',
])

type SpatialSubmitResponse = {
  ok?: boolean
  message?: string
  error?: string
  data?: {
    geminiPrompt?: string
    grade?: {
      correctCount?: number
      totalCount?: number
      percent?: number
      details?: Array<{ label?: string; correct?: boolean; value?: unknown; expected?: unknown }>
    }
  }
}

function spatialValueKey(value: SpatialWebValue | undefined): string {
  if (Array.isArray(value)) return value.join(',')
  return String(value)
}

function normalizeTestAnswerValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    const values = value.map(item => item.trim()).filter(Boolean)
    return values.length > 0 ? values : null
  }
  return null
}

function parseTestAnswerKey(value: string): Record<string, string | string[]> | undefined {
  const jsonMatch = value.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const entries = Object.entries(parsed)
        .map(([key, answer]) => [key.trim(), normalizeTestAnswerValue(answer)] as const)
        .filter((entry): entry is readonly [string, string | string[]] => Boolean(entry[0] && entry[1]))
      if (entries.length > 0) return Object.fromEntries(entries)
    } catch {
      // Fall through to line parsing.
    }
  }

  const entries = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^https?:\/\//i.test(line) && !/^answers?:?$/i.test(line))
    .map(line => {
      const separator = line.includes('=>') ? '=>' : line.includes('=') ? '=' : ':'
      const index = line.indexOf(separator)
      if (index < 0) return null
      const key = line.slice(0, index).trim()
      const rawAnswer = line.slice(index + separator.length).trim()
      const answer = rawAnswer.includes('|')
        ? rawAnswer.split('|').map(part => part.trim()).filter(Boolean)
        : rawAnswer
      const normalized = normalizeTestAnswerValue(answer)
      return key && normalized ? [key, normalized] as const : null
    })
    .filter((entry): entry is readonly [string, string | string[]] => Boolean(entry))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function extractFirstUrl(value: string): string {
  const match = value.match(/https?:\/\/[^\s<>"']+/i)
  return (match?.[0] || value).replace(/[),.;]+$/, '').trim()
}

function resolveSpatialWorldToolArgs(
  action: NonNullable<SpatialWebObject['action']>,
  value: SpatialWebValue | undefined,
  worldId: string | null | undefined,
): Record<string, unknown> {
  const mappedArgs = value !== undefined ? action.argsByValue?.[spatialValueKey(value)] : undefined
  return {
    ...(action.args || {}),
    ...(mappedArgs || {}),
    ...(worldId ? { worldId } : {}),
  }
}

const MAX_ACTIVE_MARCH_ORDER_VFX = 8

// ─═̷─═̷─🏗️ SSR-SAFE LOCALSTORAGE ─═̷─═̷─🏗️
// Next.js pre-renders on the server where `window` doesn't exist.
// These two helpers mean we write `typeof window` exactly once — here — instead
// of scattering the guard across every localStorage read/write in the store.
const isBrowser = typeof window !== 'undefined'
const stored  = (key: string): string | null => isBrowser ? localStorage.getItem(key) : null
function playSpatialWebSound(event: SoundEvent): void {
  if (!isBrowser) return
  try {
    useAudioManager.getState().play(event)
  } catch {}
}
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!isBrowser) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    window.prompt('Copy Oasis world URL', text)
  } catch {}
  return false
}

function upsertWorldRegistryMeta(registry: WorldMeta[], meta: WorldMeta): WorldMeta[] {
  const index = registry.findIndex(world => world.id === meta.id)
  if (index < 0) return [...registry, meta]
  return registry.map(world => world.id === meta.id ? { ...world, ...meta } : world)
}

function resolveObjectPosition(state: OasisState, objectId: string): [number, number, number] {
  const transformPosition = state.transforms[objectId]?.position
  if (transformPosition) return transformPosition
  const catalog = state.placedCatalogAssets.find(object => object.id === objectId)
  if (catalog) return catalog.position
  const crafted = state.craftedScenes.find(object => object.id === objectId)
  if (crafted) return crafted.position
  const conjured = state.conjuredAssets.find(object => object.id === objectId)
  if (conjured?.position) return conjured.position
  const portal = state.portalGates.find(object => object.id === objectId)
  if (portal) return portal.position
  const spatial = state.spatialWebObjects.find(object => object.id === objectId)
  if (spatial) return spatial.position
  const text = state.text3dObjects.find(object => object.id === objectId)
  if (text) return text.position
  const agentWindow = state.placedAgentWindows.find(object => object.id === objectId)
  if (agentWindow) return agentWindow.position
  const agentAvatar = state.placedAgentAvatars.find(object => object.id === objectId)
  if (agentAvatar) return agentAvatar.position
  const light = state.worldLights.find(object => object.id === objectId)
  if (light) return light.position
  return [0, 0, 0]
}

function resolveObjectLabel(state: OasisState, objectId: string): string {
  const behavior = state.behaviors[objectId]
  if (behavior?.interaction?.label) return behavior.interaction.label
  if (behavior?.label) return behavior.label
  return state.placedCatalogAssets.find(object => object.id === objectId)?.name
    || state.craftedScenes.find(object => object.id === objectId)?.name
    || state.portalGates.find(object => object.id === objectId)?.label
    || state.spatialWebObjects.find(object => object.id === objectId)?.label
    || state.text3dObjects.find(object => object.id === objectId)?.text
    || state.placedAgentWindows.find(object => object.id === objectId)?.label
    || state.placedAgentAvatars.find(object => object.id === objectId)?.label
    || objectId
}

type RemoteSubscription = { unsubscribe: () => void }
type ViewingWorldMeta = Partial<WorldMeta> & { name: string; icon: string }
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

const PLACEMENT_VFX_LIST: Exclude<PlacementVfxType, 'random'>[] = ['runeflash', 'sparkburst', 'portalring', 'sigilpulse', 'realitydetonation', 'dimensionalmaw', 'hexstorm', 'singularitydrop', 'quantumcollapse', 'phoenixascension', 'dimensionalrift', 'crystalgenesis', 'meteorimpact', 'arcanebloom', 'voidanchor', 'stellarforge']

export interface PlacementPending {
  type: 'catalog' | 'conjured' | 'crafted' | 'library' | 'image' | 'video' | 'agent' | 'light' | 'portal' | 'spatialWeb'
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
  /** Frame thickness multiplier for image/video placements */
  imageFrameThickness?: number
  /** For agent window placements */
  agentType?: AgentWindowType
  npcId?: string
  /** Carry over session ID from existing panel */
  agentSessionId?: string
  /** Projection technique used for the 3D window */
  agentRenderMode?: AgentWindowRenderMode
  /** Initial URL for browser agent windows */
  agentSurfaceUrl?: string
  agentBrowserSurfaceMode?: BrowserSurfaceMode
  agentFrameStyle?: string
  agentFrameThickness?: number
  /** For light placements — which placeable light type */
  lightType?: 'point' | 'spot'
  portalVariant?: PortalGateVariant
  portalTargetWorldId?: string
  portalTargetWorldName?: string
  portalAction?: PortalAction
  portalDirection?: 'one-way' | 'two-way'
  spatialWebObject?: SpatialWebObject
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
export type AgentWindowType = 'anorak' | 'codex' | 'gemini' | 'anorak-pro' | 'merlin' | 'realtime' | 'npc' | 'hermes' | 'openclaw' | 'devcraft' | 'parzival' | 'browser' | 'mission'

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
  npcId?: string                          // NPC definition id for reusable scripted/realtime citizens
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
  /** Viewer cookie id of the user who placed this window. Optional during the
   *  migration: legacy world snapshots have no ownerId and are treated as
   *  "open" (any visitor may interact). Stamped at placement time only. */
  ownerId?: string
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
  /** Viewer cookie id of the user who placed this avatar. Optional during the
   *  migration: legacy world snapshots have no ownerId. Stamped at placement
   *  time only. Mirrors AgentWindow.ownerId. */
  ownerId?: string
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
    case 'gemini':
      return 'Gemini'
    case 'anorak-pro':
      return 'Anorak Pro'
    case 'merlin':
      return 'Merlin'
    case 'realtime':
      return 'Realtime'
    case 'npc':
      return 'NPC'
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
  portalGates: PortalGate[]
  spatialWebObjects: SpatialWebObject[]
  paintStrokes: PaintStroke[]
  text3dObjects: Text3DObject[]
  transforms: Record<string, { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }>
  behaviors: Record<string, ObjectBehavior>
  groundTiles: Record<string, string>
  worldLights: WorldLight[]
  terrainParams: TerrainParams | null
  terrainHeights: number[]
}

export interface UndoCommand {
  label: string
  icon: string
  timestamp: number
  before: WorldSnapshot
  after: WorldSnapshot
}

const MAX_UNDO_STACK = 20
const DEFAULT_TERRAIN_BRUSH_INTENSITY = 1.5
const DEFAULT_TERRAIN_BRUSH_RADIUS = 3

function captureWorldSnapshot(state: { placedCatalogAssets: CatalogPlacement[]; worldConjuredAssetIds: string[]; craftedScenes: CraftedScene[]; portalGates: PortalGate[]; spatialWebObjects: SpatialWebObject[]; paintStrokes: PaintStroke[]; text3dObjects: Text3DObject[]; transforms: Record<string, any>; behaviors: Record<string, ObjectBehavior>; groundTiles: Record<string, string>; worldLights: WorldLight[]; terrainParams: TerrainParams | null; terrainHeights: number[] }): WorldSnapshot {
  // Deep-clone the small structures (transforms, behaviors, etc.) but treat
  // paintStrokes + text3dObjects as immutable arrays — we never mutate
  // individual strokes after addPaintStroke; subsequent operations replace
  // the array. structuredClone'ing 20K-point strokes (240KB each) on every
  // unrelated withUndo call would freeze the UI.
  const cloned = structuredClone({
    placedCatalogAssets: state.placedCatalogAssets,
    worldConjuredAssetIds: state.worldConjuredAssetIds,
    craftedScenes: state.craftedScenes,
    portalGates: state.portalGates,
    spatialWebObjects: state.spatialWebObjects,
    transforms: state.transforms,
    behaviors: state.behaviors,
    groundTiles: state.groundTiles,
    worldLights: state.worldLights,
    terrainParams: state.terrainParams,
    terrainHeights: state.terrainHeights,
  })
  return {
    ...cloned,
    paintStrokes: state.paintStrokes.slice(),
    text3dObjects: state.text3dObjects.slice(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════════

interface OasisState {
  // ─═̷─═̷─⚙️ VISUAL SETTINGS ─═̷─═̷─⚙️
  fpsCounterEnabled: boolean
  fpsCounterFontSize: number  // px

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
  portalGates: PortalGate[]                // persistent teleport gates placed in THIS world
  spatialWebObjects: SpatialWebObject[]    // spatial website primitives placed in THIS world
  paintStrokes: PaintStroke[]              // wizardry tubes/ribbons drawn in 3-space
  text3dObjects: Text3DObject[]            // extruded 3D text objects placed in 3-space
  /** Per-stroke playback state — { progress: 0..1, durationSec, startedAt } */
  paintStrokePlayback: Record<string, { progress: number; durationSec: number; startedAt: number; loop?: boolean }>

  // ─═̷─═̷─📖 SPELLBOOK / ARMED SPELL ─═̷─═̷─📖
  /** Spell selected from the spellbook. Drives PlayerVitalsHud display + combat cast routing. */
  selectedSpellId: SpellId | null

  // ─═̷─═̷─🎨 PAINT TOOL UI STATE ─═̷─═̷─🎨
  paintBrushPanelOpen: boolean
  /** Texture stretch for ground paint. 1 = each cell is 1m. 2/4/8 stretches the
   *  texture and pre-paints a larger footprint (every Nth cell, each rendered
   *  at NxN meters). Lets manual paint match the agent's set_ground_preset
   *  zoomed-out look. */
  paintBrushStretch: number
  text3dPanelOpen: boolean
  /** When true, a held-button is forcing paint mode (mobile or keyboard). */
  paintHeldActive: boolean
  paintBrushSettings: {
    color: string
    thickness: number
    shininess: number
    distance: number
    mode: '2d' | '3d'
    varyByVelocity: boolean
  }
  text3dSettings: {
    text: string
    fontId: string
    size: number
    depth: number
    color: string
    shininess: number
    toneBias: number
  }

  // ─═̷─═̷─🪄 PLACEMENT MODE + VFX ─═̷─═̷─🪄
  placementPending: PlacementPending | null   // what we're about to place (null = not in placement mode)
  placementVfxType: PlacementVfxType
  placementVfxDuration: number                // seconds, 0.5-4.5
  activePlacementVfx: ActivePlacementVfx[]    // currently playing VFX instances
  activeMarchOrderVfx: ActiveMarchOrderVfx[]  // right-click move-order markers
  agentMaterializations: Record<string, AgentMaterialization>
  activeObjectOverlay: ObjectHtmlOverlay | null

  // ─═̷─═̷─🌍 TERRAIN + WORLD STATE ─═̷─═̷─🌍
  terrainParams: TerrainParams | null
  terrainLoading: boolean
  terrainHeights: number[]
  terrainBrushPanelOpen: boolean
  terrainBrushMode: TerrainBrushMode
  terrainBrushIntensity: number
  terrainBrushRadius: number
  terrainBrushDirection: TerrainBrushDirection
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
  viewingWorldMeta: ViewingWorldMeta | null
  /** True when viewing an open-build world - editing tools stay enabled */
  isViewModeEditable: boolean
  /** The world ID being viewed (needed for saving open-build worlds) */
  viewingWorldId: string | null

  // ─═̷─═̷─🪟 PANEL Z-ORDERING — last clicked = highest z-index ─═̷─═̷─🪟
  _panelZCounter: number
  _panelZMap: Record<string, number>
  bringPanelToFront: (panelName: string) => void
  getPanelZIndex: (panelName: string, defaultZ: number) => number

  // ─═̷─═̷─⚙️ SETTINGS ACTIONS ─═̷─═̷─⚙️
  setFpsCounterEnabled: (enabled: boolean) => void
  setFpsCounterFontSize: (size: number) => void
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
  applyRemoteCatalogPlacement: (placement: CatalogPlacement) => void
  applyRemoteCatalogRemoval: (id: string) => void
  placePortalGateAt: (args: {
    variant: PortalGateVariant
    label?: string
    action?: PortalAction
    targetWorldId?: string
    targetWorldName?: string
    direction?: 'one-way' | 'two-way'
    position: [number, number, number]
  }) => string
  removePortalGate: (id: string) => void
  updatePortalGate: (id: string, updates: Partial<PortalGate>) => void

  // ─═̷─═̷─🪄 PLACEMENT + VFX ACTIONS ─═̷─═̷─🪄
  enterPlacementMode: (pending: PlacementPending) => void
  cancelPlacement: () => void
  placeCatalogAssetAt: (catalogId: string, name: string, path: string, defaultScale: number, position: [number, number, number]) => string
  placeImageAt: (name: string, imageUrl: string, position: [number, number, number], frameStyle?: string, frameThickness?: number) => void
  placeVideoAt: (name: string, videoUrl: string, position: [number, number, number], frameStyle?: string, frameThickness?: number) => void
  updateCatalogPlacement: (id: string, updates: Partial<import('../lib/conjure/types').CatalogPlacement>) => void
  placeLibrarySceneAt: (sceneId: string, position: [number, number, number]) => void
  setPlacementVfxType: (type: PlacementVfxType) => void
  setPlacementVfxDuration: (duration: number) => void
  spawnPlacementVfx: (position: [number, number, number], typeOverride?: PlacementVfxType) => void
  removePlacementVfx: (id: string) => void
  openObjectOverlay: (overlay: ObjectHtmlOverlay) => void
  closeObjectOverlay: () => void
  interactObject: (id: string) => Promise<void>
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
  setTerrainBrushPanelOpen: (open: boolean) => void
  setTerrainBrushMode: (mode: TerrainBrushMode) => void
  setTerrainBrushIntensity: (intensity: number) => void
  setTerrainBrushRadius: (radius: number) => void
  setTerrainBrushDirection: (direction: TerrainBrushDirection) => void
  sculptTerrainAt: (x: number, z: number, deltaSeconds: number) => void
  applyRemoteTerrainBrush: (x: number, z: number, radius: number, intensity: number, direction: TerrainBrushDirection, deltaSeconds: number) => void
  resetTerrainHeights: () => void
  applyRemoteTerrainReset: () => void
  setGroundPreset: (presetId: string) => void
  applyRemoteGroundChange: (presetId: string) => void
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
  applyRemoteObjectTransform: (id: string, transform: { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }) => void
  setAgentAvatarTransform: (id: string, transform: { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }) => void
  setObjectBehavior: (id: string, behavior: Partial<ObjectBehavior>) => void
  addSpatialWebObject: (object: SpatialWebObject) => void
  placeSpatialWebObjectAt: (object: SpatialWebObject, position: [number, number, number]) => void
  updateSpatialWebObject: (id: string, updates: Partial<SpatialWebObject>) => void
  setSpatialWebObjectValue: (id: string, value: SpatialWebValue) => void
  interactSpatialWebObject: (id: string, event?: SpatialWebEventName) => Promise<void>
  removeSpatialWebObject: (id: string) => void
  seedSpatialWebRsvpDemo: () => void
  // ─═̷─═̷─🎨 PAINT STROKE ACTIONS ─═̷─═̷─🎨
  addPaintStroke: (stroke: PaintStroke) => void
  updatePaintStroke: (id: string, updates: Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>>) => void
  removePaintStroke: (id: string) => void
  applyRemotePaintStroke: (stroke: PaintStroke) => void
  applyRemotePaintStrokeUpdated: (id: string, updates: Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>>) => void
  applyRemotePaintStrokeRemoval: (id: string) => void
  /** Start a playback animation for a stroke; previous state for that id is replaced. */
  playPaintStroke: (id: string, durationSec: number, loop?: boolean) => void
  /** Update animated progress for a stroke (called from a useFrame loop). */
  setPaintStrokePlaybackProgress: (id: string, progress: number) => void
  /** Stop/clear a paint stroke playback state. */
  stopPaintStrokePlayback: (id: string) => void
  // ─═̷─═̷─📜 TEXT 3D ACTIONS ─═̷─═̷─📜
  addText3dObject: (object: Text3DObject) => void
  updateText3dObject: (id: string, updates: Partial<Text3DObject>) => void
  removeText3dObject: (id: string) => void
  applyRemoteText3dAdded: (object: Text3DObject) => void
  applyRemoteText3dUpdated: (id: string, updates: Partial<Text3DObject>) => void
  applyRemoteText3dRemoved: (id: string) => void
  // ─═̷─═̷─📖 SPELLBOOK ACTIONS ─═̷─═̷─📖
  setSelectedSpellId: (id: SpellId | null) => void

  // ─═̷─═̷─🎨 PAINT TOOL UI ACTIONS ─═̷─═̷─🎨
  setPaintBrushPanelOpen: (open: boolean) => void
  setPaintBrushStretch: (stretch: number) => void
  setText3dPanelOpen: (open: boolean) => void
  setPaintHeldActive: (active: boolean) => void
  updatePaintBrushSettings: (updates: Partial<OasisState['paintBrushSettings']>) => void
  updateText3dSettings: (updates: Partial<OasisState['text3dSettings']>) => void
  setObjectMeshStats: (id: string, stats: import('../lib/conjure/types').ModelStats) => void
  /** RTS-style: send selected object to a target position */
  setMoveTarget: (id: string, target: [number, number, number]) => void
  /** Clear moveTarget when object arrives */
  clearMoveTarget: (id: string) => void
  // ─═̷─═̷─🌅 SKY ACTION ─═̷─═̷─🌅
  setWorldSkyBackground: (id: string) => void
  applyRemoteSkyChange: (skyBackgroundId: string) => void
  // ─═̷─═̷─💡 LIGHT ACTIONS ─═̷─═̷─💡
  addWorldLight: (type: WorldLightType) => void
  applyRemoteLightAdded: (light: WorldLight) => void
  applyRemoteLightRemoved: (id: string) => void
  applyRemoteLightUpdated: (id: string, updates: Partial<WorldLight>) => void
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
  removeAgentAvatar: (id: string) => void
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

  const canWriteCurrentWorld = () => {
    const state = get()
    if (state.isViewMode) return state.isViewModeEditable
    const meta = state.worldRegistry.find(world => world.id === state.activeWorldId)
    if (meta) return meta.canWrite === true
    // Before registry metadata exists, local dev/tests stay permissive. Hosted
    // sessions fail closed because the server-side world allowlist is the owner
    // of write permission.
    const mode = typeof window !== 'undefined'
      ? window.__oasisModeFallback
      : (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_OASIS_MODE : undefined)
    return mode !== 'hosted' && state.worldRegistry.length === 0
  }

  const sanitizePaintStrokeUpdates = (
    updates: Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>>,
  ): Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>> => {
    const clean: Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>> = {}
    if (typeof updates.color === 'string') clean.color = updates.color
    if (typeof updates.thickness === 'number' && Number.isFinite(updates.thickness)) clean.thickness = Math.max(0.005, Math.min(0.5, updates.thickness))
    if (typeof updates.shininess === 'number' && Number.isFinite(updates.shininess)) clean.shininess = Math.max(0, Math.min(1, updates.shininess))
    if (updates.mode === '2d' || updates.mode === '3d') clean.mode = updates.mode
    if (typeof updates.varyByVelocity === 'boolean') clean.varyByVelocity = updates.varyByVelocity
    if (typeof updates.playbackLoop === 'boolean') clean.playbackLoop = updates.playbackLoop
    return clean
  }

  const broadcastSnapshotMutationDelta = (from: WorldSnapshot, to: WorldSnapshot) => {
    const fromStrokes = new Map(from.paintStrokes.map(stroke => [stroke.id, stroke]))
    const toStrokes = new Map(to.paintStrokes.map(stroke => [stroke.id, stroke]))
    for (const stroke of to.paintStrokes) {
      const prev = fromStrokes.get(stroke.id)
      if (!prev) {
        worldMutationBus.broadcast({ kind: 'stroke_ended', payload: { strokeId: stroke.id, finalStroke: stroke } })
        continue
      }
      const updates = sanitizePaintStrokeUpdates({
        color: prev.color !== stroke.color ? stroke.color : undefined,
        thickness: prev.thickness !== stroke.thickness ? stroke.thickness : undefined,
        shininess: prev.shininess !== stroke.shininess ? stroke.shininess : undefined,
        mode: prev.mode !== stroke.mode ? stroke.mode : undefined,
        varyByVelocity: prev.varyByVelocity !== stroke.varyByVelocity ? Boolean(stroke.varyByVelocity) : undefined,
        playbackLoop: prev.playbackLoop !== stroke.playbackLoop ? Boolean(stroke.playbackLoop) : undefined,
      })
      if (Object.keys(updates).length > 0) {
        worldMutationBus.broadcast({ kind: 'stroke_updated', payload: { id: stroke.id, updates } })
      }
    }
    for (const stroke of from.paintStrokes) {
      if (!toStrokes.has(stroke.id)) {
        worldMutationBus.broadcast({ kind: 'stroke_removed', payload: { id: stroke.id } })
      }
    }

    const fromText = new Map(from.text3dObjects.map(object => [object.id, object]))
    const toText = new Map(to.text3dObjects.map(object => [object.id, object]))
    for (const object of to.text3dObjects) {
      const prev = fromText.get(object.id)
      if (!prev) {
        worldMutationBus.broadcast({ kind: 'text3d_added', payload: object })
      } else if (JSON.stringify(prev) !== JSON.stringify(object)) {
        worldMutationBus.broadcast({ kind: 'text3d_updated', payload: { id: object.id, updates: object } })
      }
    }
    for (const object of from.text3dObjects) {
      if (!toText.has(object.id)) {
        worldMutationBus.broadcast({ kind: 'text3d_removed', payload: { id: object.id } })
      }
    }
  }

  const resolveDefaultPortalGates = (
    worldId: string,
    storedGates?: PortalGate[] | null,
    transforms?: Record<string, { position?: [number, number, number] } | undefined>,
  ): PortalGate[] => {
    if (isWelcomeHubWorld(worldId)) {
      return resolveWelcomeHubPortalGates(storedGates, get().worldRegistry, transforms)
    }
    if (Array.isArray(storedGates) && storedGates.length > 0) {
      return layoutPortalAreaGates(storedGates, transforms)
    }
    return []
  }

  const resolveDefaultSpatialWebObjects = (
    worldId: string,
    storedObjects?: SpatialWebObject[] | null,
  ): SpatialWebObject[] => {
    const existing = Array.isArray(storedObjects) ? storedObjects : []
    if (!isWelcomeHubWorld(worldId)) return existing
    const altar = createPortalZeroGoogleFormsAltar()
    const testAltar = createPortalZeroGoogleTestAltar()
    const next = [...existing]
    if (!next.some(object => object.id === altar.id)) next.push(altar)
    if (!next.some(object => object.id === testAltar.id)) next.push(testAltar)
    return next
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

    if (agentType === 'openclaw') {
      return deriveStandaloneAgentAvatarSpawn(getCameraSnapshot(), 20)
    }

    return agentType === 'hermes' || agentType === 'realtime'
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
    // Inherit ownerId from the preferred window if one was provided; otherwise
    // stamp the current viewer. Shared singletons (Hermes/Merlin/etc.) are
    // claimed by the user who first conjures them.
    const preferredWindowOwner = options?.preferredWindowId
      ? get().placedAgentWindows.find(entry => entry.id === options.preferredWindowId)?.ownerId
      : undefined
    const newAvatarOwnerId = preferredWindowOwner || getViewerUserIdClient()
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
          ownerId: newAvatarOwnerId,
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

  // ─═̷─═̷─🧠 AI MODEL SETTINGS ─═̷─═̷─🧠
  craftModel: stored('oasis-craft-model') || 'google/gemini-3.1-flash-lite-preview',
  voiceModel: stored('oasis-voice-model') || 'merlin-v1',

  // ─═̷─═̷─🔥 REALM STATE ─═̷─═̷─🔥
  activeRealm: 'forge' as RealmId,
  conjuredAssets: [],
  worldConjuredAssetIds: [],
  craftedScenes: [],
  conjureVfxType: (stored('oasis-vfx') as ConjureVfxType) || 'random',
  placedCatalogAssets: [],
  portalGates: [],
  spatialWebObjects: [],
  paintStrokes: [],
  text3dObjects: [],
  paintStrokePlayback: {},
  selectedSpellId: null,
  paintBrushPanelOpen: false,
  paintBrushStretch: 1,
  text3dPanelOpen: false,
  paintHeldActive: false,
  paintBrushSettings: {
    color: '#ff3df0',
    thickness: 0.04,
    shininess: 0.7,
    distance: 3.0,
    mode: '3d',
    varyByVelocity: false,
  },
  text3dSettings: {
    text: 'hello',
    fontId: 'helvetiker_regular',
    size: 0.5,
    depth: 0.12,
    color: '#ffd166',
    shininess: 0.8,
    toneBias: 0.5,
  },
  sceneLibrary: [],

  // ─═̷─═̷─🪄 PLACEMENT MODE + VFX ─═̷─═̷─🪄
  placementPending: null,
  placementVfxType: (stored('oasis-placement-vfx') as PlacementVfxType) || 'random',
  placementVfxDuration: parseFloat(stored('oasis-placement-duration') || '2.2'),
  activePlacementVfx: [],
  activeMarchOrderVfx: [],
  agentMaterializations: {},
  activeObjectOverlay: null,
  conjurePreview: null,
  craftingInProgress: false,
  craftingPrompt: null,

  // ─═̷─═̷─🌍 TERRAIN + WORLD STATE ─═̷─═̷─🌍
  terrainParams: null,
  terrainLoading: false,
  terrainHeights: createFlatTerrainHeights(),
  terrainBrushPanelOpen: false,
  terrainBrushMode: 'texture' as TerrainBrushMode,
  terrainBrushIntensity: DEFAULT_TERRAIN_BRUSH_INTENSITY,
  terrainBrushRadius: DEFAULT_TERRAIN_BRUSH_RADIUS,
  terrainBrushDirection: 'up' as TerrainBrushDirection,
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
  avatar3dUrl: DEFAULT_PROFILE_AVATAR_3D_URL, // Default avatar for local mode

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
    // Mirror the bus broadcast in setObjectTransform — when setObjectTransform
    // detects an agent-avatar id it re-routes here, but the broadcast was
    // missing on this branch, so dragging an agent avatar was invisible to
    // peers even though applyRemoteObjectTransform already handles the
    // receive-side agent-avatar branch.
    worldMutationBus.broadcast({
      kind: 'object_transformed',
      payload: { id, position: transform.position, rotation: transform.rotation, scale: transform.scale },
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeConjuredAssetFromWorld: (assetId) => {
    if (!canWriteCurrentWorld()) return
    if (!get().worldConjuredAssetIds.includes(assetId)) return
    withUndo('Remove conjured', '🗑️', () => {
      set((state) => {
        const nextTransforms = { ...state.transforms }
        delete nextTransforms[assetId]
        const { [assetId]: _removedBehavior, ...behaviors } = state.behaviors
        return {
          worldConjuredAssetIds: state.worldConjuredAssetIds.filter(id => id !== assetId),
          transforms: nextTransforms,
          behaviors,
          selectedObjectId: state.selectedObjectId === assetId ? null : state.selectedObjectId,
          inspectedObjectId: state.inspectedObjectId === assetId ? null : state.inspectedObjectId,
        }
      })
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id: assetId } })
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
    if (!canWriteCurrentWorld()) return
    if (!get().craftedScenes.some(scene => scene.id === id)) return
    withUndo('Remove crafted', '🗑️', () => {
      set((state) => ({
        craftedScenes: state.craftedScenes.filter(s => s.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
      }))
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id } })
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
    let placedPlacement: CatalogPlacement | null = null
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
      placedPlacement = placement
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
      }))
    })
    if (placedPlacement) {
      worldMutationBus.broadcast({ kind: 'object_added', payload: placedPlacement })
    }
    setTimeout(() => get().saveWorldState(), 100)
    // XP for placing objects
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
  },
  removeCatalogAsset: (id) => {
    if (!canWriteCurrentWorld()) return
    const asset = get().placedCatalogAssets.find(a => a.id === id)
    if (!asset) return
    withUndo(`Delete ${asset?.name || 'object'}`, '🗑️', () => {
      set(state => ({
        placedCatalogAssets: state.placedCatalogAssets.filter(a => a.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
      }))
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteCatalogPlacement: (placement: CatalogPlacement) => {
    set(state => {
      if (state.placedCatalogAssets.some(existing => existing.id === placement.id)) return state
      return { placedCatalogAssets: [...state.placedCatalogAssets, placement] }
    })
  },
  applyRemoteCatalogRemoval: (id: string) => {
    set(state => ({
      placedCatalogAssets: state.placedCatalogAssets.filter(a => a.id !== id),
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
    }))
  },

  // ─═̷─═̷─📚 SCENE LIBRARY ACTIONS ─═̷─═̷─📚
  // Spatial web primitives: the "website as a place" object layer.
  addSpatialWebObject: (object) => {
    withUndo(`Add ${object.label}`, 'WWW', () => {
      set(state => ({
        spatialWebObjects: [...state.spatialWebObjects, object],
      }))
    })
    get().spawnPlacementVfx(object.position)
    setTimeout(() => get().saveWorldState(), 100)
  },
  placeSpatialWebObjectAt: (object, position) => {
    const placedObject: SpatialWebObject = {
      ...object,
      position: [position[0], object.position?.[1] ?? 1.15, position[2]],
    }
    withUndo(`Place ${object.label}`, 'WWW', () => {
      set(state => ({
        spatialWebObjects: [...state.spatialWebObjects, placedObject],
        placementPending: null,
      }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(placedObject.position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
  },
  updateSpatialWebObject: (id, updates) => {
    set(state => ({
      spatialWebObjects: state.spatialWebObjects.map(object =>
        object.id === id ? { ...object, ...updates } : object,
      ),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },
  setSpatialWebObjectValue: (id, value) => {
    set(state => ({
      spatialWebObjects: state.spatialWebObjects.map(object =>
        object.id === id ? { ...object, value, lastEvent: 'change', lastInteractionAt: new Date().toISOString(), interactionCount: (object.interactionCount || 0) + 1 } : object,
      ),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },
  interactSpatialWebObject: async (id, event = 'press') => {
    const object = get().spatialWebObjects.find(entry => entry.id === id)
    if (!object) return

    const now = new Date().toISOString()
    const effectPosition = resolveSpatialWebObjectPosition(object, get().transforms[id])
    const markInteraction = (updates: Partial<SpatialWebObject> = {}, actualEvent: SpatialWebEventName = event) => {
      set(state => ({
        spatialWebObjects: state.spatialWebObjects.map(entry =>
          entry.id === id
            ? {
                ...entry,
                ...updates,
                lastEvent: actualEvent,
                lastInteractionAt: now,
                interactionCount: (entry.interactionCount || 0) + 1,
              }
            : entry,
        ),
      }))
    }

    const runWorldToolAction = async (
      action: NonNullable<SpatialWebObject['action']>,
      valueForArgs: SpatialWebValue | undefined,
    ): Promise<boolean> => {
      const tool = action.tool?.trim()
      if (!tool || !SPATIAL_WEB_WORLD_TOOL_ALLOWLIST.has(tool)) return false
      const worldId = get().viewingWorldId || get().activeWorldId
      const args = resolveSpatialWorldToolArgs(action, valueForArgs, worldId)

      try {
        const response = await fetch('/api/oasis-tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool, args }),
        })
        const result = await response.json().catch(() => null) as { ok?: boolean } | null
        if (!response.ok || result?.ok === false) return false

        if (tool === 'set_sky' && typeof args.presetId === 'string') {
          set({ worldSkyBackground: args.presetId })
        } else if (tool === 'set_ground_preset' && typeof args.presetId === 'string') {
          set({ groundPresetId: args.presetId })
        } else if (tool === 'paint_ground_tiles' && Array.isArray(args.tiles)) {
          set(state => {
            const nextTiles = { ...state.groundTiles }
            for (const tile of args.tiles as Array<Record<string, unknown>>) {
              if (!tile || typeof tile !== 'object') continue
              const x = Math.floor(Number(tile.x))
              const z = Math.floor(Number(tile.z))
              const presetId = typeof tile.presetId === 'string' ? tile.presetId : typeof args.presetId === 'string' ? args.presetId : ''
              if (!Number.isFinite(x) || !Number.isFinite(z) || !presetId) continue
              nextTiles[`${x},${z}`] = presetId
            }
            return { groundTiles: nextTiles }
          })
        } else if (tool === 'modify_object' && typeof args.objectId === 'string') {
          const objectId = args.objectId
          const behaviorUpdates: Partial<ObjectBehavior> = {}
          if (typeof args.visible === 'boolean') behaviorUpdates.visible = args.visible
          if (typeof args.label === 'string') behaviorUpdates.label = args.label
          if (Object.keys(behaviorUpdates).length > 0) {
            set(state => ({
              behaviors: {
                ...state.behaviors,
                [objectId]: {
                  ...(state.behaviors[objectId] || { visible: true, movement: { type: 'static' as const } }),
                  ...behaviorUpdates,
                },
              },
            }))
          }
        }
        return true
      } catch {
        return false
      }
    }

    const openPortalToWorld = (targetWorldId: string, targetWorldName: string, delayMs: number) => {
      if (typeof window === 'undefined') return
      const sourceWorldId = get().viewingWorldId || get().activeWorldId
      if (!sourceWorldId || sourceWorldId === targetWorldId) return
      const portalPosition: [number, number, number] = [effectPosition[0] + 3, 0, effectPosition[2]]
      const nowIso = new Date().toISOString()
      const schedule = window.setTimeout || globalThis.setTimeout
      schedule(() => {
        const portalGate: PortalGate = {
          id: `portal-${id}-generated-world`,
          variant: 'stargate-vortex',
          label: targetWorldName,
          position: portalPosition,
          rotationY: portalRotationTowardCenter(portalPosition),
          scale: 1,
          width: 2.8,
          height: 3.4,
          direction: 'one-way',
          sourceWorldId,
          targetWorldId,
          targetWorldName,
          action: { type: 'load_world', worldId: targetWorldId, worldName: targetWorldName },
        }
        set(state => ({
          worldRegistry: upsertWorldRegistryMeta(state.worldRegistry, {
            id: targetWorldId,
            name: targetWorldName,
            icon: 'UI',
            visibility: 'unlisted',
            objectCount: 0,
            visitCount: 0,
            createdAt: nowIso,
            lastSavedAt: nowIso,
          }),
          portalGates: [
            ...state.portalGates.filter(gate => gate.id !== portalGate.id),
            portalGate,
          ],
        }))
        get().spawnPlacementVfx(portalPosition)
        if (isBrowser) get().refreshWorldRegistry()
      }, delayMs)
    }

    const openLocalPortalToPortalZero = (delayMs: number) => {
      if (typeof window === 'undefined') return
      const sourceWorldId = get().viewingWorldId || get().activeWorldId
      if (!sourceWorldId || sourceWorldId === WELCOME_HUB_WORLD_ID) return
      const portalPosition: [number, number, number] = [effectPosition[0] + 3, 0, effectPosition[2]]
      const schedule = window.setTimeout || globalThis.setTimeout
      schedule(() => {
        const portalGate: PortalGate = {
          id: `portal-${id}-portal-zero`,
          variant: 'stargate-vortex',
          label: 'Portal Zero',
          position: portalPosition,
          rotationY: portalRotationTowardCenter(portalPosition),
          scale: 1,
          width: 2.8,
          height: 3.4,
          direction: 'one-way',
          sourceWorldId,
          targetWorldId: WELCOME_HUB_WORLD_ID,
          targetWorldName: 'Portal Zero',
          action: { type: 'load_world', worldId: WELCOME_HUB_WORLD_ID, worldName: 'Portal Zero' },
        }
        set(state => ({
          worldRegistry: upsertWorldRegistryMeta(state.worldRegistry, {
            id: WELCOME_HUB_WORLD_ID,
            name: 'Portal Zero',
            icon: '0',
            visibility: 'core',
            objectCount: 0,
            visitCount: 0,
            createdAt: new Date().toISOString(),
            lastSavedAt: new Date().toISOString(),
          }),
          portalGates: [
            ...state.portalGates.filter(gate => gate.id !== portalGate.id),
            portalGate,
          ],
        }))
        get().spawnPlacementVfx(portalPosition)
      }, delayMs)
    }

    if (object.type === 'text') {
      if (object.action?.type === 'create_world_from_google_form') {
        const isTestAltar = object.action.testMode === true
        const generatedUrl = typeof object.generatedWorldUrl === 'string' ? object.generatedWorldUrl : ''
        const generatedWorldId = typeof object.generatedWorldId === 'string' ? object.generatedWorldId : ''
        if (generatedUrl && generatedWorldId) {
          playSpatialWebSound('buttonClick')
          const copied = await copyTextToClipboard(generatedUrl)
          markInteraction({
            statusMessage: copied ? 'COPIED. PORTAL OPENING...' : 'WORLD URL READY. PORTAL OPENING...',
            errorMessage: undefined,
          }, 'press')
          get().spawnPlacementVfx(effectPosition)
          openPortalToWorld(generatedWorldId, object.generatedWorldName || 'Generated form world', 3000)
          setTimeout(() => get().saveWorldState(), 100)
          return
        }

        const currentValue = Array.isArray(object.value)
          ? object.value.join(', ')
          : object.value === null || object.value === undefined
            ? ''
            : String(object.value)
        const promptText = typeof window !== 'undefined'
          ? window.prompt(object.placeholder || object.label, currentValue)
          : null
        if (promptText === null) return
        const formUrl = extractFirstUrl(promptText)
        const answerKey = isTestAltar ? parseTestAnswerKey(promptText) : undefined
        playSpatialWebSound('buttonClick')
        markInteraction({
          value: promptText,
          statusMessage: isTestAltar ? 'BUILDING TEST WORLD' : 'BUILDING WORLD',
          errorMessage: undefined,
          generatedWorldId: undefined,
          generatedWorldName: undefined,
          generatedWorldUrl: undefined,
          generatedQrUrl: undefined,
        }, 'change')

        try {
          const response = await fetch('/api/oasis-tools', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: isTestAltar ? 'create_test_world_from_google_form' : 'create_world_from_google_form',
              args: {
                formUrl,
                visibility: 'unlisted',
                publicBaseUrl: isBrowser ? window.location.origin : undefined,
                ...(answerKey ? { answerKey } : {}),
              },
            }),
          })
          const result = await response.json().catch(() => null) as {
            ok?: boolean
            message?: string
            error?: string
            data?: { worldId?: string; worldName?: string; worldUrl?: string; qrUrl?: string; visibility?: WorldMeta['visibility'] }
          } | null
          if (!response.ok || result?.ok === false || !result?.data?.worldId || !result.data.worldUrl) {
            const message = result?.error || result?.message || `Could not build form world: HTTP ${response.status}`
            markInteraction({ statusMessage: 'Build failed.', errorMessage: message }, 'change')
            playSpatialWebSound('error')
            setTimeout(() => get().saveWorldState(), 100)
            return
          }

          const generatedWorldName = result.data.worldName || 'Generated form world'
          const generatedAt = new Date().toISOString()
          set(state => ({
            worldRegistry: upsertWorldRegistryMeta(state.worldRegistry, {
              id: result.data!.worldId!,
              name: generatedWorldName,
              icon: 'UI',
              visibility: result.data!.visibility || 'unlisted',
              objectCount: 0,
              visitCount: 0,
              createdAt: generatedAt,
              lastSavedAt: generatedAt,
            }),
          }))
          markInteraction({
            value: result.data.worldUrl,
            generatedWorldId: result.data.worldId,
            generatedWorldName,
            generatedWorldUrl: result.data.worldUrl,
            generatedQrUrl: result.data.qrUrl,
            statusMessage: isTestAltar ? 'TEST WORLD BUILT! PORTAL OPENING...' : 'FORMS WORLD BUILT! PORTAL OPENING...',
            errorMessage: undefined,
            submittedAt: new Date().toISOString(),
          }, 'submit')
          playSpatialWebSound('winner')
          get().spawnPlacementVfx(effectPosition)
          openPortalToWorld(result.data.worldId, generatedWorldName, 3000)
          if (isBrowser) get().refreshWorldRegistry()
        } catch (error) {
          markInteraction({
            statusMessage: 'Build failed.',
            errorMessage: error instanceof Error ? error.message : 'Could not build form world.',
          }, 'change')
          playSpatialWebSound('error')
        }
        setTimeout(() => get().saveWorldState(), 100)
        return
      }

      const currentValue = Array.isArray(object.value)
        ? object.value.join(', ')
        : object.value === null || object.value === undefined
          ? ''
          : String(object.value)
      const nextText = typeof window !== 'undefined'
        ? window.prompt(object.placeholder || object.label, currentValue)
        : null
      if (nextText !== null) {
        playSpatialWebSound('buttonClick')
        markInteraction({ value: nextText }, 'change')
        get().spawnPlacementVfx(effectPosition)
        setTimeout(() => get().saveWorldState(), 100)
      }
      return
    }

    const nextValue = getNextSpatialWebValue(object)
    if (nextValue !== undefined) {
      playSpatialWebSound(object.type === 'toggle' || object.type === 'slider' ? 'modeSwitch' : 'buttonClick')
      markInteraction({ value: nextValue }, 'change')
      if (object.action?.type === 'world_tool') {
        const ok = await runWorldToolAction(object.action, nextValue)
        if (ok) get().spawnPlacementVfx(effectPosition)
      }
      setTimeout(() => get().saveWorldState(), 100)
      return
    }

    if (object.type !== 'button') {
      playSpatialWebSound('buttonClick')
      markInteraction()
      setTimeout(() => get().saveWorldState(), 100)
      return
    }

    const action = object.action
    if (action?.type === 'set_value' && action.targetObjectId) {
      playSpatialWebSound('buttonClick')
      set(state => ({
        spatialWebObjects: state.spatialWebObjects.map(entry => {
          if (entry.id === action.targetObjectId) {
            return {
              ...entry,
              value: action.value ?? entry.value ?? null,
              lastEvent: 'change',
              lastInteractionAt: now,
              interactionCount: (entry.interactionCount || 0) + 1,
            }
          }
          if (entry.id === id) {
            return {
              ...entry,
              lastEvent: event,
              lastInteractionAt: now,
              interactionCount: (entry.interactionCount || 0) + 1,
            }
          }
          return entry
        }),
      }))
      setTimeout(() => get().saveWorldState(), 100)
      return
    }

    if (action?.type === 'submit_form' && object.formId) {
      if (object.submittedAt) {
        playSpatialWebSound('modeSwitch')
        return
      }
      playSpatialWebSound('buttonClick')
      const payload = {
        ...buildSpatialWebSubmission(get().spatialWebObjects, object.formId),
        ...(action.destination ? { destination: action.destination } : {}),
      }
      const endpoint = action.endpoint || SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT
      let status = action.successMessage || 'Submitted.'
      let submitSucceeded = false
      let submitResult: SpatialSubmitResponse | null = null

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        submitResult = await response.json().catch(() => null) as SpatialSubmitResponse | null
        if (!response.ok || submitResult?.ok === false) {
          status = submitResult?.error || submitResult?.message || `Submit failed: HTTP ${response.status}`
        } else if (submitResult?.message) {
          status = submitResult.message
          submitSucceeded = true
        } else {
          submitSucceeded = true
        }
      } catch (error) {
        status = error instanceof Error ? `Submit failed: ${error.message}` : 'Submit failed.'
      }

      const grade = submitResult?.data?.grade
      const gradeLines = grade?.details?.length
        ? [
            '',
            `Score: ${grade.correctCount ?? 0}/${grade.totalCount ?? grade.details.length} (${grade.percent ?? 0}%)`,
            ...grade.details.map((detail: { label?: string; correct?: boolean }) => `${detail.correct ? 'OK' : 'MISS'} ${detail.label || 'Question'}`),
          ].join('\n')
        : ''
      const receipt = `${status}${gradeLines}\n\n${summarizeSpatialWebSubmission(payload)}`
      set(state => ({
        spatialWebObjects: state.spatialWebObjects.map(entry => {
          if (entry.formId === object.formId && entry.type === 'output' && entry.id !== id) {
            return { ...entry, value: receipt, submittedAt: payload.submittedAt }
          }
          if (entry.id === id) {
            return {
              ...entry,
              submittedAt: submitSucceeded ? payload.submittedAt : entry.submittedAt,
              lastEvent: 'submit',
              lastInteractionAt: now,
              interactionCount: (entry.interactionCount || 0) + 1,
            }
          }
          return entry
        }),
      }))
      if (submitSucceeded) {
        playSpatialWebSound('winner')
        get().spawnPlacementVfx(effectPosition)
        openLocalPortalToPortalZero(5000)
        if (isBrowser && submitResult?.data?.geminiPrompt) {
          window.dispatchEvent(new CustomEvent('oasis:gemini-live-prompt', {
            detail: { prompt: submitResult.data.geminiPrompt, source: 'spatial-test-submit' },
          }))
        }
      } else {
        playSpatialWebSound('error')
      }
      setTimeout(() => get().saveWorldState(), 100)
      return
    }

    if (action?.type === 'world_tool') {
      playSpatialWebSound('buttonClick')
      markInteraction()
      const ok = await runWorldToolAction(action, object.value)
      if (ok) get().spawnPlacementVfx(effectPosition)
      setTimeout(() => get().saveWorldState(), 100)
      return
    }

    playSpatialWebSound('buttonClick')
    markInteraction()
    get().spawnPlacementVfx(effectPosition)
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeSpatialWebObject: (id) => {
    if (!canWriteCurrentWorld()) return
    const object = get().spatialWebObjects.find(entry => entry.id === id)
    if (!object) return
    withUndo(`Delete ${object?.label || 'spatial web object'}`, 'delete', () => {
      set(state => {
        const nextTransforms = { ...state.transforms }
        delete nextTransforms[id]
        return {
          spatialWebObjects: state.spatialWebObjects.filter(entry => entry.id !== id),
          transforms: nextTransforms,
          selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
          inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
        }
      })
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  seedSpatialWebRsvpDemo: () => {
    const formId = 'hackathon-rsvp-demo'
    const stamp = Date.now()
    const objects: SpatialWebObject[] = [
      {
        id: `spatial-output-title-${stamp}`,
        type: 'output',
        formId,
        label: 'Medellin Coffee RSVP',
        value: 'Tomorrow, 4pm at El Cafetal. Walk the choices, then hit submit.',
        position: [-4.5, 1.7, -5],
        width: 3.2,
        height: 1.15,
        accentColor: '#38bdf8',
      },
      {
        id: `spatial-choice-cancome-${stamp}`,
        type: 'select',
        formId,
        label: 'Can you come?',
        value: '',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'maybe', label: 'Maybe' },
          { value: 'no', label: 'No' },
        ],
        position: [-1.7, 1.2, -5],
        accentColor: '#22c55e',
      },
      {
        id: `spatial-slider-headcount-${stamp}`,
        type: 'slider',
        formId,
        label: 'Headcount',
        value: 1,
        min: 1,
        max: 8,
        step: 1,
        position: [1.2, 1.2, -5],
        width: 2.8,
        accentColor: '#f59e0b',
      },
      {
        id: `spatial-choice-vibe-${stamp}`,
        type: 'select',
        formId,
        label: 'Vibe',
        value: '',
        options: [
          { value: 'chill', label: 'Chill' },
          { value: 'networking', label: 'Networking' },
          { value: 'code-jam', label: 'Code jam' },
        ],
        position: [4, 1.2, -5],
        accentColor: '#a78bfa',
      },
      {
        id: `spatial-multi-bring-${stamp}`,
        type: 'multiselect',
        formId,
        label: 'What will you bring?',
        value: ['laptop'],
        options: [
          { value: 'coffee', label: 'Coffee' },
          { value: 'laptop', label: 'Laptop' },
          { value: 'snacks', label: 'Snacks' },
          { value: 'ideas', label: 'Ideas' },
        ],
        position: [-1.7, 1.2, -2.7],
        width: 3,
        accentColor: '#06b6d4',
      },
      {
        id: `spatial-text-comment-${stamp}`,
        type: 'text',
        formId,
        label: 'Comment',
        value: 'Save me a seat near an outlet.',
        placeholder: 'Say a comment to the wizard',
        position: [1.9, 1.2, -2.7],
        width: 3.9,
        accentColor: '#f472b6',
      },
      {
        id: `spatial-submit-${stamp}`,
        type: 'button',
        formId,
        label: 'Send RSVP',
        description: 'Submits this spatial form.',
        position: [-1.7, 0.95, -0.7],
        width: 2.5,
        height: 0.8,
        accentColor: '#fb7185',
        action: {
          type: 'submit_form',
          successMessage: 'Submitted. See you there.',
        },
      },
      {
        id: `spatial-output-receipt-${stamp}`,
        type: 'output',
        formId,
        label: 'Receipt',
        value: 'Waiting for submit.',
        position: [1.9, 1.2, -0.7],
        width: 3.9,
        height: 1.4,
        accentColor: '#34d399',
      },
    ]

    withUndo('Seed spatial RSVP demo', 'WWW', () => {
      set(state => ({
        spatialWebObjects: [
          ...state.spatialWebObjects.filter(object => object.formId !== formId),
          ...objects,
        ],
      }))
    })
    objects.forEach(object => get().spawnPlacementVfx(object.position))
    setTimeout(() => get().saveWorldState(), 100)
  },

  // ─═̷─═̷─🎨 PAINT STROKE ACTIONS ─═̷─═̷─🎨
  // Strokes are flat point lists rebuilt into TubeGeometry/Line on render.
  // Local writer adds + saves; applyRemote* paths skip the save (author saves).
  addPaintStroke: (stroke) => {
    if (!canWriteCurrentWorld()) return
    withUndo('Paint stroke', 'paint', () => {
      set(state => ({ paintStrokes: [...state.paintStrokes, stroke] }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },
  updatePaintStroke: (id, updates) => {
    if (!canWriteCurrentWorld()) return
    const clean = sanitizePaintStrokeUpdates(updates)
    if (Object.keys(clean).length === 0) return
    withUndo('Update stroke', 'paint', () => {
      set(state => ({
        paintStrokes: state.paintStrokes.map(stroke => stroke.id === id ? { ...stroke, ...clean } : stroke),
      }))
    })
    worldMutationBus.broadcast({ kind: 'stroke_updated', payload: { id, updates: clean } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  removePaintStroke: (id) => {
    if (!canWriteCurrentWorld()) return
    if (!get().paintStrokes.some(stroke => stroke.id === id)) return
    withUndo('Delete stroke', 'delete', () => {
      set(state => ({
        paintStrokes: state.paintStrokes.filter(s => s.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
      }))
    })
    worldMutationBus.broadcast({ kind: 'stroke_removed', payload: { id } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemotePaintStroke: (stroke) => {
    set(state => {
      if (state.paintStrokes.some(existing => existing.id === stroke.id)) return state
      return { paintStrokes: [...state.paintStrokes, stroke] }
    })
  },
  applyRemotePaintStrokeUpdated: (id, updates) => {
    const clean = sanitizePaintStrokeUpdates(updates)
    if (Object.keys(clean).length === 0) return
    set(state => ({
      paintStrokes: state.paintStrokes.map(stroke => stroke.id === id ? { ...stroke, ...clean } : stroke),
    }))
  },
  applyRemotePaintStrokeRemoval: (id) => {
    set(state => ({
      paintStrokes: state.paintStrokes.filter(s => s.id !== id),
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
    }))
  },
  playPaintStroke: (id, durationSec, loop = false) => {
    set(state => ({
      paintStrokePlayback: {
        ...state.paintStrokePlayback,
        [id]: { progress: 0, durationSec: Math.max(0.5, durationSec), startedAt: performance.now(), loop },
      },
    }))
  },
  setPaintStrokePlaybackProgress: (id, progress) => {
    set(state => {
      const entry = state.paintStrokePlayback?.[id]
      if (!entry) return state
      return {
        paintStrokePlayback: { ...state.paintStrokePlayback, [id]: { ...entry, progress } },
      }
    })
  },
  stopPaintStrokePlayback: (id) => {
    set(state => {
      if (!state.paintStrokePlayback?.[id]) return state
      const next = { ...state.paintStrokePlayback }
      delete next[id]
      return { paintStrokePlayback: next }
    })
  },

  // ─═̷─═̷─📜 TEXT 3D ACTIONS ─═̷─═̷─📜
  addText3dObject: (object) => {
    if (!canWriteCurrentWorld()) return
    withUndo('Place 3D text', 'text', () => {
      set(state => ({ text3dObjects: [...state.text3dObjects, object] }))
    })
    worldMutationBus.broadcast({ kind: 'text3d_added', payload: object })
    get().spawnPlacementVfx(object.position)
    setTimeout(() => get().saveWorldState(), 100)
  },
  updateText3dObject: (id, updates) => {
    if (!canWriteCurrentWorld()) return
    withUndo('Update 3D text', 'text', () => {
      set(state => ({
        text3dObjects: state.text3dObjects.map(t => t.id === id ? { ...t, ...updates } : t),
      }))
    })
    worldMutationBus.broadcast({ kind: 'text3d_updated', payload: { id, updates } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeText3dObject: (id) => {
    if (!canWriteCurrentWorld()) return
    if (!get().text3dObjects.some(object => object.id === id)) return
    withUndo('Delete 3D text', 'delete', () => {
      set(state => ({
        text3dObjects: state.text3dObjects.filter(t => t.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
      }))
    })
    worldMutationBus.broadcast({ kind: 'text3d_removed', payload: { id } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteText3dAdded: (object) => {
    set(state => {
      if (state.text3dObjects.some(existing => existing.id === object.id)) return state
      return { text3dObjects: [...state.text3dObjects, object] }
    })
  },
  applyRemoteText3dUpdated: (id, updates) => {
    set(state => ({
      text3dObjects: state.text3dObjects.map(t => t.id === id ? { ...t, ...updates } : t),
    }))
  },
  applyRemoteText3dRemoved: (id) => {
    set(state => ({
      text3dObjects: state.text3dObjects.filter(t => t.id !== id),
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
    }))
  },

  // ─═̷─═̷─📖 SPELLBOOK ACTIONS ─═̷─═̷─📖
  setSelectedSpellId: (id) => set({ selectedSpellId: id }),

  // ─═̷─═̷─🎨 PAINT TOOL UI ACTIONS ─═̷─═̷─🎨
  setPaintBrushPanelOpen: (open) => {
    // Mutual exclusion: opening the paint wand retracts the terrain brush
    // (both want canvas pointer events + the InputManager 'paint' state).
    // Also exit any in-progress ground-paint or sculpt mode + cancel a
    // pending object placement.
    set(open ? {
      paintBrushPanelOpen: true,
      terrainBrushPanelOpen: false,
      paintMode: false,
      paintBrushPresetId: null,
      terrainBrushMode: 'texture' as TerrainBrushMode,
      placementPending: null,
    } : { paintBrushPanelOpen: false })
  },
  setText3dPanelOpen: (open) => set({ text3dPanelOpen: open }),
  setPaintHeldActive: (active) => {
    if (active && !canWriteCurrentWorld()) {
      set({ paintHeldActive: false })
      return
    }
    set({ paintHeldActive: active })
    // The wand is an overlay on the current base camera mode, not its own
    // camera state. Third-person stays third-person; noclip stays noclip.
    // Scene.tsx performs the only allowed auto-switch: orbit -> noclip.
    // PaintBrushPanel deliberately doesn't push a UI layer, so pointer lock
    // can be requested here when the active base mode supports it.
    try {
      const im = require('../lib/input-manager').useInputManager.getState()
      if (active) {
        im.requestPointerLock()
      } else if (im.inputState === 'paint') {
        // Cleanup for older sessions that may still have entered the legacy
        // temporary paint state.
        im.returnToPrevious()
      }
    } catch { /* noop in non-browser contexts */ }
  },
  updatePaintBrushSettings: (updates) => set(state => ({ paintBrushSettings: { ...state.paintBrushSettings, ...updates } })),
  updateText3dSettings: (updates) => set(state => ({ text3dSettings: { ...state.text3dSettings, ...updates } })),

  placePortalGateAt: ({ variant, label, action, targetWorldId, targetWorldName, direction = 'two-way', position }) => {
    const activeWorldId = get().activeWorldId
    const activeWorldName = get().worldRegistry.find(world => world.id === activeWorldId)?.name || 'This world'
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const gateId = `portal-${stamp}-a`
    const resolvedTargetWorldId = action?.type === 'load_world' ? action.worldId : targetWorldId
    const resolvedTargetWorldName = action?.type === 'load_world' ? action.worldName : targetWorldName
    const resolvedAction = action || (resolvedTargetWorldId
      ? { type: 'load_world' as const, worldId: resolvedTargetWorldId, worldName: resolvedTargetWorldName }
      : undefined)
    const linkedPortalId = direction === 'two-way' && resolvedTargetWorldId ? `portal-${stamp}-b` : undefined
    const gate: PortalGate = {
      id: gateId,
      variant,
      label,
      position,
      rotationY: 0,
      scale: 1,
      width: 2.4,
      height: 3.2,
      direction,
      sourceWorldId: activeWorldId,
      targetWorldId: resolvedTargetWorldId,
      targetWorldName: resolvedTargetWorldName,
      action: resolvedAction,
      linkedPortalId,
      inert: !resolvedAction && !resolvedTargetWorldId,
    }

    withUndo(`Place portal${resolvedTargetWorldName ? ` to ${resolvedTargetWorldName}` : ''}`, 'portal', () => {
      set(state => ({
        portalGates: [...state.portalGates, gate],
        placementPending: null,
      }))
    })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)

    if (direction === 'two-way' && resolvedTargetWorldId && linkedPortalId) {
      void (async () => {
        const targetState = await loadWorld(resolvedTargetWorldId)
        if (!targetState) return
        if ((targetState.portalGates || []).some(existing => existing.id === linkedPortalId || existing.linkedPortalId === gateId)) return
        const existingTargetGates = targetState.portalGates || []
        const returnPosition: [number, number, number] = [30, 0, 0]
        const returnGate: PortalGate = {
          id: linkedPortalId,
          variant,
          position: returnPosition,
          rotationY: portalRotationTowardCenter(returnPosition),
          scale: 1,
          width: 2.4,
          height: 3.2,
          direction: 'two-way',
          sourceWorldId: resolvedTargetWorldId,
          targetWorldId: activeWorldId,
          targetWorldName: activeWorldName,
          action: { type: 'load_world', worldId: activeWorldId, worldName: activeWorldName },
          linkedPortalId: gateId,
          autoLayout: 'portal-area',
        }
        const { version: _version, savedAt: _savedAt, ...targetSaveState } = targetState
        await saveWorld({
          ...targetSaveState,
          portalGates: layoutPortalAreaGates(
            [...existingTargetGates, returnGate],
            targetState.transforms,
          ),
        }, resolvedTargetWorldId)
      })()
    }

    awardXp('PLACE_CATALOG_OBJECT', activeWorldId)
    return gateId
  },

  removePortalGate: (id) => {
    if (!canWriteCurrentWorld()) return
    const gate = get().portalGates.find(portal => portal.id === id)
    if (!gate) return
    withUndo('Delete portal', 'portal', () => {
      set(state => ({
        portalGates: state.portalGates.filter(portal => portal.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
      }))
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id } })
    setTimeout(() => get().saveWorldState(), 100)

    if (gate?.direction === 'two-way' && gate.targetWorldId && gate.linkedPortalId) {
      void (async () => {
        const targetState = await loadWorld(gate.targetWorldId)
        if (!targetState?.portalGates?.length) return
        const { version: _version, savedAt: _savedAt, ...targetSaveState } = targetState
        await saveWorld({
          ...targetSaveState,
          portalGates: targetState.portalGates.filter(portal => portal.id !== gate.linkedPortalId),
        }, gate.targetWorldId)
      })()
    }
  },
  updatePortalGate: (id, updates) => {
    const gate = get().portalGates.find(portal => portal.id === id)
    if (!gate) return
    withUndo('Update portal', 'portal', () => {
      set(state => ({
        portalGates: state.portalGates.map(portal => (
          portal.id === id ? { ...portal, ...updates, id: portal.id } : portal
        )),
      }))
    })
    setTimeout(() => get().saveWorldState(), 100)
  },

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
      // ░▒▓ EAGER POINTER-LOCK ON PLACEMENT ENTRY (Approach A) ▓▒░
      // Lock the cursor NOW, while we're still inside the user-gesture
      // stack from the originating "Place" click. Without this, the lock
      // would race with the user's first canvas click and the click would
      // land at screen-center (where the crosshair appears) instead of
      // wherever they thought they were clicking.
      //
      // CRITICAL: only lock if the PRE-placement camera mode supported
      // pointer-lock (TPS / noclip). For orbit users, lock would surprise
      // them — they expect to keep their mouse cursor visible. transition()
      // already stashed the prior mode in _previousCameraState; we read that
      // here (NOT im.can() which now reads placement's capabilities).
      const prevCameraState = im._previousCameraState
      const prevAllowedLock = prevCameraState === 'noclip' || prevCameraState === 'third-person'
      if (!im.pointerLocked && prevAllowedLock) im.requestPointerLock()
    } catch {}
  },
  cancelPlacement: () => {
    set({ placementPending: null })
    try { require('../lib/input-manager').useInputManager.getState().returnToPrevious() } catch {}
  },

  placeCatalogAssetAt: (catalogId, name, path, defaultScale, position) => {
    let placedId = ''
    let placedPlacement: CatalogPlacement | null = null
    withUndo(`Place ${name}`, '📦', () => {
      placedId = `catalog-${catalogId}-${Date.now()}`
      const placement: CatalogPlacement = { id: placedId, catalogId, name, glbPath: path, position, scale: defaultScale }
      placedPlacement = placement
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
        placementPending: null,
      }))
    })
    if (placedPlacement) {
      worldMutationBus.broadcast({ kind: 'object_added', payload: placedPlacement })
    }
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
    return placedId
  },

  placeImageAt: (name, imageUrl, position, frameStyle, frameThickness) => {
    let placedPlacement: CatalogPlacement | null = null
    withUndo(`Place ${name}`, '🖼️', () => {
      const id = `image-${Date.now()}`
      // ─═̷─ 4-sided building style spawns a textured cube. Default scale 1
      // produced a 1m³ doll-house. Bump to 5 so the building is human-scale
      // when a visitor walks up to it. Plain framed images stay at scale 1. ─═̷─
      const placementScale = frameStyle === 'building' ? 5 : 1
      const placement: CatalogPlacement = { id, catalogId: 'generated-image', name, glbPath: '', position, scale: placementScale, imageUrl, ...(frameStyle && { imageFrameStyle: frameStyle }), ...(frameThickness !== undefined && { imageFrameThickness: frameThickness }) }
      placedPlacement = placement
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
        placementPending: null,
      }))
    })
    if (placedPlacement) {
      // Skip broadcast if the imageUrl is a local-only `blob:` URL (peers
      // can't resolve it) or an oversized `data:` URL (~hundreds of KB of
      // base64 over the WS for every peer). Stripping the URL would render
      // a broken frame on peers; skipping the broadcast entirely lets peers
      // pick it up on next world reload via the normal save.
      const url = (placedPlacement as CatalogPlacement).imageUrl || ''
      const isLocalOnly = url.startsWith('blob:') || (url.startsWith('data:') && url.length > 16 * 1024)
      if (!isLocalOnly) {
        worldMutationBus.broadcast({ kind: 'object_added', payload: placedPlacement })
      } else {
        console.info('[oasis-bus] skipping image broadcast (local-only URL): kind=', url.startsWith('blob:') ? 'blob' : 'oversize-data')
      }
    }
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('PLACE_CATALOG_OBJECT', get().activeWorldId)
  },

  placeVideoAt: (name: string, videoUrl: string, position: [number, number, number], frameStyle?: string, frameThickness?: number) => {
    let placedPlacement: CatalogPlacement | null = null
    withUndo(`Place video ${name}`, '🎬', () => {
      const id = `video-${Date.now()}`
      const placement: CatalogPlacement = { id, catalogId: 'video', name, glbPath: '', position, scale: 2, videoUrl, ...(frameStyle && { imageFrameStyle: frameStyle }), ...(frameThickness !== undefined && { imageFrameThickness: frameThickness }) }
      placedPlacement = placement
      set(state => ({
        placedCatalogAssets: [...state.placedCatalogAssets, placement],
        placementPending: null,
      }))
    })
    if (placedPlacement) {
      // Same local-only URL guard as placeImageAt.
      const url = (placedPlacement as CatalogPlacement).videoUrl || ''
      const isLocalOnly = url.startsWith('blob:') || (url.startsWith('data:') && url.length > 16 * 1024)
      if (!isLocalOnly) {
        worldMutationBus.broadcast({ kind: 'object_added', payload: placedPlacement })
      } else {
        console.info('[oasis-bus] skipping video broadcast (local-only URL)')
      }
    }
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

  spawnPlacementVfx: (position, typeOverride) => {
    const { placementVfxType, placementVfxDuration } = get()
    const requestedType = typeOverride === 'random' || (typeOverride && PLACEMENT_VFX_LIST.includes(typeOverride as Exclude<PlacementVfxType, 'random'>))
      ? typeOverride
      : placementVfxType
    const resolvedType = requestedType === 'random'
      ? PLACEMENT_VFX_LIST[Math.floor(Math.random() * PLACEMENT_VFX_LIST.length)]
      : requestedType
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

  openObjectOverlay: (overlay) => {
    set({
      activeObjectOverlay: {
        ...overlay,
        opacity: Math.max(0.35, Math.min(0.96, overlay.opacity || 0.8)),
      },
    })
    playSpatialWebSound('panelOpen')
  },

  closeObjectOverlay: () => {
    if (!get().activeObjectOverlay) return
    set({ activeObjectOverlay: null })
    playSpatialWebSound('panelClose')
  },

  interactObject: async (id) => {
    const state = get()
    const behavior = state.behaviors[id]
    const interaction = behavior?.interaction
    if (!interaction || !Array.isArray(interaction.actions) || interaction.actions.length === 0) return

    const firstOverlay = interaction.actions.find((action): action is Extract<ObjectInteractionAction, { type: 'html_overlay' }> => action.type === 'html_overlay')
    if (firstOverlay && state.activeObjectOverlay?.objectId === id) {
      get().closeObjectOverlay()
      return
    }

    const position = resolveObjectPosition(state, id)
    const title = resolveObjectLabel(state, id)
    let behaviorChanged = false

    for (const action of interaction.actions) {
      if (action.type === 'html_overlay') {
        get().openObjectOverlay({
          objectId: id,
          title: action.title || title,
          url: action.url,
          html: action.html,
          opacity: action.opacity ?? 0.8,
        })
        continue
      }

      if (action.type === 'api_call') {
        try {
          await fetch(action.endpoint, {
            method: action.method || 'POST',
            headers: action.method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: action.method === 'GET' ? undefined : JSON.stringify(action.body || {}),
          })
        } catch {
          playSpatialWebSound('error')
        }
        continue
      }

      if (action.type === 'spawn_vfx') {
        get().spawnPlacementVfx(action.position || position, action.vfxType as PlacementVfxType | undefined)
        continue
      }

      if (action.type === 'audio_toggle') {
        set(current => {
          const existing = current.behaviors[id] || { visible: true, movement: { type: 'static' as const } }
          const currentAudioUrl = action.audioUrl || existing.audioUrl
          const nextState = existing.audioState === 'playing' && (!action.audioUrl || action.audioUrl === existing.audioUrl)
            ? 'paused'
            : 'playing'
          return {
            behaviors: {
              ...current.behaviors,
              [id]: {
                ...existing,
                ...(currentAudioUrl ? { audioUrl: currentAudioUrl } : {}),
                ...(typeof action.loop === 'boolean' ? { audioLoop: action.loop } : {}),
                ...(typeof action.volume === 'number' ? { audioVolume: Math.max(0, Math.min(1, action.volume)) } : {}),
                audioState: nextState,
              },
            },
          }
        })
        behaviorChanged = true
        continue
      }

      if (action.type === 'focus_agent_window') {
        const directWindowId = action.windowId || (state.placedAgentWindows.some(window => window.id === id) ? id : undefined)
        const linkedWindowId = directWindowId
          || state.placedAgentAvatars.find(avatar => avatar.id === id)?.linkedWindowId
        if (linkedWindowId && state.placedAgentWindows.some(window => window.id === linkedWindowId)) {
          get().focusAgentWindow(linkedWindowId)
        }
        continue
      }

      if (action.type === 'spell' && isBrowser) {
        window.dispatchEvent(new CustomEvent(`oasis:cast-${action.spellId}`, { detail: { objectId: id } }))
        window.dispatchEvent(new CustomEvent('oasis:open-spelltab', { detail: { spellId: action.spellId, objectId: id } }))
      }
    }

    if (behaviorChanged) setTimeout(() => get().saveWorldState(), 100)
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
          // ─═̷─ Agent avatars used to spawn at 25% size and grow over 1.5s,
          // which made every agent look like a kid for the first beat. Spawn
          // at full size; the "reveal" still runs but with no visible scale
          // change — keeps any downstream phase-aware code happy. ─═̷─
          minScale: 1.0,
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
  setTerrainBrushPanelOpen: (terrainBrushPanelOpen) => {
    set({
      terrainBrushPanelOpen,
      // Mutual exclusion: opening the terrain brush retracts the paint wand
      // (both compete for canvas pointer events; the InputManager 'paint'
      // state would also collide). Closing terrain leaves paint untouched.
      ...(terrainBrushPanelOpen ? { paintBrushPanelOpen: false, paintHeldActive: false } : {
        terrainBrushMode: 'texture' as TerrainBrushMode,
        paintMode: false,
        paintBrushPresetId: null,
      }),
    })
    if (!terrainBrushPanelOpen) {
      try { require('../lib/input-manager').useInputManager.getState().returnToPrevious() } catch {}
    }
  },
  setTerrainBrushMode: (terrainBrushMode) => {
    if (terrainBrushMode === 'sculpt') {
      set({
        terrainBrushMode,
        terrainBrushPanelOpen: true,
        paintMode: false,
        paintBrushPresetId: null,
        placementPending: null,
      })
      try { require('../lib/input-manager').useInputManager.getState().transition('paint') } catch {}
      return
    }
    set({ terrainBrushMode, terrainBrushPanelOpen: true })
  },
  setTerrainBrushIntensity: (terrainBrushIntensity) => {
    set({ terrainBrushIntensity: Math.max(0.1, Math.min(8, terrainBrushIntensity)) })
  },
  setTerrainBrushRadius: (terrainBrushRadius) => {
    set({ terrainBrushRadius: Math.max(1, Math.min(10, terrainBrushRadius)) })
  },
  setTerrainBrushDirection: (terrainBrushDirection) => set({ terrainBrushDirection }),
  sculptTerrainAt: (x, z, deltaSeconds) => {
    const s = get()
    const radius = s.terrainBrushRadius
    const intensity = s.terrainBrushIntensity
    const direction = s.terrainBrushDirection
    set(state => ({
      terrainHeights: applyTerrainBrush(state.terrainHeights, x, z, {
        radius,
        intensity,
        direction,
        deltaSeconds,
      }),
    }))
    // Real-time multiplayer terrain. Broadcast the brush OPERATION not the
    // full heights array (the array is too big for the bus 16KiB cap and
    // most ticks change only a small neighborhood). Receivers re-run the
    // same applyTerrainBrush call against their local heights — deterministic
    // given the same inputs. Throttle to ~15Hz client-side to keep within
    // the room's 30/s sustained rate limit when multiple users brush at once.
    const now = Date.now()
    if (now - terrainBroadcastClock.lastAt > 65) {
      terrainBroadcastClock.lastAt = now
      worldMutationBus.broadcast({
        kind: 'terrain_brushed',
        payload: { x, z, radius, intensity, direction, deltaSeconds },
      })
    }
  },
  applyRemoteTerrainBrush: (
    x: number,
    z: number,
    radius: number,
    intensity: number,
    direction: TerrainBrushDirection,
    deltaSeconds: number,
  ) => {
    set(state => ({
      terrainHeights: applyTerrainBrush(state.terrainHeights, x, z, {
        radius,
        intensity,
        direction,
        deltaSeconds,
      }),
    }))
  },
  resetTerrainHeights: () => {
    withUndo('Reset relief', 'terrain', () => set({ terrainHeights: createFlatTerrainHeights() }))
    worldMutationBus.broadcast({ kind: 'terrain_reset', payload: {} })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteTerrainReset: () => {
    set({ terrainHeights: createFlatTerrainHeights() })
  },
  setGroundPreset: (groundPresetId) => {
    set({ groundPresetId })
    worldMutationBus.broadcast({ kind: 'ground_changed', payload: { groundPresetId } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteGroundChange: (groundPresetId: string) => {
    set({ groundPresetId })
  },
  // ─═̷─═̷─🎨 PAINT MODE — tile-by-tile ground painting ─═̷─═̷─🎨
  enterPaintMode: (presetId) => {
    set({ paintMode: true, paintBrushPresetId: presetId, terrainBrushPanelOpen: true, terrainBrushMode: 'texture', placementPending: null })
    try { require('../lib/input-manager').useInputManager.getState().transition('paint') } catch {}
  },
  exitPaintMode: () => {
    set({ paintMode: false, paintBrushPresetId: null })
    try { require('../lib/input-manager').useInputManager.getState().returnToPrevious() } catch {}
  },
  setPaintBrushSize: (size) => {
    set({ paintBrushSize: Math.max(1, Math.min(5, size)) })
  },
  setPaintBrushStretch: (stretch) => {
    // Lock to powers of 2 within 1..8 — matches the UI choices.
    const valid = [1, 2, 4, 8]
    const clamped = valid.includes(stretch) ? stretch : 1
    set({ paintBrushStretch: clamped })
  },
  paintGroundArea: (cx, cz) => {
    const { paintBrushPresetId, paintBrushSize, paintBrushStretch, groundTiles } = get()
    if (!paintBrushPresetId) return
    const stretch = Math.max(1, Math.floor(paintBrushStretch || 1))
    // ─═̷─ Stretched brush stride: each cell renders at stretchxstretch m, so
    // we paint at stride=stretch and snap the center to that lattice. Brush
    // footprint expands accordingly: 3x3 brush @ 2x stretch → 3x3 grid of 2m
    // cells = 6m covered area. ─═̷─
    const half = Math.floor(paintBrushSize / 2)
    const newTiles = { ...groundTiles }
    // Snap center to the stretch lattice so neighbor tiles align cleanly.
    const baseX = Math.floor(cx / stretch) * stretch
    const baseZ = Math.floor(cz / stretch) * stretch
    // Cell value encoding: bare presetId for stretch=1 (back-compat with all
    // existing saves), `presetId@stretch` for stretch>1.
    const cellValue = stretch === 1 ? paintBrushPresetId : `${paintBrushPresetId}@${stretch}`
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const tx = baseX + dx * stretch
        const tz = baseZ + dz * stretch
        if (tx < -50 || tx > 49 || tz < -50 || tz > 49) continue
        newTiles[`${tx},${tz}`] = cellValue
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
      // Dedupe by id — manual generations call this directly while the SSE
      // mirror also fires from /api/imagine; first-write-wins.
      if (s.generatedImages.some(g => g.id === image.id)) return s
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
    const isUndoable = partial.movement || partial.animation || Object.prototype.hasOwnProperty.call(partial, 'interaction') || partial.visible !== undefined || partial.label !== undefined
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
    worldMutationBus.broadcast({
      kind: 'object_transformed',
      payload: { id, position: transform.position, rotation: transform.rotation, scale: transform.scale },
    })
    // Use the canonical saveWorldState — never assemble payload manually
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteObjectTransform: (
    id: string,
    transform: { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number },
  ) => {
    // Mirror the local-write branch in setObjectTransform: agent-avatar IDs
    // route through setAgentAvatarTransform; everything else writes to the
    // transforms map. Without this, remote-moved agent avatars desync —
    // their `transforms` row updates but their visible position doesn't.
    if (get().placedAgentAvatars.some(avatar => avatar.id === id)) {
      get().setAgentAvatarTransform(id, transform)
      return
    }
    set(state => ({ transforms: { ...state.transforms, [id]: transform } }))
  },
  // ─═̷─═̷─🌅 SKY — per-world sky preset ─═̷─═̷─🌅
  setWorldSkyBackground: (id) => {
    set({ worldSkyBackground: id })
    worldMutationBus.broadcast({ kind: 'sky_changed', payload: { skyBackgroundId: id } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteSkyChange: (skyBackgroundId: string) => {
    set({ worldSkyBackground: skyBackgroundId })
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
    let addedLight: WorldLight | null = null
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
      addedLight = light
      set(s => ({ worldLights: [...s.worldLights, light] }))
    })
    if (addedLight) worldMutationBus.broadcast({ kind: 'light_added', payload: { light: addedLight } })
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('ADD_LIGHT', get().activeWorldId)
  },
  placeLightAt: (type, position) => {
    let addedLight: WorldLight | null = null
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
      addedLight = light
      set(s => ({ worldLights: [...s.worldLights, light], placementPending: null }))
    })
    if (addedLight) worldMutationBus.broadcast({ kind: 'light_added', payload: { light: addedLight } })
    exitPlacementIfActive()
    get().spawnPlacementVfx(position)
    setTimeout(() => get().saveWorldState(), 100)
    awardXp('ADD_LIGHT', get().activeWorldId)
  },
  removeWorldLight: (id) => {
    if (!canWriteCurrentWorld()) return
    if (!get().worldLights.some(light => light.id === id)) return
    withUndo('Remove light', '🗑️', () => {
      set(s => ({
        worldLights: s.worldLights.filter(l => l.id !== id),
        selectedObjectId: s.selectedObjectId === id ? null : s.selectedObjectId,
        inspectedObjectId: s.inspectedObjectId === id ? null : s.inspectedObjectId,
      }))
    })
    worldMutationBus.broadcast({ kind: 'light_removed', payload: { id } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  updateWorldLight: (id, updates) => {
    set(s => ({
      worldLights: s.worldLights.map(l => l.id === id ? { ...l, ...updates } : l),
    }))
    worldMutationBus.broadcast({ kind: 'light_updated', payload: { id, updates } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  setWorldLightTransform: (id, position) => {
    set(s => ({
      worldLights: s.worldLights.map(l => l.id === id ? { ...l, position } : l),
    }))
    worldMutationBus.broadcast({ kind: 'light_updated', payload: { id, updates: { position } } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  applyRemoteLightAdded: (light: WorldLight) => {
    set(state => {
      if (state.worldLights.some(l => l.id === light.id)) return state
      return { worldLights: [...state.worldLights, light] }
    })
  },
  applyRemoteLightRemoved: (id: string) => {
    set(state => ({ worldLights: state.worldLights.filter(l => l.id !== id) }))
  },
  applyRemoteLightUpdated: (id: string, updates: Partial<WorldLight>) => {
    set(state => ({
      worldLights: state.worldLights.map(l => l.id === id ? { ...l, ...updates } : l),
    }))
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
          terrainHeights: createFlatTerrainHeights(),
          groundPresetId: 'none',
          groundTiles: {},
          craftedScenes: [],
          worldConjuredAssetIds: [],
          placedCatalogAssets: [],
          portalGates: [],
          spatialWebObjects: [],
          paintStrokes: [],
          text3dObjects: [],
          paintStrokePlayback: {},
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
      const portalGates = resolveDefaultPortalGates(get().activeWorldId, world.portalGates, world.transforms)
      const spatialWebObjects = resolveDefaultSpatialWebObjects(get().activeWorldId, world.spatialWebObjects)
      const loadedObjCount = (world.conjuredAssetIds?.length || 0) + (world.catalogPlacements?.length || 0) + (world.craftedScenes?.length || 0) + portalGates.length + spatialWebObjects.length + (world.paintStrokes?.length || 0) + (world.text3dObjects?.length || 0)
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
        terrainHeights: normalizeTerrainHeights(world.terrainHeights),
        groundPresetId: world.groundPresetId || 'none',
        groundTiles: world.groundTiles || {},
        craftedScenes: world.craftedScenes || [],
        worldConjuredAssetIds: world.conjuredAssetIds || [],
        placedCatalogAssets: world.catalogPlacements || [],
        portalGates,
        spatialWebObjects,
        paintStrokes: world.paintStrokes || [],
        text3dObjects: world.text3dObjects || [],
        paintStrokePlayback: {},
        transforms: normalizedAgentWorldState.transforms,
        behaviors: world.behaviors || {},
        worldLights: lights,
        worldSkyBackground: world.skyBackgroundId || 'night007',
        customGroundPresets: mergedCustom,
        placedAgentWindows: normalizedAgentWorldState.windows,
        placedAgentAvatars: normalizedAgentWorldState.avatars,
        liveAgentAvatarAudio: {},
      })
      if ((sanitizedAgentAvatars.changed || normalizedAgentWorldState.changed) && !get().isViewMode && canWriteCurrentWorld()) {
        console.warn('[World] Repaired invalid agent avatar URLs while loading the active world.')
        void saveWorld({
          terrain: world.terrain || null,
          terrainHeights: normalizeTerrainHeights(world.terrainHeights),
          groundPresetId: world.groundPresetId || 'none',
          groundTiles: world.groundTiles || {},
          craftedScenes: world.craftedScenes || [],
          conjuredAssetIds: world.conjuredAssetIds || [],
          catalogPlacements: world.catalogPlacements || [],
          portalGates,
          spatialWebObjects,
          paintStrokes: world.paintStrokes || [],
          text3dObjects: world.text3dObjects || [],
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
    // Don't save read-only viewed worlds, but do save open-build worlds.
    if (get().isViewMode && !get().isViewModeEditable) return
    if (!canWriteCurrentWorld()) return
    // Skip saves while applying a remote update — prevents echo loop
    if (get()._isReceivingRemoteUpdate) return
    // ░▒▓ CRITICAL GUARD: never save until world has loaded from server ▓▒░
    if (!get()._worldReady) {
      console.warn('[World] ⚠️ Save blocked — world not loaded yet (preventing empty-state overwrite)')
      return
    }
    const { terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms, behaviors, worldLights, worldSkyBackground, viewingWorldId, customGroundPresets, placedAgentWindows, placedAgentAvatars, _loadedObjectCount } = get()
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
    const currentObjCount = (worldConjuredAssetIds?.length || 0) + (placedCatalogAssets?.length || 0) + (craftedScenes?.length || 0) + (portalGates?.length || 0) + (spatialWebObjects?.length || 0) + (paintStrokes?.length || 0) + (text3dObjects?.length || 0)
    const latestUndo = get().undoStack[get().undoStack.length - 1]
    const zeroSaveIsExplicitEdit = Boolean(latestUndo && /delete|remove|clear/i.test(latestUndo.label))
    if (_loadedObjectCount >= 5 && currentObjCount === 0 && !zeroSaveIsExplicitEdit) {
      console.error(`[World] 🚨 NUKE BLOCKED — loaded ${_loadedObjectCount} objects but trying to save 0. This is the anorak2 protection.`)
      return
    }

    // Only include customGroundPresets in save if any tiles reference them
    const usedCustomIds = new Set(Object.values(groundTiles).filter(id => id.startsWith('custom_')))
    const relevantCustom = customGroundPresets.filter(p => usedCustomIds.has(p.id))
    const worldState = {
      terrain: terrainParams,
      terrainHeights,
      groundPresetId,
      groundTiles,
      craftedScenes,
      conjuredAssetIds: worldConjuredAssetIds,
      catalogPlacements: placedCatalogAssets,
      portalGates,
      spatialWebObjects,
      paintStrokes,
      text3dObjects,
      transforms: normalizedAgentWorldState.transforms,
      behaviors,
      lights: worldLights,
      skyBackgroundId: worldSkyBackground,
      ...(relevantCustom.length > 0 && { customGroundPresets: relevantCustom }),
      agentWindows: normalizedAgentWorldState.windows,
      agentAvatars: normalizedAgentWorldState.avatars,
    }
    // If editing an open-build world, save to THAT world (not user's own).
    if (get().isViewModeEditable && viewingWorldId) {
      saveWorld(worldState, viewingWorldId) // direct save to viewed world
    } else {
      debouncedSaveWorld(worldState)
    }
  },

  // ─═̷─═̷─🌍 MULTI-WORLD ACTIONS ─═̷─═̷─🌍
  switchWorld: (worldId) => {
    const previousActiveWorldId = get().activeWorldId
    const shouldSaveCurrentWorld = get()._worldReady && canWriteCurrentWorld()
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
    if (shouldSaveCurrentWorld) {
      const { terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms, behaviors, worldLights, worldSkyBackground, activeWorldId, placedAgentAvatars, placedAgentWindows } = get()
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: placedAgentWindows,
        avatars: placedAgentAvatars,
        transforms,
      })
      // ░▒▓ Filter out in-progress craft placeholders — objects.length === 0 means
      // the LLM hasn't materialized anything yet. Using objects.length (not name)
      // because the scene name gets updated mid-stream before objects arrive.
      const completedScenes = craftedScenes.filter(s => s.objects.length > 0)
      saveWorld({ terrain: terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes: completedScenes, conjuredAssetIds: worldConjuredAssetIds, catalogPlacements: placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms: normalizedAgentWorldState.transforms, behaviors, lights: worldLights, skyBackgroundId: worldSkyBackground, agentWindows: normalizedAgentWorldState.windows, agentAvatars: normalizedAgentWorldState.avatars }, activeWorldId)
    }

    // ░▒▓ Block saves during transition — prevents empty state nuke ▓▒░
    // Also clear the armed spell — it belonged to the previous world's context.
    set({ _worldReady: false, selectedSpellId: null })

    // Switch to new world
    setActiveWorldId(worldId, { publish: true })
    loadWorld(worldId).then(world => {
      if (!world) {
        console.error(`[World] Switch aborted: "${worldId}" did not load. Keeping "${previousActiveWorldId}".`)
        if (previousActiveWorldId && previousActiveWorldId !== worldId) {
          setActiveWorldId(previousActiveWorldId, { publish: true })
          set({
            _worldReady: true,
            activeWorldId: previousActiveWorldId,
            selectedSpellId: null,
          })
        } else {
          set({ _worldReady: true, selectedSpellId: null })
        }
        return
      }
      // Seed defaults for old worlds that never had lights (lights field undefined)
      const defaultLights: WorldLight[] = DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))
      const lights = world?.lights !== undefined ? (world?.lights || []) : defaultLights
      const portalGates = resolveDefaultPortalGates(worldId, world?.portalGates, world?.transforms)
      const spatialWebObjects = resolveDefaultSpatialWebObjects(worldId, world?.spatialWebObjects)
      const switchObjCount = (world?.conjuredAssetIds?.length || 0) + (world?.catalogPlacements?.length || 0) + (world?.craftedScenes?.length || 0) + portalGates.length + spatialWebObjects.length + (world?.paintStrokes?.length || 0) + (world?.text3dObjects?.length || 0)
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
        terrainHeights: normalizeTerrainHeights(world?.terrainHeights),
        groundPresetId: world?.groundPresetId || 'none',
        groundTiles: world?.groundTiles || {},
        craftedScenes: world?.craftedScenes || [],
        worldConjuredAssetIds: world?.conjuredAssetIds || [],
        placedCatalogAssets: world?.catalogPlacements || [],
        portalGates,
        spatialWebObjects,
        paintStrokes: world?.paintStrokes || [],
        text3dObjects: world?.text3dObjects || [],
        paintStrokePlayback: {},
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

      if (world && (sanitizedAgentAvatars.changed || normalizedAgentWorldState.changed) && canWriteCurrentWorld()) {
        void saveWorld({
          terrain: world.terrain || null,
          terrainHeights: normalizeTerrainHeights(world.terrainHeights),
          groundPresetId: world.groundPresetId || 'none',
          groundTiles: world.groundTiles || {},
          craftedScenes: world.craftedScenes || [],
          conjuredAssetIds: world.conjuredAssetIds || [],
          catalogPlacements: world.catalogPlacements || [],
          portalGates,
          spatialWebObjects,
          paintStrokes: world.paintStrokes || [],
          text3dObjects: world.text3dObjects || [],
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
    if (get()._worldReady && canWriteCurrentWorld()) {
      const { terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms, behaviors, worldLights, worldSkyBackground, activeWorldId, placedAgentAvatars, placedAgentWindows } = get()
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: placedAgentWindows,
        avatars: placedAgentAvatars,
        transforms,
      })
      saveWorld({ terrain: terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes, conjuredAssetIds: worldConjuredAssetIds, catalogPlacements: placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms: normalizedAgentWorldState.transforms, behaviors, lights: worldLights, skyBackgroundId: worldSkyBackground, agentWindows: normalizedAgentWorldState.windows, agentAvatars: normalizedAgentWorldState.avatars }, activeWorldId)
    }

    // Create and switch to new world (async) — seed with default lights so it's not pitch black
    createWorld(name, icon).then(meta => {
      const defaultLights: WorldLight[] = DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))
      setActiveWorldId(meta.id, { publish: true })
      return getWorldRegistry().then(registry => {
        set({
          _worldReady: true,  // New world is "loaded" — it's empty by definition
          _loadedObjectCount: 0,
          activeWorldId: meta.id,
          worldRegistry: registry,
          terrainParams: null,
          terrainHeights: createFlatTerrainHeights(),
          groundPresetId: 'none',
          groundTiles: {},
          craftedScenes: [],
          worldConjuredAssetIds: [],
          placedCatalogAssets: [],
          portalGates: [],
          spatialWebObjects: [],
          paintStrokes: [],
          text3dObjects: [],
          paintStrokePlayback: {},
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
    const [registry, library, serverActiveWorld] = await Promise.all([
      getWorldRegistry(),
      getSceneLibrary(),
      getServerActiveWorld(),
    ])

    // If stored activeWorldId doesn't exist in the registry (e.g. old 'forge-default'
    // from an earlier persistence layout), switch to the first available world
    const currentId = get().activeWorldId
    const worldExists = registry.some(w => w.id === currentId)
    const serverActiveExists = Boolean(serverActiveWorld?.worldId && registry.some(w => w.id === serverActiveWorld.worldId))
    const preferredWorldId = typeof window !== 'undefined' ? window.__oasisPreferredWorldId : undefined
    const preferredWorldExists = Boolean(preferredWorldId && registry.some(w => w.id === preferredWorldId))
    if (preferredWorldId && preferredWorldExists) {
      setActiveWorldId(preferredWorldId, { publish: true })
      set({ worldRegistry: registry, sceneLibrary: library, activeWorldId: preferredWorldId })
    } else if (serverActiveWorld?.authoritative && serverActiveExists) {
      setActiveWorldId(serverActiveWorld.worldId, { publish: true })
      set({ worldRegistry: registry, sceneLibrary: library, activeWorldId: serverActiveWorld.worldId })
    } else if (!worldExists && serverActiveExists && serverActiveWorld?.worldId) {
      setActiveWorldId(serverActiveWorld.worldId, { publish: true })
      set({ worldRegistry: registry, sceneLibrary: library, activeWorldId: serverActiveWorld.worldId })
    } else if (!worldExists && registry.length > 0) {
      const firstWorld = registry[0]
      setActiveWorldId(firstWorld.id, { publish: true })
      set({ worldRegistry: registry, sceneLibrary: library, activeWorldId: firstWorld.id })
    } else {
      set({ worldRegistry: registry, sceneLibrary: library })
    }

    // Load active world state
    get().loadWorldState()
  },

  setAvatar3dUrl: (url) => set({ avatar3dUrl: url || DEFAULT_PROFILE_AVATAR_3D_URL }),

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
    // Keep focused panels above their declared base layer.
    return Math.max(defaultZ, 9990) + order
  },

  // ─═̷─═̷─💻 3D AGENT WINDOWS — place, focus, interact ─═̷─═̷─💻
  addAgentWindow: (window) => {
    // ░▒▓ Agent ownership stamp — the viewer who placed this window claims it. ▓▒░
    // Legacy snapshots may have no ownerId (treated as "open"). Future-placed
    // windows always carry the placer's cookie id so non-owners can see the
    // body/transcript but can't type, connect, or delete via window controls.
    const ownerId = window.ownerId || getViewerUserIdClient()
    set(state => {
      const sharedAvatar = isSharedAgentAvatarType(window.agentType)
        ? state.placedAgentAvatars.find(entry => entry.agentType === window.agentType) || null
        : null
      return ({
      placedAgentWindows: [
        ...state.placedAgentWindows,
        {
          ...window,
          ownerId,
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
    if (!canWriteCurrentWorld()) return
    if (!get().placedAgentWindows.some(window => window.id === id)) return
    let linkedAvatarIds: string[] = []
    set(state => {
      linkedAvatarIds = state.placedAgentAvatars
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
        selectedObjectId: state.selectedObjectId === id || linkedAvatarIdSet.has(state.selectedObjectId || '') ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id || linkedAvatarIdSet.has(state.inspectedObjectId || '') ? null : state.inspectedObjectId,
      }
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id, linkedAvatarIds } })
    setTimeout(() => get().saveWorldState(), 100)
  },
  updateAgentWindow: (id, partial) => {
    set(state => ({
      placedAgentWindows: state.placedAgentWindows.map(w => w.id === id ? { ...w, ...partial } : w),
    }))
    setTimeout(() => get().saveWorldState(), 100)
  },
  removeAgentAvatar: (id) => {
    if (!canWriteCurrentWorld()) return
    if (!get().placedAgentAvatars.some(avatar => avatar.id === id)) return
    set(state => {
      const nextTransforms = { ...state.transforms }
      delete nextTransforms[id]
      const nextAudio = { ...state.liveAgentAvatarAudio }
      delete nextAudio[id]
      return {
        placedAgentAvatars: state.placedAgentAvatars.filter(a => a.id !== id),
        placedAgentWindows: state.placedAgentWindows.map(w =>
          w.linkedAvatarId === id ? { ...w, linkedAvatarId: undefined } : w,
        ),
        transforms: nextTransforms,
        liveAgentAvatarAudio: nextAudio,
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
        inspectedObjectId: state.inspectedObjectId === id ? null : state.inspectedObjectId,
      }
    })
    worldMutationBus.broadcast({ kind: 'object_removed', payload: { id } })
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
    // Inherit ownership from the parent window so a non-shared avatar can never
    // outlive (or out-permit) the window that birthed it.
    const newAvatarOwnerId = window.ownerId || getViewerUserIdClient()
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
          ownerId: newAvatarOwnerId,
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
    if (!get().isViewMode && get()._worldReady && canWriteCurrentWorld()) {
      cancelPendingSave()
      const { terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes, worldConjuredAssetIds, placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms, behaviors, worldLights, worldSkyBackground, activeWorldId, placedAgentAvatars, placedAgentWindows } = get()
      saveWorld({ terrain: terrainParams, terrainHeights, groundPresetId, groundTiles, craftedScenes, conjuredAssetIds: worldConjuredAssetIds, catalogPlacements: placedCatalogAssets, portalGates, spatialWebObjects, paintStrokes, text3dObjects, transforms, behaviors, lights: worldLights, skyBackgroundId: worldSkyBackground, agentWindows: placedAgentWindows, agentAvatars: placedAgentAvatars }, activeWorldId)
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
      // Only allow editing if caller permits AND world is open-build.
      const isEditable = allowEdit && (
        meta.visibility === 'public_edit' ||
        meta.visibility === 'ffa' ||
        meta.visibility === 'unlisted_edit'
      )
      const defaultLights: WorldLight[] = DEFAULT_WORLD_LIGHTS.map((l, i) => ({ ...l, id: `light-${l.type}-default-${i}`, visible: true } as WorldLight))
      const lights = state.lights !== undefined ? state.lights : defaultLights
      const portalGates = resolveDefaultPortalGates(worldId, state.portalGates, state.transforms)
      const spatialWebObjects = resolveDefaultSpatialWebObjects(worldId, state.spatialWebObjects)
      const viewObjCount = (state.conjuredAssetIds?.length || 0) + (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) + portalGates.length + spatialWebObjects.length + (state.paintStrokes?.length || 0) + (state.text3dObjects?.length || 0)
      const sanitizedAgentAvatars = sanitizeAgentAvatarList(state.agentAvatars || [])
      const normalizedAgentWorldState = normalizeSharedAgentAvatarWorldState({
        windows: state.agentWindows || [],
        avatars: sanitizedAgentAvatars.entries,
        transforms: state.transforms || {},
      })
      set({
        _worldReady: isEditable, // Only allow saves for authenticated open-build worlds
        _loadedObjectCount: viewObjCount,
        isViewModeEditable: isEditable,
        viewingWorldMeta: meta,
        terrainParams: state.terrain || null,
        terrainHeights: normalizeTerrainHeights(state.terrainHeights),
        groundPresetId: state.groundPresetId || 'none',
        groundTiles: state.groundTiles || {},
        craftedScenes: state.craftedScenes || [],
        worldConjuredAssetIds: state.conjuredAssetIds || [],
        placedCatalogAssets: state.catalogPlacements || [],
        portalGates,
        spatialWebObjects,
        paintStrokes: state.paintStrokes || [],
        text3dObjects: state.text3dObjects || [],
        paintStrokePlayback: {},
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
    broadcastSnapshotMutationDelta(command.after, command.before)
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
    broadcastSnapshotMutationDelta(command.before, command.after)
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

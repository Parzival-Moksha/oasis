// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS MCP TOOLS — The 35-tool arsenal for world-aware agents
// ─═̷─═̷─ॐ─═̷─═̷─ Any agent can see, build, and navigate ─═̷─═̷─ॐ─═̷─═̷─
//
// Pure functions: take args, return results. No HTTP coupling.
// Used by: /api/oasis-tools (REST), tools/oasis-mcp (stdio), Merlin route.
//
// SERVER-ONLY — never import from client code.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { prisma } from '../db'
import { ASSET_CATALOG } from '@/components/scene-lib/constants'
import type { WorldState } from '../forge/world-persistence'
import type { CatalogPlacement, CraftedScene, WorldLight } from '../conjure/types'
import type { ConjuredAsset, PostProcessAction, ProviderName } from '../conjure/types'
import type { SpatialWebObject, SpatialWebObjectType, SpatialWebOption, SpatialWebSubmitDestination, SpatialWebValue, SpatialWebVisualStyle } from '../spatial-web'
import { googleFormSpecToJourneyGroundTiles, googleFormSpecToSpatialWebObjects, parseGoogleFormHtml } from '../google-form-spatial'
import {
  PORTAL_GATE_VARIANTS,
  WELCOME_HUB_WORLD_ID,
  layoutPortalAreaGates,
  portalRotationTowardCenter,
  type PortalAction,
  type PortalGate,
  type PortalGateVariant,
} from '../portal-gates'
import { createPortalZeroReturnGate } from '../portal-zero-return-gate'
import { getAllAssets, getAssetById, updateAsset } from '../conjure/registry'
import { emitWorldEvent } from './world-events'
import { readWorldPlayerContext } from '../world-runtime-context'
import { DEFAULT_AGENT_AVATAR_URL, getDefaultAgentAvatarUrl, resolveAgentAvatarUrl } from '../agent-avatar-catalog'
import {
  isSharedAgentAvatarType,
  normalizeWorldStateAgentAvatarTransforms,
} from '../agent-avatar-world-state'
import { readBrowserActiveWorldId } from '../browser-active-world'
import { readBrowserAgentAvatarContext } from '../browser-agent-avatar-context'
import { readBrowserPlayerContext } from '../browser-player-context'
import { execMediaTool, type MediaToolName } from '../media-tools'
import { getOasisMode, type OasisMode } from '../oasis-profile'
import {
  DISCOVERABLE_VISIBILITIES,
  WorldAccessError,
  canDiscoverWorld,
  canReadWorld,
  getWorldWriteDecision,
  type WorldAccessContext,
  type WorldAccessSubject,
} from '../forge/world-access'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const CATALOG_MAP = new Map(ASSET_CATALOG.map(a => [a.id, a]))
const INTERNAL_OASIS_BASE_URL = process.env.OASIS_URL || 'http://127.0.0.1:4516'
// Inherit userId from env so MCP-created worlds match the browser's userId filter.
// Falls back to 'local-user' for fresh installs without ADMIN_USER_ID.
const LOCAL_USER_ID = process.env.ADMIN_USER_ID || 'local-user'
const SPATIAL_WEB_OBJECT_TYPES: SpatialWebObjectType[] = ['button', 'toggle', 'slider', 'select', 'multiselect', 'text', 'output']
const SPATIAL_WEB_VISUAL_STYLES: SpatialWebVisualStyle[] = ['neon-panel', 'arcade-button', 'glass-slider', 'terminal-panel', 'portal-zero-button', 'google-form-altar']
const DEFAULT_PORTAL_GATE_VARIANT: PortalGateVariant = 'threshold-ring'
const SHAREABLE_WORLD_VISIBILITIES = new Set(['unlisted', 'public', 'public_edit', 'private'])
const AGENT_WINDOW_TYPES = new Set([
  'anorak',
  'codex',
  'gemini',
  'anorak-pro',
  'merlin',
  'realtime',
  'hermes',
  'openclaw',
  'devcraft',
  'parzival',
  'browser',
  'mission',
])
const AGENT_WINDOW_FRAME_STYLES = new Set(['gilded', 'neon', 'thin', 'baroque', 'hologram', 'rustic', 'ice', 'void', 'spaghetti', 'triangle', 'fire', 'matrix', 'plasma', 'brutalist', 'none'])
const DEFAULT_BROWSER_WINDOW_WIDTH = 1280
const DEFAULT_BROWSER_WINDOW_HEIGHT = 820
const DEFAULT_BROWSER_WINDOW_SCALE = 0.15
const DEFAULT_BROWSER_WINDOW_FRAME_STYLE = 'baroque'
const DEFAULT_BROWSER_WINDOW_FRAME_THICKNESS = 7

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function validWorldVisibility(value: unknown, fallback = 'unlisted'): string {
  const requested = validStr(value, '').trim().toLowerCase()
  return SHAREABLE_WORLD_VISIBILITIES.has(requested) ? requested : fallback
}

function resolveOasisPublicBaseUrl(value?: unknown): string {
  const requested = validStr(value, '').trim()
  const envUrl = process.env.OASIS_PUBLIC_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_OASIS_URL
    || INTERNAL_OASIS_BASE_URL
  return (requested || envUrl).replace(/\/+$/, '')
}

function buildWorldUrl(worldId: string, publicBaseUrl?: unknown): string {
  return `${resolveOasisPublicBaseUrl(publicBaseUrl)}/w/${encodeURIComponent(worldId)}`
}

function buildQrCodeUrl(url: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(url)}`
}

function buildSpatialFormLights(): WorldLight[] {
  return [
    { id: 'light-environment-spatial-form', type: 'environment', color: '#ffffff', intensity: 1.1, position: [0, 0, 0], visible: true },
    { id: 'light-ambient-spatial-form', type: 'ambient', color: '#fff7ed', intensity: 1.35, position: [0, 0, 0], visible: true },
    { id: 'light-directional-spatial-form', type: 'directional', color: '#fff1c8', intensity: 2.15, position: [-4, 10, 7], target: [0, 0, -12], castShadow: true, visible: true },
    { id: 'light-point-submit-spatial-form', type: 'point', color: '#fb7185', intensity: 2.4, position: [0, 2.2, -18], visible: true },
  ]
}

function normalizeAnswerKeyArg(value: unknown): Record<string, string | string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | string[]] => {
      const answer = entry[1]
      return typeof entry[0] === 'string'
        && entry[0].trim().length > 0
        && (typeof answer === 'string' || (Array.isArray(answer) && answer.every(item => typeof item === 'string')))
    })
    .map(([key, answer]) => [key.trim(), Array.isArray(answer) ? answer.map(item => item.trim()).filter(Boolean) : answer.trim()] as const)
    .filter(([, answer]) => Array.isArray(answer) ? answer.length > 0 : answer.length > 0)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function buildGeminiTestTutorAgents(): {
  agentWindows: NonNullable<WorldState['agentWindows']>
  agentAvatars: NonNullable<WorldState['agentAvatars']>
} {
  const windowId = 'agent-gemini-test-tutor'
  const avatarId = 'agent-avatar-gemini'
  return {
    agentWindows: [{
      id: windowId,
      agentType: 'gemini' as const,
      renderMode: 'live-html' as const,
      linkedAvatarId: avatarId,
      anchorMode: 'next-to' as const,
      position: [-5.7, 3.25, -2.9] as [number, number, number],
      rotation: [0, 0.42, 0] as [number, number, number],
      scale: 0.15,
      width: 740,
      height: 960,
      label: 'Gemini Tutor',
      frameStyle: 'void',
      frameThickness: 7,
    }],
    agentAvatars: [{
      id: avatarId,
      agentType: 'gemini' as const,
      avatar3dUrl: getDefaultAgentAvatarUrl('gemini'),
      position: [-3.4, 0, -3.2] as [number, number, number],
      rotation: [0, 0.72, 0] as [number, number, number],
      scale: 1.65,
      linkedWindowId: windowId,
      label: 'Gemini Tutor',
    }],
  }
}

function parseVec3Like(v: unknown): [number, number, number] | null {
  if (Array.isArray(v) && v.length >= 3) {
    const [x, y, z] = v.map(Number)
    if ([x, y, z].some(n => !Number.isFinite(n))) return null
    return [x, y, z]
  }

  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed) && parsed.length >= 3) {
      const [x, y, z] = parsed.map(Number)
      if ([x, y, z].some(n => !Number.isFinite(n))) return null
      return [x, y, z]
    }
  } catch {
    // Fall through to scalar parsing.
  }

  const parts = trimmed
    .replace(/^[\[\(\{]\s*/, '')
    .replace(/\s*[\]\)\}]$/, '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length < 3) return null
  const [x, y, z] = parts.slice(0, 3).map(Number)
  if ([x, y, z].some(n => !Number.isFinite(n))) return null
  return [x, y, z]
}

function validPos(v: unknown): [number, number, number] | null {
  return parseVec3Like(v)
}

function validStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function validNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function validBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const trimmed = v.trim().toLowerCase()
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false
  }
  return fallback
}

function validSpatialWebObjectType(value: unknown, fallback: SpatialWebObjectType = 'button'): SpatialWebObjectType {
  const requested = validStr(value, '').trim().toLowerCase()
  return SPATIAL_WEB_OBJECT_TYPES.includes(requested as SpatialWebObjectType)
    ? requested as SpatialWebObjectType
    : fallback
}

function validSpatialWebVisualStyle(value: unknown): SpatialWebVisualStyle | undefined {
  const requested = validStr(value, '').trim().toLowerCase()
  return SPATIAL_WEB_VISUAL_STYLES.includes(requested as SpatialWebVisualStyle)
    ? requested as SpatialWebVisualStyle
    : undefined
}

function validPortalGateVariant(value: unknown, fallback: PortalGateVariant = DEFAULT_PORTAL_GATE_VARIANT): PortalGateVariant {
  const requested = validStr(value, '').trim().toLowerCase()
  return PORTAL_GATE_VARIANTS.includes(requested as PortalGateVariant)
    ? requested as PortalGateVariant
    : fallback
}

function validSpatialWebValue(value: unknown, fallback: SpatialWebValue = null): SpatialWebValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    const values = value.filter((entry): entry is string => typeof entry === 'string')
    return values.length === value.length ? values : fallback
  }
  return fallback
}

function parseSpatialWebOptions(value: unknown): SpatialWebOption[] | undefined {
  const entries = parseLooseObjectArray(value)
  if (entries.length > 0) {
    const options = entries
      .map(entry => {
        const optionValue = validStr(entry.value, '')
        if (!optionValue) return null
        const price = Number(entry.price)
        return {
          value: optionValue,
          label: validStr(entry.label, optionValue),
          ...(Number.isFinite(price) ? { price } : {}),
        }
      })
      .filter((entry): entry is SpatialWebOption => !!entry)
    return options.length > 0 ? options : undefined
  }

  if (Array.isArray(value)) {
    const options = value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => ({ value: entry.trim(), label: entry.trim() }))
    return options.length > 0 ? options : undefined
  }

  if (typeof value === 'string') {
    const options = value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => ({ value: entry.toLowerCase().replace(/\s+/g, '-'), label: entry }))
    return options.length > 0 ? options : undefined
  }

  return undefined
}

export interface OasisToolContext {
  source?: 'local' | 'api' | 'relay' | 'mcp' | 'merlin' | 'smoke' | string
  userId?: string
  worldId?: string
  agentType?: string
  deviceId?: string
  scopes?: string[]
  requireExplicitWorld?: boolean
  system?: boolean
  admin?: boolean
}

interface ResolvedOasisToolContext {
  source: string
  userId: string
  mode: OasisMode
  worldId?: string
  agentType?: string
  deviceId?: string
  scopes: string[]
  requireExplicitWorld: boolean
  mutating: boolean
  system: boolean
  admin: boolean
  forkedWorldIds: Map<string, string>
}

type ToolWorldRow = {
  id: string
  userId?: string | null
  name?: string | null
  icon?: string | null
  visibility?: string | null
  data?: string | null
  objectCount?: number | null
  updatedAt?: Date
  createdAt?: Date
}

const toolContextStorage = new AsyncLocalStorage<ResolvedOasisToolContext>()

function cleanWorldId(value: unknown): string {
  const worldId = validStr(value, '').trim()
  return worldId && worldId !== '__active__' ? worldId : ''
}

function currentToolContext(): ResolvedOasisToolContext {
  return toolContextStorage.getStore() || {
    source: 'local',
    userId: LOCAL_USER_ID,
    mode: getOasisMode(),
    scopes: [],
    requireExplicitWorld: false,
    mutating: false,
    system: false,
    admin: false,
    forkedWorldIds: new Map(),
  }
}

function resolveToolContext(
  name: string,
  args: Record<string, unknown>,
  context: OasisToolContext = {},
): ResolvedOasisToolContext {
  const mode = getOasisMode()
  const source = validStr(context.source, 'local')
  const contextWorldId = cleanWorldId(context.worldId)
  const argsWorldId = cleanWorldId(args.worldId)
  const agentType = validStr(context.agentType || args.agentType || args.agent, '').trim().toLowerCase()
  const userId = validStr(context.userId || args.userId, LOCAL_USER_ID).trim() || LOCAL_USER_ID
  return {
    source,
    userId,
    mode,
    ...(contextWorldId || argsWorldId ? { worldId: contextWorldId || argsWorldId } : {}),
    ...(agentType ? { agentType } : {}),
    ...(validStr(context.deviceId, '') ? { deviceId: validStr(context.deviceId, '') } : {}),
    scopes: Array.isArray(context.scopes) ? context.scopes.filter((scope): scope is string => typeof scope === 'string') : [],
    requireExplicitWorld: context.requireExplicitWorld ?? (mode === 'hosted' && source === 'relay'),
    mutating: MUTATING_TOOLS.has(name),
    system: Boolean(context.system),
    admin: Boolean(context.admin),
    forkedWorldIds: new Map(),
  }
}

function applyToolContextToArgs(
  args: Record<string, unknown>,
  context: ResolvedOasisToolContext,
): Record<string, unknown> {
  const next = { ...args }
  if (context.worldId && !cleanWorldId(next.worldId)) {
    next.worldId = context.worldId
  }
  if (context.agentType && !validStr(next.agentType || next.agent, '')) {
    next.agentType = context.agentType
  }
  return next
}

function toolAccessContext(context = currentToolContext()): WorldAccessContext {
  return {
    userId: context.userId,
    mode: context.mode,
    system: context.system,
    admin: context.admin,
  }
}

function toToolAccessSubject(row: ToolWorldRow): WorldAccessSubject {
  return {
    id: row.id,
    userId: row.userId || LOCAL_USER_ID,
    visibility: row.visibility || 'private',
  }
}

function worldAccessDetails(row: ToolWorldRow) {
  const writeMode = getWorldWriteDecision(toolAccessContext(), toToolAccessSubject(row))
  return {
    visibility: row.visibility || 'private',
    canRead: canReadWorld(toolAccessContext(), toToolAccessSubject(row)),
    canWrite: writeMode === 'write' || writeMode === 'fork',
    writeMode,
    isCore: (row.visibility || '').toLowerCase() === 'core',
    isTemplate: (row.visibility || '').toLowerCase() === 'template',
  }
}

function countWorldObjects(state: Pick<WorldState, 'conjuredAssetIds' | 'catalogPlacements' | 'craftedScenes' | 'portalGates' | 'spatialWebObjects' | 'agentWindows'>): number {
  return (state.conjuredAssetIds?.length || 0) +
    (state.catalogPlacements?.length || 0) +
    (state.craftedScenes?.length || 0) +
    (state.portalGates?.length || 0) +
    (state.spatialWebObjects?.length || 0) +
    (state.agentWindows?.length || 0)
}

async function listVisibleToolWorlds(): Promise<ToolWorldRow[]> {
  const context = currentToolContext()
  const access = toolAccessContext(context)
  const worlds = await prisma.world.findMany({
    select: { id: true, userId: true, name: true, icon: true, visibility: true, objectCount: true, updatedAt: true },
    where: context.mode === 'hosted' && !context.system && !context.admin
      ? {
          OR: [
            { userId: context.userId },
            { visibility: { in: DISCOVERABLE_VISIBILITIES } },
          ],
        }
      : undefined,
    orderBy: { updatedAt: 'desc' },
  })
  return worlds.filter(world => canDiscoverWorld(access, toToolAccessSubject(world)))
}

async function readToolWorldRow(worldId: string, intent: 'read' | 'write' = 'read'): Promise<ToolWorldRow | null> {
  const world = await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, name: true, icon: true, visibility: true, data: true, objectCount: true, updatedAt: true },
  })
  if (!world) return null
  const subject = toToolAccessSubject(world)
  if (intent === 'write') {
    const writeDecision = getWorldWriteDecision(toolAccessContext(), subject)
    if (writeDecision === 'deny') return null
  } else if (!canReadWorld(toolAccessContext(), subject)) {
    return null
  }
  return world
}

function normalizeWorldSearchText(value: unknown): string {
  return validStr(value, '').trim().toLowerCase().replace(/[_-]+/g, ' ')
}

function scoreWorldSearchMatch(world: ToolWorldRow, query: string): number {
  const normalizedQuery = normalizeWorldSearchText(query)
  if (!normalizedQuery) return 1
  const name = normalizeWorldSearchText(world.name || '')
  const id = normalizeWorldSearchText(world.id)
  if (name === normalizedQuery || id === normalizedQuery) return 100
  if (name.includes(normalizedQuery)) return 80
  if (id.includes(normalizedQuery)) return 70
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean)
  if (queryWords.length > 0 && queryWords.every(word => name.includes(word) || id.includes(word))) return 60
  return 0
}

async function findToolWorldsByQuery(query: string, limit = 8): Promise<ToolWorldRow[]> {
  const normalizedQuery = normalizeWorldSearchText(query)
  const worlds = await listVisibleToolWorlds()
  const scored = worlds
    .map(world => ({ world, score: scoreWorldSearchMatch(world, normalizedQuery) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.world.name || a.world.id).localeCompare(String(b.world.name || b.world.id)))
    .map(entry => entry.world)
    .slice(0, limit)

  if (scored.length === 0 && normalizedQuery === 'portal zero') {
    const portalZero = await readToolWorldRow(WELCOME_HUB_WORLD_ID, 'read')
    return portalZero ? [portalZero] : []
  }
  return scored
}

function parseLooseObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
  }

  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      : []
  } catch {
    return []
  }
}

function parseLooseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  const trimmed = value.trim()
  if (!trimmed) return {}

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function parseLooseObjectRecord(value: unknown): Record<string, Record<string, unknown>> {
  const raw = parseLooseObject(value)
  const parsed: Record<string, Record<string, unknown>> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      parsed[key] = entry as Record<string, unknown>
    }
  }
  return parsed
}

function parseStringRecord(value: unknown): Record<string, string> {
  const raw = parseLooseObject(value)
  const parsed: Record<string, string> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === 'string' && entry.trim()) parsed[key] = entry.trim()
  }
  return parsed
}

type AgentWindowEntry = NonNullable<WorldState['agentWindows']>[number]
type TransformOverride = WorldState['transforms'][string]

function validAgentWindowType(value: unknown, fallback: AgentWindowEntry['agentType'] = 'browser'): AgentWindowEntry['agentType'] {
  const requested = validStr(value, '').trim().toLowerCase()
  return AGENT_WINDOW_TYPES.has(requested)
    ? requested as AgentWindowEntry['agentType']
    : fallback
}

function validAgentWindowRenderMode(value: unknown): AgentWindowEntry['renderMode'] | undefined {
  const requested = validStr(value, '').trim()
  if (requested === 'hybrid-snapdom' || requested === 'hybrid-foreign-object' || requested === 'live-html') {
    return requested
  }
  return undefined
}

function validBrowserSurfaceMode(value: unknown): AgentWindowEntry['browserSurfaceMode'] {
  const requested = validStr(value, '').trim()
  return requested === 'desktop-capture' ? 'desktop-capture' : 'live-browser'
}

function validAgentWindowFrameStyle(value: unknown, fallback?: string): string | undefined {
  const requested = validStr(value, '').trim().toLowerCase()
  if (requested && AGENT_WINDOW_FRAME_STYLES.has(requested)) return requested
  return fallback
}

function normalizeBrowserWindowUrl(value: unknown): string {
  const raw = validStr(value, '').trim()
  if (!raw) return ''
  if (raw.startsWith('/')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:\d+)?(\/|$)/i.test(raw)) return `http://${raw}`
  return `https://${raw}`
}

function browserWindowLabelForUrl(surfaceUrl: string): string {
  if (!surfaceUrl) return 'Browser'
  try {
    const url = new URL(surfaceUrl, INTERNAL_OASIS_BASE_URL)
    return url.hostname || 'Browser'
  } catch {
    return 'Browser'
  }
}

function clampAgentWindowDimension(value: unknown, fallback: number): number {
  return Math.max(320, Math.min(2400, validNum(value, fallback)))
}

function clampAgentWindowScale(value: unknown, fallback = DEFAULT_BROWSER_WINDOW_SCALE): number {
  return Math.max(0.05, Math.min(1, validNum(value, fallback)))
}

function validScale(v: unknown, fallback?: number | [number, number, number]): number | [number, number, number] | undefined {
  if (Array.isArray(v) && v.length >= 3) {
    const [x, y, z] = v.slice(0, 3).map(Number)
    if ([x, y, z].every(Number.isFinite)) return [x, y, z]
    return fallback
  }
  if (v === undefined) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function readTransformOverride(state: WorldState, objectId: string): TransformOverride | undefined {
  const transform = state.transforms?.[objectId]
  return transform && Object.keys(transform).length > 0 ? transform : undefined
}

function effectivePosition(state: WorldState, objectId: string, fallback: unknown): [number, number, number] | null {
  return validPos(readTransformOverride(state, objectId)?.position) || validPos(fallback)
}

function effectiveRotation(state: WorldState, objectId: string, fallback: unknown): [number, number, number] | null {
  return validPos(readTransformOverride(state, objectId)?.rotation) || validPos(fallback)
}

function effectiveScale(state: WorldState, objectId: string, fallback: unknown): number | [number, number, number] | undefined {
  const transform = readTransformOverride(state, objectId)
  return transform?.scale !== undefined ? validScale(transform.scale) : validScale(fallback)
}

function matchesObjectQuery(entry: { id?: string; name?: string; catalogId?: string }, query: string): boolean {
  if (!query) return true
  const haystack = [entry.name, entry.id, entry.catalogId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase()

  if (haystack.includes(query)) return true

  const terms = query.split(/\s+/).filter(Boolean)
  return terms.length > 1 && terms.every(term => haystack.includes(term))
}

function mutationActorData(args: Record<string, unknown>): Record<string, unknown> {
  const actorAgentType = validStr(args.actorAgentType || args.agentType || args.agent, '').toLowerCase()
  return actorAgentType ? { actorAgentType } : {}
}

const AVATAR_ANIMATION_ALIASES: Record<string, string> = {
  dance: 'ual-dance',
  dancing: 'ual-dance',
  talk: 'ual-talking',
  talking: 'ual-talking',
  speak: 'ual-talking',
  speaking: 'ual-talking',
  yes: 'ual-yes',
  no: 'ual-no',
  idle: 'ual-idle',
  conjure: 'ual-spell-idle',
  spell: 'ual-spell-idle',
}

function normalizeAnimationLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/^lib:/, '')
}

async function loadAvatarAnimationCatalog() {
  const { ANIMATION_LIBRARY } = await import('../forge/animation-library')
  return ANIMATION_LIBRARY
}

async function resolveAvatarAnimation(requestedClip: string) {
  const library = await loadAvatarAnimationCatalog()
  const normalized = normalizeAnimationLookupKey(requestedClip)
  const aliased = AVATAR_ANIMATION_ALIASES[normalized] || normalized
  const exact = library.find(entry => entry.id === aliased)
  const suggestions = library
    .filter(entry =>
      entry.id.includes(aliased) ||
      entry.label.toLowerCase().includes(aliased) ||
      entry.category.toLowerCase().includes(aliased)
    )
    .slice(0, 8)
    .map(entry => entry.id)

  return {
    library,
    exact,
    normalized,
    suggestions,
  }
}

function normalizeState(state: WorldState): WorldState {
  // Defensive: old worlds may lack fields added later
  state.transforms = state.transforms || {}
  state.behaviors = state.behaviors || {}
  state.catalogPlacements = state.catalogPlacements || []
  state.agentAvatars = state.agentAvatars || []
  state.craftedScenes = state.craftedScenes || []
  state.conjuredAssetIds = state.conjuredAssetIds || []
  state.portalGates = state.portalGates || []
  state.spatialWebObjects = state.spatialWebObjects || []
  state.agentWindows = state.agentWindows || []
  state.lights = state.lights || []
  state.groundTiles = state.groundTiles || {}
  return normalizeWorldStateAgentAvatarTransforms(state)
}

type AgentAvatarEntry = NonNullable<WorldState['agentAvatars']>[number]

function overlayLiveAgentAvatars(
  avatars: AgentAvatarEntry[],
  liveAvatars: Array<{
    id: string
    agentType: string
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: number
    linkedWindowId?: string
    label?: string
    avatar3dUrl?: string
  }>,
): AgentAvatarEntry[] {
  if (liveAvatars.length === 0) return avatars

  const merged = avatars.map(avatar => ({ ...structuredClone(avatar) }))

  const findIndex = (liveAvatar: typeof liveAvatars[number]) => merged.findIndex(entry =>
    entry.id === liveAvatar.id
    || (!!liveAvatar.linkedWindowId && entry.linkedWindowId === liveAvatar.linkedWindowId)
    || entry.agentType === liveAvatar.agentType
  )

  for (const liveAvatar of liveAvatars) {
    const index = findIndex(liveAvatar)
    if (index >= 0) {
      const existing = merged[index]
      merged[index] = {
        ...existing,
        position: [...liveAvatar.position] as [number, number, number],
        ...(liveAvatar.rotation ? { rotation: [...liveAvatar.rotation] as [number, number, number] } : {}),
        ...(typeof liveAvatar.scale === 'number' ? { scale: liveAvatar.scale } : {}),
        ...(liveAvatar.label ? { label: liveAvatar.label } : {}),
        ...(liveAvatar.linkedWindowId ? { linkedWindowId: liveAvatar.linkedWindowId } : {}),
        ...(liveAvatar.avatar3dUrl ? { avatar3dUrl: liveAvatar.avatar3dUrl } : {}),
      }
      continue
    }

    merged.push({
      id: liveAvatar.id,
      agentType: liveAvatar.agentType as AgentAvatarEntry['agentType'],
      avatar3dUrl: liveAvatar.avatar3dUrl || DEFAULT_AGENT_AVATAR_URL,
      position: [...liveAvatar.position] as [number, number, number],
      rotation: liveAvatar.rotation ? [...liveAvatar.rotation] as [number, number, number] : [0, 0, 0],
      scale: typeof liveAvatar.scale === 'number' ? liveAvatar.scale : 1,
      ...(liveAvatar.linkedWindowId ? { linkedWindowId: liveAvatar.linkedWindowId } : {}),
      ...(liveAvatar.label ? { label: liveAvatar.label } : {}),
    })
  }

  return merged
}

function resolveAgentAvatarTarget(
  state: WorldState,
  args: Record<string, unknown>,
  fallbackAgentType = '',
): {
  agentType: string
  avatarId: string
  linkedWindowId: string
  existing: AgentAvatarEntry | null
} {
  const requestedAvatarId = validStr(args.avatarId, '')
  const linkedWindowId = validStr(args.linkedWindowId, '')
  const agentType = validStr(args.agentType || args.agent, fallbackAgentType).toLowerCase()

  let avatarId = requestedAvatarId
  let existing = requestedAvatarId
    ? (state.agentAvatars || []).find(avatar => avatar.id === requestedAvatarId) || null
    : null

  if (!existing && linkedWindowId) {
    existing = (state.agentAvatars || []).find(avatar => avatar.linkedWindowId === linkedWindowId) || null
    avatarId = existing?.id || `agent-avatar-${linkedWindowId}`
  }

  if (!existing && agentType) {
    existing = (state.agentAvatars || []).find(avatar => avatar.agentType === agentType) || null
    if (existing) {
      avatarId = existing.id
    } else if (!avatarId && isSharedAgentAvatarType(agentType)) {
      avatarId = `agent-avatar-${agentType}`
    }
  }

  if (!existing && !avatarId && agentType) {
    avatarId = `agent-avatar-${agentType}-${uid()}`
  }

  return { agentType, avatarId, linkedWindowId, existing }
}

// Simple per-world mutex to prevent concurrent read-modify-write races
const worldLocks = new Map<string, Promise<void>>()

async function withWorldLock<T>(worldId: string, fn: () => Promise<T>): Promise<T> {
  const existing = worldLocks.get(worldId) || Promise.resolve()
  let release: () => void
  const next = new Promise<void>(resolve => { release = resolve })
  worldLocks.set(worldId, next)
  await existing
  try {
    return await fn()
  } finally {
    release!()
    if (worldLocks.get(worldId) === next) worldLocks.delete(worldId)
  }
}

async function forkToolTemplateWorld(
  template: ToolWorldRow,
  context: ResolvedOasisToolContext,
): Promise<{ worldId: string; state: WorldState }> {
  const existingForkId = context.forkedWorldIds.get(template.id)
  if (existingForkId) {
    return loadToolWorld(existingForkId, 'write')
  }
  if (!template.data) {
    throw new Error(`World ${template.id} has no saved data.`)
  }

  const now = new Date()
  const id = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const state = normalizeState(JSON.parse(template.data) as WorldState)
  const fork = await prisma.world.create({
    data: {
      id,
      userId: context.userId,
      name: template.name || 'Template World',
      icon: template.icon || '🌍',
      visibility: 'private',
      data: JSON.stringify(state),
      objectCount: countWorldObjects(state),
      createdAt: now,
      updatedAt: now,
    },
  })
  const forkId = typeof fork?.id === 'string' ? fork.id : id
  context.forkedWorldIds.set(template.id, forkId)
  emitWorldEvent('world_switch', template.id, {
    targetWorldId: forkId,
    forkedFromWorldId: template.id,
    ...(context.agentType ? { actorAgentType: context.agentType } : {}),
  })
  return { worldId: forkId, state }
}

async function loadToolWorld(
  worldId: string,
  intent: 'read' | 'write',
  preloaded?: ToolWorldRow | null,
): Promise<{ worldId: string; state: WorldState }> {
  const context = currentToolContext()
  const forkedWorldId = context.forkedWorldIds.get(worldId)
  if (forkedWorldId && forkedWorldId !== worldId) {
    return loadToolWorld(forkedWorldId, intent)
  }

  const world = preloaded || await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, name: true, icon: true, visibility: true, data: true },
  })
  if (!world?.data) {
    throw new Error(`World ${worldId} not found.`)
  }

  const subject = toToolAccessSubject(world)
  if (intent === 'write') {
    const writeDecision = getWorldWriteDecision(toolAccessContext(context), subject)
    if (writeDecision === 'deny') {
      throw new WorldAccessError('This tool context cannot mutate that world', 'world_write_forbidden')
    }
    if (writeDecision === 'fork') {
      return forkToolTemplateWorld(world, context)
    }
  } else if (!canReadWorld(toolAccessContext(context), subject)) {
    throw new WorldAccessError('World not found or not visible to this tool context', 'world_not_visible', 404)
  }

  return { worldId: world.id, state: normalizeState(JSON.parse(world.data) as WorldState) }
}

async function loadActiveWorld(): Promise<{ worldId: string; state: WorldState }> {
  const context = currentToolContext()
  if ((context.mode === 'hosted' && !context.system && !context.admin) || context.requireExplicitWorld) {
    throw new WorldAccessError(
      'Hosted tool calls require an explicit worldId so agent actions cannot drift into the wrong Oasis.',
      'tool_world_context_required',
      400,
    )
  }

  const preferredWorldId = await readBrowserActiveWorldId()
  if (preferredWorldId) {
    try {
      return await loadToolWorld(preferredWorldId, context.mutating ? 'write' : 'read')
    } catch (error) {
      if (error instanceof WorldAccessError) throw error
      // Browser context can outlive a deleted world; fall back to latest local row.
    }
  }

  // Fallback: find most recently updated world for local-user
  const world = await prisma.world.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, userId: true, name: true, icon: true, visibility: true, data: true },
  })
  if (!world?.data) {
    throw new Error('No world found. Create one first.')
  }
  return loadToolWorld(world.id, context.mutating ? 'write' : 'read', world)
}

async function loadRequestedWorld(worldIdLike: unknown): Promise<{ worldId: string; state: WorldState }> {
  const context = currentToolContext()
  const worldId = cleanWorldId(worldIdLike) || context.worldId || ''
  if (!worldId) return loadActiveWorld()
  return loadToolWorld(worldId, context.mutating ? 'write' : 'read')
}

async function loadWorldById(worldId: string): Promise<WorldState> {
  return (await loadToolWorld(worldId, currentToolContext().mutating ? 'write' : 'read')).state
}

async function saveWorldState(worldId: string, state: WorldState): Promise<void> {
  const normalized = normalizeWorldStateAgentAvatarTransforms(state)
  Object.assign(state, normalized)
  state.savedAt = new Date().toISOString()
  const context = currentToolContext()
  const target = await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, visibility: true },
  })
  if (!target) {
    throw new WorldAccessError('World not found', 'world_not_found', 404)
  }

  const writeDecision = getWorldWriteDecision(toolAccessContext(context), toToolAccessSubject(target))
  if (writeDecision === 'deny') {
    throw new WorldAccessError('This tool context cannot mutate that world', 'world_write_forbidden')
  }
  if (writeDecision === 'fork') {
    throw new WorldAccessError('Template worlds must be forked before tool writes are saved', 'world_template_fork_required', 409)
  }

  await prisma.world.update({
    where: { id: worldId },
    data: { data: JSON.stringify(state), objectCount: countWorldObjects(state), updatedAt: new Date() },
  })
}

async function upsertCraftedSceneInWorld(
  worldId: string,
  scene: CraftedScene,
  args: Record<string, unknown>,
  eventType: 'scene_craft_progress' | 'scene_crafted',
) {
  return withWorldLock(worldId, async () => {
    const state = await loadWorldById(worldId)
    state.craftedScenes = [
      ...(state.craftedScenes || []).filter(entry => entry.id !== scene.id),
      scene,
    ]
    if (scene.position.some(value => value !== 0)) {
      state.transforms[scene.id] = { position: scene.position }
    }
    await saveWorldState(worldId, state)
    emitWorldEvent(eventType, worldId, {
      id: scene.id,
      name: scene.name,
      position: scene.position,
      scene,
      transform: state.transforms[scene.id],
      ...mutationActorData(args),
    })
    return state.transforms[scene.id]
  })
}

async function removeCraftedSceneFromWorld(worldId: string, sceneId: string, args: Record<string, unknown>) {
  await withWorldLock(worldId, async () => {
    const state = await loadWorldById(worldId)
    state.craftedScenes = (state.craftedScenes || []).filter(entry => entry.id !== sceneId)
    if (state.transforms?.[sceneId]) {
      delete state.transforms[sceneId]
    }
    await saveWorldState(worldId, state)
    emitWorldEvent('object_removed', worldId, {
      objectId: sceneId,
      ...mutationActorData(args),
    })
  })
}

function cloneConjuredAsset(asset: ConjuredAsset | undefined | null): ConjuredAsset | null {
  return asset ? structuredClone(asset) as ConjuredAsset : null
}

function readWorldTransform(
  state: WorldState,
  objectId: string,
): {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
} | null {
  const transform = state.transforms?.[objectId]
  if (!transform || !Array.isArray(transform.position) || transform.position.length < 3) return null
  return structuredClone(transform) as { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }
}

function summarizeWorldConjuredAsset(state: WorldState, assetId: string) {
  const asset = cloneConjuredAsset(getAssetById(assetId))
  const transform = readWorldTransform(state, assetId)
  return {
    id: assetId,
    displayName: asset?.displayName || null,
    prompt: asset?.prompt || null,
    provider: asset?.provider || null,
    tier: asset?.tier || null,
    status: asset?.status || null,
    glbPath: asset?.glbPath || null,
    thumbnailUrl: asset?.thumbnailUrl || null,
    position: transform?.position || asset?.position || null,
    rotation: transform?.rotation || asset?.rotation || null,
    scale: transform?.scale ?? asset?.scale ?? null,
  }
}

function resolveConjuredPlacement(
  args: Record<string, unknown>,
  fallback?: {
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number] | number
  },
) {
  const position = validPos(args.position) || fallback?.position || [0, 0, 0]
  const rotation = validPos(args.rotation) || fallback?.rotation || [0, 0, 0]
  const scaleCandidate = args.scale
  let scale: [number, number, number] | number = fallback?.scale ?? 1
  if (typeof scaleCandidate === 'number' || typeof scaleCandidate === 'string') {
    scale = validNum(scaleCandidate, typeof fallback?.scale === 'number' ? fallback.scale : 1)
  } else if (Array.isArray(scaleCandidate) && scaleCandidate.length >= 3) {
    const parsed = scaleCandidate.slice(0, 3).map(Number)
    if (parsed.every(Number.isFinite)) scale = [parsed[0], parsed[1], parsed[2]]
  }
  return { position, rotation, scale }
}

async function callInternalJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${INTERNAL_OASIS_BASE_URL}${path}`, init)
  const data = await response.json().catch(() => null) as T | { error?: string } | null
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  if (data == null) throw new Error(`Empty response from ${path}`)
  return data as T
}

async function placeConjuredAssetInWorld(
  worldIdLike: unknown,
  assetId: string,
  placement: {
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number] | number
  },
) {
  const { worldId, state } = await loadRequestedWorld(worldIdLike)
  state.conjuredAssetIds = state.conjuredAssetIds || []
  if (!state.conjuredAssetIds.includes(assetId)) {
    state.conjuredAssetIds = [...state.conjuredAssetIds, assetId]
  }
  state.transforms = {
    ...state.transforms,
    [assetId]: {
      position: placement.position,
      rotation: placement.rotation,
      scale: placement.scale,
    },
  }
  await saveWorldState(worldId, state)
  updateAsset(assetId, {
    position: placement.position,
    rotation: placement.rotation,
    scale: typeof placement.scale === 'number'
      ? placement.scale
      : Number(placement.scale[0]) || 1,
  })
  return { worldId, state, transform: state.transforms[assetId] }
}

async function removeConjuredAssetFromWorld(
  worldIdLike: unknown,
  assetId: string,
) {
  const { worldId, state } = await loadRequestedWorld(worldIdLike)
  state.conjuredAssetIds = (state.conjuredAssetIds || []).filter(id => id !== assetId)
  if (state.transforms?.[assetId]) {
    const { [assetId]: _removedTransform, ...remainingTransforms } = state.transforms
    state.transforms = remainingTransforms
  }
  if (state.behaviors?.[assetId]) {
    const { [assetId]: _removedBehavior, ...remainingBehaviors } = state.behaviors
    state.behaviors = remainingBehaviors
  }
  await saveWorldState(worldId, state)
  return { worldId, state }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL RESULT TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolResult {
  ok: boolean
  message: string
  data?: unknown
}

type CraftJobStatus = 'queued' | 'running' | 'completed' | 'failed'

interface CraftJobRecord {
  id: string
  status: CraftJobStatus
  worldId: string
  sceneId: string
  prompt: string
  model: string
  name: string
  objectCount: number
  startedAt: string
  updatedAt: string
  error?: string
}

function getCraftJobStore() {
  const globalState = globalThis as typeof globalThis & {
    __oasisCraftJobs?: Map<string, CraftJobRecord>
  }
  if (!globalState.__oasisCraftJobs) {
    globalState.__oasisCraftJobs = new Map()
  }
  return globalState.__oasisCraftJobs
}

function writeCraftJob(job: CraftJobRecord) {
  getCraftJobStore().set(job.id, job)
  return job
}

function readCraftJob(jobId: string): CraftJobRecord | null {
  return getCraftJobStore().get(jobId) || null
}

function updateCraftJob(jobId: string, updater: (current: CraftJobRecord) => CraftJobRecord) {
  const current = readCraftJob(jobId)
  if (!current) return null
  const next = updater(current)
  getCraftJobStore().set(jobId, next)
  return next
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY — name → handler
// ═══════════════════════════════════════════════════════════════════════════

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

const tools: Record<string, ToolHandler> = {}

async function runMediaTool(name: MediaToolName, args: Record<string, unknown>, mediaType: 'image' | 'audio' | 'video'): Promise<ToolResult> {
  const result = await execMediaTool(name, args, INTERNAL_OASIS_BASE_URL)
  if (!result.ok || !result.url) {
    return {
      ok: false,
      message: result.error || `${name} failed.`,
      data: {
        mediaType,
        error: result.error,
      },
    }
  }

  return {
    ok: true,
    message: `${mediaType} generated: ${result.url}`,
    data: {
      mediaType,
      url: result.url,
      mediaUrls: [result.url],
    },
  }
}

// ─═̷─═̷─ WORLD QUERY ─═̷─═̷─

/** Fetch the live player roster for a world from the Colyseus room server.
 *  Returns [] on any failure (room server down, network glitch, world has no
 *  connected players) so callers can rely on the shape unconditionally. */
async function fetchLivePlayers(worldId: string): Promise<Array<{
  playerId: string
  sessionId: string
  displayName: string
  avatarUrl: string
  color: string
  position: [number, number, number]
  yaw: number
  animState: string
  updatedAt: number
}>> {
  if (!worldId) return []
  const base = (process.env.OASIS_ROOM_INTERNAL_URL || 'http://127.0.0.1:4519').replace(/\/+$/, '')
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${base}/world-players?worldId=${encodeURIComponent(worldId)}`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return []
    const body = await res.json() as { ok?: boolean; players?: unknown }
    if (!body?.ok || !Array.isArray(body.players)) return []
    return body.players as Array<{
      playerId: string
      sessionId: string
      displayName: string
      avatarUrl: string
      color: string
      position: [number, number, number]
      yaw: number
      animState: string
      updatedAt: number
    }>
  } catch {
    return []
  }
}

tools.get_world_state = async (args) => {
  const worldId = validStr(args.worldId, '')
  const { state, worldId: resolvedId } = worldId
    ? { state: await loadWorldById(worldId), worldId }
    : await loadActiveWorld()

  // Prefer fresh browser-published pose (in-memory, ≤5min TTL).
  // Fall back to disk (Hermes route's publishWorldPlayerContext).
  const browserContext = readBrowserPlayerContext(resolvedId)
  const liveAgentContext = readBrowserAgentAvatarContext(resolvedId)
  const livePlayerContext = browserContext
    ? {
        updatedAt: new Date(browserContext.updatedAt).toISOString(),
        player: { avatar: browserContext.avatar, camera: browserContext.camera },
      }
    : await readWorldPlayerContext(resolvedId)
  const agentAvatars = overlayLiveAgentAvatars(state.agentAvatars || [], liveAgentContext?.avatars || [])
  const world = await prisma.world.findFirst({
    where: { id: resolvedId },
    select: {
      id: true,
      userId: true,
      name: true,
      icon: true,
      visibility: true,
      updatedAt: true,
    },
  })
  const access = world ? worldAccessDetails(world) : null

  return {
    ok: true,
    message: world?.name ? `World "${world.name}" loaded.` : `World ${resolvedId} loaded.`,
    data: {
      worldId: resolvedId,
      worldName: world?.name || '',
      name: world?.name || '',
      icon: world?.icon || '',
      visibility: access?.visibility || '',
      canRead: access?.canRead ?? true,
      canWrite: access?.canWrite ?? false,
      writeMode: access?.writeMode || 'unknown',
      isCore: access?.isCore ?? false,
      isTemplate: access?.isTemplate ?? false,
      lastSaved: world?.updatedAt?.toISOString?.() || null,
      sky: state.skyBackgroundId || 'night007',
      ground: state.groundPresetId || 'none',
      tileCount: Object.keys(state.groundTiles || {}).length,
      portalCount: (state.portalGates || []).length,
      catalogObjects: (state.catalogPlacements || []).map(p => {
        const transform = readTransformOverride(state, p.id)
        return {
          id: p.id,
          catalogId: p.catalogId,
          name: p.name,
          position: effectivePosition(state, p.id, p.position) || p.position,
          rotation: effectiveRotation(state, p.id, p.rotation) || p.rotation,
          scale: effectiveScale(state, p.id, p.scale) ?? p.scale,
          ...(transform ? { transform } : {}),
        }
      }),
      craftedScenes: (state.craftedScenes || []).map(s => {
        const transform = readTransformOverride(state, s.id)
        return {
          id: s.id,
          name: s.name,
          objectCount: s.objects?.length || 0,
          position: effectivePosition(state, s.id, s.position) || s.position,
          rotation: effectiveRotation(state, s.id, undefined) || undefined,
          scale: effectiveScale(state, s.id, undefined),
          ...(transform ? { transform } : {}),
        }
      }),
      portalGates: (state.portalGates || []).map(gate => {
        const transform = readTransformOverride(state, gate.id)
        const rotation = effectiveRotation(state, gate.id, undefined)
        return {
          id: gate.id,
          type: 'portal',
          variant: gate.variant,
          label: gate.label || gate.targetWorldName || gate.variant,
          position: effectivePosition(state, gate.id, gate.position) || gate.position,
          rotationY: Array.isArray(rotation) ? rotation[1] : gate.rotationY,
          scale: effectiveScale(state, gate.id, gate.scale) ?? gate.scale,
          width: gate.width,
          height: gate.height,
          direction: gate.direction,
          sourceWorldId: gate.sourceWorldId,
          targetWorldId: gate.targetWorldId,
          targetWorldName: gate.targetWorldName,
          action: gate.action,
          spawnPose: gate.spawnPose,
          requiresLevel: gate.requiresLevel,
          linkedPortalId: gate.linkedPortalId,
          inert: gate.inert,
          ...(transform ? { transform } : {}),
        }
      }),
      spatialWebObjects: (state.spatialWebObjects || []).map(object => {
        const transform = readTransformOverride(state, object.id)
        return {
          id: object.id,
          type: object.type,
          label: object.label,
          formId: object.formId,
          value: object.value ?? null,
          position: effectivePosition(state, object.id, object.position) || object.position,
          rotation: effectiveRotation(state, object.id, object.rotation) || object.rotation,
          scale: effectiveScale(state, object.id, object.scale) ?? object.scale,
          options: object.options,
          action: object.action,
          ...(transform ? { transform } : {}),
        }
      }),
      agentWindows: (state.agentWindows || []).map(window => ({
        id: window.id,
        type: 'agent-window',
        agentType: window.agentType,
        label: window.label,
        position: window.position,
        rotation: window.rotation,
        scale: window.scale,
        width: window.width,
        height: window.height,
        renderMode: window.renderMode,
        browserSurfaceMode: window.browserSurfaceMode,
        surfaceUrl: window.surfaceUrl,
        frameStyle: window.frameStyle,
        frameThickness: window.frameThickness,
        linkedAvatarId: window.linkedAvatarId,
      })),
      lights: (state.lights || []).map(l => ({
        id: l.id, type: l.type, color: l.color, intensity: l.intensity, position: l.position, visible: l.visible,
      })),
      agentAvatars: agentAvatars.map(a => ({
        id: a.id,
        agentType: a.agentType,
        label: a.label,
        avatar3dUrl: a.avatar3dUrl,
        position: a.position,
        rotation: a.rotation,
        scale: a.scale,
        linkedWindowId: a.linkedWindowId,
      })),
      liveAgentAvatarsUpdatedAt: liveAgentContext ? new Date(liveAgentContext.updatedAt).toISOString() : null,
      livePlayerAvatar: livePlayerContext?.player.avatar || null,
      livePlayerCamera: livePlayerContext?.player.camera || null,
      livePlayerUpdatedAt: livePlayerContext?.updatedAt || null,
      // Multiplayer roster — every player connected to this worldId via the
      // Colyseus room. Pulled from the room server's /world-players HTTP
      // endpoint. Agents querying world state previously only saw the local
      // viewer's avatar; this exposes the full peer list.
      livePlayers: await fetchLivePlayers(worldId),
      conjuredAssetCount: (state.conjuredAssetIds || []).length,
      conjuredAssets: (state.conjuredAssetIds || []).map(assetId => summarizeWorldConjuredAsset(state, assetId)),
      behaviors: state.behaviors || {},
    },
  }
}

tools.get_world_info = async (args) => {
  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const world = await prisma.world.findFirst({ where: { id: worldId } })
  if (!world) return { ok: false, message: 'No world found.' }
  const objectCount = state
    ? (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) + (state.conjuredAssetIds?.length || 0) + (state.portalGates?.length || 0) + (state.spatialWebObjects?.length || 0) + (state.agentWindows?.length || 0)
    : 0
  const access = worldAccessDetails(world)

  return {
    ok: true,
    message: `World "${world.name}"`,
    data: {
      worldId: world.id,
      name: world.name,
      icon: world.icon,
      visibility: access.visibility,
      canRead: access.canRead,
      canWrite: access.canWrite,
      writeMode: access.writeMode,
      isCore: access.isCore,
      isTemplate: access.isTemplate,
      objectCount,
      sky: state?.skyBackgroundId || 'night007',
      ground: state?.groundPresetId || 'none',
      tileCount: state ? Object.keys(state.groundTiles || {}).length : 0,
      portalCount: state?.portalGates?.length || 0,
      spatialWebCount: state?.spatialWebObjects?.length || 0,
      agentWindowCount: state?.agentWindows?.length || 0,
      lightCount: state?.lights?.length || 0,
      lastSaved: world.updatedAt.toISOString(),
    },
  }
}

tools.query_objects = async (args) => {
  const { state, worldId } = await loadRequestedWorld(args.worldId)
  const query = validStr(args.query, '').toLowerCase()
  const near = validPos(args.near)
  const radius = validNum(args.radius, 20)
  const typeFilter = validStr(args.type, '')

  type ObjEntry = { id: string; type: string; name: string; position?: unknown; catalogId?: string }
  const results: ObjEntry[] = []

  if (!typeFilter || typeFilter === 'catalog') {
    for (const p of state.catalogPlacements || []) {
      results.push({
        id: p.id,
        type: 'catalog',
        name: p.name || p.catalogId,
        position: effectivePosition(state, p.id, p.position) || p.position,
        catalogId: p.catalogId,
      })
    }
  }
  if (!typeFilter || typeFilter === 'crafted') {
    for (const s of state.craftedScenes || []) {
      results.push({
        id: s.id,
        type: 'crafted',
        name: s.name,
        position: effectivePosition(state, s.id, s.position) || s.position,
      })
    }
  }
  if (!typeFilter || typeFilter === 'portal') {
    for (const gate of state.portalGates || []) {
      results.push({
        id: gate.id,
        type: 'portal',
        name: gate.label || gate.targetWorldName || gate.variant,
        position: effectivePosition(state, gate.id, gate.position) || gate.position,
      })
    }
  }
  if (!typeFilter || typeFilter === 'spatial-web') {
    for (const object of state.spatialWebObjects || []) {
      results.push({
        id: object.id,
        type: 'spatial-web',
        name: object.label,
        position: effectivePosition(state, object.id, object.position) || object.position,
      })
    }
  }
  if (!typeFilter || typeFilter === 'agent-window' || typeFilter === 'browser-window' || typeFilter === 'browser') {
    for (const window of state.agentWindows || []) {
      if ((typeFilter === 'browser-window' || typeFilter === 'browser') && window.agentType !== 'browser') continue
      results.push({
        id: window.id,
        type: window.agentType === 'browser' ? 'browser-window' : 'agent-window',
        name: window.label || (window.agentType === 'browser' ? browserWindowLabelForUrl(window.surfaceUrl || '') : window.agentType),
        position: window.position,
      })
    }
  }
  if (!typeFilter || typeFilter === 'light') {
    for (const l of state.lights || []) {
      results.push({ id: l.id, type: 'light', name: `${l.type} light`, position: l.position })
    }
  }
  if (!typeFilter || typeFilter === 'conjured') {
    for (const assetId of state.conjuredAssetIds || []) {
      const asset = getAssetById(assetId)
      const position = state.transforms?.[assetId]?.position || asset?.position
      results.push({
        id: assetId,
        type: 'conjured',
        name: asset?.displayName || asset?.prompt || assetId,
        position,
      })
    }
  }
  if (!typeFilter || typeFilter === 'agent-avatar') {
    for (const avatar of state.agentAvatars || []) {
      results.push({ id: avatar.id, type: 'agent-avatar', name: avatar.label || avatar.agentType, position: avatar.position })
    }
  }

  let filtered = results
  if (query) {
    filtered = filtered.filter(o => matchesObjectQuery(o, query))
  }
  if (near) {
    filtered = filtered.filter(o => {
      const pos = validPos(o.position)
      if (!pos) return true
      const d = Math.sqrt((pos[0] - near[0]) ** 2 + (pos[1] - near[1]) ** 2 + (pos[2] - near[2]) ** 2)
      return d <= radius
    })
  }

  return { ok: true, message: `Found ${filtered.length} objects in world ${worldId}.`, data: filtered }
}

tools.search_assets = async (args) => {
  const query = validStr(args.query, '')
  const category = validStr(args.category, '')
  const limit = Math.min(validNum(args.limit, 20), 50)
  const argViewer = validStr(args.viewerUserId, '')
  const argWorldId = validStr(args.worldId, '')
  const { listAssets } = await import('../forge/library/library-service')
  const { getLocalUserId } = await import('../local-auth')
  // Prefer explicit args (the relay forwards per-session identity); fall back
  // to the cookie context. Cookie context returns 'local-user' for stdio /
  // relay-invoked MCP calls with no Next request context, which would hide
  // every viewer's user-scope content — so callers should pass viewerUserId
  // when they have it.
  let viewerUserId = argViewer
  if (!viewerUserId) {
    try { viewerUserId = await getLocalUserId() } catch {}
  }
  if (!viewerUserId) viewerUserId = 'local-user'
  let results = await listAssets({
    viewerUserId,
    worldId: argWorldId || undefined,
    query: query || undefined,
    limit: 500,
  })
  if (category) results = results.filter(a => (a.category || '').toLowerCase() === category.toLowerCase())
  const trimmed = results.slice(0, limit).map(a => ({
    id: a.id,
    name: a.name,
    category: a.category || 'misc',
    defaultScale: a.defaultScale ?? 1,
    shortLabel: a.shortLabel || undefined,
    thumbnailUrl: a.thumbnailUrl || undefined,
    kind: a.kind,
    scope: a.scope,
  }))
  return { ok: true, message: `Found ${results.length} assets (${trimmed.length} returned).`, data: trimmed }
}

tools.list_ground_presets = async (args) => {
  const { GROUND_PRESETS } = await import('../forge/ground-textures')
  const query = validStr(args.query, '').toLowerCase()
  const limit = Math.min(validNum(args.limit, 30), 100)
  let results = GROUND_PRESETS.map((p: { id: string; name: string; icon?: string; tileRepeat?: number; customTextureUrl?: string; assetName?: string; shortLabel?: string; description?: string }) => ({
    id: p.id,
    label: p.shortLabel || p.name,
    description: p.description || '',
    icon: p.icon,
    tileRepeat: p.tileRepeat,
  }))
  if (query) {
    results = results.filter(p =>
      p.id.toLowerCase().includes(query) ||
      p.label.toLowerCase().includes(query) ||
      (p.description || '').toLowerCase().includes(query)
    )
  }
  return { ok: true, message: `${results.length} ground presets matched.`, data: results.slice(0, limit) }
}

tools.get_asset_catalog = async (args) => {
  const category = validStr(args.category, '')
  const argViewer = validStr(args.viewerUserId, '')
  const argWorldId = validStr(args.worldId, '')
  const { listAssets } = await import('../forge/library/library-service')
  const { getLocalUserId } = await import('../local-auth')
  let viewerUserId = argViewer
  if (!viewerUserId) {
    try { viewerUserId = await getLocalUserId() } catch {}
  }
  if (!viewerUserId) viewerUserId = 'local-user'
  const all = await listAssets({ viewerUserId, worldId: argWorldId || undefined, limit: 2000 })
  const byCategory: Record<string, Array<{ id: string; name: string; defaultScale?: number; scope?: string; shortLabel?: string }>> = {}
  for (const a of all) {
    const cat = a.category || 'misc'
    if (category && cat.toLowerCase() !== category.toLowerCase()) continue
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push({ id: a.id, name: a.name, defaultScale: a.defaultScale ?? 1, scope: a.scope, shortLabel: a.shortLabel || undefined })
  }
  return { ok: true, message: `${all.length} assets visible to viewer.`, data: byCategory }
}

// ─═̷─═̷─ WORLD BUILD ─═̷─═̷─

tools.place_object = async (args) => {
  const catalogId = validStr(args.assetId || args.catalogId, '')
  // First try the fast path: baked-in catalog index. Then fall back to the
  // unified Asset table so user-scope conjured/crafted ids work too.
  let asset: { id: string; name: string; path: string; defaultScale?: number } | undefined = CATALOG_MAP.get(catalogId)
  if (!asset) {
    try {
      const { listAssets } = await import('../forge/library/library-service')
      const { getLocalUserId } = await import('../local-auth')
      const argViewer = validStr((args as Record<string, unknown>).viewerUserId, '')
      const argWorldId = validStr((args as Record<string, unknown>).worldId, '')
      let viewerUserId = argViewer
      if (!viewerUserId) {
        try { viewerUserId = await getLocalUserId() } catch {}
      }
      if (!viewerUserId) viewerUserId = 'local-user'
      const matches = await listAssets({ viewerUserId, worldId: argWorldId || undefined, limit: 5000 })
      const found = matches.find(a => a.id === catalogId)
      if (found) {
        asset = { id: found.id, name: found.name, path: found.path, defaultScale: found.defaultScale }
      }
    } catch (err) {
      console.warn('[place_object] listAssets fallback failed:', err)
    }
  }
  if (!asset) return { ok: false, message: `Unknown asset: ${catalogId}. Use search_assets to find valid IDs.` }

  const position = validPos(args.position) || [0, 0, 0]
  const rotation = validPos(args.rotation) || [0, 0, 0]
  const scale = validNum(args.scale, asset.defaultScale || 1)
  const label = validStr(args.label, asset.name)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `catalog-${catalogId}-${uid()}`

  const placement: CatalogPlacement = {
    id, catalogId, name: label, glbPath: asset.path,
    position, rotation, scale,
  }

  state.catalogPlacements = [...(state.catalogPlacements || []), placement]
  await saveWorldState(worldId, state)
  emitWorldEvent('object_added', worldId, {
    id,
    catalogId,
    position,
    placement,
    ...mutationActorData(args),
  })

  return { ok: true, message: `Placed ${asset.name} (${catalogId}) at [${position.join(', ')}] as ${id}`, data: { id, catalogId, position } }
}

function defaultAgentWindowSize(agentType: AgentWindowEntry['agentType']): { width: number; height: number } {
  if (agentType === 'browser') return { width: DEFAULT_BROWSER_WINDOW_WIDTH, height: DEFAULT_BROWSER_WINDOW_HEIGHT }
  if (agentType === 'anorak-pro') return { width: 960, height: 720 }
  if (agentType === 'gemini') return { width: 740, height: 960 }
  return { width: 800, height: 600 }
}

function defaultAgentWindowFrame(agentType: AgentWindowEntry['agentType']): { frameStyle?: string; frameThickness?: number } {
  if (agentType === 'browser') {
    return {
      frameStyle: DEFAULT_BROWSER_WINDOW_FRAME_STYLE,
      frameThickness: DEFAULT_BROWSER_WINDOW_FRAME_THICKNESS,
    }
  }
  if (agentType === 'gemini') return { frameStyle: 'void', frameThickness: 7 }
  if (agentType === 'hermes') return { frameStyle: 'fire', frameThickness: 6 }
  return {}
}

function buildAgentWindowFromArgs(args: Record<string, unknown>, defaultAgentType: AgentWindowEntry['agentType'] = 'browser'): AgentWindowEntry | { error: string } {
  const rawAgentType = validStr(args.agentType || args.agent || args.type, '').trim().toLowerCase()
  if (rawAgentType && !AGENT_WINDOW_TYPES.has(rawAgentType)) {
    return {
      error: `Invalid agentType '${rawAgentType}'. Canonical values: ${[...AGENT_WINDOW_TYPES].join(', ')}.`,
    }
  }
  const agentType = validAgentWindowType(rawAgentType, defaultAgentType)
  const isBrowser = agentType === 'browser'
  const surfaceUrl = isBrowser ? normalizeBrowserWindowUrl(args.surfaceUrl || args.url || args.href) : normalizeBrowserWindowUrl(args.surfaceUrl || args.url || args.href)
  const defaultSize = defaultAgentWindowSize(agentType)
  const defaultFrame = defaultAgentWindowFrame(agentType)
  const requestedFrame = validAgentWindowFrameStyle(args.frameStyle || args.frame, defaultFrame.frameStyle)
  const frameStyle = requestedFrame === 'none' ? undefined : requestedFrame
  const frameThickness = args.frameThickness !== undefined
    ? Math.max(0.2, Math.min(150, validNum(args.frameThickness, defaultFrame.frameThickness || 1)))
    : defaultFrame.frameThickness
  const id = validStr(args.windowId || args.id, '') || `agent-${agentType}-${uid()}`
  const position = validPos(args.position) || [0, 2.25, -4]
  const rotation = validPos(args.rotation) || [0, 0, 0]
  const width = clampAgentWindowDimension(args.width, defaultSize.width)
  const height = clampAgentWindowDimension(args.height, defaultSize.height)
  const label = validStr(args.label || args.name, isBrowser ? browserWindowLabelForUrl(surfaceUrl) : agentType)
  return {
    id,
    agentType,
    position,
    rotation,
    scale: clampAgentWindowScale(args.scale, DEFAULT_BROWSER_WINDOW_SCALE),
    width,
    height,
    label,
    ...(validStr(args.sessionId, '') ? { sessionId: validStr(args.sessionId, '') } : {}),
    ...(validAgentWindowRenderMode(args.renderMode) ? { renderMode: validAgentWindowRenderMode(args.renderMode) } : { renderMode: 'live-html' as const }),
    ...(isBrowser ? { browserSurfaceMode: validBrowserSurfaceMode(args.browserSurfaceMode || args.surfaceMode), surfaceUrl } : surfaceUrl ? { surfaceUrl } : {}),
    ...(frameStyle ? { frameStyle } : {}),
    ...(frameThickness !== undefined ? { frameThickness } : {}),
  }
}

tools.place_agent_window = async (args) => {
  const actorAgentType = validStr(args.actorAgentType, '') || currentToolContext().agentType || ''
  const effectiveArgs = actorAgentType ? { ...args, actorAgentType } : args
  const agentWindow = buildAgentWindowFromArgs(effectiveArgs)
  if ('error' in agentWindow) return { ok: false, message: agentWindow.error }

  const { worldId, state } = await loadRequestedWorld(effectiveArgs.worldId)
  state.agentWindows = [
    ...(state.agentWindows || []).filter(window => window.id !== agentWindow.id),
    agentWindow,
  ]
  await saveWorldState(worldId, state)
  emitWorldEvent('agent_window_added', worldId, {
    id: agentWindow.id,
    windowId: agentWindow.id,
    agentType: agentWindow.agentType,
    position: agentWindow.position,
    window: agentWindow,
    ...mutationActorData(effectiveArgs),
  })

  const surface = agentWindow.agentType === 'browser' && agentWindow.surfaceUrl ? ` showing ${agentWindow.surfaceUrl}` : ''
  return {
    ok: true,
    message: `Placed ${agentWindow.agentType} 3D window${surface} at [${agentWindow.position.join(', ')}] as ${agentWindow.id}.`,
    data: agentWindow,
  }
}

tools.place_browser_window = async (args) => {
  return tools.place_agent_window({
    ...args,
    agentType: 'browser',
    frameStyle: args.frameStyle || DEFAULT_BROWSER_WINDOW_FRAME_STYLE,
    frameThickness: args.frameThickness ?? DEFAULT_BROWSER_WINDOW_FRAME_THICKNESS,
    browserSurfaceMode: args.browserSurfaceMode || 'live-browser',
  })
}

tools.create_spatial_web_object = async (args) => {
  const type = validSpatialWebObjectType(args.type, 'button')
  const label = validStr(args.label, type === 'button' ? 'Button' : type)
  const position = validPos(args.position) || [0, 1.2, -4]
  const rotation = validPos(args.rotation)
  const scale = validScale(args.scale)
  const width = args.width !== undefined ? Math.max(0.6, Math.min(8, validNum(args.width, 2.6))) : undefined
  const height = args.height !== undefined ? Math.max(0.35, Math.min(4, validNum(args.height, 0.82))) : undefined
  const min = args.min !== undefined ? validNum(args.min, 0) : undefined
  const max = args.max !== undefined ? validNum(args.max, 100) : undefined
  const step = args.step !== undefined ? validNum(args.step, 1) : undefined
  const options = parseSpatialWebOptions(args.options)
  const id = validStr(args.id, '') || `spatial-${type}-${uid()}`
  const formId = validStr(args.formId, '')
  const visualStyle = validSpatialWebVisualStyle(args.visualStyle || args.style)

  const fallbackValue: SpatialWebValue =
    type === 'toggle' ? false
      : type === 'slider' ? (min ?? 0)
        : type === 'select' ? options?.[0]?.value || ''
          : type === 'multiselect' ? []
            : type === 'text' || type === 'output' ? ''
              : null
  const value = validSpatialWebValue(args.value, fallbackValue)
  const actionType = validStr(args.actionType || args.action, '').toLowerCase()
  const destinationArgs = parseLooseObject(args.destination)
  const testMode = validBool(args.testMode, false) || validBool(destinationArgs.testMode, false)
  const submitForm = validBool(args.submitForm, false) || actionType === 'submit_form' || actionType === 'submit'
  const targetObjectId = validStr(args.targetObjectId || args.targetId, '')
  const actionValue = validSpatialWebValue(args.actionValue ?? args.valueToSet, null)
  const shouldSetValue = actionType === 'set_value' || actionType === 'set'
  const shouldSpawnVfx = actionType === 'spawn_vfx' || actionType === 'vfx'
  const shouldRunWorldTool = actionType === 'world_tool' || actionType === 'tool' || actionType === 'call_tool'
  const shouldCreateGoogleFormWorld = actionType === 'create_world_from_google_form'
    || actionType === 'google_form_world'
    || actionType === 'form_to_world'
  const worldTool = validStr(args.tool || args.toolName || args.worldTool, '')
  const worldToolArgs = parseLooseObject(args.args || args.toolArgs)
  const worldToolArgsByValue = parseLooseObjectRecord(args.argsByValue || args.toolArgsByValue)
  const destinationType = validStr(args.submitDestinationType || args.destinationType || destinationArgs.type, '').toLowerCase()
  const googleFormUrl = validStr(args.googleFormUrl || args.formUrl || destinationArgs.formUrl, '')
  const googleFormResponseUrl = validStr(args.googleFormResponseUrl || args.responseUrl || destinationArgs.responseUrl, '')
  const webhookUrl = validStr(args.webhookUrl || destinationArgs.webhookUrl, '')
  const fieldMap = parseStringRecord(args.fieldMap || destinationArgs.fieldMap)
  const answerKey = normalizeAnswerKeyArg(args.answerKey || destinationArgs.answerKey)
  const submitDestination: SpatialWebSubmitDestination | undefined =
    destinationType === 'google_form' || googleFormUrl || googleFormResponseUrl
      ? {
          type: 'google_form',
          ...(googleFormUrl ? { formUrl: googleFormUrl } : {}),
          ...(googleFormResponseUrl ? { responseUrl: googleFormResponseUrl } : {}),
          ...(Object.keys(fieldMap).length > 0 ? { fieldMap } : {}),
          ...(testMode ? { testMode: true, geminiReview: true } : {}),
          ...(answerKey ? { answerKey } : {}),
        }
      : destinationType === 'webhook' || webhookUrl
        ? {
            type: 'webhook',
            ...(webhookUrl ? { webhookUrl } : {}),
          }
        : undefined

  const action: SpatialWebObject['action'] =
    submitForm
      ? {
          type: 'submit_form',
          ...(validStr(args.endpoint, '') ? { endpoint: validStr(args.endpoint, '') } : {}),
          ...(validStr(args.successMessage, '') ? { successMessage: validStr(args.successMessage, '') } : {}),
          ...(submitDestination ? { destination: submitDestination } : {}),
        }
      : shouldSetValue && targetObjectId
        ? { type: 'set_value', targetObjectId, value: actionValue }
        : shouldSpawnVfx
          ? { type: 'spawn_vfx' }
          : shouldRunWorldTool && worldTool
            ? {
                type: 'world_tool',
                tool: worldTool,
                ...(Object.keys(worldToolArgs).length > 0 ? { args: worldToolArgs } : {}),
                ...(Object.keys(worldToolArgsByValue).length > 0 ? { argsByValue: worldToolArgsByValue } : {}),
              }
            : shouldCreateGoogleFormWorld
              ? {
                  type: 'create_world_from_google_form',
                  ...(testMode ? { testMode: true } : {}),
                  ...(validStr(args.successMessage, '') ? { successMessage: validStr(args.successMessage, '') } : {}),
                }
              : undefined

  const object: SpatialWebObject = {
    id,
    type,
    label,
    position,
    ...(rotation ? { rotation } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(formId ? { formId } : {}),
    ...(validStr(args.description, '') ? { description: validStr(args.description, '') } : {}),
    ...(validStr(args.placeholder, '') ? { placeholder: validStr(args.placeholder, '') } : {}),
    ...(validStr(args.accentColor, '') ? { accentColor: validStr(args.accentColor, '') } : {}),
    ...(visualStyle ? { visualStyle } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(options ? { options } : {}),
    ...(value !== null ? { value } : {}),
    ...(action ? { action } : {}),
  }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.spatialWebObjects = [
    ...(state.spatialWebObjects || []).filter(entry => entry.id !== id),
    object,
  ]

  await saveWorldState(worldId, state)
  emitWorldEvent('object_added', worldId, {
    id,
    objectId: id,
    position,
    spatialWebObject: object,
    ...mutationActorData(args),
  })

  return {
    ok: true,
    message: `Created spatial ${type} "${label}" at [${position.join(', ')}] as ${id}.`,
    data: { id, type, label, formId: formId || undefined, position, object },
  }
}

async function createWorldFromGoogleForm(args: Record<string, unknown>, options: { testMode?: boolean } = {}) {
  const testMode = options.testMode === true
  const formUrl = validStr(args.formUrl || args.url, '').trim()
  if (!formUrl) return { ok: false, message: 'formUrl is required.' }

  let normalizedFormUrl: string
  try {
    const url = new URL(formUrl)
    const isGoogleFormHost = url.hostname === 'forms.gle'
      || url.hostname === 'google.com'
      || url.hostname.endsWith('.google.com')
    const looksLikeGoogleFormPath = url.hostname === 'forms.gle' || url.pathname.includes('/forms/')
    if (!isGoogleFormHost || !looksLikeGoogleFormPath) {
      return { ok: false, message: 'formUrl must be a public Google Forms URL.' }
    }
    normalizedFormUrl = url.toString()
  } catch {
    return { ok: false, message: 'formUrl must be a valid URL.' }
  }

  const response = await fetch(normalizedFormUrl, { cache: 'no-store' })
  if (!response.ok) return { ok: false, message: `Google Form fetch failed: HTTP ${response.status}.` }

  const html = await response.text()
  const finalFormUrl = response.url && response.url.startsWith('http') ? response.url : normalizedFormUrl
  const spec = parseGoogleFormHtml(html, finalFormUrl)
  if (spec.fields.length === 0) {
    return {
      ok: false,
      message: 'Fetched the Google Form, but could not find supported entry fields. Make sure the form is public.',
      data: { title: spec.title },
    }
  }

  const answerKey = normalizeAnswerKeyArg(args.answerKey)
  const formId = `${testMode ? 'google-test' : 'google-form'}-${uid()}`
  const spatialWebObjects = googleFormSpecToSpatialWebObjects(spec, formId, {
    testMode,
    answerKey,
    geminiReview: testMode,
  })
  const now = new Date()
  const worldId = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const name = validStr(args.name, testMode ? `${spec.title} Test` : spec.title)
  const icon = validStr(args.icon, testMode ? 'T' : 'UI')
  const visibility = validWorldVisibility(args.visibility, 'unlisted')
  const testAgents = testMode ? buildGeminiTestTutorAgents() : { agentWindows: [], agentAvatars: [] }
  const state: WorldState = {
    version: 1,
    terrain: null,
    groundPresetId: validStr(args.groundPresetId, 'grass'),
    groundTiles: googleFormSpecToJourneyGroundTiles(spec),
    terrainHeights: [],
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    portalGates: [createPortalZeroReturnGate(worldId)],
    spatialWebObjects,
    transforms: {},
    behaviors: {},
    lights: buildSpatialFormLights(),
    skyBackgroundId: validStr(args.skyBackgroundId, 'sunny_vondelpark'),
    agentWindows: testAgents.agentWindows,
    agentAvatars: testAgents.agentAvatars,
    savedAt: now.toISOString(),
  }

  await prisma.world.create({
    data: {
      id: worldId,
      userId: currentToolContext().userId || LOCAL_USER_ID,
      name,
      icon,
      visibility,
      data: JSON.stringify(state),
      objectCount: countWorldObjects(state),
      createdAt: now,
      updatedAt: now,
    },
  })

  const worldUrl = buildWorldUrl(worldId, args.publicBaseUrl)
  return {
    ok: true,
    message: `Created shareable spatial ${testMode ? 'test' : 'Google Form'} world "${name}" with ${spec.fields.length} field${spec.fields.length === 1 ? '' : 's'}.`,
    data: {
      worldId,
      worldName: name,
      worldUrl,
      qrUrl: buildQrCodeUrl(worldUrl),
      visibility,
      formId,
      formUrl: spec.formUrl,
      responseUrl: spec.responseUrl,
      fields: spec.fields.map(field => ({ label: field.label, entryId: field.entryId, type: field.type })),
      spatialObjectCount: spatialWebObjects.length,
      testMode,
      hasAnswerKey: Boolean(answerKey),
      geminiTutorSpawned: testMode,
    },
  }
}

tools.create_world_from_google_form = async (args) => createWorldFromGoogleForm(args)

tools.create_test_world_from_google_form = async (args) => createWorldFromGoogleForm(args, { testMode: true })

tools.share_world_link = async (args) => {
  const { worldId } = await loadRequestedWorld(args.worldId)
  const visibility = validWorldVisibility(args.visibility, 'unlisted')
  await prisma.world.update({
    where: { id: worldId },
    data: { visibility, updatedAt: new Date() },
  })
  const worldUrl = buildWorldUrl(worldId, args.publicBaseUrl)
  return {
    ok: true,
    message: `World ${worldId} is ${visibility}. Share ${worldUrl}`,
    data: {
      worldId,
      worldUrl,
      qrUrl: buildQrCodeUrl(worldUrl),
      visibility,
    },
  }
}

function normalizeCraftModel(value: unknown): string {
  const requested = validStr(value, '').toLowerCase()
  if (!requested) return 'cc-opus'
  if (requested === 'opus') return 'cc-opus'
  if (requested === 'sonnet') return 'cc-sonnet'
  return requested
}

const CRAFT_GEOMETRY_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'text'] as const
const CRAFT_SHADER_TYPES = ['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora'] as const
const CRAFT_ANIMATION_TYPES = ['rotate', 'bob', 'pulse', 'swing', 'orbit'] as const
const CRAFT_TEXTURE_PRESETS = [
  'stone', 'cobblestone', 'marble', 'concrete', 'rock', 'grass', 'sand', 'dirt', 'snow', 'metal', 'gravel', 'forest-floor',
  'kn-planks', 'kn-cobblestone', 'kn-roof', 'kn-wall', 'kn-asphalt', 'kn-concrete', 'kn-metal', 'kn-rock',
] as const

const SELF_CRAFT_GUIDE = {
  strategyDefault: 'agent',
  geometryTypes: CRAFT_GEOMETRY_TYPES,
  shaderTypes: CRAFT_SHADER_TYPES,
  animationTypes: CRAFT_ANIMATION_TYPES,
  texturePresets: CRAFT_TEXTURE_PRESETS,
  requiredFields: ['type', 'position', 'scale', 'color'],
  optionalFields: [
    'rotation', 'metalness', 'roughness', 'opacity', 'emissive', 'emissiveIntensity',
    'color2', 'color3', 'intensity', 'speed', 'particleCount', 'particleType', 'seed',
    'text', 'fontSize', 'texturePresetId', 'textureRepeat', 'animation',
  ],
  animationFields: ['type', 'speed', 'axis', 'amplitude'],
  rules: [
    'Do not add terrain, floor planes, sky domes, or background walls; Oasis already provides the world ground and sky.',
    'Use shader primitives aggressively for fire, cloth, crystals, water, particles, glow, and aurora effects.',
    'Use many overlapping primitives for richer silhouettes instead of one oversized primitive.',
    'Keep flames physically small and pair fire with particle_emitter embers.',
    'Crystal clusters should use 3+ crystals with varied seeds, scales, and rotations.',
    'At least some primitives should have non-zero rotation for visual interest.',
  ],
  example: {
    name: 'Arcane campfire',
    objects: [
      { type: 'cylinder', position: [0, 0.08, 0], scale: [0.55, 0.08, 0.55], color: '#3b2a1d', roughness: 0.92 },
      { type: 'flame', position: [0, 0.3, 0], scale: [0.22, 0.35, 0.22], color: '#fff4dd', color2: '#ff7a00', color3: '#9b1d00', intensity: 1, speed: 1.1 },
      { type: 'particle_emitter', position: [0, 0.75, 0], scale: [0.45, 0.85, 0.45], color: '#ffb347', color2: '#ff4d00', particleCount: 80, particleType: 'ember', speed: 0.7 },
      { type: 'crystal', position: [0.65, 0.32, 0.1], scale: [0.22, 0.6, 0.22], rotation: [0.14, 0.3, -0.08], color: '#4338ca', color2: '#8b5cf6', seed: 11 },
    ],
  },
} as const

function usesSelfCraftByDefault(actorAgentType: string): boolean {
  return actorAgentType === 'hermes' || actorAgentType === 'merlin' || actorAgentType === 'openclaw'
}

async function startPromptCraftJob(
  args: Record<string, unknown>,
  worldId: string,
  position: [number, number, number],
  prompt: string,
  name: string,
  model: string,
) {
  const { extractPartialCraftData } = await import('../craft-stream')
  const jobId = `craft-job-${uid()}`
  const sceneId = `crafted-mcp-${uid()}`
  const nowIso = new Date().toISOString()
  const placeholderScene: CraftedScene = {
    id: sceneId,
    name: 'Crafting...',
    prompt,
    objects: [],
    position,
    createdAt: nowIso,
    model,
  }

  writeCraftJob({
    id: jobId,
    status: 'queued',
    worldId,
    sceneId,
    prompt,
    model,
    name: placeholderScene.name,
    objectCount: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
  })

  const run = async (): Promise<ToolResult> => {
    try {
      updateCraftJob(jobId, current => ({
        ...current,
        status: 'running',
        updatedAt: new Date().toISOString(),
      }))

      await upsertCraftedSceneInWorld(worldId, placeholderScene, args, 'scene_craft_progress')

      const isCC = model.startsWith('cc-')
      const response = await fetch(`${INTERNAL_OASIS_BASE_URL}/api/craft/${isCC ? 'cc' : 'stream'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      })

      const errorBody = !response.ok ? await response.json().catch(() => null) as { error?: string } | null : null
      if (!response.ok) {
        throw new Error(errorBody?.error || `HTTP ${response.status}`)
      }
      if (!response.body) {
        throw new Error('No craft stream body returned.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let lastObjectCount = 0
      let lastSceneName = placeholderScene.name

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        accumulated += decoder.decode(value, { stream: true })
        const partial = extractPartialCraftData(accumulated)
        const nextName = partial.name || name || placeholderScene.name

        if (partial.objects.length !== lastObjectCount || nextName !== lastSceneName) {
          const progressScene: CraftedScene = {
            ...placeholderScene,
            name: nextName,
            objects: [...partial.objects],
          }
          await upsertCraftedSceneInWorld(worldId, progressScene, args, 'scene_craft_progress')
          lastObjectCount = partial.objects.length
          lastSceneName = nextName
          updateCraftJob(jobId, current => ({
            ...current,
            name: nextName,
            objectCount: partial.objects.length,
            updatedAt: new Date().toISOString(),
          }))
        }
      }

      const finalParsed = extractPartialCraftData(accumulated)
      if (finalParsed.objects.length === 0) {
        await removeCraftedSceneFromWorld(worldId, sceneId, args)
        const failedAt = new Date().toISOString()
        updateCraftJob(jobId, current => ({
          ...current,
          status: 'failed',
          name: name || current.name,
          objectCount: 0,
          updatedAt: failedAt,
          error: 'Craft stream returned no valid objects.',
        }))
        return {
          ok: false,
          message: 'Craft stream returned no valid objects.',
          data: { jobId, status: 'failed', sceneId },
        }
      }

      const finalScene: CraftedScene = {
        ...placeholderScene,
        name: finalParsed.name || name || 'Crafted Scene',
        objects: finalParsed.objects,
      }
      await upsertCraftedSceneInWorld(worldId, finalScene, args, 'scene_crafted')
      const completedAt = new Date().toISOString()
      updateCraftJob(jobId, current => ({
        ...current,
        status: 'completed',
        name: finalScene.name,
        objectCount: finalScene.objects.length,
        updatedAt: completedAt,
      }))
      return {
        ok: true,
        message: `Crafted "${finalScene.name}" (${finalScene.objects.length} primitives) as ${sceneId}.`,
        data: {
          jobId,
          status: 'completed',
          id: sceneId,
          name: finalScene.name,
          objectCount: finalScene.objects.length,
        },
      }
    } catch (error) {
      const failedAt = new Date().toISOString()
      updateCraftJob(jobId, current => ({
        ...current,
        status: 'failed',
        updatedAt: failedAt,
        error: error instanceof Error ? error.message : String(error),
      }))
      await removeCraftedSceneFromWorld(worldId, sceneId, args).catch(() => {})
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Craft job failed.',
        data: {
          jobId,
          status: 'failed',
          sceneId,
        },
      }
    }
  }

  return { jobId, sceneId, run }
}

tools.craft_scene = async (args) => {
  const position = validPos(args.position) || [0, 0, 0]
  const rawObjects = parseLooseObjectArray(args.objects)
  const promptStr = validStr(args.prompt, '')
  const requestedName = validStr(args.name, 'Crafted Scene')
  const strategy = validStr(args.strategy, '').toLowerCase()
  const actorAgentType = validStr(args.actorAgentType || args.agentType || args.agent, '').toLowerCase()

  // If prompt is provided and no objects, route through the LLM crafting pipeline
  if (promptStr && rawObjects.length === 0) {
    if (usesSelfCraftByDefault(actorAgentType) && strategy !== 'sculptor') {
      return {
        ok: false,
        message: `${actorAgentType[0]?.toUpperCase() || 'A'}${actorAgentType.slice(1) || 'gent'} defaults to self-crafted scenes. Provide an objects array or explicitly set strategy: "sculptor" for prompt-mode fallback. Call get_craft_guide for the supported primitive schema.`,
        data: {
          strategyDefault: 'agent',
          fallbackStrategy: 'sculptor',
          actorAgentType,
        },
      }
    }

    const model = normalizeCraftModel(args.model)
    const waitForCompletion = validBool(args.waitForCompletion, false)
    const { worldId } = await loadRequestedWorld(args.worldId)
    const job = await startPromptCraftJob(args, worldId, position, promptStr, requestedName, model)

    if (waitForCompletion) {
      return job.run()
    }

    void job.run()
    return {
      ok: true,
      message: `Craft job ${job.jobId} started with ${model}. Poll get_craft_job for progress.`,
      data: {
        jobId: job.jobId,
        sceneId: job.sceneId,
        status: 'running',
        worldId,
        model,
      },
    }
  }

  // Direct primitive placement — no LLM involved
  const name = requestedName
  const objects = rawObjects.filter(o => {
    if (!o || typeof o !== 'object') return false
    const obj = o as Record<string, unknown>
    return obj.type && obj.position && obj.scale && obj.color
  }) as unknown as CraftedScene['objects']

  if (objects.length === 0) return { ok: false, message: 'No valid primitives in scene. Each needs type, position, scale, color. Or provide a "prompt" to have the LLM design the scene.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `crafted-mcp-${uid()}`

  const scene: CraftedScene = {
    id, name, prompt: promptStr || 'mcp-tool', objects, position, createdAt: new Date().toISOString(),
  }
  state.craftedScenes = [...(state.craftedScenes || []), scene]
  if (position.some(v => v !== 0)) {
    state.transforms[id] = { position }
  }
  await saveWorldState(worldId, state)
  emitWorldEvent('scene_crafted', worldId, {
    id,
    name,
    position,
    scene,
    transform: state.transforms[id],
    ...mutationActorData(args),
  })

  return { ok: true, message: `Created scene "${name}" with ${objects.length} primitives as ${id}`, data: { id, name, objectCount: objects.length } }
}

tools.self_craft_scene = async (args) => {
  const promptStr = validStr(args.prompt, '').trim()
  const strategy = validStr(args.strategy, '').trim().toLowerCase()
  const rawObjects = parseLooseObjectArray(args.objects)

  if (promptStr || strategy === 'sculptor') {
    return {
      ok: false,
      message: 'self_craft_scene only accepts explicit primitive objects. Call get_craft_guide, build an objects array yourself, then call self_craft_scene.',
      data: {
        code: 'self_craft_requires_objects',
        rejectedFields: [
          ...(promptStr ? ['prompt'] : []),
          ...(strategy === 'sculptor' ? ['strategy'] : []),
        ],
      },
    }
  }

  if (rawObjects.length === 0) {
    return {
      ok: false,
      message: 'self_craft_scene requires an objects array. Call get_craft_guide for supported primitive types, fields, shaders, and animation schema.',
      data: { code: 'self_craft_requires_objects' },
    }
  }

  const result = await tools.craft_scene({
    ...args,
    prompt: undefined,
    model: undefined,
    waitForCompletion: true,
    strategy: 'agent',
  })

  if (!result.ok && result.message.includes('provide a "prompt"')) {
    return {
      ...result,
      message: 'No valid primitives in scene. Each primitive needs type, position, scale, and color. Call get_craft_guide for the exact self-craft schema.',
    }
  }

  return result
}

tools.get_craft_job = async (args) => {
  const jobId = validStr(args.jobId, '')
  if (!jobId) return { ok: false, message: 'jobId is required.' }
  const job = readCraftJob(jobId)
  if (!job) {
    return { ok: false, message: `Craft job ${jobId} not found.` }
  }
  return {
    ok: true,
    message: `Craft job ${jobId} is ${job.status}.`,
    data: {
      ...job,
    },
  }
}

tools.get_craft_guide = async () => ({
  ok: true,
  message: 'Self-craft guide ready. Use this schema to build explicit objects arrays for craft_scene.',
  data: SELF_CRAFT_GUIDE,
})

tools.modify_object = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const changes: string[] = []
  const pos = validPos(args.position)
  const rot = validPos(args.rotation)
  const scl = args.scale !== undefined ? validScale(args.scale, 1) : undefined
  const craftedIdx = (state.craftedScenes || []).findIndex(scene => scene.id === objectId)
  if (craftedIdx >= 0) {
    const scene = state.craftedScenes![craftedIdx]
    if (args.position) { scene.position = validPos(args.position) || scene.position; changes.push('position') }
    if (args.label) { scene.name = validStr(args.label, scene.name); changes.push('label') }
    state.craftedScenes![craftedIdx] = scene
  }

  // Find in catalog placements — only update label here.
  // Position/rotation/scale go through transforms (the override layer) to avoid
  // double-application: SelectableWrapper applies transforms, CatalogModelRenderer applies placement.
  const catalogIdx = (state.catalogPlacements || []).findIndex(p => p.id === objectId)
  if (catalogIdx >= 0) {
    const p = state.catalogPlacements![catalogIdx]
    if (args.label) { p.name = validStr(args.label, p.name); changes.push('label') }
    state.catalogPlacements![catalogIdx] = p
  }

  const spatialIdx = (state.spatialWebObjects || []).findIndex(object => object.id === objectId)
  if (spatialIdx >= 0) {
    const object = state.spatialWebObjects![spatialIdx]
    if (args.label) { object.label = validStr(args.label, object.label); changes.push('label') }
    if (args.value !== undefined) { object.value = validSpatialWebValue(args.value, object.value ?? null); changes.push('value') }
    if (args.accentColor) { object.accentColor = validStr(args.accentColor, object.accentColor || '#38bdf8'); changes.push('accentColor') }
    if (args.description !== undefined) { object.description = validStr(args.description, ''); changes.push('description') }
    state.spatialWebObjects![spatialIdx] = object
  }

  const avatarIdx = (state.agentAvatars || []).findIndex(avatar => avatar.id === objectId)
  if (avatarIdx >= 0) {
    const avatar = state.agentAvatars![avatarIdx]
    if (args.label) {
      avatar.label = validStr(args.label, avatar.label || avatar.agentType)
      changes.push('label')
    }
    if (args.scale !== undefined) {
      avatar.scale = validNum(args.scale, avatar.scale)
      changes.push('scale')
    }
    if (pos) {
      avatar.position = pos
      changes.push('position')
    }
    if (rot) {
      avatar.rotation = rot
      changes.push('rotation')
    }
    state.agentAvatars![avatarIdx] = avatar
    delete state.transforms[objectId]
  }

  const agentWindowIdx = (state.agentWindows || []).findIndex(window => window.id === objectId)
  if (agentWindowIdx >= 0) {
    const window = state.agentWindows![agentWindowIdx]
    if (args.label) {
      window.label = validStr(args.label, window.label || window.agentType)
      changes.push('label')
    }
    if (pos) {
      window.position = pos
      changes.push('position')
    }
    if (rot) {
      window.rotation = rot
      changes.push('rotation')
    }
    if (args.scale !== undefined) {
      window.scale = clampAgentWindowScale(args.scale, window.scale)
      changes.push('scale')
    }
    if (args.width !== undefined) {
      window.width = clampAgentWindowDimension(args.width, window.width)
      changes.push('width')
    }
    if (args.height !== undefined) {
      window.height = clampAgentWindowDimension(args.height, window.height)
      changes.push('height')
    }
    if (args.surfaceUrl !== undefined || args.url !== undefined || args.href !== undefined) {
      window.surfaceUrl = normalizeBrowserWindowUrl(args.surfaceUrl || args.url || args.href)
      changes.push('surfaceUrl')
    }
    if (args.browserSurfaceMode !== undefined || args.surfaceMode !== undefined) {
      window.browserSurfaceMode = validBrowserSurfaceMode(args.browserSurfaceMode || args.surfaceMode)
      changes.push('browserSurfaceMode')
    }
    if (args.frameStyle !== undefined || args.frame !== undefined) {
      const frameStyle = validAgentWindowFrameStyle(args.frameStyle || args.frame)
      window.frameStyle = frameStyle === 'none' ? undefined : frameStyle
      changes.push('frameStyle')
    }
    if (args.frameThickness !== undefined) {
      window.frameThickness = Math.max(0.2, Math.min(150, validNum(args.frameThickness, window.frameThickness || 1)))
      changes.push('frameThickness')
    }
    const renderMode = validAgentWindowRenderMode(args.renderMode)
    if (renderMode) {
      window.renderMode = renderMode
      changes.push('renderMode')
    }
    state.agentWindows![agentWindowIdx] = window
    delete state.transforms[objectId]
  }

  // Update transform overrides
  if (avatarIdx < 0 && agentWindowIdx < 0 && (pos || rot || scl !== undefined)) {
    const existing = state.transforms[objectId] || {}
    if (pos) existing.position = pos
    if (rot) existing.rotation = rot
    if (scl !== undefined) existing.scale = scl
    state.transforms[objectId] = existing
    if (!changes.includes('position') && pos) changes.push('position')
    if (!changes.includes('rotation') && rot) changes.push('rotation')
    if (!changes.includes('scale') && scl !== undefined) changes.push('scale')
  }

  // Update behaviors (label, visibility, etc.)
  if (args.visible !== undefined || args.label) {
    if (!state.behaviors) state.behaviors = {}
    const existing = state.behaviors[objectId] || { visible: true, movement: { type: 'static' as const } }
    if (args.visible !== undefined) { existing.visible = Boolean(args.visible); changes.push('visible') }
    if (args.label) { existing.label = validStr(args.label, ''); changes.push('label') }
    state.behaviors[objectId] = existing
  }

  if (changes.length === 0) return { ok: false, message: `Object ${objectId} not found or no changes specified.` }

  await saveWorldState(worldId, state)
  const eventPosition = pos
    || validPos(state.transforms[objectId]?.position)
    || validPos(state.catalogPlacements?.[catalogIdx]?.position)
    || validPos(state.craftedScenes?.[craftedIdx]?.position)
    || validPos(state.spatialWebObjects?.[spatialIdx]?.position)
    || validPos(state.agentAvatars?.find(avatar => avatar.id === objectId)?.position)
    || validPos(state.agentWindows?.find(window => window.id === objectId)?.position)
  emitWorldEvent('object_modified', worldId, {
    objectId,
    changes,
    ...(eventPosition ? { position: eventPosition } : {}),
    ...(catalogIdx >= 0 ? { placement: state.catalogPlacements?.[catalogIdx] } : {}),
    ...(craftedIdx >= 0 ? { scene: state.craftedScenes?.[craftedIdx] } : {}),
    ...(spatialIdx >= 0 ? { spatialWebObject: state.spatialWebObjects?.[spatialIdx] } : {}),
    ...(avatarIdx >= 0 ? { avatar: state.agentAvatars?.[avatarIdx] } : {}),
    ...(agentWindowIdx >= 0 ? { agentWindow: state.agentWindows?.[agentWindowIdx], window: state.agentWindows?.[agentWindowIdx] } : {}),
    ...(state.transforms[objectId] ? { transform: state.transforms[objectId] } : {}),
    ...(state.behaviors?.[objectId] ? { behavior: state.behaviors[objectId] } : {}),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Modified ${objectId}: ${changes.join(', ')}` }
}

tools.remove_object = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const beforeCatalog = state.catalogPlacements?.length || 0
  const beforeCrafted = state.craftedScenes?.length || 0
  const beforeAvatars = state.agentAvatars?.length || 0
  const beforeSpatial = state.spatialWebObjects?.length || 0
  const beforeAgentWindows = state.agentWindows?.length || 0
  const linkedAvatarIds = new Set(
    (state.agentAvatars || [])
      .filter(avatar => avatar.linkedWindowId === objectId)
      .map(avatar => avatar.id),
  )
  const removedPosition =
    validPos(state.transforms[objectId]?.position)
    || validPos((state.catalogPlacements || []).find(p => p.id === objectId)?.position)
    || validPos((state.craftedScenes || []).find(s => s.id === objectId)?.position)
    || validPos((state.spatialWebObjects || []).find(object => object.id === objectId)?.position)
    || validPos((state.agentAvatars || []).find(a => a.id === objectId)?.position)
    || validPos((state.agentWindows || []).find(window => window.id === objectId)?.position)

  state.catalogPlacements = (state.catalogPlacements || []).filter(p => p.id !== objectId)
  state.craftedScenes = (state.craftedScenes || []).filter(s => s.id !== objectId)
  state.agentAvatars = (state.agentAvatars || []).filter(a => a.id !== objectId && a.linkedWindowId !== objectId)
  state.spatialWebObjects = (state.spatialWebObjects || []).filter(object => object.id !== objectId)
  state.agentWindows = (state.agentWindows || []).filter(window => window.id !== objectId)
  delete state.transforms[objectId]
  for (const avatarId of linkedAvatarIds) delete state.transforms[avatarId]
  if (state.behaviors) delete state.behaviors[objectId]

  const removed =
    (beforeCatalog - (state.catalogPlacements?.length || 0)) +
    (beforeCrafted - (state.craftedScenes?.length || 0)) +
    (beforeAvatars - (state.agentAvatars?.length || 0)) +
    (beforeSpatial - (state.spatialWebObjects?.length || 0)) +
    (beforeAgentWindows - (state.agentWindows?.length || 0))
  if (removed === 0) return { ok: false, message: `Object ${objectId} not found in world.` }

  await saveWorldState(worldId, state)
  emitWorldEvent('object_removed', worldId, {
    objectId,
    ...(linkedAvatarIds.size > 0 ? { linkedAvatarIds: [...linkedAvatarIds] } : {}),
    ...(removedPosition ? { position: removedPosition } : {}),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Removed ${objectId}.` }
}

tools.set_sky = async (args) => {
  const presetId = validStr(args.presetId, '')
  if (!presetId) return { ok: false, message: 'presetId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.skyBackgroundId = presetId
  await saveWorldState(worldId, state)
  emitWorldEvent('sky_changed', worldId, { presetId, ...mutationActorData(args) })
  return { ok: true, message: `Sky set to ${presetId}.` }
}

tools.set_ground_preset = async (args) => {
  const presetId = validStr(args.presetId, '')
  if (!presetId) return { ok: false, message: 'presetId is required (none, grass, sand, dirt, stone, snow, water).' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.groundPresetId = presetId
  await saveWorldState(worldId, state)
  emitWorldEvent('ground_changed', worldId, { presetId, ...mutationActorData(args) })
  return { ok: true, message: `Ground set to ${presetId}.` }
}

tools.paint_ground_tiles = async (args) => {
  const tiles = parseLooseObjectArray(args.tiles)
  if (tiles.length === 0) return { ok: false, message: 'tiles array is required: [{x, z, presetId}]' }
  const fallbackPresetId = validStr(args.presetId, '')

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  if (!state.groundTiles) state.groundTiles = {}

  let painted = 0
  for (const tile of tiles) {
    if (!tile || typeof tile !== 'object') continue
    const t = tile as Record<string, unknown>
    const x = Math.floor(validNum(t.x, NaN))
    const z = Math.floor(validNum(t.z, NaN))
    const presetId = validStr(t.presetId, fallbackPresetId)
    if (!Number.isFinite(x) || !Number.isFinite(z) || !presetId) continue
    if (x < -50 || x > 49 || z < -50 || z > 49) continue

    state.groundTiles[`${x},${z}`] = presetId
    painted++
  }

  if (painted === 0) return { ok: false, message: 'No valid tiles to paint. Format: {x: int, z: int, presetId: string}' }

  await saveWorldState(worldId, state)
  emitWorldEvent('tiles_painted', worldId, {
    painted,
    tiles: tiles
      .map(tile => {
        if (!tile || typeof tile !== 'object') return null
        const t = tile as Record<string, unknown>
        const x = Math.floor(validNum(t.x, NaN))
        const z = Math.floor(validNum(t.z, NaN))
        const presetId = validStr(t.presetId, fallbackPresetId)
        if (!Number.isFinite(x) || !Number.isFinite(z) || !presetId) return null
        return { x, z, presetId }
      })
      .filter((tile): tile is { x: number; z: number; presetId: string } => !!tile),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Painted ${painted} ground tiles.`, data: { painted, totalTiles: Object.keys(state.groundTiles).length } }
}

tools.add_light = async (args) => {
  const type = validStr(args.type, 'point') as WorldLight['type']
  const position = validPos(args.position) || [0, 5, 0]
  const color = validStr(args.color, '#ffffff')
  const intensity = validNum(args.intensity, 3)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `light-mcp-${uid()}`
  const light: WorldLight = { id, type, color, intensity, position, visible: true }
  state.lights = [...(state.lights || []), light]
  await saveWorldState(worldId, state)
  emitWorldEvent('light_added', worldId, { id, type, position, light, ...mutationActorData(args) })

  return { ok: true, message: `Added ${type} light (${id}) at [${position.join(', ')}] color=${color} intensity=${intensity}`, data: { id } }
}

tools.modify_light = async (args) => {
  const lightId = validStr(args.lightId, '')
  if (!lightId) return { ok: false, message: 'lightId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const idx = (state.lights || []).findIndex(l => l.id === lightId)
  if (idx < 0) return { ok: false, message: `Light ${lightId} not found.` }

  const light = state.lights![idx]
  const changes: string[] = []
  if (args.color) { light.color = validStr(args.color, light.color); changes.push('color') }
  if (args.intensity !== undefined) { light.intensity = validNum(args.intensity, light.intensity); changes.push('intensity') }
  if (args.position) { light.position = validPos(args.position) || light.position; changes.push('position') }
  if (args.visible !== undefined) { light.visible = Boolean(args.visible); changes.push('visible') }
  state.lights![idx] = light
  await saveWorldState(worldId, state)
  emitWorldEvent('light_modified', worldId, {
    lightId,
    changes,
    light,
    position: light.position,
    ...mutationActorData(args),
  })

  return { ok: true, message: `Modified light ${lightId}: ${changes.join(', ')}` }
}

tools.set_behavior = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }
  const movement = validStr(args.movement, 'static')

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  if (!state.behaviors) state.behaviors = {}

  const movementPreset =
    movement === 'spin' ? { type: 'spin' as const, axis: 'y' as const, speed: validNum(args.speed, 1) } :
    movement === 'hover' ? { type: 'hover' as const, amplitude: validNum(args.amplitude, 0.5), speed: validNum(args.speed, 1), offset: 0 } :
    movement === 'orbit' ? { type: 'orbit' as const, radius: validNum(args.radius, 2), speed: validNum(args.speed, 1), axis: 'xz' as const } :
    movement === 'bounce' ? { type: 'bounce' as const, height: validNum(args.height, 1), speed: validNum(args.speed, 1) } :
    movement === 'patrol' ? { type: 'patrol' as const, radius: validNum(args.radius, 3), speed: validNum(args.speed, 1) } :
    { type: 'static' as const }

  const existing = state.behaviors[objectId]
  state.behaviors[objectId] = {
    visible: existing?.visible ?? true,
    movement: movementPreset,
    ...(args.label ? { label: validStr(args.label, '') } : existing?.label ? { label: existing.label } : {}),
  }

  await saveWorldState(worldId, state)
  const behaviorPosition =
    validPos(state.transforms[objectId]?.position)
    || validPos((state.catalogPlacements || []).find(entry => entry.id === objectId)?.position)
    || validPos((state.craftedScenes || []).find(entry => entry.id === objectId)?.position)
    || validPos((state.agentAvatars || []).find(entry => entry.id === objectId)?.position)
  emitWorldEvent('behavior_set', worldId, {
    objectId,
    movement,
    behavior: state.behaviors[objectId],
    ...(behaviorPosition ? { position: behaviorPosition } : {}),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Set behavior on ${objectId}: movement=${movement}` }
}

function resolveAvatarUrl(raw: string): { url: string; resolved: boolean; suggestion?: string } {
  // External URLs (http/https) are allowed as-is — user's responsibility
  if (raw.startsWith('http://') || raw.startsWith('https://')) return { url: raw, resolved: true }
  const resolved = resolveAgentAvatarUrl(raw)
  return {
    url: resolved.url,
    resolved: resolved.resolved,
    suggestion: resolved.suggestion,
  }
}

const CANONICAL_AGENT_AVATAR_TYPES = new Set([
  'anorak',
  'codex',
  'gemini',
  'anorak-pro',
  'merlin',
  'hermes',
  'openclaw',
  'devcraft',
  'parzival',
  'browser',
  'mission',
  'realtime', // parallel realtime-voice agent
])

tools.set_avatar = async (args) => {
  const rawUrl = validStr(args.avatarUrl || args.url, '')
  if (!rawUrl) return { ok: false, message: 'avatarUrl is required. Use a path like /avatars/gallery/Orion.vrm or call get_world_state to see available avatars.' }
  const { url: avatarUrl, resolved, suggestion } = resolveAvatarUrl(rawUrl)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const { existing, avatarId, linkedWindowId, agentType } = resolveAgentAvatarTarget(
    state,
    args,
    validStr(args.linkedWindowId, '') ? 'anorak' : 'hermes',
  )

  // Reject non-canonical agentTypes so beginner-agent typos don't create
  // orphan avatars (e.g. "clawdling") that WizCon can't see or delete.
  if (!CANONICAL_AGENT_AVATAR_TYPES.has(agentType)) {
    return {
      ok: false,
      message: `Invalid agentType '${agentType}'. Canonical values: ${[...CANONICAL_AGENT_AVATAR_TYPES].join(', ')}. If this is the calling agent's own body, omit agentType and it defaults to the requester.`,
    }
  }

  const isSharedAvatarType = isSharedAgentAvatarType(agentType)
  const label = validStr(args.label, '')
  const position = validPos(args.position)
  const rotation = validPos(args.rotation)
  const scale = validNum(args.scale, agentType === 'hermes' || agentType === 'openclaw' ? 1.15 : 1)

  const nextAvatar = existing
    ? {
        ...existing,
        avatar3dUrl: avatarUrl,
        label: label || existing.label,
        position: position || existing.position,
        rotation: rotation || existing.rotation,
        scale: Number.isFinite(Number(args.scale)) ? scale : existing.scale,
        linkedWindowId: isSharedAvatarType ? undefined : (linkedWindowId || existing.linkedWindowId),
        agentType: validStr(agentType, existing.agentType) as typeof existing.agentType,
      }
    : {
        id: avatarId,
        agentType: agentType as AgentAvatarEntry['agentType'],
        avatar3dUrl: avatarUrl,
        position: position || [0, 0, 3.2],
        rotation: rotation || [0, Math.PI, 0],
        scale,
        ...(!isSharedAvatarType && linkedWindowId ? { linkedWindowId } : {}),
        ...(label ? { label } : {}),
      }

  if (existing) {
    state.agentAvatars = (state.agentAvatars || []).map(avatar => avatar.id === nextAvatar.id ? nextAvatar : avatar)
  } else {
    state.agentAvatars = [...(state.agentAvatars || []), nextAvatar]
  }
  if (isSharedAvatarType) {
    state.agentAvatars = (state.agentAvatars || []).filter((avatar, index, list) => {
      if (avatar.agentType !== agentType) return true
      return list.findIndex(entry => entry.agentType === agentType) === index
    })
  }
  delete state.transforms[nextAvatar.id]

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_set', worldId, {
    avatarId: nextAvatar.id,
    agentType: nextAvatar.agentType,
    linkedWindowId: nextAvatar.linkedWindowId,
    position: nextAvatar.position,
    avatar: nextAvatar,
    ...mutationActorData(args),
  })

  const msg = suggestion
    ? `Avatar ${nextAvatar.id} now uses ${avatarUrl}. Note: ${suggestion}`
    : `Avatar ${nextAvatar.id} now uses ${avatarUrl}.`
  return {
    ok: resolved,
    message: msg,
    data: nextAvatar,
  }
}

tools.walk_avatar_to = async (args) => {
  const target = validPos(args.position || args.target)
  if (!target) return { ok: false, message: 'position is required as [x, y, z].' }
  const moveSpeed = validNum(args.speed, 3)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const { existing: matchedAvatar, avatarId } = resolveAgentAvatarTarget(state, args)
  const avatar = matchedAvatar || ((state.agentAvatars || []).find(entry => entry.id === avatarId) || null)
  if (!avatar || !avatarId) return { ok: false, message: 'No matching avatar found. Call set_avatar first or specify avatarId.' }

  const existingBehavior = state.behaviors?.[avatarId] || { visible: true, movement: { type: 'static' as const } }
  state.behaviors = state.behaviors || {}
  state.behaviors[avatarId] = {
    ...existingBehavior,
    visible: existingBehavior.visible ?? true,
    // Walking should reclaim locomotion from stale emote loops instead of gliding forever in the old clip.
    animation: undefined,
    moveTarget: target,
    moveSpeed,
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_walk', worldId, {
    avatarId,
    target,
    moveSpeed,
    behavior: state.behaviors[avatarId],
    ...mutationActorData(args),
  })
  return { ok: true, message: `Avatar ${avatarId} is walking to [${target.join(', ')}].`, data: { avatarId, target, moveSpeed } }
}

tools.list_avatar_animations = async (args) => {
  const library = await loadAvatarAnimationCatalog()
  const query = normalizeAnimationLookupKey(validStr(args.query, ''))
  const rawCategory = validStr(args.category, '').trim().toLowerCase()
  const category = rawCategory === 'all' || rawCategory === '*' ? '' : rawCategory
  const queryTerms = [query, AVATAR_ANIMATION_ALIASES[query]]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const limit = Math.max(1, Math.min(200, validNum(args.limit, 80)))

  const animations = library
    .filter(entry => !category || entry.category.toLowerCase() === category)
    .filter(entry => {
      if (queryTerms.length === 0) return true
      const haystack = `${entry.id} ${entry.label} ${entry.category}`.toLowerCase()
      return queryTerms.some(term => haystack.includes(term))
    })
    .slice(0, limit)
    .map(entry => ({
      id: entry.id,
      label: entry.label,
      category: entry.category,
      clipName: `lib:${entry.id}`,
      source: entry.filename,
      ...(entry.glbClipName ? { glbClipName: entry.glbClipName } : {}),
    }))

  return {
    ok: true,
    message: `Found ${animations.length} animation${animations.length === 1 ? '' : 's'}.`,
    data: {
      animations,
      aliases: AVATAR_ANIMATION_ALIASES,
    },
  }
}

tools.play_avatar_animation = async (args) => {
  const clipName = validStr(args.clipName || args.animation || args.name, '')
  if (!clipName) return { ok: false, message: 'clipName is required. Call list_avatar_animations for valid IDs.' }
  const loop = validStr(args.loop, 'once')
  const speed = validNum(args.speed, 1)
  const animation = await resolveAvatarAnimation(clipName)
  if (!animation.exact) {
    return {
      ok: false,
      message: `Unknown animation "${clipName}". Call list_avatar_animations for exact IDs.`,
      data: {
        requested: clipName,
        normalized: animation.normalized,
        suggestions: animation.suggestions,
      },
    }
  }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const { existing: matchedAvatar, avatarId } = resolveAgentAvatarTarget(state, args)
  const avatar = matchedAvatar || ((state.agentAvatars || []).find(entry => entry.id === avatarId) || null)
  if (!avatar || !avatarId) return { ok: false, message: 'No matching avatar found. Call set_avatar first or specify avatarId.' }

  state.behaviors = state.behaviors || {}
  const existingBehavior = state.behaviors[avatarId] || { visible: true, movement: { type: 'static' as const } }
  state.behaviors[avatarId] = {
    ...existingBehavior,
    visible: existingBehavior.visible ?? true,
    animation: {
      clipName: `lib:${animation.exact.id}`,
      loop: loop === 'once' || loop === 'pingpong' ? loop : 'repeat',
      speed,
    },
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_animation', worldId, {
    avatarId,
    clipName: animation.exact.id,
    loop,
    speed,
    behavior: state.behaviors[avatarId],
    ...mutationActorData(args),
  })
  return {
    ok: true,
    message: `Avatar ${avatarId} is now playing ${animation.exact.id}.`,
    data: {
      avatarId,
      clipName: animation.exact.id,
      label: animation.exact.label,
      category: animation.exact.category,
      loop,
      speed,
    },
  }
}

tools.create_portal_gate = async (args) => {
  const variant = validPortalGateVariant(args.variant || args.style)
  const direction = validStr(args.direction, validBool(args.twoWay ?? args.two_way, true) ? 'two-way' : 'one-way') === 'one-way'
    ? 'one-way'
    : 'two-way'
  const targetWorldNameQuery = validStr(args.targetWorldName || args.worldName || args.targetName, '')
  const requestedTargetWorldId = validStr(args.targetWorldId || args.destinationWorldId, '')
  let targetWorld = requestedTargetWorldId ? await readToolWorldRow(requestedTargetWorldId, 'read') : null
  const matches = !targetWorld && targetWorldNameQuery ? await findToolWorldsByQuery(targetWorldNameQuery, 6) : []
  if (!targetWorld && matches.length === 1) targetWorld = matches[0]
  if (!targetWorld) {
    return {
      ok: false,
      message: matches.length > 1
        ? `Multiple worlds match "${targetWorldNameQuery}". Use one of these targetWorldIds.`
        : `Target world${targetWorldNameQuery ? ` "${targetWorldNameQuery}"` : ''} not found. Call list_worlds first or provide targetWorldId.`,
      data: {
        matches: matches.map(world => ({
          id: world.id,
          name: world.name,
          visibility: world.visibility,
          objectCount: world.objectCount,
        })),
      },
    }
  }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  if (targetWorld.id === worldId) return { ok: false, message: 'Refusing to create a portal from a world to itself.' }

  const sourceWorld = await readToolWorldRow(worldId, 'read')
  const sourceWorldName = sourceWorld?.name || 'This world'
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const gateId = validStr(args.id, '') || `portal-${stamp}-a`
  const linkedPortalId = direction === 'two-way' ? `portal-${stamp}-b` : undefined
  const explicitPosition = validPos(args.position)
  const actorAgentType = validStr(args.agentType || args.actorAgentType || args.agent, '').toLowerCase()
  const sourceAvatar = actorAgentType
    ? (state.agentAvatars || []).find(avatar => avatar.agentType === actorAgentType)
    : null
  const distanceAhead = Math.max(1, Math.min(50, validNum(args.distanceAhead ?? args.distance ?? args.metersAhead, 5)))
  const avatarYaw = sourceAvatar?.rotation?.[1] || 0
  const avatarPosition = sourceAvatar?.position
  const position: [number, number, number] = explicitPosition || (avatarPosition
    ? [
        avatarPosition[0] + Math.sin(avatarYaw) * distanceAhead,
        0,
        avatarPosition[2] + Math.cos(avatarYaw) * distanceAhead,
      ]
    : [0, 0, -distanceAhead])
  const rotationY = Number.isFinite(Number(args.rotationY))
    ? Number(args.rotationY)
    : Array.isArray(args.rotation) && args.rotation.length >= 2 && Number.isFinite(Number(args.rotation[1]))
      ? Number(args.rotation[1])
      : sourceAvatar?.rotation?.[1] ?? portalRotationTowardCenter(position)
  const width = Math.max(1, Math.min(12, validNum(args.width, 2.4)))
  const height = Math.max(1, Math.min(16, validNum(args.height, 3.2)))
  const scale = validScale(args.scale, 1)
  const targetWorldName = targetWorld.name || targetWorld.id
  const action: PortalAction = { type: 'load_world', worldId: targetWorld.id, worldName: targetWorldName }
  const gate: PortalGate = {
    id: gateId,
    variant,
    label: validStr(args.label, targetWorldName ? `Portal to ${targetWorldName}` : 'World portal'),
    position,
    rotationY,
    scale: typeof scale === 'number' ? scale : 1,
    width,
    height,
    direction,
    sourceWorldId: worldId,
    targetWorldId: targetWorld.id,
    targetWorldName,
    action,
    ...(linkedPortalId ? { linkedPortalId } : {}),
  }

  state.portalGates = [
    ...(state.portalGates || []).filter(portal => portal.id !== gateId),
    gate,
  ]
  await saveWorldState(worldId, state)
  emitWorldEvent('object_added', worldId, {
    id: gateId,
    objectId: gateId,
    position,
    portalGate: gate,
    ...mutationActorData(args),
  })

  let returnGate: PortalGate | null = null
  let returnGateWarning = ''
  if (direction === 'two-way' && linkedPortalId) {
    try {
      const targetState = (await loadToolWorld(targetWorld.id, 'write')).state
      if (!(targetState.portalGates || []).some(existing => existing.id === linkedPortalId || existing.linkedPortalId === gateId)) {
        const returnPosition: [number, number, number] = [30, 0, 0]
        returnGate = {
          id: linkedPortalId,
          variant,
          label: validStr(args.returnLabel, `Return to ${sourceWorldName}`),
          position: returnPosition,
          rotationY: portalRotationTowardCenter(returnPosition),
          scale: typeof scale === 'number' ? scale : 1,
          width,
          height,
          direction: 'two-way',
          sourceWorldId: targetWorld.id,
          targetWorldId: worldId,
          targetWorldName: sourceWorldName,
          action: { type: 'load_world', worldId, worldName: sourceWorldName },
          linkedPortalId: gateId,
          autoLayout: 'portal-area',
        }
        targetState.portalGates = layoutPortalAreaGates(
          [...(targetState.portalGates || []), returnGate],
          targetState.transforms,
        )
        await saveWorldState(targetWorld.id, targetState)
        emitWorldEvent('object_added', targetWorld.id, {
          id: linkedPortalId,
          objectId: linkedPortalId,
          position: returnGate.position,
          portalGate: returnGate,
          ...mutationActorData(args),
        })
      }
    } catch (error) {
      returnGateWarning = error instanceof Error ? error.message : 'Could not create return portal.'
    }
  }

  return {
    ok: true,
    message: `Created ${direction} portal "${gate.label}" to ${targetWorldName}.${returnGateWarning ? ` Return portal skipped: ${returnGateWarning}` : ''}`,
    data: {
      id: gateId,
      portalGate: gate,
      targetWorld: {
        id: targetWorld.id,
        name: targetWorldName,
        visibility: targetWorld.visibility,
      },
      ...(returnGate ? { returnGate } : {}),
      ...(returnGateWarning ? { warning: returnGateWarning } : {}),
    },
  }
}

tools.clear_world = async (args) => {
  if (!args.confirm) return { ok: false, message: 'clear_world requires confirm: true. This is destructive.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.catalogPlacements = []
  state.craftedScenes = []
  state.conjuredAssetIds = []
  state.spatialWebObjects = []
  state.agentAvatars = []
  state.lights = []
  state.transforms = {}
  state.behaviors = {}
  state.groundTiles = {}
  await saveWorldState(worldId, state)
  emitWorldEvent('world_cleared', worldId, mutationActorData(args))

  return { ok: true, message: 'World cleared. All objects, spatial web primitives, conjured placements, lights, tiles, and behaviors removed.' }
}

// ─═̷─═̷─ WORLD MANAGEMENT ─═̷─═̷─

tools.list_worlds = async (args) => {
  const query = validStr(args.query || args.search || args.name, '')
  const limit = Math.max(1, Math.min(50, Math.floor(validNum(args.limit, 50))))
  const visibleWorlds = (query
    ? await findToolWorldsByQuery(query, limit)
    : (await listVisibleToolWorlds()).slice(0, limit))
  return {
    ok: true,
    message: query ? `${visibleWorlds.length} worlds matching "${query}".` : `${visibleWorlds.length} worlds.`,
    data: visibleWorlds.map(w => ({
      id: w.id,
      name: w.name,
      icon: w.icon,
      visibility: w.visibility,
      objectCount: w.objectCount,
      lastSaved: w.updatedAt?.toISOString?.() || '',
    })),
  }
}

tools.load_world = async (args) => {
  const worldId = validStr(args.worldId, '')
  if (!worldId) return { ok: false, message: 'worldId is required.' }
  const state = await loadWorldById(worldId)
  emitWorldEvent('world_switch', worldId, { targetWorldId: worldId, ...mutationActorData(args) })
  return { ok: true, message: `Loaded world ${worldId}. Browser should switch momentarily.`, data: { worldId, objectCount: (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) } }
}

tools.create_world = async (args) => {
  const context = currentToolContext()
  const name = validStr(args.name, 'New World')
  const icon = validStr(args.icon, '🌍')
  const id = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const now = new Date()

  const emptyState: WorldState = {
    version: 1, terrain: null, craftedScenes: [], conjuredAssetIds: [],
    catalogPlacements: [], agentAvatars: [], transforms: {}, savedAt: now.toISOString(),
  }

  await prisma.world.create({
    data: { id, userId: context.userId, name, icon, visibility: 'private', data: JSON.stringify(emptyState), createdAt: now, updatedAt: now },
  })

  emitWorldEvent('world_switch', id, { targetWorldId: id, ...mutationActorData(args) })
  return { ok: true, message: `Created world "${name}" (${id}). Browser switching now.`, data: { worldId: id, name } }
}
tools.create_and_load_world = tools.create_world

// ─═̷─═̷─ SCREENSHOT (signal-based) ─═̷─═̷─

// Screenshot is a client-side operation. The MCP tool signals a request
// and the browser captures via canvas.toDataURL(). The result is stored
// temporarily and the tool returns it.
// For v1: return a placeholder indicating the screenshot was requested.
// The actual implementation requires a client-side event bridge.

export type ScreenshotFormat = 'jpeg' | 'png' | 'webp'

export interface ScreenshotViewRequest {
  id: string
  mode: 'current' | 'agent-avatar-phantom' | 'look-at' | 'external-orbit' | 'third-person-follow' | 'avatar-portrait'
  agentType?: string
  position?: [number, number, number]
  target?: [number, number, number]
  fov?: number
  distance?: number
  heightOffset?: number
  lookAhead?: number
}

export interface PendingScreenshotRequest {
  id: string
  requestedAt: number
  requesterAgentType?: string
  worldId?: string
  format: ScreenshotFormat
  quality: number
  width: number
  height: number
  settleMs: number
  views: ScreenshotViewRequest[]
}

export interface DeliveredScreenshotCapture {
  viewId: string
  base64: string
  format: ScreenshotFormat
  url?: string
  filePath?: string
}

interface ScreenshotCaptureSummary {
  viewId: string
  format: ScreenshotFormat
  url?: string
  filePath?: string
  // Inline base64 is preserved so MCP clients can render images as vision content
  // (content blocks of type "image"). Strip at the formatter for text serialization
  // to keep the JSON small. Loopback URLs + Windows paths alone aren't reachable
  // from external MCP clients like OpenClaw.
  base64?: string
}

function summarizeDeliveredScreenshotCapture(capture: DeliveredScreenshotCapture): ScreenshotCaptureSummary {
  return {
    viewId: capture.viewId,
    format: capture.format,
    url: capture.url,
    filePath: capture.filePath,
    base64: capture.base64 || undefined,
  }
}

interface PendingScreenshotJob {
  request: PendingScreenshotRequest
  resolve: (captures: DeliveredScreenshotCapture[]) => void
  timeout: ReturnType<typeof setTimeout> | null
  filePoll: ReturnType<typeof setInterval> | null
}

// Pin to globalThis — Next.js dev splits route handlers into separate chunks.
// Without this, screenshot_viewport (called via /api/mcp/oasis) pushes a job into
// one chunk's array while the browser poll (via /api/oasis-tools) reads from a
// different chunk's array, so screenshots never get captured.
const PENDING_SCREENSHOT_JOBS_KEY = Symbol.for('oasis.pendingScreenshotJobs.v1')
const pendingScreenshotJobsGlobal = globalThis as unknown as { [key: symbol]: PendingScreenshotJob[] | undefined }
const pendingScreenshotJobs: PendingScreenshotJob[] = pendingScreenshotJobsGlobal[PENDING_SCREENSHOT_JOBS_KEY] ?? []
if (!pendingScreenshotJobsGlobal[PENDING_SCREENSHOT_JOBS_KEY]) {
  pendingScreenshotJobsGlobal[PENDING_SCREENSHOT_JOBS_KEY] = pendingScreenshotJobs
}

const SCREENSHOT_QUEUE_DIR = join(process.cwd(), 'data', 'screenshot-requests')
const SCREENSHOT_QUEUE_TTL_MS = 60_000

type ScreenshotQueueRequestFile = {
  request?: PendingScreenshotRequest
}

type ScreenshotQueueResultFile = {
  captures?: DeliveredScreenshotCapture[]
}

function safeScreenshotQueueId(id: string): string {
  const safe = id.trim().replace(/[^a-zA-Z0-9_-]+/g, '')
  return safe || 'shot'
}

function ensureScreenshotQueueDir() {
  try {
    mkdirSync(SCREENSHOT_QUEUE_DIR, { recursive: true })
  } catch (error) {
    console.warn('[OasisTools] screenshot queue mkdir failed:', error)
  }
}

function screenshotRequestPath(id: string): string {
  return join(SCREENSHOT_QUEUE_DIR, `${safeScreenshotQueueId(id)}.request.json`)
}

function screenshotResultPath(id: string): string {
  return join(SCREENSHOT_QUEUE_DIR, `${safeScreenshotQueueId(id)}.result.json`)
}

function unlinkScreenshotFile(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Best-effort queue cleanup.
  }
}

function cleanupScreenshotQueueFiles(id: string) {
  unlinkScreenshotFile(screenshotRequestPath(id))
  unlinkScreenshotFile(screenshotResultPath(id))
}

function isFreshScreenshotRequest(request: PendingScreenshotRequest, now = Date.now()): boolean {
  const requestedAt = Number(request.requestedAt) || 0
  return requestedAt > 0 && now - requestedAt <= SCREENSHOT_QUEUE_TTL_MS
}

function pruneScreenshotQueue(now = Date.now()) {
  if (!existsSync(SCREENSHOT_QUEUE_DIR)) return
  let files: string[] = []
  try {
    files = readdirSync(SCREENSHOT_QUEUE_DIR)
  } catch {
    return
  }

  for (const file of files) {
    if (!file.endsWith('.request.json')) continue
    const requestPath = join(SCREENSHOT_QUEUE_DIR, file)
    try {
      const parsed = JSON.parse(readFileSync(requestPath, 'utf8')) as ScreenshotQueueRequestFile
      const request = parsed?.request
      if (!request || !isFreshScreenshotRequest(request, now)) {
        const id = request?.id || file.replace(/\.request\.json$/, '')
        cleanupScreenshotQueueFiles(id)
      }
    } catch {
      unlinkScreenshotFile(requestPath)
      unlinkScreenshotFile(join(SCREENSHOT_QUEUE_DIR, file.replace(/\.request\.json$/, '.result.json')))
    }
  }
}

function writeScreenshotRequestFile(request: PendingScreenshotRequest) {
  ensureScreenshotQueueDir()
  pruneScreenshotQueue()
  try {
    writeFileSync(screenshotRequestPath(request.id), JSON.stringify({ request }, null, 2), 'utf8')
  } catch (error) {
    console.warn('[OasisTools] screenshot request write failed:', error)
  }
}

function readScreenshotRequestFile(id: string): PendingScreenshotRequest | null {
  const path = screenshotRequestPath(id)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ScreenshotQueueRequestFile
    const request = parsed?.request
    if (!request || !isFreshScreenshotRequest(request)) {
      cleanupScreenshotQueueFiles(id)
      return null
    }
    return request
  } catch {
    cleanupScreenshotQueueFiles(id)
    return null
  }
}

function readScreenshotRequestsFromQueue(): PendingScreenshotRequest[] {
  if (!existsSync(SCREENSHOT_QUEUE_DIR)) return []
  pruneScreenshotQueue()
  let files: string[] = []
  try {
    files = readdirSync(SCREENSHOT_QUEUE_DIR)
  } catch {
    return []
  }

  return files
    .filter(file => file.endsWith('.request.json'))
    .map(file => readScreenshotRequestFile(file.replace(/\.request\.json$/, '')))
    .filter((request): request is PendingScreenshotRequest => !!request)
    .sort((a, b) => a.requestedAt - b.requestedAt)
}

function writeScreenshotResultFile(requestId: string, captures: DeliveredScreenshotCapture[]) {
  if (!requestId) return
  ensureScreenshotQueueDir()
  try {
    writeFileSync(screenshotResultPath(requestId), JSON.stringify({ captures }, null, 2), 'utf8')
  } catch (error) {
    console.warn('[OasisTools] screenshot result write failed:', error)
  }
}

function readScreenshotResultFile(requestId: string): DeliveredScreenshotCapture[] | null {
  const path = screenshotResultPath(requestId)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ScreenshotQueueResultFile
    const captures = Array.isArray(parsed?.captures)
      ? parsed.captures.filter((capture): capture is DeliveredScreenshotCapture => {
          return Boolean(
            capture
            && typeof capture.viewId === 'string'
            && typeof capture.base64 === 'string'
            && validScreenshotFormat(capture.format) === capture.format,
          )
        })
      : []
    return captures
  } catch {
    cleanupScreenshotQueueFiles(requestId)
    return null
  }
}

function validScreenshotFormat(value: unknown): ScreenshotFormat {
  return value === 'png' || value === 'webp' || value === 'jpeg'
    ? value
    : 'jpeg'
}

export const CANONICAL_SCREENSHOT_MODES: readonly ScreenshotViewRequest['mode'][] = [
  'current',
  'agent-avatar-phantom',
  'look-at',
  'external-orbit',
  'third-person-follow',
  'avatar-portrait',
] as const

export class ScreenshotModeError extends Error {
  readonly invalidMode: string
  constructor(invalidMode: string) {
    super(`Invalid mode '${invalidMode}'. Valid modes: ${CANONICAL_SCREENSHOT_MODES.join(', ')}.`)
    this.name = 'ScreenshotModeError'
    this.invalidMode = invalidMode
  }
}

function readExplicitModeString(entry: Record<string, unknown>): string {
  for (const key of ['mode', 'view', 'camera', 'perspective']) {
    const raw = entry[key]
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim()
    }
  }
  return ''
}

function normalizeScreenshotMode(
  entry: Record<string, unknown>,
  index: number,
  defaultAgentType: string,
  hasExplicitLookAt: boolean,
): ScreenshotViewRequest['mode'] | null {
  const rawMode = validStr(
    entry.mode
      || entry.view
      || entry.camera
      || entry.perspective
      || (entry.player === true ? 'player' : '')
      || (entry.agent === true ? 'agent' : '')
      || (entry.external === true ? 'external' : ''),
    defaultAgentType && index === 0 ? 'agent' : index === 0 ? 'current' : '',
  ).toLowerCase()

  if (!rawMode) return null
  if (rawMode === 'current' || rawMode === 'player') return 'current'
  if (rawMode === 'agent' || rawMode === 'phantom' || rawMode === 'agent-avatar-phantom') {
    return hasExplicitLookAt ? 'look-at' : 'agent-avatar-phantom'
  }
  if (
    rawMode === 'look-at'
    || rawMode === 'look_at'
    || rawMode === 'lookat'
    || rawMode === 'look at'
  ) {
    return 'look-at'
  }
  if (
    rawMode === 'third-person'
    || rawMode === 'third_person'
    || rawMode === 'thirdperson'
    || rawMode === 'third-person-follow'
    || rawMode === 'tps'
  ) {
    return 'third-person-follow'
  }
  if (
    rawMode === 'avatar'
    || rawMode === 'portrait'
    || rawMode === 'avatar-portrait'
    || rawMode === 'avatar_portrait'
    || rawMode === 'avatarpic'
  ) {
    return 'avatar-portrait'
  }
  if (
    rawMode === 'external'
    || rawMode === 'external-orbit'
    || rawMode === 'external_orbit'
    || rawMode === 'externalorbit'
    || rawMode === 'outside'
    || rawMode === 'overhead'
    || rawMode === 'birdseye'
    || rawMode === 'birds-eye'
  ) {
    return hasExplicitLookAt ? 'look-at' : 'external-orbit'
  }
  if (hasExplicitLookAt) {
    return 'look-at'
  }
  const explicit = readExplicitModeString(entry)
  if (explicit) {
    throw new ScreenshotModeError(explicit)
  }
  return null
}

function normalizeScreenshotView(value: unknown, index: number, defaultAgentType: string): ScreenshotViewRequest | null {
  const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {}

  const position = validPos(entry.position ?? entry.cameraPosition)
  const target = validPos(entry.target ?? entry.cameraTarget)
  const mode = normalizeScreenshotMode(entry, index, defaultAgentType, !!(position && target))
  if (!mode) return null
  const defaultFov =
    mode === 'agent-avatar-phantom' ? 100 :
    mode === 'external-orbit' ? 60 :
    mode === 'third-person-follow' ? 72 :
    mode === 'avatar-portrait' ? 45 :
    75
  const maxDistance = mode === 'external-orbit' ? 40 : mode === 'third-person-follow' ? 18 : mode === 'avatar-portrait' ? 8 : 12
  const defaultDistance = mode === 'external-orbit' ? 16 : mode === 'third-person-follow' ? 4.4 : mode === 'avatar-portrait' ? 2.75 : 1
  const maxHeightOffset = mode === 'external-orbit' ? 30 : mode === 'third-person-follow' ? 6 : mode === 'avatar-portrait' ? 4 : 4
  const defaultHeightOffset = mode === 'external-orbit' ? 9 : mode === 'third-person-follow' ? 2.1 : mode === 'avatar-portrait' ? 1.55 : 1.55
  const defaultLookAhead = mode === 'third-person-follow' ? 4 : mode === 'avatar-portrait' ? 0.1 : 5
  return {
    id: validStr(entry.id, `view-${index + 1}`),
    mode,
    agentType: validStr(entry.agentType || entry.agent || entry.actorAgentType, defaultAgentType) || undefined,
    position: position || undefined,
    target: target || undefined,
    fov: Math.max(35, Math.min(120, validNum(entry.fov, defaultFov))),
    distance: Math.max(0, Math.min(maxDistance, validNum(entry.distance, defaultDistance))),
    heightOffset: Math.max(0, Math.min(maxHeightOffset, validNum(entry.heightOffset, defaultHeightOffset))),
    lookAhead: Math.max(0.5, Math.min(20, validNum(entry.lookAhead, defaultLookAhead))),
  }
}

function normalizeAvatarSubject(value: unknown, fallback = 'merlin'): string {
  const raw = validStr(value, fallback).trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'user' || raw === 'player' || raw === 'player-avatar' || raw === 'player_avatar' || raw === 'me' || raw === 'self' || raw === 'vibedev' || raw === 'carbondev') return 'player'
  if (raw === 'anorak' || raw === 'anorak_pro' || raw === 'anorakpro') return 'anorak-pro'
  // Note: 'clawdling' is NOT aliased to 'openclaw' — the Clawdling label is a
  // legacy-artifact body from beginner-OpenClaw test runs. Masking it would hide
  // the identity mess. Screenshot bridge's Clawdling/openclaw alias is fine at
  // the render layer; tool-level subjects stay explicit.
  if (raw === 'merlin-avatar' || raw === 'merlin_avatar') return 'merlin'
  return raw
}

function buildAvatarScreenshotArgs(args: Record<string, unknown>, fallbackSubject: string): Record<string, unknown> {
  const subject = normalizeAvatarSubject(
    args.subject || args.agentType || args.agent || args.defaultAgentType || args.requesterAgentType || args.actorAgentType,
    fallbackSubject,
  )
  const style = validStr(args.style || args.mode, 'portrait').trim().toLowerCase()
  const thirdPerson = style === 'third-person' || style === 'third_person' || style === 'thirdperson' || style === 'tps'
  const worldId = validStr(args.worldId, '')

  return {
    ...(worldId ? { worldId } : {}),
    ...(validStr(args.defaultAgentType, '') ? { defaultAgentType: validStr(args.defaultAgentType, '') } : {}),
    ...(validStr(args.requesterAgentType, '') ? { requesterAgentType: validStr(args.requesterAgentType, '') } : {}),
    ...(validStr(args.actorAgentType, '') ? { actorAgentType: validStr(args.actorAgentType, '') } : {}),
    ...(args.settleMs !== undefined ? { settleMs: args.settleMs } : {}),
    format: validScreenshotFormat(args.format),
    quality: Math.max(0.35, Math.min(0.95, validNum(args.quality, thirdPerson ? 0.8 : 0.9))),
    width: Math.max(320, Math.min(1280, Math.round(validNum(args.width, thirdPerson ? 960 : 640)))),
    height: Math.max(180, Math.min(1280, Math.round(validNum(args.height, thirdPerson ? 540 : 640)))),
    views: [{
      id: `${subject}-${thirdPerson ? 'tps' : 'portrait'}`,
      mode: thirdPerson ? 'third-person-follow' : 'avatar-portrait',
      agentType: subject,
      fov: validNum(args.fov, thirdPerson ? 72 : 45),
      // Tighter TPS defaults so small avatars (e.g. player's gnome) fill the frame.
      distance: validNum(args.distance, thirdPerson ? 2.8 : 2.75),
      heightOffset: validNum(args.heightOffset, thirdPerson ? 1.6 : 1.55),
      lookAhead: validNum(args.lookAhead, thirdPerson ? 2.5 : 0.1),
    }],
  }
}

function normalizeScreenshotRequest(args: Record<string, unknown>): PendingScreenshotRequest {
  const defaultAgentType = validStr(args.defaultAgentType || args.agentType || args.agent || args.actorAgentType, '').toLowerCase()
  const requesterAgentType = validStr(args.requesterAgentType, defaultAgentType).toLowerCase()
  const worldId = validStr(args.worldId, '')
  const requestedViewsRaw =
    Array.isArray(args.views)
      ? args.views
      : typeof args.views === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(args.views)
              return Array.isArray(parsed) ? parsed : [args]
            } catch {
              return [args]
            }
          })()
        : [args]
  const requestedViews = requestedViewsRaw
  const views = requestedViews
    .map((entry, index) => normalizeScreenshotView(entry, index, defaultAgentType))
    .filter((entry): entry is ScreenshotViewRequest => !!entry)
  const defaultSettleMs = views.some(view => view.mode !== 'current') ? 220 : 80

  return {
    id: `shot-${uid()}`,
    requestedAt: Date.now(),
    ...(requesterAgentType ? { requesterAgentType } : {}),
    ...(worldId ? { worldId } : {}),
    format: validScreenshotFormat(args.format),
    quality: Math.max(0.35, Math.min(0.95, validNum(args.quality, 0.72))),
    width: Math.max(320, Math.min(1280, Math.round(validNum(args.width, 480)))),
    height: Math.max(180, Math.min(1280, Math.round(validNum(args.height, 270)))),
    settleMs: Math.max(0, Math.min(4000, Math.round(validNum(args.settleMs, defaultSettleMs)))),
    views: views.length > 0
      ? views
      : [{
          id: 'view-1',
          mode: defaultAgentType ? 'agent-avatar-phantom' : 'current',
          agentType: defaultAgentType || undefined,
          fov: defaultAgentType ? 100 : 75,
          distance: 1,
          heightOffset: 1.55,
          lookAhead: 5,
        }],
  }
}

function activeScreenshotJob(): PendingScreenshotJob | null {
  return pendingScreenshotJobs[0] || null
}

function clearScreenshotJobTimeout(job: PendingScreenshotJob) {
  if (job.timeout) {
    clearTimeout(job.timeout)
    job.timeout = null
  }
  if (job.filePoll) {
    clearInterval(job.filePoll)
    job.filePoll = null
  }
}

function removeScreenshotJob(job: PendingScreenshotJob) {
  const index = pendingScreenshotJobs.indexOf(job)
  if (index >= 0) pendingScreenshotJobs.splice(index, 1)
  clearScreenshotJobTimeout(job)
  cleanupScreenshotQueueFiles(job.request.id)
}

function resolveScreenshotJob(job: PendingScreenshotJob, captures: DeliveredScreenshotCapture[]) {
  removeScreenshotJob(job)
  job.resolve(captures)
}

tools.screenshot_viewport = async (args) => {
  let request: PendingScreenshotRequest
  try {
    request = normalizeScreenshotRequest(args)
  } catch (error) {
    if (error instanceof ScreenshotModeError) {
      return { ok: false, message: error.message }
    }
    throw error
  }

  return new Promise<ToolResult>((resolve) => {
    const job: PendingScreenshotJob = {
      request,
      resolve: (captures: DeliveredScreenshotCapture[]) => {
        removeScreenshotJob(job)
        if (captures.length === 0) {
          resolve({
            ok: false,
            message: 'Screenshot capture timed out or failed. The live Oasis screenshot bridge may be unavailable, on a different world, or missing the requested avatar/camera subject.',
          })
        } else {
          const summarizedCaptures = captures.map(summarizeDeliveredScreenshotCapture)
          const primaryInlineBase64 = !captures[0]?.url && !captures[0]?.filePath
            ? captures[0]?.base64
            : undefined
          const deliveredViewIds = new Set(captures.map(capture => capture.viewId))
          const droppedViewIds = request.views
            .map(view => view.id)
            .filter(viewId => !deliveredViewIds.has(viewId))
          const message = droppedViewIds.length > 0
            ? `Captured ${captures.length} of ${request.views.length} requested views (${request.format}, quality ${request.quality}). Dropped: ${droppedViewIds.join(', ')}. Dropped views usually mean the bridge couldn't resolve the subject (e.g. unknown agentType) or the mode needs different args.`
            : `Captured ${captures.length} screenshot ${captures.length === 1 ? 'view' : 'views'} (${request.format}, quality ${request.quality}).`
          resolve({
            ok: true,
            message,
            data: {
              format: request.format,
              captureCount: captures.length,
              requestedCount: request.views.length,
              droppedViewIds: droppedViewIds.length > 0 ? droppedViewIds : undefined,
              captures: summarizedCaptures,
              primaryCaptureUrl: captures.find(capture => typeof capture.url === 'string' && capture.url.length > 0)?.url,
              primaryCapturePath: captures.find(capture => typeof capture.filePath === 'string' && capture.filePath.length > 0)?.filePath,
              base64: primaryInlineBase64,
            },
          })
        }
      },
      timeout: null,
      filePoll: null,
    }

    pendingScreenshotJobs.push(job)
    writeScreenshotRequestFile(request)
    console.info('[OasisTools] screenshot queued', {
      requestId: request.id,
      worldId: request.worldId || '(active)',
      views: request.views.map(view => `${view.id}:${view.mode}`).join(','),
    })
    job.filePoll = setInterval(() => {
      const captures = readScreenshotResultFile(request.id)
      if (!captures) return
      console.info('[OasisTools] screenshot result picked up', {
        requestId: request.id,
        captureCount: captures.length,
      })
      resolveScreenshotJob(job, captures)
    }, 250)
    job.timeout = setTimeout(() => {
      console.warn('[OasisTools] screenshot timed out', {
        requestId: request.id,
        worldId: request.worldId || '(active)',
        queuedJobs: pendingScreenshotJobs.length,
      })
      resolveScreenshotJob(job, [])
    }, 20000)
  })
}

tools.screenshot_avatar = async (args) => {
  return tools.screenshot_viewport(buildAvatarScreenshotArgs(
    args,
    normalizeAvatarSubject(
      args.subject || args.agentType || args.agent || args.defaultAgentType || args.requesterAgentType || args.actorAgentType,
      'merlin',
    ),
  ))
}

tools.avatarpic_merlin = async (args) => {
  return tools.screenshot_viewport(buildAvatarScreenshotArgs({ ...args, subject: 'merlin' }, 'merlin'))
}

tools.avatarpic_user = async (args) => {
  return tools.screenshot_viewport(buildAvatarScreenshotArgs({ ...args, subject: 'player' }, 'player'))
}

tools.generate_image = async (args) => {
  const prompt = validStr(args.prompt, '')
  if (!prompt) return { ok: false, message: 'prompt is required.' }
  return runMediaTool('generate_image', { ...args, prompt }, 'image')
}

tools.generate_voice = async (args) => {
  const text = validStr(args.text || args.prompt, '')
  if (!text) return { ok: false, message: 'text is required.' }
  const actorAgentType = validStr(args.actorAgentType || args.agentType || args.agent, '')
  return runMediaTool('generate_voice', {
    ...args,
    text,
    ...(actorAgentType ? { agentType: actorAgentType } : {}),
  }, 'audio')
}

tools.generate_video = async (args) => {
  const prompt = validStr(args.prompt, '')
  if (!prompt) return { ok: false, message: 'prompt is required.' }
  return runMediaTool('generate_video', { ...args, prompt }, 'video')
}

// ─═̷─═̷─🎵 TEXT-TO-MUSIC (ElevenLabs Music API) 🎵─═̷─═̷─

tools.text_to_music = async (args) => {
  const prompt = validStr(args.prompt, '')
  if (!prompt) return { ok: false, message: 'prompt is required.' }
  const durationMs = validNum(args.durationMs, 30000)
  const instrumental = validBool(args.instrumental, false)
  return runMediaTool('generate_music', { prompt, durationMs, instrumental }, 'audio')
}

// ─═̷─═̷─🖼️ CONJURE_FRAMED_PICTURE — gen image + place with frame in one shot 🖼️─═̷─═̷─

const FRAME_STYLE_IDS = new Set([
  'gilded', 'neon', 'thin', 'baroque', 'hologram', 'rustic', 'ice',
  'void', 'spaghetti', 'fire', 'matrix', 'plasma', 'brutalist',
])

function detectMediaKindFromUrl(url: string): 'image' | 'video' | 'audio' | null {
  const trimmed = url.split('?')[0].split('#')[0].toLowerCase()
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/.test(trimmed)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(trimmed)) return 'video'
  if (/\.(mp3|wav|flac|ogg|oga|opus|aac|m4a)$/.test(trimmed)) return 'audio'
  if (trimmed.includes('/generated-images/')) return 'image'
  if (trimmed.includes('/generated-videos/')) return 'video'
  if (trimmed.includes('/generated-voices/') || trimmed.includes('/generated-music/')) return 'audio'
  return null
}

tools.conjure_framed_picture = async (args) => {
  const prompt = validStr(args.prompt, '')
  if (!prompt) return { ok: false, message: 'prompt is required.' }

  const requestedFrame = validStr(args.frameStyle, 'baroque').toLowerCase()
  const frameStyle = FRAME_STYLE_IDS.has(requestedFrame) ? requestedFrame : 'baroque'
  const frameThickness = Math.max(0.5, Math.min(5, validNum(args.frameThickness, 1)))
  // Default y=1 so the bottom of the frame clears the ground plane.
  const position = validPos(args.position) || [0, 1, 0]
  const rotation = validPos(args.rotation) || [0, 0, 0]
  const scale = validNum(args.scale, 2)
  const model = validStr(args.model, '')
  const name = validStr(args.name, prompt.slice(0, 60))

  const generation = await execMediaTool(
    'generate_image',
    { prompt, ...(model ? { model } : {}) },
    INTERNAL_OASIS_BASE_URL,
  )
  if (!generation.ok || !generation.url) {
    return { ok: false, message: `Image generation failed: ${generation.error || 'unknown error'}` }
  }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const placement: CatalogPlacement = {
    id,
    catalogId: 'generated-image',
    name,
    glbPath: '',
    position,
    rotation,
    scale,
    imageUrl: generation.url,
    imageFrameStyle: frameStyle,
    imageFrameThickness: frameThickness,
  }

  state.catalogPlacements = [...(state.catalogPlacements || []), placement]
  await saveWorldState(worldId, state)
  emitWorldEvent('object_added', worldId, {
    id,
    catalogId: 'generated-image',
    position,
    placement,
    ...mutationActorData(args),
  })

  return {
    ok: true,
    message: `Conjured framed picture (${frameStyle} frame) at [${position.join(', ')}].`,
    data: {
      id,
      mediaUrl: generation.url,
      frameStyle,
      frameThickness,
      position,
      rotation,
      scale,
    },
  }
}

// ─═̷─═̷─🎬 PLACE_MEDIA — drop an existing image/video/audio URL into the world 🎬─═̷─═̷─

tools.place_media = async (args) => {
  const url = validStr(args.url, '')
  if (!url) return { ok: false, message: 'url is required.' }

  const declaredKind = validStr(args.kind, '').toLowerCase()
  const kind = (declaredKind === 'image' || declaredKind === 'video' || declaredKind === 'audio')
    ? declaredKind as 'image' | 'video' | 'audio'
    : detectMediaKindFromUrl(url)
  if (!kind) {
    return { ok: false, message: 'Could not detect media kind from URL. Pass kind: "image" | "video" | "audio".' }
  }

  // image/video default y=1 so the frame clears the ground; audio defaults y=0 (loudspeaker on the floor).
  const position = validPos(args.position) || (kind === 'audio' ? [0, 0, 0] : [0, 1, 0])
  const rotation = validPos(args.rotation) || [0, 0, 0]
  const scale = validNum(args.scale, kind === 'audio' ? 0.6 : 2)
  const requestedFrame = validStr(args.frameStyle, '').toLowerCase()
  const frameStyle = requestedFrame && FRAME_STYLE_IDS.has(requestedFrame) ? requestedFrame : ''
  const frameThickness = Math.max(0.5, Math.min(5, validNum(args.frameThickness, 1)))
  const audioVolume = Math.max(0, Math.min(1, validNum(args.audioVolume, 1)))
  const audioMaxDistance = Math.max(1, validNum(args.audioMaxDistance, 15))
  const audioLoop = typeof args.audioLoop === 'boolean' ? args.audioLoop : true
  const audioMuted = typeof args.audioMuted === 'boolean' ? args.audioMuted : false
  const requestedAudioState = validStr(args.audioState, '').toLowerCase()
  const audioState: 'playing' | 'paused' | 'stopped' =
    requestedAudioState === 'paused' || requestedAudioState === 'stopped' ? requestedAudioState : 'playing'
  const name = validStr(args.name, kind === 'image' ? 'Picture' : kind === 'video' ? 'Video' : 'Music')

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const catalogId = kind === 'image' ? 'generated-image' : kind === 'video' ? 'video' : 'audio-source'

  const placement: CatalogPlacement = {
    id,
    catalogId,
    name,
    glbPath: '',
    position,
    rotation,
    scale,
    ...(kind === 'image' ? {
      imageUrl: url,
      ...(frameStyle ? { imageFrameStyle: frameStyle, imageFrameThickness: frameThickness } : {}),
    } : {}),
    ...(kind === 'video' ? {
      videoUrl: url,
      ...(frameStyle ? { imageFrameStyle: frameStyle, imageFrameThickness: frameThickness } : {}),
    } : {}),
    ...(kind === 'audio' ? {
      audioUrl: url,
      audioVolume,
      audioMaxDistance,
      audioMuted,
    } : {}),
  }

  state.catalogPlacements = [...(state.catalogPlacements || []), placement]
  if (kind === 'audio') {
    if (!state.behaviors) state.behaviors = {}
    state.behaviors[id] = {
      visible: true,
      movement: { type: 'static' as const },
      audioUrl: url,
      audioVolume,
      audioMaxDistance,
      audioMuted,
      audioState,
      audioLoop,
    }
  }
  await saveWorldState(worldId, state)
  emitWorldEvent('object_added', worldId, {
    id,
    catalogId,
    position,
    placement,
    ...mutationActorData(args),
  })
  // For audio placements, also fire behavior_set so SpatialAudioFromBehavior
  // can hydrate without a page reload (the SSE 'object_added' handler
  // does not currently propagate audio fields into the behaviors store).
  if (kind === 'audio' && state.behaviors?.[id]) {
    emitWorldEvent('behavior_set', worldId, {
      objectId: id,
      movement: 'static',
      behavior: state.behaviors[id],
      position,
      ...mutationActorData(args),
    })
  }

  return {
    ok: true,
    message: `Placed ${kind} at [${position.join(', ')}] as ${id}.`,
    data: { id, kind, mediaUrl: url, position, ...(kind !== 'audio' && frameStyle ? { frameStyle, frameThickness } : {}) },
  }
}

// ─═̷─═̷─📥 UPLOAD_TO_LIBRARY — register external asset into media library 📥─═̷─═̷─

tools.upload_to_library = async (args) => {
  const url = validStr(args.url, '')
  const data = validStr(args.data, '')
  const kind = validStr(args.kind, '').toLowerCase()
  if (!url && !data) return { ok: false, message: 'Provide url (to fetch) or data (base64) for the asset.' }
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
    return { ok: false, message: 'kind must be "image", "video", or "audio".' }
  }
  const name = validStr(args.name, '')

  try {
    const response = await callInternalJson<{ url: string; name: string; type: string; size: number }>(
      '/api/media/upload-from-url',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, data, kind, name }),
      },
    )
    return {
      ok: true,
      message: `Saved ${kind} to library: ${response.url}`,
      data: { mediaUrl: response.url, name: response.name, kind, size: response.size },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Upload failed: ${msg}` }
  }
}

tools.list_conjured_assets = async (args) => {
  const worldId = validStr(args.worldId, '')
  const statusFilter = validStr(args.status, '').toLowerCase()
  const providerFilter = validStr(args.provider, '').toLowerCase()
  const limit = Math.max(1, Math.min(200, validNum(args.limit, 50)))
  const inWorldOnly = validBool(args.inWorldOnly ?? args.activeWorldOnly, false)
  const characterModeFilter = typeof args.characterMode === 'boolean' ? args.characterMode : null
  const argViewer = validStr((args as Record<string, unknown>).viewerUserId, '')

  const { state, worldId: resolvedWorldId } = worldId
    ? { state: await loadWorldById(worldId), worldId }
    : await loadActiveWorld()

  // Build the viewer-visibility allow-set via listAssets so this MCP tool
  // matches search_assets / get_asset_catalog semantics. Without this, two
  // MCP tools listing the same domain would disagree (legacy registry was
  // viewer-agnostic; listAssets is viewer-filtered).
  let visibleIds: Set<string> | null = null
  try {
    const { listAssets } = await import('../forge/library/library-service')
    const { getLocalUserId } = await import('../local-auth')
    let viewerUserId = argViewer
    if (!viewerUserId) {
      try { viewerUserId = await getLocalUserId() } catch {}
    }
    if (viewerUserId) {
      const visible = await listAssets({
        viewerUserId,
        worldId: resolvedWorldId || undefined,
        kind: 'conjured',
        limit: 5000,
      })
      visibleIds = new Set(visible.map(a => a.id))
    }
  } catch (err) {
    console.warn('[list_conjured_assets] visibility filter degraded:', err)
  }

  const placedIds = new Set(state.conjuredAssetIds || [])
  const assets = getAllAssets()
    .filter(asset => !statusFilter || asset.status.toLowerCase() === statusFilter)
    .filter(asset => !providerFilter || asset.provider.toLowerCase() === providerFilter)
    .filter(asset => characterModeFilter === null || !!asset.characterMode === characterModeFilter)
    .filter(asset => !inWorldOnly || placedIds.has(asset.id))
    // Apply viewer visibility unless the lookup degraded (then fall through to
    // the legacy permissive behavior so we never silently hide everything).
    .filter(asset => !visibleIds || visibleIds.has(asset.id))
    .slice(-limit)
    .reverse()
    .map(asset => ({
      ...cloneConjuredAsset(asset),
      inActiveWorld: placedIds.has(asset.id),
      worldTransform: readWorldTransform(state, asset.id),
    }))

  return {
    ok: true,
    message: `Found ${assets.length} conjured asset${assets.length === 1 ? '' : 's'}.`,
    data: {
      worldId: resolvedWorldId,
      assets,
    },
  }
}

tools.get_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  const asset = cloneConjuredAsset(getAssetById(assetId))
  if (!asset) return { ok: false, message: `Conjured asset ${assetId} not found.` }

  let worldSummary: { worldId: string; inWorld: boolean; transform: ReturnType<typeof readWorldTransform> } | null = null
  try {
    const { state, worldId } = await loadRequestedWorld(args.worldId)
    worldSummary = {
      worldId,
      inWorld: (state.conjuredAssetIds || []).includes(assetId),
      transform: readWorldTransform(state, assetId),
    }
  } catch {
    worldSummary = null
  }

  return {
    ok: true,
    message: `Loaded conjured asset ${assetId}.`,
    data: {
      asset,
      ...(worldSummary ? { world: worldSummary } : {}),
    },
  }
}

tools.conjure_asset = async (args) => {
  const prompt = validStr(args.prompt, '')
  if (!prompt) return { ok: false, message: 'prompt is required.' }
  const provider = validStr(args.provider, 'meshy') as ProviderName
  // Match the UI default: agents should ask Meshy for textured assets unless they opt into preview.
  const tier = validStr(args.tier, '') || (provider === 'meshy' ? 'refine' : '')

  const response = await callInternalJson<{ id: string; status: string; estimatedSeconds?: number }>('/api/conjure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      provider,
      ...(tier ? { tier } : {}),
      ...(validStr(args.imageUrl, '') ? { imageUrl: validStr(args.imageUrl, '') } : {}),
      ...(validBool(args.characterMode, false) ? { characterMode: true } : {}),
      ...(args.characterOptions && typeof args.characterOptions === 'object' ? { characterOptions: args.characterOptions } : {}),
      ...(validBool(args.autoRig, false) ? { autoRig: true } : {}),
      ...(validBool(args.autoAnimate, false) ? { autoAnimate: true } : {}),
      ...(validStr(args.animationPreset, '') ? { animationPreset: validStr(args.animationPreset, '') } : {}),
    }),
  })

  const asset = cloneConjuredAsset(getAssetById(response.id))
  const placeInWorld = validBool(args.placeInWorld, true)
  const placement = resolveConjuredPlacement(args, asset ? {
    position: asset.position,
    rotation: asset.rotation,
    scale: asset.scale,
  } : undefined)

  let placedWorldId: string | null = null
  if (placeInWorld) {
    const { worldId } = await placeConjuredAssetInWorld(args.worldId, response.id, placement)
    placedWorldId = worldId
    emitWorldEvent('conjured_asset_added', worldId, {
      assetId: response.id,
      asset: asset || undefined,
      transform: {
        position: placement.position,
        rotation: placement.rotation,
        scale: placement.scale,
      },
      position: placement.position,
      ...mutationActorData(args),
    })
  }

  return {
    ok: true,
    message: placeInWorld
      ? `Conjuration started for "${prompt}" and placed into world ${placedWorldId}.`
      : `Conjuration started for "${prompt}".`,
    data: {
      assetId: response.id,
      status: response.status,
      estimatedSeconds: response.estimatedSeconds ?? null,
      asset,
      placedInWorld: placeInWorld,
      worldId: placedWorldId,
      transform: placeInWorld ? placement : null,
    },
  }
}

tools.process_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  const action = validStr(args.action, '').toLowerCase() as PostProcessAction
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  if (!action) return { ok: false, message: 'action is required.' }

  const response = await callInternalJson<{ id: string; status: string }>(`/api/conjure/${assetId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      ...(args.options && typeof args.options === 'object' ? { options: args.options } : {}),
    }),
  })

  const asset = cloneConjuredAsset(getAssetById(response.id))
  const sourceAsset = cloneConjuredAsset(getAssetById(assetId))
  const placement = resolveConjuredPlacement(args, sourceAsset ? {
    position: sourceAsset.position,
    rotation: sourceAsset.rotation,
    scale: sourceAsset.scale,
  } : undefined)
  const placeInWorld = validBool(args.placeInWorld, true)

  let placedWorldId: string | null = null
  if (placeInWorld) {
    const { worldId } = await placeConjuredAssetInWorld(args.worldId, response.id, placement)
    placedWorldId = worldId
    emitWorldEvent('conjured_asset_added', worldId, {
      assetId: response.id,
      asset: asset || undefined,
      transform: {
        position: placement.position,
        rotation: placement.rotation,
        scale: placement.scale,
      },
      position: placement.position,
      sourceAssetId: assetId,
      action,
      ...mutationActorData(args),
    })
  }

  return {
    ok: true,
    message: placeInWorld
      ? `${action} started for ${assetId}; child asset ${response.id} placed into world ${placedWorldId}.`
      : `${action} started for ${assetId}; child asset ${response.id} queued.`,
    data: {
      assetId: response.id,
      sourceAssetId: assetId,
      status: response.status,
      action,
      asset,
      placedInWorld: placeInWorld,
      worldId: placedWorldId,
      transform: placeInWorld ? placement : null,
    },
  }
}

tools.place_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  const asset = cloneConjuredAsset(getAssetById(assetId))
  if (!asset) return { ok: false, message: `Conjured asset ${assetId} not found.` }
  const placement = resolveConjuredPlacement(args, {
    position: asset.position,
    rotation: asset.rotation,
    scale: asset.scale,
  })
  const { worldId } = await placeConjuredAssetInWorld(args.worldId, assetId, placement)
  emitWorldEvent('conjured_asset_added', worldId, {
    assetId,
    asset,
    transform: {
      position: placement.position,
      rotation: placement.rotation,
      scale: placement.scale,
    },
    position: placement.position,
    ...mutationActorData(args),
  })

  return {
    ok: true,
    message: `Placed conjured asset ${assetId} into world ${worldId}.`,
    data: {
      assetId,
      worldId,
      asset,
      transform: placement,
    },
  }
}

tools.delete_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  const asset = cloneConjuredAsset(getAssetById(assetId))
  if (!asset) return { ok: false, message: `Conjured asset ${assetId} not found.` }
  const { worldId } = await removeConjuredAssetFromWorld(args.worldId, assetId)

  const deleteRegistry = validBool(args.deleteRegistry, true)
  if (deleteRegistry) {
    await callInternalJson<{ success: boolean }>(`/api/conjure/${assetId}`, {
      method: 'DELETE',
    })
  }

  emitWorldEvent('conjured_asset_removed', worldId, {
    assetId,
    deleteRegistry,
    ...mutationActorData(args),
  })

  return {
    ok: true,
    message: deleteRegistry
      ? `Removed conjured asset ${assetId} from world ${worldId} and banished it from the Forge.`
      : `Removed conjured asset ${assetId} from world ${worldId}.`,
    data: {
      assetId,
      worldId,
      deleteRegistry,
    },
  }
}

/** Called by the client-side screenshot bridge to deliver a captured frame. */
export function deliverScreenshot(
  captures: string | DeliveredScreenshotCapture[],
  requestId?: string,
): boolean {
  const job = requestId
    ? pendingScreenshotJobs.find(entry => entry.request.id === requestId) || null
    : activeScreenshotJob()
  const fileRequest = !job && requestId ? readScreenshotRequestFile(requestId) : null
  const request = job?.request || fileRequest
  if (!request) return false

  let normalizedCaptures: DeliveredScreenshotCapture[]
  if (typeof captures === 'string') {
    normalizedCaptures = captures
      ? [{
          viewId: request.views[0]?.id || 'view-1',
          base64: captures,
          format: request.format,
        }]
      : []
  } else {
    normalizedCaptures = captures.filter(capture => typeof capture.base64 === 'string' && capture.base64.length > 0)
  }

  if (requestId) {
    writeScreenshotResultFile(requestId, normalizedCaptures)
  }
  console.info('[OasisTools] screenshot delivered', {
    requestId: request.id,
    captureCount: normalizedCaptures.length,
    resolvedInMemory: Boolean(job),
  })

  if (job) {
    resolveScreenshotJob(job, normalizedCaptures)
  }
  return true
}

/** Check if a screenshot is pending (called by client poll). */
export function isScreenshotPending(): boolean {
  return pendingScreenshotJobs.length > 0 || readScreenshotRequestsFromQueue().length > 0
}

export function getPendingScreenshotRequest(options?: { worldId?: string; requestId?: string }): PendingScreenshotRequest | null {
  const requestedRequestId = validStr(options?.requestId, '')
  const requestedWorldId = validStr(options?.worldId, '')
  const memoryRequest = requestedRequestId
    ? pendingScreenshotJobs.find(entry => entry.request.id === requestedRequestId)?.request || null
    : requestedWorldId
      ? pendingScreenshotJobs.find(entry => !entry.request.worldId || entry.request.worldId === requestedWorldId)?.request || null
      : activeScreenshotJob()?.request || null
  const request = memoryRequest || (
    requestedRequestId
      ? readScreenshotRequestFile(requestedRequestId)
      : readScreenshotRequestsFromQueue().find(entry => !requestedWorldId || !entry.worldId || entry.worldId === requestedWorldId) || null
  )
  if (!request) return null
  return {
    ...request,
    views: request.views.map(view => ({ ...view })),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCHER — call a tool by name
// ═══════════════════════════════════════════════════════════════════════════

export const TOOL_NAMES = Object.keys(tools)

const MUTATING_TOOLS = new Set([
  'place_object', 'place_agent_window', 'place_browser_window', 'create_spatial_web_object', 'craft_scene', 'self_craft_scene', 'modify_object', 'remove_object',
  'set_sky', 'set_ground_preset', 'paint_ground_tiles', 'add_light',
  'modify_light', 'set_behavior', 'set_avatar', 'walk_avatar_to',
  'play_avatar_animation', 'create_portal_gate', 'clear_world',
  'create_world', 'create_and_load_world', 'create_world_from_google_form', 'create_test_world_from_google_form', 'share_world_link',
  'conjure_asset', 'process_conjured_asset', 'place_conjured_asset', 'delete_conjured_asset',
  'conjure_framed_picture', 'place_media',
])

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  context: OasisToolContext = {},
): Promise<ToolResult> {
  const handler = tools[name]
  if (!handler) {
    return { ok: false, message: `Unknown tool: ${name}. Available: ${TOOL_NAMES.join(', ')}` }
  }
  const resolvedContext = resolveToolContext(name, args, context)
  const effectiveArgs = applyToolContextToArgs(args, resolvedContext)
  try {
    return await toolContextStorage.run(resolvedContext, async () => {
      // Serialize mutating operations on the intended world to prevent lost-update races.
      if (resolvedContext.mutating) {
        const worldId = cleanWorldId(effectiveArgs.worldId) || resolvedContext.worldId || '__active__'
        return withWorldLock(worldId, () => handler(effectiveArgs))
      }
      return handler(effectiveArgs)
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[OasisTools] ${name} failed:`, msg)
    if (error instanceof WorldAccessError) {
      return {
        ok: false,
        message: msg,
        data: {
          code: error.code,
          status: error.status,
        },
      }
    }
    return { ok: false, message: `Tool ${name} failed: ${msg}` }
  }
}

// ▓▓▓▓【O̸A̸S̸I̸S̸】▓▓▓▓ॐ▓▓▓▓【T̸O̸O̸L̸S̸】▓▓▓▓

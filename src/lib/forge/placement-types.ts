import type { AgentWindowType, BrowserSurfaceMode } from '../agent-window-types'
import type { AgentWindowRenderMode } from '../agent-window-renderers'
import type { PortalAction, PortalGateVariant } from '../portal-gates'
import type { SpatialWebObject } from '../spatial-web'

export type PlacementVfxType =
  | 'runeflash'
  | 'sparkburst'
  | 'portalring'
  | 'sigilpulse'
  | 'quantumcollapse'
  | 'phoenixascension'
  | 'dimensionalrift'
  | 'crystalgenesis'
  | 'meteorimpact'
  | 'arcanebloom'
  | 'voidanchor'
  | 'stellarforge'
  | 'realitydetonation'
  | 'dimensionalmaw'
  | 'hexstorm'
  | 'singularitydrop'
  | 'random'

export const PLACEMENT_VFX_LIST: Exclude<PlacementVfxType, 'random'>[] = [
  'runeflash',
  'sparkburst',
  'portalring',
  'sigilpulse',
  'realitydetonation',
  'dimensionalmaw',
  'hexstorm',
  'singularitydrop',
  'quantumcollapse',
  'phoenixascension',
  'dimensionalrift',
  'crystalgenesis',
  'meteorimpact',
  'arcanebloom',
  'voidanchor',
  'stellarforge',
]

export interface PlacementPending {
  type: 'catalog' | 'conjured' | 'crafted' | 'library' | 'image' | 'video' | 'agent' | 'light' | 'portal' | 'spatialWeb'
  catalogId?: string
  name: string
  path?: string
  defaultScale?: number
  sceneId?: string
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  mediaOpacity?: number
  imageFrameStyle?: string
  imageFrameThickness?: number
  agentType?: AgentWindowType
  npcId?: string
  agentSessionId?: string
  agentRenderMode?: AgentWindowRenderMode
  agentSurfaceUrl?: string
  agentBrowserSurfaceMode?: BrowserSurfaceMode
  agentFrameStyle?: string
  agentFrameThickness?: number
  lightType?: 'point' | 'spot'
  portalVariant?: PortalGateVariant
  portalTargetWorldId?: string
  portalTargetWorldName?: string
  portalAction?: PortalAction
  portalDirection?: 'one-way' | 'two-way'
  spatialWebObject?: SpatialWebObject
}

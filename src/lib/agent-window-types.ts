import type { LinkedWindowAnchorMode } from './agent-avatar-utils'
import type { AgentWindowRenderMode } from './agent-window-renderers'

export type BrowserSurfaceMode = 'live-browser' | 'desktop-capture'

export type AgentWindowType =
  | 'anorak'
  | 'codex'
  | 'gemini'
  | 'anorak-pro'
  | 'merlin'
  | 'realtime'
  | 'npc'
  | 'hermes'
  | 'openclaw'
  | 'devcraft'
  | 'parzival'
  | 'browser'
  | 'mission'

export interface AgentWindow {
  id: string
  agentType: AgentWindowType
  renderMode?: AgentWindowRenderMode
  linkedAvatarId?: string
  anchorMode?: LinkedWindowAnchorMode
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  width: number
  height: number
  sessionId?: string
  npcId?: string
  label?: string
  browserSurfaceMode?: BrowserSurfaceMode
  surfaceUrl?: string
  captureSourceId?: string
  captureSourceName?: string
  captureFps?: number
  frameStyle?: string
  frameThickness?: number
  windowOpacity?: number
  windowBlur?: number
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

export const PRIVATE_AGENT_WINDOW_TYPES = new Set<AgentWindowType>([
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
])

export function isPrivateAgentWindowType(agentType: AgentWindowType): boolean {
  return PRIVATE_AGENT_WINDOW_TYPES.has(agentType)
}

export function canFocusAgentWindowForViewer(window: AgentWindow, viewerUserId: string): boolean {
  if (window.ownerId && window.ownerId !== viewerUserId && isPrivateAgentWindowType(window.agentType)) return false
  return true
}

export function defaultAgentAvatarLabel(agentType: AgentAvatarType): string {
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

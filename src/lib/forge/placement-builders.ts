import type { PlacementPending } from './placement-types'
import type { PortalAction, PortalGateVariant } from '../portal-gates'

export type PortalActionPreset =
  | 'load_world'
  | 'demo_router'
  | 'create_private'
  | 'create_public'
  | 'create_ffa'
  | 'external_url'
  | 'locked_message'

export type PortalTargetSummary = {
  id: string
  name: string
}

export function normalizeMediaOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0.05, value))
}

function withOptionalOpacity(pending: PlacementPending, mediaOpacity?: number): PlacementPending {
  if (mediaOpacity === undefined) return pending
  return { ...pending, mediaOpacity: normalizeMediaOpacity(mediaOpacity) }
}

export function buildImagePlacementPending(args: {
  name: string
  imageUrl: string
  frameStyle?: string
  frameThickness?: number
  mediaOpacity?: number
}): PlacementPending {
  return withOptionalOpacity({
    type: 'image',
    name: args.name,
    imageUrl: args.imageUrl,
    imageFrameStyle: args.frameStyle,
    imageFrameThickness: args.frameThickness,
  }, args.mediaOpacity)
}

export function buildVideoPlacementPending(args: {
  name: string
  videoUrl: string
  frameStyle?: string
  frameThickness?: number
  mediaOpacity?: number
}): PlacementPending {
  return withOptionalOpacity({
    type: 'video',
    name: args.name,
    videoUrl: args.videoUrl,
    imageFrameStyle: args.frameStyle,
    imageFrameThickness: args.frameThickness,
  }, args.mediaOpacity)
}

export function buildAudioPlacementPending(args: {
  name: string
  audioUrl: string
  catalogId?: string
  path?: string
  defaultScale?: number
}): PlacementPending {
  return {
    type: 'catalog',
    catalogId: args.catalogId || 'kf_speaker',
    name: args.name,
    path: args.path || '/models/kenney-furniture/speaker.glb',
    defaultScale: args.defaultScale ?? 1,
    audioUrl: args.audioUrl,
  }
}

export function buildPortalActionForPreset(args: {
  preset: PortalActionPreset
  selectedTarget?: PortalTargetSummary
  externalUrl?: string
  lockedMessage?: string
  demoRouterPath?: string
}): PortalAction | undefined {
  if (args.preset === 'load_world') {
    return args.selectedTarget
      ? { type: 'load_world', worldId: args.selectedTarget.id, worldName: args.selectedTarget.name }
      : undefined
  }
  if (args.preset === 'demo_router') {
    return { type: 'external_url', url: args.demoRouterPath || '/ab12', label: 'Demo Router', requiresConfirm: false }
  }
  if (args.preset === 'create_private') {
    return { type: 'create_world', visibility: 'private', promptForName: true, name: 'New Private World' }
  }
  if (args.preset === 'create_public') {
    return { type: 'create_world', visibility: 'public', promptForName: true, name: 'New Public World' }
  }
  if (args.preset === 'create_ffa') {
    return { type: 'create_world', visibility: 'ffa', promptForName: true, name: 'New FFA World' }
  }
  if (args.preset === 'external_url') {
    const url = args.externalUrl?.trim() || ''
    return url
      ? { type: 'external_url', url, label: 'External world', returnUrl: 'current', requiresConfirm: true }
      : undefined
  }
  return { type: 'locked_message', message: args.lockedMessage?.trim() || 'This portal is not open yet.' }
}

export function portalPlacementSubtitle(action: PortalAction | undefined, selectedTarget?: PortalTargetSummary): string {
  if (!action) return 'choose action'
  if (action.type === 'load_world') return selectedTarget?.name || 'choose target'
  if (action.type === 'create_world') return `create ${action.visibility || 'private'}`
  if (action.type === 'external_url') return action.label || 'external URL'
  return 'locked'
}

export function buildPortalPlacementPending(args: {
  variant: PortalGateVariant
  action: PortalAction
  selectedTarget?: PortalTargetSummary
}): PlacementPending {
  const action = args.action
  return {
    type: 'portal',
    name: action.type === 'load_world'
      ? `Portal to ${args.selectedTarget?.name || 'world'}`
      : action.type === 'create_world'
        ? `Portal to create ${action.visibility || 'private'}`
        : action.type === 'external_url'
          ? `Portal to ${action.label || 'external URL'}`
          : 'Locked portal',
    portalVariant: args.variant,
    portalAction: action,
    portalTargetWorldId: args.selectedTarget?.id,
    portalTargetWorldName: args.selectedTarget?.name,
    portalDirection: action.type === 'load_world' ? 'two-way' : 'one-way',
  }
}

import type { OasisMode } from '../oasis-profile'

export type WorldKind =
  | 'core'
  | 'template'
  | 'ffa'
  | 'public'
  | 'only-with-link'
  | 'private'

export type StoredWorldVisibility =
  | WorldKind
  | 'public_edit'
  | 'unlisted'

export type WorldWriteDecision = 'write' | 'fork' | 'deny'

export interface WorldAccessContext {
  userId: string
  mode: OasisMode
  system?: boolean
  admin?: boolean
}

export interface WorldAccessSubject {
  id: string
  userId: string
  visibility?: string | null
}

export class WorldAccessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 403,
  ) {
    super(message)
    this.name = 'WorldAccessError'
  }
}

export const PUBLICLY_READABLE_VISIBILITIES: StoredWorldVisibility[] = [
  'core',
  'template',
  'ffa',
  'public_edit',
  'public',
  'only-with-link',
  'unlisted',
]

export const DISCOVERABLE_VISIBILITIES: StoredWorldVisibility[] = [
  'core',
  'template',
  'ffa',
  'public_edit',
  'public',
]

export const FFA_VISIBILITIES: StoredWorldVisibility[] = ['ffa', 'public_edit']

export function normalizeWorldKind(visibility: string | null | undefined): WorldKind {
  switch ((visibility || 'private').trim()) {
    case 'core':
      return 'core'
    case 'template':
      return 'template'
    case 'ffa':
    case 'public_edit':
      return 'ffa'
    case 'public':
      return 'public'
    case 'only-with-link':
    case 'unlisted':
      return 'only-with-link'
    case 'private':
    default:
      return 'private'
  }
}

export function toStorageVisibility(input: string | null | undefined): StoredWorldVisibility | null {
  switch ((input || '').trim()) {
    case 'core':
      return 'core'
    case 'template':
      return 'template'
    case 'ffa':
    case 'public_edit':
      return 'public_edit'
    case 'public':
      return 'public'
    case 'only-with-link':
    case 'unlisted':
      return 'unlisted'
    case 'private':
      return 'private'
    default:
      return null
  }
}

export function isWorldOwner(ctx: WorldAccessContext, world: WorldAccessSubject): boolean {
  return Boolean(ctx.userId) && ctx.userId === world.userId
}

function hasSystemAccess(ctx: WorldAccessContext): boolean {
  return Boolean(ctx.system || ctx.admin)
}

function hasLocalBypass(ctx: WorldAccessContext): boolean {
  return ctx.mode === 'local'
}

export function canDiscoverWorld(ctx: WorldAccessContext, world: WorldAccessSubject): boolean {
  if (hasSystemAccess(ctx) || hasLocalBypass(ctx) || isWorldOwner(ctx, world)) return true
  const kind = normalizeWorldKind(world.visibility)
  return kind === 'core' || kind === 'template' || kind === 'ffa' || kind === 'public'
}

export function canReadWorld(ctx: WorldAccessContext, world: WorldAccessSubject): boolean {
  if (hasSystemAccess(ctx) || hasLocalBypass(ctx) || isWorldOwner(ctx, world)) return true
  const kind = normalizeWorldKind(world.visibility)
  return (
    kind === 'core' ||
    kind === 'template' ||
    kind === 'ffa' ||
    kind === 'public' ||
    kind === 'only-with-link'
  )
}

export function getWorldWriteDecision(
  ctx: WorldAccessContext,
  world: WorldAccessSubject,
): WorldWriteDecision {
  if (hasSystemAccess(ctx)) return 'write'

  const kind = normalizeWorldKind(world.visibility)
  if (kind === 'core') return 'deny'
  if (kind === 'template') return 'fork'
  if (kind === 'ffa') return 'write'
  if (hasLocalBypass(ctx)) return 'write'
  if (isWorldOwner(ctx, world)) return 'write'
  return 'deny'
}

export function canEditWorldSettings(ctx: WorldAccessContext, world: WorldAccessSubject): boolean {
  if (hasSystemAccess(ctx)) return true
  const kind = normalizeWorldKind(world.visibility)
  if (kind === 'core' || kind === 'template') return false
  if (hasLocalBypass(ctx)) return true
  return isWorldOwner(ctx, world)
}

export function assertCanReadWorld(ctx: WorldAccessContext, world: WorldAccessSubject): void {
  if (!canReadWorld(ctx, world)) {
    throw new WorldAccessError('World not found or not visible to this session', 'world_not_visible', 404)
  }
}

export function assertCanEditWorldSettings(ctx: WorldAccessContext, world: WorldAccessSubject): void {
  if (!canEditWorldSettings(ctx, world)) {
    throw new WorldAccessError('This session cannot change that world', 'world_settings_forbidden')
  }
}

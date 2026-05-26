import type { WorldCommandEnvelope, WorldCommandKind } from './types'

export const WORLD_COMMAND_MAX_BYTES = 16 * 1024

const WORLD_COMMAND_KINDS: ReadonlySet<WorldCommandKind> = new Set([
  'object.add',
  'object.update',
  'object.remove',
  'object.transform',
  'object.behavior.update',
  'crafted.add',
  'crafted.update',
  'crafted.remove',
  'portal.add',
  'portal.update',
  'portal.remove',
  'spatial.add',
  'spatial.update',
  'spatial.remove',
  'spatial.value.set',
  'ground.setPreset',
  'ground.paint',
  'ground.tile.erase',
  'ground.tiles.clear',
  'terrain.brush',
  'terrain.reset',
  'light.add',
  'light.update',
  'light.remove',
  'sky.set',
  'stroke.start',
  'stroke.point',
  'stroke.end',
  'stroke.update',
  'stroke.remove',
  'text3d.add',
  'text3d.update',
  'text3d.remove',
  'agent.window.add',
  'agent.window.update',
  'agent.window.remove',
  'agent.avatar.add',
  'agent.avatar.update',
  'agent.avatar.remove',
  'media.playback.set',
  'placement.vfx',
])

const WORLD_LIGHT_TYPES = new Set(['point', 'spot', 'directional', 'ambient', 'hemisphere', 'environment'])

export function isWorldCommandKind(value: unknown): value is WorldCommandKind {
  return typeof value === 'string' && WORLD_COMMAND_KINDS.has(value as WorldCommandKind)
}

export function estimateWorldCommandBytes(command: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(command)).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function isWorldCommandEnvelope(value: unknown): value is WorldCommandEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorldCommandEnvelope>
  return typeof candidate.id === 'string'
    && isWorldCommandKind(candidate.kind)
    && typeof candidate.worldId === 'string'
    && typeof candidate.actorId === 'string'
    && typeof candidate.createdAt === 'string'
    && candidate.payload !== undefined
    && estimateWorldCommandBytes(candidate) <= WORLD_COMMAND_MAX_BYTES
}

export function validateWorldCommandEnvelope(value: unknown): { ok: true; command: WorldCommandEnvelope } | { ok: false; error: string } {
  if (!isWorldCommandEnvelope(value)) return { ok: false, error: 'invalid world command envelope' }
  return { ok: true, command: value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && (record[key] as string).trim().length > 0
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return Number.isFinite(Number(record[key]))
}

function hasPositiveNumber(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (!Number.isFinite(Number(value))) return false
  return Number(value) > 0
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => Number.isFinite(Number(item)))
}

function isPositiveScale(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return isVec3(value) && value.every(item => Number(item) > 0)
}

function isSpatialValue(value: unknown): boolean {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

function validateCatalogPlacement(value: unknown): string | null {
  if (!isRecord(value)) return 'object.add missing object'
  if (!hasString(value, 'id')) return 'object.add missing object.id'
  if (!hasString(value, 'catalogId')) return 'object.add missing object.catalogId'
  if (!hasString(value, 'name')) return 'object.add missing object.name'
  if (!isVec3(value.position)) return 'object.add invalid object.position'
  return isPositiveScale(value.scale) ? null : 'object.add invalid object.scale'
}

function validateWorldLight(value: unknown): string | null {
  if (!isRecord(value)) return 'light.add missing light'
  if (!hasString(value, 'id')) return 'light.add missing light.id'
  if (typeof value.type !== 'string' || !WORLD_LIGHT_TYPES.has(value.type)) return 'light.add invalid light.type'
  if (!hasNumber(value, 'intensity')) return 'light.add invalid light.intensity'
  if (!isVec3(value.position)) return 'light.add invalid light.position'
  if (value.target !== undefined && !isVec3(value.target)) return 'light.add invalid light.target'
  return null
}

export function validateWorldCommandPayloadShape(kind: WorldCommandKind, payload: unknown): string | null {
  if (!isRecord(payload)) return 'command payload must be an object'

  if (kind.endsWith('.remove')) {
    return hasString(payload, 'id') ? null : 'remove command missing id'
  }
  if (kind.endsWith('.update')) {
    if (!hasString(payload, 'id')) return 'update command missing id'
    return isRecord(payload.updates) ? null : 'update command missing updates object'
  }

  switch (kind) {
    case 'object.add':
      return validateCatalogPlacement(payload.object)
    case 'object.transform':
      if (!hasString(payload, 'id')) return 'object.transform missing id'
      if (payload.position !== undefined && !isVec3(payload.position)) return 'object.transform invalid position'
      if (payload.rotation !== undefined && !isVec3(payload.rotation)) return 'object.transform invalid rotation'
      if (payload.scale !== undefined && !isPositiveScale(payload.scale)) return 'object.transform invalid scale'
      return null
    case 'object.behavior.update':
      if (!hasString(payload, 'id')) return 'object.behavior.update missing id'
      return isRecord(payload.updates) ? null : 'object.behavior.update missing updates object'
    case 'crafted.add':
      return isRecord(payload.scene) && hasString(payload.scene, 'id') ? null : 'crafted.add missing scene.id'
    case 'portal.add':
      return isRecord(payload.gate) && hasString(payload.gate, 'id') ? null : 'portal.add missing gate.id'
    case 'spatial.add':
      return isRecord(payload.object) && hasString(payload.object, 'id') ? null : 'spatial.add missing object.id'
    case 'spatial.value.set':
      if (!hasString(payload, 'id')) return 'spatial.value.set missing id'
      return isSpatialValue(payload.value) ? null : 'spatial.value.set invalid value'
    case 'ground.setPreset':
      return hasString(payload, 'groundPresetId') ? null : 'ground.setPreset missing groundPresetId'
    case 'ground.paint':
      if (!hasNumber(payload, 'cx') || !hasNumber(payload, 'cz')) return 'ground.paint missing coordinates'
      if (payload.size !== undefined && !hasPositiveNumber(payload, 'size')) return 'ground.paint invalid size'
      if (payload.stretch !== undefined && !hasPositiveNumber(payload, 'stretch')) return 'ground.paint invalid stretch'
      return hasString(payload, 'presetId') ? null : 'ground.paint missing presetId'
    case 'ground.tile.erase':
      return hasNumber(payload, 'x') && hasNumber(payload, 'z') ? null : 'ground.tile.erase missing coordinates'
    case 'ground.tiles.clear':
    case 'terrain.reset':
      return null
    case 'terrain.brush':
      if (!hasNumber(payload, 'x') || !hasNumber(payload, 'z')) return 'terrain.brush missing coordinates'
      if (!hasNumber(payload, 'radius') || !hasNumber(payload, 'intensity') || !hasNumber(payload, 'deltaSeconds')) return 'terrain.brush missing numeric brush params'
      return payload.direction === 'up' || payload.direction === 'down' ? null : 'terrain.brush invalid direction'
    case 'light.add':
      return validateWorldLight(payload.light)
    case 'sky.set':
      return hasString(payload, 'skyBackgroundId') ? null : 'sky.set missing skyBackgroundId'
    case 'stroke.start':
      if (!hasString(payload, 'strokeId') || !hasString(payload, 'authorId')) return 'stroke.start missing id/author'
      return isRecord(payload.style) ? null : 'stroke.start missing style'
    case 'stroke.point':
      if (!hasString(payload, 'strokeId')) return 'stroke.point missing strokeId'
      return isVec3(payload.point) ? null : 'stroke.point invalid point'
    case 'stroke.end':
      if (!hasString(payload, 'strokeId')) return 'stroke.end missing strokeId'
      return isRecord(payload.finalStroke) && hasString(payload.finalStroke, 'id') ? null : 'stroke.end missing finalStroke.id'
    case 'text3d.add':
      return isRecord(payload.object) && hasString(payload.object, 'id') ? null : 'text3d.add missing object.id'
    case 'agent.window.add':
      return isRecord(payload.window) && hasString(payload.window, 'id') ? null : 'agent.window.add missing window.id'
    case 'agent.avatar.add':
      return isRecord(payload.avatar) && hasString(payload.avatar, 'id') ? null : 'agent.avatar.add missing avatar.id'
    case 'media.playback.set':
      if (!hasString(payload, 'objectId')) return 'media.playback.set missing objectId'
      if (payload.playbackScope !== 'shared' && payload.playbackScope !== 'local') return 'media.playback.set invalid playbackScope'
      return payload.state === 'playing' || payload.state === 'paused' || payload.state === 'stopped' ? null : 'media.playback.set invalid state'
    case 'placement.vfx':
      return isVec3(payload.position) ? null : 'placement.vfx invalid position'
    default:
      return null
  }
}

export function validateRoomScopedWorldCommand(kind: WorldCommandKind, payload: unknown): string | null {
  if (!isRecord(payload)) return null
  if (kind === 'spatial.value.set') {
    const scope = payload.stateScope
    if (scope === 'session' || scope === 'actor') {
      return 'spatial.value.set is not room-scoped'
    }
  }
  if (kind === 'media.playback.set' && payload.playbackScope === 'local') {
    return 'media.playback.set local playback is not room-scoped'
  }
  return null
}

export function validateWorldCommandForDurableApply(value: unknown): { ok: true; command: WorldCommandEnvelope } | { ok: false; error: string } {
  const envelope = validateWorldCommandEnvelope(value)
  if (!envelope.ok) return envelope
  const payloadError = validateWorldCommandPayloadShape(envelope.command.kind, envelope.command.payload)
  if (payloadError) return { ok: false, error: payloadError }
  const scopeError = validateRoomScopedWorldCommand(envelope.command.kind, envelope.command.payload)
  if (scopeError) return { ok: false, error: scopeError }
  return envelope
}

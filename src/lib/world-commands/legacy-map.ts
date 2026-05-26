import type { WorldMutation } from '@/lib/world-mutation-bus'
import type { WorldCommandEnvelope, WorldCommandKind, WorldCommandPayloadByKind } from './types'

interface LegacyCommandContext {
  worldId: string
  actorId: string
  actorDisplayName?: string
  clientId?: string
  createdAt?: string
  id?: string
}

export function legacyMutationToWorldCommand(
  mutation: WorldMutation,
  context: LegacyCommandContext,
): WorldCommandEnvelope | null {
  const createdAt = context.createdAt || new Date().toISOString()

  switch (mutation.kind) {
    case 'object_added':
      return makeCommand('object.add', { object: mutation.payload }, context, createdAt)
    case 'object_updated':
      return makeCommand('object.update', mutation.payload, context, createdAt)
    case 'object_removed':
      return makeCommand('object.remove', mutation.payload, context, createdAt)
    case 'object_transformed':
      return makeCommand('object.transform', mutation.payload, context, createdAt)
    case 'behavior_updated':
      return makeCommand('object.behavior.update', mutation.payload, context, createdAt)

    case 'crafted_scene_added':
      return makeCommand('crafted.add', { scene: mutation.payload }, context, createdAt)
    case 'crafted_scene_updated':
      return makeCommand('crafted.update', mutation.payload, context, createdAt)

    case 'portal_added':
      return makeCommand('portal.add', { gate: mutation.payload }, context, createdAt)
    case 'spatial_web_added':
      return makeCommand('spatial.add', { object: mutation.payload }, context, createdAt)
    case 'spatial_web_updated':
      return makeCommand('spatial.update', mutation.payload, context, createdAt)
    case 'spatial_web_value_set':
      return makeCommand('spatial.value.set', mutation.payload, context, createdAt)

    case 'sky_changed':
      return makeCommand('sky.set', mutation.payload, context, createdAt)
    case 'ground_changed':
      return makeCommand('ground.setPreset', mutation.payload, context, createdAt)
    case 'ground_painted':
      return makeCommand('ground.paint', mutation.payload, context, createdAt)
    case 'ground_tile_erased':
      return makeCommand('ground.tile.erase', mutation.payload, context, createdAt)
    case 'ground_tiles_cleared':
      return makeCommand('ground.tiles.clear', {}, context, createdAt)
    case 'terrain_brushed':
      return makeCommand('terrain.brush', mutation.payload, context, createdAt)
    case 'terrain_reset':
      return makeCommand('terrain.reset', {}, context, createdAt)

    case 'light_added':
      return makeCommand('light.add', mutation.payload, context, createdAt)
    case 'light_updated':
      return makeCommand('light.update', mutation.payload, context, createdAt)
    case 'light_removed':
      return makeCommand('light.remove', mutation.payload, context, createdAt)

    case 'stroke_started':
      return makeCommand('stroke.start', mutation.payload, context, createdAt)
    case 'stroke_pointed':
      return makeCommand('stroke.point', mutation.payload, context, createdAt)
    case 'stroke_ended':
      return makeCommand('stroke.end', mutation.payload, context, createdAt)
    case 'stroke_updated':
      return makeCommand('stroke.update', mutation.payload, context, createdAt)
    case 'stroke_removed':
      return makeCommand('stroke.remove', mutation.payload, context, createdAt)

    case 'text3d_added':
      return makeCommand('text3d.add', { object: mutation.payload }, context, createdAt)
    case 'text3d_updated':
      return makeCommand('text3d.update', mutation.payload, context, createdAt)
    case 'text3d_removed':
      return makeCommand('text3d.remove', mutation.payload, context, createdAt)

    case 'agent_window_added':
      return makeCommand('agent.window.add', { window: mutation.payload }, context, createdAt)
    case 'agent_avatar_added':
      return makeCommand('agent.avatar.add', { avatar: mutation.payload }, context, createdAt)
    case 'placement_vfx':
      return makeCommand('placement.vfx', mutation.payload, context, createdAt)
    default:
      return null
  }
}

export function worldCommandToLegacyMutation(command: WorldCommandEnvelope): WorldMutation | null {
  switch (command.kind) {
    case 'object.add':
      return { kind: 'object_added', payload: command.payload.object }
    case 'object.update':
      return { kind: 'object_updated', payload: command.payload }
    case 'object.remove':
      return { kind: 'object_removed', payload: command.payload }
    case 'object.transform': {
      const position = command.payload.position
      if (!position) return null
      return {
        kind: 'object_transformed',
        payload: {
          id: command.payload.id,
          position,
          rotation: command.payload.rotation,
          scale: command.payload.scale,
        },
      }
    }
    case 'object.behavior.update':
      return { kind: 'behavior_updated', payload: command.payload }

    case 'crafted.add':
      return { kind: 'crafted_scene_added', payload: command.payload.scene }
    case 'crafted.update':
      return { kind: 'crafted_scene_updated', payload: command.payload }
    case 'crafted.remove':
      return { kind: 'object_removed', payload: { id: command.payload.id } }

    case 'portal.add':
      return { kind: 'portal_added', payload: command.payload.gate }
    case 'portal.remove':
      return { kind: 'object_removed', payload: { id: command.payload.id } }

    case 'spatial.add':
      return { kind: 'spatial_web_added', payload: command.payload.object }
    case 'spatial.update':
      return { kind: 'spatial_web_updated', payload: command.payload }
    case 'spatial.remove':
      return { kind: 'object_removed', payload: { id: command.payload.id } }
    case 'spatial.value.set':
      return { kind: 'spatial_web_value_set', payload: {
        id: command.payload.id,
        value: command.payload.value,
        event: command.payload.event,
        statusMessage: command.payload.statusMessage,
        errorMessage: command.payload.errorMessage || undefined,
      } }

    case 'sky.set':
      return { kind: 'sky_changed', payload: command.payload }
    case 'ground.setPreset':
      return { kind: 'ground_changed', payload: command.payload }
    case 'ground.paint':
      return { kind: 'ground_painted', payload: {
        cx: command.payload.cx,
        cz: command.payload.cz,
        presetId: command.payload.presetId,
        size: command.payload.size || 1,
        stretch: command.payload.stretch || 1,
      } }
    case 'ground.tile.erase':
      return { kind: 'ground_tile_erased', payload: command.payload }
    case 'ground.tiles.clear':
      return { kind: 'ground_tiles_cleared', payload: {} }
    case 'terrain.brush':
      return { kind: 'terrain_brushed', payload: command.payload }
    case 'terrain.reset':
      return { kind: 'terrain_reset', payload: {} }

    case 'light.add':
      return { kind: 'light_added', payload: command.payload }
    case 'light.update':
      return { kind: 'light_updated', payload: command.payload }
    case 'light.remove':
      return { kind: 'light_removed', payload: command.payload }

    case 'stroke.start':
      return { kind: 'stroke_started', payload: command.payload }
    case 'stroke.point':
      return { kind: 'stroke_pointed', payload: command.payload }
    case 'stroke.end':
      return { kind: 'stroke_ended', payload: command.payload }
    case 'stroke.update':
      return { kind: 'stroke_updated', payload: command.payload }
    case 'stroke.remove':
      return { kind: 'stroke_removed', payload: command.payload }

    case 'text3d.add':
      return { kind: 'text3d_added', payload: command.payload.object }
    case 'text3d.update':
      return { kind: 'text3d_updated', payload: command.payload }
    case 'text3d.remove':
      return { kind: 'text3d_removed', payload: command.payload }

    case 'agent.window.add':
      return { kind: 'agent_window_added', payload: command.payload.window }
    case 'agent.window.remove':
      return { kind: 'object_removed', payload: { id: command.payload.id, linkedAvatarIds: command.payload.linkedAvatarId ? [command.payload.linkedAvatarId] : undefined } }
    case 'agent.avatar.add':
      return { kind: 'agent_avatar_added', payload: command.payload.avatar }
    case 'agent.avatar.remove':
      return { kind: 'object_removed', payload: { id: command.payload.id } }

    case 'media.playback.set':
      return { kind: 'behavior_updated', payload: {
        id: command.payload.objectId,
        updates: {
          audioState: command.payload.state,
          ...(command.payload.audioUrl !== undefined ? { audioUrl: command.payload.audioUrl } : {}),
          ...(command.payload.volume !== undefined ? { audioVolume: command.payload.volume } : {}),
          ...(command.payload.maxDistance !== undefined ? { audioMaxDistance: command.payload.maxDistance } : {}),
          ...(command.payload.muted !== undefined ? { audioMuted: command.payload.muted } : {}),
          ...(command.payload.loop !== undefined ? { audioLoop: command.payload.loop } : {}),
          audioPlaybackScope: command.payload.playbackScope,
          ...(command.payload.playbackId !== undefined ? { audioPlaybackId: command.payload.playbackId } : {}),
          ...(command.payload.startedAt !== undefined ? { audioStartedAt: command.payload.startedAt } : {}),
          ...(command.payload.updatedAt !== undefined ? { audioUpdatedAt: command.payload.updatedAt } : {}),
        },
      } }
    case 'placement.vfx':
      return { kind: 'placement_vfx', payload: command.payload }
    default:
      return null
  }
}

export function makeWorldCommand<K extends WorldCommandKind>(
  kind: K,
  payload: WorldCommandPayloadByKind[K],
  context: LegacyCommandContext,
): WorldCommandEnvelope<K> {
  return makeCommand(kind, payload, context, context.createdAt || new Date().toISOString())
}

function makeCommand<K extends WorldCommandKind>(
  kind: K,
  payload: WorldCommandPayloadByKind[K],
  context: LegacyCommandContext,
  createdAt: string,
): WorldCommandEnvelope<K> {
  return {
    id: context.id || makeCommandId(kind),
    kind,
    payload,
    worldId: context.worldId,
    actorId: context.actorId,
    actorDisplayName: context.actorDisplayName,
    clientId: context.clientId,
    createdAt,
  } as WorldCommandEnvelope<K>
}

function makeCommandId(kind: WorldCommandKind): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `world-command-${kind.replace(/\./g, '-')}-${suffix}`
}

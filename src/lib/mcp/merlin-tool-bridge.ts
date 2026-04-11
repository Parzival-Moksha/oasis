import { callTool, type ToolResult } from './oasis-tools'
import { execMediaTool, isMediaTool } from '../media-tools'

type MerlinToolName =
  | 'get_world_state'
  | 'query_objects'
  | 'search_assets'
  | 'add_catalog_object'
  | 'modify_object'
  | 'remove_object'
  | 'add_crafted_scene'
  | 'add_light'
  | 'set_sky'
  | 'set_ground'
  | 'set_behavior'
  | 'set_avatar'
  | 'walk_avatar_to'
  | 'play_avatar_animation'
  | 'clear_world'
  | 'generate_image'
  | 'generate_voice'
  | 'generate_video'
  | 'screenshot_viewport'

const MERLIN_TOOL_MAP: Record<MerlinToolName, string> = {
  get_world_state: 'get_world_state',
  query_objects: 'query_objects',
  search_assets: 'search_assets',
  add_catalog_object: 'place_object',
  modify_object: 'modify_object',
  remove_object: 'remove_object',
  add_crafted_scene: 'craft_scene',
  add_light: 'add_light',
  set_sky: 'set_sky',
  set_ground: 'set_ground_preset',
  set_behavior: 'set_behavior',
  set_avatar: 'set_avatar',
  walk_avatar_to: 'walk_avatar_to',
  play_avatar_animation: 'play_avatar_animation',
  clear_world: 'clear_world',
  screenshot_viewport: 'screenshot_viewport',
  generate_image: 'generate_image',
  generate_voice: 'generate_voice',
  generate_video: 'generate_video',
}

function withWorldId(worldId: string, args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, worldId }
}

function withMutationContext(worldId: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    ...withWorldId(worldId, args),
    actorAgentType: typeof args.actorAgentType === 'string' && args.actorAgentType.trim()
      ? args.actorAgentType
      : 'merlin',
  }
}

function normalizeMerlinToolArgs(name: MerlinToolName, args: Record<string, unknown>, worldId: string): Record<string, unknown> {
  switch (name) {
    case 'get_world_state':
      return withWorldId(worldId, {})
    case 'query_objects':
      return withWorldId(worldId, {
        query: args.query,
        near: args.near,
        radius: args.radius,
        type: args.type,
      })
    case 'search_assets':
      return {
        query: args.query,
        category: args.category,
        limit: args.limit,
      }
    case 'add_catalog_object':
      return withMutationContext(worldId, {
        catalogId: args.catalogId,
        position: args.position,
        rotation: args.rotation,
        scale: args.scale,
        label: args.label,
      })
    case 'modify_object':
      return withMutationContext(worldId, {
        objectId: args.objectId,
        position: args.position,
        rotation: args.rotation,
        scale: args.scale,
        visible: args.visible,
        label: args.label,
      })
    case 'remove_object':
      return withMutationContext(worldId, {
        objectId: args.objectId,
      })
    case 'add_crafted_scene':
      return withMutationContext(worldId, {
        name: args.name,
        position: args.position,
        objects: args.objects,
      })
    case 'add_light':
      return withMutationContext(worldId, {
        type: args.type,
        position: args.position,
        color: args.color,
        intensity: args.intensity,
        label: args.label,
      })
    case 'set_sky':
      return withMutationContext(worldId, {
        presetId: args.presetId,
      })
    case 'set_ground':
      return withMutationContext(worldId, {
        presetId: args.presetId,
      })
    case 'set_behavior':
      return withMutationContext(worldId, {
        objectId: args.objectId,
        movement: args.movement,
        speed: args.speed,
        radius: args.radius,
        amplitude: args.amplitude,
        height: args.height,
        label: args.label,
      })
    case 'set_avatar':
      return withMutationContext(worldId, {
        avatarId: args.avatarId,
        agentType: args.agentType || args.agent || 'merlin',
        linkedWindowId: args.linkedWindowId,
        avatarUrl: args.avatarUrl,
        position: args.position,
        rotation: args.rotation,
        scale: args.scale,
        label: args.label,
      })
    case 'walk_avatar_to':
      return withMutationContext(worldId, {
        avatarId: args.avatarId,
        agentType: args.agentType || args.agent || 'merlin',
        position: args.position,
        target: args.target,
        speed: args.speed,
      })
    case 'play_avatar_animation':
      return withMutationContext(worldId, {
        avatarId: args.avatarId,
        agentType: args.agentType || args.agent || 'merlin',
        clipName: args.clipName,
        loop: args.loop,
        speed: args.speed,
      })
    case 'clear_world':
      return withMutationContext(worldId, {
        confirm: args.confirm,
      })
    default:
      return withWorldId(worldId, args)
  }
}

export async function executeMerlinTool(name: string, args: Record<string, unknown>, worldId: string): Promise<ToolResult> {
  if (isMediaTool(name)) {
    const result = await execMediaTool(name, args)
    return result.ok
      ? { ok: true, message: `${name} succeeded.`, data: { url: result.url } }
      : { ok: false, message: result.error || `${name} failed.` }
  }

  const canonicalName = MERLIN_TOOL_MAP[name as MerlinToolName]
  if (!canonicalName) {
    return { ok: false, message: `Unknown Merlin tool: ${name}` }
  }

  const normalizedArgs = name === 'screenshot_viewport'
    ? args
    : normalizeMerlinToolArgs(name as MerlinToolName, args, worldId)
  return callTool(canonicalName, normalizedArgs)
}

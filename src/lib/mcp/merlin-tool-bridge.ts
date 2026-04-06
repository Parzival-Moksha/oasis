import { callTool, type ToolResult } from './oasis-tools'

type MerlinToolName =
  | 'add_catalog_object'
  | 'remove_object'
  | 'add_crafted_scene'
  | 'add_light'
  | 'set_sky'
  | 'set_ground'
  | 'set_behavior'
  | 'clear_world'

const MERLIN_TOOL_MAP: Record<MerlinToolName, string> = {
  add_catalog_object: 'place_object',
  remove_object: 'remove_object',
  add_crafted_scene: 'craft_scene',
  add_light: 'add_light',
  set_sky: 'set_sky',
  set_ground: 'set_ground_preset',
  set_behavior: 'set_behavior',
  clear_world: 'clear_world',
}

function withWorldId(worldId: string, args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, worldId }
}

function normalizeMerlinToolArgs(name: MerlinToolName, args: Record<string, unknown>, worldId: string): Record<string, unknown> {
  switch (name) {
    case 'add_catalog_object':
      return withWorldId(worldId, {
        catalogId: args.catalogId,
        position: args.position,
        rotation: args.rotation,
        scale: args.scale,
        label: args.label,
      })
    case 'remove_object':
      return withWorldId(worldId, {
        objectId: args.objectId,
      })
    case 'add_crafted_scene':
      return withWorldId(worldId, {
        name: args.name,
        position: args.position,
        objects: args.objects,
      })
    case 'add_light':
      return withWorldId(worldId, {
        type: args.type,
        position: args.position,
        color: args.color,
        intensity: args.intensity,
        label: args.label,
      })
    case 'set_sky':
      return withWorldId(worldId, {
        presetId: args.presetId,
      })
    case 'set_ground':
      return withWorldId(worldId, {
        presetId: args.presetId,
      })
    case 'set_behavior':
      return withWorldId(worldId, {
        objectId: args.objectId,
        movement: args.movement,
        label: args.label,
      })
    case 'clear_world':
      return withWorldId(worldId, {
        confirm: args.confirm,
      })
    default:
      return withWorldId(worldId, args)
  }
}

export async function executeMerlinTool(name: string, args: Record<string, unknown>, worldId: string): Promise<ToolResult> {
  const canonicalName = MERLIN_TOOL_MAP[name as MerlinToolName]
  if (!canonicalName) {
    return { ok: false, message: `Unknown Merlin tool: ${name}` }
  }

  const normalizedArgs = normalizeMerlinToolArgs(name as MerlinToolName, args, worldId)
  return callTool(canonicalName, normalizedArgs)
}

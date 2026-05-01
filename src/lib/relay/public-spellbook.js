export const PUBLIC_TOOL_NAMES = Object.freeze([
  'get_world_state',
  'get_world_info',
  'query_objects',
  'search_assets',
  'get_asset_catalog',
  'place_object',
  'modify_object',
  'remove_object',
  'set_sky',
  'set_ground_preset',
  'paint_ground_tiles',
  'add_light',
  'modify_light',
  'set_behavior',
  'set_avatar',
  'walk_avatar_to',
  'list_avatar_animations',
  'play_avatar_animation',
  'screenshot_viewport',
  'screenshot_avatar',
  'avatarpic_user',
])

const PUBLIC_TOOL_SCOPE_ENTRIES = [
  ['get_world_state', 'world.read'],
  ['get_world_info', 'world.read'],
  ['query_objects', 'world.read'],
  ['search_assets', 'world.read'],
  ['get_asset_catalog', 'world.read'],
  ['list_avatar_animations', 'world.read'],
  ['place_object', 'world.write.safe'],
  ['modify_object', 'world.write.safe'],
  ['remove_object', 'world.write.safe'],
  ['set_sky', 'world.write.safe'],
  ['set_ground_preset', 'world.write.safe'],
  ['paint_ground_tiles', 'world.write.safe'],
  ['add_light', 'world.write.safe'],
  ['modify_light', 'world.write.safe'],
  ['set_behavior', 'world.write.safe'],
  ['set_avatar', 'world.write.safe'],
  ['walk_avatar_to', 'world.write.safe'],
  ['play_avatar_animation', 'world.write.safe'],
  ['screenshot_viewport', 'screenshot.request'],
  ['screenshot_avatar', 'screenshot.request'],
  ['avatarpic_user', 'screenshot.request'],
]

const PUBLIC_TOOL_NAME_SET = new Set(PUBLIC_TOOL_NAMES)
const PUBLIC_TOOL_SCOPE_MAP = new Map(PUBLIC_TOOL_SCOPE_ENTRIES)

export function isPublicToolName(toolName) {
  return PUBLIC_TOOL_NAME_SET.has(toolName)
}

export function requiredScopeForPublicTool(toolName) {
  return PUBLIC_TOOL_SCOPE_MAP.get(toolName) || null
}

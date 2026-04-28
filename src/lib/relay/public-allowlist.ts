/**
 * Public spellbook — the set of MCP tool names callable when
 * `OASIS_MODE=hosted`. `/api/relay/execute` rejects anything else.
 *
 * Source: specs/ship_openclaw.md §495 ("Spellbook Policy"). Keep aligned.
 *
 * Tools NOT here, intentionally, in v1:
 *   - clear_world           (too destructive for agent autonomy)
 *   - list_worlds / load_world / create_world  (need session-scoped storage)
 *   - craft_scene*          (split into _self and _with_prompt before public)
 *   - get_craft_guide / get_craft_job  (paired with craft_scene; off until split)
 *   - list/get/place/conjure/process/delete_conjured_asset  (no Conjure registry in v1)
 *   - generate_image / generate_voice / generate_video      (paid path; agent-side)
 *   - avatarpic_merlin                                       (Merlin-specific bloat)
 */

export const PUBLIC_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
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

export function isPublicTool(toolName: string): boolean {
  return PUBLIC_TOOL_ALLOWLIST.has(toolName)
}

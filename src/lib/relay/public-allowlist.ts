import {
  PUBLIC_TOOL_NAMES,
  isPublicToolName,
  requiredScopeForPublicTool as requiredScopeForPublicToolJs,
} from './public-spellbook.js'

import type { Scope } from './protocol'

/**
 * Public spellbook: the MCP-shaped tool surface callable in hosted mode.
 *
 * Source: specs/ship_openclaw.md Spellbook Policy. Keep aligned with
 * public-spellbook.js because that JS module is also consumed by Node scripts.
 *
 * Tools NOT here, intentionally, in v1:
 *   - clear_world
 *   - craft_scene* / get_craft_guide / get_craft_job
 *   - list/get/place/conjure/process/delete_conjured_asset
 *   - generate_image / generate_voice / generate_video
 *   - avatarpic_merlin
 */

export const PUBLIC_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(PUBLIC_TOOL_NAMES)

export function isPublicTool(toolName: string): boolean {
  return isPublicToolName(toolName)
}

export function requiredScopeForPublicTool(toolName: string): Scope | null {
  return requiredScopeForPublicToolJs(toolName) as Scope | null
}

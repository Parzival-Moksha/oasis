// World tools: every Oasis agent gets the Oasis MCP server (see and touch the world it lives in).
// The server is the Next app's /api/mcp/oasis route (src/app/api/mcp/oasis/route.ts). It is passed with
// --mcp-config, so it loads without the project-.mcp.json approval step, whatever folder the agent works in.
// If the Oasis page server is down when an agent starts, the server shows as failed and the agent works without it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORLD_SERVER = 'oasis';
const WEB = (process.env.OASIS_WEB_URL || 'http://127.0.0.1:4516').replace(/\/+$/, '');

// Free, local tools run without a permission card: looking, placing, moving, lighting, screenshots.
// Everything else on the server asks first: tools that spend credits (generate_*, conjure_*, craft_scene,
// avatarpic_*, text_to_music), switch or wipe the owner's world (load_world, create_*world, clear_world),
// or delete library files.
const FREE_TOOLS = [
  'get_world_state', 'get_world_info', 'query_objects', 'search_assets', 'get_asset_catalog', 'list_worlds',
  'place_object', 'modify_object', 'remove_object', 'self_craft_scene', 'get_craft_guide', 'get_craft_job',
  'set_sky', 'set_ground_preset', 'paint_ground_tiles', 'add_light', 'modify_light', 'set_behavior',
  'walk_avatar_to', 'list_avatar_animations', 'play_avatar_animation',
  'screenshot_viewport', 'screenshot_avatar',
  'list_conjured_assets', 'get_conjured_asset', 'place_conjured_asset', 'place_media',
];
export const WORLD_TOOLS_ALLOWED = FREE_TOOLS.map((t) => `mcp__${WORLD_SERVER}__${t}`);

export function worldToolsConfig() {
  return { mcpServers: { [WORLD_SERVER]: { type: 'http', url: `${WEB}/api/mcp/oasis` } } };
}

let file = null;
/** Path of the --mcp-config file (a file, not inline JSON, so the cmd.exe fallback spawn can't mangle quotes).
 *  Named after its content, so engine restarts reuse one temp file instead of leaving a new one each time. */
export function worldToolsConfigFile() {
  if (file) return file;
  const json = JSON.stringify(worldToolsConfig(), null, 2);
  file = path.join(os.tmpdir(), `oasis-agent-engine-mcp-${createHash('sha1').update(json).digest('hex').slice(0, 8)}.json`);
  fs.writeFileSync(file, json);
  return file;
}

/** Spawn args that give an agent the world tools. */
export function worldToolsArgs() {
  return ['--mcp-config', worldToolsConfigFile(), '--allowedTools', WORLD_TOOLS_ALLOWED.join(',')];
}

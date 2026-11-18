// World tools: every Oasis agent gets the Oasis MCP server (see and touch the world it lives in).
// The server is the Next app's /api/mcp/oasis route (src/app/api/mcp/oasis/route.ts).
//
// Two ways it reaches an agent (verified with Claude Code 2.1.318):
// - The Oasis plugin (plugins/oasis/.mcp.json) ships it to every session on the machine, the desktop app
//   included. A plugin's server is named `plugin:<plugin>:<server>`, so its tools are
//   `mcp__plugin_oasis_oasis__<tool>`. When that plugin is installed and enabled, the engine passes nothing.
// - Otherwise the engine passes it with --mcp-config (tools `mcp__oasis__<tool>`), which loads without the
//   project-.mcp.json approval step, whatever folder the agent works in.
// A plugin server with the same URL as a server from --mcp-config or a project .mcp.json is dropped by the CLI
// (the other one wins, tools stay `mcp__oasis__*`), so both tool names are pre-allowed either way.
// If the Oasis page server is down when an agent starts, the server shows as failed and the agent works without it.
import { createHash } from 'node:crypto';
import { requiredToken } from './token.js';
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
export const PLUGIN = 'oasis';
/** How the CLI names the plugin's copy of the server: mcp__plugin_<plugin>_<server>__<tool>. */
export const PLUGIN_TOOL_PREFIX = `mcp__plugin_${PLUGIN}_${WORLD_SERVER}__`;
export const WORLD_TOOLS_ALLOWED = [
  ...FREE_TOOLS.map((t) => `mcp__${WORLD_SERVER}__${t}`),
  ...FREE_TOOLS.map((t) => `${PLUGIN_TOOL_PREFIX}${t}`),
];
export const worldToolsUrl = () => `${WEB}/api/mcp/oasis`;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Does the installed Oasis plugin bring the world tools to a session started in `cwd`?
 * True when a plugin named "oasis" is installed (~/.claude/plugins/installed_plugins.json), not switched off
 * (enabledPlugins in the user's settings, or the folder's .claude/settings*.json), and its installed copy has
 * an .mcp.json with this same server URL, or with the plugin's own local server. Read at each spawn: an install or update needs no engine restart.
 * @param {string} [cwd]
 * @param {string} [configDir] the Claude config folder (tests)
 */
export function pluginShipsWorldTools(cwd, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) {
  const installed = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'))?.plugins || {};
  const settings = [path.join(configDir, 'settings.json')];
  if (cwd) settings.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
  const enabled = {};
  for (const file of settings) Object.assign(enabled, readJson(file)?.enabledPlugins || {});
  for (const [key, installs] of Object.entries(installed)) {
    if (key.split('@')[0] !== PLUGIN || enabled[key] !== true) continue;
    for (const install of Array.isArray(installs) ? installs : []) {
      const server = install?.installPath && readJson(path.join(install.installPath, '.mcp.json'))?.mcpServers?.[WORLD_SERVER];
      if (server?.url && String(server.url).replace(/\/+$/, '') === worldToolsUrl()) return true;
      // The published plugin ships the tools as a local server of its own (plugins/oasis/mcp/oasis-mcp.mjs),
      // which passes them on to this same Oasis.
      if (server?.command && (server.args || []).some((a) => /(^|[\\/])oasis-mcp\.mjs$/.test(String(a)))) return true;
    }
  }
  return false;
}

export function worldToolsConfig() {
  // With a local key the page server asks for it on its tool route too.
  const token = requiredToken();
  return { mcpServers: { [WORLD_SERVER]: { type: 'http', url: worldToolsUrl(), ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) } } };
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

/** Spawn args that give an agent the world tools: the server unless the plugin brings it, and its free tools pre-allowed. */
export function worldToolsArgs({ cwd, viaPlugin = pluginShipsWorldTools(cwd) } = {}) {
  return [...(viaPlugin ? [] : ['--mcp-config', worldToolsConfigFile()]), '--allowedTools', WORLD_TOOLS_ALLOWED.join(',')];
}

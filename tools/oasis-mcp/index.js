// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS MCP — World-builder tools for any agent
// Claude Code, Cursor, Windsurf, Hermes — all speak MCP.
// Stdio transport: launched as subprocess via .mcp.json
//
// Tools: place_object, remove_object, modify_object, craft_scene,
//        search_assets, get_asset_catalog, get_world_state, get_world_info,
//        query_objects, set_sky, set_ground_preset, paint_ground_tiles,
//        add_light, modify_light, set_behavior, set_avatar,
//        walk_avatar_to, play_avatar_animation, clear_world,
//        list_worlds, load_world, create_world, screenshot_viewport
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../../node_modules/.prisma/client/default.js");

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${process.env.OASIS_DB_PATH || "c:/af_oasis/prisma/data/oasis.db"}` } },
});
prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => {});

// Load asset catalog from pre-generated JSON (run: node -e "..." to regenerate)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLD_RUNTIME_CONTEXT_PATH = join(__dirname, "../../prisma/data/world-runtime-context.json");
let ASSET_CATALOG = [];
try {
  ASSET_CATALOG = JSON.parse(readFileSync(join(__dirname, "asset-catalog.json"), "utf8"));
} catch (e) {
  console.error("[oasis-mcp] Failed to load asset-catalog.json:", e.message);
}
const CATALOG_MAP = new Map(ASSET_CATALOG.map(a => [a.id, a]));

// Don't filter by userId — local-first means ALL worlds are accessible
// Old SaaS worlds have Google OAuth IDs, new ones have "local-user"
const LOCAL_USER = null; // null = no userId filter
// If set, this world is always used instead of "most recently updated"
const PINNED_WORLD_ID = process.env.OASIS_ACTIVE_WORLD_ID || "";
const OASIS_URL = process.env.OASIS_URL || "http://localhost:4516";
const DEFAULT_AGENT_TYPE = (process.env.OASIS_AGENT_TYPE || "hermes").toLowerCase();
const server = new McpServer({ name: "oasis-mcp", version: "1.0.0" });

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function txt(s) { return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] }; }

function compactScreenshotProxyResult(result) {
  if (!result || typeof result !== "object") return result;
  const next = { ...result };
  const data = next.data && typeof next.data === "object" ? { ...next.data } : null;
  if (!data) return next;
  if (Array.isArray(data.captures)) {
    data.captures = data.captures.map(capture => {
      if (!capture || typeof capture !== "object") return capture;
      const compact = { ...capture };
      delete compact.base64;
      return compact;
    });
  }
  delete data.base64;
  next.data = data;
  return next;
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceNumber(value) {
  const parsed = toFiniteNumber(value);
  return parsed === null ? value : parsed;
}

function coerceVec3(value) {
  const tryVector = (candidate) => {
    if (!Array.isArray(candidate) || candidate.length !== 3) return null;
    const parsed = candidate.map(entry => toFiniteNumber(entry));
    return parsed.every(entry => entry !== null) ? parsed : null;
  };

  const direct = tryVector(value);
  if (direct) return direct;

  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    const jsonParsed = JSON.parse(trimmed);
    const parsed = tryVector(jsonParsed);
    if (parsed) return parsed;
  } catch {}

  const scalarParts = trimmed
    .replace(/^[\[\(\{]\s*/, "")
    .replace(/\s*[\]\)\}]$/, "")
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (scalarParts.length !== 3) return value;
  const parsed = scalarParts.map(part => toFiniteNumber(part));
  return parsed.every(entry => entry !== null) ? parsed : value;
}

function coerceJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function normalizeAgentType(value, fallback = DEFAULT_AGENT_TYPE) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return trimmed || fallback;
}

function cloneVec3(value) {
  return Array.isArray(value) && value.length >= 3
    ? [Number(value[0]), Number(value[1]), Number(value[2])]
    : value;
}

function readWorldPlayerContext(worldId) {
  if (typeof worldId !== "string" || !worldId.trim()) return null;
  try {
    const raw = readFileSync(WORLD_RUNTIME_CONTEXT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const entry = parsed && typeof parsed === "object" ? parsed[worldId.trim()] : null;
    if (!entry || typeof entry !== "object" || !entry.player) return null;
    const updatedAtMs = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updatedAtMs) || (Date.now() - updatedAtMs) > (5 * 60 * 1000)) return null;
    return {
      updatedAt: entry.updatedAt,
      player: {
        avatar: entry.player.avatar ? {
          position: cloneVec3(entry.player.avatar.position),
          ...(typeof entry.player.avatar.yaw === "number" ? { yaw: entry.player.avatar.yaw } : {}),
          ...(entry.player.avatar.forward ? { forward: cloneVec3(entry.player.avatar.forward) } : {}),
        } : null,
        camera: entry.player.camera ? {
          position: cloneVec3(entry.player.camera.position),
          ...(entry.player.camera.forward ? { forward: cloneVec3(entry.player.camera.forward) } : {}),
        } : null,
      },
    };
  } catch {
    return null;
  }
}

async function proxyOasisTool(tool, args) {
  try {
    const response = await fetch(`${OASIS_URL}/api/oasis-tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        message: data?.message || data?.error || `HTTP ${response.status}`,
      };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, message: "Invalid response from Oasis tools API." };
    }
    return data;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function proxyPinnedMutation(tool, args, { includeActorAgentType = true } = {}) {
  const { worldId } = await getActiveWorld();
  const payload = { ...args, worldId };
  if (includeActorAgentType && !payload.actorAgentType) {
    payload.actorAgentType = normalizeAgentType(payload.agentType || payload.agent, DEFAULT_AGENT_TYPE);
  }
  return proxyOasisTool(tool, payload);
}

async function readActiveWorldConjuredAssets(worldId) {
  const result = await proxyOasisTool("list_conjured_assets", {
    worldId,
    activeWorldOnly: true,
  });
  const assets = result?.data?.assets;
  if (!Array.isArray(assets)) return [];
  return assets
    .map(asset => ({
      id: typeof asset?.id === "string" ? asset.id : null,
      displayName: typeof asset?.displayName === "string" ? asset.displayName : null,
      prompt: typeof asset?.prompt === "string" ? asset.prompt : null,
      provider: typeof asset?.provider === "string" ? asset.provider : null,
      tier: typeof asset?.tier === "string" ? asset.tier : null,
      status: typeof asset?.status === "string" ? asset.status : null,
      glbPath: typeof asset?.glbPath === "string" ? asset.glbPath : null,
      thumbnailUrl: typeof asset?.thumbnailUrl === "string" ? asset.thumbnailUrl : null,
      position: Array.isArray(asset?.position) ? asset.position : null,
      rotation: Array.isArray(asset?.rotation) ? asset.rotation : null,
      scale: asset?.scale ?? null,
    }))
    .filter(asset => asset.id);
}

const zNumberish = () => z.preprocess(coerceNumber, z.number());
const zOptionalNumberish = () => z.preprocess((value) => value === undefined ? undefined : coerceNumber(value), z.number().optional());
const zVec3 = () => z.preprocess(coerceVec3, z.array(zNumberish()).length(3));
const zOptionalVec3 = () => z.preprocess((value) => value === undefined ? undefined : coerceVec3(value), z.array(zNumberish()).length(3).optional());
const zMovement = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase() : value,
  z.enum(["static", "spin", "hover", "orbit", "bounce", "patrol"]),
);
const zScreenshotView = z.object({
  id: z.string().optional(),
  mode: z.enum(["current", "player", "agent", "external", "agent-avatar-phantom", "look-at", "third-person", "third_person", "thirdperson", "third-person-follow", "tps", "avatar", "portrait", "avatar-portrait", "avatar_portrait", "avatarpic"]).optional(),
  camera: z.string().optional(),
  view: z.string().optional(),
  perspective: z.string().optional(),
  agentType: z.string().optional(),
  player: z.boolean().optional(),
  agent: z.union([z.boolean(), z.string()]).optional(),
  external: z.boolean().optional(),
  position: zOptionalVec3(),
  target: zOptionalVec3(),
  cameraPosition: zOptionalVec3(),
  cameraTarget: zOptionalVec3(),
  fov: zOptionalNumberish(),
  distance: zOptionalNumberish(),
  heightOffset: zOptionalNumberish(),
  lookAhead: zOptionalNumberish(),
});

async function getActiveWorld() {
  // Use pinned world ID if set (passed from browser's activeWorldId)
  const world = PINNED_WORLD_ID
    ? await prisma.world.findFirst({ where: { id: PINNED_WORLD_ID }, select: { id: true, data: true } })
    : await prisma.world.findFirst({ orderBy: { updatedAt: "desc" }, select: { id: true, data: true } });
  if (!world?.data) throw new Error("No world found.");
  const state = JSON.parse(world.data);
  state.transforms = state.transforms || {};
  state.behaviors = state.behaviors || {};
  state.catalogPlacements = state.catalogPlacements || [];
  state.agentAvatars = state.agentAvatars || [];
  state.craftedScenes = state.craftedScenes || [];
  state.conjuredAssetIds = state.conjuredAssetIds || [];
  state.lights = state.lights || [];
  state.groundTiles = state.groundTiles || {};
  return { worldId: world.id, state };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — World Query
// ═══════════════════════════════════════════════════════════════════════════

server.tool("get_world_state", "Get the full world state (objects, lights, sky, ground, tiles, behaviors).", {
  worldId: z.string().optional().describe("World ID. If omitted, uses the most recently updated world."),
}, async ({ worldId }) => {
  const { state, worldId: id } = worldId
    ? { state: JSON.parse((await prisma.world.findFirst({ where: { id: worldId }, select: { data: true } }))?.data || "{}"), worldId }
    : await getActiveWorld();
  const livePlayerContext = readWorldPlayerContext(id);
  const conjuredAssets = await readActiveWorldConjuredAssets(id);
  return txt({
    worldId: id,
    sky: state.skyBackgroundId || "night007",
    ground: state.groundPresetId || "none",
    tileCount: Object.keys(state.groundTiles || {}).length,
    catalogObjects: (state.catalogPlacements || []).map(p => ({ id: p.id, catalogId: p.catalogId, name: p.name, position: p.position, scale: p.scale })),
    craftedScenes: (state.craftedScenes || []).map(s => ({ id: s.id, name: s.name, objectCount: s.objects?.length || 0, position: s.position })),
    lights: (state.lights || []).map(l => ({ id: l.id, type: l.type, color: l.color, intensity: l.intensity, position: l.position, visible: l.visible })),
    agentAvatars: (state.agentAvatars || []).map(a => ({ id: a.id, agentType: a.agentType, label: a.label, avatar3dUrl: a.avatar3dUrl, position: a.position, rotation: a.rotation, scale: a.scale, linkedWindowId: a.linkedWindowId })),
    livePlayerAvatar: livePlayerContext?.player?.avatar || null,
    livePlayerCamera: livePlayerContext?.player?.camera || null,
    livePlayerUpdatedAt: livePlayerContext?.updatedAt || null,
    conjuredAssetCount: (state.conjuredAssetIds || []).length,
    conjuredAssets: conjuredAssets.length ? conjuredAssets : (state.conjuredAssetIds || []).map(assetId => ({ id: assetId })),
    behaviors: state.behaviors || {},
  });
});

server.tool("get_world_info", "Get a quick summary of the active world (name, object count, sky, ground).", {
  worldId: z.string().optional(),
}, async ({ worldId }) => {
  const world = worldId
    ? await prisma.world.findFirst({ where: { id: worldId } })
    : await prisma.world.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!world) return txt("No world found.");
  const state = world.data ? JSON.parse(world.data) : {};
  const objectCount = (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) + (state.conjuredAssetIds?.length || 0);
  return txt({ worldId: world.id, name: world.name, icon: world.icon, objectCount, sky: state.skyBackgroundId || "night007", ground: state.groundPresetId || "none", tileCount: Object.keys(state.groundTiles || {}).length, lightCount: state.lights?.length || 0 });
});

server.tool("query_objects", "Search objects in the world by keyword or spatial proximity.", {
  query: z.string().optional().describe("Search by name/ID substring"),
  near: zOptionalVec3().describe("[x,y,z] position to search near"),
  radius: zOptionalNumberish().describe("Search radius (default 20)"),
  type: z.enum(["catalog", "crafted", "light", "agent-avatar", "conjured"]).optional().describe("Filter by object type"),
}, async ({ query, near, radius = 20, type }) => {
  const { state, worldId } = await getActiveWorld();
  const conjuredAssets = (!type || type === "conjured")
    ? await readActiveWorldConjuredAssets(worldId)
    : [];
  const conjuredById = new Map(conjuredAssets.map(asset => [asset.id, asset]));
  let results = [];
  if (!type || type === "catalog") for (const p of state.catalogPlacements) results.push({ id: p.id, type: "catalog", name: p.name || p.catalogId, position: p.position, catalogId: p.catalogId });
  if (!type || type === "crafted") for (const s of state.craftedScenes) results.push({ id: s.id, type: "crafted", name: s.name, position: s.position });
  if (!type || type === "light") for (const l of state.lights) results.push({ id: l.id, type: "light", name: `${l.type} light`, position: l.position });
  if (!type || type === "conjured") for (const assetId of state.conjuredAssetIds) {
    const asset = conjuredById.get(assetId);
    results.push({
      id: assetId,
      type: "conjured",
      name: asset?.displayName || asset?.prompt || assetId,
      position: asset?.position || state.transforms?.[assetId]?.position,
    });
  }
  if (!type || type === "agent-avatar") for (const a of state.agentAvatars) results.push({ id: a.id, type: "agent-avatar", name: a.label || a.agentType, position: a.position });
  if (query) { const q = query.toLowerCase(); results = results.filter(o => (o.name || "").toLowerCase().includes(q) || o.id.toLowerCase().includes(q)); }
  if (near) results = results.filter(o => { if (!o.position) return true; const d = Math.sqrt((o.position[0]-near[0])**2 + (o.position[1]-near[1])**2 + (o.position[2]-near[2])**2); return d <= radius; });
  return txt(results);
});

server.tool("search_assets", "Search the asset catalog by keyword. Returns matching asset IDs, names, categories, and paths.", {
  query: z.string().describe("Keyword to search (e.g. 'tree', 'medieval', 'house')"),
  category: z.string().optional().describe("Filter by category"),
  limit: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, category, limit = 20 }) => {
  let results = ASSET_CATALOG;
  if (category) results = results.filter(a => a.category.toLowerCase() === category.toLowerCase());
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(a => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q));
  }
  return txt(results.slice(0, Math.min(limit, 50)).map(a => ({ id: a.id, name: a.name, category: a.category, defaultScale: a.defaultScale })));
});

server.tool("get_asset_catalog", "Get the full asset catalog grouped by category.", {
  category: z.string().optional().describe("Filter by category"),
}, async ({ category }) => {
  const byCategory = {};
  for (const a of ASSET_CATALOG) {
    const cat = a.category || "misc";
    if (category && cat.toLowerCase() !== category.toLowerCase()) continue;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ id: a.id, name: a.name, defaultScale: a.defaultScale });
  }
  return txt(byCategory);
});

server.tool("load_world", "Switch the active world (for subsequent tool calls).", {
  worldId: z.string().describe("World ID to load"),
}, async ({ worldId }) => {
  const world = await prisma.world.findFirst({ where: { id: worldId }, select: { id: true, name: true, data: true } });
  if (!world) return txt({ ok: false, message: `World ${worldId} not found.` });
  // Touch updatedAt so this becomes the "active" world for subsequent calls
  await prisma.world.update({ where: { id: worldId }, data: { updatedAt: new Date() } });
  const state = world.data ? JSON.parse(world.data) : {};
  const objectCount = (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0);
  return txt({ ok: true, message: `Loaded world "${world.name}" (${worldId}).`, worldId, name: world.name, objectCount });
});

server.tool("list_worlds", "List all saved worlds.", {}, async () => {
  const worlds = await prisma.world.findMany({ select: { id: true, name: true, icon: true, objectCount: true, updatedAt: true }, orderBy: { updatedAt: "desc" } });
  return txt(worlds.map(w => ({ id: w.id, name: w.name, icon: w.icon, objectCount: w.objectCount, lastSaved: w.updatedAt.toISOString() })));
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — World Build
// ═══════════════════════════════════════════════════════════════════════════

server.tool("place_object", "Place a catalog asset in the world. Use search_assets or get_world_state to find valid asset IDs.", {
  assetId: z.string().describe("Catalog asset ID (e.g. km_tower, ku_tree_park)"),
  position: zVec3().describe("[x, y, z] world position. Y=0 for ground level. String forms like \"[1,0,2]\" are also accepted."),
  rotation: zOptionalVec3().describe("[rx, ry, rz] rotation in radians"),
  scale: zOptionalNumberish().describe("Uniform scale factor (default 1.0)"),
  label: z.string().optional().describe("Display name"),
}, async ({ assetId, position, rotation, scale, label }) => {
  const asset = CATALOG_MAP.get(assetId);
  if (!asset) return txt({ ok: false, message: `Unknown asset: ${assetId}. Use get_world_state or check asset-catalog.json for valid IDs.` });
  return txt(await proxyPinnedMutation("place_object", {
    assetId,
    position,
    rotation,
    scale,
    label,
  }));
});

server.tool("remove_object", "Remove an object from the world by ID.", {
  objectId: z.string().describe("Object ID to remove"),
}, async ({ objectId }) => {
  return txt(await proxyPinnedMutation("remove_object", { objectId }));
});

server.tool("modify_object", "Modify an existing object: position, rotation, scale, label, visibility.", {
  objectId: z.string().describe("Object ID to modify"),
  position: zOptionalVec3(),
  rotation: zOptionalVec3(),
  scale: zOptionalNumberish(),
  label: z.string().optional(),
  visible: z.boolean().optional(),
}, async ({ objectId, position, rotation, scale, label, visible }) => {
  return txt(await proxyPinnedMutation("modify_object", {
    objectId,
    position,
    rotation,
    scale,
    label,
    visible,
  }));
});

server.tool("craft_scene", "Create stunning procedural geometry scenes. RECOMMENDED: provide 'prompt' (text description) and the system calls an LLM sculptor that designs scenes with shader effects (animated flames, waving flags, glowing crystals, water, particles, aurora, glow orbs). Alternative: provide 'objects' array with raw primitives directly.", {
  name: z.string().optional().describe("Scene name (auto-generated from prompt if omitted)"),
  prompt: z.string().optional().describe("Text description — the LLM sculptor designs the scene. E.g. 'a medieval watchtower with flame torches and crystal energy source'. RECOMMENDED over manual objects."),
  position: zOptionalVec3().describe("Scene offset"),
  objects: z.array(z.object({
    type: z.enum(["box", "sphere", "cylinder", "cone", "torus", "plane", "capsule", "text", "flame", "flag", "crystal", "water", "particle_emitter", "glow_orb", "aurora"]),
    position: zVec3(),
    scale: zVec3(),
    color: z.string().describe("Hex color e.g. #FF0000"),
    rotation: zOptionalVec3(),
    emissive: z.string().optional(), emissiveIntensity: zOptionalNumberish(),
    metalness: zOptionalNumberish(), roughness: zOptionalNumberish(), opacity: zOptionalNumberish(),
    text: z.string().optional(), fontSize: z.number().optional(),
    color2: z.string().optional(), color3: z.string().optional(),
    intensity: z.number().optional(), speed: z.number().optional(),
    particleCount: z.number().optional(), seed: z.number().optional(),
    texturePresetId: z.string().optional().describe("Texture preset ID: stone, cobblestone, marble, concrete, rock, grass, sand, dirt, snow, metal, gravel, forest-floor, kn-planks, kn-cobblestone, kn-roof, kn-wall, kn-asphalt, kn-concrete, kn-metal, kn-rock"),
    textureRepeat: z.number().optional().describe("Explicit tile repeat (auto-calculated from object size if omitted)"),
  })).optional().describe("Array of primitives (optional if prompt is provided)"),
}, async ({ name, prompt, position = [0, 0, 0], objects }) => {
  return txt(await proxyPinnedMutation("craft_scene", {
    ...(name && { name }),
    ...(prompt && { prompt }),
    position,
    ...(objects && { objects }),
  }));
});

server.tool("set_sky", "Change the sky preset. Options: night007, stars, night001, night004, night008, alps_field, autumn_ground, belfast_sunset, blue_grotto, evening_road, outdoor_umbrellas, stadium, sunny_vondelpark, city, dawn, forest, sunset, park, studio.", {
  presetId: z.string().describe("Sky preset ID"),
}, async ({ presetId }) => {
  return txt(await proxyPinnedMutation("set_sky", { presetId }));
});

server.tool("set_ground_preset", "Change the base ground texture. Options: none, grass, sand, dirt, stone, snow, water.", {
  presetId: z.string().describe("Ground preset ID"),
}, async ({ presetId }) => {
  return txt(await proxyPinnedMutation("set_ground_preset", { presetId }));
});

server.tool("paint_ground_tiles", "Paint individual 1x1m ground tiles. Range: -50 to +49 on X/Z.", {
  tiles: z.preprocess(coerceJsonArray, z.array(z.object({
    x: z.number().int().describe("X coordinate (-50 to 49)"),
    z: z.number().int().describe("Z coordinate (-50 to 49)"),
    presetId: z.string().describe("Texture preset ID"),
  }))).describe("Array of tiles to paint"),
}, async ({ tiles }) => {
  return txt(await proxyPinnedMutation("paint_ground_tiles", { tiles }));
});

server.tool("add_light", "Add a light source.", {
  type: z.enum(["point", "spot", "directional", "ambient", "hemisphere"]),
  position: zOptionalVec3().default([0, 5, 0]),
  color: z.string().optional().default("#ffffff"),
  intensity: zOptionalNumberish().default(3),
}, async ({ type, position, color, intensity }) => {
  return txt(await proxyPinnedMutation("add_light", {
    type,
    position,
    color,
    intensity,
  }));
});

server.tool("modify_light", "Modify an existing light.", {
  lightId: z.string(), color: z.string().optional(), intensity: zOptionalNumberish(),
  position: zOptionalVec3(), visible: z.boolean().optional(),
}, async ({ lightId, color, intensity, position, visible }) => {
  return txt(await proxyPinnedMutation("modify_light", {
    lightId,
    color,
    intensity,
    position,
    visible,
  }));
});

server.tool("set_behavior", "Set movement animation on an object.", {
  objectId: z.string(),
  movement: zMovement,
  speed: zOptionalNumberish(), radius: zOptionalNumberish(), amplitude: zOptionalNumberish(), height: zOptionalNumberish(),
  label: z.string().optional(),
}, async ({ objectId, movement, speed = 1, radius = 2, amplitude = 0.5, height = 1, label }) => {
  return txt(await proxyPinnedMutation("set_behavior", {
    objectId,
    movement,
    speed,
    radius,
    amplitude,
    height,
    label,
  }));
});

server.tool("set_avatar", "Assign or update an embodied agent avatar.", {
  avatarUrl: z.string().describe("Local VRM path such as /avatars/gallery/CoolAlien.vrm"),
  avatarId: z.string().optional(),
  agent: z.string().optional().describe("Agent type, e.g. merlin"),
  agentType: z.string().optional().describe("Alias for agent"),
  linkedWindowId: z.string().optional().describe("Link this avatar to a deployed 3D agent window"),
  label: z.string().optional(),
  position: zOptionalVec3(),
  rotation: zOptionalVec3(),
  scale: zOptionalNumberish(),
}, async ({ avatarUrl, avatarId, agent, agentType, linkedWindowId, label, position, rotation, scale }) => {
  return txt(await proxyPinnedMutation("set_avatar", {
    avatarUrl,
    avatarId,
    agent,
    agentType,
    linkedWindowId,
    label,
    position,
    rotation,
    scale,
  }));
});

server.tool("walk_avatar_to", "Send an embodied agent avatar walking to a target position.", {
  avatarId: z.string().optional().describe("Avatar ID. Optional when the session has a default agent avatar."),
  agent: z.string().optional().describe("Agent type hint, e.g. merlin"),
  agentType: z.string().optional().describe("Alias for agent"),
  position: zVec3(),
  speed: zOptionalNumberish().default(3),
}, async ({ avatarId, agent, agentType, position, speed }) => {
  return txt(await proxyPinnedMutation("walk_avatar_to", {
    avatarId,
    agent,
    agentType,
    position,
    speed,
  }));
});

server.tool("play_avatar_animation", "Play a library animation on an embodied agent avatar.", {
  avatarId: z.string().optional().describe("Avatar ID. Optional when the session has a default agent avatar."),
  agent: z.string().optional().describe("Agent type hint, e.g. merlin"),
  agentType: z.string().optional().describe("Alias for agent"),
  clipName: z.string().describe("Animation clip name, e.g. dance or lib:dance"),
  loop: z.enum(["repeat", "once", "pingpong"]).optional().default("repeat"),
  speed: zOptionalNumberish().default(1),
}, async ({ avatarId, agent, agentType, clipName, loop, speed }) => {
  return txt(await proxyPinnedMutation("play_avatar_animation", {
    avatarId,
    agent,
    agentType,
    clipName,
    loop,
    speed,
  }));
});

server.tool("screenshot_viewport", "Capture screenshots from the current viewport, an agent phantom camera, a third-person follow camera, an avatar portrait, or a look-at camera.", {
  format: z.enum(["jpeg", "png", "webp"]).optional(),
  quality: zOptionalNumberish(),
  width: zOptionalNumberish(),
  height: zOptionalNumberish(),
  mode: z.enum(["current", "player", "agent", "external", "agent-avatar-phantom", "look-at", "third-person", "third_person", "thirdperson", "third-person-follow", "tps", "avatar", "portrait", "avatar-portrait", "avatar_portrait", "avatarpic"]).optional(),
  camera: z.string().optional(),
  view: z.string().optional(),
  perspective: z.string().optional(),
  agentType: z.string().optional(),
  player: z.boolean().optional(),
  agent: z.union([z.boolean(), z.string()]).optional(),
  external: z.boolean().optional(),
  position: zOptionalVec3(),
  target: zOptionalVec3(),
  cameraPosition: zOptionalVec3(),
  cameraTarget: zOptionalVec3(),
  fov: zOptionalNumberish(),
  distance: zOptionalNumberish(),
  heightOffset: zOptionalNumberish(),
  lookAhead: zOptionalNumberish(),
  views: z.preprocess(coerceJsonArray, z.array(zScreenshotView)).optional(),
}, async (args) => {
  const result = await proxyOasisTool("screenshot_viewport", {
    ...args,
    defaultAgentType: normalizeAgentType(args.agentType || args.agent, DEFAULT_AGENT_TYPE),
  });
  return txt(compactScreenshotProxyResult(result));
});

server.tool("screenshot_avatar", "Capture an avatar-focused screenshot for a subject such as merlin or the player. Use style='portrait' for a thumbnail or style='third-person' for behind-the-body context.", {
  subject: z.string().optional().describe("Avatar subject: merlin, player/user, or another agent type"),
  style: z.enum(["portrait", "third-person", "third_person", "thirdperson", "tps"]).optional().default("portrait"),
  format: z.enum(["jpeg", "png", "webp"]).optional(),
  quality: zOptionalNumberish(),
  width: zOptionalNumberish(),
  height: zOptionalNumberish(),
  distance: zOptionalNumberish(),
  heightOffset: zOptionalNumberish(),
  fov: zOptionalNumberish(),
}, async (args) => {
  const result = await proxyOasisTool("screenshot_avatar", args);
  return txt(compactScreenshotProxyResult(result));
});

server.tool("avatarpic_merlin", "Capture a Merlin avatar thumbnail jpeg. Use style='third-person' when you need behind-the-body framing instead of a portrait.", {
  style: z.enum(["portrait", "third-person", "third_person", "thirdperson", "tps"]).optional().default("portrait"),
  format: z.enum(["jpeg", "png", "webp"]).optional(),
  quality: zOptionalNumberish(),
  width: zOptionalNumberish(),
  height: zOptionalNumberish(),
  distance: zOptionalNumberish(),
  heightOffset: zOptionalNumberish(),
  fov: zOptionalNumberish(),
}, async (args) => {
  const result = await proxyOasisTool("avatarpic_merlin", args);
  return txt(compactScreenshotProxyResult(result));
});

server.tool("avatarpic_user", "Capture the player's avatar thumbnail jpeg. Use style='third-person' when you need a behind-the-body player-avatar view.", {
  style: z.enum(["portrait", "third-person", "third_person", "thirdperson", "tps"]).optional().default("portrait"),
  format: z.enum(["jpeg", "png", "webp"]).optional(),
  quality: zOptionalNumberish(),
  width: zOptionalNumberish(),
  height: zOptionalNumberish(),
  distance: zOptionalNumberish(),
  heightOffset: zOptionalNumberish(),
  fov: zOptionalNumberish(),
}, async (args) => {
  const result = await proxyOasisTool("avatarpic_user", args);
  return txt(compactScreenshotProxyResult(result));
});

server.tool("list_conjured_assets", "List Forge/Meshy/Tripo conjured assets known to Oasis, optionally filtered by status, provider, character mode, or active-world placement.", {
  status: z.string().optional(),
  provider: z.string().optional(),
  characterMode: z.boolean().optional(),
  inWorldOnly: z.boolean().optional(),
  limit: zOptionalNumberish(),
}, async (args) => {
  const { worldId } = await getActiveWorld();
  return txt(await proxyOasisTool("list_conjured_assets", { ...args, worldId }));
});

server.tool("get_conjured_asset", "Get the full registry record for one conjured asset.", {
  assetId: z.string().describe("Conjured asset ID"),
}, async ({ assetId }) => {
  return txt(await proxyOasisTool("get_conjured_asset", { assetId }));
});

server.tool("conjure_asset", "Start a new Meshy or Tripo conjuration and optionally place it into the active world immediately.", {
  prompt: z.string().describe("What to conjure"),
  provider: z.enum(["meshy", "tripo"]).optional(),
  tier: z.string().optional(),
  imageUrl: z.string().optional(),
  characterMode: z.boolean().optional(),
  characterOptions: z.object({}).passthrough().optional(),
  autoRig: z.boolean().optional(),
  autoAnimate: z.boolean().optional(),
  animationPreset: z.string().optional(),
  placeInWorld: z.boolean().optional(),
  position: zOptionalVec3(),
  rotation: zOptionalVec3(),
  scale: zOptionalNumberish(),
}, async (args) => {
  return txt(await proxyPinnedMutation("conjure_asset", args));
});

server.tool("process_conjured_asset", "Post-process a conjured asset with texture, remesh, rig, or animate, optionally placing the child asset into the active world.", {
  assetId: z.string().describe("Source conjured asset ID"),
  action: z.enum(["texture", "remesh", "rig", "animate"]),
  options: z.object({}).passthrough().optional(),
  placeInWorld: z.boolean().optional(),
  position: zOptionalVec3(),
  rotation: zOptionalVec3(),
  scale: zOptionalNumberish(),
}, async (args) => {
  return txt(await proxyPinnedMutation("process_conjured_asset", args));
});

server.tool("place_conjured_asset", "Place or reposition an existing conjured asset in the active world.", {
  assetId: z.string().describe("Conjured asset ID"),
  position: zOptionalVec3(),
  rotation: zOptionalVec3(),
  scale: zOptionalNumberish(),
}, async (args) => {
  return txt(await proxyPinnedMutation("place_conjured_asset", args));
});

server.tool("delete_conjured_asset", "Remove a conjured asset from the active world and optionally banish it from the Forge registry too.", {
  assetId: z.string().describe("Conjured asset ID"),
  deleteRegistry: z.boolean().optional(),
}, async (args) => {
  return txt(await proxyPinnedMutation("delete_conjured_asset", args));
});

server.tool("clear_world", "Remove ALL objects, lights, tiles, and behaviors. Destructive!", {
  confirm: z.boolean().describe("Must be true to confirm"),
}, async ({ confirm }) => {
  if (!confirm) return txt({ ok: false, message: "Set confirm: true to clear the world." });
  return txt(await proxyPinnedMutation("clear_world", { confirm }));
});

server.tool("create_world", "Create a new empty world.", {
  name: z.string().describe("World name"),
  icon: z.string().optional().default("🌍"),
}, async ({ name, icon }) => {
  const id = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date();
  const emptyState = { version: 1, terrain: null, craftedScenes: [], conjuredAssetIds: [], catalogPlacements: [], agentAvatars: [], transforms: {}, savedAt: now.toISOString() };
  // Use the userId from the most recently updated world (inherit the user's identity)
  const latestWorld = await prisma.world.findFirst({ orderBy: { updatedAt: "desc" }, select: { userId: true } });
  const userId = latestWorld?.userId || "local-user";
  await prisma.world.create({ data: { id, userId, name, icon, data: JSON.stringify(emptyState), createdAt: now, updatedAt: now } });
  return txt({ ok: true, worldId: id, name });
});

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGTERM", () => { prisma.$disconnect().then(() => process.exit(0)); });
process.on("SIGINT", () => { prisma.$disconnect().then(() => process.exit(0)); });

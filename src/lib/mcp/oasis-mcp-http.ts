import 'server-only'

import { randomUUID } from 'crypto'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

import { callTool } from '@/lib/mcp/oasis-tools'

const zVec3Like = z.union([
  z.string(),
  z.array(z.number()).length(3),
  z.tuple([z.number(), z.number(), z.number()]),
])

const zLooseObject = z.object({}).passthrough()
const zLooseArrayOrString = z.union([z.array(zLooseObject), z.string()])

type OasisMcpToolSpec = {
  name: string
  description: string
  inputSchema?: z.ZodTypeAny
}

const TOOL_SPECS: OasisMcpToolSpec[] = [
  { name: 'get_world_state', description: 'Get the full active world state, including catalog objects, crafted scenes, lights, agent avatars, live player avatar/camera context, behaviors, and placed conjured assets.', inputSchema: z.object({ worldId: z.string().optional() }).passthrough() },
  { name: 'get_world_info', description: 'Get a fast summary of the active world: name, object count, sky, ground, tiles, and lights.', inputSchema: z.object({ worldId: z.string().optional() }).passthrough() },
  { name: 'query_objects', description: 'Search objects already in the world by keyword, type, or proximity.', inputSchema: z.object({ worldId: z.string().optional(), query: z.string().optional(), near: zVec3Like.optional(), radius: z.number().optional(), type: z.string().optional() }).passthrough() },
  { name: 'search_assets', description: 'Search the Oasis asset catalog by keyword. Use this before place_object when you need the exact asset ID.', inputSchema: z.object({ query: z.string(), category: z.string().optional(), limit: z.number().optional() }).passthrough() },
  { name: 'get_asset_catalog', description: 'Get the full asset catalog grouped by category.', inputSchema: z.object({}).passthrough() },
  { name: 'list_worlds', description: 'List all saved Oasis worlds.', inputSchema: z.object({}).passthrough() },
  { name: 'load_world', description: 'Switch the active world or load a specific world by ID.', inputSchema: z.object({ worldId: z.string() }).passthrough() },
  { name: 'create_world', description: 'Create a new empty world.', inputSchema: z.object({ name: z.string(), icon: z.string().optional() }).passthrough() },
  { name: 'clear_world', description: 'Remove all objects, lights, tiles, behaviors, and avatars from a world.', inputSchema: z.object({ worldId: z.string().optional() }).passthrough() },
  { name: 'place_object', description: 'Place a catalog asset into the world at a position, rotation, and scale.', inputSchema: z.object({ worldId: z.string().optional(), catalogId: z.string(), position: zVec3Like.optional(), rotation: zVec3Like.optional(), scale: z.union([z.number(), z.string()]).optional(), label: z.string().optional() }).passthrough() },
  { name: 'modify_object', description: 'Modify an existing object in the world: transform, visibility, label, behavior, or metadata.', inputSchema: z.object({ worldId: z.string().optional(), objectId: z.string(), position: zVec3Like.optional(), rotation: zVec3Like.optional(), scale: z.union([z.number(), z.string(), zVec3Like]).optional() }).passthrough() },
  { name: 'remove_object', description: 'Remove a world object by ID.', inputSchema: z.object({ worldId: z.string().optional(), objectId: z.string() }).passthrough() },
  { name: 'craft_scene', description: 'Create stunning procedural geometry scenes. RECOMMENDED: provide "prompt" (text description) and the system will use an LLM sculptor to design a beautiful scene with shader effects (animated flames, waving flags, glowing crystals, water, particle emitters, aurora curtains, glow orbs). Alternative: provide "objects" array with raw primitives directly.', inputSchema: z.object({ worldId: z.string().optional(), name: z.string().optional(), prompt: z.string().optional().describe('Text description of what to craft — the LLM sculptor will design the full scene. E.g. "a medieval watchtower with flame torches and a crystal energy source"'), position: zVec3Like.optional(), objects: z.union([z.array(zLooseObject), z.string()]).optional() }).passthrough() },
  { name: 'set_sky', description: 'Change the world sky preset.', inputSchema: z.object({ worldId: z.string().optional(), presetId: z.string() }).passthrough() },
  { name: 'set_ground_preset', description: 'Change the world ground preset.', inputSchema: z.object({ worldId: z.string().optional(), presetId: z.string() }).passthrough() },
  { name: 'paint_ground_tiles', description: 'Paint individual 1x1m ground tiles using a presetId. tiles may be an array or JSON string.', inputSchema: z.object({ worldId: z.string().optional(), presetId: z.string().optional(), tiles: z.union([z.array(zLooseObject), z.string()]) }).passthrough() },
  { name: 'add_light', description: 'Add a world light source.', inputSchema: z.object({ worldId: z.string().optional(), type: z.string(), position: zVec3Like.optional(), color: z.string().optional(), intensity: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'modify_light', description: 'Modify an existing world light.', inputSchema: z.object({ worldId: z.string().optional(), lightId: z.string(), position: zVec3Like.optional(), color: z.string().optional(), intensity: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'set_behavior', description: 'Set object movement or animation behavior such as static, spin, hover, orbit, bounce, or patrol.', inputSchema: z.object({ worldId: z.string().optional(), objectId: z.string(), movement: z.string().optional(), speed: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'set_avatar', description: 'Create or update an embodied agent avatar in the world.', inputSchema: z.object({ worldId: z.string().optional(), agentType: z.string().optional(), avatarId: z.string().optional(), linkedWindowId: z.string().optional(), avatar3dUrl: z.string().optional(), position: zVec3Like.optional(), rotation: zVec3Like.optional(), scale: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'walk_avatar_to', description: 'Send an embodied agent avatar walking to a target position.', inputSchema: z.object({ worldId: z.string().optional(), agentType: z.string().optional(), avatarId: z.string().optional(), position: zVec3Like, speed: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'play_avatar_animation', description: 'Play a library animation on an embodied agent avatar.', inputSchema: z.object({ worldId: z.string().optional(), agentType: z.string().optional(), avatarId: z.string().optional(), animationId: z.string().optional(), animation: z.string().optional(), loop: z.boolean().optional(), durationMs: z.number().optional() }).passthrough() },
  { name: 'screenshot_viewport', description: 'Capture screenshots from the current viewport, player camera, agent phantom camera, third-person follow camera, external overview, or explicit look-at camera. Use views as an array for multi-angle capture.', inputSchema: z.object({ format: z.string().optional(), quality: z.union([z.number(), z.string()]).optional(), width: z.union([z.number(), z.string()]).optional(), height: z.union([z.number(), z.string()]).optional(), views: zLooseArrayOrString.optional(), mode: z.string().optional(), agentType: z.string().optional(), position: zVec3Like.optional(), target: zVec3Like.optional(), cameraPosition: zVec3Like.optional(), cameraTarget: zVec3Like.optional() }).passthrough() },
  { name: 'screenshot_avatar', description: 'Capture an avatar-focused screenshot for a subject such as merlin or player. Use style=portrait for a thumbnail or style=third-person for behind-the-body context.', inputSchema: z.object({ subject: z.string().optional(), style: z.string().optional(), width: z.union([z.number(), z.string()]).optional(), height: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'avatarpic_merlin', description: 'Capture Merlin avatar imagery, optionally in third-person mode.', inputSchema: z.object({ style: z.string().optional(), width: z.union([z.number(), z.string()]).optional(), height: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'avatarpic_user', description: 'Capture player avatar imagery, optionally in third-person mode.', inputSchema: z.object({ style: z.string().optional(), width: z.union([z.number(), z.string()]).optional(), height: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'list_conjured_assets', description: 'List Forge/Meshy/Tripo conjured assets known to Oasis, optionally filtered by status, provider, characterMode, or placement in the active world.', inputSchema: z.object({ worldId: z.string().optional(), status: z.string().optional(), provider: z.string().optional(), characterMode: z.boolean().optional(), inWorldOnly: z.boolean().optional(), limit: z.number().optional() }).passthrough() },
  { name: 'get_conjured_asset', description: 'Get the full registry record for one conjured asset.', inputSchema: z.object({ assetId: z.string() }).passthrough() },
  { name: 'conjure_asset', description: 'Start a new Meshy or Tripo conjuration, optionally place it into the active world immediately, and track it as it generates.', inputSchema: z.object({ worldId: z.string().optional(), prompt: z.string(), provider: z.string().optional(), tier: z.string().optional(), imageUrl: z.string().optional(), characterMode: z.boolean().optional(), characterOptions: zLooseObject.optional(), autoRig: z.boolean().optional(), autoAnimate: z.boolean().optional(), animationPreset: z.string().optional(), placeInWorld: z.boolean().optional(), position: zVec3Like.optional(), rotation: zVec3Like.optional(), scale: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'process_conjured_asset', description: 'Post-process an existing conjured asset with texture, remesh, rig, or animate, optionally placing the child asset into the active world.', inputSchema: z.object({ worldId: z.string().optional(), assetId: z.string(), action: z.string(), options: zLooseObject.optional(), placeInWorld: z.boolean().optional(), position: zVec3Like.optional(), rotation: zVec3Like.optional(), scale: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'place_conjured_asset', description: 'Place or reposition an existing conjured asset in the active world.', inputSchema: z.object({ worldId: z.string().optional(), assetId: z.string(), position: zVec3Like.optional(), rotation: zVec3Like.optional(), scale: z.union([z.number(), z.string()]).optional() }).passthrough() },
  { name: 'delete_conjured_asset', description: 'Remove a conjured asset from the active world and optionally banish it from the Forge registry too.', inputSchema: z.object({ worldId: z.string().optional(), assetId: z.string(), deleteRegistry: z.boolean().optional() }).passthrough() },
]

function formatToolResult(result: Awaited<ReturnType<typeof callTool>>) {
  const structuredContent: Record<string, unknown> = {
    ok: result.ok,
    message: result.message,
  }
  if (result.data !== undefined) {
    structuredContent.data = result.data as unknown
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent,
    isError: !result.ok,
  }
}

export function createOasisMcpServer() {
  const server = new McpServer(
    { name: 'oasis-http-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions: [
        'Oasis is a world-aware MCP server for building, editing, viewing, and navigating Oasis worlds.',
        'Use get_world_state first when you need rich context.',
        'Use screenshot_viewport and avatar screenshot tools for visual grounding when a live Oasis browser is connected.',
        'Conjured assets can be created with conjure_asset, processed, placed, and deleted through this same server.',
      ].join(' '),
    },
  )

  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      {
        title: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      },
      async (args) => formatToolResult(await callTool(spec.name, (args || {}) as Record<string, unknown>)),
    )
  }

  return server
}

export type OasisHttpMcpSession = {
  server: McpServer
  transport: WebStandardStreamableHTTPServerTransport
  createdAt: number
  lastSeenAt: number
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000

function getSessionStore() {
  const globalState = globalThis as typeof globalThis & {
    __oasisHttpMcpSessions?: Map<string, OasisHttpMcpSession>
  }
  if (!globalState.__oasisHttpMcpSessions) {
    globalState.__oasisHttpMcpSessions = new Map()
  }
  return globalState.__oasisHttpMcpSessions
}

export function getOasisHttpMcpSession(sessionId: string | null | undefined) {
  if (!sessionId) return null
  return getSessionStore().get(sessionId) || null
}

export function pruneOasisHttpMcpSessions() {
  const sessions = getSessionStore()
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [sessionId, entry] of sessions.entries()) {
    if (entry.lastSeenAt >= cutoff) continue
    void entry.transport.close().catch(() => {})
    void entry.server.close().catch(() => {})
    sessions.delete(sessionId)
  }
}

export async function createOasisHttpMcpSession() {
  const server = createOasisMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return { server, transport }
}

export function rememberOasisHttpMcpSession(sessionId: string, session: OasisHttpMcpSession) {
  getSessionStore().set(sessionId, session)
}

export async function disposeOasisHttpMcpSession(sessionId: string | null | undefined) {
  if (!sessionId) return
  const sessions = getSessionStore()
  const entry = sessions.get(sessionId)
  if (!entry) return
  sessions.delete(sessionId)
  await Promise.allSettled([
    entry.transport.close(),
    entry.server.close(),
  ])
}

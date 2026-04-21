import { z } from 'zod'

const zVec3Like = z.union([
  z.string(),
  z.array(z.number()).min(3).max(3),
])

const zLooseObject = z.object({}).passthrough()
const zLooseArrayOrString = z.union([z.array(zLooseObject), z.string()])
const zNumberish = z.union([z.number(), z.string()])
const zLoopMode = z.union([z.enum(['repeat', 'once', 'pingpong']), z.boolean()])

function validString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function normalizeLoopMode(value) {
  if (value === true) return 'repeat'
  if (value === false) return 'once'
  const loop = validString(value, 'repeat').toLowerCase()
  return loop === 'once' || loop === 'pingpong' ? loop : 'repeat'
}

export const OASIS_MCP_INSTRUCTIONS = [
  'Oasis is a world-aware MCP server for building, editing, viewing, and navigating Oasis worlds.',
  'Use get_world_state first when you need rich context.',
  'Use screenshot_viewport and avatar screenshot tools for visual grounding when a live Oasis browser is connected.',
  'Avatar and world mutations may execute as embodied sequences rather than instantaneous teleports, so allow time for completion.',
  'For Hermes and Merlin, self-crafted craft_scene objects are the default. Call get_craft_guide for the schema and use strategy:"sculptor" only when you intentionally want fallback prompt crafting.',
].join(' ')

export const OASIS_MCP_TOOL_SPECS = [
  {
    name: 'get_world_state',
    description: 'Get the full active world state, including catalog objects, crafted scenes, lights, agent avatars, live player avatar/camera context, behaviors, and placed conjured assets.',
    inputSchema: z.object({ worldId: z.string().optional() }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'get_world_info',
    description: 'Get a fast summary of the active world: name, object count, sky, ground, tiles, and lights.',
    inputSchema: z.object({ worldId: z.string().optional() }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'query_objects',
    description: 'Search objects already in the world by keyword, type, or proximity.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      query: z.string().optional(),
      near: zVec3Like.optional(),
      radius: z.number().optional(),
      type: z.string().optional(),
    }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'search_assets',
    description: 'Search the Oasis asset catalog by keyword. Use this before place_object when you need the exact asset ID.',
    inputSchema: z.object({
      query: z.string(),
      category: z.string().optional(),
      limit: z.number().optional(),
    }).passthrough(),
  },
  {
    name: 'get_asset_catalog',
    description: 'Get the full asset catalog grouped by category.',
    inputSchema: z.object({}).passthrough(),
  },
  {
    name: 'list_worlds',
    description: 'List all saved Oasis worlds.',
    inputSchema: z.object({}).passthrough(),
  },
  {
    name: 'load_world',
    description: 'Load a specific world by ID. In stateless transports, pass worldId on subsequent tool calls too.',
    inputSchema: z.object({ worldId: z.string() }).passthrough(),
  },
  {
    name: 'create_world',
    description: 'Create a new empty world.',
    inputSchema: z.object({ name: z.string(), icon: z.string().optional() }).passthrough(),
  },
  {
    name: 'clear_world',
    description: 'Remove all catalog objects, crafted scenes, conjured placements, lights, tiles, behaviors, and avatars from a world.',
    inputSchema: z.object({ worldId: z.string().optional(), confirm: z.boolean() }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'place_object',
    description: 'Place a catalog asset into the world at a position, rotation, and scale.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      catalogId: z.string().optional(),
      assetId: z.string().optional(),
      position: zVec3Like.optional(),
      rotation: zVec3Like.optional(),
      scale: zNumberish.optional(),
      label: z.string().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'modify_object',
    description: 'Modify an existing object in the world: transform, visibility, label, behavior, or metadata.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      objectId: z.string(),
      position: zVec3Like.optional(),
      rotation: zVec3Like.optional(),
      scale: z.union([z.number(), z.string(), zVec3Like]).optional(),
      label: z.string().optional(),
      visible: z.boolean().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'remove_object',
    description: 'Remove a world object by ID.',
    inputSchema: z.object({ worldId: z.string().optional(), objectId: z.string() }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'craft_scene',
    description: 'Create procedural geometry scenes. For Hermes and Merlin, self-crafted objects are the default. Provide an objects array for direct self-crafting. Use prompt text only when you deliberately set strategy="sculptor". Prompt-mode crafting defaults to cc-opus and may continue asynchronously while primitives appear over time.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      name: z.string().optional(),
      prompt: z.string().optional(),
      position: zVec3Like.optional(),
      objects: z.union([z.array(zLooseObject), z.string()]).optional(),
      model: z.string().optional(),
      waitForCompletion: z.boolean().optional(),
      strategy: z.enum(['agent', 'sculptor']).optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'get_craft_guide',
    description: 'Get the exact self-crafting schema for craft_scene: supported primitive types, animation types, texture presets, required fields, rules, and an example scene.',
    inputSchema: z.object({}).passthrough(),
  },
  {
    name: 'get_craft_job',
    description: 'Check the status of an asynchronous craft_scene job and inspect streamed progress, object counts, and final scene IDs.',
    inputSchema: z.object({ jobId: z.string() }).passthrough(),
  },
  {
    name: 'set_sky',
    description: 'Change the world sky preset.',
    inputSchema: z.object({ worldId: z.string().optional(), presetId: z.string() }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'set_ground_preset',
    description: 'Change the world ground preset.',
    inputSchema: z.object({ worldId: z.string().optional(), presetId: z.string() }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'paint_ground_tiles',
    description: 'Paint individual 1x1m ground tiles using a presetId. tiles may be an array or JSON string.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      presetId: z.string().optional(),
      tiles: z.union([z.array(zLooseObject), z.string()]),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'add_light',
    description: 'Add a world light source.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      type: z.string(),
      position: zVec3Like.optional(),
      color: z.string().optional(),
      intensity: zNumberish.optional(),
      label: z.string().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'modify_light',
    description: 'Modify an existing world light.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      lightId: z.string(),
      position: zVec3Like.optional(),
      color: z.string().optional(),
      intensity: zNumberish.optional(),
      visible: z.boolean().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'set_behavior',
    description: 'Set object movement or animation behavior such as static, spin, hover, orbit, bounce, or patrol.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      objectId: z.string(),
      movement: z.string().optional(),
      speed: zNumberish.optional(),
      radius: zNumberish.optional(),
      amplitude: zNumberish.optional(),
      height: zNumberish.optional(),
      label: z.string().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'set_avatar',
    description: 'Create or update an embodied agent avatar in the world.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      agentType: z.string().optional(),
      agent: z.string().optional(),
      avatarId: z.string().optional(),
      linkedWindowId: z.string().optional(),
      avatarUrl: z.string().optional(),
      avatar3dUrl: z.string().optional(),
      url: z.string().optional(),
      label: z.string().optional(),
      position: zVec3Like.optional(),
      rotation: zVec3Like.optional(),
      scale: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'walk_avatar_to',
    description: 'Send an embodied agent avatar walking to a target position. The visual move can take time before later world mutations should happen.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      agentType: z.string().optional(),
      agent: z.string().optional(),
      avatarId: z.string().optional(),
      position: zVec3Like.optional(),
      target: zVec3Like.optional(),
      speed: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'list_avatar_animations',
    description: 'List the exact avatar animation IDs supported by Oasis. Call this before play_avatar_animation instead of guessing clip names.',
    inputSchema: z.object({
      category: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().optional(),
    }).passthrough(),
  },
  {
    name: 'play_avatar_animation',
    description: 'Play a library animation on an embodied agent avatar. Call list_avatar_animations first and pass an exact clipName. Animations play once by default unless you set loop:"repeat" or loop:"pingpong".',
    inputSchema: z.object({
      worldId: z.string().optional(),
      agentType: z.string().optional(),
      agent: z.string().optional(),
      avatarId: z.string().optional(),
      clipName: z.string().optional(),
      animationId: z.string().optional(),
      animation: z.string().optional(),
      name: z.string().optional(),
      loop: zLoopMode.optional(),
      speed: zNumberish.optional(),
      durationMs: z.number().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'screenshot_viewport',
    description: [
      'Capture screenshots of the 3D world. Six modes, each with its own subject + arg recipe:',
      '• mode:"current" — what the human user literally sees on screen (their camera). No args needed.',
      '• mode:"agent-avatar-phantom" — first-person from an agent\'s eye, looking along their forward vector. Args: agentType (default=caller), heightOffset (1.55), distance (1), lookAhead (5), fov (100). Treat this as "agent FPS".',
      '• mode:"look-at" — free camera. Args: position (camera pos), target (focal point), fov (75). Use when you want an explicit arbitrary camera placement.',
      '• mode:"external-orbit" — distant overview orbiting a subject. Args: target OR agentType (defaults to caller), distance (16), heightOffset (9), fov (60). Good for scene-wide context. Alias: mode:"external".',
      '• mode:"third-person-follow" — over-shoulder behind a subject. Args: agentType (default=caller; pass "player" to follow the user), distance (4.4), heightOffset (2.1), lookAhead (4), fov (72).',
      '• mode:"avatar-portrait" — close headshot of a subject. Args: agentType (default=caller; "player"/"me"/"self" → the user), distance (2.75), heightOffset (1.55), fov (45).',
      'lookAhead = meters ahead of the subject the camera focal point sits (camera POINTS THERE).',
      'Pass views:[{mode,...}, {mode,...}] as an array for multi-angle capture in one call.',
      'IMPORTANT: "player"/"user"/"me"/"self" all mean the human carbondev, NOT the calling agent.',
    ].join('\n'),
    inputSchema: z.object({
      worldId: z.string().optional(),
      format: z.string().optional(),
      quality: zNumberish.optional(),
      width: zNumberish.optional(),
      height: zNumberish.optional(),
      settleMs: z.number().optional(),
      views: zLooseArrayOrString.optional(),
      mode: z.string().describe('current | agent-avatar-phantom | look-at | external-orbit | third-person-follow | avatar-portrait').optional(),
      agentType: z.string().optional(),
      agent: z.string().optional(),
      position: zVec3Like.optional(),
      target: zVec3Like.optional(),
      cameraPosition: zVec3Like.optional(),
      cameraTarget: zVec3Like.optional(),
      distance: zNumberish.optional(),
      heightOffset: zNumberish.optional(),
      lookAhead: zNumberish.optional(),
      fov: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectDefaultAgentType: true,
    injectRequesterAgentType: true,
  },
  {
    name: 'screenshot_avatar',
    description: 'Capture an avatar-focused screenshot for a subject. Valid subjects: "player" (the human user; aliases "user"/"me"/"self"), "merlin", "hermes", "openclaw", "anorak", or any agentType present in the world. Use style:"portrait" for a headshot, style:"third-person" for behind-the-body context. This is for avatar shots specifically — NOT the user camera viewport (that\'s screenshot_viewport mode:"current"). If subject is omitted, falls back to the calling agent.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      subject: z.string().optional(),
      style: z.string().optional(),
      width: zNumberish.optional(),
      height: zNumberish.optional(),
      distance: zNumberish.optional(),
      heightOffset: zNumberish.optional(),
      fov: zNumberish.optional(),
      settleMs: z.number().optional(),
      format: z.string().optional(),
      quality: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectDefaultAgentType: true,
    injectRequesterAgentType: true,
  },
  {
    name: 'avatarpic_merlin',
    description: 'Capture Merlin avatar imagery, optionally in third-person mode.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      style: z.string().optional(),
      width: zNumberish.optional(),
      height: zNumberish.optional(),
      distance: zNumberish.optional(),
      heightOffset: zNumberish.optional(),
      fov: zNumberish.optional(),
      settleMs: z.number().optional(),
      format: z.string().optional(),
      quality: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'avatarpic_user',
    description: 'Capture avatar imagery of the human user (aka player/carbondev/me/self — the person you are talking to, NOT a calling agent). Use style:"portrait" for a headshot, style:"third-person" for full-body context.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      style: z.string().optional(),
      width: zNumberish.optional(),
      height: zNumberish.optional(),
      distance: zNumberish.optional(),
      heightOffset: zNumberish.optional(),
      fov: zNumberish.optional(),
      settleMs: z.number().optional(),
      format: z.string().optional(),
      quality: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'list_conjured_assets',
    description: 'List Forge/Meshy/Tripo conjured assets known to Oasis, optionally filtered by status, provider, characterMode, or placement in the active world.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      status: z.string().optional(),
      provider: z.string().optional(),
      characterMode: z.boolean().optional(),
      inWorldOnly: z.boolean().optional(),
      activeWorldOnly: z.boolean().optional(),
      limit: z.number().optional(),
    }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'get_conjured_asset',
    description: 'Get the full registry record for one conjured asset.',
    inputSchema: z.object({ worldId: z.string().optional(), assetId: z.string() }).passthrough(),
    injectWorldId: true,
  },
  {
    name: 'conjure_asset',
    description: 'Start a new Meshy or Tripo conjuration, optionally place it into the active world immediately, and track it as it generates.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      prompt: z.string(),
      provider: z.string().optional(),
      tier: z.string().optional(),
      imageUrl: z.string().optional(),
      characterMode: z.boolean().optional(),
      characterOptions: zLooseObject.optional(),
      autoRig: z.boolean().optional(),
      autoAnimate: z.boolean().optional(),
      animationPreset: z.string().optional(),
      placeInWorld: z.boolean().optional(),
      position: zVec3Like.optional(),
      rotation: zVec3Like.optional(),
      scale: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'process_conjured_asset',
    description: 'Post-process an existing conjured asset with texture, remesh, rig, or animate, optionally placing the child asset into the active world.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      assetId: z.string(),
      action: z.string(),
      options: zLooseObject.optional(),
      placeInWorld: z.boolean().optional(),
      position: zVec3Like.optional(),
      rotation: zVec3Like.optional(),
      scale: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'place_conjured_asset',
    description: 'Place or reposition an existing conjured asset in the active world.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      assetId: z.string(),
      position: zVec3Like.optional(),
      rotation: zVec3Like.optional(),
      scale: zNumberish.optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
  {
    name: 'delete_conjured_asset',
    description: 'Remove a conjured asset from the active world and optionally banish it from the Forge registry too.',
    inputSchema: z.object({
      worldId: z.string().optional(),
      assetId: z.string(),
      deleteRegistry: z.boolean().optional(),
    }).passthrough(),
    injectWorldId: true,
    injectActorAgentType: true,
  },
]

const TOOL_SPEC_MAP = new Map(OASIS_MCP_TOOL_SPECS.map(spec => [spec.name, spec]))

export function getOasisToolSpec(name) {
  return TOOL_SPEC_MAP.get(name) || null
}

export function prepareOasisToolArgs(name, args = {}, context = {}) {
  const spec = getOasisToolSpec(name)
  const next = args && typeof args === 'object' ? { ...args } : {}
  const worldId = validString(context.worldId)
  const agentType = validString(context.agentType).toLowerCase()

  if (spec?.injectWorldId && worldId && !validString(next.worldId)) {
    next.worldId = worldId
  }
  if (spec?.injectActorAgentType && agentType && !validString(next.actorAgentType)) {
    next.actorAgentType = validString(next.agentType || next.agent, agentType).toLowerCase()
  }
  if (spec?.injectDefaultAgentType && agentType && !validString(next.defaultAgentType)) {
    next.defaultAgentType = validString(next.agentType || next.agent, agentType).toLowerCase()
  }
  if (spec?.injectRequesterAgentType && agentType && !validString(next.requesterAgentType)) {
    next.requesterAgentType = agentType
  }

  if (name === 'place_object' && !validString(next.catalogId) && validString(next.assetId)) {
    next.catalogId = next.assetId
  }

  if (name === 'set_avatar') {
    const avatarUrl = validString(next.avatarUrl || next.avatar3dUrl || next.url)
    if (avatarUrl) next.avatarUrl = avatarUrl
    if (!validString(next.agentType) && validString(next.agent)) {
      next.agentType = validString(next.agent).toLowerCase()
    }
  }

  if (name === 'walk_avatar_to') {
    if (!next.position && next.target) next.position = next.target
    if (!validString(next.agentType) && validString(next.agent)) {
      next.agentType = validString(next.agent).toLowerCase()
    }
  }

  if (name === 'play_avatar_animation') {
    const clipName = validString(next.clipName || next.animationId || next.animation || next.name)
    if (clipName) next.clipName = clipName
    if (!validString(next.agentType) && validString(next.agent)) {
      next.agentType = validString(next.agent).toLowerCase()
    }
    if (next.loop !== undefined) {
      next.loop = normalizeLoopMode(next.loop)
    }
  }

  if (name === 'list_conjured_assets' && next.inWorldOnly === undefined && next.activeWorldOnly !== undefined) {
    next.inWorldOnly = next.activeWorldOnly
  }

  return next
}

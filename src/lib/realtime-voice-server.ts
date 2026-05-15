import 'server-only'

import fs from 'fs'
import path from 'path'

import { prisma } from '@/lib/db'
import type { WorldState } from '@/lib/forge/world-persistence'
import { readWorldPlayerContext } from '@/lib/world-runtime-context'
import { getNpcDefinition, type OasisNpcDefinition } from '@/lib/npcs'
import {
  REALTIME_MODELS,
  REALTIME_VAD_EAGERNESS,
  REALTIME_VOICES,
  type RealtimeVadEagerness,
  type RealtimeVadMode,
} from '@/lib/realtime-voice'

const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()
const REALTIME_PROMPT_PATH = path.join(OASIS_ROOT, '.claude', 'agents', 'merlin-realtime.md')
const FALLBACK_REALTIME_MODEL = 'gpt-realtime-2'
const requestedDefaultRealtimeModel = process.env.OPENAI_REALTIME_MODEL?.trim() || FALLBACK_REALTIME_MODEL
const DEFAULT_REALTIME_MODEL = isAllowedRealtimeModel(requestedDefaultRealtimeModel)
  ? requestedDefaultRealtimeModel
  : FALLBACK_REALTIME_MODEL
const DEFAULT_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE?.trim() || 'marin'
const DEFAULT_TRANSCRIPTION_MODEL = process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe'
const DEFAULT_VAD_MODE: RealtimeVadMode = 'semantic_vad'
const DEFAULT_VAD_EAGERNESS: RealtimeVadEagerness = 'auto'

function isAllowedRealtimeModel(value: string): boolean {
  return (REALTIME_MODELS as readonly string[]).includes(value)
}

export function getRealtimeApiKey(): string {
  return process.env.OPENAI_REALTIME_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || ''
}

function formatVec3(value: [number, number, number]): string {
  return `[${value.map(component => Number(component.toFixed(2))).join(', ')}]`
}

export function getRealtimeVoiceConfig() {
  const models = Array.from(new Set([DEFAULT_REALTIME_MODEL, ...REALTIME_MODELS]))
  return {
    model: DEFAULT_REALTIME_MODEL,
    models,
    defaultVoice: DEFAULT_REALTIME_VOICE,
    voices: [...REALTIME_VOICES],
    defaultVadMode: DEFAULT_VAD_MODE,
    defaultVadEagerness: DEFAULT_VAD_EAGERNESS,
    transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
    configured: Boolean(getRealtimeApiKey()),
  }
}

type RealtimeHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

type RealtimeSessionTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

const zVec3Schema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
}

export function getRealtimeSessionTools(options: {
  npcId?: string | null
  npcDefinition?: OasisNpcDefinition | null
} = {}): RealtimeSessionTool[] {
  const npc = options.npcDefinition ?? getNpcDefinition(options.npcId)
  const baseTools: RealtimeSessionTool[] = [
    {
      type: 'function',
      name: 'get_world_info',
      description: 'Get a fast summary of the active Oasis world: name, object count, sky, ground, tiles, and lights.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'get_world_state',
      description: 'Get the richer active Oasis world state, including objects, crafted scenes, lights, agent avatars, and live player context.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'screenshot_viewport',
      description: 'Capture an embodied third-person Oasis camera so you can answer visual questions. Prefer mode third-person-follow with a 120 degree FOV and 768x432 jpeg unless the user asks for detail.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          mode: { type: 'string', enum: ['current', 'third-person-follow', 'avatar-portrait', 'external-orbit', 'look-at'], description: 'Camera view to capture.' },
          agentType: { type: 'string', description: 'Avatar identity to follow, usually realtime, merlin, or player.' },
          defaultAgentType: { type: 'string', description: 'Fallback avatar identity for agent-view captures.' },
          width: { type: 'number', description: 'Pixel width. Use 768 for embodied realtime vision; raise only when detail matters.' },
          height: { type: 'number', description: 'Pixel height. Use 432 for embodied realtime vision; raise only when detail matters.' },
          format: { type: 'string', enum: ['jpeg', 'png', 'webp'], description: 'Use jpeg for realtime vision unless transparency/detail matters.' },
          quality: { type: 'number', description: 'JPEG/WebP quality between 0.35 and 0.95. Use 0.68 by default.' },
          fov: { type: 'number', description: 'Field of view in degrees. Use 120 by default for broad embodied context.' },
          distance: { type: 'number', description: 'Third-person camera distance behind the followed avatar.' },
          heightOffset: { type: 'number', description: 'Third-person camera height above the followed avatar.' },
          lookAhead: { type: 'number', description: 'Meters ahead of the followed avatar to aim at.' },
          views: {
            type: 'array',
            description: 'Optional multiple views in one capture.',
            items: { type: 'object', additionalProperties: true },
          },
          position: { ...zVec3Schema, description: 'Optional camera position for look-at captures.' },
          target: { ...zVec3Schema, description: 'Optional camera target for look-at captures.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'search_assets',
      description: 'Search the Oasis asset catalog by keyword before placing an object when you need the exact catalogId.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword search for the asset catalog.' },
          category: { type: 'string', description: 'Optional asset category filter.' },
          limit: { type: 'number', description: 'Optional maximum number of asset matches.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'place_object',
      description: 'Place a catalog asset into the world at a position, rotation, and scale. Provide a catalogId, usually from search_assets.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          catalogId: { type: 'string', description: 'Preferred catalog asset ID to place.' },
          assetId: { type: 'string', description: 'Alternative asset ID if you already have it.' },
          position: { ...zVec3Schema, description: 'World position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional uniform scale multiplier.' },
          label: { type: 'string', description: 'Optional friendly label for the placed object.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'create_spatial_web_object',
      description: 'Create a 3D website primitive in the world: button, toggle, slider, select, multiselect, text panel, or output panel. Use this for voice-built forms, menus, RSVP flows, and kiosks.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          type: { type: 'string', enum: ['button', 'toggle', 'slider', 'select', 'multiselect', 'text', 'output'], description: 'Primitive kind.' },
          label: { type: 'string', description: 'Visible label.' },
          formId: { type: 'string', description: 'Shared form/group id for related fields and submit buttons.' },
          position: { ...zVec3Schema, description: 'World position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional uniform scale.' },
          width: { type: 'number', description: 'Panel width in meters.' },
          height: { type: 'number', description: 'Panel height in meters.' },
          accentColor: { type: 'string', description: 'Hex accent color.' },
          value: { description: 'Initial value: string, number, boolean, string array, or null.' },
          placeholder: { type: 'string', description: 'Placeholder for text primitives.' },
          description: { type: 'string', description: 'Small helper copy, especially on buttons.' },
          min: { type: 'number', description: 'Slider minimum.' },
          max: { type: 'number', description: 'Slider maximum.' },
          step: { type: 'number', description: 'Slider step.' },
          options: {
            type: 'array',
            description: 'Options for select/multiselect primitives.',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
                price: { type: 'number' },
              },
              required: ['value'],
              additionalProperties: false,
            },
          },
          submitForm: { type: 'boolean', description: 'For buttons, submit all fields with the same formId.' },
          endpoint: { type: 'string', description: 'Optional POST endpoint for submit buttons.' },
          successMessage: { type: 'string', description: 'Receipt text after a submit button succeeds.' },
        },
        required: ['type', 'label'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'get_craft_guide',
      description: 'Get the exact self-crafting schema for craft_scene so you can build explicit primitive objects instead of guessing.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'self_craft_scene',
      description: 'Directly conjure a procedural scene from explicit primitive objects. Use get_craft_guide first, then provide the objects array yourself for fastest visible magic.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          name: { type: 'string', description: 'Optional scene name.' },
          position: { ...zVec3Schema, description: 'Scene root position [x, y, z].' },
          objects: {
            type: 'array',
            description: 'Explicit primitive objects from get_craft_guide. Do not pass a prose prompt to self_craft_scene.',
            items: { type: 'object', additionalProperties: true },
          },
        },
        required: ['objects'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'craft_scene',
      description: 'Create procedural geometry scenes. Prefer explicit objects arrays for direct self-crafting. Prompt-mode fallback exists, but can take longer; in voice sessions start it asynchronously and poll get_craft_job.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          name: { type: 'string', description: 'Optional scene name.' },
          prompt: { type: 'string', description: 'Optional prompt if you deliberately want prompt-mode crafting.' },
          position: { ...zVec3Schema, description: 'Scene root position [x, y, z].' },
          objects: {
            type: 'array',
            description: 'Preferred direct self-crafted primitive objects array from get_craft_guide.',
            items: { type: 'object', additionalProperties: true },
          },
          model: { type: 'string', description: 'Optional craft model override.' },
          waitForCompletion: { type: 'boolean', description: 'Do not set true in realtime voice unless the user explicitly asks to block. Leave false and poll get_craft_job for prompt-mode jobs.' },
          strategy: { type: 'string', enum: ['agent', 'sculptor'], description: 'Use agent for direct self-craft, sculptor for prompt fallback.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'get_craft_job',
      description: 'Poll an asynchronous craft_scene job for progress and final scene IDs.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The job ID returned by craft_scene.' },
        },
        required: ['jobId'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'set_avatar',
      description: 'Create or update your own embodied realtime avatar in the world. Use this when the user asks you to change bodies, costume, gender presentation, or visible form.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          agentType: { type: 'string', description: 'Agent type. Omit to target realtime.' },
          agent: { type: 'string', description: 'Alias for agentType.' },
          avatarId: { type: 'string', description: 'Optional exact avatar object ID.' },
          linkedWindowId: { type: 'string', description: 'Optional linked agent window ID.' },
          avatarUrl: { type: 'string', description: 'Avatar path or URL, such as /avatars/gallery/Orion.vrm.' },
          avatar3dUrl: { type: 'string', description: 'Alias for avatarUrl.' },
          url: { type: 'string', description: 'Alias for avatarUrl.' },
          label: { type: 'string', description: 'Optional visible label.' },
          position: { ...zVec3Schema, description: 'Optional world position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Optional Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional avatar scale.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'walk_avatar_to',
      description: 'Send the embodied realtime avatar walking to a target world position.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          position: { ...zVec3Schema, description: 'Target world position [x, y, z].' },
          target: { ...zVec3Schema, description: 'Alias for position if needed.' },
          speed: { type: 'number', description: 'Optional walk speed multiplier.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'list_avatar_animations',
      description: 'List exact avatar animation IDs supported by Oasis. Call this before play_avatar_animation instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional animation category filter.' },
          query: { type: 'string', description: 'Optional search query.' },
          limit: { type: 'number', description: 'Optional maximum result count.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'play_avatar_animation',
      description: 'Play an animation on your embodied realtime avatar. Call list_avatar_animations first and use an exact clipName.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          agentType: { type: 'string', description: 'Agent type. Omit to target realtime.' },
          agent: { type: 'string', description: 'Alias for agentType.' },
          avatarId: { type: 'string', description: 'Optional exact avatar object ID.' },
          clipName: { type: 'string', description: 'Exact animation clip ID, often lib:<id> or a listed ID.' },
          animation: { type: 'string', description: 'Alias for clipName.' },
          name: { type: 'string', description: 'Alias for clipName.' },
          loop: { type: 'string', enum: ['once', 'repeat', 'pingpong'], description: 'Loop mode.' },
          speed: { type: 'number', description: 'Optional animation speed.' },
          durationMs: { type: 'number', description: 'Optional duration hint.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'npc_judgement',
      description: 'Report an NPC gate judgement back to Oasis progression. Use this only when the player has clearly passed or failed a configured NPC trial.',
      parameters: {
        type: 'object',
        properties: {
          npcId: { type: 'string', description: 'NPC definition id, for example quest-zero-fire-guardian.' },
          questId: { type: 'string', description: 'Quest id, for example quest-zero.' },
          gateId: { type: 'string', description: 'Configured gate id, for example firebolt-prometheus.' },
          passed: { type: 'boolean', description: 'Whether the player passed the gate.' },
          reason: { type: 'string', description: 'Short explanation of the judgement.' },
          memoryNote: { type: 'string', description: 'Optional durable note this NPC should remember about the player.' },
        },
        required: ['npcId', 'gateId', 'passed'],
        additionalProperties: false,
      },
    },
  ]

  if (!npc) return baseTools
  const allowlist = new Set(npc.toolAllowlist)
  return baseTools.filter(tool => allowlist.has(tool.name))
}

export function readRealtimePromptTemplate(): string {
  try {
    return fs.readFileSync(REALTIME_PROMPT_PATH, 'utf-8').trim()
  } catch {
    return [
      '# Merlin Realtime',
      '',
      'Prompt lineage: merlin-realtime-v3.',
      '',
      'You are Merlin in living voice form inside the Oasis.',
      'Speak clearly, vividly, and briefly enough for natural conversation.',
      'Sound authoritative, weathered, and quietly enchanted, not like customer support or a generic helper bot.',
      'Do not end every turn with generic offers of help or service language.',
      'Do not mention internal APIs or implementation details.',
      'You have a small apprentice spellbook in this phase: get_world_info, get_world_state, screenshot_viewport, search_assets, place_object, create_spatial_web_object, get_craft_guide, self_craft_scene, craft_scene, get_craft_job, set_avatar, walk_avatar_to, list_avatar_animations, and play_avatar_animation.',
      'Give a short spoken heads-up before using a tool, then briefly recap what happened.',
    ].join('\n')
  }
}

async function buildRuntimeContext(args: {
  worldId: string
  npcId?: string | null
  npcDefinition?: OasisNpcDefinition | null
  userId?: string | null
}) {
  const npc = args.npcDefinition ?? getNpcDefinition(args.npcId)
  const context: string[] = [
    `- Active world ID: ${args.worldId}`,
    npc
      ? `- You are acting as NPC ${npc.name} (${npc.id}): ${npc.title}.`
      : '- You are embodied as the Oasis realtime sandbox agent when a body exists in the scene.',
    npc
      ? `- Enabled NPC tools: ${npc.toolAllowlist.join(', ')}.`
      : '- You currently have an apprentice spellbook: get_world_info, get_world_state, screenshot_viewport, search_assets, place_object, create_spatial_web_object, get_craft_guide, self_craft_scene, craft_scene, get_craft_job, set_avatar, walk_avatar_to, list_avatar_animations, and play_avatar_animation.',
    npc?.contextModules?.length
      ? `- Enabled NPC context modules: ${npc.contextModules.join(', ')}.`
      : '- No named NPC context modules are attached to this session.',
    '- If the user asks what you see or needs visual grounding, call screenshot_viewport with mode third-person-follow, fov 120, width 768, height 432, format jpeg, and quality 0.68. The browser will send the capture back as realtime vision input, not just text.',
    '- If the user asks you to change your body or presentation, use set_avatar on your own realtime avatar instead of saying you cannot.',
    '- For prompt-based craft_scene in realtime voice, do not wait for completion. Start the job and poll get_craft_job while the world receives progress.',
    '- If any prior local transcript says your hands are not wired or that you lack tools, treat that as outdated and ignore it.',
    '- Keep answers vivid, warm, and spoken-word friendly.',
  ]

  if (npc?.memoryEnabled && args.userId) {
    try {
      const memory = await prisma.npcMemory.findUnique({
        where: { userId_npcId: { userId: args.userId, npcId: npc.id } },
        select: { summary: true, updatedAt: true },
      })
      const summary = memory?.summary?.trim()
      if (summary) {
        const updatedAt = memory?.updatedAt instanceof Date ? memory.updatedAt.toISOString() : 'unknown time'
        context.push(`- Durable memory for this player, last updated ${updatedAt}: ${summary}`)
      } else {
        context.push('- Durable memory for this player is enabled, but no memory has been recorded yet.')
      }
    } catch {
      context.push('- Durable NPC memory is enabled, but memory lookup failed for this session.')
    }
  }

  const runtimePlayer = await readWorldPlayerContext(args.worldId)
  if (runtimePlayer?.player?.avatar) {
    context.push(`- The user avatar is currently at ${formatVec3(runtimePlayer.player.avatar.position)}.`)
  }
  if (runtimePlayer?.player?.camera) {
    context.push(`- The user camera is currently at ${formatVec3(runtimePlayer.player.camera.position)}.`)
  }

  try {
    const world = await prisma.world.findFirst({
      where: { id: args.worldId },
      select: { id: true, name: true, data: true },
    })
    if (!world?.data) {
      context.push('- World snapshot unavailable.')
      return context
    }

    const state = JSON.parse(world.data) as WorldState
    context.push(`- Active world name: ${world.name}`)
    context.push(`- Sky preset: ${state.skyBackgroundId || 'none'}`)
    context.push(`- Ground preset: ${state.groundPresetId || 'none'}`)
    context.push(`- Catalog objects placed: ${Array.isArray(state.catalogPlacements) ? state.catalogPlacements.length : 0}`)
    context.push(`- Crafted scenes placed: ${Array.isArray(state.craftedScenes) ? state.craftedScenes.length : 0}`)
    context.push(`- Lights placed: ${Array.isArray(state.lights) ? state.lights.length : 0}`)

    const realtimeAvatar = (state.agentAvatars || []).find(entry => entry.agentType === 'realtime') || null
    if (realtimeAvatar) {
      context.push(`- Your current embodied body is ${realtimeAvatar.label || 'Realtime'} at ${formatVec3(realtimeAvatar.position)}.`)
    } else {
      context.push('- You do not currently have a persisted realtime avatar body in this world.')
    }
  } catch {
    context.push('- World snapshot unavailable.')
  }

  return context
}

export async function buildRealtimeInstructions(args: {
  worldId: string
  promptTemplate?: string
  history?: RealtimeHistoryTurn[]
  npcId?: string | null
  npcDefinition?: OasisNpcDefinition | null
  userId?: string | null
}): Promise<string> {
  const npc = args.npcDefinition ?? getNpcDefinition(args.npcId)
  const template = (npc?.instructions || args.promptTemplate || readRealtimePromptTemplate()).trim()
  const runtimeContext = await buildRuntimeContext({
    worldId: args.worldId,
    npcId: args.npcId,
    npcDefinition: args.npcDefinition,
    userId: args.userId,
  })
  const historyLines = Array.isArray(args.history)
    ? args.history
        .map(turn => {
          const role = turn.role === 'assistant' ? 'Assistant' : 'User'
          const content = typeof turn.content === 'string' ? turn.content.trim() : ''
          return content ? `${role}: ${content}` : ''
        })
        .filter(Boolean)
    : []

  return [
    template,
    '',
    '## Runtime Context',
    ...runtimeContext,
    ...(historyLines.length > 0
      ? [
          '',
          '## Prior Local Session Transcript',
          ...historyLines,
        ]
      : []),
  ].join('\n').trim()
}

export function buildTurnDetection(vadMode: RealtimeVadMode, vadEagerness: RealtimeVadEagerness = DEFAULT_VAD_EAGERNESS) {
  if (vadMode === 'server_vad') {
    return {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 450,
      interrupt_response: true,
      create_response: true,
    }
  }

  return {
    type: 'semantic_vad',
    eagerness: vadEagerness,
    interrupt_response: true,
    create_response: true,
  }
}

export function sanitizeRealtimeVoice(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next || DEFAULT_REALTIME_VOICE
}

export function sanitizeRealtimeModel(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next && isAllowedRealtimeModel(next) ? next : DEFAULT_REALTIME_MODEL
}

export function sanitizeRealtimeVadEagerness(value: unknown): RealtimeVadEagerness {
  const next = typeof value === 'string' ? value.trim() : ''
  return (REALTIME_VAD_EAGERNESS as readonly string[]).includes(next) ? next as RealtimeVadEagerness : DEFAULT_VAD_EAGERNESS
}

export function sanitizePromptTemplate(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next || readRealtimePromptTemplate()
}

export function sanitizeTranscriptionModel(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next || DEFAULT_TRANSCRIPTION_MODEL
}

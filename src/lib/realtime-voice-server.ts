import 'server-only'

import fs from 'fs'
import path from 'path'

import { prisma } from '@/lib/db'
import type { WorldState } from '@/lib/forge/world-persistence'
import { readWorldPlayerContext } from '@/lib/world-runtime-context'
import {
  REALTIME_MODELS,
  REALTIME_VAD_EAGERNESS,
  REALTIME_VOICES,
  type RealtimeVadEagerness,
  type RealtimeVadMode,
} from '@/lib/realtime-voice'

const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()
const REALTIME_PROMPT_PATH = path.join(OASIS_ROOT, '.claude', 'agents', 'merlin-realtime.md')
const FALLBACK_REALTIME_MODEL = 'gpt-realtime'
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

export function getRealtimeSessionTools(): RealtimeSessionTool[] {
  return [
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
      name: 'craft_scene',
      description: 'Create procedural geometry scenes. Prefer explicit objects arrays for direct self-crafting. Prompt-mode fallback exists, but can take longer.',
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
          waitForCompletion: { type: 'boolean', description: 'Wait for the craft result before returning.' },
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
  ]
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
      'You have a small apprentice spellbook in this phase: get_world_info, get_world_state, search_assets, place_object, get_craft_guide, craft_scene, get_craft_job, and walk_avatar_to.',
      'Give a short spoken heads-up before using a tool, then briefly recap what happened.',
    ].join('\n')
  }
}

async function buildRuntimeContext(worldId: string) {
  const context: string[] = [
    `- Active world ID: ${worldId}`,
    '- You are embodied as the Oasis realtime sandbox agent when a body exists in the scene.',
    '- You currently have an apprentice spellbook: get_world_info, get_world_state, search_assets, place_object, get_craft_guide, craft_scene, get_craft_job, and walk_avatar_to.',
    '- If any prior local transcript says your hands are not wired or that you lack tools, treat that as outdated and ignore it.',
    '- Keep answers vivid, warm, and spoken-word friendly.',
  ]

  const runtimePlayer = await readWorldPlayerContext(worldId)
  if (runtimePlayer?.player?.avatar) {
    context.push(`- The user avatar is currently at ${formatVec3(runtimePlayer.player.avatar.position)}.`)
  }
  if (runtimePlayer?.player?.camera) {
    context.push(`- The user camera is currently at ${formatVec3(runtimePlayer.player.camera.position)}.`)
  }

  try {
    const world = await prisma.world.findFirst({
      where: { id: worldId },
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
}): Promise<string> {
  const template = (args.promptTemplate || readRealtimePromptTemplate()).trim()
  const runtimeContext = await buildRuntimeContext(args.worldId)
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

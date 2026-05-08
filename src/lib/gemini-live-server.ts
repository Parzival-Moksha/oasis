import 'server-only'

import {
  GEMINI_LIVE_MODELS,
  GEMINI_LIVE_RESPONSE_MODALITIES,
  type GeminiLiveConfigPayload,
  type GeminiLiveFunctionDeclaration,
  type GeminiLiveSessionPayload,
} from '@/lib/gemini-live'

export const GEMINI_LIVE_WEBSOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

export const GEMINI_LIVE_DOCS = {
  overview: 'https://ai.google.dev/gemini-api/docs/live-api',
  websocketReference: 'https://ai.google.dev/api/live',
  tools: 'https://ai.google.dev/gemini-api/docs/live-api/tools',
  ephemeralTokens: 'https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens',
}

const FALLBACK_GEMINI_LIVE_MODEL = GEMINI_LIVE_MODELS[0]
const requestedDefaultGeminiLiveModel = process.env.GEMINI_LIVE_MODEL?.trim() || FALLBACK_GEMINI_LIVE_MODEL
const DEFAULT_GEMINI_LIVE_MODEL = isAllowedGeminiLiveModel(requestedDefaultGeminiLiveModel)
  ? requestedDefaultGeminiLiveModel
  : FALLBACK_GEMINI_LIVE_MODEL

const zVec3Schema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
}

function isAllowedGeminiLiveModel(value: string): boolean {
  return (GEMINI_LIVE_MODELS as readonly string[]).includes(value)
}

export function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || ''
}

export function sanitizeGeminiLiveModel(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next && isAllowedGeminiLiveModel(next) ? next : DEFAULT_GEMINI_LIVE_MODEL
}

export function getGeminiLiveToolDeclarations(): GeminiLiveFunctionDeclaration[] {
  return [
    {
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
      name: 'place_object',
      description: 'Place a catalog asset into the world at a position, rotation, and scale.',
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
      name: 'create_spatial_web_object',
      description: 'Create a 3D website primitive in the world: button, toggle, slider, select, multiselect, text panel, or output panel.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          type: { type: 'string', enum: ['button', 'toggle', 'slider', 'select', 'multiselect', 'text', 'output'] },
          label: { type: 'string', description: 'Visible label.' },
          formId: { type: 'string', description: 'Shared form/group ID for related fields and submit buttons.' },
          position: { ...zVec3Schema, description: 'World position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional uniform scale.' },
          width: { type: 'number', description: 'Panel width in meters.' },
          height: { type: 'number', description: 'Panel height in meters.' },
          accentColor: { type: 'string', description: 'Hex accent color.' },
          visualStyle: {
            type: 'string',
            enum: ['neon-panel', 'arcade-button', 'glass-slider', 'terminal-panel'],
            description: 'Optional 3D skin for the primitive.',
          },
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
          actionType: {
            type: 'string',
            enum: ['submit_form', 'set_value', 'spawn_vfx'],
            description: 'Optional button behavior when pressed.',
          },
          targetObjectId: { type: 'string', description: 'For set_value buttons, the spatial object ID to update.' },
          actionValue: { description: 'For set_value buttons, the value to write to the target object.' },
          endpoint: { type: 'string', description: 'Optional POST endpoint for submit buttons.' },
          successMessage: { type: 'string', description: 'Receipt text after a submit button succeeds.' },
        },
        required: ['type', 'label'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_craft_guide',
      description: 'Get the exact self-crafting schema for craft_scene so the agent can build explicit primitive objects.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'craft_scene',
      description: 'Create procedural geometry scenes. Prefer explicit objects arrays for direct self-crafting.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          name: { type: 'string', description: 'Optional scene name.' },
          prompt: { type: 'string', description: 'Optional prompt if prompt-mode crafting is intentional.' },
          position: { ...zVec3Schema, description: 'Scene root position [x, y, z].' },
          objects: {
            type: 'array',
            description: 'Preferred direct self-crafted primitive objects array from get_craft_guide.',
            items: { type: 'object', additionalProperties: true },
          },
          waitForCompletion: { type: 'boolean', description: 'Wait for the craft result before returning.' },
          strategy: { type: 'string', enum: ['agent', 'sculptor'], description: 'Use agent for direct self-craft, sculptor for prompt fallback.' },
        },
        additionalProperties: false,
      },
    },
    {
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
      name: 'walk_avatar_to',
      description: 'Send the embodied Gemini avatar walking to a target world position.',
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

export function getGeminiLiveConfig(): GeminiLiveConfigPayload {
  const models = Array.from(new Set([DEFAULT_GEMINI_LIVE_MODEL, ...GEMINI_LIVE_MODELS]))
  return {
    configured: Boolean(getGeminiApiKey()),
    model: DEFAULT_GEMINI_LIVE_MODEL,
    models,
    responseModalities: [...GEMINI_LIVE_RESPONSE_MODALITIES],
    websocketEndpoint: GEMINI_LIVE_WEBSOCKET_ENDPOINT,
    toolDeclarations: getGeminiLiveToolDeclarations(),
    docs: GEMINI_LIVE_DOCS,
  }
}

export function buildGeminiLiveSystemInstruction(args: { worldId?: string; worldName?: string } = {}): string {
  const worldId = typeof args.worldId === 'string' && args.worldId.trim() ? args.worldId.trim() : 'active browser world'
  const worldName = typeof args.worldName === 'string' && args.worldName.trim() ? args.worldName.trim() : 'Current world'

  return [
    'You are Gemini Live inside Oasis, an experimental 3D agent lab.',
    `Active world: ${worldName} (${worldId}).`,
    'Keep responses short, spatial, and useful.',
    'When tools are connected, use Oasis function calls for world changes instead of describing changes as if they already happened.',
    'Prefer create_spatial_web_object for 3D forms, controls, menus, and output panels.',
  ].join('\n')
}

export function buildGeminiLiveSetup(args: {
  model?: unknown
  worldId?: string
  worldName?: string
} = {}): Record<string, unknown> {
  const model = sanitizeGeminiLiveModel(args.model)
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: [...GEMINI_LIVE_RESPONSE_MODALITIES],
      },
      systemInstruction: {
        parts: [{ text: buildGeminiLiveSystemInstruction({ worldId: args.worldId, worldName: args.worldName }) }],
      },
      tools: [
        {
          functionDeclarations: getGeminiLiveToolDeclarations(),
        },
      ],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  }
}

export function buildGeminiLiveSessionManifest(args: {
  model?: unknown
  worldId?: string
  worldName?: string
} = {}): GeminiLiveSessionPayload {
  const model = sanitizeGeminiLiveModel(args.model)
  const toolDeclarations = getGeminiLiveToolDeclarations()
  return {
    status: 'manifest-ready',
    sessionId: `gemini-live-${Date.now()}`,
    model,
    configured: Boolean(getGeminiApiKey()),
    transport: 'manifest-only',
    websocketEndpoint: GEMINI_LIVE_WEBSOCKET_ENDPOINT,
    setupMessage: buildGeminiLiveSetup({ model, worldId: args.worldId, worldName: args.worldName }),
    toolDeclarationNames: toolDeclarations.map(tool => tool.name),
    note: 'Gemini Live setup and Oasis tool declarations are prepared server-side. A WebSocket proxy or ephemeral-token client is still needed for live audio/text streaming.',
  }
}

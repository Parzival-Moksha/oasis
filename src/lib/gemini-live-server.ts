import 'server-only'

import { GoogleGenAI } from '@google/genai'

import {
  GEMINI_LIVE_INPUT_SAMPLE_RATE,
  GEMINI_LIVE_MODELS,
  GEMINI_LIVE_OUTPUT_SAMPLE_RATE,
  GEMINI_LIVE_RESPONSE_MODALITIES,
  GEMINI_LIVE_VOICES,
  type GeminiLiveConfigPayload,
  type GeminiLiveFunctionDeclaration,
  type GeminiLiveSessionPayload,
} from '@/lib/gemini-live'
import { PORTAL_GATE_VARIANTS } from '@/lib/portal-gates'

export const GEMINI_LIVE_WEBSOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained'

export const GEMINI_LIVE_DOCS = {
  overview: 'https://ai.google.dev/gemini-api/docs/live-api',
  websocketReference: 'https://ai.google.dev/api/live',
  tools: 'https://ai.google.dev/gemini-api/docs/live-api/tools',
  ephemeralTokens: 'https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens',
}

const FALLBACK_GEMINI_LIVE_MODEL = GEMINI_LIVE_MODELS[0]
const FALLBACK_GEMINI_LIVE_VOICE = GEMINI_LIVE_VOICES[0]
const requestedDefaultGeminiLiveModel = process.env.GEMINI_LIVE_MODEL?.trim() || FALLBACK_GEMINI_LIVE_MODEL
const DEFAULT_GEMINI_LIVE_MODEL = isAllowedGeminiLiveModel(requestedDefaultGeminiLiveModel)
  ? requestedDefaultGeminiLiveModel
  : FALLBACK_GEMINI_LIVE_MODEL
const requestedDefaultGeminiLiveVoice = process.env.GEMINI_LIVE_VOICE?.trim() || FALLBACK_GEMINI_LIVE_VOICE
const DEFAULT_GEMINI_LIVE_VOICE = isAllowedGeminiLiveVoice(requestedDefaultGeminiLiveVoice)
  ? requestedDefaultGeminiLiveVoice
  : FALLBACK_GEMINI_LIVE_VOICE

const zVec3Schema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
}

function isAllowedGeminiLiveModel(value: string): boolean {
  return (GEMINI_LIVE_MODELS as readonly string[]).includes(value)
}

function isAllowedGeminiLiveVoice(value: string): boolean {
  return (GEMINI_LIVE_VOICES as readonly string[]).includes(value)
}

function sanitizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeGeminiSchema)
  if (!value || typeof value !== 'object') return value

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    if (key === 'additionalProperties' || key === 'minItems' || key === 'maxItems') continue
    output[key] = sanitizeGeminiSchema(child)
  }

  const looksLikeUntypedProperty =
    typeof output.description === 'string'
    && output.type === undefined
    && output.properties === undefined
    && output.items === undefined
    && output.enum === undefined
  if (looksLikeUntypedProperty) {
    output.type = 'string'
  }

  return output
}

function sanitizeGeminiFunctionDeclaration(declaration: GeminiLiveFunctionDeclaration): GeminiLiveFunctionDeclaration {
  return {
    ...declaration,
    parameters: sanitizeGeminiSchema(declaration.parameters) as Record<string, unknown>,
  }
}

export function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || ''
}

export function sanitizeGeminiLiveModel(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next && isAllowedGeminiLiveModel(next) ? next : DEFAULT_GEMINI_LIVE_MODEL
}

export function sanitizeGeminiLiveVoice(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next && isAllowedGeminiLiveVoice(next) ? next : DEFAULT_GEMINI_LIVE_VOICE
}

export function getGeminiLiveToolDeclarations(): GeminiLiveFunctionDeclaration[] {
  const declarations: GeminiLiveFunctionDeclaration[] = [
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
      name: 'list_worlds',
      description: 'List Oasis worlds visible to you. Use query to resolve a named destination like Portal Zero before creating portals.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional world name or ID search, for example Portal Zero.' },
          limit: { type: 'number', description: 'Optional maximum number of worlds to return.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'query_objects',
      description: 'Search objects already in the world by keyword, type, or proximity. Use this before modifying, removing, animating, or moving existing things.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          query: { type: 'string', description: 'Optional text search against object names and labels.' },
          type: { type: 'string', enum: ['catalog', 'crafted', 'portal', 'spatial-web', 'light', 'agent-avatar', 'agent-window', 'browser-window'], description: 'Optional object type filter.' },
          near: { ...zVec3Schema, description: 'Optional world position [x, y, z] to search near.' },
          radius: { type: 'number', description: 'Optional proximity radius in meters.' },
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
      name: 'get_asset_catalog',
      description: 'Get the full Oasis asset catalog grouped by category. Prefer search_assets for normal lookups; use this when the user asks what exists.',
      parameters: {
        type: 'object',
        properties: {},
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
      name: 'place_agent_window',
      description: 'Place a 3D agent window in the world. Use agentType browser plus url to place a live 3D browser window. Browser windows default to a baroque frame with thickness 7.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          agentType: { type: 'string', enum: ['anorak', 'codex', 'gemini', 'anorak-pro', 'merlin', 'realtime', 'hermes', 'openclaw', 'devcraft', 'parzival', 'browser', 'mission'], description: 'Window kind. Use browser for a web page.' },
          agent: { type: 'string', description: 'Alias for agentType.' },
          url: { type: 'string', description: 'Initial URL for browser surfaces. example.com becomes https://example.com.' },
          surfaceUrl: { type: 'string', description: 'Alias for url.' },
          label: { type: 'string', description: 'Optional visible label.' },
          position: { ...zVec3Schema, description: 'World position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional uniform scale, default 0.15.' },
          width: { type: 'number', description: 'Pixel width of the window surface.' },
          height: { type: 'number', description: 'Pixel height of the window surface.' },
          frameStyle: { type: 'string', description: 'Frame style. Browser default is baroque.' },
          frameThickness: { type: 'number', description: 'Frame thickness. Browser default is 7.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'place_browser_window',
      description: 'Place a live 3D web browser surface in the world with a predefined URL. Defaults to live-browser mode, baroque frame, thickness 7, 1280x820.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          url: { type: 'string', description: 'Initial URL. example.com becomes https://example.com.' },
          surfaceUrl: { type: 'string', description: 'Alias for url.' },
          label: { type: 'string', description: 'Optional visible label.' },
          position: { ...zVec3Schema, description: 'World position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional uniform scale, default 0.15.' },
          width: { type: 'number', description: 'Pixel width of the browser surface.' },
          height: { type: 'number', description: 'Pixel height of the browser surface.' },
          frameStyle: { type: 'string', description: 'Optional frame style. Default baroque.' },
          frameThickness: { type: 'number', description: 'Optional frame thickness. Default 7.' },
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
            enum: ['neon-panel', 'arcade-button', 'glass-slider', 'terminal-panel', 'portal-zero-button', 'google-form-altar'],
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
            enum: ['submit_form', 'set_value', 'spawn_vfx', 'world_tool', 'create_world_from_google_form'],
            description: 'Optional behavior when pressed or changed. Use world_tool to wire a control to an Oasis world tool.',
          },
          testMode: { type: 'boolean', description: 'For Google Forms altar objects, create a test/quiz world with scoring and a Gemini tutor.' },
          targetObjectId: { type: 'string', description: 'For set_value buttons, the spatial object ID to update.' },
          actionValue: { description: 'For set_value buttons, the value to write to the target object.' },
          tool: { type: 'string', description: 'For world_tool actions, the Oasis tool to call, for example set_sky or set_ground_preset.' },
          args: {
            type: 'object',
            description: 'For world_tool actions, base tool args as an object.',
            properties: {},
            additionalProperties: true,
          },
          argsByValue: {
            type: 'object',
            description: 'For toggles/selects/sliders, optional map from value string to extra tool args.',
            properties: {},
            additionalProperties: true,
          },
          endpoint: { type: 'string', description: 'Optional POST endpoint for submit buttons.' },
          successMessage: { type: 'string', description: 'Receipt text after a submit button succeeds.' },
          submitDestinationType: {
            type: 'string',
            enum: ['google_form', 'webhook'],
            description: 'Optional real submit destination. Use google_form to POST mapped fields to Google Forms.',
          },
          googleFormUrl: { type: 'string', description: 'Public Google Form URL for submit buttons.' },
          googleFormResponseUrl: { type: 'string', description: 'Optional Google Forms formResponse URL.' },
          fieldMap: {
            type: 'object',
            description: 'Map spatial object IDs or labels to Google Forms entry IDs, for example {"Name":"entry.123"}.',
            properties: {},
            additionalProperties: true,
          },
          webhookUrl: { type: 'string', description: 'Webhook URL for submit buttons.' },
        },
        required: ['type', 'label'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_world_from_google_form',
      description: 'Fetch a public Google Form, convert its fields into a shareable Oasis spatial form world, wire submit to Google Forms, and return the world URL plus QR code URL.',
      parameters: {
        type: 'object',
        properties: {
          formUrl: { type: 'string', description: 'Public Google Form URL.' },
          name: { type: 'string', description: 'Optional Oasis world name.' },
          icon: { type: 'string', description: 'Optional short world icon text.' },
          visibility: { type: 'string', enum: ['unlisted', 'unlisted_edit', 'public', 'public_edit', 'private'], description: 'Share visibility. Use unlisted for hackathon links, or unlisted_edit when invited visitors should build.' },
          publicBaseUrl: { type: 'string', description: 'Optional public Oasis base URL, for example https://04515.xyz.' },
        },
        required: ['formUrl'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_test_world_from_google_form',
      description: 'Fetch a public Google Form, convert it into a shareable test world with spatial questions, a Gemini tutor avatar/window, optional local answer-key scoring, Google Forms submit, and return the world URL plus QR code URL.',
      parameters: {
        type: 'object',
        properties: {
          formUrl: { type: 'string', description: 'Public Google Form URL.' },
          name: { type: 'string', description: 'Optional Oasis world name.' },
          icon: { type: 'string', description: 'Optional short world icon text.' },
          visibility: { type: 'string', enum: ['unlisted', 'unlisted_edit', 'public', 'public_edit', 'private'], description: 'Share visibility. Use unlisted for hackathon links, or unlisted_edit when invited visitors should build.' },
          publicBaseUrl: { type: 'string', description: 'Optional public Oasis base URL, for example https://04515.xyz.' },
          answerKey: {
            type: 'object',
            description: 'Optional local grading key mapping question labels or spatial object IDs to correct answer strings or arrays.',
            properties: {},
            additionalProperties: true,
          },
        },
        required: ['formUrl'],
        additionalProperties: false,
      },
    },
    {
      name: 'share_world_link',
      description: 'Make an Oasis world shareable and return a /w/:id link plus QR code URL. Use unlisted for link-only sharing.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          visibility: { type: 'string', enum: ['unlisted', 'unlisted_edit', 'public', 'public_edit', 'private'], description: 'Share visibility. unlisted_edit is link-only with visitor build access.' },
          publicBaseUrl: { type: 'string', description: 'Optional public Oasis base URL, for example https://04515.xyz.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'create_portal_gate',
      description: 'Create a persistent portal gate in the current world, optionally two-way, to another Oasis world. Use targetWorldName for names like Portal Zero, or call list_worlds first.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional source world ID. Omit to use the active browser world.' },
          targetWorldId: { type: 'string', description: 'Exact destination world ID if known.' },
          destinationWorldId: { type: 'string', description: 'Alias for targetWorldId.' },
          targetWorldName: { type: 'string', description: 'Destination world name to resolve, for example Portal Zero.' },
          worldName: { type: 'string', description: 'Alias for targetWorldName.' },
          label: { type: 'string', description: 'Visible portal label.' },
          returnLabel: { type: 'string', description: 'Visible label for the return portal when two-way.' },
          variant: {
            type: 'string',
            enum: PORTAL_GATE_VARIANTS,
            description: 'Portal gate visual style.',
          },
          position: { ...zVec3Schema, description: 'Source world position [x, y, z]. Omit with distanceAhead to place ahead of Gemini.' },
          rotation: { ...zVec3Schema, description: 'Optional Euler rotation [x, y, z] in radians.' },
          rotationY: { type: 'number', description: 'Optional yaw rotation in radians.' },
          width: { type: 'number', description: 'Optional portal width in meters.' },
          height: { type: 'number', description: 'Optional portal height in meters.' },
          scale: { type: 'number', description: 'Optional uniform scale.' },
          distanceAhead: { type: 'number', description: 'If no position is provided, place this many meters ahead of Gemini.' },
          direction: { type: 'string', enum: ['one-way', 'two-way'], description: 'Use two-way unless the user asks otherwise.' },
          twoWay: { type: 'boolean', description: 'Alias for direction two-way.' },
          agentType: { type: 'string', description: 'Agent body used for relative placement. Omit to target Gemini.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'modify_object',
      description: 'Modify an existing world object by ID: position, rotation, scale, label, visibility, and spatial-web value/accent/description.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          objectId: { type: 'string', description: 'Existing object ID. Call query_objects or get_world_state first if unsure.' },
          position: { ...zVec3Schema, description: 'Optional new world position [x, y, z].' },
          rotation: { ...zVec3Schema, description: 'Optional Euler rotation [x, y, z] in radians.' },
          scale: { type: 'number', description: 'Optional uniform scale multiplier.' },
          label: { type: 'string', description: 'Optional visible label/name.' },
          visible: { type: 'boolean', description: 'Optional visibility flag.' },
          url: { type: 'string', description: 'For browser windows, set the page URL.' },
          surfaceUrl: { type: 'string', description: 'Alias for url on browser windows.' },
          width: { type: 'number', description: 'For agent/browser windows, pixel width.' },
          height: { type: 'number', description: 'For agent/browser windows, pixel height.' },
          frameStyle: { type: 'string', description: 'For agent/browser windows, frame style such as baroque, void, fire, neon.' },
          frameThickness: { type: 'number', description: 'For agent/browser windows, frame thickness.' },
          value: { description: 'Optional value for spatial web objects.' },
          accentColor: { type: 'string', description: 'Optional hex accent color for spatial web objects.' },
          description: { type: 'string', description: 'Optional spatial object helper text.' },
        },
        required: ['objectId'],
        additionalProperties: false,
      },
    },
    {
      name: 'remove_object',
      description: 'Remove a catalog object, crafted scene, spatial-web object, or agent avatar by ID. Query first if the ID is not known.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          objectId: { type: 'string', description: 'Existing object ID to remove.' },
        },
        required: ['objectId'],
        additionalProperties: false,
      },
    },
    {
      name: 'set_sky',
      description: 'Change the active world sky or environment background. Use this when the user asks for mood, time of day, stars, sunset, forest, studio, city, or other background changes.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          presetId: {
            type: 'string',
            enum: [
              'stars',
              'night001',
              'night004',
              'night007',
              'night008',
              'alps_field',
              'autumn_ground',
              'belfast_sunset',
              'blue_grotto',
              'evening_road',
              'outdoor_umbrellas',
              'stadium',
              'sunny_vondelpark',
              'city',
              'dawn',
              'forest',
              'sunset',
              'park',
              'night_preset',
              'studio',
              'warehouse',
              'apartment',
              'lobby',
            ],
            description: 'Sky preset ID. Good defaults: stars, dawn, sunset, forest, city, studio, blue_grotto, night007.',
          },
        },
        required: ['presetId'],
        additionalProperties: false,
      },
    },
    {
      name: 'set_ground_preset',
      description: 'Change the whole world ground material. Use this to paint the floor broadly before placing objects.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          presetId: {
            type: 'string',
            enum: [
              'none',
              'grass',
              'dirt',
              'sand',
              'stone',
              'snow',
              'cobble',
              'forest',
              'lava',
              'concrete',
              'marble',
              'metal',
              'beach',
              'rocks',
              'leaves',
              'leaves2',
              'pebbles',
              'gravel',
              'rocky',
              'snow2',
            ],
            description: 'Ground preset ID.',
          },
        },
        required: ['presetId'],
        additionalProperties: false,
      },
    },
    {
      name: 'paint_ground_tiles',
      description: 'Paint specific grid tiles with a ground material. Use this for paths, pads, zones, portal approaches, or localized terrain details.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          presetId: {
            type: 'string',
            enum: [
              'grass',
              'dirt',
              'sand',
              'stone',
              'snow',
              'cobble',
              'forest',
              'lava',
              'concrete',
              'marble',
              'metal',
              'beach',
              'rocks',
              'leaves',
              'leaves2',
              'pebbles',
              'gravel',
              'rocky',
              'snow2',
            ],
            description: 'Default material for all listed tiles unless a tile has its own presetId.',
          },
          tiles: {
            type: 'array',
            description: 'Grid tile coordinates to paint.',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Integer grid X coordinate.' },
                z: { type: 'number', description: 'Integer grid Z coordinate.' },
                presetId: { type: 'string', description: 'Optional tile-specific ground preset.' },
              },
              required: ['x', 'z'],
              additionalProperties: false,
            },
          },
        },
        required: ['tiles'],
        additionalProperties: false,
      },
    },
    {
      name: 'add_light',
      description: 'Add a world light source for mood, visibility, stage lighting, object highlights, or portals.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          type: { type: 'string', enum: ['point', 'spot', 'directional', 'ambient', 'hemisphere'], description: 'Light type. point is a good default.' },
          position: { ...zVec3Schema, description: 'Optional world position [x, y, z].' },
          color: { type: 'string', description: 'Optional hex light color.' },
          intensity: { type: 'number', description: 'Optional brightness.' },
          label: { type: 'string', description: 'Optional friendly label.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'modify_light',
      description: 'Modify an existing world light by ID. Use get_world_state or query_objects type light first if needed.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          lightId: { type: 'string', description: 'Existing light ID.' },
          position: { ...zVec3Schema, description: 'Optional new world position [x, y, z].' },
          color: { type: 'string', description: 'Optional hex light color.' },
          intensity: { type: 'number', description: 'Optional brightness.' },
          visible: { type: 'boolean', description: 'Optional visibility flag.' },
        },
        required: ['lightId'],
        additionalProperties: false,
      },
    },
    {
      name: 'set_behavior',
      description: 'Set an object behavior: static, spin, hover, orbit, bounce, or patrol. Use this to make placed objects feel alive.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          objectId: { type: 'string', description: 'Existing object ID.' },
          movement: { type: 'string', enum: ['static', 'spin', 'hover', 'orbit', 'bounce', 'patrol'], description: 'Movement preset.' },
          speed: { type: 'number', description: 'Optional speed multiplier.' },
          radius: { type: 'number', description: 'Optional orbit/patrol radius.' },
          amplitude: { type: 'number', description: 'Optional hover amplitude.' },
          height: { type: 'number', description: 'Optional bounce height.' },
          label: { type: 'string', description: 'Optional behavior label.' },
        },
        required: ['objectId'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_craft_guide',
      description: 'Get the exact self-crafting schema so the agent can build explicit primitive objects for self_craft_scene.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'self_craft_scene',
      description: 'Create procedural primitive geometry from explicit objects only. Use this for exact shapes, colors, positions, and sizes; never use fake job IDs.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          name: { type: 'string', description: 'Optional scene name.' },
          position: { ...zVec3Schema, description: 'Scene root position [x, y, z].' },
          objects: {
            type: 'array',
            description: 'Required direct self-crafted primitive objects array from get_craft_guide.',
            items: { type: 'object', additionalProperties: true },
          },
        },
        required: ['objects'],
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
      name: 'set_avatar',
      description: 'Create or update Gemini’s embodied agent avatar in the world. Use this when the user asks for a body, avatar, costume, or visible co-wizard.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          agentType: { type: 'string', description: 'Agent type. Omit to target Gemini.' },
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
    {
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
      name: 'play_avatar_animation',
      description: 'Play an animation on Gemini’s embodied avatar. Call list_avatar_animations first and use an exact clipName.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          agentType: { type: 'string', description: 'Agent type. Omit to target Gemini.' },
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
      name: 'screenshot_viewport',
      description: 'Capture a screenshot of the 3D world when the browser screenshot bridge is available. Use current for the human view, agent-avatar-phantom for Gemini FPS, look-at for explicit camera, external-orbit for overview, third-person-follow for over-shoulder, or avatar-portrait for a headshot.',
      parameters: {
        type: 'object',
        properties: {
          worldId: { type: 'string', description: 'Optional world ID. Omit to use the active browser world.' },
          mode: { type: 'string', enum: ['current', 'agent-avatar-phantom', 'look-at', 'external-orbit', 'third-person-follow', 'avatar-portrait'], description: 'Screenshot camera mode.' },
          agentType: { type: 'string', description: 'Subject agent type. Omit for Gemini, use player for the human.' },
          agent: { type: 'string', description: 'Alias for agentType.' },
          position: { ...zVec3Schema, description: 'Camera position for look-at mode.' },
          target: { ...zVec3Schema, description: 'Camera target or subject target.' },
          cameraPosition: { ...zVec3Schema, description: 'Alias for position.' },
          cameraTarget: { ...zVec3Schema, description: 'Alias for target.' },
          distance: { type: 'number', description: 'Optional camera distance.' },
          heightOffset: { type: 'number', description: 'Optional camera height offset.' },
          lookAhead: { type: 'number', description: 'Optional focal look-ahead distance.' },
          fov: { type: 'number', description: 'Optional field of view.' },
          width: { type: 'number', description: 'Optional screenshot width.' },
          height: { type: 'number', description: 'Optional screenshot height.' },
          settleMs: { type: 'number', description: 'Optional delay before capture.' },
          format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Optional image format.' },
          quality: { type: 'number', description: 'Optional JPEG/WebP quality.' },
        },
        additionalProperties: false,
      },
    },
  ]
  return declarations.map(sanitizeGeminiFunctionDeclaration)
}

export function getGeminiLiveConfig(): GeminiLiveConfigPayload {
  const models = Array.from(new Set([DEFAULT_GEMINI_LIVE_MODEL, ...GEMINI_LIVE_MODELS]))
  const voices = Array.from(new Set([DEFAULT_GEMINI_LIVE_VOICE, ...GEMINI_LIVE_VOICES]))
  return {
    configured: Boolean(getGeminiApiKey()),
    model: DEFAULT_GEMINI_LIVE_MODEL,
    models,
    defaultVoice: DEFAULT_GEMINI_LIVE_VOICE,
    voices,
    responseModalities: [...GEMINI_LIVE_RESPONSE_MODALITIES],
    promptTemplate: buildGeminiLiveSystemInstruction(),
    inputSampleRate: GEMINI_LIVE_INPUT_SAMPLE_RATE,
    outputSampleRate: GEMINI_LIVE_OUTPUT_SAMPLE_RATE,
    websocketEndpoint: GEMINI_LIVE_WEBSOCKET_ENDPOINT,
    toolDeclarations: getGeminiLiveToolDeclarations(),
    docs: GEMINI_LIVE_DOCS,
  }
}

export function buildGeminiLiveSystemInstruction(args: { worldId?: string; worldName?: string; model?: string; voice?: string } = {}): string {
  const worldId = typeof args.worldId === 'string' && args.worldId.trim() ? args.worldId.trim() : 'active browser world'
  const worldName = typeof args.worldName === 'string' && args.worldName.trim() ? args.worldName.trim() : 'Current world'
  const model = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : DEFAULT_GEMINI_LIVE_MODEL
  const voice = typeof args.voice === 'string' && args.voice.trim() ? args.voice.trim() : DEFAULT_GEMINI_LIVE_VOICE

  return [
    'You are Gemini Live inside Oasis, an experimental 3D agent lab.',
    `Active world: ${worldName} (${worldId}).`,
    `Current Live model: ${model}. Current voice: ${voice}. If asked which model or voice you are, answer exactly with those values.`,
    'Keep responses short, spatial, and useful. Speak like a co-wizard in a live demo, not a website chatbot.',
    'When tools are connected, use Oasis function calls for world changes instead of describing changes as if they already happened.',
    'Never say you called, sent, placed, crafted, checked, or changed something with a tool unless you actually submitted that function call.',
    'Prefer create_spatial_web_object for 3D forms, controls, menus, and output panels.',
    'Use place_browser_window when the user asks to open or embed a website, docs page, app, dashboard, or browser in the 3D world. Pass url; Oasis will place it as a 3D browser surface with a baroque frame.',
    'When the user gives a Google Form link and asks for a demo/shareable world, use create_world_from_google_form. Read back the returned worldUrl and qrUrl.',
    'When the user gives a Google Form link and asks for a test, quiz, student, or tutor world, use create_test_world_from_google_form. If an answer key is provided, pass it as answerKey.',
    'To place a reusable Google Forms altar in a world, create a text spatial web object with visualStyle google-form-altar and actionType create_world_from_google_form. For quiz/test altars, set testMode true.',
    'Use share_world_link to produce a /w/ share link and QR code for the current world. Prefer visibility unlisted for demos, or unlisted_edit when invited visitors should build.',
    'To wire spatial buttons, toggles, sliders, or selects to world changes, create them with actionType world_tool plus tool, args, and optional argsByValue.',
    'To wire a submit button to an existing Google Form manually, use actionType submit_form with submitDestinationType google_form and a fieldMap from spatial field labels or IDs to Google entry IDs.',
    'Use query_objects before modify_object, remove_object, set_behavior, or modify_light unless the user gives an exact ID. Use type browser-window or agent-window when looking for placed 3D windows.',
    'Use set_sky, set_ground_preset, and paint_ground_tiles when the user asks for atmosphere, background, terrain, paths, floors, or painted ground.',
    'For portals, do not search assets. Use list_worlds to resolve named destinations like Portal Zero, then create_portal_gate with targetWorldName or targetWorldId.',
    'Use add_light and modify_light for scene readability, stage lighting, and dramatic focus.',
    'Use set_avatar, walk_avatar_to, list_avatar_animations, and play_avatar_animation for embodied avatar actions.',
    'Use screenshot_viewport when the user asks what you can see or asks for a screenshot; say if the screenshot bridge returns an error.',
    'Do not remove objects unless the user clearly asks to delete/remove them or has just confirmed the target.',
    'Use search_assets before place_object unless the user gives an exact catalogId. Do not invent catalog IDs.',
    'Use self_craft_scene for exact primitive shapes, colors, and placements. Do not invent craft job IDs; only poll job IDs returned by craft_scene.',
    'When you create or change the world, say what you are doing while the tool call is running.',
  ].join('\n')
}

function normalizeSystemInstruction(value: unknown, fallback: string): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next || fallback
}

function mergeGeminiLiveSystemInstruction(value: unknown, runtimeInstruction: string, editableFallback: string): string {
  const editableInstruction = normalizeSystemInstruction(value, editableFallback)
  if (editableInstruction.includes(runtimeInstruction)) return editableInstruction
  return `${runtimeInstruction}\n\nOperator editable prompt:\n${editableInstruction}`
}

export function buildGeminiLiveConnectConfig(args: {
  model?: unknown
  voice?: unknown
  worldId?: string
  worldName?: string
  systemInstruction?: unknown
} = {}): Record<string, unknown> {
  const model = sanitizeGeminiLiveModel(args.model)
  const voice = sanitizeGeminiLiveVoice(args.voice)
  const editableFallback = buildGeminiLiveSystemInstruction({ worldId: args.worldId, worldName: args.worldName, model, voice })
  const runtimeInstruction = buildGeminiLiveSystemInstruction({ worldId: args.worldId, worldName: args.worldName, model, voice })
  const systemInstruction = mergeGeminiLiveSystemInstruction(
    args.systemInstruction,
    runtimeInstruction,
    editableFallback,
  )

  return {
    responseModalities: [...GEMINI_LIVE_RESPONSE_MODALITIES],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voice,
        },
      },
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    tools: [
      {
        functionDeclarations: getGeminiLiveToolDeclarations(),
      },
    ],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
  }
}

export function buildGeminiLiveSetup(args: {
  model?: unknown
  voice?: unknown
  worldId?: string
  worldName?: string
  systemInstruction?: unknown
} = {}): Record<string, unknown> {
  const model = sanitizeGeminiLiveModel(args.model)
  const config = buildGeminiLiveConnectConfig({
    model,
    voice: args.voice,
    worldId: args.worldId,
    worldName: args.worldName,
    systemInstruction: args.systemInstruction,
  })
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: config.responseModalities,
        speechConfig: config.speechConfig,
      },
      systemInstruction: config.systemInstruction,
      tools: config.tools,
      inputAudioTranscription: config.inputAudioTranscription,
      outputAudioTranscription: config.outputAudioTranscription,
      realtimeInputConfig: config.realtimeInputConfig,
    },
  }
}

export async function buildGeminiLiveSessionManifest(args: {
  model?: unknown
  voice?: unknown
  worldId?: string
  worldName?: string
  systemInstruction?: unknown
} = {}): Promise<GeminiLiveSessionPayload> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not configured.')
  }

  const model = sanitizeGeminiLiveModel(args.model)
  const voice = sanitizeGeminiLiveVoice(args.voice)
  const toolDeclarations = getGeminiLiveToolDeclarations()
  const setupMessage = buildGeminiLiveSetup({
    model,
    voice,
    worldId: args.worldId,
    worldName: args.worldName,
    systemInstruction: args.systemInstruction,
  })
  const connectConfig = buildGeminiLiveConnectConfig({
    model,
    voice,
    worldId: args.worldId,
    worldName: args.worldName,
    systemInstruction: args.systemInstruction,
  })
  const tokenExpiresAt = Date.now() + 30 * 60 * 1000
  const newSessionExpiresAt = Date.now() + 60 * 1000
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: 'v1alpha' },
  })
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(tokenExpiresAt).toISOString(),
      newSessionExpireTime: new Date(newSessionExpiresAt).toISOString(),
      liveConnectConstraints: {
        model,
        config: connectConfig,
      },
      httpOptions: { apiVersion: 'v1alpha' },
    },
  })
  const accessToken = typeof token.name === 'string' ? token.name : ''
  if (!accessToken) {
    throw new Error('Gemini did not return an ephemeral Live token.')
  }

  return {
    status: 'session-ready',
    sessionId: `gemini-live-${Date.now()}`,
    model,
    voice,
    configured: Boolean(getGeminiApiKey()),
    transport: 'ephemeral-token',
    websocketEndpoint: GEMINI_LIVE_WEBSOCKET_ENDPOINT,
    accessToken,
    tokenExpiresAt,
    setupMessage,
    toolDeclarationNames: toolDeclarations.map(tool => tool.name),
    note: 'Gemini Live ephemeral token minted server-side. Browser may connect directly to the constrained Live WebSocket without exposing the real API key.',
  }
}

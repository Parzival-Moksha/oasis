// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MERLIN — The World-Builder Agent
// ─═̷─═̷─ॐ─═̷─═̷─ Words → Tools → World ─═̷─═̷─ॐ─═̷─═̷─
//
// v0.1: Admin-only. POST { worldId, prompt } → SSE stream of tool calls.
// Uses OpenRouter tool-use (OpenAI-compat format) with Claude Sonnet.
// Loads world from Supabase, runs tool loop, saves partial state after each
// tool call so Realtime subscription shows live progress in the client.
//
// Tools: add_catalog_object, remove_object, add_crafted_scene,
//        add_light, set_sky, set_ground, set_behavior, clear_world
//
// Admin-only for v0.1 — no credit deduction, unlimited calls.
// When we open it up: add auth + credit check just like /api/craft.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { saveWorld } from '@/lib/forge/world-server'
import type { WorldState } from '@/lib/forge/world-persistence'
import type { CatalogPlacement, CraftedScene, WorldLight } from '@/lib/conjure/types'
import { ASSET_CATALOG } from '@/components/scene-lib/constants'

// ─═̷─═̷─🔒 ADMIN GUARD ─═̷─═̷─🔒
// Local mode: always admin. No auth needed.

const MERLIN_MODEL = 'anthropic/claude-sonnet-4-6'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ═══════════════════════════════════════════════════════════════════════════
// CATALOG LOOKUP — used by tools to resolve catalogId → glbPath + name
// ═══════════════════════════════════════════════════════════════════════════

// Build a fast lookup map at module init
const CATALOG_MAP = new Map(ASSET_CATALOG.map(a => [a.id, a]))

function resolveCatalogEntry(catalogId: string) {
  return CATALOG_MAP.get(catalogId) ?? null
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — the world model in natural language
// ═══════════════════════════════════════════════════════════════════════════

// Compact catalog summary for the prompt (category → sample IDs)
function buildCatalogSummary(): string {
  const byCategory: Record<string, string[]> = {}
  for (const a of ASSET_CATALOG) {
    const cat = a.category || 'misc'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(a.id)
  }
  return Object.entries(byCategory)
    .map(([cat, ids]) => `${cat}: ${ids.slice(0, 15).join(', ')}${ids.length > 15 ? ` ... (+${ids.length - 15} more)` : ''}`)
    .join('\n')
}

const CATALOG_SUMMARY = buildCatalogSummary()

const SYSTEM_PROMPT = `You are Merlin, an AI world-builder operating inside the Oasis — a 3D world-building platform.
You modify a user's 3D world by calling tools. You see the current world state and fulfill the user's creative request.

COORDINATE SYSTEM:
- Y is UP. Ground is Y=0. Objects sit on ground at Y = half their height.
- Typical scene radius: -20 to +20 on X and Z. Don't go beyond ±50.
- Scale: 1 unit = 1 meter.

CATALOG ASSET IDs (use these with add_catalog_object):
${CATALOG_SUMMARY}

SKY PRESET IDs: night007, stars, night001, night004, night008, alps_field, autumn_ground, belfast_sunset, blue_grotto, evening_road, outdoor_umbrellas, stadium, sunny_vondelpark, city, dawn, forest, sunset

GROUND PRESET IDs: none, grass, sand, dirt, stone, snow, water

RULES:
- Use tools one at a time. Each tool call immediately updates the live world.
- Place objects at varied positions — don't stack everything at [0,0,0].
- For catalog objects, defaultScale for most assets is 1-2. Check what feels right.
- When removing objects, only remove IDs that actually exist in the current world state.
- Explain your plan briefly before calling tools. Be creative but purposeful.
- Max 20 tool calls per request to keep things snappy.
`

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (OpenAI-compat format for OpenRouter)
// ═══════════════════════════════════════════════════════════════════════════

const MERLIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_catalog_object',
      description: 'Place a pre-made 3D model from the catalog into the world.',
      parameters: {
        type: 'object',
        properties: {
          catalogId: { type: 'string', description: 'The catalog asset ID (e.g. km_tower, ku_tree_park)' },
          position: {
            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
            description: '[x, y, z] world position. Y should be 0 for ground-level objects.',
          },
          rotation: {
            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
            description: '[rx, ry, rz] rotation in radians. Optional.',
          },
          scale: {
            type: 'number',
            description: 'Uniform scale factor (default 1.0). Most catalog assets look good at 1-2.',
          },
          label: { type: 'string', description: 'Optional display name label for this object.' },
        },
        required: ['catalogId', 'position'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_object',
      description: 'Remove an object from the world by its ID.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string', description: 'The ID of the object to remove (from catalogPlacements or craftedScenes).' },
        },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_crafted_scene',
      description: 'Add a procedural geometry scene (primitives) to the world. Use this for custom shapes that have no catalog equivalent.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A short descriptive name for the scene (e.g. "Stone Altar", "Glowing Portal").' },
          position: {
            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
            description: '[x, y, z] world position offset for the whole scene.',
          },
          objects: {
            type: 'array',
            description: 'Array of primitives forming the scene.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'text'] },
                position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                color: { type: 'string', description: 'Hex color e.g. #FF0000' },
                emissive: { type: 'string', description: 'Hex emissive color for glow' },
                emissiveIntensity: { type: 'number', minimum: 0, maximum: 5 },
                metalness: { type: 'number', minimum: 0, maximum: 1 },
                roughness: { type: 'number', minimum: 0, maximum: 1 },
                opacity: { type: 'number', minimum: 0, maximum: 1 },
                text: { type: 'string', description: 'For text primitives: the string to display (ASCII only)' },
                fontSize: { type: 'number', minimum: 0.1, maximum: 20 },
              },
              required: ['type', 'position', 'scale', 'color'],
            },
          },
        },
        required: ['name', 'objects'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_light',
      description: 'Add a light source to the world.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['point', 'spot', 'directional', 'ambient', 'hemisphere'],
            description: 'Light type.',
          },
          position: {
            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
            description: '[x, y, z] position (required for point/spot, optional for others).',
          },
          color: { type: 'string', description: 'Hex color e.g. #FFFFFF' },
          intensity: { type: 'number', minimum: 0, maximum: 20, description: 'Light strength. 1-3 for subtle, 5-10 for dramatic.' },
          label: { type: 'string', description: 'Optional label.' },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_sky',
      description: 'Change the sky/environment background.',
      parameters: {
        type: 'object',
        properties: {
          presetId: { type: 'string', description: 'Sky preset ID (e.g. night007, forest, dawn, city).' },
        },
        required: ['presetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_ground',
      description: 'Change the ground texture.',
      parameters: {
        type: 'object',
        properties: {
          presetId: { type: 'string', description: 'Ground preset ID: none, grass, sand, dirt, stone, snow, water.' },
        },
        required: ['presetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_behavior',
      description: 'Set movement/animation behavior on an object.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string', description: 'The object ID to animate.' },
          movement: {
            type: 'string',
            enum: ['static', 'patrol', 'hover', 'spin', 'bob'],
            description: 'Movement preset.',
          },
          label: { type: 'string', description: 'Optional display label for this object.' },
        },
        required: ['objectId', 'movement'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_world',
      description: 'Remove ALL objects from the world (catalog, crafted, lights). Use with caution — irreversible without undo.',
      parameters: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            description: 'Must be true to confirm destructive operation.',
          },
        },
        required: ['confirm'],
      },
    },
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR — applies each tool call to the mutable world state
// ═══════════════════════════════════════════════════════════════════════════

function execTool(
  name: string,
  args: Record<string, unknown>,
  state: WorldState
): { ok: boolean; message: string } {
  switch (name) {
    case 'add_catalog_object': {
      const catalogId = args.catalogId as string
      const asset = resolveCatalogEntry(catalogId)
      if (!asset) return { ok: false, message: `Unknown catalogId: ${catalogId}` }

      const position = (args.position as [number, number, number]) || [0, 0, 0]
      const rotation = args.rotation ? (args.rotation as [number, number, number]) : undefined
      const scale = typeof args.scale === 'number' ? args.scale : (asset.defaultScale || 1)

      const id = `catalog-${catalogId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
      const placement: CatalogPlacement = {
        id,
        catalogId,
        name: (args.label as string) || asset.name,
        glbPath: asset.path,
        position,
        rotation: rotation || [0, 0, 0],
        scale,
      }

      state.catalogPlacements = [...(state.catalogPlacements || []), placement]
      return { ok: true, message: `Placed ${asset.name} (${catalogId}) at [${position.join(', ')}] as ${id}` }
    }

    case 'remove_object': {
      const objectId = args.objectId as string
      const beforeCatalog = state.catalogPlacements?.length || 0
      const beforeCrafted = state.craftedScenes?.length || 0

      state.catalogPlacements = (state.catalogPlacements || []).filter(p => p.id !== objectId)
      state.craftedScenes = (state.craftedScenes || []).filter(s => s.id !== objectId)

      // Also remove from transforms/behaviors
      delete state.transforms[objectId]
      if (state.behaviors) delete state.behaviors[objectId]

      const removed = (beforeCatalog - (state.catalogPlacements.length))
        + (beforeCrafted - (state.craftedScenes.length))
      if (removed === 0) return { ok: false, message: `Object ${objectId} not found in world` }
      return { ok: true, message: `Removed ${objectId}` }
    }

    case 'add_crafted_scene': {
      const sceneId = `crafted-merlin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
      const rawObjects = (args.objects as unknown[]) || []
      const position = (args.position as [number, number, number]) || [0, 0, 0]

      // Basic validation — keep only objects with required fields
      const objects = rawObjects.filter(o => {
        if (!o || typeof o !== 'object') return false
        const obj = o as Record<string, unknown>
        return obj.type && obj.position && obj.scale && obj.color
      }) as CraftedScene['objects']

      if (objects.length === 0) return { ok: false, message: 'No valid primitives in scene' }

      const scene: CraftedScene = {
        id: sceneId,
        name: (args.name as string) || 'Merlin Scene',
        prompt: 'merlin',
        objects,
        position: position,
        createdAt: new Date().toISOString(),
      }

      state.craftedScenes = [...(state.craftedScenes || []), scene]
      // Apply position as transform
      if (position.some(v => v !== 0)) {
        state.transforms[sceneId] = { position }
      }

      return { ok: true, message: `Created scene "${scene.name}" with ${objects.length} primitives as ${sceneId}` }
    }

    case 'add_light': {
      const lightId = `light-merlin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
      const lightType = (args.type as WorldLight['type']) || 'point'
      const lightPos = args.position
        ? (args.position as [number, number, number])
        : ([0, 5, 0] as [number, number, number])
      const light: WorldLight = {
        id: lightId,
        type: lightType,
        color: (args.color as string) || '#ffffff',
        intensity: typeof args.intensity === 'number' ? args.intensity : 3,
        position: lightPos,
        visible: true,
      }
      state.lights = [...(state.lights || []), light]
      return { ok: true, message: `Added ${lightType} light (${lightId}) color=${light.color} intensity=${light.intensity}` }
    }

    case 'set_sky': {
      const presetId = args.presetId as string
      state.skyBackgroundId = presetId
      return { ok: true, message: `Sky set to ${presetId}` }
    }

    case 'set_ground': {
      const presetId = args.presetId as string
      state.groundPresetId = presetId
      return { ok: true, message: `Ground set to ${presetId}` }
    }

    case 'set_behavior': {
      const objectId = args.objectId as string
      if (!state.behaviors) state.behaviors = {}
      const movType = (args.movement as string) || 'static'
      // Build a default MovementPreset based on the type string
      const movement: import('@/lib/conjure/types').MovementPreset =
        movType === 'spin' ? { type: 'spin', axis: 'y', speed: 1 } :
        movType === 'hover' ? { type: 'hover', amplitude: 0.5, speed: 1, offset: 0 } :
        movType === 'orbit' ? { type: 'orbit', radius: 2, speed: 1, axis: 'xz' } :
        movType === 'bounce' ? { type: 'bounce', height: 1, speed: 1 } :
        movType === 'patrol' ? { type: 'patrol', radius: 3, speed: 1 } :
        { type: 'static' }
      const existingBehavior = state.behaviors[objectId]
      state.behaviors[objectId] = {
        visible: existingBehavior?.visible ?? true,
        movement,
        ...(args.label ? { label: args.label as string } : existingBehavior?.label ? { label: existingBehavior.label } : {}),
      }
      return { ok: true, message: `Set behavior on ${objectId}: movement=${movType}` }
    }

    case 'clear_world': {
      if (!args.confirm) return { ok: false, message: 'clear_world requires confirm: true' }
      state.catalogPlacements = []
      state.craftedScenes = []
      state.lights = []
      state.transforms = {}
      state.behaviors = {}
      return { ok: true, message: 'World cleared' }
    }

    default:
      return { ok: false, message: `Unknown tool: ${name}` }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/merlin — Run Merlin on a world
// Body: { worldId: string, prompt: string }
// Returns: SSE stream of { type: 'text'|'tool'|'result'|'save'|'done'|'error', ... }
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  // Local mode: always admin

  const body = await request.json().catch(() => null)
  if (!body?.worldId || !body?.prompt) {
    return NextResponse.json({ error: 'worldId and prompt are required' }, { status: 400 })
  }

  const { worldId, prompt } = body as { worldId: string; prompt: string }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })
  }

  // Load world from local SQLite
  const { prisma } = await import('@/lib/db')
  const worldRow = await prisma.world.findUnique({ where: { id: worldId } })

  if (!worldRow) {
    return NextResponse.json({ error: 'World not found' }, { status: 404 })
  }

  const userId = worldRow.userId
  const existingData = (worldRow.data ? JSON.parse(worldRow.data) : {}) as Partial<WorldState>

  // Mutable world state that tools modify in place
  const state: WorldState = {
    version: 1,
    terrain: existingData.terrain ?? null,
    groundPresetId: existingData.groundPresetId ?? 'none',
    groundTiles: existingData.groundTiles ?? {},
    craftedScenes: existingData.craftedScenes ?? [],
    conjuredAssetIds: existingData.conjuredAssetIds ?? [],
    catalogPlacements: existingData.catalogPlacements ?? [],
    transforms: existingData.transforms ?? {},
    behaviors: existingData.behaviors ?? {},
    lights: existingData.lights ?? [],
    skyBackgroundId: existingData.skyBackgroundId ?? 'night007',
    savedAt: new Date().toISOString(),
  }

  // Compact world summary for Merlin's context
  function worldSummary(): string {
    const catalogCount = state.catalogPlacements?.length || 0
    const craftedCount = state.craftedScenes?.length || 0
    const lightCount = state.lights?.length || 0
    const catalogIds = (state.catalogPlacements || []).map(p => `${p.id} (${p.catalogId}) at [${p.position?.join(',')}]`).join('\n  ')
    const craftedIds = (state.craftedScenes || []).map(s => `${s.id} "${s.name}"`).join('\n  ')
    return [
      `Sky: ${state.skyBackgroundId}, Ground: ${state.groundPresetId}`,
      `Catalog objects (${catalogCount}): ${catalogIds || 'none'}`,
      `Crafted scenes (${craftedCount}): ${craftedIds || 'none'}`,
      `Lights: ${lightCount}`,
    ].join('\n')
  }

  // ─═̷─═̷─ SSE STREAM SETUP ─═̷─═̷─
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController
  const stream = new ReadableStream({
    start(c) { controller = c },
  })

  function send(event: Record<string, unknown>) {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      // stream closed
    }
  }

  // Save state to Supabase — triggers Realtime subscription in browser
  async function persist() {
    await saveWorld(worldId, userId, {
      terrain: state.terrain,
      groundPresetId: state.groundPresetId,
      groundTiles: state.groundTiles,
      craftedScenes: state.craftedScenes,
      conjuredAssetIds: state.conjuredAssetIds,
      catalogPlacements: state.catalogPlacements,
      transforms: state.transforms,
      behaviors: state.behaviors,
      lights: state.lights,
      skyBackgroundId: state.skyBackgroundId,
    })
    send({ type: 'save', savedAt: new Date().toISOString() })
  }

  // ─═̷─═̷─ AGENTIC TOOL LOOP ─═̷─═̷─
  ;(async () => {
    try {
      const messages: Array<{ role: string; content: string | unknown[] }> = [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `Current world state:\n${worldSummary()}\n\nUser request: ${prompt}`,
        },
      ]

      let iteration = 0
      const MAX_ITERATIONS = 20 // safety cap

      while (iteration < MAX_ITERATIONS) {
        iteration++

        const llmRes = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://app.04515.xyz',
            'X-Title': 'Oasis Merlin',
          },
          body: JSON.stringify({
            model: MERLIN_MODEL,
            messages,
            tools: MERLIN_TOOLS,
            tool_choice: 'auto',
          }),
        })

        if (!llmRes.ok) {
          const errText = await llmRes.text()
          send({ type: 'error', message: `LLM error ${llmRes.status}: ${errText}` })
          break
        }

        const llmData = await llmRes.json() as {
          choices: Array<{
            message: {
              role: string
              content: string | null
              tool_calls?: Array<{
                id: string
                function: { name: string; arguments: string }
              }>
            }
            finish_reason: string
          }>
        }

        const choice = llmData.choices?.[0]
        if (!choice) {
          send({ type: 'error', message: 'No choices in LLM response' })
          break
        }

        const msg = choice.message

        // Stream any text content to client
        if (msg.content) {
          send({ type: 'text', content: msg.content })
        }

        // No tool calls = we're done
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          break
        }

        // ─═̷─═̷─ OpenAI-compat format ─═̷─═̷─
        // Assistant message: { role: 'assistant', content, tool_calls }
        // Tool results: { role: 'tool', tool_call_id, content } — one per call
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        } as never) // cast — our message type is simplified, OpenRouter accepts this

        for (const toolCall of msg.tool_calls) {
          const toolName = toolCall.function.name
          let toolArgs: Record<string, unknown> = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}')
          } catch {
            toolArgs = {}
          }

          send({ type: 'tool', name: toolName, args: toolArgs })

          const result = execTool(toolName, toolArgs, state)
          send({ type: 'result', name: toolName, ok: result.ok, message: result.message })

          // Save to Supabase after each successful tool call → triggers Realtime → browser updates live
          if (result.ok) {
            await persist()
          }

          // OpenAI format: each tool result is its own message with role: 'tool'
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.message,
          } as never)
        }
      }

      if (iteration >= MAX_ITERATIONS) {
        send({ type: 'text', content: '[Merlin] Reached tool call limit — world saved.' })
        await persist()
      }

      send({ type: 'done', worldId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Merlin] Fatal error:', msg)
      send({ type: 'error', message: msg })
    } finally {
      controller.close()
    }
  })()

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

// ▓▓▓▓【M̸E̸R̸L̸I̸N̸】▓▓▓▓ॐ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【A̸G̸E̸N̸T̸】▓▓▓▓

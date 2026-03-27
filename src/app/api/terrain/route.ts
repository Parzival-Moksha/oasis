// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/terrain — LLM terrain parameter generation
// ─═̷─═̷─ॐ─═̷─═̷─ Describe a world, receive its DNA ─═̷─═̷─ॐ─═̷─═̷─
// Takes "the shire" → returns noise params, palette, water level.
// The actual terrain generation happens client-side (instant).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import type { TerrainParams } from '../../../lib/forge/terrain-generator'

const ALLOWED_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'z-ai/glm-5',
  'x-ai/grok-4.20-beta',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3.5-397b-a17b',
  'liquid/lfm-2-24b-a2b',
  'openai/gpt-5.4',
  'google/gemini-3.1-pro-preview',
  'minimax/minimax-m2.7',
]
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6'

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — teach the model to think in terrain parameters
// ═══════════════════════════════════════════════════════════════════════════════

const TERRAIN_SYSTEM_PROMPT = `You are a terrain architect for a 3D world builder. Given a description of a world or landscape, you generate terrain parameters that will be used to procedurally generate the terrain.

The terrain is generated using layered simplex noise with vertex coloring based on height bands.

Parameters you control:
- name: A short poetic name for this terrain
- size: World size in meters (32-128, default 64)
- resolution: Vertices per side (64-256, default 128). Higher = more detail but slower.
- heightScale: Maximum height in meters (1-30). Flat plains = 2-4, rolling hills = 5-8, mountains = 10-20, epic peaks = 20-30.
- noiseOctaves: Detail layers 1-8. Low = smooth, high = rugged. Plains = 2-3, hills = 4-5, mountains = 6-8.
- noisePersistence: How much each octave matters (0.2-0.7). Low = smooth, high = noisy/rough.
- noiseLacunarity: Frequency multiplier per octave (1.5-3.0). Higher = more fine detail variation.
- noiseScale: Base frequency (0.01-0.08). Low = big features, high = busy.
- seed: Random seed (any integer). Different seeds = different worlds with same parameters.
- waterLevel: Normalized 0-1. 0 = no water, 0.1 = small ponds, 0.25 = rivers/lakes, 0.4 = archipelago, 0.6 = mostly ocean.
- palette: Hex colors for height bands:
  - deepWater: Ocean depths
  - shallowWater: Near-shore water
  - sand: Beach / shoreline
  - grass: Lowlands
  - forest: Mid-elevation
  - rock: High elevation
  - snow: Peaks

Examples:
- "The Shire" → low heightScale (4), rolling octaves (4), pastoral greens, low water (0.2), warm palette
- "Mordor" → high heightScale (20), jagged octaves (7), high persistence, volcanic reds/blacks, lava rivers
- "Arctic tundra" → medium height (8), smooth (3 octaves), whites/blues/grays, moderate water (0.3)
- "Desert dunes" → low height (5), smooth (2-3 octaves), sand/amber/orange palette, no water (0)
- "Space station" → very flat (1), minimal octaves (1), metallic grays, no water (0)

RESPOND WITH ONLY VALID JSON. No markdown, no explanation, no code fences.
The JSON must match the TerrainParams schema above.`

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function isHex(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
}

function validateTerrainParams(raw: unknown): { valid: boolean; params?: TerrainParams; error?: string } {
  if (!raw || typeof raw !== 'object') return { valid: false, error: 'Response is not an object' }

  const obj = raw as Record<string, unknown>

  const name = typeof obj.name === 'string' ? obj.name : 'Unnamed Terrain'
  const size = clamp(Number(obj.size) || 64, 32, 128)
  const resolution = clamp(Number(obj.resolution) || 128, 64, 256)
  const heightScale = clamp(Number(obj.heightScale) || 6, 1, 30)
  const noiseOctaves = clamp(Math.round(Number(obj.noiseOctaves) || 5), 1, 8)
  const noisePersistence = clamp(Number(obj.noisePersistence) || 0.45, 0.1, 0.8)
  const noiseLacunarity = clamp(Number(obj.noiseLacunarity) || 2.1, 1.2, 4.0)
  const noiseScale = clamp(Number(obj.noiseScale) || 0.025, 0.005, 0.1)
  const seed = Math.round(Number(obj.seed) || Math.random() * 999999)
  const waterLevel = clamp(Number(obj.waterLevel) || 0, 0, 0.8)

  // Validate palette
  const rawPalette = (obj.palette && typeof obj.palette === 'object') ? obj.palette as Record<string, unknown> : {}
  const palette = {
    deepWater: isHex(rawPalette.deepWater) ? rawPalette.deepWater : '#1a3a5c',
    shallowWater: isHex(rawPalette.shallowWater) ? rawPalette.shallowWater : '#2980b9',
    sand: isHex(rawPalette.sand) ? rawPalette.sand : '#e8d68c',
    grass: isHex(rawPalette.grass) ? rawPalette.grass : '#4a7c2e',
    forest: isHex(rawPalette.forest) ? rawPalette.forest : '#2d5a1e',
    rock: isHex(rawPalette.rock) ? rawPalette.rock : '#6b6b6b',
    snow: isHex(rawPalette.snow) ? rawPalette.snow : '#f0f0f0',
  }

  const features = Array.isArray(obj.features) ? obj.features.filter((f): f is string => typeof f === 'string') : []

  return {
    valid: true,
    params: {
      name, size, resolution, heightScale,
      noiseOctaves, noisePersistence, noiseLacunarity, noiseScale,
      seed, waterLevel, palette, features,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/terrain — Generate terrain params from text
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, model: requestedModel } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: 'Prompt too long (2000 char max)' }, { status: 400 })
    }

    // Local mode — no credits. Bring your own API keys.

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'LLM provider not configured' }, { status: 500 })
    }

    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://parzival.dev',
        'X-Title': 'Oasis Terrain',
      },
      body: JSON.stringify({
        model: (typeof requestedModel === 'string' && ALLOWED_MODELS.includes(requestedModel)) ? requestedModel : DEFAULT_MODEL,
        messages: [
          { role: 'system', content: TERRAIN_SYSTEM_PROMPT },
          { role: 'user', content: `Design terrain parameters for: ${prompt.trim()}` },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    })

    if (!llmResponse.ok) {
      const err = await llmResponse.text()
      console.error('[Terrain] OpenRouter error:', err)
      return NextResponse.json({ error: 'LLM request failed' }, { status: 502 })
    }

    const llmData = await llmResponse.json()
    const content = llmData.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'Empty LLM response' }, { status: 502 })
    }

    let parsed: unknown
    try {
      const cleaned = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('[Terrain] Failed to parse LLM JSON:', content.slice(0, 200))
      return NextResponse.json({ error: 'LLM returned invalid JSON' }, { status: 502 })
    }

    const validation = validateTerrainParams(parsed)
    if (!validation.valid || !validation.params) {
      console.error('[Terrain] Invalid params:', validation.error)
      return NextResponse.json({ error: `Invalid terrain params: ${validation.error}` }, { status: 502 })
    }

    console.log(`[Terrain] Generated: "${validation.params.name}" (${validation.params.size}m, h=${validation.params.heightScale})`)

    return NextResponse.json({ params: validation.params }, { status: 201 })

  } catch (err) {
    console.error('[Terrain] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ▓▓▓▓【T̸E̸R̸R̸A̸I̸N̸】▓▓▓▓ॐ▓▓▓▓【A̸P̸I̸】▓▓▓▓

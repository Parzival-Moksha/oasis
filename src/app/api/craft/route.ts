// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/craft — LLM procedural geometry endpoint
// ─═̷─═̷─ॐ─═̷─═̷─ Words → JSON → Primitives → World ─═̷─═̷─ॐ─═̷─═̷─
// Takes a text prompt, asks Claude to design a scene using primitives,
// returns a CraftedScene that the frontend renders instantly.
// No generation wait. No API polling. Pure silicon imagination.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import type { CraftedScene, CraftedPrimitive, PrimitiveType, CraftAnimation, CraftAnimationType } from '../../../lib/conjure/types'
import { CRAFT_SYSTEM_PROMPT } from '../../../lib/craft-prompt'

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

// System prompt is now shared — see src/lib/craft-prompt.ts

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION — make sure LLM output is a real scene
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_TYPES: PrimitiveType[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'text',
  'flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora',
]
const VALID_ANIM_TYPES: CraftAnimationType[] = ['rotate', 'bob', 'pulse', 'swing', 'orbit']
const VALID_AXES = ['x', 'y', 'z'] as const
const VALID_PARTICLE_TYPES = ['spark', 'ember', 'snow', 'bubble', 'firefly', 'dust'] as const

function validateAnimation(raw: unknown): CraftAnimation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  if (typeof a.type !== 'string' || !VALID_ANIM_TYPES.includes(a.type as CraftAnimationType)) return undefined
  return {
    type: a.type as CraftAnimationType,
    ...(typeof a.speed === 'number' && { speed: Math.max(0.1, Math.min(10, a.speed)) }),
    ...(typeof a.axis === 'string' && VALID_AXES.includes(a.axis as typeof VALID_AXES[number]) && { axis: a.axis as 'x' | 'y' | 'z' }),
    ...(typeof a.amplitude === 'number' && { amplitude: Math.max(0.01, Math.min(20, a.amplitude)) }),
  }
}

function validateScene(raw: unknown): { valid: boolean; scene?: { name: string; objects: CraftedPrimitive[] }; error?: string } {
  if (!raw || typeof raw !== 'object') return { valid: false, error: 'Response is not an object' }

  const obj = raw as Record<string, unknown>
  if (!obj.name || typeof obj.name !== 'string') return { valid: false, error: 'Missing or invalid name' }
  if (!Array.isArray(obj.objects) || obj.objects.length === 0) return { valid: false, error: 'Missing or empty objects array' }

  const validObjects: CraftedPrimitive[] = []

  for (const item of obj.objects) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>

    const type = o.type as string
    if (!VALID_TYPES.includes(type as PrimitiveType)) continue

    const position = Array.isArray(o.position) && o.position.length === 3
      ? o.position.map(Number) as [number, number, number]
      : [0, 0.5, 0] as [number, number, number]

    const scale = Array.isArray(o.scale) && o.scale.length === 3
      ? o.scale.map(Number) as [number, number, number]
      : [1, 1, 1] as [number, number, number]

    const rotation = Array.isArray(o.rotation) && o.rotation.length === 3
      ? o.rotation.map(Number) as [number, number, number]
      : undefined

    const color = typeof o.color === 'string' && o.color.startsWith('#') ? o.color : '#888888'

    const animation = validateAnimation(o.animation)

    validObjects.push({
      type: type as PrimitiveType,
      position,
      scale,
      color,
      ...(rotation && { rotation }),
      ...(typeof o.metalness === 'number' && { metalness: Math.max(0, Math.min(1, o.metalness)) }),
      ...(typeof o.roughness === 'number' && { roughness: Math.max(0, Math.min(1, o.roughness)) }),
      ...(typeof o.emissive === 'string' && o.emissive.startsWith('#') && { emissive: o.emissive }),
      ...(typeof o.emissiveIntensity === 'number' && { emissiveIntensity: Math.max(0, Math.min(2, o.emissiveIntensity)) }),
      ...(typeof o.opacity === 'number' && { opacity: Math.max(0, Math.min(1, o.opacity)) }),
      ...(animation && { animation }),
      // Text-specific fields
      ...(type === 'text' && typeof o.text === 'string' && { text: o.text.slice(0, 500) }),
      ...(type === 'text' && typeof o.fontSize === 'number' && { fontSize: Math.max(0.1, Math.min(20, o.fontSize)) }),
      ...(type === 'text' && typeof o.anchorX === 'string' && ['left', 'center', 'right'].includes(o.anchorX) && { anchorX: o.anchorX as 'left' | 'center' | 'right' }),
      ...(type === 'text' && typeof o.anchorY === 'string' && ['top', 'middle', 'bottom'].includes(o.anchorY) && { anchorY: o.anchorY as 'top' | 'middle' | 'bottom' }),
      // Shader primitive parameters
      ...(typeof o.color2 === 'string' && o.color2.startsWith('#') && { color2: o.color2 }),
      ...(typeof o.color3 === 'string' && o.color3.startsWith('#') && { color3: o.color3 }),
      ...(typeof o.intensity === 'number' && { intensity: Math.max(0.1, Math.min(5, o.intensity)) }),
      ...(typeof o.speed === 'number' && { speed: Math.max(0.1, Math.min(10, o.speed)) }),
      ...(typeof o.particleCount === 'number' && { particleCount: Math.max(10, Math.min(500, Math.round(o.particleCount))) }),
      ...(typeof o.particleType === 'string' && VALID_PARTICLE_TYPES.includes(o.particleType as typeof VALID_PARTICLE_TYPES[number]) && { particleType: o.particleType as typeof VALID_PARTICLE_TYPES[number] }),
      ...(typeof o.seed === 'number' && { seed: Math.max(0, Math.min(100, o.seed)) }),
    })
  }

  if (validObjects.length === 0) return { valid: false, error: 'No valid primitives found in response' }

  // ░▒▓ POST-PROCESSING: kill parasitic ground planes ▓▒░
  // LLMs love adding green/brown flat planes at y≈0 as "ground" — our world already has ground.
  // Filter: plane/box with y < 0.15, one axis squished to < 0.15 (thin), and large footprint (> 3m²)
  const filtered = validObjects.filter(p => {
    const [, py] = p.position
    const [sx, sy, sz] = p.scale
    const isFlat = (p.type === 'plane' || p.type === 'box') && Math.min(sx, sy, sz) < 0.15
    const isLargeFootprint = Math.max(sx, sz) * Math.max(...[sx, sy, sz].filter((_, i) => i !== [sx, sy, sz].indexOf(Math.min(sx, sy, sz)))) > 3
    const isGroundLevel = py < 0.15
    if (isFlat && isLargeFootprint && isGroundLevel) {
      console.log(`[Craft] Filtered parasitic ground primitive: ${p.type} at y=${py} scale=[${p.scale}] color=${p.color}`)
      return false
    }
    return true
  })

  return { valid: true, scene: { name: obj.name, objects: filtered.length > 0 ? filtered : validObjects } }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/craft — Generate a scene from text
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
        'X-Title': 'Oasis Craft',
      },
      body: JSON.stringify({
        model: (typeof requestedModel === 'string' && ALLOWED_MODELS.includes(requestedModel)) ? requestedModel : DEFAULT_MODEL,
        messages: [
          { role: 'system', content: CRAFT_SYSTEM_PROMPT },
          { role: 'user', content: `Design a 3D scene for: ${prompt.trim()}` },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    })

    if (!llmResponse.ok) {
      const err = await llmResponse.text()
      console.error('[Craft] OpenRouter error:', err)
      return NextResponse.json({ error: 'LLM request failed' }, { status: 502 })
    }

    const llmData = await llmResponse.json()
    const content = llmData.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'Empty LLM response' }, { status: 502 })
    }

    // Parse the JSON response
    let parsed: unknown
    try {
      // Strip markdown fences if the LLM wrapped it (they sometimes do despite instructions)
      const cleaned = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('[Craft] Failed to parse LLM JSON:', content.slice(0, 200))
      return NextResponse.json({ error: 'LLM returned invalid JSON' }, { status: 502 })
    }

    // Validate the scene
    const validation = validateScene(parsed)
    if (!validation.valid || !validation.scene) {
      console.error('[Craft] Invalid scene:', validation.error)
      return NextResponse.json({ error: `Invalid scene: ${validation.error}` }, { status: 502 })
    }

    // Build the CraftedScene
    const scene: CraftedScene = {
      id: `craft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: validation.scene.name,
      prompt: prompt.trim(),
      objects: validation.scene.objects,
      position: [0, 0, 0],
      createdAt: new Date().toISOString(),
    }

    console.log(`[Craft] Scene generated: "${scene.name}" with ${scene.objects.length} primitives`)

    return NextResponse.json({ scene }, { status: 201 })

  } catch (err) {
    console.error('[Craft] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ▓▓▓▓【C̸R̸A̸F̸T̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓

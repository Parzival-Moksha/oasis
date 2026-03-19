// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/craft — LLM procedural geometry endpoint
// ─═̷─═̷─ॐ─═̷─═̷─ Words → JSON → Primitives → World ─═̷─═̷─ॐ─═̷─═̷─
// Takes a text prompt, asks Claude to design a scene using primitives,
// returns a CraftedScene that the frontend renders instantly.
// No generation wait. No API polling. Pure silicon imagination.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import type { CraftedScene, CraftedPrimitive, PrimitiveType, CraftAnimation, CraftAnimationType } from '../../../lib/conjure/types'
import { auth } from '../../../lib/auth'

const ALLOWED_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'z-ai/glm-5',
  'moonshotai/kimi-k2.5',
]
const DEFAULT_MODEL = 'moonshotai/kimi-k2.5'

// ═══════════════════════════════════════════════════════════════════════════════
// LLM SYSTEM PROMPT — teach the model to think in primitives
// ═══════════════════════════════════════════════════════════════════════════════

const CRAFT_SYSTEM_PROMPT = `You are a master 3D scene architect and sculptor. Given a text description, you design rich, detailed scenes using geometric primitives. You think in volumes, silhouettes, and composition.

Available primitive types: box, sphere, cylinder, cone, torus, plane, capsule, text

For each primitive, specify:
- type: one of the primitive types
- position: [x, y, z] — y is UP. Ground is y=0. Place objects ON the ground (y = half their height).
- rotation: [x, y, z] in radians (optional, default [0,0,0]). USE ROTATION to angle roofs, lean objects, create diagonals — don't just place axis-aligned boxes.
- scale: [x, y, z] — the SIZE of the object. A unit box at scale [1,1,1] is 1m cubed. Use non-uniform scaling creatively (e.g. [3, 0.1, 2] for a flat tabletop, [0.1, 2, 1] for a thin wall).
- color: hex color string like "#FF0000"
- metalness: 0-1 (optional, default 0). Use 0.3-0.8 for metal objects.
- roughness: 0-1 (optional, default 0.7). Lower = shinier. Glass ~0.1, polished metal ~0.2, wood ~0.6, stone ~0.9.
- emissive: hex color for glow (optional). Great for lamps, screens, neon, fire, eyes.
- emissiveIntensity: 0-5 (optional). 0.5 = subtle glow, 2+ = bright light source.
- opacity: 0-1 (optional, default 1). Use <1 for glass, water, holograms, ghosts.

CRITICAL RULES:
- NEVER add ground, floor, grass, terrain, or base planes. The 3D world already has its own ground system. Your objects float at y=0 and that is the ground. Do NOT create any horizontal planes/boxes meant to represent ground or floor surfaces beneath objects.
- NEVER add sky, background, or environmental objects. Only create the requested object/scene itself.

Composition techniques — think like a sculptor, not a placer:
- OVERLAP primitives to create complex shapes (a mushroom cap = flattened sphere overlapping a cylinder stem)
- Use THIN BOXES (scale one axis to 0.02-0.1) for walls, panels, shelves, book covers, fins
- Use ROTATED CYLINDERS for pipes, rails, handles, axles, branches
- Use TORUS for rings, wreaths, handles, donuts, halos, tire rims
- Use CONE for roofs, spikes, icicles, horns, funnels, tree tops
- Use CAPSULE for rounded poles, limbs, fingers, organic tubes
- Stack spheres for snowmen, clouds, bushes, molecular structures
- Combine 2-3 thin boxes at angles for X-shaped or star-shaped supports
- Nest smaller primitives INSIDE larger transparent ones for eyes, cockpits, terrariums

Scale reference (real-world):
- Human: ~1.8m tall. Door: 1m wide, 2m tall. Chair seat: 0.45m high.
- Table: 0.75m high. Car: 4m long, 1.5m wide, 1.4m tall. Tree: 3-8m tall.
- Window: 0.8m wide, 1.2m tall. Book: 0.15m x 0.22m x 0.03m.

Color & material guide:
- Wood: #8B4513 to #D2691E, roughness 0.6-0.8
- Metal: #888888 to #C0C0C0, metalness 0.5-0.9, roughness 0.1-0.4
- Glass: #88CCFF, metalness 0.1, roughness 0.05, opacity 0.3
- Brick: #8B3A3A, roughness 0.9. Stone: #808080, roughness 0.85
- Foliage: #228B22 to #006400. Bark: #4A3728. Sand: #C2B280
- Neon/glow: any bright color as emissive, emissiveIntensity 1-3
- Fabric: roughness 0.9-1.0, metalness 0

TEXT PRIMITIVES — Real extruded 3D text rendered in the world:
When type is "text", add these fields:
- text: string — the actual text content. Keep it SHORT (1-3 words per primitive). For longer text, use multiple text primitives.
- fontSize: number — size in world units (default 1). 0.3 for labels, 1-2 for signs, 3+ for titles.
Text is TRUE 3D with depth/extrusion and beveled edges — it looks solid from all angles. Combine with emissive + emissiveIntensity for neon/glowing text, or metalness for chrome/gold lettering.
Use text for: signs, labels, neon text, floating titles, nameplates, price tags, billboards, monument inscriptions, shop signs, trophies, game HUD elements.
Example: { "type": "text", "text": "OASIS", "position": [0, 3, 0], "scale": [1,1,1], "fontSize": 2, "color": "#FF00FF", "emissive": "#FF00FF", "emissiveIntensity": 2 }
Example gold sign: { "type": "text", "text": "WELCOME", "position": [0, 2.5, -3], "scale": [1,1,1], "fontSize": 1.5, "color": "#FFD700", "metalness": 0.9, "roughness": 0.1 }

Target 8-50 primitives per scene. Simple objects need 8-15. Complex scenes (buildings, vehicles, landscapes) use 25-50. Each primitive should serve a purpose.

RESPOND WITH ONLY VALID JSON. No markdown, no explanation, no code fences.
The JSON must match this exact schema:
{
  "name": "short scene name",
  "objects": [
    {
      "type": "box",
      "position": [0, 0.5, 0],
      "scale": [1, 1, 1],
      "color": "#888888"
    }
  ]
}`

const CRAFT_ANIMATION_ADDON = `
ANIMATIONS — bringing this scene to LIFE:
Every scene you build should feel alive. Add an "animation" object to primitives that should move:
- type: "rotate" — continuous rotation (windmill blades, planets, gears, fans, spinning signs, propellers)
- type: "bob" — float up and down (hovering objects, buoys, breathing chest, UFOs, magic orbs)
- type: "pulse" — scale oscillation (heartbeat, glowing orb, breathing creature, pulsing beacon)
- type: "swing" — pendulum oscillation (hanging sign, pendulum, chandelier, swinging door, clock hands)
- type: "orbit" — orbit around its original position (electrons, moons, orbiting debris, satellites)

Animation parameters:
- speed: number (default 1, higher = faster. 0.5 = slow and dreamy, 2 = energetic)
- axis: "x" | "y" | "z" (default "y". Which axis the animation acts on)
- amplitude: number (default 0.5. Bob height in meters, swing angle in radians, orbit radius in meters)

Use animations PURPOSEFULLY — animate the parts that SHOULD move while keeping structural elements static. A windmill: blades rotate, walls don't. A solar system: planets orbit, the sun pulses. A campfire: flames bob and pulse, logs stay still. Animate 2-8 primitives per scene.

Animation field goes on the object: { "type": "box", "position": [0,0.5,0], "scale": [1,1,1], "color": "#888", "animation": { "type": "rotate", "speed": 1, "axis": "y" } }
`

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION — make sure LLM output is a real scene
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_TYPES: PrimitiveType[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'text']
const VALID_ANIM_TYPES: CraftAnimationType[] = ['rotate', 'bob', 'pulse', 'swing', 'orbit']
const VALID_AXES = ['x', 'y', 'z'] as const

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
      ...(typeof o.emissiveIntensity === 'number' && { emissiveIntensity: Math.max(0, Math.min(5, o.emissiveIntensity)) }),
      ...(typeof o.opacity === 'number' && { opacity: Math.max(0, Math.min(1, o.opacity)) }),
      ...(animation && { animation }),
      // Text-specific fields
      ...(type === 'text' && typeof o.text === 'string' && { text: o.text.slice(0, 500) }),
      ...(type === 'text' && typeof o.fontSize === 'number' && { fontSize: Math.max(0.1, Math.min(20, o.fontSize)) }),
      ...(type === 'text' && typeof o.anchorX === 'string' && ['left', 'center', 'right'].includes(o.anchorX) && { anchorX: o.anchorX as 'left' | 'center' | 'right' }),
      ...(type === 'text' && typeof o.anchorY === 'string' && ['top', 'middle', 'bottom'].includes(o.anchorY) && { anchorY: o.anchorY as 'top' | 'middle' | 'bottom' }),
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
    const { prompt, model: requestedModel, animated } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: 'Prompt too long (2000 char max)' }, { status: 400 })
    }

    // ░▒▓ AUTH + CREDIT CHECK — crafting costs a fraction of a credit ▓▒░
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Local mode — no credits. Bring your own API keys.

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'LLM provider not configured' }, { status: 500 })
    }

    // Call OpenRouter → Claude for scene generation
    // Conditionally include animation instructions based on user toggle
    const systemPrompt = animated
      ? CRAFT_SYSTEM_PROMPT + CRAFT_ANIMATION_ADDON
      : CRAFT_SYSTEM_PROMPT + '\n\nIMPORTANT: Do NOT add any "animation" fields. All objects must be completely static.'

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
          { role: 'system', content: systemPrompt },
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

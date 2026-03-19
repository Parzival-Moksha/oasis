// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/craft/stream — STREAMING LLM procedural geometry
// ─═̷─═̷─ॐ─═̷─═̷─ Tokens flow → objects materialize one by one ─═̷─═̷─ॐ─═̷─═̷─
// Same auth + credit logic as /api/craft, but streams raw LLM text
// so the frontend can parse partial JSON and render objects incrementally.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'

const ALLOWED_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'z-ai/glm-5',
  'moonshotai/kimi-k2.5',
]
const DEFAULT_MODEL = 'moonshotai/kimi-k2.5'

// Reuse the same system prompt from the non-streaming route
// (imported as string to avoid circular deps — kept in sync manually)
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, model: requestedModel, animated } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (prompt.length > 2000) {
      return new Response(JSON.stringify({ error: 'Prompt too long' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    // Local mode — no credits. Bring your own API keys.

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LLM provider not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const systemPrompt = animated
      ? CRAFT_SYSTEM_PROMPT + CRAFT_ANIMATION_ADDON
      : CRAFT_SYSTEM_PROMPT + '\n\nIMPORTANT: Do NOT add any "animation" fields. All objects must be completely static.'

    // Call OpenRouter with streaming enabled
    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://parzival.dev',
        'X-Title': 'Oasis Craft Stream',
      },
      body: JSON.stringify({
        model: (typeof requestedModel === 'string' && ALLOWED_MODELS.includes(requestedModel)) ? requestedModel : DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Design a 3D scene for: ${prompt.trim()}` },
        ],
        temperature: 0.7,
        stream: true,
        response_format: { type: 'json_object' },
      }),
    })

    if (!llmResponse.ok) {
      const err = await llmResponse.text()
      console.error('[Craft:Stream] OpenRouter error:', err)
      return new Response(JSON.stringify({ error: 'LLM request failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }

    if (!llmResponse.body) {
      return new Response(JSON.stringify({ error: 'No stream body' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }

    // Transform OpenRouter SSE → raw text stream for the frontend
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const upstreamReader = llmResponse.body.getReader()

    const stream = new ReadableStream({
      async start(controller) {
        let sseBuffer = ''
        try {
          while (true) {
            const { done, value } = await upstreamReader.read()
            if (done) break

            sseBuffer += decoder.decode(value, { stream: true })
            const lines = sseBuffer.split('\n')
            sseBuffer = lines.pop() || '' // keep incomplete line

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  controller.enqueue(encoder.encode(content))
                }
              } catch {
                // malformed SSE chunk — skip
              }
            }
          }
        } catch (err) {
          console.error('[Craft:Stream] Stream error:', err)
        } finally {
          controller.close()
        }
      },
    })

    console.log(`[Craft:Stream] Streaming scene for: "${prompt.trim().slice(0, 60)}"`)

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })

  } catch (err) {
    console.error('[Craft:Stream] Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

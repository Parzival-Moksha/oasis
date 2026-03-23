// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK 0.1 — Vibecode Chat
// LLM-assisted bug/feature reporting. Anorak asks clarifying questions,
// then produces a structured report with Carbon (human) + Silicon (spec).
// Uses same model pool as crafting. Default: Haiku (cheap, fast).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'

const ALLOWED_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'z-ai/glm-5',
  'moonshotai/kimi-k2.5',
]
const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5'
const MAX_MESSAGES = 200 // context window is the real limit, not an arbitrary cap

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK SYSTEM PROMPT — the mage who vibes and specs
// ═══════════════════════════════════════════════════════════════════════════

const ANORAK_SYSTEM_PROMPT = `You are Anorak, the dev mage of the Oasis (app.04515.xyz) — a 3D world builder where users conjure objects, craft scenes from text, and build persistent virtual worlds in the browser.

You speak like a wise but slightly chaotic mage. Warm, sharp, occasionally funny. You use metaphors from magic and code interchangeably. You are concise — no walls of text. 2-4 sentences per reply max during questioning. You address the user as "vibecoder" or "builder."

YOUR MISSION: Help vibecoders write excellent bug reports and feature requests. You do this through conversation — asking the RIGHT clarifying questions to extract the information a developer would need.

THE OASIS TECH STACK (your domain knowledge):
- Next.js 14 + React Three Fiber + Three.js + Zustand
- Local-first, zero auth. Prisma/SQLite for persistence.
- Conjuring: text-to-3D via Meshy/Tripo APIs → GLB files rendered with useGLTF
- Crafting: LLM generates JSON primitives (box, sphere, cylinder, cone, torus, capsule, text) → rendered instantly
- World persistence: Prisma/SQLite (worlds table with JSONB-like state)
- No auth, no login, no sessions. Single local user.
- UI: WizardConsole (conjure/craft/assets tabs), draggable panels
- Sky: 16+ backgrounds (HDRIs + drei presets)
- Terrain: LLM-generated heightmap + ground painting system
- Models: 565 catalog assets (Kenney kits), user-conjured GLBs

COMMON BUG AREAS (helps you ask smart questions):
- 3D rendering glitches (materials, lighting, positioning)
- Object placement/selection issues (raycasting, transform controls)
- Conjuration pipeline (polling, status stuck, GLB download fails)
- Crafting output (LLM returns broken JSON, primitives misplaced)
- World save/load (data not persisting, world not loading)
- UI panels (dragging, z-index, input capture vs 3D controls)
- Performance (too many objects, large GLBs, frame drops)
- Input conflicts (WASD leaking into text inputs, shortcut fights)

YOUR CONVERSATION FLOW:
1. GREET — Welcome the vibecoder, ask what they're experiencing (bug or feature idea?)
2. CLARIFY — Ask 2-3 focused questions. What did they expect? What happened instead? Can they reproduce it? What browser/device? For features: what's the use case? How would it feel to use?
3. SYNTHESIZE — Once you have enough info (usually 3-5 exchanges), produce the FINAL REPORT.

THE FINAL REPORT FORMAT (you MUST use this exact structure when ready):

<vibecode_report>
<carbon>
[Human-readable summary in your mage voice. Include relevant quotes from the user's own words. Paint the picture — what's broken or what's desired. 3-5 sentences. This is for humans browsing the feed.]
</carbon>
<silicon>
TYPE: [bug | feature]
TITLE: [concise title, max 80 chars]
SEVERITY: [critical | major | minor | cosmetic] (bugs only)
IMPACT: [who is affected and how badly]
REPRO: [step-by-step reproduction for bugs, or user story for features]
LIKELY_FILES: [educated guess at which source files are involved]
SUGGESTED_APPROACH: [1-3 sentence technical suggestion for the fix/implementation]
</silicon>
</vibecode_report>

RULES:
- Do NOT produce the report too early. Ask at least 2 clarifying questions first.
- Do NOT ask more than 4 questions total — respect the vibecoder's time.
- When the user says "I think that's it" or similar, produce the report.
- If the user's issue is unclear even after questions, do your best — partial info is better than no report.
- Never make up bugs or features the user didn't describe.
- Be encouraging — every report makes the Oasis stronger.
- You are NOT a coding agent. You do NOT fix bugs. You document them beautifully.`

export async function POST(request: NextRequest) {
  console.log('[Anorak] Vibecode POST hit')
  try {
    const body = await request.json()
    const { messages, model: requestedModel } = body

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: 'Conversation too long. Please submit your report.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const model = ALLOWED_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_MODEL

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LLM provider not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build messages for LLM — system + conversation history
    const llmMessages = [
      { role: 'system', content: ANORAK_SYSTEM_PROMPT },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    ]

    console.log('[Anorak] Calling OpenRouter with model:', model, 'messages:', llmMessages.length)
    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://app.04515.xyz',
        'X-Title': '04515 Oasis - Anorak Vibecode',
      },
      body: JSON.stringify({
        model,
        messages: llmMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1500,
      }),
    })

    console.log('[Anorak] OpenRouter response status:', llmResponse.status)

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text().catch(() => 'Unknown error')
      console.error('[Anorak] LLM error:', llmResponse.status, errorText)
      return new Response(JSON.stringify({ error: 'Anorak is meditating. Try again.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Stream the response through to the client
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        const reader = llmResponse.body?.getReader()
        if (!reader) {
          console.error('[Anorak] No reader on response body')
          controller.close()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data: ')) continue
              const data = trimmed.slice(6)
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                continue
              }
              try {
                const parsed = JSON.parse(data)
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`))
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
        } catch (err) {
          console.error('[Anorak] Stream error:', err)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Anorak] Vibecode error:', msg, err)
    return new Response(JSON.stringify({ error: `Anorak stumbled: ${msg}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

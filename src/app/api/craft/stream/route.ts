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
  'x-ai/grok-4.20-beta',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3.5-397b-a17b',
  'liquid/lfm-2-24b-a2b',
  'openai/gpt-5.4',
  'google/gemini-3.1-pro-preview',
  'minimax/minimax-m2.7',
]
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6'

import { CRAFT_SYSTEM_PROMPT } from '../../../../lib/craft-prompt'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, model: requestedModel } = body

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
          { role: 'system', content: CRAFT_SYSTEM_PROMPT },
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

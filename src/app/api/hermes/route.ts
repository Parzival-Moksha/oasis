import { NextRequest, NextResponse } from 'next/server'

import { resolveHermesConfig } from '@/lib/hermes-config'

export const dynamic = 'force-dynamic'

type ClientMessage = {
  role?: string
  content?: unknown
}

function rootBaseFromApiBase(apiBase: string): string {
  return apiBase.replace(/\/v1$/i, '')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function canUseHermesProxy(request: NextRequest): boolean {
  if (process.env.OASIS_ALLOW_REMOTE_HERMES_PROXY === 'true') return true

  const host = request.headers.get('host') || ''
  const hostName = host.split(':')[0]?.toLowerCase() || ''
  if (!isLoopbackHost(hostName)) return false

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && !isLoopbackHost(forwardedHost.split(':')[0] || '')) return false

  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  if (forwardedFor && forwardedFor !== '127.0.0.1' && forwardedFor !== '::1' && forwardedFor !== '[::1]') return false

  return true
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return true

  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true

    const [hostName, hostPort = ''] = host.split(':')
    const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')
    const requestPort = hostPort || (originUrl.protocol === 'https:' ? '443' : '80')

    return isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostName) && originPort === requestPort
  } catch {
    return false
  }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).join('')
  if (!value || typeof value !== 'object') return ''

  const obj = value as Record<string, unknown>
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.content === 'string') return obj.content
  if (obj.text && typeof obj.text === 'object') return extractText(obj.text)
  if (typeof obj.value === 'string') return obj.value
  if (typeof obj.reasoning === 'string') return obj.reasoning

  return ''
}

function buildMessages(history: ClientMessage[], prompt: string, systemPrompt: string) {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }

  for (const entry of history.slice(-20)) {
    if (entry.role !== 'user' && entry.role !== 'assistant') continue
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (!content) continue
    messages.push({ role: entry.role, content })
  }

  messages.push({ role: 'user', content: prompt })
  return messages
}

function makeSseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}

function serializeSse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function getSsePayloads(buffer: string): { payloads: string[]; remainder: string } {
  const normalized = buffer.replace(/\r/g, '')
  const blocks = normalized.split('\n\n')
  const remainder = blocks.pop() || ''

  const payloads = blocks
    .map(block =>
      block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim()
    )
    .filter(Boolean)

  return { payloads, remainder }
}

async function readErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 1200)
  } catch {
    return `HTTP ${response.status}`
  }
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesProxy(request)) {
    return NextResponse.json({
      error: 'Hermes proxy is localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
  }

  const config = await resolveHermesConfig()
  if (!config.apiKey) {
    return NextResponse.json({
      configured: false,
      connected: false,
      source: config.source,
      base: config.apiBase,
      defaultModel: config.defaultModel || null,
      models: [],
      error: 'Hermes is not paired. Click pair and paste the setup block from Hermes.',
    })
  }

  try {
    const modelsResponse = await fetch(`${config.apiBase}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      cache: 'no-store',
    })

    if (modelsResponse.ok) {
      const data = await modelsResponse.json().catch(() => ({}))
      const models = Array.isArray(data?.data)
        ? data.data
            .map((entry: unknown) =>
              entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
                ? (entry as { id: string }).id
                : null
            )
            .filter((entry: string | null): entry is string => Boolean(entry))
        : []

      return NextResponse.json({
        configured: true,
        connected: true,
        source: config.source,
        base: config.apiBase,
        defaultModel: config.defaultModel || models[0] || null,
        models,
      })
    }

    const healthResponse = await fetch(`${rootBaseFromApiBase(config.apiBase)}/health`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      cache: 'no-store',
    }).catch(() => null)

    return NextResponse.json({
      configured: true,
      connected: Boolean(healthResponse?.ok),
      source: config.source,
      base: config.apiBase,
      defaultModel: config.defaultModel || null,
      models: [],
      error: await readErrorText(modelsResponse),
    })
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      source: config.source,
      base: config.apiBase,
      defaultModel: config.defaultModel || null,
      models: [],
      error: error instanceof Error ? error.message : 'Unable to reach Hermes upstream.',
    })
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesProxy(request)) {
    return NextResponse.json({
      error: 'Hermes proxy is localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
  }

  const config = await resolveHermesConfig()
  if (!config.apiKey) {
    return NextResponse.json({ error: 'Hermes is not paired. Save a pairing block first.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null) as {
    message?: unknown
    history?: ClientMessage[]
    model?: unknown
  } | null

  const prompt = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!prompt) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }

  const history = Array.isArray(body?.history) ? body.history : []
  const requestedModel = typeof body?.model === 'string' ? body.model.trim() : ''
  const model = requestedModel || config.defaultModel || 'hermes'

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(`${config.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: buildMessages(history, prompt, config.systemPrompt),
      }),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Hermes upstream request failed.' },
      { status: 502 }
    )
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      {
        error: `Hermes upstream returned HTTP ${upstreamResponse.status}.`,
        detail: await readErrorText(upstreamResponse),
      },
      { status: 502 }
    )
  }

  if (!upstreamResponse.body) {
    return NextResponse.json({ error: 'Hermes upstream returned no stream body.' }, { status: 502 })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const upstreamReader = upstreamResponse.body.getReader()

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = ''

      const emit = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(serializeSse(payload)))
      }

      emit({ type: 'meta', model, upstream: config.apiBase })

      try {
        while (true) {
          const { done, value } = await upstreamReader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const { payloads, remainder } = getSsePayloads(buffer)
          buffer = remainder

          for (const payload of payloads) {
            if (payload === '[DONE]') {
              emit({ type: 'done' })
              continue
            }

            try {
              const parsed = JSON.parse(payload) as Record<string, unknown>
              if (parsed.error && typeof parsed.error === 'object') {
                const error = parsed.error as { message?: unknown }
                emit({ type: 'error', message: typeof error.message === 'string' ? error.message : 'Hermes upstream error.' })
                continue
              }

              const choice = Array.isArray(parsed.choices) ? parsed.choices[0] as Record<string, unknown> | undefined : undefined
              const delta = (choice?.delta as Record<string, unknown> | undefined) || {}

              const content = extractText(delta.content)
              if (content) emit({ type: 'text', content })

              const reasoning = extractText(delta.reasoning ?? delta.reasoning_content ?? parsed.reasoning)
              if (reasoning) emit({ type: 'reasoning', content: reasoning })

              const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
              toolCalls.forEach((call, index) => {
                if (!call || typeof call !== 'object') return
                const toolCall = call as {
                  index?: unknown
                  id?: unknown
                  function?: { name?: unknown; arguments?: unknown }
                }

                emit({
                  type: 'tool',
                  index: typeof toolCall.index === 'number' ? toolCall.index : index,
                  id: typeof toolCall.id === 'string' ? toolCall.id : undefined,
                  name: typeof toolCall.function?.name === 'string' ? toolCall.function.name : undefined,
                  argumentsChunk: extractText(toolCall.function?.arguments),
                })
              })

              const usage = parsed.usage && typeof parsed.usage === 'object'
                ? parsed.usage as Record<string, unknown>
                : null

              if (usage) {
                emit({
                  type: 'usage',
                  promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
                  completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
                  totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
                })
              }

              if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
                emit({ type: 'done', finishReason: choice.finish_reason })
              }
            } catch {
              // Skip malformed upstream chunks.
            }
          }
        }
      } catch (error) {
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : 'Hermes stream parsing failed.',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: makeSseHeaders() })
}

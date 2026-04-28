import { spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { NextRequest } from 'next/server'

import { getAgentSessionRecord, upsertAgentSessionRecord } from '@/lib/agent-session-registry'
import { resolveCodexModelSettings } from '@/lib/codex-models'
import { buildCodexOasisPrompt } from '@/lib/codex-oasis-prompt'
import { describeCodexTool, humanizeCodexItemType } from '@/lib/codex-presentation'
import { recordTokenBurn } from '@/lib/token-burn'
import { extractCodexTokenUsage, hasTokenUsage } from '@/lib/token-usage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type JsonObject = Record<string, unknown>

interface CodexRequestBody {
  prompt: string
  sessionId?: string
  model?: string
  images?: string[]
  oasisContext?: JsonObject
}

const OASIS_ROOT = process.cwd()
const OASIS_MCP_URL = process.env.OASIS_CODEX_MCP_URL || 'http://127.0.0.1:4516/api/mcp/oasis'

const CODEX_STRIP_ENV_KEYS = new Set([
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_ORGANIZATION',
  'OPENAI_PROJECT',
  'OPENAI_REALTIME_API_KEY',
])

const CODEX_STRIP_ENV_PREFIXES = [
  '__NEXT',
  'NEXT_PRIVATE_',
  'TURBO',
  'TURBOPACK',
  'WEBPACK_',
]

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function stringField(record: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function numberField(record: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function objectField(record: JsonObject, ...keys: string[]): JsonObject | undefined {
  for (const key of keys) {
    const value = record[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject
  }
  return undefined
}

function arrayField(record: JsonObject, ...keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

function trimJsonText(value: string, maxLength = 4000): { preview: string; length: number; fullResult?: string } {
  const normalized = value.replace(/\r\n/g, '\n')
  return {
    preview: normalized.slice(0, 1200),
    length: normalized.length,
    ...(normalized.length <= maxLength ? { fullResult: normalized } : {}),
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function humanizeItemType(type: string): string {
  return type.replace(/_/g, ' ')
}

function codexToolIcon(type: string): string {
  switch (type) {
    case 'command_execution':
      return '⚡'
    case 'mcp_tool_call':
      return '🧩'
    case 'web_search':
      return '🔎'
    case 'file_change':
      return '📝'
    case 'plan_update':
      return '🗺'
    default:
      return '🔧'
  }
}

function normalizeToolInput(item: JsonObject): Record<string, unknown> | undefined {
  switch (stringField(item, 'type')) {
    case 'command_execution':
      return stringField(item, 'command') ? { command: stringField(item, 'command') } : undefined
    case 'mcp_tool_call':
      return objectField(item, 'arguments', 'args', 'input')
    case 'web_search':
      return stringField(item, 'query') ? { query: stringField(item, 'query') } : undefined
    case 'file_change': {
      const input: Record<string, unknown> = {}
      const path = stringField(item, 'path', 'file_path')
      const summary = stringField(item, 'summary')
      if (path) input.path = path
      if (summary) input.summary = summary
      return Object.keys(input).length > 0 ? input : undefined
    }
    case 'plan_update': {
      const plan = arrayField(item, 'plan')
      return plan ? { plan } : undefined
    }
    default:
      return objectField(item, 'arguments', 'args', 'input')
  }
}

function presentTool(item: JsonObject) {
  return describeCodexTool({
    type: stringField(item, 'type'),
    command: stringField(item, 'command'),
    serverName: stringField(item, 'server_name', 'serverName', 'server'),
    toolName: stringField(item, 'tool_name', 'toolName', 'tool', 'name'),
    title: stringField(item, 'title'),
    summary: stringField(item, 'summary'),
    name: stringField(item, 'name'),
    query: stringField(item, 'query'),
    path: stringField(item, 'path', 'file_path'),
  })
}

function summarizeToolResult(item: JsonObject): { preview: string; length: number; fullResult?: string } {
  const explicitText = stringField(item, 'aggregated_output', 'result', 'output', 'summary', 'text')
  if (explicitText) return trimJsonText(explicitText)

  const diff = arrayField(item, 'changes', 'files')
  if (diff) return trimJsonText(safeJsonStringify(diff))

  const outputObject = objectField(item, 'result', 'output')
  if (outputObject) return trimJsonText(safeJsonStringify(outputObject))

  return trimJsonText(`${humanizeCodexItemType(stringField(item, 'type') || 'item')} completed`)
}

function summarizeTurnFailure(raw: JsonObject): string {
  return stringField(raw, 'message', 'error', 'detail') || 'Codex turn failed'
}

function buildCodexArgs(args: {
  model: string
  sessionId?: string
  images: string[]
}): string[] {
  const configArgs = [
    '-c',
    'forced_login_method="chatgpt"',
    '-c',
    `mcp_servers.oasis.url="${OASIS_MCP_URL}"`,
  ]
  const baseArgs = ['exec']
  if (args.sessionId) {
    return [
      ...baseArgs,
      'resume',
      ...configArgs,
      '--json',
      '--model',
      args.model,
      '--dangerously-bypass-approvals-and-sandbox',
      ...args.images.flatMap(image => ['--image', image]),
      args.sessionId,
      '-',
    ]
  }

  return [
    ...baseArgs,
    ...configArgs,
    '--json',
    '--model',
    args.model,
    '--dangerously-bypass-approvals-and-sandbox',
    ...args.images.flatMap(image => ['--image', image]),
    '-',
  ]
}

function buildCodexCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  for (const key of Object.keys(env)) {
    if (CODEX_STRIP_ENV_KEYS.has(key) || CODEX_STRIP_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      delete env[key]
    }
  }

  return env
}

function finishStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  closedRef: { current: boolean },
) {
  if (closedRef.current) return
  closedRef.current = true
  try {
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
  } catch {
    // Ignore closed streams.
  }
  try {
    controller.close()
  } catch {
    // Ignore closed streams.
  }
}

function terminateChild(child: ChildProcessWithoutNullStreams | null) {
  if (!child || child.killed) return
  try {
    child.kill('SIGTERM')
  } catch {
    // Ignore termination failures.
  }
}

export async function POST(request: NextRequest) {
  let body: CodexRequestBody
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const sessionId = body.sessionId?.trim()
  const existingRecord = sessionId ? await getAgentSessionRecord(sessionId) : null
  if (existingRecord && existingRecord.agentType !== 'codex') {
    return new Response(JSON.stringify({ error: `Session ${sessionId} belongs to ${existingRecord.agentType}` }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const modelSettings = await resolveCodexModelSettings()
  const selectedModel = body.model?.trim() || existingRecord?.model || modelSettings.defaultModel
  const images = Array.isArray(body.images)
    ? body.images.filter((image): image is string => typeof image === 'string' && image.trim().length > 0)
    : []
  const codexPrompt = buildCodexOasisPrompt(prompt, asRecord(body.oasisContext))
  const codexPath = process.platform === 'win32' ? 'codex.cmd' : 'codex'
  const args = buildCodexArgs({
    model: selectedModel,
    sessionId,
    images,
  })

  const encoder = new TextEncoder()

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      let eventCounter = 0
      let child: ChildProcessWithoutNullStreams | null = null
      let capturedSessionId = sessionId || ''
      let stdoutBuffer = ''
      let stderrTail = ''
      let latestUsage = {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        sessionId: capturedSessionId,
        provider: 'openai',
        model: selectedModel,
      }
      const closedRef = { current: false }
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clearInterval(keepAlive)
        }
      }, 15000)
      const handleAbort = () => {
        clearInterval(keepAlive)
        terminateChild(child)
      }
      const sentTools = new Set<string>()
      const textSnapshots = new Map<string, string>()
      const reasoningSnapshots = new Map<string, string>()

      const sendEvent = (type: string, data: Record<string, unknown>) => {
        if (closedRef.current) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, _id: eventCounter++, ...data })}\n\n`))
        } catch {
          // Stream closed by client.
        }
      }

      const handleToolStart = (item: JsonObject) => {
        const itemId = stringField(item, 'id')
        if (!itemId || sentTools.has(itemId)) return
        sentTools.add(itemId)
        const presentation = presentTool(item)
        sendEvent('tool', {
          id: itemId,
          name: presentation.name,
          icon: presentation.icon,
          input: normalizeToolInput(item),
          display: presentation.display,
        })
      }

      const handleAgentMessage = (item: JsonObject) => {
        const itemId = stringField(item, 'id')
        const text = stringField(item, 'text')
        if (!itemId || !text) return
        const previous = textSnapshots.get(itemId) || ''
        const nextText = text.startsWith(previous) ? text.slice(previous.length) : text
        if (nextText) {
          sendEvent('text', { content: nextText })
        }
        textSnapshots.set(itemId, text)
      }

      const handleReasoning = (item: JsonObject) => {
        const itemId = stringField(item, 'id')
        const content = stringField(item, 'summary', 'text', 'content')
        if (!itemId || !content) return
        const previous = reasoningSnapshots.get(itemId)
        if (previous !== content) {
          sendEvent('thinking', { content })
          reasoningSnapshots.set(itemId, content)
        }
      }

      const handleToolResult = (item: JsonObject) => {
        const itemId = stringField(item, 'id')
        if (!itemId) return
        handleToolStart(item)
        const presentation = presentTool(item)
        const result = summarizeToolResult(item)
        const exitCode = numberField(item, 'exit_code')
        sendEvent('tool_result', {
          name: presentation.name,
          toolUseId: itemId,
          preview: result.preview,
          isError: typeof exitCode === 'number' ? exitCode !== 0 : stringField(item, 'status') === 'failed',
          length: result.length,
          ...(result.fullResult ? { fullResult: result.fullResult } : {}),
        })
      }

      try {
        child = spawn(codexPath, args, {
          cwd: OASIS_ROOT,
          env: buildCodexCliEnv(),
          shell: true,
        })
      } catch (error) {
        clearInterval(keepAlive)
        sendEvent('error', {
          content: error instanceof Error ? error.message : 'Failed to start Codex',
        })
        sendEvent('done', {
          success: false,
          ...latestUsage,
          sessionId: capturedSessionId || latestUsage.sessionId,
        })
        finishStream(controller, encoder, closedRef)
        return
      }

      child.stdin.write(codexPrompt)
      child.stdin.end()

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString()
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          let raw: JsonObject
          try {
            raw = JSON.parse(trimmed) as JsonObject
          } catch {
            continue
          }

          const type = stringField(raw, 'type')
          switch (type) {
            case 'thread.started': {
              capturedSessionId = stringField(raw, 'thread_id') || capturedSessionId
              latestUsage = {
                ...latestUsage,
                sessionId: capturedSessionId || latestUsage.sessionId,
              }
              if (capturedSessionId) {
                void upsertAgentSessionRecord(capturedSessionId, 'codex', { model: selectedModel }).catch(() => {})
                sendEvent('session', { sessionId: capturedSessionId })
              }
              break
            }
            case 'item.started':
            case 'item.updated':
            case 'item.completed': {
              const item = asRecord(raw.item)
              const itemType = stringField(item, 'type')
              if (!itemType) break

              if (itemType === 'agent_message') {
                handleAgentMessage(item)
                break
              }

              if (itemType === 'reasoning') {
                handleReasoning(item)
                break
              }

              if (type === 'item.started') {
                handleToolStart(item)
              }

              if (type === 'item.completed') {
                handleToolResult(item)
              }
              break
            }
            case 'turn.completed': {
              const usage = objectField(raw, 'usage') || {}
              const usagePayload = extractCodexTokenUsage(usage, {
                sessionId: capturedSessionId,
                provider: 'openai',
                model: selectedModel,
              })
              latestUsage = {
                ...latestUsage,
                ...usagePayload,
                cachedInputTokens: usagePayload.cachedInputTokens || 0,
                sessionId: capturedSessionId || usagePayload.sessionId,
              }
              sendEvent('result', latestUsage)
              break
            }
            case 'turn.failed': {
              sendEvent('error', { content: summarizeTurnFailure(raw) })
              break
            }
            case 'error': {
              sendEvent('error', {
                content: stringField(raw, 'message', 'error', 'detail') || 'Codex returned an error',
              })
              break
            }
            default:
              break
          }
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = `${stderrTail}${chunk.toString()}`
        if (stderrTail.length > 4000) {
          stderrTail = stderrTail.slice(-4000)
        }
      })

      child.on('error', (error) => {
        clearInterval(keepAlive)
        request.signal.removeEventListener('abort', handleAbort)
        sendEvent('error', {
          content: error.message || 'Failed to start Codex',
        })
        sendEvent('done', {
          success: false,
          ...latestUsage,
          sessionId: capturedSessionId || latestUsage.sessionId,
        })
        finishStream(controller, encoder, closedRef)
      })

      child.on('close', async (code) => {
        clearInterval(keepAlive)
        request.signal.removeEventListener('abort', handleAbort)
        if (stdoutBuffer.trim()) {
          try {
            const trailing = JSON.parse(stdoutBuffer.trim()) as JsonObject
            if (stringField(trailing, 'type') === 'turn.completed') {
              const usage = objectField(trailing, 'usage') || {}
              const usagePayload = extractCodexTokenUsage(usage, {
                sessionId: capturedSessionId,
                provider: 'openai',
                model: selectedModel,
              })
              latestUsage = {
                ...latestUsage,
                ...usagePayload,
                cachedInputTokens: usagePayload.cachedInputTokens || 0,
                sessionId: capturedSessionId || usagePayload.sessionId,
              }
            }
          } catch {
            // Ignore trailing incomplete output.
          }
        }

        if (code !== 0 && stderrTail.trim()) {
          sendEvent('error', {
            content: stderrTail.trim().split(/\r?\n/).slice(-6).join('\n'),
          })
        }

        if (capturedSessionId) {
          void upsertAgentSessionRecord(capturedSessionId, 'codex', { model: selectedModel }).catch(() => {})
        }

        latestUsage = {
          ...latestUsage,
          sessionId: capturedSessionId || latestUsage.sessionId,
        }

        if (hasTokenUsage(latestUsage)) {
          try {
            await recordTokenBurn({
              source: 'codex',
              ...latestUsage,
            })
          } catch (error) {
            console.warn('[Codex] Failed to persist token burn:', error)
          }
        }

        sendEvent('done', {
          success: code === 0,
          ...latestUsage,
          sessionId: capturedSessionId || latestUsage.sessionId,
        })
        finishStream(controller, encoder, closedRef)
      })

      request.signal.addEventListener('abort', handleAbort)
    },
    cancel() {
      // The request abort listener handles child cleanup.
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

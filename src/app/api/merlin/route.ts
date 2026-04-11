import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { getAgentSessionRecord, upsertAgentSessionRecord } from '@/lib/agent-session-registry'
import { buildClaudeCliEnv } from '@/lib/claude-cli-env'
import { prisma } from '@/lib/db'
import type { WorldState } from '@/lib/forge/world-persistence'
import {
  publishWorldPlayerContext,
  type RuntimePlayerContext as PromptPlayerContext,
} from '@/lib/world-runtime-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()
const MERLIN_AGENT_PATH = path.join(OASIS_ROOT, '.claude', 'agents', 'merlin.md')
const MERLIN_MCP_CONFIG_DIR = path.join(OASIS_ROOT, '.claude-code-mcp')
const MERLIN_BOOTSTRAP_PREFIX = '[MERLIN_AGENT_BOOTSTRAP]'
const MERLIN_MODELS = ['opus', 'sonnet', 'haiku'] as const
const DEFAULT_MERLIN_MODEL = 'opus'

type MerlinModel = typeof MERLIN_MODELS[number]

const MEDIA_TOOL_NAMES = new Set([
  'generate_image',
  'generate_voice',
  'generate_video',
  'mcp__mission__generate_image',
  'mcp__mission__generate_voice',
  'mcp__mission__generate_video',
  'mcp_mission_generate_image',
  'mcp_mission_generate_voice',
  'mcp_mission_generate_video',
])

const SCREENSHOT_TOOL_NAMES = new Set([
  'screenshot_viewport',
  'screenshot_avatar',
  'avatarpic_merlin',
  'avatarpic_user',
  'mcp__oasis__screenshot_viewport',
  'mcp_oasis_screenshot_viewport',
])


function resolveMerlinModel(model: unknown): MerlinModel {
  return typeof model === 'string' && MERLIN_MODELS.includes(model as MerlinModel)
    ? model as MerlinModel
    : DEFAULT_MERLIN_MODEL
}

function sanitizeWorldId(worldId: unknown): string {
  return typeof worldId === 'string' ? worldId.trim() : ''
}

function readToolNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function readToolVec3(value: unknown): [number, number, number] | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value.slice(0, 3).map(Number)
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
  }

  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed) && parsed.length >= 3) {
      const [x, y, z] = parsed.slice(0, 3).map(Number)
      return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
    }
  } catch {
    // Fall back to token parsing below.
  }

  const parts = trimmed
    .replace(/^[\[\(\{]\s*/, '')
    .replace(/\s*[\]\)\}]$/, '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length < 3) return undefined
  const [x, y, z] = parts.slice(0, 3).map(Number)
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
}

function normalizeToolName(name: string): string {
  if (!name) return 'tool'
  return name
    .replace(/^mcp__oasis__/, '')
    .replace(/^mcp__mission__/, '')
    .replace(/^mcp_oasis_/, '')
    .replace(/^mcp_mission_/, '')
}

function readMerlinAgentSpec(): string {
  try {
    return fs.readFileSync(MERLIN_AGENT_PATH, 'utf-8').trim()
  } catch (error) {
    console.warn('[Merlin] Failed to read merlin.md:', error)
    return [
      '# Merlin',
      '',
      'You are Merlin, the Oasis world-builder.',
      'Use only mcp__oasis__* and mcp__mission__* tools.',
      'Do not use coding tools.',
      'Keep building until the user is satisfied.',
    ].join('\n')
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'active'
}

function ensureMerlinMcpConfig(worldId: string): string {
  const safeWorldId = sanitizeFileSegment(worldId)
  const configPath = path.join(MERLIN_MCP_CONFIG_DIR, `merlin-${safeWorldId}.json`)
  const config = {
    mcpServers: {
      oasis: {
        command: 'node',
        args: [path.join(OASIS_ROOT, 'tools/oasis-mcp/index.js')],
        cwd: OASIS_ROOT,
        env: {
          OASIS_DB_PATH: path.join(OASIS_ROOT, 'prisma/data/oasis.db'),
          OASIS_ACTIVE_WORLD_ID: worldId,
          OASIS_URL: process.env.OASIS_URL || 'http://localhost:4516',
          OASIS_AGENT_TYPE: 'merlin',
        },
      },
      mission: {
        command: 'node',
        args: [path.join(OASIS_ROOT, 'tools/mission-mcp/index.js')],
        cwd: OASIS_ROOT,
        env: {
          OASIS_DB_PATH: path.join(OASIS_ROOT, 'prisma/data/oasis.db'),
          OASIS_URL: 'http://localhost:4516',
          OASIS_AGENT_TYPE: 'merlin',
        },
      },
    },
  }

  const json = JSON.stringify(config, null, 2)
  fs.mkdirSync(MERLIN_MCP_CONFIG_DIR, { recursive: true })
  try {
    const existing = fs.readFileSync(configPath, 'utf-8')
    if (existing === json) return configPath
  } catch {
    // Write a fresh config below.
  }
  fs.writeFileSync(configPath, json)
  return configPath
}

function formatPromptVec3(value: [number, number, number]): string {
  return `[${value.map(component => Number.isFinite(component) ? Number(component.toFixed(2)) : component).join(', ')}]`
}

function parsePromptPlayerContext(value: unknown): PromptPlayerContext | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const avatarRecord = record.avatar && typeof record.avatar === 'object' ? record.avatar as Record<string, unknown> : null
  const cameraRecord = record.camera && typeof record.camera === 'object' ? record.camera as Record<string, unknown> : null

  const avatarPosition = avatarRecord ? readToolVec3(avatarRecord.position) : undefined
  const avatarForward = avatarRecord ? readToolVec3(avatarRecord.forward) : undefined
  const avatarYaw = avatarRecord ? readToolNumber(avatarRecord.yaw) : undefined
  const cameraPosition = cameraRecord ? readToolVec3(cameraRecord.position) : undefined
  const cameraForward = cameraRecord ? readToolVec3(cameraRecord.forward) : undefined

  const avatar = avatarPosition
    ? {
        position: avatarPosition,
        ...(avatarYaw !== undefined ? { yaw: avatarYaw } : {}),
        ...(avatarForward ? { forward: avatarForward } : {}),
      }
    : null
  const camera = cameraPosition
    ? {
        position: cameraPosition,
        ...(cameraForward ? { forward: cameraForward } : {}),
      }
    : null

  if (!avatar && !camera) return null
  return { avatar, camera }
}

async function buildMerlinRuntimeContext(worldId: string, playerContext?: PromptPlayerContext | null): Promise<string[]> {
  const context = [
    `- Oasis root: ${OASIS_ROOT}`,
    `- Active world ID: ${worldId}`,
    '- The Oasis MCP server is pinned to the active world above for this turn.',
    '- Stay in character as Merlin, but do the actual work with MCP tools.',
  ]

  if (playerContext?.avatar) {
    context.push(`- The user's live avatar body is at ${formatPromptVec3(playerContext.avatar.position)}.`)
    if (playerContext.avatar.forward) {
      context.push(`- The user's live avatar forward vector is ${formatPromptVec3(playerContext.avatar.forward)}.`)
    }
    context.push('- When the user says "me", "my avatar", or "come to me", they mean that live player avatar body above.')
  }
  if (playerContext?.camera) {
    context.push(`- The user's current camera is at ${formatPromptVec3(playerContext.camera.position)}.`)
    if (playerContext.camera.forward) {
      context.push(`- The user's camera forward vector is ${formatPromptVec3(playerContext.camera.forward)}.`)
    }
  }

  try {
    const world = await prisma.world.findFirst({
      where: { id: worldId },
      select: { name: true, data: true },
    })
    if (!world?.data) {
      context.push('- World snapshot unavailable at prompt-build time.')
      return context
    }

    const state = JSON.parse(world.data) as WorldState
    context.push(`- Active world name: ${world.name}`)

    const merlinAvatar = (state.agentAvatars || []).find(avatar => avatar.agentType === 'merlin') || null
    if (!merlinAvatar) {
      context.push('- You do not currently have a persisted Merlin avatar body in this world snapshot. If embodiment matters, use set_avatar.')
      return context
    }

    context.push(`- Your current in-world body: ${merlinAvatar.label || 'Merlin'} (${merlinAvatar.id})`)
    context.push(`- Your current position: ${formatPromptVec3(merlinAvatar.position)}`)
    context.push(`- Your current rotation: ${formatPromptVec3(merlinAvatar.rotation)}`)
    context.push(`- Your current scale: ${Number.isFinite(merlinAvatar.scale) ? Number(merlinAvatar.scale.toFixed(2)) : merlinAvatar.scale}`)
    if (typeof merlinAvatar.avatar3dUrl === 'string' && merlinAvatar.avatar3dUrl.trim()) {
      context.push(`- Your avatar model URL: ${merlinAvatar.avatar3dUrl.trim()}`)
    }
    if (typeof merlinAvatar.linkedWindowId === 'string' && merlinAvatar.linkedWindowId.trim()) {
      context.push(`- Your embodied window link: ${merlinAvatar.linkedWindowId.trim()}`)
    }
    context.push('- When reasoning about "toward me" vs "toward you", remember: you are the Merlin avatar above, not the player camera.')
    context.push('- For a behind-the-body self view, call screenshot_viewport with mode "third-person" and agentType "merlin".')
  } catch (error) {
    console.warn('[Merlin] Failed to build runtime avatar context:', error)
    context.push('- World snapshot unavailable at prompt-build time.')
  }

  return context
}

function buildInitialPrompt(runtimeContext: string[], prompt: string): string {
  const agentSpec = readMerlinAgentSpec()
  return [
    MERLIN_BOOTSTRAP_PREFIX,
    '',
    'Load and obey the Merlin agent spec below exactly. This is a persistent Claude Code CLI session for the Oasis world-builder.',
    '',
    agentSpec,
    '',
    '## Runtime Context',
    ...runtimeContext,
    '',
    '## Player Request',
    prompt.trim(),
  ].join('\n')
}

function buildResumePrompt(runtimeContext: string[], prompt: string): string {
  return [
    'Keep following the Merlin agent spec from this session.',
    'For screenshots, prefer your own phantom view unless the user explicitly asks for the player camera.',
    'For embodiment and composition around your body, prefer screenshot_viewport with mode "third-person" and agentType "merlin".',
    'When the user wants multiple angles, use one screenshot_viewport call with a views array instead of separate screenshot calls.',
    '',
    '## Runtime Context',
    ...runtimeContext,
    '',
    prompt.trim(),
  ].join('\n')
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim()
    if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.length > 1) {
      try {
        return extractToolResultText(JSON.parse(trimmed))
      } catch {
        return content
      }
    }
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (!item || typeof item !== 'object') return ''
        const typedItem = item as Record<string, unknown>
        if (typedItem.type === 'text' && typeof typedItem.text === 'string') return typedItem.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    const typedContent = content as Record<string, unknown>
    if (typeof typedContent.text === 'string') return typedContent.text
  }

  return ''
}

function collectMediaUrls(value: unknown, urls = new Set<string>()): string[] {
  if (typeof value === 'string') {
    const matches = value.match(/(?:https?:\/\/[^\s"'<>]+|\/(?:generated-(?:images|voices|videos)|merlin\/screenshots)\/[^\s"'<>]+)/g) || []
    for (const match of matches) urls.add(match)

    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
      try {
        collectMediaUrls(JSON.parse(trimmed), urls)
      } catch {
        // Keep regex-discovered URLs from the raw string.
      }
    }
    return [...urls]
  }

  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, urls)
    return [...urls]
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'url' && typeof nested === 'string') urls.add(nested)
      collectMediaUrls(nested, urls)
    }
  }

  return [...urls]
}


export async function POST(request: NextRequest) {
  let body: { worldId?: unknown; prompt?: unknown; sessionId?: unknown; model?: unknown; playerContext?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const worldId = sanitizeWorldId(body.worldId)
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const model = resolveMerlinModel(body.model)
  const playerContext = parsePromptPlayerContext(body.playerContext)

  if (!worldId || !prompt) {
    return NextResponse.json({ error: 'worldId and prompt are required' }, { status: 400 })
  }

  if (playerContext) {
    await publishWorldPlayerContext(worldId, playerContext)
  }

  if (requestedSessionId) {
    const existingRecord = await getAgentSessionRecord(requestedSessionId)
    if (existingRecord && existingRecord.agentType !== 'merlin') {
      return NextResponse.json({ error: 'That Claude Code session belongs to a different agent.' }, { status: 403 })
    }
  }

  const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  const mcpConfigPath = ensureMerlinMcpConfig(worldId)
  const isResume = Boolean(requestedSessionId)
  const args = [
    '--print',
    '--verbose',
    '--model', model,
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--mcp-config', mcpConfigPath,
  ]
  if (isResume) args.push('--resume', requestedSessionId)

  const runtimeContext = await buildMerlinRuntimeContext(worldId, playerContext)
  const fullPrompt = isResume
    ? buildResumePrompt(runtimeContext, prompt)
    : buildInitialPrompt(runtimeContext, prompt)

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    start(controller) {
      let eventCounter = 0
      let streamBuffer = ''
      let capturedSessionId = requestedSessionId || ''
      let latestAssistantSnapshot: Array<{
        type: string
        id?: string
        name?: string
        text?: string
        thinking?: string
        input?: Record<string, unknown>
      }> = []
      const toolUseIdToName = new Map<string, string>()
      const toolUseIdToInput = new Map<string, Record<string, unknown>>()
      const emittedToolInputs = new Set<string>()

      function sendEvent(type: string, data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, _id: eventCounter++, ...data })}\n\n`))
        } catch {
          // Stream is already closed.
        }
      }

      async function recordSession(sessionId: string) {
        if (!sessionId) return
        try {
          await upsertAgentSessionRecord(sessionId, 'merlin', { model })
        } catch (error) {
          console.warn('[Merlin] Failed to record session ownership:', error)
        }
      }

      if (requestedSessionId) {
        void recordSession(requestedSessionId)
      }

      const child = spawn(claudePath, args, {
        cwd: OASIS_ROOT,
        shell: true,
        env: buildClaudeCliEnv(),
      })

      child.stdin.write(fullPrompt)
      child.stdin.end()

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          // Ignore writes after close.
        }
      }, 15000)

      child.stdout.on('data', (chunk: Buffer) => {
        streamBuffer += chunk.toString()
        const lines = streamBuffer.split('\n')
        streamBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const raw = JSON.parse(line) as Record<string, unknown>
            const eventType = typeof raw.type === 'string' ? raw.type : 'unknown'

            if (eventType === 'system') {
              if (raw.subtype === 'init' && typeof raw.session_id === 'string' && raw.session_id.trim()) {
                capturedSessionId = raw.session_id.trim()
                sendEvent('session', { sessionId: capturedSessionId })
                void recordSession(capturedSessionId)
              }
              continue
            }

            if (eventType === 'assistant') {
              const message = (raw.message || {}) as Record<string, unknown>
              const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []

              for (let index = 0; index < content.length; index += 1) {
                const block = content[index]
                const previous = latestAssistantSnapshot[index]
                const blockType = typeof block.type === 'string' ? block.type : 'unknown'
                const blockId = typeof block.id === 'string' ? block.id : ''
                const isNewBlock = !previous || previous.type !== blockType || (blockId && previous.id !== blockId)

                if (blockType === 'text' && typeof block.text === 'string') {
                  const previousText = previous?.type === 'text' ? previous.text || '' : ''
                  if (isNewBlock || !previousText) {
                    sendEvent('text', { content: block.text })
                  } else if (block.text !== previousText) {
                    if (block.text.startsWith(previousText)) {
                      const delta = block.text.slice(previousText.length)
                      if (delta) sendEvent('text', { content: delta })
                    } else {
                      sendEvent('text', { content: `\n${block.text}` })
                    }
                  }
                  continue
                }

                if (blockType !== 'tool_use' || typeof block.name !== 'string') continue

                const rawToolName = block.name
                const normalizedToolName = normalizeToolName(rawToolName)
                const toolId = blockId || `tool-${eventCounter}`
                const toolInput = block.input && typeof block.input === 'object'
                  ? block.input as Record<string, unknown>
                  : {}
                const gainedInput = Object.keys(toolInput).length > 0 && !emittedToolInputs.has(toolId)

                toolUseIdToName.set(toolId, normalizedToolName)
                if (gainedInput) {
                  emittedToolInputs.add(toolId)
                  toolUseIdToInput.set(toolId, toolInput)
                }

                if (isNewBlock || gainedInput) {
                  sendEvent('tool', { name: normalizedToolName, args: toolInput })
                }
              }

              latestAssistantSnapshot = content.map(block => ({
                type: typeof block.type === 'string' ? block.type : 'unknown',
                id: typeof block.id === 'string' ? block.id : undefined,
                name: typeof block.name === 'string' ? block.name : undefined,
                text: typeof block.text === 'string' ? block.text : undefined,
                thinking: typeof block.thinking === 'string' ? block.thinking : undefined,
                input: block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : undefined,
              }))
              continue
            }

            if (eventType === 'user') {
              const message = (raw.message || {}) as Record<string, unknown>
              const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []

              for (const block of content) {
                if (block?.type !== 'tool_result') continue

                const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
                const toolName = toolUseIdToName.get(toolUseId) || 'tool'
                const toolInput = toolUseIdToInput.get(toolUseId) || {}
                const resultText = extractToolResultText(block.content)
                const mediaUrls = collectMediaUrls(block.content)
                const ok = block.is_error !== true

                sendEvent('result', {
                  name: toolName,
                  ok,
                  message: resultText,
                  mediaUrls: ok && (MEDIA_TOOL_NAMES.has(toolName) || SCREENSHOT_TOOL_NAMES.has(toolName)) && mediaUrls.length > 0
                    ? mediaUrls
                    : undefined,
                })
              }

              latestAssistantSnapshot = []
              continue
            }

            if (eventType === 'direct') {
              const tool = (raw.tool || {}) as Record<string, unknown>
              if (typeof tool.name === 'string') {
                sendEvent('tool', {
                  name: normalizeToolName(tool.name),
                  args: tool.input && typeof tool.input === 'object' ? tool.input as Record<string, unknown> : {},
                })
              }
              continue
            }
          } catch {
            // Ignore malformed NDJSON lines from Claude startup noise.
          }
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (!text) return
        if (text.includes('Resuming conversation')) return
        console.log(`[Merlin:stderr] ${text.substring(0, 300)}`)
      })

      child.on('error', (error) => {
        clearInterval(keepAlive)
        sendEvent('error', { message: `Failed to spawn Claude Code CLI: ${error.message}` })
        sendEvent('done', { sessionId: capturedSessionId, worldId, success: false })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      child.on('close', (code) => {
        clearInterval(keepAlive)
        sendEvent('done', {
          sessionId: capturedSessionId,
          worldId,
          success: code === 0,
        })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        child.kill('SIGTERM')
      })
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

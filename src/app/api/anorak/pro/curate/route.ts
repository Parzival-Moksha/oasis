// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO — Curate Route
// Spawns the curator agent (claude --agent curator) for mission enrichment.
// Streams curator output to SSE. Curator writes to DB via MCP tools.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import { prisma } from '@/lib/db'
const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()

interface ContextModuleConfig {
  rl?: boolean
  queued?: boolean
  allTodo?: boolean
}

interface CustomModule {
  name: string
  content: string
  enabled?: boolean
}

function buildCuratorPrompt(
  missions: { id: number; name: string; description: string | null; history: string | null; maturityLevel: number }[],
  contextModules?: ContextModuleConfig,
  customModules?: CustomModule[],
): string {
  const missionBlock = missions.map(m => {
    const historyStr = m.history ? `\nHistory:\n${m.history}` : ''
    return `## Mission #${m.id}: "${m.name}" (level ${m.maturityLevel})
Description: ${m.description || '(none)'}${historyStr}`
  }).join('\n\n---\n\n')

  const contextInstructions: string[] = []

  // Built-in context module toggles
  if (contextModules?.rl !== false) {
    contextInstructions.push('Read context/curator-rl.md for reinforcement learning signal (if it exists).')
  } else {
    contextInstructions.push('SKIP reading context/curator-rl.md — RL signal is disabled for this invocation.')
  }
  if (contextModules?.queued) {
    contextInstructions.push('Use get_missions_queue MCP tool to see all queued missions for cross-cutting context.')
  }
  if (contextModules?.allTodo) {
    contextInstructions.push('Use get_missions_queue MCP tool with status=todo to see all TODO missions.')
  }

  contextInstructions.push('Read CLAUDE.md for project context.')

  // Custom context modules
  const customBlock = (customModules || [])
    .filter(m => m.enabled !== false && m.content?.trim())
    .map(m => `## Context Module: ${m.name}\n${m.content}`)
    .join('\n\n')

  return `You are the Curator agent. Mature the following mission(s).

${contextInstructions.join('\n')}

For EACH mission:
1. Deep-dive the codebase (12-step methodology from your agent definition)
2. Write carbon description (vibes, zero jargon) and silicon description (precise spec)
3. Estimate flawless%, tag dharma paths, generate silicondev voice
4. Use the mature_mission MCP tool to write enrichment to the DB

${missionBlock}${customBlock ? `\n\n---\n\n${customBlock}` : ''}`
}

export async function POST(request: NextRequest) {
  let body: {
    missionIds?: number[]
    batchSize?: number
    model?: string
    contextModules?: ContextModuleConfig
    customModules?: CustomModule[]
  }

  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const VALID_MODELS = ['opus', 'sonnet', 'haiku']
  const { missionIds, batchSize = 1, contextModules } = body
  const model = VALID_MODELS.includes(body.model || '') ? body.model! : 'sonnet'

  // Server-side validation + sanitization of custom modules
  const customModules = (Array.isArray(body.customModules) ? body.customModules : [])
    .filter((m): m is CustomModule => m && typeof m.name === 'string' && typeof m.content === 'string')
    .slice(0, 20) // cap at 20
    .map(m => ({
      name: m.name.replace(/[#\n\r]/g, '').slice(0, 100), // strip markdown headers + newlines, cap length
      content: m.content.slice(0, 10000), // cap content
      enabled: m.enabled,
    }))

  // Resolve which missions to curate
  let missions
  if (missionIds?.length) {
    missions = await prisma.mission.findMany({
      where: { id: { in: missionIds } },
      select: { id: true, name: true, description: true, history: true, maturityLevel: true },
    })
  } else {
    // Auto-pick from curator queue or highest priority immature
    missions = await prisma.mission.findMany({
      where: {
        maturityLevel: { lt: 3 },
        assignedTo: { in: ['anorak', 'anorak-pro'] },
        curatorQueuePosition: { not: null },
      },
      orderBy: [
        { curatorQueuePosition: 'asc' },
        { priority: 'desc' },
      ],
      take: Math.min(batchSize, 5),
      select: { id: true, name: true, description: true, history: true, maturityLevel: true },
    })
  }

  if (!missions.length) {
    return new Response(JSON.stringify({ error: 'No missions to curate' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Create CuratorLog entry
  const log = await prisma.curatorLog.create({
    data: { missionsProcessed: missions.length },
  })

  const fullPrompt = buildCuratorPrompt(missions, contextModules, customModules)
  const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'

  // SSE stream
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    start(controller) {
      function send(type: string, data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
        } catch { /* controller closed */ }
      }

      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)) } catch {}
      }, 15000)

      send('status', { content: `Curator spawning for ${missions.length} mission(s)...`, logId: log.id })

      const args = [
        '--agent', 'curator',
        '--print',
        '--verbose',
        '--model', model,
        '--output-format', 'stream-json',
        '--dangerously-skip-permissions',
      ]

      const child = spawn(claudePath, args, {
        cwd: OASIS_ROOT,
        shell: true,
        env: { ...process.env },
      })

      child.stdin.write(fullPrompt)
      child.stdin.end()

      let buffer = ''
      const startTime = Date.now()
      let tokensIn = 0
      let tokensOut = 0

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            let event = JSON.parse(line)
            if (event.type === 'stream_event' && event.event) event = event.event
            const eventType = event.type || 'unknown'

            if (eventType === 'content_block_delta') {
              const delta = event.delta
              if (delta?.type === 'text_delta' && delta?.text) {
                send('text', { content: delta.text, lobe: 'curator' })
              } else if (delta?.type === 'thinking_delta' && delta?.thinking) {
                send('thinking', { content: delta.thinking, lobe: 'curator' })
              }
            } else if (eventType === 'tool_use') {
              const name = event.tool?.name || event.name || 'tool'
              send('tool', { name, lobe: 'curator' })
            } else if (eventType === 'tool_result') {
              const name = event.tool_name || event.name || 'tool'
              const result = event.result || event.content || ''
              const preview = (typeof result === 'string' ? result : JSON.stringify(result)).substring(0, 200)
              send('tool_result', { name, preview, lobe: 'curator' })
            } else if (eventType === 'result') {
              // Claude CLI stream-json: result event has total_input_tokens / total_output_tokens
              if (event.total_input_tokens) tokensIn = event.total_input_tokens
              if (event.total_output_tokens) tokensOut = event.total_output_tokens
              send('result', { cost_usd: event.cost_usd ?? event.total_cost_usd, lobe: 'curator' })
            }
          } catch {
            if (line.trim().length > 0 && line.trim().length < 300) {
              send('stderr', { content: line.trim(), lobe: 'curator' })
            }
          }
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text.length > 0 && text.length < 2000) {
          send('stderr', { content: text, lobe: 'curator' })
        }
      })

      child.on('error', (err) => {
        clearInterval(keepAlive)
        send('error', { content: `Curator spawn failed: ${err.message}` })
        prisma.curatorLog.update({
          where: { id: log.id },
          data: { status: 'failed', error: err.message, endedAt: new Date(), durationMs: Date.now() - startTime },
        }).catch(() => {})
        send('done', { success: false })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      child.on('close', (code) => {
        clearInterval(keepAlive)
        const durationMs = Date.now() - startTime
        prisma.curatorLog.update({
          where: { id: log.id },
          data: {
            status: code === 0 ? 'completed' : 'failed',
            endedAt: new Date(),
            durationMs,
            tokensIn,
            tokensOut,
            ...(code !== 0 ? { error: `Exit code ${code}` } : {}),
          },
        }).catch(() => {})
        send('done', { success: code === 0, exitCode: code, durationMs, logId: log.id })
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

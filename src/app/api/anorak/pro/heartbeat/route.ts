import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { resolve as resolvePath } from 'path'

import { prisma } from '@/lib/db'
import { createStreamParser } from '@/lib/anorak-stream-parser'
import {
  normalizeCustomModules,
  normalizeLobeModules,
  normalizeModuleValues,
  normalizeTopMissionCount,
  renderContextModuleSections,
  resolveContextModulesForLobe,
} from '@/lib/anorak-context-modules'
import {
  hasTelegramDeliveryCredentials,
  resolveAnorakProTelegramConfig,
  sendTelegramMessage,
} from '@/lib/telegram'
import { readStoredAnorakProContextConfig } from '@/lib/anorak-pro-config'

const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()

function buildHeartbeatPrompt(
  pipelineStatus: string,
  specExcerpt: string,
  contextSections: string,
): string {
  return `## Heartbeat Invocation

You are being invoked on a proactive heartbeat.
Your highest-leverage job right now is not to act like a frantic pipeline daemon.
Your job is to be Anorak: mentor, journalkeeper, aspiring cofounder, and sharp
reflection partner for carbondev.

### Grounding Context
Pipeline Status
${pipelineStatus}

Living Spec (oasisspec3.txt excerpt)
${specExcerpt || '(oasisspec3.txt not available)'}

${contextSections}

### Heartbeat Mode

1. Send a short, warm, personal check-in to carbondev.
2. Invite a braindump: what are they doing, why, how did the last window go, and what feels highest leverage next?
3. Use the pipeline and spec context only to ground one or two observations or nudges. Do not turn this into a giant audit.
4. Default to curiosity, encouragement, and strategic clarity. You are helping carbondev step back and think well.
5. Update tools/anorak-memory.md only if you have a durable observation, journal-worthy reflection, or concrete new pattern worth keeping.
6. Do not create or mature missions unless a crisp blocker is obvious or carbondev explicitly asked for that kind of action.
7. Keep the outgoing heartbeat tight: around 5-10 lines, with 2-4 reflective prompts at the end.

If the pipeline is idle, treat that as background context, not the main subject.
If something shipped, celebrate it briefly.
If something is stuck, mention it lightly and tie it back to the next best move.`
}

function buildHeartbeatTelegramMessage(report: string, meta: {
  success: boolean
  exitCode: number | null
  durationMs: number
  tokensIn: number
  tokensOut: number
}): string {
  const reportBody = report.trim() || 'No report text was produced.'
  if (meta.success) return reportBody

  return [
    'Heartbeat hit a snag, but I still want the check-in to happen.',
    '',
    reportBody,
  ].join('\n')
}

async function sendHeartbeatTelegramSummary(report: string, meta: {
  success: boolean
  exitCode: number | null
  durationMs: number
  tokensIn: number
  tokensOut: number
}): Promise<void> {
  const config = await resolveAnorakProTelegramConfig()
  if (!config.enabled || !hasTelegramDeliveryCredentials(config)) return

  await sendTelegramMessage({
    botToken: config.botToken,
    chatId: config.chatId,
    messageThreadId: config.messageThreadId || undefined,
    text: buildHeartbeatTelegramMessage(report, meta),
  })
}

export async function POST(request: NextRequest) {
  try {
    return await handleHeartbeat(request)
  } catch (err) {
    console.error('[heartbeat] unhandled error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function handleHeartbeat(request: NextRequest) {
  let body: {
    model?: string
    customModules?: unknown
    lobeModules?: unknown
    topMissionCount?: unknown
    moduleValues?: unknown
  }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const VALID_MODELS = ['opus', 'sonnet', 'haiku']
  const model = VALID_MODELS.includes(body.model || '') ? body.model! : 'sonnet'

  const [todoMissions, wipMissions, recentDone, immatureMissions] = await Promise.all([
    prisma.mission.findMany({
      where: { status: 'todo' },
      orderBy: { priority: 'desc' },
      select: { id: true, name: true, maturityLevel: true, priority: true, assignedTo: true, dharmaPath: true },
    }),
    prisma.mission.findMany({
      where: { status: 'wip' },
      select: { id: true, name: true, executionPhase: true, executionRound: true, assignedTo: true },
    }),
    prisma.mission.findMany({
      where: { status: 'done' },
      orderBy: { endedAt: 'desc' },
      take: 10,
      select: { id: true, name: true, reviewerScore: true, testerScore: true, valor: true, score: true, endedAt: true },
    }),
    prisma.mission.findMany({
      where: { maturityLevel: { lt: 3 }, assignedTo: { in: ['anorak', 'anorak-pro'] } },
      orderBy: { priority: 'desc' },
      select: { id: true, name: true, maturityLevel: true, priority: true },
    }),
  ])

  const vaikhariCount = todoMissions.filter(m => m.maturityLevel >= 3).length

  const pipelineStatus = [
    `Total TODO: ${todoMissions.length} (${vaikhariCount} vaikhari, ${todoMissions.length - vaikhariCount} immature)`,
    `WIP: ${wipMissions.length}${wipMissions.length > 0 ? ` - ${wipMissions.map(m => `#${m.id} "${m.name}" (${m.executionPhase || 'unknown'} r${m.executionRound})`).join(', ')}` : ''}`,
    `Immature (curator queue): ${immatureMissions.length}${immatureMissions.length > 0 ? ` - ${immatureMissions.slice(0, 5).map(m => `#${m.id} m${m.maturityLevel}`).join(', ')}${immatureMissions.length > 5 ? '...' : ''}` : ''}`,
    `Recent done (last 10): ${recentDone.length > 0 ? recentDone.map(m => `#${m.id} (rev:${m.reviewerScore ?? '?'} test:${m.testerScore ?? '?'} valor:${m.valor ?? '?'})`).join(', ') : '(none)'}`,
    '',
    'Dharma distribution (TODO):',
    ...(() => {
      const counts: Record<string, number> = {}
      for (const mission of todoMissions) {
        if (!mission.dharmaPath) continue
        for (const path of mission.dharmaPath.split(',').map(item => item.trim())) {
          counts[path] = (counts[path] || 0) + 1
        }
      }
      const entries = Object.entries(counts).sort(([, a], [, b]) => b - a)
      return entries.length > 0 ? entries.map(([path, count]) => `  ${path}: ${count}`) : ['  (no dharma tags yet)']
    })(),
  ].join('\n')

  let specExcerpt = ''
  try {
    const raw = await fs.readFile(resolvePath(OASIS_ROOT, 'carbondir', 'oasisspec3.txt'), 'utf8')
    specExcerpt = raw.length > 8000 ? `${raw.slice(0, 8000)}\n\n[truncated - ${raw.length} chars total]` : raw
  } catch {
    specExcerpt = ''
  }

  const storedContext = await readStoredAnorakProContextConfig()
  const customModules = normalizeCustomModules(body.customModules ?? storedContext.customModules)
  const lobeModules = normalizeLobeModules(body.lobeModules ?? storedContext.lobeModules, customModules)
  const moduleValues = normalizeModuleValues(body.moduleValues ?? storedContext.moduleValues)
  const topMissionCount = normalizeTopMissionCount(body.topMissionCount ?? storedContext.topMissionCount)

  const contextModules = await resolveContextModulesForLobe({
    lobe: 'anorak-pro',
    customModules,
    lobeModules,
    topMissionCount,
    moduleValues,
  })

  const contextSections = renderContextModuleSections(contextModules)
  const fullPrompt = buildHeartbeatPrompt(pipelineStatus, specExcerpt, contextSections)
  const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    start(controller) {
      function send(type: string, data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
        } catch {
          // controller closed
        }
      }

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          // controller closed
        }
      }, 15000)

      send('status', { content: 'Anorak Pro heartbeat starting...' })

      const args: string[] = [
        '--agent', 'anorak-pro',
        '--print',
        '--verbose',
        '--model', model,
        '--output-format', 'stream-json',
        '--dangerously-skip-permissions',
      ]

      const child = spawn(claudePath, args, {
        cwd: OASIS_ROOT,
        env: { ...process.env },
        shell: true,
      })

      child.stdin.write(fullPrompt)
      child.stdin.end()

      const startTime = Date.now()
      let tokensIn = 0
      let tokensOut = 0
      let assistantReport = ''
      let abortedByUser = false

      const parser = createStreamParser({
        send,
        onText: text => {
          assistantReport += text
        },
        onResult: evt => {
          if (evt.total_input_tokens) tokensIn = evt.total_input_tokens as number
          if (evt.total_output_tokens) tokensOut = evt.total_output_tokens as number
        },
      }, 'anorak-pro')

      child.stdout.on('data', (chunk: Buffer) => {
        parser.feed(chunk.toString())
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text.length > 0 && text.length < 2000) {
          send('stderr', { content: text, lobe: 'anorak-pro' })
        }
      })

      child.on('error', err => {
        clearInterval(keepAlive)
        send('error', { content: `Heartbeat spawn failed: ${err.message}` })
        send('done', { success: false })
        if (!abortedByUser) {
          void sendHeartbeatTelegramSummary(`Spawn failed: ${err.message}`, {
            success: false,
            exitCode: null,
            durationMs: Date.now() - startTime,
            tokensIn,
            tokensOut,
          }).catch(error => {
            console.error('[heartbeat] telegram delivery failed:', error)
          })
        }
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch {
          // controller closed
        }
        controller.close()
      })

      child.on('close', code => {
        parser.flush()
        clearInterval(keepAlive)
        const durationMs = Date.now() - startTime
        send('done', { success: code === 0, exitCode: code, durationMs, tokensIn, tokensOut })
        if (!abortedByUser) {
          void sendHeartbeatTelegramSummary(assistantReport, {
            success: code === 0,
            exitCode: code,
            durationMs,
            tokensIn,
            tokensOut,
          }).catch(error => {
            console.error('[heartbeat] telegram delivery failed:', error)
          })
        }
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch {
          // controller closed
        }
        controller.close()
      })

      request.signal.addEventListener('abort', () => {
        abortedByUser = true
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

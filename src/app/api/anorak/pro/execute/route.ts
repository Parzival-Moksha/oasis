// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO — Execute Route (The Orchestrator / Link-Runner)
// Horizontal agent pipeline: coder → reviewer → tester
// Each agent is a separate CLI process. Orchestrator dispatches and loops.
// Agents write their own scores via MCP tools. Orchestrator reads from DB.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { spawn, ChildProcess } from 'child_process'
import { prisma } from '@/lib/db'
import { regenerateCuratorRL } from '../../../../../lib/anorak-curator-rl'
const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

interface MissionRow {
  id: number; name: string; description: string | null
  carbonDescription: string | null; siliconDescription: string | null
  acceptanceCriteria: string | null; history: string | null
  urgency: number; easiness: number; impact: number; priority: number | null
  dharmaPath: string | null; maturityLevel: number
}

function buildCoderPrompt(mission: MissionRow, reviewerFindings?: string, testerFailures?: string): string {
  let prompt = `## Mission #${mission.id}: "${mission.name}"

### Carbon Description (the why)
${mission.carbonDescription || mission.description || '(none)'}

### Silicon Description (the what)
${mission.siliconDescription || '(none)'}

### Acceptance Criteria
${mission.acceptanceCriteria || 'See silicon description'}

### Mission Metadata
UEI: U${mission.urgency} E${mission.easiness} I${mission.impact} | Priority: ${mission.priority?.toFixed(2) ?? '?'}
Dharma: ${mission.dharmaPath || '(none)'}
Maturity: ${mission.maturityLevel}/3

### History
${mission.history || '(none)'}
`

  if (reviewerFindings) {
    prompt += `\n\n## REVIEWER FINDINGS — FIX THESE\n${reviewerFindings}\n`
  }
  if (testerFailures) {
    prompt += `\n\n## TESTER FAILURES — FIX THESE\n${testerFailures}\n`
  }
  return prompt
}

function buildReviewerPrompt(): string {
  return `Review the latest code changes (git diff). Follow your agent definition.
After producing your report, use the report_review MCP tool to write your score to the mission DB.
If you discover collateral bugs, use create_mission MCP tool for each.`
}

function buildTesterPrompt(): string {
  return `Test the latest code changes. Follow your agent definition.
After producing your report, use the report_test MCP tool to write your score + valor to the mission DB.
If you discover collateral bugs, use create_mission MCP tool for each.
Write NEW vitest tests for any changed logic files that lack coverage.`
}

function buildRecapPrompt(mission: MissionRow, recapLength: number): string {
  return `Mission #${mission.id} "${mission.name}" is DONE.
Give a ${recapLength}-token recap in highly carbonized language — emotions, analogies, drama.
Read the mission from DB (get_mission tool, id: ${mission.id}) to see final scores, then recap.
No code. Just vibes. Celebrate or commiserate. Mention reviewer score, tester score, valor, what shipped.`
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT SPAWNER — spawns CLI, streams, resolves on exit
// ═══════════════════════════════════════════════════════════════════════════

function spawnAgent(
  agentType: string,
  prompt: string,
  model: string,
  lobe: string,
  send: (type: string, data: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'

    const args = agentType === 'anorak-pro'
      ? ['--print', '--model', model, '--output-format', 'stream-json', '--dangerously-skip-permissions']
      : ['--agent', agentType, '--print', '--model', model, '--output-format', 'stream-json', '--dangerously-skip-permissions']

    send('status', { content: `⚡ spawning ${lobe}...`, lobe })

    const child: ChildProcess = spawn(claudePath, args, {
      cwd: OASIS_ROOT,
      shell: true,
      env: { ...process.env },
    })

    child.stdin!.write(prompt)
    child.stdin!.end()

    let buffer = ''
    let fullStdout = ''

    child.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      fullStdout += text
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          let event = JSON.parse(line)
          if (event.type === 'stream_event' && event.event) event = event.event
          const et = event.type || 'unknown'

          if (et === 'content_block_delta') {
            const d = event.delta
            if (d?.type === 'text_delta' && d?.text) send('text', { content: d.text, lobe })
            else if (d?.type === 'thinking_delta' && d?.thinking) send('thinking', { content: d.thinking, lobe })
          } else if (et === 'tool_use') {
            send('tool', { name: event.tool?.name || event.name || 'tool', lobe })
          } else if (et === 'tool_result') {
            const result = event.result || event.content || ''
            const preview = (typeof result === 'string' ? result : JSON.stringify(result)).substring(0, 200)
            send('tool_result', { name: event.tool_name || event.name || 'tool', preview, lobe })
          } else if (et === 'result') {
            send('result', { cost_usd: event.cost_usd ?? event.total_cost_usd, lobe })
          }
        } catch {
          if (line.trim().length > 0 && line.trim().length < 300) {
            send('stderr', { content: line.trim(), lobe })
          }
        }
      }
    })

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text.length > 0 && text.length < 2000) send('stderr', { content: text, lobe })
    })

    child.on('error', (err) => {
      send('error', { content: `${lobe} error: ${err.message}`, lobe })
      resolve({ exitCode: 1, stdout: fullStdout })
    })

    child.on('close', (code) => {
      send('status', { content: `✓ ${lobe} exited (code ${code})`, lobe })
      resolve({ exitCode: code ?? 1, stdout: fullStdout })
    })

    signal.addEventListener('abort', () => { child.kill('SIGTERM') })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/anorak/pro/execute — The Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  let body: {
    missionId: number
    coderModel?: string
    reviewerModel?: string
    testerModel?: string
    recapModel?: string
    reviewerThreshold?: number
    recapLength?: number
  }

  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const VALID_MODELS = ['opus', 'sonnet', 'haiku']
  const safeModel = (m: string | undefined, fallback: string) => VALID_MODELS.includes(m || '') ? m! : fallback

  const {
    missionId,
    reviewerThreshold = 90,
    recapLength = 100,
  } = body
  const coderModel = safeModel(body.coderModel, 'opus')
  const reviewerModel = safeModel(body.reviewerModel, 'sonnet')
  const testerModel = safeModel(body.testerModel, 'sonnet')
  const recapModel = safeModel(body.recapModel, 'haiku')

  const mission = await prisma.mission.findUnique({ where: { id: missionId } })
  if (!mission) {
    return new Response(JSON.stringify({ error: `Mission ${missionId} not found` }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (mission.maturityLevel < 3) {
    return new Response(JSON.stringify({ error: `Mission ${missionId} not vaikhari (level ${mission.maturityLevel})` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Set WIP + checkpoint
  await prisma.mission.update({
    where: { id: missionId },
    data: { status: 'wip', executionPhase: 'coding', executionRound: 1, startedAt: new Date() },
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      function send(type: string, data: Record<string, unknown>) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)) } catch {}
      }

      const keepAlive = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)) } catch {}
      }, 15000)

      send('status', { content: `🔥 South loop starting for mission #${missionId}: "${mission.name}"` })

      const MAX_ROUNDS = 5
      let round = 1
      let reviewerFindings: string | undefined
      let testerFailures: string | undefined

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (round > MAX_ROUNDS) {
            send('error', { content: `Max rounds (${MAX_ROUNDS}) exceeded. Aborting south loop.` })
            await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: null, status: 'todo' } })
            break
          }

          // ── CODER ──────────────────────────────────────────
          await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'coding', executionRound: round } })

          const freshMission = await prisma.mission.findUnique({ where: { id: missionId } })
          const coderPrompt = buildCoderPrompt(freshMission as MissionRow, reviewerFindings, testerFailures)

          const coderResult = await spawnAgent('coder', coderPrompt, coderModel, 'coder', send, request.signal)
          if (coderResult.exitCode !== 0) {
            send('error', { content: `Coder exited with error (code ${coderResult.exitCode})` })
          }

          // ── REVIEWER ───────────────────────────────────────
          await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'reviewing' } })

          const reviewerPrompt = buildReviewerPrompt()
          const reviewerResult = await spawnAgent('reviewer', reviewerPrompt, reviewerModel, 'reviewer', send, request.signal)

          // Read score from DB (reviewer wrote it via MCP)
          const afterReview = await prisma.mission.findUnique({ where: { id: missionId } })
          const revScore = afterReview?.reviewerScore

          // Also try regex from stdout as fallback
          const revMatch = reviewerResult.stdout.match(/REVIEWER SCORE:\s*(\d+)\/100/)
          const actualRevScore = revScore ?? (revMatch ? parseInt(revMatch[1]) : null)

          send('status', { content: `🔍 Reviewer score: ${actualRevScore ?? '?'}/100 (threshold: ${reviewerThreshold})` })

          if (actualRevScore !== null && actualRevScore < reviewerThreshold) {
            reviewerFindings = reviewerResult.stdout.substring(reviewerResult.stdout.length - 3000) // last 3k chars
            testerFailures = undefined
            round++
            send('status', { content: `↩ Score ${actualRevScore} < ${reviewerThreshold}. Re-invoking coder (round ${round})...` })
            continue
          }

          // ── TESTER ─────────────────────────────────────────
          await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'testing' } })

          const testerPrompt = buildTesterPrompt()
          const testerResult = await spawnAgent('tester', testerPrompt, testerModel, 'tester', send, request.signal)

          const afterTest = await prisma.mission.findUnique({ where: { id: missionId } })
          const testScore = afterTest?.testerScore

          const testMatch = testerResult.stdout.match(/TESTER SCORE:\s*(\d+)\/100/)
          const actualTestScore = testScore ?? (testMatch ? parseInt(testMatch[1]) : null)

          const valorMatch = testerResult.stdout.match(/TESTER VALOR:\s*([\d.]+)/)
          const testerValor = afterTest?.valor ?? (valorMatch ? parseFloat(valorMatch[1]) : null)

          send('status', { content: `🧪 Tester score: ${actualTestScore ?? '?'}/100, valor: ${testerValor ?? '?'}` })

          if (actualTestScore !== null && actualTestScore < 100) {
            testerFailures = testerResult.stdout.substring(testerResult.stdout.length - 3000)
            reviewerFindings = undefined
            round++
            send('status', { content: `↩ Tester score ${actualTestScore} < 100%. Re-invoking coder (round ${round})...` })
            continue
          }

          // ── MISSION COMPLETE ───────────────────────────────
          const finalScore = (mission.priority ?? 1) * (testerValor ?? 1)

          await prisma.mission.update({
            where: { id: missionId },
            data: {
              status: 'done',
              endedAt: new Date(),
              executionPhase: null,
              executionRound: round,
              score: finalScore,
              ...(testerValor != null ? { valor: testerValor } : {}),
            },
          })

          send('status', { content: `✅ Mission #${missionId} DONE! Score: ${finalScore.toFixed(2)}. Regenerating RL context...` })

          // Regenerate curator RL context
          try {
            const doneMissions = await prisma.mission.findMany({
              where: { status: 'done' },
              orderBy: { endedAt: 'desc' },
              take: 50,
            })
            await regenerateCuratorRL(doneMissions as unknown as Parameters<typeof regenerateCuratorRL>[0])
          } catch (e) {
            send('stderr', { content: `RL regen warning: ${e}` })
          }

          // ── RECAP ──────────────────────────────────────────
          const recapPrompt = buildRecapPrompt(mission as MissionRow, recapLength)
          await spawnAgent('anorak-pro', recapPrompt, recapModel, 'anorak-pro', send, request.signal)

          send('done', { success: true, missionId, rounds: round, score: finalScore })
          break
        }
      } catch (err) {
        send('error', { content: `Orchestrator error: ${err}` })
        send('done', { success: false, missionId })
      }

      clearInterval(keepAlive)
      try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
      controller.close()
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

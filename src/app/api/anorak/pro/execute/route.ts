// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO — Execute Route (The Orchestrator / Link-Runner)
// Horizontal agent pipeline: coder → reviewer → tester → gamer(optional)
// Each agent is a separate CLI process. Orchestrator dispatches and loops.
// Agents write their own scores via MCP tools. Orchestrator reads from DB.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { spawn, execSync, ChildProcess } from 'child_process'
import { existsSync, symlinkSync, rmSync, unlinkSync, lstatSync } from 'fs'
import { join, resolve as resolvePath } from 'path'
import { prisma } from '@/lib/db'
import { regenerateCuratorRL } from '../../../../../lib/anorak-curator-rl'
import { createStreamParser } from '@/lib/anorak-stream-parser'
import {
  type CustomContextModule,
  type LegacyContextModules,
  normalizeCustomModules,
  normalizeLobeModules,
  normalizeTopMissionCount,
  renderContextModuleSections,
  resolveContextModulesForLobe,
} from '@/lib/anorak-context-modules'
const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()
const AGENT_TIMEOUT_MS = 10 * 60 * 1000

// ═══════════════════════════════════════════════════════════════════════════
// PHOENIX PROTOCOL — Worktree isolation for CRISPR missions
// Coder/reviewer/tester run in worktree. Gamer runs on main (live server).
// ═══════════════════════════════════════════════════════════════════════════

const WORKTREE_DIR = resolvePath(OASIS_ROOT, '..', 'af_oasis_worktree')
const HEALTH_URL = `http://localhost:4516/api/health`
const HEALTH_POLL_INTERVAL = 2000
const HEALTH_POLL_TIMEOUT = 90000

/**
 * Force-remove the worktree directory, handling all failure modes:
 * 1. node_modules junction symlink (must be unlinked separately on Windows)
 * 2. git worktree metadata (git worktree remove --force)
 * 3. Leftover directory (rmSync as nuclear fallback)
 * 4. Git index corruption (git worktree prune)
 */
function phoenixForceRemoveWorktree(send: (type: string, data: Record<string, unknown>) => void): void {
  if (!existsSync(WORKTREE_DIR)) return
  send('status', { content: '🔥 Phoenix: cleaning up stale worktree...' })

  // Step 1: Remove node_modules junction FIRST — Windows junctions confuse git
  const wtNodeModules = join(WORKTREE_DIR, 'node_modules')
  try {
    if (existsSync(wtNodeModules)) {
      const stat = lstatSync(wtNodeModules)
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        unlinkSync(wtNodeModules)  // unlinkSync removes junctions without following them
        send('status', { content: '🔥 Phoenix: removed node_modules junction.' })
      }
    }
  } catch (err) {
    send('status', { content: `🔥 Phoenix: junction cleanup note: ${(err as Error).message}` })
  }

  // Step 2: Try git worktree remove (the clean way)
  try {
    execSync(`git worktree remove "${WORKTREE_DIR}" --force`, { cwd: OASIS_ROOT, stdio: 'pipe' })
    send('status', { content: '🔥 Phoenix: git worktree removed.' })
  } catch (err) {
    send('status', { content: `🔥 Phoenix: git worktree remove failed (${(err as Error).message?.split('\n')[0]}), using rmSync fallback.` })
    // Step 3: Nuclear fallback — force-delete the directory
    try {
      rmSync(WORKTREE_DIR, { recursive: true, force: true })
      send('status', { content: '🔥 Phoenix: directory force-removed.' })
    } catch (rmErr) {
      send('error', { content: `Phoenix: CRITICAL — cannot remove ${WORKTREE_DIR}: ${(rmErr as Error).message}` })
    }
  }

  // Step 4: Always prune git worktree metadata (handles orphaned entries)
  try { execSync('git worktree prune', { cwd: OASIS_ROOT, stdio: 'ignore' }) } catch { /* best-effort */ }
}

function assertSafeBranchName(name: string): void {
  if (!/^[a-zA-Z0-9\/_-]+$/.test(name)) throw new Error(`Unsafe branch name: ${name}`)
}

function phoenixCreateWorktree(branchName: string, send: (type: string, data: Record<string, unknown>) => void): boolean {
  assertSafeBranchName(branchName)
  try {
    // Prune stale worktrees first
    execSync('git worktree prune', { cwd: OASIS_ROOT, stdio: 'ignore' })

    // Remove existing worktree — handles all failure modes
    phoenixForceRemoveWorktree(send)

    // Delete branch if it exists from a previous run
    try { execSync(`git branch -D "${branchName}"`, { cwd: OASIS_ROOT, stdio: 'ignore' }) } catch { /* branch may not exist */ }

    send('status', { content: `🔥 Phoenix: creating worktree on branch ${branchName}...` })
    execSync(`git worktree add "${WORKTREE_DIR}" -b "${branchName}"`, { cwd: OASIS_ROOT, stdio: 'pipe' })

    // Symlink node_modules into worktree (avoid full install)
    const wtNodeModules = join(WORKTREE_DIR, 'node_modules')
    const mainNodeModules = join(OASIS_ROOT, 'node_modules')
    if (!existsSync(wtNodeModules) && existsSync(mainNodeModules)) {
      symlinkSync(mainNodeModules, wtNodeModules, 'junction')
    }

    send('status', { content: '✅ Phoenix: worktree ready.' })
    return true
  } catch (err) {
    send('error', { content: `Phoenix: worktree creation failed: ${err}` })
    return false
  }
}

function phoenixMergeWorktree(branchName: string, send: (type: string, data: Record<string, unknown>) => void): boolean {
  assertSafeBranchName(branchName)
  try {
    send('status', { content: `🔀 Phoenix: merging ${branchName} into main...` })
    const result = execSync(`git merge "${branchName}" --no-edit`, { cwd: OASIS_ROOT, encoding: 'utf-8', stdio: 'pipe' })
    send('status', { content: `✅ Phoenix: merge complete. ${result.trim().split('\n')[0]}` })
    return true
  } catch (err) {
    send('error', { content: `Phoenix: merge failed: ${err}` })
    return false
  }
}

function phoenixRevertMerge(send: (type: string, data: Record<string, unknown>) => void): boolean {
  try {
    send('status', { content: '⏪ Phoenix: reverting merge...' })
    execSync('git revert HEAD --no-edit', { cwd: OASIS_ROOT, stdio: 'pipe' })
    send('status', { content: '✅ Phoenix: merge reverted.' })
    return true
  } catch (err) {
    send('error', { content: `Phoenix: revert failed: ${err}` })
    return false
  }
}

function phoenixCleanup(branchName: string, send: (type: string, data: Record<string, unknown>) => void) {
  assertSafeBranchName(branchName)
  phoenixForceRemoveWorktree(send)
  try { execSync(`git branch -D "${branchName}"`, { cwd: OASIS_ROOT, stdio: 'ignore' }) } catch { /* branch may already be deleted */ }
  try { execSync('git worktree prune', { cwd: OASIS_ROOT, stdio: 'ignore' }) } catch { /* best-effort */ }
  send('status', { content: '🧹 Phoenix: worktree cleaned up.' })
}

async function phoenixWaitForServer(send: (type: string, data: Record<string, unknown>) => void): Promise<boolean> {
  send('status', { content: '⏳ Phoenix: waiting for server rebuild...' })
  const start = Date.now()
  while (Date.now() - start < HEALTH_POLL_TIMEOUT) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        send('status', { content: `✅ Phoenix: server alive (${Math.round((Date.now() - start) / 1000)}s).` })
        return true
      }
    } catch { /* server not up yet */ }
    await new Promise(r => setTimeout(r, HEALTH_POLL_INTERVAL))
  }
  send('error', { content: `Phoenix: server did not recover within ${HEALTH_POLL_TIMEOUT / 1000}s` })
  return false
}

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

function buildCoderPrompt(mission: MissionRow, contextBlock: string, reviewerFindings?: string, testerFailures?: string, gamerFailures?: string): string {
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

  if (contextBlock) {
    prompt += `\n\n${contextBlock}\n`
  }

  if (reviewerFindings) {
    prompt += `\n\n## REVIEWER FINDINGS — FIX THESE\n${reviewerFindings}\n`
  }
  if (testerFailures) {
    prompt += `\n\n## TESTER FAILURES — FIX THESE\n${testerFailures}\n`
  }
  if (gamerFailures) {
    prompt += `\n\n## GAMER FAILURES — FIX THESE\n${gamerFailures}\n`
  }
  return prompt
}

function buildReviewerPrompt(contextBlock: string): string {
  return `Review the latest code changes (git diff). Follow your agent definition.
After producing your report, use the report_review MCP tool to write your score to the mission DB.
If you discover collateral bugs, use create_para_mission MCP tool for each.${contextBlock ? `\n\n${contextBlock}` : ''}`
}

function buildTesterPrompt(contextBlock: string, headed: boolean): string {
  return `Test the latest code changes. Follow your agent definition.
After producing your report, use the report_test MCP tool to write your score + valor to the mission DB.
If you discover collateral bugs, use create_para_mission MCP tool for each.
Write NEW vitest tests for any changed logic files that lack coverage.
Browser mode: ${headed ? 'HEADED (vibedev is watching)' : 'HEADLESS'}.${contextBlock ? `\n\n${contextBlock}` : ''}`
}

function buildGamerPrompt(mission: MissionRow, testerReport: string, scenarios: string[], headed: boolean): string {
  const scenarioBlock = scenarios.length > 0
    ? scenarios.map((scenario, index) => `${index + 1}. ${scenario}`).join('\n')
    : '(Tester requested gamer coverage but did not provide parseable scenarios. Read the tester report and infer the patrol.)'

  return `## Mission #${mission.id}: "${mission.name}"

### Carbon Description
${mission.carbonDescription || mission.description || '(none)'}

### Silicon Description
${mission.siliconDescription || '(none)'}

### Acceptance Criteria
${mission.acceptanceCriteria || 'See silicon description'}

You are running after tester. Follow your gamer agent definition.
Treat this as a real gameplay gate, not a decorative screenshot pass.
Browser mode: ${headed ? 'HEADED (vibedev is watching)' : 'HEADLESS'}.

After your report, call report_game MCP tool with mission ID ${mission.id}.
If you discover collateral bugs, use create_para_mission MCP tool for each.

## TESTER HANDOFF SCENARIOS
${scenarioBlock}

## TESTER REPORT CONTEXT
${testerReport || '(none)'}
`
}

function buildRecapPrompt(mission: MissionRow, recapLength: number): string {
  return `Mission #${mission.id} "${mission.name}" is DONE.
Give a ${recapLength}-token recap in highly carbonized language — emotions, analogies, drama.
Read the mission from DB (get_mission tool, id: ${mission.id}) to see final scores, then recap.
No code. Just vibes. Celebrate or commiserate. Mention reviewer score, tester score, valor, what shipped.`
}

function extractAgentText(stdout: string): string {
  const parts: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const evt = JSON.parse(line)
      if (evt?.type === 'text' && typeof evt.content === 'string') parts.push(evt.content)
    } catch {
      continue
    }
  }
  return parts.join('\n').trim()
}

function parseGamerHandoff(stdout: string): { required: boolean; scenarios: string[] } {
  const text = stdout || ''
  const required = /GAMER HANDOFF:\s*REQUIRED/i.test(text) && !/GAMER HANDOFF:\s*NOT REQUIRED/i.test(text)
  if (!required) return { required: false, scenarios: [] }

  const lines = text.split(/\r?\n/)
  const handoffIdx = lines.findIndex(line => /GAMER HANDOFF:\s*REQUIRED/i.test(line))
  if (handoffIdx === -1) return { required: true, scenarios: [] }

  const scenarios: string[] = []
  for (let i = handoffIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      if (scenarios.length > 0) break
      continue
    }
    if (/^(TESTER SCORE|TESTER VALOR|VERDICT:|🔍 DISCOVERED ISSUES)/i.test(line)) break
    if (/^[-*]\s+/.test(line)) {
      scenarios.push(line.replace(/^[-*]\s+/, '').trim())
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      scenarios.push(line.replace(/^\d+\.\s+/, '').trim())
      continue
    }
    if (scenarios.length > 0) break
  }

  return { required: true, scenarios }
}

function parseGamerVerdict(stdout: string): 'PASS' | 'FAIL' | 'BLOCKED' | null {
  const match = stdout.match(/VERDICT:\s*(PASS|FAIL|BLOCKED)/i)
  return match ? match[1].toUpperCase() as 'PASS' | 'FAIL' | 'BLOCKED' : null
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
  cwd?: string,
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'
    const agentCwd = cwd || OASIS_ROOT

    // Explicitly pass --mcp-config to guarantee MCP tools are available in worktree
    const mcpConfigPath = join(OASIS_ROOT, '.mcp.json')
    const mcpArgs = existsSync(mcpConfigPath) ? ['--mcp-config', mcpConfigPath] : []

    const args = agentType === 'anorak-pro'
      ? ['--print', '--verbose', '--model', model, '--output-format', 'stream-json', '--dangerously-skip-permissions', ...mcpArgs]
      : ['--agent', agentType, '--print', '--verbose', '--model', model, '--output-format', 'stream-json', '--dangerously-skip-permissions', ...mcpArgs]

    send('status', { content: `⚡ spawning ${lobe}${cwd ? ' (worktree)' : ''}...`, lobe })

    const child: ChildProcess = spawn(claudePath, args, {
      cwd: agentCwd,
      env: { ...process.env },
    })

    child.stdin!.write(prompt)
    child.stdin!.end()

    let fullStdout = ''
    let lineBuffer = ''
    let extractedText = ''
    let settled = false
    const parser = createStreamParser({ send }, lobe)

    const finish = (result: { exitCode: number; stdout: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(result)
    }

    const timeoutId = setTimeout(() => {
      send('error', { content: `${lobe} timed out after ${AGENT_TIMEOUT_MS / 1000}s`, lobe })
      child.kill('SIGTERM')
      finish({ exitCode: 1, stdout: extractedText.trim() || extractAgentText(fullStdout) })
    }, AGENT_TIMEOUT_MS)

    child.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      fullStdout += text
      parser.feed(text)

      lineBuffer += text
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line)
          if (evt?.type === 'text' && typeof evt.content === 'string') {
            extractedText += `${evt.content}\n`
          }
        } catch {
          continue
        }
      }
    })

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text.length > 0 && text.length < 2000) send('stderr', { content: text, lobe })
    })

    child.on('error', (err) => {
      send('error', { content: `${lobe} error: ${err.message}`, lobe })
      finish({ exitCode: 1, stdout: extractedText.trim() || extractAgentText(fullStdout) })
    })

    child.on('close', (code) => {
      if (lineBuffer.trim()) {
        try {
          const evt = JSON.parse(lineBuffer)
          if (evt?.type === 'text' && typeof evt.content === 'string') {
            extractedText += `${evt.content}\n`
          }
        } catch {
          /* ignore incomplete tail */
        }
      }
      parser.flush()
      send('status', { content: `✓ ${lobe} exited (code ${code})`, lobe })
      finish({ exitCode: code ?? 1, stdout: extractedText.trim() || extractAgentText(fullStdout) })
    })

    const onAbort = () => { child.kill('SIGTERM') }
    signal.addEventListener('abort', onAbort)
    child.on('close', () => { signal.removeEventListener('abort', onAbort) })
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
    gamerModel?: string
    recapModel?: string
    reviewerThreshold?: number
    recapLength?: number
    testerHeaded?: boolean
    gamerHeaded?: boolean
    contextModules?: LegacyContextModules
    customModules?: CustomContextModule[]
    lobeModules?: Record<string, string[]>
    topMissionCount?: number
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
  const safeReviewerThreshold = Math.min(100, Math.max(0, Number.isFinite(reviewerThreshold) ? Math.floor(reviewerThreshold) : 90))
  const safeRecapLength = Math.min(500, Math.max(10, Number.isFinite(recapLength) ? Math.floor(recapLength) : 100))
  const coderModel = safeModel(body.coderModel, 'opus')
  const reviewerModel = safeModel(body.reviewerModel, 'sonnet')
  const testerModel = safeModel(body.testerModel, 'sonnet')
  const gamerModel = safeModel(body.gamerModel, 'sonnet')
  const recapModel = safeModel(body.recapModel, 'haiku')
  const testerHeaded = body.testerHeaded ?? true
  const gamerHeaded = body.gamerHeaded ?? true
  const customModules = normalizeCustomModules(body.customModules)
  const lobeModules = normalizeLobeModules(body.lobeModules, customModules, body.contextModules)
  const topMissionCount = normalizeTopMissionCount(body.topMissionCount)

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

  // Set WIP + checkpoint (cast: gamerScore/gamerVerdict added in schema, prisma generate pending)
  await prisma.mission.update({
    where: { id: missionId },
    data: {
      status: 'wip',
      executionPhase: 'coding',
      executionRound: 1,
      startedAt: new Date(),
      reviewerScore: null,
      testerScore: null,
      gamerScore: null,
      gamerVerdict: null,
      valor: null,
    },
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

      // ── PHOENIX PROTOCOL: determine execution mode ──────────
      const executionMode = (mission.executionMode as string) || 'builder'
      const isCrispr = executionMode === 'crispr'
      const branchName = `coder/mission-${missionId}`
      // Agents in worktree get worktree cwd; gamer/recap always run on main
      const agentCwd = isCrispr ? WORKTREE_DIR : undefined

      send('status', { content: `🔥 South loop starting for mission #${missionId}: "${mission.name}" [${executionMode.toUpperCase()}]` })

      if (isCrispr) {
        const wtOk = phoenixCreateWorktree(branchName, send)
        if (!wtOk) {
          send('error', { content: 'Phoenix: cannot create worktree. Falling back to builder mode.' })
          // Fall through with agentCwd = undefined (builder mode)
        }
      }

      const MAX_ROUNDS = 5
      let round = 1
      let reviewerFindings: string | undefined
      let testerFailures: string | undefined
      let gamerFailures: string | undefined
      let merged = false
      const throwIfAborted = () => {
        if (request.signal.aborted) throw new Error('Execution aborted by client disconnect')
      }

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          throwIfAborted()

          if (round > MAX_ROUNDS) {
            send('error', { content: `Max rounds (${MAX_ROUNDS}) exceeded. Aborting south loop.` })
            await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: null, status: 'todo' } })
            break
          }

          // If we previously merged and gamer failed, revert before retrying
          if (merged && gamerFailures) {
            phoenixRevertMerge(send)
            merged = false
            // Wait for server to stabilize after revert
            if (isCrispr) await phoenixWaitForServer(send)
          }

          // ── CODER ──────────────────────────────────────────
          await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'coding', executionRound: round } })

          const freshMission = await prisma.mission.findUnique({ where: { id: missionId } })
          if (!freshMission) {
            send('error', { content: `Mission #${missionId} was deleted mid-execution. Aborting.` })
            break
          }
          throwIfAborted()
          const coderContext = renderContextModuleSections(await resolveContextModulesForLobe({
            lobe: 'coder',
            customModules,
            lobeModules,
            topMissionCount,
          }))
          const coderPrompt = buildCoderPrompt(freshMission as MissionRow, coderContext, reviewerFindings, testerFailures, gamerFailures)

          throwIfAborted()
          const coderResult = await spawnAgent('coder', coderPrompt, coderModel, 'coder', send, request.signal, agentCwd)
          if (coderResult.exitCode !== 0) {
            send('error', { content: `Coder exited with error (code ${coderResult.exitCode})` })
          }

          // ── REVIEWER ───────────────────────────────────────
          await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'reviewing', reviewerScore: null } })

          const reviewerContext = renderContextModuleSections(await resolveContextModulesForLobe({
            lobe: 'reviewer',
            customModules,
            lobeModules,
            topMissionCount,
          }))
          const reviewerPrompt = buildReviewerPrompt(reviewerContext)
          throwIfAborted()
          const reviewerResult = await spawnAgent('reviewer', reviewerPrompt, reviewerModel, 'reviewer', send, request.signal, agentCwd)

          // Read score from DB (reviewer wrote it via MCP)
          const afterReview = await prisma.mission.findUnique({ where: { id: missionId } })
          const revScore = afterReview?.reviewerScore

          // Also try regex from stdout as fallback — handle various formats:
          // "REVIEWER SCORE: 72/100", "Score: **72 / 100**", "Score: 72/100", "72/100"
          const revMatch = reviewerResult.stdout.match(/(?:REVIEWER\s+)?SCORE[:\s]*\*{0,2}\s*(\d+)\s*[/÷]\s*100\s*\*{0,2}/i)
          const actualRevScore = revScore ?? (revMatch ? parseInt(revMatch[1]) : null)

          send('status', { content: `🔍 Reviewer score: ${actualRevScore ?? '?'}/100 (threshold: ${safeReviewerThreshold})` })

          if (actualRevScore === null) {
            throw new Error('Reviewer did not report a score')
          }

          if (actualRevScore < safeReviewerThreshold) {
            reviewerFindings = reviewerResult.stdout
              ? reviewerResult.stdout.substring(Math.max(0, reviewerResult.stdout.length - 3000))
              : undefined
            testerFailures = undefined
            gamerFailures = undefined
            round++
            send('status', { content: `↩ Score ${actualRevScore} < ${safeReviewerThreshold}. Re-invoking coder (round ${round})...` })
            continue
          }

          // ── TESTER ─────────────────────────────────────────
          await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'testing', testerScore: null, valor: null } })

          const testerContext = renderContextModuleSections(await resolveContextModulesForLobe({
            lobe: 'tester',
            customModules,
            lobeModules,
            topMissionCount,
          }))
          const testerPrompt = buildTesterPrompt(testerContext, testerHeaded)
          throwIfAborted()
          const testerResult = await spawnAgent('tester', testerPrompt, testerModel, 'tester', send, request.signal, agentCwd)

          const afterTest = await prisma.mission.findUnique({ where: { id: missionId } })
          const testScore = afterTest?.testerScore

          const testMatch = testerResult.stdout.match(/(?:TESTER\s+)?SCORE[:\s]*\*{0,2}\s*(\d+)\s*[/÷]\s*100\s*\*{0,2}/i)
          const actualTestScore = testScore ?? (testMatch ? parseInt(testMatch[1]) : null)

          const valorMatch = testerResult.stdout.match(/(?:TESTER\s+)?VALOR[:\s]*\*{0,2}\s*([\d.]+)\s*\*{0,2}/i)
          const testerValor = afterTest?.valor ?? (valorMatch ? parseFloat(valorMatch[1]) : null)

          send('status', { content: `🧪 Tester score: ${actualTestScore ?? '?'}/100, valor: ${testerValor ?? '?'}` })

          if (actualTestScore === null) {
            throw new Error('Tester did not report a score')
          }

          if (actualTestScore < 100) {
            testerFailures = testerResult.stdout.substring(Math.max(0, testerResult.stdout.length - 3000))
            reviewerFindings = undefined
            gamerFailures = undefined
            round++
            send('status', { content: `↩ Tester score ${actualTestScore} < 100%. Re-invoking coder (round ${round})...` })
            continue
          }

          // ── PHOENIX BRIDGE: merge worktree → main ──────────
          if (isCrispr && !merged) {
            await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'merging' } })
            const mergeOk = phoenixMergeWorktree(branchName, send)
            if (!mergeOk) {
              send('error', { content: 'Phoenix: merge failed. Mission cannot proceed to gamer.' })
              await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: null, status: 'todo' } })
              break
            }
            merged = true

            // Wait for dev-agent to rebuild the server
            send('status', { content: '🔄 Phoenix: waiting for dev-agent rebuild...' })
            const serverOk = await phoenixWaitForServer(send)
            if (!serverOk) {
              send('error', { content: 'Phoenix: server did not recover after merge. Reverting.' })
              phoenixRevertMerge(send)
              merged = false
              await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: null, status: 'todo' } })
              break
            }
          }

          // ── GAMER (always runs on main / live server) ──────
          const gamerHandoff = parseGamerHandoff(testerResult.stdout)
          if (gamerHandoff.required) {
            await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'gaming' } })
            send('status', { content: `🎮 Tester requested gamer coverage. Running gamer${gamerHandoff.scenarios.length ? ` (${gamerHandoff.scenarios.length} scenarios)` : ''}...` })

            throwIfAborted()
            const gamerPrompt = buildGamerPrompt(freshMission as MissionRow, testerResult.stdout.substring(Math.max(0, testerResult.stdout.length - 3000)), gamerHandoff.scenarios, gamerHeaded)
            // Gamer ALWAYS runs on main (OASIS_ROOT), never in worktree
            const gamerResult = await spawnAgent('gamer', gamerPrompt, gamerModel, 'gamer', send, request.signal)
            const gamerVerdict = parseGamerVerdict(gamerResult.stdout)

            // Read gamer score from DB (gamer wrote it via report_game MCP)
            const afterGame = await prisma.mission.findUnique({ where: { id: missionId } })
            const gamerScoreMatch = gamerResult.stdout.match(/(?:GAMER\s+)?SCORE[:\s]*\*{0,2}\s*(\d+)\s*[/÷]\s*100\s*\*{0,2}/i)
            const actualGamerScore = afterGame?.gamerScore ?? (gamerScoreMatch ? parseInt(gamerScoreMatch[1]) : null)

            send('status', { content: `🎮 Gamer verdict: ${gamerVerdict ?? '?'}, score: ${actualGamerScore ?? '?'}/100 (exit ${gamerResult.exitCode})` })

            if (gamerResult.exitCode !== 0 || gamerVerdict !== 'PASS') {
              gamerFailures = gamerResult.stdout.substring(Math.max(0, gamerResult.stdout.length - 3000))
              reviewerFindings = undefined
              testerFailures = undefined
              round++
              send('status', { content: `↩ Gamer failed (verdict ${gamerVerdict ?? '?'}, exit ${gamerResult.exitCode}). Re-invoking coder (round ${round})...` })
              continue
            }
          } else {
            // No gamer needed — for CRISPR, still need to merge if not already done
            if (isCrispr && !merged) {
              await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: 'merging' } })
              const mergeOk = phoenixMergeWorktree(branchName, send)
              if (!mergeOk) {
                send('error', { content: 'Phoenix: merge failed.' })
                await prisma.mission.update({ where: { id: missionId }, data: { executionPhase: null, status: 'todo' } })
                break
              }
              merged = true
            }
            send('status', { content: '🎮 Tester did not require gamer coverage for this mission.' })
          }

          // ── MISSION COMPLETE ───────────────────────────────
          // Phoenix cleanup: remove worktree + branch
          if (isCrispr) phoenixCleanup(branchName, send)

          const completedMission = await prisma.mission.findUnique({ where: { id: missionId } })
          const finalScore = (completedMission?.priority ?? mission.priority ?? 1) * (testerValor ?? 1)

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
          throwIfAborted()
          const recapPrompt = buildRecapPrompt((completedMission ?? mission) as MissionRow, safeRecapLength)
          // Wrap send to capture recap text for voice generation
          let recapText = ''
          const recapSend = (type: string, data: Record<string, unknown>) => {
            if (type === 'text' && typeof data.content === 'string') recapText += data.content
            send(type, data)
          }
          await spawnAgent('anorak-pro', recapPrompt, recapModel, 'anorak-pro', recapSend, request.signal)

          // ── VOICE RECAP (fire-and-forget) ──────────────────
          if (recapText.trim().length > 10) {
            try {
              const voiceRes = await fetch('http://localhost:4516/api/media/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: recapText.trim().slice(0, 5000), voice: 'rachel' }),
              })
              if (voiceRes.ok) {
                const voiceData = await voiceRes.json() as { url?: string }
                if (voiceData.url) send('text', { content: `\n\n${voiceData.url}\n`, lobe: 'anorak-pro' })
              }
            } catch { /* voice is best-effort — never blocks pipeline */ }
          }

          send('done', { success: true, missionId, rounds: round, score: finalScore })
          break
        }
      } catch (err) {
        // Phoenix cleanup on error
        if (isCrispr) {
          if (merged) phoenixRevertMerge(send)
          phoenixCleanup(branchName, send)
        }
        await prisma.mission.update({ where: { id: missionId }, data: { status: 'todo', executionPhase: null } }).catch(() => {})
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

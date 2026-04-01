// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK 0.2 - The Coding Agent
// Spawns Claude Code CLI as a child process with --output-format stream-json
// Parses NDJSON events and streams them as SSE to the frontend.
// Admin-only. Recycled patterns from Parzival's llm-client.ts.
// "I told my game engine to fix itself and it did."
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { createStreamParser } from '@/lib/anorak-stream-parser'

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ''
const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK'S CODING SYSTEM PROMPT
// Injected as the task prompt's preamble. Tells Claude Code what it is.
// ═══════════════════════════════════════════════════════════════════════════

function buildAgentPrompt(taskTitle: string, taskDescription: string, carbonConversation: string, siliconSpec: string, extraContext: string): string {
  return `You are Anorak, the dev mage of the Oasis (app.04515.xyz).
You have been summoned to fix a bug or implement a feature.

## YOUR TASK
Title: ${taskTitle}
Description: ${taskDescription}

## SILICON SPEC (technical analysis from vibecode conversation)
${siliconSpec}

## CARBON CONVERSATION (the human context — what the user experienced)
${carbonConversation}

${extraContext ? `## EXTRA CONTEXT FROM DEV\n${extraContext}\n` : ''}
## RULES
- Read CLAUDE.md first to understand the project architecture
- Read the relevant files identified in the spec before making changes
- Make minimal, focused changes — fix only what the spec describes
- Run \`pnpm build\` after your changes to verify they compile
- Do NOT modify: .env, package.json
- Do NOT add new npm dependencies
- Commit with message: "ॐ anorak: ${taskTitle}"
- Be thorough but scoped. Right Effort.`
}

export async function POST(request: NextRequest) {
  console.log('[Anorak Agent] POST hit')

  // ── Local mode: always admin ──────────────────────────────

  // ── PARSE REQUEST ─────────────────────────────────────────
  let body: {
    title: string
    description: string
    carbon: string
    silicon: string
    extra?: string
    model?: string
  }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { title, description, carbon, silicon, extra, model } = body
  if (!title || !silicon) {
    return new Response(JSON.stringify({ error: 'title + silicon required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const agentModel = model || 'opus'
  const fullPrompt = buildAgentPrompt(title, description || '', carbon || '', silicon, extra || '')

  console.log(`[Anorak Agent] Spawning Claude Code (${agentModel}) for: "${title}"`)
  console.log(`[Anorak Agent] Prompt length: ${fullPrompt.length} chars`)
  console.log(`[Anorak Agent] Working dir: ${OASIS_ROOT}`)

  // ── VERIFY CLAUDE CLI EXISTS ──────────────────────────────
  // Check that we can find the claude binary
  const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'

  // ── SSE STREAM ────────────────────────────────────────────
  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    start(controller) {
      function sendEvent(type: string, data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
        } catch {
          // Controller may be closed
        }
      }

      function sendKeepAlive() {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {}
      }

      // Keepalive every 15s to prevent proxy/nginx timeouts
      const keepAliveInterval = setInterval(sendKeepAlive, 15000)

      sendEvent('status', { content: `Summoning Anorak (${agentModel})...` })

      // ── SPAWN CLAUDE CODE ───────────────────────────────
      const args = [
        '--verbose',
        '--print',
        '--model', agentModel,
        '--output-format', 'stream-json',
        '--dangerously-skip-permissions',
      ]

      // Windows: pipe prompt via stdin (avoids command line length limits)
      // Claude Code accepts prompt on stdin when not passed as arg

      const child = spawn(claudePath, args, {
        cwd: OASIS_ROOT,
        env: { ...process.env },
      })

      // Pipe prompt to stdin
      child.stdin.write(fullPrompt)
      child.stdin.end()

      let streamedContent = ''

      sendEvent('status', { content: 'Claude Code process started. Streaming thoughts...' })

      const parser = createStreamParser({
        send: sendEvent,
        onText: (text) => { streamedContent += text },
      })

      // ── STDOUT: NDJSON stream-json events ─────────────
      child.stdout.on('data', (chunk: Buffer) => {
        parser.feed(chunk.toString())
      })

      // ── STDERR: tool activity + warnings ──────────────
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text.length > 0 && text.length < 2000) {
          sendEvent('stderr', { content: text })
        }
      })

      // ── PROCESS ERROR ─────────────────────────────────
      child.on('error', (err) => {
        clearInterval(keepAliveInterval)
        console.error(`[Anorak Agent] Spawn error: ${err.message}`)
        sendEvent('error', { content: `Failed to spawn claude: ${err.message}` })
        sendEvent('done', { success: false })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      // ── PROCESS EXIT ──────────────────────────────────
      child.on('close', (code) => {
        parser.flush()
        clearInterval(keepAliveInterval)
        console.log(`[Anorak Agent] Process exited with code ${code}`)
        console.log(`[Anorak Agent] Streamed ${streamedContent.length} chars of LLM text`)

        sendEvent('done', {
          success: code === 0,
          exitCode: code,
          contentLength: streamedContent.length,
        })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      // ── CLEANUP on client disconnect ──────────────────
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAliveInterval)
        console.log('[Anorak Agent] Client disconnected, killing process')
        child.kill('SIGTERM')
      })
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Tell nginx not to buffer SSE
    },
  })
}

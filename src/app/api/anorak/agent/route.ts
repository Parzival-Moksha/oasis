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
- Do NOT modify: auth, stripe, middleware, .env, package.json
- Do NOT add new npm dependencies
- Commit with message: "ॐ anorak: ${taskTitle}"
- Be thorough but scoped. Right Effort.`
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT TOOL EVENTS FOR SSE — recycled from Parzival's llm-client.ts
// ═══════════════════════════════════════════════════════════════════════════

function formatToolMsg(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Read' && toolInput.file_path) return `Read: ${toolInput.file_path}`
  if (toolName === 'Edit' && toolInput.file_path) return `Edit: ${toolInput.file_path}`
  if (toolName === 'Write' && toolInput.file_path) return `Write: ${toolInput.file_path}`
  if (toolName === 'Bash' && toolInput.command) {
    const cmd = String(toolInput.command).substring(0, 100)
    return `Bash: ${cmd}${String(toolInput.command).length > 100 ? '...' : ''}`
  }
  if (toolName === 'Grep' && toolInput.pattern) return `Grep: "${toolInput.pattern}" in ${toolInput.path || '.'}`
  if (toolName === 'Glob' && toolInput.pattern) return `Glob: ${toolInput.pattern}`
  if (toolName === 'TodoWrite') return `TodoWrite: updating tasks`
  if (Object.keys(toolInput).length > 0) {
    const preview = JSON.stringify(toolInput).substring(0, 80)
    return `${toolName}: ${preview}${JSON.stringify(toolInput).length > 80 ? '...' : ''}`
  }
  return toolName
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
        shell: true,
        env: { ...process.env },
      })

      // Pipe prompt to stdin
      child.stdin.write(fullPrompt)
      child.stdin.end()

      let streamBuffer = ''
      let streamedContent = ''
      let currentToolBlock: {
        name: string
        inputJson: string
      } | null = null

      sendEvent('status', { content: 'Claude Code process started. Streaming thoughts...' })

      // ── STDOUT: NDJSON stream-json events ─────────────
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        streamBuffer += text
        const lines = streamBuffer.split('\n')
        streamBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            let event = JSON.parse(line)

            // Unwrap stream_event envelope
            if (event.type === 'stream_event' && event.event) {
              event = event.event
            }

            const eventType = event.type || 'unknown'

            // ── TEXT DELTA: LLM speaking ──────────────
            if (eventType === 'content_block_delta') {
              const delta = event.delta
              if (delta?.type === 'text_delta' && delta?.text) {
                streamedContent += delta.text
                sendEvent('text', { content: delta.text })
              }
              else if (delta?.type === 'thinking_delta' && delta?.thinking) {
                sendEvent('thinking', { content: delta.thinking })
              }
              else if (delta?.type === 'input_json_delta' && delta?.partial_json && currentToolBlock) {
                currentToolBlock.inputJson += delta.partial_json
              }
            }

            // ── CONTENT BLOCK START: tool beginning ───
            else if (eventType === 'content_block_start') {
              const blockType = event.content_block?.type
              if (blockType === 'tool_use') {
                const toolName = event.content_block?.name || 'tool'
                currentToolBlock = { name: toolName, inputJson: '' }
                sendEvent('tool_start', { name: toolName })
              } else if (blockType === 'text') {
                currentToolBlock = null
              }
            }

            // ── CONTENT BLOCK STOP: tool call complete ─
            else if (eventType === 'content_block_stop') {
              if (currentToolBlock) {
                let toolInput: Record<string, unknown> = {}
                if (currentToolBlock.inputJson.trim()) {
                  try { toolInput = JSON.parse(currentToolBlock.inputJson) } catch {}
                }
                const msg = formatToolMsg(currentToolBlock.name, toolInput)
                sendEvent('tool', { name: currentToolBlock.name, input: toolInput, display: msg })
                currentToolBlock = null
              }
            }

            // ── TOOL USE (direct, non-streaming) ──────
            else if (eventType === 'tool_use') {
              const toolName = event.tool?.name || event.name || 'tool'
              const toolInput = event.tool?.input || event.input || {}
              const msg = formatToolMsg(toolName, toolInput as Record<string, unknown>)
              sendEvent('tool', { name: toolName, input: toolInput, display: msg })
            }

            // ── TOOL RESULT ───────────────────────────
            else if (eventType === 'tool_result') {
              const toolName = event.tool_name || event.name || 'tool'
              const result = event.result || event.content || event.output || ''
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
              const preview = resultStr.substring(0, 200).replace(/\n/g, ' ')
              const isError = event.is_error === true
              sendEvent('tool_result', { name: toolName, preview, isError, length: resultStr.length })
            }

            // ── RESULT: final metadata ────────────────
            else if (eventType === 'result') {
              sendEvent('result', {
                cost_usd: event.cost_usd ?? event.total_cost_usd,
                duration_ms: event.duration_ms,
                usage: event.usage,
                result: event.result,
              })
            }

            // ── ASSISTANT MESSAGE (complete, skip dup) ─
            else if (eventType === 'assistant' || eventType === 'message') {
              // Final text already streamed via deltas, skip to avoid duplication
            }

            // ── ERROR ─────────────────────────────────
            else if (eventType === 'error') {
              const errorMsg = event.error?.message || event.message || JSON.stringify(event)
              sendEvent('error', { content: errorMsg })
            }

            // Skip noise: system, user, message_start/delta/stop, ping
          } catch {
            // Not JSON — might be raw text during startup
            if (line.trim().length > 0 && line.trim().length < 300) {
              sendEvent('stderr', { content: line.trim() })
            }
          }
        }
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

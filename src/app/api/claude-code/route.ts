export const dynamic = 'force-dynamic'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CLAUDE CODE — Full Claude Code session inside the Oasis
// Full Claude Code session inside the Oasis, multi-turn via --resume.
// Streams NDJSON events from Claude Code CLI as SSE to the browser.
// Admin-only. Shakespeare would be proud.
//
// Claude Code stream-json format (v2.1.75):
//   {"type":"system","subtype":"init","session_id":"..."}
//   {"type":"assistant","message":{"content":[{type:"thinking"},{type:"tool_use"},{type:"text"}]}}
//   {"type":"user","tool_use_result":{"file":{...}}}  ← tool results
//   {"type":"result","total_cost_usd":...}
//
// Each "assistant" event is a COMPLETE snapshot — content array replaces,
// not appends. We diff against previous to find new blocks.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { spawn } from 'child_process'

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ''
const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE CODE SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function buildSystemPreamble(): string {
  return `You are Claude Code, running inside the Oasis — a 3D productivity environment.
You have full read/write access to the repository. Player 1 commands you through the Oasis UI.

## RULES
- Read CLAUDE.md first if you haven't already — it contains the full project architecture
- You have full access to all tools: Read, Edit, Write, Bash, Grep, Glob, Agent
- You can modify ANY file, run ANY command, install packages, deploy, etc.
- After significant changes, run \`pnpm build\` to verify compilation
- Be thorough but scoped — Right Effort
- When done, tell Player 1 to hit F5 if the changes affect the running app

## CONTEXT
- Working directory: ${OASIS_ROOT}
- Stack: Next.js 14 + React Three Fiber + Three.js + Zustand
- Port: 4516
- You ARE inside the Oasis. You can edit this very app.`
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT TOOL EVENTS
// ═══════════════════════════════════════════════════════════════════════════

function formatToolMsg(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Read' && toolInput.file_path) return `Read: ${toolInput.file_path}`
  if (toolName === 'Edit' && toolInput.file_path) return `Edit: ${toolInput.file_path}`
  if (toolName === 'Write' && toolInput.file_path) return `Write: ${toolInput.file_path}`
  if (toolName === 'Bash' && toolInput.command) {
    const cmd = String(toolInput.command).substring(0, 120)
    return `Bash: ${cmd}${String(toolInput.command).length > 120 ? '...' : ''}`
  }
  if (toolName === 'Grep' && toolInput.pattern) return `Grep: "${toolInput.pattern}" in ${toolInput.path || '.'}`
  if (toolName === 'Glob' && toolInput.pattern) return `Glob: ${toolInput.pattern}`
  if (toolName === 'Agent') return `Agent: ${toolInput.description || 'sub-agent'}`
  if (toolName === 'TodoWrite') return `TodoWrite: updating tasks`
  if (Object.keys(toolInput).length > 0) {
    const preview = JSON.stringify(toolInput).substring(0, 100)
    return `${toolName}: ${preview}${JSON.stringify(toolInput).length > 100 ? '...' : ''}`
  }
  return toolName
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Bash: '⚡',
  Grep: '🔍', Glob: '📂', Agent: '🤖', TodoWrite: '📋',
  WebFetch: '🌐', WebSearch: '🔎', Task: '📋', Skill: '🎯',
}

export async function POST(request: NextRequest) {
  // ── Local mode: always admin ──────────────────────────────

  // ── PARSE REQUEST ─────────────────────────────────────────
  let body: { prompt: string; sessionId?: string; model?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { prompt, sessionId, model } = body
  if (!prompt?.trim()) {
    return new Response(JSON.stringify({ error: 'prompt required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const agentModel = model || 'opus'
  const isResume = !!sessionId

  console.log(`[ClaudeCode] ${isResume ? 'Resuming' : 'New'} session (${agentModel}): "${prompt.substring(0, 80)}"`)

  // ── BUILD CLI ARGS ────────────────────────────────────────
  const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  const args = [
    '--print',
    '--verbose',
    '--model', agentModel,
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
  ]
  if (isResume && sessionId) {
    args.push('--resume', sessionId)
  }

  const fullPrompt = isResume
    ? prompt.trim()
    : `${buildSystemPreamble()}\n\n## ADMIN'S REQUEST\n${prompt.trim()}`

  // ── SSE STREAM ────────────────────────────────────────────
  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    start(controller) {
      let eventCounter = 0 // monotonic counter for unique IDs

      function sendEvent(type: string, data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, _id: eventCounter++, ...data })}\n\n`))
        } catch { /* Controller may be closed */ }
      }

      function sendKeepAlive() {
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)) } catch {}
      }

      const keepAliveInterval = setInterval(sendKeepAlive, 15000)
      sendEvent('status', { content: `Starting Claude Code (${agentModel})${isResume ? ' — resuming session' : ''}...` })

      // ── SPAWN CLAUDE CODE ───────────────────────────────
      const child = spawn(claudePath, args, {
        cwd: OASIS_ROOT,
        shell: true,
        env: { ...process.env },
      })

      child.stdin.write(fullPrompt)
      child.stdin.end()

      let streamBuffer = ''
      let capturedSessionId = sessionId || ''
      let costUsd = 0

      // Track what we've already sent from assistant messages
      // Each assistant event is a COMPLETE snapshot — we diff against previous
      let lastSeenContentLength = 0
      let lastSeenTextContent = ''
      let lastTextBlockIndex = -1
      // Track tool_use_id → tool name for linking results
      const toolUseIdToName = new Map<string, string>()

      sendEvent('status', { content: 'Claude Code process started. Streaming...' })

      // ── STDOUT: NDJSON stream-json events ─────────────
      child.stdout.on('data', (chunk: Buffer) => {
        streamBuffer += chunk.toString()
        const lines = streamBuffer.split('\n')
        streamBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const raw = JSON.parse(line)
            const eventType = raw.type || 'unknown'

            // ── SYSTEM events ──────────────────────────
            if (eventType === 'system') {
              // Capture session_id from init
              if (raw.subtype === 'init' && raw.session_id) {
                capturedSessionId = raw.session_id
                sendEvent('session', { sessionId: capturedSessionId })
                console.log(`[ClaudeCode] Session: ${capturedSessionId}`)
                sendEvent('status', { content: `Model: ${raw.model || agentModel}` })
              }
              // Skip hooks and other system events
            }

            // ── ASSISTANT messages ─────────────────────
            // Each is a complete snapshot of message.content[]
            // Content blocks: {type:"thinking"}, {type:"tool_use"}, {type:"text"}
            else if (eventType === 'assistant') {
              const msg = raw.message
              if (!msg?.content) continue
              const content = msg.content as Array<{
                type: string
                thinking?: string
                text?: string
                name?: string
                id?: string
                input?: Record<string, unknown>
                signature?: string
              }>

              // ── DIFF LOGIC: detect new + grown blocks in the snapshot ──
              // Claude Code sends COMPLETE snapshots. We track what we've seen
              // and emit only deltas. Three cases:
              // 1. New blocks (index >= lastSeenContentLength) → emit fully
              // 2. Last existing block grew (text/thinking streaming) → emit delta
              // 3. Text block at any position grew (text between tool calls) → emit delta

              // First: check ALL existing blocks for text growth (fixes missing text between tool calls)
              for (let i = 0; i < Math.min(lastSeenContentLength, content.length); i++) {
                const block = content[i]
                if (block.type === 'text' && block.text && block.text.length > lastSeenTextContent.length && i === lastTextBlockIndex) {
                  const delta = block.text.slice(lastSeenTextContent.length)
                  if (delta) sendEvent('text', { content: delta })
                  lastSeenTextContent = block.text
                }
                if (block.type === 'thinking' && block.thinking) {
                  // Thinking always sends full content (frontend replaces)
                  sendEvent('thinking', { content: block.thinking })
                }
              }

              // Then: process genuinely NEW blocks
              for (let i = lastSeenContentLength; i < content.length; i++) {
                const block = content[i]

                if (block.type === 'thinking' && block.thinking) {
                  sendEvent('thinking', { content: block.thinking })
                }
                else if (block.type === 'tool_use' && block.name) {
                  const toolName = block.name
                  const toolId = block.id || `tool-${eventCounter}`
                  const toolInput = block.input || {}
                  const icon = TOOL_ICONS[toolName] || '🔧'
                  const display = formatToolMsg(toolName, toolInput)
                  toolUseIdToName.set(toolId, toolName)
                  sendEvent('tool', {
                    name: toolName,
                    icon,
                    id: toolId,
                    input: toolInput,
                    display,
                  })
                }
                else if (block.type === 'text' && block.text) {
                  sendEvent('text', { content: block.text })
                  lastSeenTextContent = block.text
                  lastTextBlockIndex = i
                }
              }

              // Track the index of the last text block we've seen (for delta detection)
              for (let i = content.length - 1; i >= 0; i--) {
                if (content[i].type === 'text') {
                  lastTextBlockIndex = i
                  if (content[i].text) lastSeenTextContent = content[i].text!
                  break
                }
              }

              lastSeenContentLength = content.length

              // Extract token usage from assistant messages for live progress
              if (msg.usage) {
                sendEvent('progress', {
                  inputTokens: msg.usage.input_tokens || 0,
                  outputTokens: msg.usage.output_tokens || 0,
                })
              }

              // Capture session_id from assistant event too
              if (raw.session_id && !capturedSessionId) {
                capturedSessionId = raw.session_id
                sendEvent('session', { sessionId: capturedSessionId })
              }
            }

            // ── USER messages (tool results) ───────────
            else if (eventType === 'user') {
              // user events contain tool_result blocks in message.content[]
              // AND a tool_use_result shorthand on the outer object
              const contentArr = raw.message?.content as Array<{
                type: string; content?: string; tool_use_id?: string; is_error?: boolean
              }> | undefined

              if (contentArr) {
                for (const block of contentArr) {
                  if (block.type === 'tool_result') {
                    const toolUseId = block.tool_use_id || ''
                    const toolName = toolUseIdToName.get(toolUseId) || 'tool'
                    const resultContent = block.content || ''
                    const isError = block.is_error === true

                    sendEvent('tool_result', {
                      name: toolName,
                      toolUseId,
                      preview: resultContent.substring(0, 500),
                      isError,
                      length: resultContent.length,
                      fullResult: resultContent.length <= 3000 ? resultContent : undefined,
                    })
                  }
                }
              }

              // Reset content tracking — new assistant response will follow
              lastSeenContentLength = 0
              lastSeenTextContent = ''
              lastTextBlockIndex = -1
            }

            // ── RESULT — final metadata ────────────────
            else if (eventType === 'result') {
              costUsd = raw.total_cost_usd ?? costUsd
              sendEvent('result', {
                costUsd,
                durationMs: raw.duration_ms,
                numTurns: raw.num_turns,
                usage: raw.usage,
                sessionId: capturedSessionId,
                stopReason: raw.stop_reason,
              })
            }

            // ── Standalone top-level events ────────────
            // Claude Code 2.1.75 also emits these as shortcuts
            else if (eventType === 'thinking') {
              if (raw.content) {
                sendEvent('thinking', { content: raw.content })
              }
            }
            else if (eventType === 'text') {
              if (raw.content) {
                sendEvent('text', { content: raw.content })
              }
            }
            else if (eventType === 'direct') {
              // Direct tool call (shortcut event)
              const tool = raw.tool
              if (tool?.name) {
                const icon = TOOL_ICONS[tool.name] || '🔧'
                const display = formatToolMsg(tool.name, tool.input || {})
                sendEvent('tool', {
                  name: tool.name,
                  icon,
                  id: tool.id || `tool-${eventCounter}`,
                  input: tool.input || {},
                  display,
                })
              }
            }

            // Skip: rate_limit_event, hooks, etc.

          } catch (parseErr) {
            // Not JSON — raw startup text
            if (line.trim().length > 0 && line.trim().length < 500) {
              console.log(`[Ariel:raw] ${line.trim().substring(0, 100)}`)
            }
          }
        }
      })

      // ── STDERR ──────────────────────────────────────────
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text.length > 0 && text.length < 2000) {
          console.log(`[ClaudeCode:stderr] ${text.substring(0, 200)}`)
          sendEvent('stderr', { content: text })
        }
      })

      // ── PROCESS ERROR ───────────────────────────────────
      child.on('error', (err) => {
        clearInterval(keepAliveInterval)
        console.error(`[ClaudeCode] Spawn error: ${err.message}`)
        sendEvent('error', { content: `Failed to spawn claude: ${err.message}` })
        sendEvent('done', { success: false, sessionId: capturedSessionId })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      // ── PROCESS EXIT ────────────────────────────────────
      child.on('close', (code) => {
        clearInterval(keepAliveInterval)
        console.log(`[ClaudeCode] Process exited with code ${code}, cost=$${costUsd.toFixed(4)}`)

        sendEvent('done', {
          success: code === 0,
          exitCode: code,
          sessionId: capturedSessionId,
          costUsd,
        })
        try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch {}
        controller.close()
      })

      // ── CLEANUP on client disconnect ────────────────────
      request.signal.addEventListener('abort', () => {
        clearInterval(keepAliveInterval)
        console.log('[ClaudeCode] Client disconnected, killing process')
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

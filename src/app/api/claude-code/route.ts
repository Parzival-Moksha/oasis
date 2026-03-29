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
//
// MCP TOOLS — mission-mcp provides:
//   Media: generate_image, generate_voice, generate_video
//   Missions: get_mission, get_missions_queue, create_mission, mature_mission
//   CI: report_review, report_test
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ''
const OASIS_ROOT = process.env.OASIS_ROOT || process.cwd()

// ═══════════════════════════════════════════════════════════════════════════
// MCP CONFIG — mission-mcp has media + mission tools
// Generated at startup so the claude CLI can --mcp-config it
// ═══════════════════════════════════════════════════════════════════════════

const MCP_CONFIG_PATH = path.join(OASIS_ROOT, '.claude-code-mcp.json')

function ensureMcpConfig(): string {
  const config = {
    mcpServers: {
      'mission': {
        command: 'node',
        args: [path.join(OASIS_ROOT, 'tools/mission-mcp/index.js')],
        cwd: OASIS_ROOT,
        env: {
          OASIS_DB_PATH: path.join(OASIS_ROOT, 'prisma/data/oasis.db'),
          OASIS_URL: `http://localhost:4516`,
        },
      },
    },
  }
  // Write atomically — only if changed
  const json = JSON.stringify(config, null, 2)
  try {
    const existing = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8')
    if (existing === json) return MCP_CONFIG_PATH
  } catch { /* file doesn't exist yet */ }
  fs.writeFileSync(MCP_CONFIG_PATH, json)
  return MCP_CONFIG_PATH
}

// Media tool names — when these return results with URLs, we emit 'media' SSE events
// Claude Code prefixes MCP tools with mcp_{servername}_ so we match both forms
// Claude Code MCP tool naming: mcp__{servername}__{toolname} (double underscores)
const MEDIA_TOOL_NAMES = new Set([
  'generate_image', 'generate_voice', 'generate_video',
  'mcp_mission_generate_image', 'mcp_mission_generate_voice', 'mcp_mission_generate_video',
  'mcp__mission__generate_image', 'mcp__mission__generate_voice', 'mcp__mission__generate_video',
])

function mediaTypeFromTool(name: string): 'image' | 'audio' | 'video' | null {
  if (name.includes('generate_image')) return 'image'
  if (name.includes('generate_voice')) return 'audio'
  if (name.includes('generate_video')) return 'video'
  return null
}

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

## OASIS MCP TOOLS (via mission server)
You have access to MCP tools for media generation and mission management:

### Media Generation
- **generate_image**(prompt, model?) — Generate an image from text. Models: gemini-flash, riverflow, seedream, flux-klein. Returns URL.
- **generate_voice**(text, voice?) — Generate speech audio via ElevenLabs TTS. Voices: rachel, adam, sam, elli. Returns URL.
- **generate_video**(prompt, duration?, image_url?) — Generate video via fal.ai LTX 2.3. Duration: 6-20s. Returns URL.

### Mission Management (DevCraft)
- **get_mission**(id) — Read a mission by ID (full row with history, scores).
- **get_missions_queue**(limit?, status?) — List curator queue missions sorted by priority.
- **create_mission**(name, description?, urgency?, easiness?, impact?) — Create a new mission.
- **mature_mission**(id, carbonDescription, siliconDescription, ...) — Write curator enrichment.
- **report_review**(id, score, findings?) — Record reviewer score + findings.
- **report_test**(id, score, valor?, findings?) — Record tester score + valor.

Use media tools when the conversation benefits from visuals, audio, or video. Use mission tools to manage the DevCraft pipeline.

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
  // MCP media tools
  if (toolName === 'generate_image') return `🎨 Image: "${(toolInput.prompt as string || '').substring(0, 80)}"`
  if (toolName === 'generate_voice') return `🔊 Voice: "${(toolInput.text as string || '').substring(0, 80)}"`
  if (toolName === 'generate_video') return `🎬 Video: "${(toolInput.prompt as string || '').substring(0, 80)}"`
  // MCP mission tools
  if (toolName === 'get_mission') return `📋 Get mission #${toolInput.id}`
  if (toolName === 'get_missions_queue') return `📋 List missions${toolInput.status ? ` (${toolInput.status})` : ''}`
  if (toolName === 'create_mission') return `📋 Create mission: "${(toolInput.name as string || '').substring(0, 60)}"`
  if (toolName === 'mature_mission') return `📋 Mature mission #${toolInput.id}`
  if (toolName === 'report_review') return `📋 Review mission #${toolInput.id}: ${toolInput.score}/100`
  if (toolName === 'report_test') return `📋 Test mission #${toolInput.id}: ${toolInput.score}/100`
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
  // MCP media tools
  generate_image: '🎨', generate_voice: '🔊', generate_video: '🎬',
  // MCP mission tools
  get_mission: '📋', get_missions_queue: '📋', create_mission: '📋',
  mature_mission: '📋', report_review: '📋', report_test: '📋',
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

  // Ensure MCP config file exists for mission-mcp (media + mission tools)
  let mcpConfigPath: string | null = null
  try { mcpConfigPath = ensureMcpConfig() } catch (e) {
    console.warn(`[ClaudeCode] Failed to write MCP config: ${e}`)
  }

  const args = [
    '--print',
    '--verbose',
    '--model', agentModel,
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
  ]
  // Load MCP servers (media + mission tools)
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath)
  }
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
      let totalInputTokens = 0
      let totalOutputTokens = 0

      // Track what we've already sent from assistant messages
      // Each assistant event is a COMPLETE snapshot — we diff against previous
      let lastSeenContentLength = 0
      let lastSeenTextContent = ''
      let lastTextBlockIndex = -1
      const emittedToolInputs = new Set<string>() // track which tool_use IDs we've emitted with populated input
      // Track tool_use_id → tool name for linking results
      const toolUseIdToName = new Map<string, string>()
      // Track tool_use_id → input for media tools (need prompt for media events)
      const toolUseIdToInput = new Map<string, Record<string, unknown>>()

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

              // First: check ALL existing blocks for growth (fixes missing text + late tool input)
              for (let i = 0; i < Math.min(lastSeenContentLength, content.length); i++) {
                const block = content[i]
                if (block.type === 'text' && block.text && block.text.length > lastSeenTextContent.length && i === lastTextBlockIndex) {
                  const delta = block.text.slice(lastSeenTextContent.length)
                  if (delta) sendEvent('text', { content: delta })
                  lastSeenTextContent = block.text
                }
                if (block.type === 'thinking' && block.thinking) {
                  sendEvent('thinking', { content: block.thinking })
                }
                // Re-emit tool_use if input was empty before but now populated
                if (block.type === 'tool_use' && block.name && block.input && Object.keys(block.input).length > 0) {
                  const toolId = block.id || ''
                  if (toolId && !emittedToolInputs.has(toolId)) {
                    emittedToolInputs.add(toolId)
                    const icon = TOOL_ICONS[block.name] || '🔧'
                    sendEvent('tool', {
                      name: block.name,
                      icon,
                      id: toolId,
                      input: block.input,
                      display: formatToolMsg(block.name, block.input),
                    })
                    // Stash input for media tools so we can emit media events on result
                    if (MEDIA_TOOL_NAMES.has(block.name)) {
                      toolUseIdToInput.set(toolId, block.input)
                    }
                  }
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
                  if (Object.keys(toolInput).length > 0) {
                    emittedToolInputs.add(toolId)
                    // Stash input for media tools so we can emit media events on result
                    if (MEDIA_TOOL_NAMES.has(toolName)) {
                      toolUseIdToInput.set(toolId, toolInput)
                    }
                  }
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
                totalInputTokens = Number(msg.usage.input_tokens) || totalInputTokens
                totalOutputTokens = Number(msg.usage.output_tokens) || totalOutputTokens
                sendEvent('progress', {
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
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
                type: string; content?: string | Array<{type: string; text?: string}>; tool_use_id?: string; is_error?: boolean
              }> | undefined

              // DEBUG: log all user events to trace media tool results
              if (contentArr) {
                for (const b of contentArr) {
                  if (b.type === 'tool_result') {
                    const tn = toolUseIdToName.get(b.tool_use_id || '') || '?'
                    console.log(`[MEDIA-DEBUG] tool_result: name=${tn} id=${b.tool_use_id} isMedia=${MEDIA_TOOL_NAMES.has(tn)} content_preview=${String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).substring(0, 200)}`)
                  }
                }
              }

              // Helper: extract text from MCP content (string, array, or JSON string of array)
              function extractResultText(content: unknown): string {
                if (typeof content === 'string') {
                  // Could be a JSON-encoded MCP content array: '[{"type":"text","text":"..."}]'
                  if (content.startsWith('[')) {
                    try {
                      const arr = JSON.parse(content) as Array<{type?: string; text?: string}>
                      if (Array.isArray(arr)) return arr.map(c => c.text || '').join('\n')
                    } catch { /* not JSON, use as-is */ }
                  }
                  return content
                }
                if (Array.isArray(content)) {
                  return (content as Array<{text?: string}>).map(c => c.text || '').join('\n')
                }
                return ''
              }

              // Helper: extract media URL from result text
              // MCP returns: "Image generated: http://...", or local paths like /generated-images/...
              function extractMediaUrl(text: string): string | null {
                // 1. Try absolute URL (http/https)
                const absMatch = text.match(/https?:\/\/[^\s"'\]}>)]+/)
                if (absMatch) return absMatch[0]
                // 2. Try local /generated-* path
                const localMatch = text.match(/(\/generated-(?:images|voices|videos)\/[^\s"'\]}>)]+)/)
                if (localMatch) return localMatch[1]
                // 3. Try to parse as JSON and extract url field
                try {
                  const parsed = JSON.parse(text)
                  if (parsed?.url) return String(parsed.url)
                } catch { /* not JSON */ }
                return null
              }

              if (contentArr) {
                for (const block of contentArr) {
                  if (block.type === 'tool_result') {
                    const toolUseId = block.tool_use_id || ''
                    const toolName = toolUseIdToName.get(toolUseId) || 'tool'
                    const resultContent = extractResultText(block.content)
                    const isError = block.is_error === true

                    sendEvent('tool_result', {
                      name: toolName,
                      toolUseId,
                      preview: resultContent.substring(0, 500),
                      isError,
                      length: resultContent.length,
                      fullResult: resultContent.length <= 3000 ? resultContent : undefined,
                    })

                    // ── MEDIA EVENT: extract URL from media tool results ──
                    if (!isError && MEDIA_TOOL_NAMES.has(toolName)) {
                      const mType = mediaTypeFromTool(toolName)
                      const mediaUrl = extractMediaUrl(resultContent)
                      if (mType && mediaUrl) {
                        const toolInput = toolUseIdToInput.get(toolUseId) || {}
                        const prompt = (toolInput.prompt || toolInput.text || '') as string
                        console.log(`[MEDIA-DEBUG] Emitting media event: type=${mType} url=${mediaUrl}`)
                        sendEvent('media', { mediaType: mType, url: mediaUrl, prompt })
                      } else {
                        console.warn(`[MEDIA-DEBUG] URL extraction FAILED for tool=${toolName}, result preview: ${resultContent.substring(0, 300)}`)
                      }
                    }
                  }
                }
              }

              // ── FALLBACK: tool_use_result shorthand (some CLI versions) ──
              // Claude CLI may also emit tool results as raw.tool_use_result
              if (raw.tool_use_result && !contentArr?.length) {
                const tur = raw.tool_use_result as Record<string, unknown>
                const toolUseId = (tur.tool_use_id || '') as string
                const toolName = toolUseIdToName.get(toolUseId) || 'tool'
                const resultContent = extractResultText(tur.content || tur.output || tur.text || '')
                const isError = tur.is_error === true

                if (resultContent) {
                  sendEvent('tool_result', {
                    name: toolName,
                    toolUseId,
                    preview: resultContent.substring(0, 500),
                    isError,
                    length: resultContent.length,
                    fullResult: resultContent.length <= 3000 ? resultContent : undefined,
                  })

                  if (!isError && MEDIA_TOOL_NAMES.has(toolName)) {
                    const mType = mediaTypeFromTool(toolName)
                    const mediaUrl = extractMediaUrl(resultContent)
                    if (mType && mediaUrl) {
                      const toolInput = toolUseIdToInput.get(toolUseId) || {}
                      const prompt = (toolInput.prompt || toolInput.text || '') as string
                      console.log(`[MEDIA-DEBUG] Emitting media event (fallback): type=${mType} url=${mediaUrl}`)
                      sendEvent('media', { mediaType: mType, url: mediaUrl, prompt })
                    }
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
              // Extract final token counts from usage object
              if (raw.usage) {
                totalInputTokens = Number(raw.usage.input_tokens) || totalInputTokens
                totalOutputTokens = Number(raw.usage.output_tokens) || totalOutputTokens
              }
              sendEvent('result', {
                costUsd,
                durationMs: raw.duration_ms,
                numTurns: raw.num_turns,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
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
                const toolId = tool.id || `tool-${eventCounter}`
                const toolInput = tool.input || {}
                const icon = TOOL_ICONS[tool.name] || '🔧'
                const display = formatToolMsg(tool.name, toolInput)
                toolUseIdToName.set(toolId, tool.name)
                if (MEDIA_TOOL_NAMES.has(tool.name) && Object.keys(toolInput).length > 0) {
                  toolUseIdToInput.set(toolId, toolInput)
                }
                sendEvent('tool', {
                  name: tool.name,
                  icon,
                  id: toolId,
                  input: toolInput,
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
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
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

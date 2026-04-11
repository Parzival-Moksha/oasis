// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/craft/cc — Claude Code CLI streaming craft endpoint
// ─═̷─═̷─ॐ─═̷─═̷─ Local crafting via Claude Code subscription ─═̷─═̷─ॐ─═̷─═̷─
// Spawns claude CLI, streams NDJSON, extracts text deltas,
// outputs raw text stream identical to /api/craft/stream.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { CRAFT_SYSTEM_PROMPT } from '../../../../lib/craft-prompt'
import { buildClaudeCliEnv } from '../../../../lib/claude-cli-env'

const OASIS_ROOT = path.resolve(process.cwd())
const VALID_MODELS: Record<string, string> = {
  'cc-opus': 'opus',
  'cc-sonnet': 'sonnet',
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, model: requestedModel } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (prompt.length > 2000) {
      return new Response(JSON.stringify({ error: 'Prompt too long' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const cliModel = VALID_MODELS[requestedModel as string]
    if (!cliModel) {
      return new Response(JSON.stringify({ error: `Invalid CC model: ${requestedModel}` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const claudePath = process.platform === 'win32' ? 'claude.cmd' : 'claude'
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--model', cliModel,
      '--max-turns', '1',
      '--dangerously-skip-permissions',
      '--verbose',
    ]

    // Claude Code models may try to use tools (Read, Write, Bash, etc.)
    // instead of outputting raw JSON. Explicit no-tool instructions prevent this.
    const fullPrompt = [
      'CRITICAL: You are a JSON generator. Do NOT use any tools — no Read, Write, Edit, Bash, Grep, Glob, Agent, ToolSearch, or any other tool. Output ONLY raw JSON text directly. No code fences, no markdown, no commentary.',
      '',
      CRAFT_SYSTEM_PROMPT,
      '',
      `Design a 3D scene for: ${prompt.trim()}`,
    ].join('\n')

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        const child = spawn(claudePath, args, {
          cwd: OASIS_ROOT,
          shell: true,
          env: buildClaudeCliEnv(),
        })

        child.stdin.write(fullPrompt)
        child.stdin.end()

        let streamBuffer = ''
        let previousText = ''

        child.stdout.on('data', (chunk: Buffer) => {
          streamBuffer += chunk.toString()
          const lines = streamBuffer.split('\n')
          streamBuffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue

            try {
              const raw = JSON.parse(line) as Record<string, unknown>
              if (raw.type !== 'assistant') continue

              const message = (raw.message || {}) as Record<string, unknown>
              const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []

              for (const block of content) {
                // Log tool use attempts — helps diagnose models that try to use tools
                if (block.type === 'tool_use' && typeof block.name === 'string') {
                  console.warn(`[Craft:CC] Model tried to use tool: ${block.name} — should be outputting raw JSON instead`)
                }
                if (block.type !== 'text' || typeof block.text !== 'string') continue

                // Text is cumulative — extract delta
                if (block.text.startsWith(previousText)) {
                  const delta = block.text.slice(previousText.length)
                  if (delta) {
                    controller.enqueue(encoder.encode(delta))
                  }
                } else if (block.text !== previousText) {
                  // Full replacement — emit entire new text
                  controller.enqueue(encoder.encode(block.text))
                }
                previousText = block.text
              }
            } catch {
              // Malformed NDJSON line — skip
            }
          }
        })

        child.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim()
          if (!msg) return
          // Only log errors by default — full stderr is noisy (CLI startup, model loading, etc.)
          if (msg.includes('Error') || msg.includes('error') || msg.includes('WARN')) {
            console.error(`[Craft:CC:stderr] ${msg.substring(0, 300)}`)
          }
        })

        child.on('close', (code) => {
          console.log(`[Craft:CC] Process exited with code ${code}`)
          // Flush remaining buffer
          if (streamBuffer.trim()) {
            try {
              const raw = JSON.parse(streamBuffer) as Record<string, unknown>
              if (raw.type === 'assistant') {
                const message = (raw.message || {}) as Record<string, unknown>
                const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []
                for (const block of content) {
                  if (block.type === 'text' && typeof block.text === 'string') {
                    const delta = block.text.startsWith(previousText)
                      ? block.text.slice(previousText.length)
                      : block.text
                    if (delta) controller.enqueue(encoder.encode(delta))
                  }
                }
              }
            } catch { /* ignore */ }
          }
          controller.close()
        })

        child.on('error', (err) => {
          console.error('[Craft:CC] spawn error:', err)
          controller.close()
        })
      },
    })

    console.log(`[Craft:CC] Streaming ${cliModel} scene for: "${prompt.trim().slice(0, 60)}"`)

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })

  } catch (err) {
    console.error('[Craft:CC] Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

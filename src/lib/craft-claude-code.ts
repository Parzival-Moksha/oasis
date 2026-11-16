// ░▒▓ CRAFT WITH CLAUDE CODE — text-to-3D through the owner's own Claude Code login ▓▒░
// The craft picker's "Claude Code · Opus 5.5 / Fable 5.2" run the claude CLI once, like the village's agents
// (the subscription, no API key): no tools, no MCP servers, no settings or hooks, no saved session, in an empty
// folder, with the craft prompt as the whole system prompt. Its text streams out exactly like the OpenRouter
// stream (/api/craft/stream), so every craft UI reads it the same way. Local only (the routes guard it).

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { resolveClaudeCli } from './claude-bin'
import { buildClaudeCliEnv } from './claude-cli-env'
import { CRAFT_SYSTEM_PROMPT } from './craft-prompt'

const NO_TOOLS = 'You are a JSON generator. You have no tools. Output ONLY the raw JSON object: no code fences, no markdown, no commentary.'
/** A craft that runs this long is stuck: stop it. */
const CRAFT_TIMEOUT_MS = 5 * 60_000

export function claudeCodeCraftArgs(cliModel: string): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', cliModel,
    '--system-prompt', `${NO_TOOLS}\n\n${CRAFT_SYSTEM_PROMPT}`,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--max-turns', '1',
  ]
}

/** One stream-json line -> the text it adds ('' for none), or an error the CLI reported. */
export function craftTextFromLine(line: string): { text: string; final?: string; error?: string } {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(line)
  } catch {
    return { text: '' }
  }
  if (raw.type === 'stream_event' && raw.event && typeof raw.event === 'object') {
    const event = raw.event as { type?: string; delta?: { type?: string; text?: string } }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
      return { text: event.delta.text }
    }
    return { text: '' }
  }
  if (raw.type === 'result') {
    if (raw.is_error) return { text: '', error: String(raw.result || raw.subtype || 'Claude Code failed').slice(0, 300) }
    return { text: '', final: typeof raw.result === 'string' ? raw.result : '' }
  }
  return { text: '' }
}

export interface ClaudeCodeCraft {
  /** Resolves with the text stream once the first words arrive, or rejects with why Claude Code could not start. */
  ready: Promise<ReadableStream<Uint8Array>>
  cancel: () => void
}

export function craftWithClaudeCode(prompt: string, cliModel: string): ClaudeCodeCraft {
  const cli = resolveClaudeCli()
  const cwd = path.join(os.tmpdir(), 'oasis-craft')
  fs.mkdirSync(cwd, { recursive: true })
  const child: ChildProcessWithoutNullStreams = spawn(cli.command, [...cli.prefixArgs, ...claudeCodeCraftArgs(cliModel)], {
    cwd,
    shell: cli.shell,
    env: buildClaudeCliEnv(),
    windowsHide: true,
  })
  child.stdin.end(`Design a 3D scene for: ${prompt.trim()}`)

  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const early: string[] = []
  let emitted = ''
  let closed = false
  let stderr = ''
  let settle: { resolve: (s: ReadableStream<Uint8Array>) => void; reject: (e: Error) => void } | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      for (const text of early.splice(0)) c.enqueue(encoder.encode(text))
    },
    cancel() { child.kill() },
  })
  const ready = new Promise<ReadableStream<Uint8Array>>((resolve, reject) => { settle = { resolve, reject } })

  const emit = (text: string) => {
    if (!text || closed) return
    emitted += text
    if (controller) controller.enqueue(encoder.encode(text))
    else early.push(text)
    if (settle) { settle.resolve(stream); settle = null }
  }
  const fail = (why: string) => {
    if (settle) { settle.reject(new Error(why)); settle = null }
    else if (!closed) { closed = true; controller?.error(new Error(why)) }
  }

  let buffer = ''
  const onLine = (line: string) => {
    if (!line.trim()) return
    const { text, final, error } = craftTextFromLine(line)
    if (error) return fail(`Claude Code: ${error}`)
    if (text) emit(text)
    // No partial messages came (an older CLI): the whole answer arrives with the result.
    if (final && !emitted) emit(final)
  }
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(onLine)
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000) })
  const timer = setTimeout(() => { fail('Claude Code took more than 5 minutes'); child.kill() }, CRAFT_TIMEOUT_MS)
  child.on('error', error => { clearTimeout(timer); fail(`Claude Code did not start: ${error.message}`) })
  child.on('close', code => {
    clearTimeout(timer)
    if (buffer.trim()) onLine(buffer)
    if (!emitted) {
      const why = stderr.trim().split('\n').filter(Boolean).pop() || `exit ${code}`
      return fail(`Claude Code returned nothing (${why.slice(0, 200)})`)
    }
    if (!closed) { closed = true; controller?.close() }
  })

  return { ready, cancel: () => child.kill() }
}

/** The text/plain response every craft UI reads; a JSON error when Claude Code can't start. */
export async function claudeCodeCraftResponse(prompt: string, cliModel: string, signal?: AbortSignal): Promise<Response> {
  const craft = craftWithClaudeCode(prompt, cliModel)
  signal?.addEventListener('abort', () => craft.cancel(), { once: true })
  try {
    const stream = await craft.ready
    console.log(`[Craft:CC] ${cliModel} crafting: "${prompt.trim().slice(0, 60)}"`)
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Craft:CC] ${message}`)
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: { 'Content-Type': 'application/json' } })
  }
}

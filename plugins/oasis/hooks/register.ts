// Oasis bridge: makes the Oasis a live second window onto this session.
//
// The session keeps running where it is (the desktop app, a terminal). The Oasis agent engine
// (packages/oasis-agent-engine, src/bridge.js) watches it, and what the owner says in the Oasis waits
// there until this mod collects it and submits it as a prompt of this same session. So both windows
// show one conversation, run by one process, and nothing forks.
//
//   every second   POST <engine>/bridge/poll  {sessionId, cwd, surface}  -> {messages: [{text}]}
//   while replying POST <engine>/bridge/event {sessionId, kind: 'text', index, text}
//
// When the Oasis isn't running the polls fail quietly. OASIS_ENGINE_URL overrides the engine address.
//
// The session also learns where it is: when the engine answers, one short section is added to the system
// prompt (prompt.compose). The world tools themselves come from this plugin's .mcp.json (the Oasis MCP server).
import type { Register, EngineInterface } from 'claude-code'

/** Where the owner keeps the mission board; OASIS_MISSIONS_DIR overrides it. */
const MISSIONS_DIR = 'C:\\7c_oasis\\docs\\missions'

/** Facts only, under 150 tokens: it changes nothing about how the session does its work. */
function oasisNote(missions: string): string {
  return [
    '# The Oasis',
    "This session is also an agent in the owner's Oasis, a 3D village on this machine where each Claude Code session has an avatar at a desk.",
    'The owner may talk to this session there, by voice or text; what they say arrives here as an ordinary prompt.',
    'The Oasis MCP server (tools named oasis) can look at that world, place and change things in it, and take screenshots.',
    `The mission board is the folder ${missions}.`,
  ].join('\n')
}

/** The section, or null when the Oasis engine doesn't answer (then the session is told nothing). */
async function oasisSection($: EngineInterface, fallback: string): Promise<string | null> {
  try {
    const at = ((await $.env.get('OASIS_ENGINE_URL')) || fallback).replace(/\/+$/, '')
    const health = await $.http.fetch(`${at}/health`)
    if (!health.ok) return null
    return oasisNote((await $.env.get('OASIS_MISSIONS_DIR')) || MISSIONS_DIR)
  } catch {
    return null
  }
}

const POLL_MS = 1000
const FLUSH_MS = 120

function post($: EngineInterface, engine: string, path: string, body: object) {
  return $.http.fetch(`${engine}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const register: Register = on => {
  let engine = 'http://127.0.0.1:4530'
  let sessionId = ''

  // Asked once per load of the mod: a system prompt section has to answer the same way for a whole thread.
  let note: Promise<string | null> | undefined

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.traits.includes('bare') || e.traits.includes('teammate')) return composed
    const text = await (note ??= oasisSection($, engine))
    if (!text) return composed
    return { sections: [...composed.sections, { id: 'oasis:village', text, scope: 'session' }] }
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    engine = ((await $.env.get('OASIS_ENGINE_URL')) || engine).replace(/\/+$/, '')
    sessionId = await $.session.id()
    let polling = false
    $.clock.every(POLL_MS, () => {
      if (polling) return
      polling = true
      void (async () => {
        try {
          sessionId = await $.session.id() // a /clear starts a new transcript
          const res = await post($, engine, '/bridge/poll', { sessionId, cwd: e.cwd, surface: e.surface })
          if (!res.ok) return
          const { messages } = JSON.parse(res.text) as { messages?: Array<{ text?: string }> }
          for (const m of messages || []) {
            if (m?.text?.trim()) await $.prompt.submit({ text: m.text })
          }
        } catch {
          // The Oasis isn't running, or answered something odd: try again next second.
        } finally {
          polling = false
        }
      })()
    })
    return started
  })

  // The reply as it streams, so the Oasis shows it word by word like this window does.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId || !sessionId) return yield* stream // subagents: the transcript shows their work
    let buffer = ''
    let index = 0
    let flushedAt = Date.now()
    const flush = () => {
      if (!buffer) return
      const text = buffer
      buffer = ''
      flushedAt = Date.now()
      void post($, engine, '/bridge/event', { sessionId, kind: 'text', index, text }).catch(() => {})
    }
    const pieces = stream[Symbol.asyncIterator]()
    for (;;) {
      const piece = await pieces.next()
      if (piece.done) {
        flush()
        return piece.value
      }
      yield piece.value
      if (piece.value.kind === 'text') {
        if (piece.value.index !== index) flush()
        index = piece.value.index
        buffer += piece.value.text
        if (Date.now() - flushedAt >= FLUSH_MS) flush()
      }
    }
  })
}

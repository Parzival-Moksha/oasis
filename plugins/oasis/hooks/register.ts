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
// /oasis (a slash command this mod registers) opens the Oasis on this session: it starts the two servers when they
// aren't running (scripts/oasis-launch.ps1, Windows), opens the village in the browser, and has the camera walk to
// this session's avatar. With the Oasis already open in a tab, it only walks the camera. /oasis status reports.
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

const WORLD_URL = 'http://localhost:4516/?profile=village'
const LAUNCH_TIMEOUT_MS = 150_000

/** /oasis status: what is running, in two lines. */
async function oasisStatus($: EngineInterface, engine: string): Promise<string> {
  try {
    const health = await $.http.fetch(`${engine}/health`)
    if (!health.ok) return 'The Oasis engine is not running. /oasis starts it.'
    const { agents, clients } = JSON.parse(health.text) as { agents?: number; clients?: number }
    const pages = clients === undefined ? '' : clients ? `, open in ${clients} browser tab${clients === 1 ? '' : 's'}` : ', not open in any browser tab'
    return `The Oasis engine is running: ${agents ?? 0} agent${agents === 1 ? '' : 's'} in the village${pages}.`
  } catch {
    return 'The Oasis engine is not running. /oasis starts it.'
  }
}

/** /oasis: show this session in the Oasis, starting and opening it when needed. Returns the line to print. */
async function openOasis($: EngineInterface, engine: string, sessionId: string, cwd: string): Promise<string> {
  // Already open in a tab? Then the engine walks that tab's camera here; no second tab.
  try {
    const res = await post($, engine, '/bridge/open', { sessionId, cwd })
    if (res.ok) {
      const { agentId, clients } = JSON.parse(res.text) as { agentId?: string | null; clients?: number }
      if (clients && agentId) return 'The Oasis is open. This session is in front of you there.'
      if (clients) return 'The Oasis is open. This session has no transcript yet: send a message here first, then /oasis again.'
    }
  } catch {
    // The engine is down, or an older one without /bridge/open: the launcher below handles both.
  }
  if ((await $.env.get('OS')) !== 'Windows_NT') {
    return `The /oasis launcher is Windows-only for now. Start the Oasis by hand (pnpm dev:engine and pnpm dev in its folder), then open ${WORLD_URL}&session=${sessionId}`
  }
  const home = (await $.env.get('OASIS_HOME')) || ''
  const script = `${$.plugin.root}\\scripts\\oasis-launch.ps1`
  const argv = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Url', `${WORLD_URL}&session=${sessionId}`]
  if (home) argv.push('-OasisHome', home)
  try {
    const ran = await $.process.run(argv, { timeoutMs: LAUNCH_TIMEOUT_MS })
    const said = ran.stdout.trim().split(/\r?\n/).filter(Boolean).join(' ')
    if (ran.exitCode === 0) {
      const started = said.includes('started in its own window')
      return `${started ? 'Started the Oasis (its ENGINE and WORLD windows) and opened it' : 'Opened the Oasis'} in your browser. This session will be in front of you there.`
    }
    return said || `The Oasis launcher failed (exit ${ran.exitCode}).`
  } catch {
    return 'The Oasis launcher could not run. Start the Oasis with its desktop shortcut, then /oasis again.'
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
    await $.command.register({ name: 'oasis', description: 'Open the Oasis on this session (starts it if needed); /oasis status' })
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

  on('command.run', { command: 'oasis' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'status') return { text: await oasisStatus($, engine) }
    return { text: await openOasis($, engine, await $.session.id(), await $.session.cwd()) }
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

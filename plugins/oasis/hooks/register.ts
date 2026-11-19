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
// aren't running (scripts/oasis-launch.mjs: Windows, macOS, Linux; on the first run it installs the slim Oasis),
// opens the village in the browser, and has the camera walk to this session's avatar. With the Oasis already open in a tab, it only walks the camera. /oasis status reports.
//
// The session also learns where it is: when the engine answers, one short section is added to the system
// prompt (prompt.compose). The world tools themselves come from this plugin's .mcp.json (the Oasis MCP server).
//
// And who it is there: the engine keeps a card per agent (name, role, voice, look, place, a short who-you-are;
// packages/oasis-agent-engine/src/character.js). For a session the engine does not run itself (the desktop app, a
// terminal), this mod asks for the card's note (POST <engine>/bridge/character) and hands it to the model beside
// the next prompt typed here (prompt.submit `context`: the model reads it, the person never sees it): once per
// load of the mod, and again when the card changed. Sessions the engine runs get the same note with the owner's
// messages, so the mod leaves those alone (OASIS_AGENT_ID is set in their environment).
import type { Register, EngineInterface } from 'claude-code'

/** Short, about 200 tokens: where the session is, its tools, and where things for the owner go. */
function oasisNote(missions: string, grill: string, canSendFiles: boolean): string {
  return [
    '# The Oasis',
    "This session is also an agent in the owner's Oasis, a 3D village on this machine where each Claude Code session has an avatar at a desk.",
    'The owner may talk to this session there, by voice or text; what they say arrives here as an ordinary prompt.',
    'The Oasis MCP server (tools named oasis) can look at that world, place and change things in it, and take screenshots.',
    ...(canSendFiles ? ['To show the owner a picture, an audio file, a video or a document, send the file with SendUserFile (it plays or opens in the thread); a file path alone is not enough.'] : []),
    ...(missions ? [`The mission board is the folder ${missions}.`] : []),
    ...(grill ? [`Questions for the owner that are not urgent go at the bottom of ${grill}, under "Added by agents": one line with your name, the question and your recommendation, instead of waiting in this thread.`] : []),
  ].join('\n')
}

/**
 * The section, or null when the Oasis engine doesn't answer (then the session is told nothing).
 * Where the mission board and the list of questions are is the machine's own business: the engine says
 * (`places` in /health, from its settings), and OASIS_MISSIONS_DIR / OASIS_GRILL_FILE override it.
 */
async function oasisSection($: EngineInterface, fallback: string, canSendFiles: boolean): Promise<string | null> {
  try {
    const at = ((await $.env.get('OASIS_ENGINE_URL')) || fallback).replace(/\/+$/, '')
    const health = await $.http.fetch(`${at}/health`)
    if (!health.ok) return null
    let places: { missions?: string; grill?: string } = {}
    try {
      places = (JSON.parse(health.text) as { places?: { missions?: string; grill?: string } }).places || {}
    } catch {
      places = {}
    }
    return oasisNote((await $.env.get('OASIS_MISSIONS_DIR')) || places.missions || '', (await $.env.get('OASIS_GRILL_FILE')) || places.grill || '', canSendFiles)
  } catch {
    return null
  }
}

const WORLD_URL = 'http://localhost:4516/?profile=village'
// A first run downloads the slim Oasis, installs its packages and builds it: minutes, once.
// Ten minutes is the longest a mod may let a program run.
const LAUNCH_TIMEOUT_MS = 600_000

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
  // One launcher for Windows, macOS and Linux (scripts/oasis-launch.mjs): it finds the Oasis on this machine,
  // installs the slim one on the first run, starts what is not running and opens the browser.
  const home = (await $.env.get('OASIS_HOME')) || ''
  const argv = ['node', `${$.plugin.root}/scripts/oasis-launch.mjs`, '--session', sessionId]
  if (home) argv.push('--home', home)
  try {
    const ran = await $.process.run(argv, { timeoutMs: LAUNCH_TIMEOUT_MS })
    const said = ran.stdout.trim().split(/\r?\n/).filter(Boolean)
    if (ran.exitCode === 0) {
      const installed = said.some(line => line.startsWith('Installed the Oasis'))
      const started = said.some(line => /^Started the |started in its own window/.test(line))
      return `${installed ? 'Installed the Oasis, started it and opened it' : started ? 'Started the Oasis and opened it' : 'Opened the Oasis'} in your browser. This session will be in front of you there.`
    }
    return said.slice(-2).join(' ') || `The Oasis launcher failed (exit ${ran.exitCode}).`
  } catch {
    return 'The Oasis launcher did not finish. If this was the first run, it may still be installing: type /oasis again in a minute. Otherwise check that Node.js 20 or later is on the PATH (node --version).'
  }
}

const POLL_MS = 1000
const FLUSH_MS = 120
/** The card is asked for again this often at most (it changes when the owner or the agent edits it, or the world does). */
const CHARACTER_EVERY_MS = 60_000

/** This session's who-you-are note and what it was made from; null when it has no place in the village (or no engine). */
async function characterNote($: EngineInterface, engine: string, sessionId: string): Promise<{ note: string; stamp: string } | null> {
  try {
    const res = await post($, engine, '/bridge/character', { sessionId })
    if (!res.ok) return null
    const { note, stamp } = JSON.parse(res.text) as { note?: string | null; stamp?: string }
    return note ? { note, stamp: stamp || note } : null
  } catch {
    return null // an older engine, or none running
  }
}

/**
 * The Oasis's local key (~/.oasis/token), read once through the launcher. An Oasis started with a key refuses
 * requests without it; one started without (or none installed) gives '' and nothing is sent.
 */
let key: Promise<string> | undefined
function localKey($: EngineInterface): Promise<string> {
  return (key ??= $.process
    .run(['node', `${$.plugin.root}/scripts/oasis-launch.mjs`, '--token'], { timeoutMs: 10_000 })
    .then(ran => (ran.exitCode === 0 ? ran.stdout.trim() : ''))
    .catch(() => ''))
}

async function post($: EngineInterface, engine: string, path: string, body: object) {
  const send = async () => {
    const token = await localKey($)
    return $.http.fetch(`${engine}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-oasis-token': token } : {}) },
      body: JSON.stringify(body),
    })
  }
  const res = await send()
  if (res.status !== 403) return res
  key = undefined // the Oasis was installed or its key made after this session started: read it again, once
  return send()
}

export const register: Register = on => {
  let engine = 'http://127.0.0.1:4530'
  let sessionId = ''

  // Asked once per load of the mod: a system prompt section has to answer the same way for a whole thread.
  let note: Promise<string | null> | undefined

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.traits.includes('bare') || e.traits.includes('teammate')) return composed
    // SendUserFile exists only where the host shows files (the engine's agents; the desktop app, when it does): say it then.
    const text = await (note ??= oasisSection($, engine, e.tools.includes('SendUserFile')))
    if (!text) return composed
    return { sections: [...composed.sections, { id: 'oasis:village', text, scope: 'session' }] }
  })

  // Who this session is in the village, beside a prompt typed here (see the header).
  let toldStamp: string | null = null
  let askedAt = 0
  let known: { note: string; stamp: string } | null = null
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    let note: string | null = null
    try {
      // The engine runs sessions that have OASIS_AGENT_ID and tells those itself.
      if (!(await $.env.get('OASIS_AGENT_ID'))) {
        const now = Date.now()
        // Not in the village yet (nobody watches this session): ask again soon, it may be summoned any moment.
        if (now - askedAt > (known ? CHARACTER_EVERY_MS : 5000)) {
          askedAt = now
          known = await characterNote($, engine, await $.session.id())
        }
        if (known && known.stamp !== toldStamp) {
          toldStamp = known.stamp
          note = known.note
        }
      }
    } catch {
      note = null // never in the way of a prompt
    }
    return next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
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

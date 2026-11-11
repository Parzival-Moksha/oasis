// packages/oasis-agent-engine/src/telegram.js: routing, chunking and pings as pure functions, then the whole line
// against a fake Telegram Bot API (a local HTTP stub) and a fake engine. The real bot is never called.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as tgModule from '../../../packages/oasis-agent-engine/src/telegram.js'

type Agent = { id: string; kind: string; name: string; status: string; statusReason?: string; bridged?: boolean; lastWriteAt?: number; permissions?: Array<Record<string, unknown>> }
type Route = { kind: string; agent?: Agent; text?: string; name?: string; matches?: Agent[]; command?: string; arg?: string }
interface Line {
  start: () => Line
  stop: () => void
  onEvent: (e: Record<string, unknown>) => void
  command: (a?: Record<string, unknown>) => Record<string, unknown>
  state: { offset: number; pings: boolean }
  cfg: { ok: boolean; token: string }
  refreshConfig: () => void
  sweepBridge: (now?: number) => void
}
const tg = tgModule as unknown as {
  parseRoute: (text: string, agents: Agent[]) => Route
  chunkText: (text: string, max?: number) => string[]
  mdToHtml: (md: string) => string
  agentListText: (agents: Agent[]) => string
  pingText: (a: Agent, o?: { lastText?: string; lastTurnEnd?: Record<string, unknown> | null }) => string
  lastQuestion: (text: string) => string
  defaultAgent: (agents: Agent[]) => Agent | null
  TelegramLine: new (o: Record<string, unknown>) => Line
}

const village: Agent[] = [
  { id: 'a-anorak', kind: 'owned', name: 'Anorakdev', status: 'waiting' },
  { id: 'a-tyler', kind: 'owned', name: 'Tyler', status: 'working' },
  { id: 'a-telegram', kind: 'owned', name: 'Telegram', status: 'working' },
  { id: 'a-wall', kind: 'owned', name: 'Mission Wall', status: 'needs-decision', statusReason: 'permission' },
  { id: 'a-og', kind: 'owned', name: "Og's ward", status: 'idle' },
  { id: 'a-wg', kind: 'owned', name: 'WG kereső', status: 'error', statusReason: 'claude exited (code 1)' },
  { id: 'obs-1', kind: 'observer', name: 'Desk session', status: 'waiting' },
]

describe('telegram: routing', () => {
  const route = (text: string) => tg.parseRoute(text, village)

  it('sends "Name: ..." and "@name ..." to that agent, case-insensitive prefix', () => {
    expect(route('Tyler: fix the intro')).toMatchObject({ kind: 'agent', agent: { id: 'a-tyler' }, text: 'fix the intro' })
    expect(route('@tyler fix the intro')).toMatchObject({ kind: 'agent', agent: { id: 'a-tyler' }, text: 'fix the intro' })
    expect(route('@TY: fix it')).toMatchObject({ kind: 'agent', agent: { id: 'a-tyler' }, text: 'fix it' })
    expect(route('mission wall: add a card')).toMatchObject({ kind: 'agent', agent: { id: 'a-wall' }, text: 'add a card' })
    expect(route('@missionwall add a card')).toMatchObject({ kind: 'agent', agent: { id: 'a-wall' } })
    expect(route("@og's check")).toMatchObject({ kind: 'agent', agent: { id: 'a-og' } })
    expect(route('@wgkereso look')).toMatchObject({ kind: 'agent', agent: { id: 'a-wg' } })
    expect(route('Anorak: hi')).toMatchObject({ kind: 'agent', agent: { id: 'a-anorak' }, text: 'hi' })
  })

  it('keeps the rest of a multi-line message', () => {
    expect(route('Tyler: one\ntwo')).toMatchObject({ kind: 'agent', text: 'one\ntwo' })
  })

  it('sends everything without a name to Anorak', () => {
    expect(route('gm, how is it going')).toMatchObject({ kind: 'default', text: 'gm, how is it going' })
    expect(route("Here's the thing: the intro is broken")).toMatchObject({ kind: 'default' })
    expect(route('see https://example.com/x for it')).toMatchObject({ kind: 'default' })
    expect(route('https://example.com/x')).toMatchObject({ kind: 'default' })
    expect(route('at 10:30 we meet')).toMatchObject({ kind: 'default' })
    expect(tg.defaultAgent(village)?.id).toBe('a-anorak')
  })

  it('answers an unknown or unclear name with the list', () => {
    expect(route('@nobody hi')).toMatchObject({ kind: 'unknown', name: 'nobody' })
    // "Word: ..." with no such agent is a sentence: it goes to Anorak. Only "@name" bounces.
    expect(route('Tylr: hi')).toMatchObject({ kind: 'default', text: 'Tylr: hi' })
    expect(route('Note: build is red')).toMatchObject({ kind: 'default' })
    expect(route('PS: one more thing')).toMatchObject({ kind: 'default' })
    expect(route('@t hi')).toMatchObject({ kind: 'ambiguous' })
    expect(route('@t hi').matches?.map(a => a.name)).toEqual(['Tyler', 'Telegram'])
  })

  it('takes "Tyler, ..." (how voice notes come out) only for a known name', () => {
    expect(route('Tyler, check the lights.')).toMatchObject({ kind: 'agent', agent: { id: 'a-tyler' }, text: 'check the lights.' })
    expect(route('Hey Tyler, check the lights')).toMatchObject({ kind: 'agent', agent: { id: 'a-tyler' } })
    expect(route('Okay, so the lights are off')).toMatchObject({ kind: 'default' })
    expect(route('Ty, hi')).toMatchObject({ kind: 'default' }) // under 3 letters: too easy to hit by accident
  })

  it('reads commands, also with the bot name after them', () => {
    expect(route('/agents')).toMatchObject({ kind: 'command', command: 'agents', arg: '' })
    expect(route('/pings@anorakprobot off')).toMatchObject({ kind: 'command', command: 'pings', arg: 'off' })
    expect(route('/stop tyler')).toMatchObject({ kind: 'command', command: 'stop', arg: 'tyler' })
  })

  it('lists agents with a colour each', () => {
    const list = tg.agentListText(village)
    expect(list).toContain('🔵 Anorakdev · waiting')
    expect(list).toContain('🟢 Tyler · working')
    expect(list).toContain('🟠 Mission Wall · needs you (permission)')
    expect(list).toContain('🔴 WG kereső · error')
    expect(list).toContain('⚪ Og\'s ward · idle')
    expect(list).toContain('Desk session · waiting · watching only')
  })
})

describe('telegram: long text and markdown', () => {
  it('splits at line breaks and never past the limit', () => {
    const para = 'word '.repeat(150).trim()
    const text = Array.from({ length: 20 }, (_, i) => `${i} ${para}`).join('\n\n')
    const chunks = tg.chunkText(text, 4096)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
    expect(tg.chunkText('x'.repeat(10000), 4096).map(c => c.length)).toEqual([4088, 4088, 1824])
  })

  it('closes a code block cut in two and reopens it', () => {
    const code = '```js\n' + Array.from({ length: 400 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n```'
    const chunks = tg.chunkText(code, 2000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect((c.match(/```/g) || []).length % 2).toBe(0)
  })

  it('turns markdown into Telegram HTML, escaping the rest', () => {
    expect(tg.mdToHtml('**Done.** Ran `a<b && c`, see [the PR](https://x.y/1?a=1&b=2).\n# Title\n- one'))
      .toBe('<b>Done.</b> Ran <code>a&lt;b &amp;&amp; c</code>, see <a href="https://x.y/1?a=1&amp;b=2">the PR</a>.\n<b>Title</b>\n• one')
    expect(tg.mdToHtml('```ts\nif (a < b) {}\n```')).toBe('<pre>if (a &lt; b) {}</pre>')
    expect(tg.mdToHtml('2 * 3 < 4 > 1')).toBe('2 * 3 &lt; 4 &gt; 1')
  })
})

describe('telegram: ping text', () => {
  it('says what the agent waits for', () => {
    expect(tg.pingText({ ...village[1], status: 'needs-decision', permissions: [{ requestKind: 'permission', toolName: 'Bash', summary: 'Bash: npm test' }] }))
      .toBe('🟠 Tyler needs you: allow Bash: npm test?')
    expect(tg.pingText({ ...village[1], status: 'needs-decision', permissions: [{ requestKind: 'permission', toolName: 'Write', summary: 'Write src/intro.ts' }] }))
      .toBe('🟠 Tyler needs you: allow Write src/intro.ts?')
    expect(tg.pingText({ ...village[1], status: 'needs-decision', permissions: [{ requestKind: 'question', input: { questions: [{ question: 'Red or blue?' }] } }] }))
      .toBe('🟠 Tyler needs you: Red or blue?')
    expect(tg.pingText({ ...village[1], status: 'needs-decision', statusReason: 'question-text' }, { lastText: 'I fixed the intro.\n\nShall I also **push** it? Or wait for you?' }))
      .toBe('🟠 Tyler needs you: Shall I also push it? Or wait for you?')
    expect(tg.pingText({ ...village[1], status: 'needs-decision', statusReason: 'permission-denied' }, { lastTurnEnd: { permissionDenials: [{ toolName: 'Write' }] } }))
      .toBe('🟠 Tyler needs you: Write was blocked and needs your OK')
    expect(tg.pingText(village[5])).toBe('🔴 WG kereső is stuck: claude exited (code 1)')
  })

  it('finds the last question in a reply', () => {
    expect(tg.lastQuestion('Done. Want me to deploy it now?')).toBe('Want me to deploy it now?')
    expect(tg.lastQuestion('Line one?\nLine two.')).toBe('Line one?')
    expect(tg.lastQuestion('OK. Which?')).toBe('OK. Which?')
  })
})

// ------------------------------------------------------------------ the whole line, against a fake Bot API
const TOKEN = '123456:FAKE-token-never-real_abcdefghijklmnop'
const CHAT = '555'
type Call = { method: string; body: Record<string, unknown>; raw: string }
const calls: Call[] = []
let updates: Array<Record<string, unknown>> = []
let nextUpdateId = 1000
let server: http.Server
let base = ''
let scribeText = 'Tyler, check the lights.'
let flakyFailed = false
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-telegram-'))
const logs: string[] = []

function push(message: Record<string, unknown>) {
  updates.push({ update_id: nextUpdateId++, message: { chat: { id: Number(CHAT) }, date: Math.floor(Date.now() / 1000), ...message } })
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const json = (obj: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === `/file/bot${TOKEN}/voice/file_7.oga`) { res.writeHead(200); res.end(Buffer.from('OggS fake audio')); return }
      if (req.url === '/scribe') {
        calls.push({ method: 'scribe', body: { key: req.headers['xi-api-key'] }, raw })
        return json({ text: scribeText, language_code: 'en' })
      }
      const m = req.url?.match(/^\/bot([^/]+)\/(\w+)$/)
      if (!m || m[1] !== TOKEN) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' })); return }
      const method = m[2]
      let body: Record<string, unknown> = {}
      if (String(req.headers['content-type']).startsWith('application/json')) body = JSON.parse(raw || '{}')
      if (method === 'getUpdates') {
        const offset = Number(body.offset || 0)
        const until = Date.now() + Number(body.timeout || 0) * 1000
        while (!updates.some(u => (u.update_id as number) >= offset) && Date.now() < until) await new Promise(r => setTimeout(r, 20))
        updates = updates.filter(u => (u.update_id as number) >= offset)
        return json({ ok: true, result: updates })
      }
      calls.push({ method, body, raw })
      if (method === 'getFile') return json({ ok: true, result: { file_id: body.file_id, file_path: 'voice/file_7.oga' } })
      if (method === 'sendMessage' && String(body.text).includes('FLAKY') && !flakyFailed) {
        flakyFailed = true
        res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error_code: 502, description: 'Bad Gateway' })); return
      }
      if (method === 'sendMessage' && body.parse_mode === 'HTML' && String(body.text).includes('BROKEN-HTML')) {
        return json({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" })
      }
      return json({ ok: true, result: { message_id: calls.length } })
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ enabled: true, botToken: TOKEN, chatId: CHAT, pollingEnabled: false }))
  fs.writeFileSync(path.join(dir, 'shot.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'notes')
})
afterAll(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }) })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!pred()) { if (Date.now() > end) throw new Error('timed out'); await sleep(10) }
}
const sent = (method = 'sendMessage') => calls.filter(c => c.method === method)
const texts = () => sent().map(c => String(c.body.text))

function makeLine(agents: Agent[], extra: Record<string, unknown> = {}) {
  const delivered: Array<{ agentId: string; text: string }> = []
  let n = 0
  const line = new tg.TelegramLine({
    configFile: path.join(dir, 'config.json'),
    stateFile: path.join(dir, `state-${Math.random().toString(36).slice(2)}.json`),
    apiBase: base,
    pollTimeoutS: 1,
    pingMs: 120,
    scribeApi: `${base}/scribe`,
    scribeKey: () => 'fake-scribe-key',
    fileFor: (id: string) => ({ 'f-png': { path: path.join(dir, 'shot.png'), isImage: true }, 'f-txt': { path: path.join(dir, 'notes.txt'), isImage: false } } as Record<string, { path: string; isImage: boolean }>)[id] || null,
    listAgents: () => agents,
    send: async (agentId: string, text: string) => {
      delivered.push({ agentId, text })
      const a = agents.find(x => x.id === agentId)
      return a?.kind === 'owned' ? { uuid: `u${++n}` } : { queued: true, viaBridge: true }
    },
    interrupt: async () => ({ ok: true }),
    log: (s: string) => logs.push(s),
    ...extra,
  })
  return { line: line.start(), delivered }
}

describe('telegram: the line, against a fake Bot API', () => {
  let current: Line | null = null
  afterEach(async () => {
    // Let queued sends land before the next test looks at the calls.
    await (current as unknown as { outbox?: Promise<unknown> } | null)?.outbox
    current?.stop(); current = null; calls.length = 0; updates = []
  })

  it('takes only the owner chat, routes by name, replies when the turn ends, sends files', async () => {
    const agents = village.map(a => ({ ...a }))
    const { line, delivered } = makeLine(agents)
    current = line
    push({ chat: { id: 999 }, text: 'Tyler: I am a stranger' })
    push({ text: 'Tyler: fix the intro' })
    await until(() => delivered.length === 1)
    expect(delivered[0]).toEqual({ agentId: 'a-tyler', text: '[Telegram] fix the intro' })
    expect(logs.some(l => l.includes('ignored a message from chat 999'))).toBe(true)
    // The engine: the message went in and was taken; the agent wrote, sent two files and ended its turn.
    const ev = (kind: string, p: Record<string, unknown> = {}) => line.onEvent({ v: 1, agentId: 'a-tyler', ts: Date.now(), kind, ...p })
    ev('text', { text: 'an earlier turn, not ours', parentToolUseId: null })
    ev('user.consumed', { uuid: 'u1', folded: false })
    ev('text', { text: 'Looking…', parentToolUseId: null })
    ev('text', { text: 'subagent chatter', parentToolUseId: 'toolu_x' })
    ev('tool.start', { toolUseId: 't1', name: 'SendUserFile', input: { caption: 'the new intro' } })
    ev('tool.end', { toolUseId: 't1', name: 'SendUserFile', attachments: [{ id: 'f-png', name: 'shot.png', isImage: true }, { id: 'f-txt', name: 'notes.txt', isImage: false }] })
    ev('text', { text: 'Fixed the **intro**.', parentToolUseId: null })
    ev('turn.end', { outcome: 'done-waiting', reason: 'end_turn', result: 'Fixed the **intro**.' })
    await until(() => sent('sendDocument').length === 1)
    const reply = sent().find(c => String(c.body.text).includes('intro'))
    expect(reply?.body).toMatchObject({ chat_id: CHAT, parse_mode: 'HTML', text: '<b>Tyler</b>\nFixed the <b>intro</b>.' })
    expect(sent('sendPhoto')[0].raw).toContain('the new intro')
    expect(sent('sendPhoto')[0].raw).toContain('filename="shot.png"')
    expect(sent('sendDocument')[0].raw).toContain('filename="notes.txt"')
    expect(calls.findIndex(c => c.method === 'sendPhoto')).toBeGreaterThan(calls.indexOf(reply!))
    expect(sent('sendChatAction').length).toBeGreaterThan(0)
    expect(texts().join('\n')).not.toContain('stranger')
    // The offset moved past both updates and is on disk.
    expect(line.state.offset).toBe(nextUpdateId)
  })

  it('sends a message without a name to Anorak and answers without a name prefix, in pieces when long', async () => {
    const agents = village.map(a => ({ ...a }))
    const { line, delivered } = makeLine(agents)
    current = line
    push({ text: 'gm anorak' })
    await until(() => delivered.length === 1)
    expect(delivered[0]).toEqual({ agentId: 'a-anorak', text: '[Telegram] gm anorak' })
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${'lorem ipsum '.repeat(25)}`).join('\n\n')
    line.onEvent({ agentId: 'a-anorak', kind: 'user.sent', uuid: 'u-early', text: 'something typed in the Oasis' })
    line.onEvent({ agentId: 'a-anorak', kind: 'user.consumed', uuid: 'u1' })
    line.onEvent({ agentId: 'a-anorak', kind: 'text', text: long, parentToolUseId: null })
    line.onEvent({ agentId: 'a-anorak', kind: 'turn.end', outcome: 'done-waiting', reason: 'end_turn', result: long.slice(0, 2000) })
    await until(() => texts().join('').includes('Paragraph 39'))
    const pieces = sent().filter(c => String(c.body.text).includes('Paragraph'))
    expect(pieces.length).toBeGreaterThan(2)
    for (const p of pieces) expect(String(p.body.text).length).toBeLessThanOrEqual(4096)
    expect(String(pieces[0].body.text).startsWith('Paragraph 0')).toBe(true) // Anorak: no name in front
  })

  it('falls back to plain text when Telegram refuses the HTML', async () => {
    const { line, delivered } = makeLine(village.map(a => ({ ...a })))
    current = line
    push({ text: 'Tyler: go' })
    await until(() => delivered.length === 1)
    line.onEvent({ agentId: 'a-tyler', kind: 'user.consumed', uuid: 'u1' })
    line.onEvent({ agentId: 'a-tyler', kind: 'turn.end', outcome: 'done-waiting', reason: 'end_turn', result: 'BROKEN-HTML **x**' })
    await until(() => sent().length >= 2)
    expect(sent().at(-1)?.body).toMatchObject({ text: 'Tyler:\nBROKEN-HTML **x**' })
    expect(sent().at(-1)?.body.parse_mode).toBeUndefined()
  })

  it('answers /agents, an unknown name, and a bridged session through its first prompt', async () => {
    const agents: Agent[] = [...village.map(a => ({ ...a })), { id: 'obs-2', kind: 'observer', name: 'Rick', status: 'waiting', bridged: true }]
    const { line, delivered } = makeLine(agents)
    current = line
    push({ text: '/agents' })
    push({ text: '@nobody hi' })
    push({ text: 'Rick: hello' })
    await until(() => delivered.length === 1 && sent().length >= 2)
    expect(texts()[0]).toContain('🟢 Tyler · working')
    expect(texts()[1]).toMatch(/^No agent called "nobody"/)
    expect(texts()[1]).toContain('🔵 Anorakdev · waiting')
    expect(delivered[0]).toEqual({ agentId: 'obs-2', text: '[Telegram] hello' })
    // The bridged session: a turn that was already running ends first (not ours), then our prompt shows up.
    line.onEvent({ agentId: 'obs-2', kind: 'user', text: 'typed at the desk meanwhile' })
    line.onEvent({ agentId: 'obs-2', kind: 'user', text: '<task-notification> a background task finished' })
    line.onEvent({ agentId: 'obs-2', kind: 'turn.end', outcome: 'done-waiting', result: 'old turn' })
    line.onEvent({ agentId: 'obs-2', kind: 'user', text: 'The oasis plugin sent a message: [Telegram] hello' })
    line.onEvent({ agentId: 'obs-2', kind: 'text', text: 'Hi from the desk', parentToolUseId: null })
    line.onEvent({ agentId: 'obs-2', kind: 'turn.end', outcome: 'done-waiting', result: 'Hi from the desk' })
    await until(() => texts().some(t => t.includes('Hi from the desk')))
    expect(texts().some(t => t.includes('old turn'))).toBe(false)
  })

  it('says so when a bridged session goes away before taking the message', async () => {
    const rick: Agent = { id: 'obs-2', kind: 'observer', name: 'Rick', status: 'waiting', bridged: true }
    const { line, delivered } = makeLine([...village.map(a => ({ ...a })), rick])
    current = line
    push({ text: 'Rick: hello' })
    await until(() => delivered.length === 1)
    line.sweepBridge(Date.now() + 70_000) // still connected: keep waiting
    rick.bridged = false
    line.sweepBridge(Date.now() + 30_000) // gone, but the bridge may still hand it over
    await sleep(50)
    expect(texts()).toEqual([])
    line.sweepBridge(Date.now() + 70_000)
    await until(() => texts().length === 1)
    expect(texts()[0]).toBe('Rick never picked up your message (the session went away).')
    // Nothing armed afterwards: a later desk turn does not go to the phone.
    line.onEvent({ agentId: 'obs-2', kind: 'user', text: 'The oasis plugin sent a message: [Telegram] hello' })
    line.onEvent({ agentId: 'obs-2', kind: 'turn.end', outcome: 'done-waiting', result: 'desk turn' })
    await sleep(100)
    expect(texts()).toHaveLength(1)
  })

  it('says so when the agent is removed before answering', async () => {
    const { line, delivered } = makeLine(village.map(a => ({ ...a })))
    current = line
    push({ text: 'Tyler: long job' })
    await until(() => delivered.length === 1)
    line.onEvent({ agentId: 'a-tyler', kind: 'user.consumed', uuid: 'u1' })
    line.onEvent({ agentId: 'a-tyler', kind: 'removed' })
    await until(() => texts().length === 1)
    expect(texts()[0]).toBe('Tyler was stopped or moved before answering your message.')
  })

  it('tries a reply again after a network or server error', async () => {
    const { line, delivered } = makeLine(village.map(a => ({ ...a })))
    current = line
    flakyFailed = false
    push({ text: 'Tyler: go' })
    await until(() => delivered.length === 1)
    line.onEvent({ agentId: 'a-tyler', kind: 'user.consumed', uuid: 'u1' })
    line.onEvent({ agentId: 'a-tyler', kind: 'turn.end', outcome: 'done-waiting', reason: 'end_turn', result: 'FLAKY answer' })
    await until(() => texts().some(t => t.includes('FLAKY')), 6000)
    expect(flakyFailed).toBe(true)
    expect(texts().filter(t => t.includes('FLAKY'))).toHaveLength(1)
  }, 10_000)

  it('keeps the last good config through a half-written file, and sends nothing while it is off', async () => {
    const { line } = makeLine(village.map(a => ({ ...a })))
    current = line
    const file = path.join(dir, 'config.json')
    const good = fs.readFileSync(file, 'utf8')
    try {
      fs.writeFileSync(file, '{"enabled": true, "botTok')
      line.refreshConfig()
      expect(line.cfg).toMatchObject({ ok: true, token: TOKEN })
      fs.writeFileSync(file, JSON.stringify({ enabled: false, botToken: TOKEN, chatId: CHAT }))
      line.refreshConfig()
      expect(line.cfg.ok).toBe(false)
      line.onEvent({ agentId: 'a-tyler', kind: 'status', status: 'error', reason: 'x' })
      push({ text: '/agents' })
      await sleep(400)
      expect(texts()).toEqual([])
    } finally {
      fs.writeFileSync(file, good)
      line.refreshConfig()
    }
  })

  it('pings once per state change after the wait, and not when the state passes or pings are off', async () => {
    const agents = village.map(a => ({ ...a }))
    const { line } = makeLine(agents)
    current = line
    const tyler = agents[1]
    const status = (status: string, reason = '') => { tyler.status = status; tyler.statusReason = reason; line.onEvent({ agentId: 'a-tyler', kind: 'status', status, reason }) }
    // Amber, but back to work before the wait is over: nothing.
    status('needs-decision', 'permission')
    await sleep(40)
    status('working', 'turn running')
    await sleep(160)
    expect(texts()).toEqual([])
    // Amber and staying: one ping, even when the reason changes and more status events come.
    tyler.permissions = [{ requestKind: 'permission', toolName: 'Bash', summary: 'pnpm test' }]
    status('needs-decision', 'permission')
    await sleep(40)
    status('needs-decision', 'question')
    await until(() => texts().length === 1, 1000)
    await sleep(200)
    expect(texts()).toEqual(['🟠 Tyler needs you: allow Bash: pnpm test?'])
    // A new state change: a new ping.
    tyler.permissions = []
    status('working')
    status('error', 'claude exited (code 1)')
    await until(() => texts().length === 2, 1000)
    expect(texts()[1]).toBe('🔴 Tyler is stuck: claude exited (code 1)')
    expect(logs.some(l => l.includes('ping: Tyler (error: claude exited (code 1))'))).toBe(true)
    // Pings off from the phone: no more pings.
    push({ text: '/pings off' })
    await until(() => texts().length === 3)
    expect(texts()[2]).toMatch(/^Pings are off/)
    expect(line.state.pings).toBe(false)
    status('working')
    status('needs-decision', 'question-text')
    await sleep(250)
    expect(texts().length).toBe(3)
    expect(line.command({ pings: true }).pings).toBe(true)
  })

  it('does not ping a question it already delivered as the reply', async () => {
    const agents = village.map(a => ({ ...a }))
    const { line, delivered } = makeLine(agents)
    current = line
    push({ text: 'Tyler: what next' })
    await until(() => delivered.length === 1)
    line.onEvent({ agentId: 'a-tyler', kind: 'user.consumed', uuid: 'u1' })
    line.onEvent({ agentId: 'a-tyler', kind: 'text', text: 'Push it now?', parentToolUseId: null })
    line.onEvent({ agentId: 'a-tyler', kind: 'turn.end', outcome: 'needs-decision', reason: 'question-text', result: 'Push it now?' })
    agents[1].status = 'needs-decision'; agents[1].statusReason = 'question-text'
    line.onEvent({ agentId: 'a-tyler', kind: 'status', status: 'needs-decision', reason: 'question-text' })
    await sleep(300)
    expect(texts().filter(t => t.includes('Push it now?'))).toHaveLength(1)
    expect(texts().some(t => t.startsWith('🟠'))).toBe(false)
  })

  it('does not ping an old question replayed from a watched transcript', async () => {
    const agents = village.map(a => ({ ...a }))
    const { line } = makeLine(agents)
    current = line
    Object.assign(agents[6], { status: 'needs-decision', statusReason: 'question-text', lastWriteAt: Date.now() - 3600_000 })
    line.onEvent({ agentId: 'obs-1', kind: 'status', status: 'needs-decision', reason: 'question-text' })
    await sleep(250)
    expect(texts()).toEqual([])
  })

  it('transcribes a voice note with Scribe, echoes it, and routes it like text', async () => {
    const { line, delivered } = makeLine(village.map(a => ({ ...a })))
    current = line
    scribeText = 'Tyler, check the lights.'
    push({ voice: { file_id: 'voice-1', duration: 3, mime_type: 'audio/ogg', file_size: 15 } })
    await until(() => delivered.length === 1 && texts().length === 1)
    expect(delivered[0]).toEqual({ agentId: 'a-tyler', text: '[Telegram voice note] check the lights.' })
    expect(texts()).toContain('heard: Tyler, check the lights.')
    const scribe = calls.find(c => c.method === 'scribe')!
    expect(scribe.body.key).toBe('fake-scribe-key')
    expect(scribe.raw).toContain('scribe_v2')
    expect(scribe.raw).toContain('Mission Wall') // the village's names help Scribe spell them
    expect(scribe.raw).toContain('OggS fake audio')
  })

  it('says voice notes are not wired when there is no Scribe key', async () => {
    const { line, delivered } = makeLine(village.map(a => ({ ...a })), { scribeKey: () => '' })
    current = line
    push({ voice: { file_id: 'voice-2', duration: 3 } })
    await until(() => texts().length === 1)
    expect(texts()[0]).toMatch(/^Voice notes aren't wired yet/)
    expect(delivered).toEqual([])
  })

  it('never writes the token into a log line', () => {
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.filter(l => l.includes(TOKEN) || l.includes('FAKE-token'))).toEqual([])
  })
})

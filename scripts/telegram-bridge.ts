// ░▒▓ TELEGRAM BRIDGE — text Anorak from Telegram while the Oasis runs on this PC ▓▒░
// A sidecar: long-polls the Telegram Bot API (no open port, works behind any router) and talks to the
// agent engine over its WebSocket exactly like the Oasis page does, so a message from Telegram reaches
// Anorak the same as one typed in the Oasis. Replies come back compressed (lib/telegram/anorak-digest):
// only what the agent writes, and "🔮 conjured for 14 min 15 sec" instead of tool lists.
//
// Setup (once): create a bot with @BotFather, put in .env.local:
//   TELEGRAM_BOT_TOKEN=123456:ABC...
//   TELEGRAM_CHAT_IDS=<your chat id>   (message the bot once: it tells you your id)
// Run: pnpm dev:telegram   (next to pnpm dev and pnpm dev:engine)
// Optional: TELEGRAM_AGENT=anorak (name to look for), TELEGRAM_ENGINE_URL, TELEGRAM_API_BASE (tests).
//
// Only the listed chats can drive an agent: it runs code on this machine.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { AnorakDigest } from '../src/lib/telegram/anorak-digest'

// ─── config ───────────────────────────────────────────────────────────────────

function loadEnvFiles(): void {
  for (const name of ['.env.local', '.env']) {
    let text = ''
    try { text = readFileSync(path.join(process.cwd(), name), 'utf8') } catch { continue }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m || process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
loadEnvFiles()

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ALLOWED = new Set((process.env.TELEGRAM_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean))
const AGENT_PATTERN = (process.env.TELEGRAM_AGENT || 'anorak').toLowerCase()
const ENGINE_URL = process.env.TELEGRAM_ENGINE_URL || 'ws://127.0.0.1:4530/ws'
const API = `${(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '')}/bot${TOKEN}`

function log(...args: unknown[]): void {
  console.log(new Date().toTimeString().slice(0, 8), '[telegram]', ...args)
}

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is missing. Create a bot with @BotFather and put the token in .env.local.')
  process.exit(1)
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const response = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json() as { ok: boolean; result?: T; description?: string }
    if (!data.ok) log(`${method} failed:`, data.description)
    return data.ok ? (data.result ?? null) : null
  } catch (error) {
    log(`${method} error:`, error instanceof Error ? error.message : error)
    return null
  }
}

/** Per chat, messages go out one after another, in order. */
const outbox = new Map<string, Promise<unknown>>()
function say(chatId: string, text: string): void {
  const previous = outbox.get(chatId) || Promise.resolve()
  const next = previous.then(() => tg('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }))
  outbox.set(chatId, next.catch(() => {}))
}

// ─── engine ───────────────────────────────────────────────────────────────────

interface AgentSnap { id: string; kind: string; name: string; status: string; lastWriteAt?: number }

let socket: WebSocket | null = null
let seq = 0
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void }>()
let roster: AgentSnap[] = []

function engineCmd<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return reject(new Error('The agent engine is not running (pnpm dev:engine).'))
    const id = ++seq
    pending.set(id, { resolve: resolve as (data: unknown) => void, reject })
    socket.send(JSON.stringify({ ...args, id, cmd }))
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${cmd}: no answer`)) }, 45_000)
  })
}

interface ChatState { agentName: string | null; digest: AnorakDigest; typingTimer: ReturnType<typeof setInterval> | null }
const chats = new Map<string, ChatState>()

function chat(chatId: string): ChatState {
  let state = chats.get(chatId)
  if (!state) {
    state = { agentName: null, digest: new AnorakDigest(), typingTimer: null }
    chats.set(chatId, state)
  }
  return state
}

/** The agent a chat talks to: the one it picked, else the owned agent whose name matches TELEGRAM_AGENT. */
function resolveAgent(state: ChatState): AgentSnap | null {
  const owned = roster.filter(agent => agent.kind === 'owned')
  if (state.agentName) {
    const picked = owned.find(agent => agent.name.toLowerCase() === state.agentName!.toLowerCase())
    if (picked) return picked
  }
  const matches = owned.filter(agent => agent.name.toLowerCase().includes(AGENT_PATTERN))
  matches.sort((a, b) => Number(b.name.toLowerCase() === AGENT_PATTERN) - Number(a.name.toLowerCase() === AGENT_PATTERN) || (b.lastWriteAt || 0) - (a.lastWriteAt || 0))
  return matches[0] || null
}

function setTyping(chatId: string, state: ChatState, on: boolean): void {
  if (on && !state.typingTimer) {
    void tg('sendChatAction', { chat_id: chatId, action: 'typing' })
    state.typingTimer = setInterval(() => void tg('sendChatAction', { chat_id: chatId, action: 'typing' }), 5000)
  } else if (!on && state.typingTimer) {
    clearInterval(state.typingTimer)
    state.typingTimer = null
  }
}

function onEngineEvent(event: { agentId: string; kind: string; ts: number; [key: string]: unknown }): void {
  if (event.history) return
  for (const [chatId, state] of chats) {
    const agent = resolveAgent(state)
    if (!agent || agent.id !== event.agentId) continue
    for (const message of state.digest.push(event as never)) say(chatId, message)
    if (event.kind === 'turn.end') setTyping(chatId, state, false)
  }
}

let backoff = 1000
function connectEngine(): void {
  const ws = new WebSocket(ENGINE_URL)
  socket = ws
  ws.onopen = () => { backoff = 1000; log('engine connected', ENGINE_URL) }
  ws.onmessage = (message) => {
    let data: { type?: string; agents?: AgentSnap[]; event?: { agentId: string; kind: string; ts: number }; id?: number; ok?: boolean; data?: unknown; error?: string }
    try { data = JSON.parse(String(message.data)) } catch { return }
    if (data.type === 'hello' || data.type === 'agents') roster = data.agents || []
    else if (data.type === 'event' && data.event) onEngineEvent(data.event)
    else if (data.type === 'reply' && typeof data.id === 'number') {
      const waiter = pending.get(data.id)
      if (!waiter) return
      pending.delete(data.id)
      if (data.ok) waiter.resolve(data.data)
      else waiter.reject(new Error(data.error || 'failed'))
    }
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    for (const [, waiter] of pending) waiter.reject(new Error('engine connection closed'))
    pending.clear()
    setTimeout(connectEngine, backoff)
    backoff = Math.min(15_000, backoff * 2)
  }
  ws.onerror = () => { /* onclose follows */ }
}

// ─── commands ─────────────────────────────────────────────────────────────────

const HELP = [
  'Write anything: it goes to the agent like a message in the Oasis.',
  '/agents: who is in the village',
  '/use <name>: talk to another agent',
  '/follow on|off: also get turns started inside the Oasis',
  '/stop: interrupt the running turn',
].join('\n')

async function onMessage(chatId: string, text: string): Promise<void> {
  const state = chat(chatId)
  const [command, ...rest] = text.trim().split(/\s+/)
  const arg = rest.join(' ')
  const agent = resolveAgent(state)
  switch (command.toLowerCase().replace(/@\w+$/, '')) {
    case '/start':
    case '/help':
      say(chatId, `${agent ? `Talking to ${agent.name} (${agent.status}).` : 'No matching agent in the village yet.'}${state.digest.followAll ? ' Following all its turns.' : ''}\n\n${HELP}`)
      return
    case '/agents': {
      const owned = roster.filter(a => a.kind === 'owned')
      say(chatId, owned.length ? owned.map(a => `${a.id === agent?.id ? '▶ ' : '• '}${a.name} · ${a.status}`).join('\n') : 'Nobody in the village (is the agent engine running?).')
      return
    }
    case '/use': {
      const found = roster.filter(a => a.kind === 'owned').find(a => a.name.toLowerCase().includes(arg.toLowerCase()))
      if (!arg || !found) { say(chatId, 'No agent by that name. /agents lists them.'); return }
      state.agentName = found.name
      state.digest = new AnorakDigest({ followAll: state.digest.followAll })
      say(chatId, `Now talking to ${found.name}.`)
      return
    }
    case '/follow':
      state.digest.followAll = !/^(off|no|0)$/i.test(arg)
      say(chatId, state.digest.followAll ? 'You will also get turns started inside the Oasis.' : 'Only turns you start here.')
      return
    case '/stop':
      if (!agent) { say(chatId, 'No agent to stop.'); return }
      try { await engineCmd('interrupt', { agentId: agent.id }); say(chatId, `Interrupted ${agent.name}.`) } catch (error) { say(chatId, `Could not interrupt: ${error instanceof Error ? error.message : error}`) }
      return
    default: {
      if (!agent) { say(chatId, 'No matching agent in the village. /agents lists them, /use picks one.'); return }
      try {
        const reply = await engineCmd<{ uuid?: string }>('send', { agentId: agent.id, text })
        state.digest.claim(reply?.uuid)
        setTyping(chatId, state, true)
      } catch (error) {
        say(chatId, `Not delivered: ${error instanceof Error ? error.message : error}`)
      }
    }
  }
}

// ─── poll loop ────────────────────────────────────────────────────────────────

const toldStrangers = new Set<string>()

async function poll(): Promise<void> {
  let offset = 0
  for (;;) {
    const updates = await tg<Array<{ update_id: number; message?: { chat: { id: number }; text?: string; from?: { username?: string } } }>>('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] })
    if (!updates) { await new Promise(resolve => setTimeout(resolve, 3000)); continue }
    for (const update of updates) {
      offset = update.update_id + 1
      const message = update.message
      if (!message?.text) continue
      const chatId = String(message.chat.id)
      if (!ALLOWED.has(chatId)) {
        // Pairing help: a stranger learns only their own chat id, nothing reaches an agent.
        if (!toldStrangers.has(chatId)) {
          toldStrangers.add(chatId)
          say(chatId, `This bot is private. Your chat id is ${chatId}. If this is your bot, add it to TELEGRAM_CHAT_IDS in .env.local and restart pnpm dev:telegram.`)
        }
        log('ignored a message from chat', chatId, message.from?.username || '')
        continue
      }
      await onMessage(chatId, message.text)
    }
  }
}

log(`starting: agent "${AGENT_PATTERN}", ${ALLOWED.size} allowed chat(s), engine ${ENGINE_URL}`)
if (!ALLOWED.size) log('No TELEGRAM_CHAT_IDS yet: message the bot once to learn your chat id.')
connectEngine()
void poll()

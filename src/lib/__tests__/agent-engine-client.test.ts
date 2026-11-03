import { describe, expect, it, vi } from 'vitest'

// The client module binds its singleton to the Oasis store; these tests drive the class directly.
vi.mock('../../store/oasisStore', () => ({ useOasisStore: { getState: () => ({ agentEngineDispatch: () => {} }) } }))

import {
  AgentEngineClient,
  DEFAULT_AGENT_ENGINE_URL,
  computeBackoffDelay,
  resolveAgentEngineUrl,
  type WebSocketLike,
} from '../agent-engine-client'
import type { AgentEngineAction } from '../../store/slices/agentEngineSlice'

class FakeSocket implements WebSocketLike {
  readyState = 0
  sent: Array<Record<string, unknown>> = []
  onopen: WebSocketLike['onopen'] = null
  onclose: WebSocketLike['onclose'] = null
  onerror: WebSocketLike['onerror'] = null
  onmessage: WebSocketLike['onmessage'] = null
  constructor(public url: string) {}
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  serverOpen() { this.readyState = 1; this.onopen?.({}) }
  serverSend(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }) }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}

function setup(options: { deltaFlushMs?: number } = {}) {
  const sockets: FakeSocket[] = []
  const actions: AgentEngineAction[] = []
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  const client = new AgentEngineClient({
    url: 'ws://127.0.0.1:4530/ws',
    dispatch: action => actions.push(action),
    createSocket: url => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    now: () => 1000,
    random: () => 0.5, // no jitter
    deltaFlushMs: options.deltaFlushMs ?? 50,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: handle => { (handle as { cleared: boolean }).cleared = true },
  })
  const runTimers = (filter?: (ms: number) => boolean) => {
    for (const timer of [...timers]) {
      if (timer.cleared || (filter && !filter(timer.ms))) continue
      timer.cleared = true
      timer.fn()
    }
  }
  return { client, sockets, actions, timers, runTimers }
}

describe('agent engine client helpers', () => {
  it('defaults to the loopback engine URL and accepts ws(s) overrides only', () => {
    expect(resolveAgentEngineUrl(undefined)).toBe(DEFAULT_AGENT_ENGINE_URL)
    expect(resolveAgentEngineUrl('  ')).toBe(DEFAULT_AGENT_ENGINE_URL)
    expect(resolveAgentEngineUrl('http://evil.example')).toBe(DEFAULT_AGENT_ENGINE_URL)
    expect(resolveAgentEngineUrl('ws://127.0.0.1:4999/ws')).toBe('ws://127.0.0.1:4999/ws')
  })

  it('backs off exponentially with a cap and bounded jitter', () => {
    const noJitter = () => 0.5
    expect([1, 2, 3, 4, 5, 6, 12].map(n => computeBackoffDelay(n, {}, noJitter))).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000])
    expect(computeBackoffDelay(0, {}, noJitter)).toBe(1000)
    expect(computeBackoffDelay(1, {}, () => 0)).toBe(800)
    expect(computeBackoffDelay(1, {}, () => 1)).toBe(1200)
    expect(computeBackoffDelay(9, {}, () => 1)).toBe(15000)
  })
})

describe('AgentEngineClient', () => {
  it('reports connecting, then open on hello, and dispatches agents and events', () => {
    const { client, sockets, actions } = setup()
    client.start()
    expect(actions[0]).toMatchObject({ type: 'connection', status: 'connecting' })
    sockets[0].serverOpen()
    sockets[0].serverSend({ type: 'hello', agents: [{ id: 'agent-a', kind: 'owned', name: 'a', status: 'idle' }], backlog: {}, server: { port: 4530 } })
    sockets[0].serverSend({ type: 'agents', agents: [] })
    sockets[0].serverSend({ type: 'event', event: { v: 1, agentId: 'agent-a', ts: 1, kind: 'status', status: 'working' } })
    expect(actions.slice(1).map(a => a.type)).toEqual(['hello', 'agents', 'event'])
    expect(client.isOpen).toBe(true)
  })

  it('resolves and rejects commands by reply id', async () => {
    const { client, sockets } = setup()
    client.start()
    sockets[0].serverOpen()
    const sent = client.send('agent-a', 'hi')
    const failed = client.kill('nope')
    expect(sockets[0].sent).toEqual([
      { id: 1, cmd: 'send', agentId: 'agent-a', text: 'hi' },
      { id: 2, cmd: 'kill', agentId: 'nope' },
    ])
    sockets[0].serverSend({ type: 'reply', id: 2, ok: false, error: 'unknown agent nope' })
    sockets[0].serverSend({ type: 'reply', id: 1, ok: true, data: { uuid: 'u1', midTurn: false } })
    await expect(sent).resolves.toEqual({ uuid: 'u1', midTurn: false })
    await expect(failed).rejects.toThrow('unknown agent nope')
  })

  it('builds respond commands for permissions, questions and plans', () => {
    const { client, sockets } = setup()
    client.start()
    sockets[0].serverOpen()
    void client.respondPermission('a', 'r1', { allow: true, always: true })
    void client.respondPermission('a', 'r2', { allow: false, message: 'no' })
    void client.answerQuestion('a', 'r3', { 'Tea or coffee?': 'Tea' })
    void client.respondPlan('a', 'r4', { approve: false })
    expect(sockets[0].sent.map(({ id: _id, ...rest }) => rest)).toEqual([
      { cmd: 'respond', agentId: 'a', requestId: 'r1', behavior: 'allow', always: true },
      { cmd: 'respond', agentId: 'a', requestId: 'r2', behavior: 'deny', message: 'no' },
      { cmd: 'respond', agentId: 'a', requestId: 'r3', behavior: 'allow', answers: { 'Tea or coffee?': 'Tea' } },
      { cmd: 'respond', agentId: 'a', requestId: 'r4', behavior: 'deny', message: 'Keep planning. The owner did not approve this plan yet.' },
    ])
  })

  it('rejects a reply whose command result says ok:false (control requests that failed)', async () => {
    const { client, sockets } = setup()
    client.start()
    sockets[0].serverOpen()
    const mode = client.setPermissionMode('agent-a', 'plan')
    sockets[0].serverSend({ type: 'reply', id: 1, ok: true, data: { ok: false, error: 'agent process not running' } })
    await expect(mode).rejects.toThrow('agent process not running')
  })

  it('marks an answer in flight until the engine resolves it, and clears it when sending fails', async () => {
    const { client, sockets, actions } = setup()
    client.start()
    sockets[0].serverOpen()
    const ok = client.respondPermission('agent-a', 'req-1', { allow: true })
    expect(actions.at(-1)).toMatchObject({ type: 'decision/pending', requestId: 'req-1', pending: true })
    sockets[0].serverSend({ type: 'reply', id: 1, ok: true, data: { ok: true } })
    await ok
    expect(actions.filter(a => a.type === 'decision/pending')).toHaveLength(1) // the engine's permission.resolved clears it
    const failed = client.answerQuestion('agent-a', 'req-2', { q: 'a' })
    sockets[0].serverSend({ type: 'reply', id: 2, ok: false, error: 'no pending request req-2' })
    await expect(failed).rejects.toThrow('no pending request')
    expect(actions.at(-1)).toMatchObject({ type: 'decision/pending', requestId: 'req-2', pending: false })
  })

  it('rejects commands while offline instead of queueing them', async () => {
    const { client } = setup()
    await expect(client.listSessions()).rejects.toThrow(/offline/)
    client.start()
    await expect(client.listSessions()).rejects.toThrow(/offline/)
  })

  it('goes offline on close, rejects pending commands and reconnects with backoff', async () => {
    const { client, sockets, actions, timers, runTimers } = setup()
    client.start()
    sockets[0].serverOpen()
    const pending = client.listAgents()
    sockets[0].serverClose()
    await expect(pending).rejects.toThrow(/closed/)
    expect(actions.at(-1)).toMatchObject({ type: 'connection', status: 'offline', attempts: 1, nextRetryAt: 2000 })
    expect(timers.at(-1)?.ms).toBe(1000)

    runTimers(ms => ms === 1000)
    expect(sockets).toHaveLength(2)
    sockets[1].serverClose()
    expect(actions.at(-1)).toMatchObject({ status: 'offline', attempts: 2 })
    expect(timers.at(-1)?.ms).toBe(2000)

    // A successful hello resets the backoff.
    runTimers(ms => ms === 2000)
    sockets[2].serverOpen()
    sockets[2].serverSend({ type: 'hello', agents: [], backlog: {} })
    sockets[2].serverClose()
    expect(actions.at(-1)).toMatchObject({ status: 'offline', attempts: 1 })
  })

  it('coalesces text deltas per message and flushes them before other events', () => {
    const { client, sockets, actions, runTimers } = setup()
    client.start()
    sockets[0].serverOpen()
    const delta = (text: string, messageId = 'm1') => sockets[0].serverSend({ type: 'event', event: { v: 1, agentId: 'agent-a', ts: 1, kind: 'text.delta', messageId, text } })
    delta('Hel')
    delta('lo')
    delta('x', 'm2')
    expect(actions.filter(a => a.type === 'event')).toHaveLength(0)
    runTimers(ms => ms === 50)
    let events = actions.filter((a): a is Extract<AgentEngineAction, { type: 'event' }> => a.type === 'event')
    expect(events.map(a => (a.event as { text?: string }).text)).toEqual(['Hello', 'x'])

    delta(' world')
    sockets[0].serverSend({ type: 'event', event: { v: 1, agentId: 'agent-a', ts: 2, kind: 'text', messageId: 'm1', text: 'Hello world' } })
    events = actions.filter((a): a is Extract<AgentEngineAction, { type: 'event' }> => a.type === 'event')
    expect(events.slice(-2).map(a => a.event.kind)).toEqual(['text.delta', 'text'])
  })

  it('stops cleanly: no reconnect, disabled status, pending commands rejected', async () => {
    const { client, sockets, actions, timers } = setup()
    client.start()
    sockets[0].serverOpen()
    const pending = client.listSessions()
    client.stop()
    await expect(pending).rejects.toThrow(/stopped/)
    expect(actions.at(-1)).toMatchObject({ type: 'connection', status: 'disabled' })
    expect(timers.filter(t => !t.cleared && t.ms === 1000)).toHaveLength(0)
    expect(client.isRunning).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  AGENT_LOG_LIMIT,
  agentEngineReducer,
  createAgentEngineSlice,
  createInitialAgentEngineState,
  effectiveStatus,
  isDecisionInFlight,
  selectAttentionQueue,
  selectNextAgentForN,
  type AgentEngineAction,
  type AgentEngineState,
} from '../slices/agentEngineSlice'
import type { EngineAgentSnapshot, EngineEvent } from '../../lib/agent-engine-types'

let clock = 1_000

function ev(agentId: string, kind: string, payload: Record<string, unknown> = {}): EngineEvent {
  clock += 10
  return { ...payload, v: 1, agentId, ts: clock, kind } as EngineEvent
}

function snap(id: string, patch: Partial<EngineAgentSnapshot> = {}): EngineAgentSnapshot {
  return { id, kind: id.startsWith('obs-') ? 'observer' : 'owned', name: id, status: 'idle', ...patch }
}

function run(state: AgentEngineState, ...actions: AgentEngineAction[]): AgentEngineState {
  return actions.reduce(agentEngineReducer, state)
}

function events(state: AgentEngineState, ...list: EngineEvent[]): AgentEngineState {
  return run(state, ...list.map(event => ({ type: 'event', event }) as AgentEngineAction))
}

function hello(agents: EngineAgentSnapshot[], backlog: Record<string, EngineEvent[]> = {}): AgentEngineState {
  return agentEngineReducer(createInitialAgentEngineState(), { type: 'hello', agents, backlog, at: clock })
}

describe('agentEngineReducer: connection + hello', () => {
  it('starts disabled and tracks connection attempts', () => {
    let state = createInitialAgentEngineState()
    expect(state.connection.status).toBe('disabled')
    state = run(state, { type: 'connection', status: 'offline', error: 'ECONNREFUSED', attempts: 3, nextRetryAt: 99, at: 1 })
    expect(state.connection).toMatchObject({ status: 'offline', error: 'ECONNREFUSED', attempts: 3, nextRetryAt: 99 })
    state = run(state, { type: 'connection', status: 'open', at: 2 })
    expect(state.connection).toMatchObject({ status: 'open', error: null, attempts: 0, nextRetryAt: null, connectedAt: 2 })
  })

  it('builds agents from the hello snapshot and folds the backlog, snapshot status wins', () => {
    const state = hello(
      [snap('agent-a', { status: 'waiting', model: 'haiku', cwd: 'C:/x', sessionId: 's1' })],
      {
        'agent-a': [
          ev('agent-a', 'status', { status: 'working', reason: 'turn started' }),
          ev('agent-a', 'text', { text: 'hello there', messageId: 'm1' }),
          ev('agent-a', 'turn.end', { outcome: 'done-waiting', reason: 'end_turn', costUsd: 0.01 }),
        ],
        'agent-gone': [ev('agent-gone', 'text', { text: 'ignored' })],
      },
    )
    expect(state.connection.status).toBe('open')
    expect(state.order).toEqual(['agent-a'])
    const agent = state.agents['agent-a']
    expect(agent).toMatchObject({ status: 'waiting', model: 'haiku', cwd: 'C:/x', sessionId: 's1', owned: true, hydrated: true })
    // Backlog is the past: it shows up in the log but does not count as "finished while you were away".
    expect(agent.unseen).toBe(false)
    expect(agent.log.map(entry => entry.type)).toEqual(['text', 'turn'])
    expect(state.agents['agent-gone']).toBeUndefined()
  })

  it('keeps slot order and focus for agents that survive a reconnect', () => {
    let state = hello([snap('agent-a'), snap('agent-b')])
    state = run(state, { type: 'focus', agentId: 'agent-b' })
    state = agentEngineReducer(state, { type: 'hello', agents: [snap('agent-c'), snap('agent-b'), snap('agent-a')], at: clock })
    expect(state.order).toEqual(['agent-a', 'agent-b', 'agent-c'])
    expect(state.focusedAgentId).toBe('agent-b')
  })
})

describe('agentEngineReducer: events', () => {
  it('creates a placeholder for events that arrive before a snapshot (kind from the id prefix)', () => {
    const state = events(createInitialAgentEngineState(), ev('obs-1234', 'user', { text: 'hi', uuid: 'u1' }))
    expect(state.agents['obs-1234']).toMatchObject({ kind: 'observer', readOnly: true, hydrated: false })
    expect(state.order).toEqual(['obs-1234'])
  })

  it('ignores unknown kinds without creating agents', () => {
    const state = events(createInitialAgentEngineState(), ev('agent-x', 'hook', { event: 'PreToolUse' }))
    expect(state.agents['agent-x']).toBeUndefined()
  })

  it('streams text deltas into a live buffer and replaces it with the final text', () => {
    let state = hello([snap('agent-a', { status: 'working' })])
    state = events(state,
      ev('agent-a', 'text.delta', { text: 'Hel', messageId: 'm1' }),
      ev('agent-a', 'text.delta', { text: 'lo', messageId: 'm1' }),
      ev('agent-a', 'text.delta', { text: 'sub', messageId: 'm9', parentToolUseId: 'toolu_agent' }),
    )
    expect(state.agents['agent-a'].live).toEqual({ messageId: 'm1', text: 'Hello' })
    state = events(state, ev('agent-a', 'text', { text: 'Hello', messageId: 'm1' }))
    expect(state.agents['agent-a'].live).toBeNull()
    expect(state.agents['agent-a'].log.at(-1)).toMatchObject({ type: 'text', text: 'Hello', parentToolUseId: null })
  })

  it('tracks tool cards by toolUseId and keeps todo / subagent tools out of the card list', () => {
    let state = hello([snap('agent-a', { status: 'working' })])
    state = events(state,
      ev('agent-a', 'tool.start', { toolUseId: 't1', name: 'Bash', summary: 'Bash: ls' }),
      ev('agent-a', 'tool.start', { toolUseId: 't2', name: 'TaskCreate', summary: 'TaskCreate' }),
      ev('agent-a', 'tool.start', { toolUseId: 't3', name: 'Agent', summary: 'Agent: explore' }),
      ev('agent-a', 'tool.end', { toolUseId: 't1', name: 'Bash', isError: false, output: 'a.txt' }),
      ev('agent-a', 'tool.end', { toolUseId: 't2', name: 'TaskCreate', isError: false, output: 'Task #1 created' }),
    )
    const tools = state.agents['agent-a'].log.filter(entry => entry.type === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ key: 't:t1', status: 'done', output: 'a.txt', summary: 'Bash: ls' })
  })

  it('replaces todos and follows a subagent from start to end', () => {
    let state = hello([snap('agent-a', { status: 'working' })])
    state = events(state,
      ev('agent-a', 'todo', { source: 'Task', todos: [{ content: 'wait', status: 'pending' }, { content: 'answer', status: 'pending' }] }),
      ev('agent-a', 'todo', { source: 'Task', todos: [{ content: 'wait', status: 'completed' }, { content: 'answer', status: 'in_progress' }] }),
      ev('agent-a', 'subagent.start', { toolUseId: 'tu1', taskId: 'task1', description: 'Explore repo', subagentType: 'Explore' }),
      ev('agent-a', 'subagent.progress', { toolUseId: 'tu1', taskId: 'task1', lastToolName: 'Glob' }),
      ev('agent-a', 'subagent.end', { taskId: 'task1', status: 'completed', summary: 'found 3 files' }),
    )
    const agent = state.agents['agent-a']
    expect(agent.todos.map(t => t.status)).toEqual(['completed', 'in_progress'])
    expect(agent.todoSource).toBe('Task')
    expect(agent.subagents).toHaveLength(1)
    expect(agent.subagents[0]).toMatchObject({ key: 'tu1', status: 'completed', lastToolName: 'Glob', summary: 'found 3 files' })
    expect(agent.log.find(entry => entry.key === 's:tu1')).toMatchObject({ type: 'subagent', status: 'completed' })
  })

  it('keeps open decisions with their request id until the engine resolves them', () => {
    let state = hello([snap('agent-b', { status: 'working' })])
    state = events(state,
      ev('agent-b', 'permission.request', {
        requestId: 'req-1',
        requestKind: 'question',
        toolName: 'AskUserQuestion',
        summary: 'Question: tea or coffee?',
        input: { questions: [{ question: 'Tea or coffee?', options: [{ label: 'Tea' }, { label: 'Coffee' }] }] },
      }),
      ev('agent-b', 'status', { status: 'needs-decision', reason: 'question' }),
    )
    let agent = state.agents['agent-b']
    expect(agent.pendingDecision).toMatchObject({ requestId: 'req-1', requestKind: 'question', toolName: 'AskUserQuestion' })
    expect(agent.decisions).toHaveLength(1)
    expect(selectAttentionQueue(state)).toEqual(['agent-b'])

    state = events(state,
      ev('agent-b', 'permission.resolved', { requestId: 'req-1', behavior: 'allow' }),
      ev('agent-b', 'status', { status: 'working', reason: 'turn running' }),
    )
    agent = state.agents['agent-b']
    expect(agent.pendingDecision).toBeNull()
    expect(agent.log.find(entry => entry.key === 'p:req-1')).toMatchObject({ type: 'decision', resolved: 'allow' })
    expect(selectAttentionQueue(state)).toEqual([])
  })

  it('does not treat read-only (hook) permission prompts as answerable decisions', () => {
    let state = hello([snap('hook-1234', { kind: 'hook', readOnly: true })])
    state = events(state, ev('hook-1234', 'permission.request', { requestId: null, requestKind: 'permission', toolName: 'Write', readOnly: true }))
    expect(state.agents['hook-1234'].pendingDecision).toBeNull()
    expect(state.agents['hook-1234'].log.at(-1)).toMatchObject({ type: 'decision', readOnly: true })
  })

  it('records turn usage and marks finished turns unseen unless the agent is focused', () => {
    let state = hello([snap('agent-a', { status: 'working' }), snap('agent-b', { status: 'working' })])
    state = run(state, { type: 'focus', agentId: 'agent-b' })
    const turn = { outcome: 'done-waiting', reason: 'end_turn', costUsd: 0.002, totalCostUsd: 0.01, durationMs: 1200, contextTokens: 22000, contextWindow: 1_000_000 }
    state = events(state,
      ev('agent-a', 'turn.end', turn),
      ev('agent-a', 'status', { status: 'waiting', reason: 'end_turn' }),
      ev('agent-b', 'turn.end', turn),
      ev('agent-b', 'status', { status: 'waiting', reason: 'end_turn' }),
    )
    const a = state.agents['agent-a']
    expect(a.unseen).toBe(true)
    expect(a.usage).toMatchObject({ turns: 1, totalCostUsd: 0.01 })
    expect(a.usage.sessionCostUsd).toBeCloseTo(0.002)
    expect(a.context).toMatchObject({ usedTokens: 22000, maxTokens: 1_000_000, percent: 2 })
    expect(a.lastTurn).toMatchObject({ outcome: 'done-waiting', durationMs: 1200 })
    expect(state.agents['agent-b'].unseen).toBe(false)
    expect(selectAttentionQueue(state)).toEqual(['agent-a'])

    // Starting a new turn clears "finished while unseen".
    state = events(state, ev('agent-a', 'status', { status: 'working', reason: 'message sent' }))
    expect(state.agents['agent-a'].unseen).toBe(false)
    expect(selectAttentionQueue(state)).toEqual([])
  })

  it('does not flag an observer whose transcript replay ends a turn right after attaching', () => {
    let state = hello([snap('obs-1', { kind: 'observer', status: 'idle' })])
    state = events(state, ev('obs-1', 'turn.end', { outcome: 'done-waiting', reason: 'end_turn', observed: true }))
    expect(state.agents['obs-1'].unseen).toBe(false)
  })

  it('ignores history events for status and usage but shows them in the log', () => {
    let state = hello([snap('agent-a', { status: 'idle' })])
    state = events(state,
      ev('agent-a', 'user', { text: 'old prompt', history: true }),
      ev('agent-a', 'turn.end', { outcome: 'done-waiting', costUsd: 1, history: true }),
      ev('agent-a', 'status', { status: 'error', history: true }),
    )
    const agent = state.agents['agent-a']
    expect(agent.status).toBe('idle')
    expect(agent.usage.turns).toBe(0)
    expect(agent.unseen).toBe(false)
    expect(agent.log.map(entry => entry.history)).toEqual([true, true])
  })

  it('folds sent / consumed / echoed user messages into one entry and counts pending messages', () => {
    let state = hello([snap('agent-a', { status: 'working' })])
    state = events(state,
      ev('agent-a', 'user.sent', { uuid: 'u1', text: 'also end with KIWI', midTurn: true, priority: 'next' }),
      ev('agent-a', 'user', { uuid: 'u1', text: 'also end with KIWI', replay: true }),
    )
    expect(state.agents['agent-a'].pendingUser).toBe(1)
    state = events(state, ev('agent-a', 'user.consumed', { uuid: 'u1', folded: true, waitedMs: 500 }))
    const users = state.agents['agent-a'].log.filter(entry => entry.type === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ state: 'folded', midTurn: true })
    expect(state.agents['agent-a'].pendingUser).toBe(0)
  })

  it('bounds the log', () => {
    let state = hello([snap('agent-a')])
    const list: EngineEvent[] = []
    for (let i = 0; i < AGENT_LOG_LIMIT + 25; i += 1) list.push(ev('agent-a', 'notice', { text: `n${i}` }))
    state = events(state, ...list)
    const log = state.agents['agent-a'].log
    expect(log).toHaveLength(AGENT_LOG_LIMIT)
    expect(log[0]).toMatchObject({ text: 'n25' })
    expect(new Set(log.map(entry => entry.key)).size).toBe(AGENT_LOG_LIMIT)
  })

  it('drops a removed agent, clears its focus and ignores its late events', () => {
    let state = hello([snap('agent-a'), snap('agent-b')])
    state = run(state, { type: 'focus', agentId: 'agent-a' }, { type: 'nearby', agentId: 'agent-a' })
    state = events(state, ev('agent-a', 'removed'), ev('agent-a', 'exit', { code: 0 }))
    expect(state.agents['agent-a']).toBeUndefined()
    expect(state.order).toEqual(['agent-b'])
    expect(state.focusedAgentId).toBeNull()
    expect(state.nearbyAgentId).toBeNull()
  })

  it('stores the subscription rate limit globally', () => {
    let state = hello([snap('agent-a')])
    state = events(state, ev('agent-a', 'rate_limit', { status: 'allowed', utilization: 0.67, window: 'seven_day' }))
    expect(state.rateLimit).toMatchObject({ utilization: 0.67, window: 'seven_day' })
  })

  it('applies model switches and process exits', () => {
    let state = hello([snap('agent-a', { model: 'haiku', alive: true })])
    state = events(state,
      ev('agent-a', 'model', { model: 'sonnet', resolved: 'claude-sonnet-5-5' }),
      ev('agent-a', 'exit', { code: 1, stderr: ['boom'] }),
    )
    const agent = state.agents['agent-a']
    expect(agent).toMatchObject({ model: 'sonnet', resolvedModel: 'claude-sonnet-5-5', alive: false })
    expect(agent.log.at(-1)).toMatchObject({ type: 'notice', level: 'error' })
  })

  it('keeps a model switch when the follow-up snapshot still reports the last turn model', () => {
    let state = hello([snap('agent-a', { model: 'haiku', resolvedModel: 'claude-haiku-5-5' })])
    state = events(state, ev('agent-a', 'model', { model: 'sonnet', resolved: 'claude-sonnet-5-5' }))
    state = agentEngineReducer(state, { type: 'agents', at: clock, agents: [snap('agent-a', { model: 'sonnet', resolvedModel: 'claude-haiku-5-5' })] })
    expect(state.agents['agent-a']).toMatchObject({ model: 'sonnet', resolvedModel: 'claude-sonnet-5-5' })
  })
})

describe('agentEngineReducer: snapshots, focus, sessions', () => {
  it('merges agents snapshots, adds new agents in order and drops missing ones', () => {
    let state = hello([snap('agent-a'), snap('agent-b')])
    state = agentEngineReducer(state, {
      type: 'agents',
      at: clock,
      agents: [snap('agent-b', { status: 'needs-decision', permissions: [{ requestId: 'r1', requestKind: 'permission', toolName: 'Write' }] }), snap('obs-9')],
    })
    expect(state.order).toEqual(['agent-b', 'obs-9'])
    expect(state.agents['agent-b'].pendingDecision).toMatchObject({ requestId: 'r1', toolName: 'Write' })
    expect(state.agents['obs-9']).toMatchObject({ owned: false, readOnly: true })
  })

  it('focus clears unseen but keeps decisions in the attention queue', () => {
    let state = hello([snap('agent-a', { status: 'working' }), snap('agent-b', { status: 'needs-decision' })])
    state = events(state, ev('agent-a', 'turn.end', { outcome: 'done-waiting' }), ev('agent-a', 'status', { status: 'waiting' }))
    expect(selectAttentionQueue(state)).toEqual(['agent-b', 'agent-a'])
    state = run(state, { type: 'focus', agentId: 'agent-a' }, { type: 'focus', agentId: 'agent-b' })
    expect(state.agents['agent-a'].unseen).toBe(false)
    expect(selectAttentionQueue(state)).toEqual(['agent-b'])
    expect(run(state, { type: 'focus', agentId: 'nope' }).focusedAgentId).toBeNull()
  })

  it('orders attention: decisions, then errors, then finished-unseen, oldest first', () => {
    let state = hello([snap('agent-1', { status: 'working' }), snap('agent-2', { status: 'working' }), snap('agent-3', { status: 'working' }), snap('agent-4', { status: 'working' })])
    state = events(state,
      ev('agent-1', 'turn.end', { outcome: 'done-waiting' }),
      ev('agent-1', 'status', { status: 'waiting' }),
      ev('agent-2', 'status', { status: 'error', reason: 'claude exited (code 1)' }),
      ev('agent-3', 'status', { status: 'needs-decision', reason: 'permission' }),
      ev('agent-4', 'status', { status: 'needs-decision', reason: 'question' }),
    )
    expect(selectAttentionQueue(state)).toEqual(['agent-3', 'agent-4', 'agent-2', 'agent-1'])
  })

  it('picks the next agent for N: attention first, then cycling', () => {
    let state = hello([snap('agent-1'), snap('agent-2', { status: 'needs-decision' }), snap('agent-3')])
    expect(selectNextAgentForN(state)).toBe('agent-2')
    state = run(state, { type: 'focus', agentId: 'agent-2' })
    // Only the focused agent needs attention: stay put.
    expect(selectNextAgentForN(state)).toBeNull()
    state = events(state, ev('agent-2', 'status', { status: 'working' }))
    expect(selectNextAgentForN(state)).toBe('agent-3')
    state = run(state, { type: 'focus', agentId: 'agent-3' })
    expect(selectNextAgentForN(state)).toBe('agent-1')
    expect(selectNextAgentForN(createInitialAgentEngineState())).toBeNull()
  })

  it('tracks the session list lifecycle', () => {
    let state = run(createInitialAgentEngineState(), { type: 'sessions/loading' })
    expect(state.sessions.status).toBe('loading')
    state = run(state, { type: 'sessions/error', error: 'not connected' })
    expect(state.sessions).toMatchObject({ status: 'error', error: 'not connected' })
    state = run(state, { type: 'sessions/loaded', items: [], at: 5 })
    expect(state.sessions).toMatchObject({ status: 'ready', loadedAt: 5, error: null })
  })

  it('returns the same state for no-op actions', () => {
    const state = hello([snap('agent-a')])
    expect(agentEngineReducer(state, { type: 'picker', open: false })).toBe(state)
    expect(agentEngineReducer(state, { type: 'nearby', agentId: null })).toBe(state)
    expect(agentEngineReducer(state, { type: 'focus', agentId: null })).toBe(state)
  })
})

describe('review fixes (2026-11-03)', () => {
  const question = {
    requestId: 'req-q',
    requestKind: 'question',
    toolName: 'AskUserQuestion',
    summary: 'Question: tea or coffee?',
  }

  it('#2 keeps an agent with an open decision first in line even after a mid-turn message flips it to working', () => {
    let state = hello([snap('agent-a', { status: 'working' }), snap('agent-b', { status: 'working' })])
    state = events(state,
      ev('agent-a', 'turn.end', { outcome: 'done-waiting' }),
      ev('agent-a', 'status', { status: 'waiting' }),
      ev('agent-b', 'permission.request', question),
      ev('agent-b', 'status', { status: 'needs-decision', reason: 'question' }),
      ev('agent-b', 'user.sent', { uuid: 'u9', text: 'also this', midTurn: true }),
      ev('agent-b', 'status', { status: 'working', reason: 'message queued mid-turn' }),
    )
    expect(selectAttentionQueue(state)).toEqual(['agent-b', 'agent-a'])
    expect(selectNextAgentForN(state)).toBe('agent-b')
    expect(effectiveStatus(state.agents['agent-b'])).toBe('needs-decision')
    expect(effectiveStatus(state.agents['agent-a'])).toBe('waiting')
  })

  it('#3 keeps "finished while unseen" across a reconnect and flags turns that ended while disconnected', () => {
    let state = hello([snap('agent-a', { status: 'working' }), snap('agent-b', { status: 'working' }), snap('agent-c', { status: 'working' })])
    state = events(state,
      ev('agent-a', 'turn.end', { outcome: 'done-waiting' }),
      ev('agent-a', 'status', { status: 'waiting' }),
    )
    state = run(state, { type: 'focus', agentId: 'agent-c' })
    const before = state
    const later = clock + 1000
    const backlogB = [ev('agent-b', 'status', { status: 'working' }), { ...ev('agent-b', 'turn.end', { outcome: 'done-waiting' }), ts: later }, { ...ev('agent-b', 'status', { status: 'waiting' }), ts: later + 1 }]
    const backlogC = [{ ...ev('agent-c', 'turn.end', { outcome: 'done-waiting' }), ts: later }]
    state = agentEngineReducer(before, {
      type: 'hello',
      at: later + 5,
      agents: [snap('agent-a', { status: 'waiting' }), snap('agent-b', { status: 'waiting' }), snap('agent-c', { status: 'waiting' })],
      backlog: { 'agent-b': backlogB as EngineEvent[], 'agent-c': backlogC as EngineEvent[] },
    })
    expect(state.agents['agent-a'].unseen).toBe(true) // kept
    expect(state.agents['agent-b'].unseen).toBe(true) // finished while we were away
    expect(state.agents['agent-c'].unseen).toBe(false) // the owner is looking at it
    expect(selectAttentionQueue(state)).toEqual(['agent-a', 'agent-b'])
  })

  it('#3 keeps an unseen agent in the N queue after an engine restart reports it idle', () => {
    let state = hello([snap('agent-a', { status: 'working' })])
    state = events(state, ev('agent-a', 'turn.end', { outcome: 'done-waiting' }), ev('agent-a', 'status', { status: 'waiting' }))
    // The restarted engine resumes the session as a fresh process: status idle, backlog has no turn.
    state = agentEngineReducer(state, { type: 'hello', at: clock + 5000, agents: [snap('agent-a', { status: 'idle', statusReason: 'ready' })], backlog: { 'agent-a': [ev('agent-a', 'status', { status: 'idle', reason: 'ready' })] } })
    expect(state.agents['agent-a']).toMatchObject({ status: 'idle', unseen: true })
    expect(effectiveStatus(state.agents['agent-a'])).toBe('waiting')
    expect(selectAttentionQueue(state)).toEqual(['agent-a'])
    // Working again (a new turn) clears it as usual.
    state = events(state, ev('agent-a', 'status', { status: 'working' }))
    expect(selectAttentionQueue(state)).toEqual([])
  })

  it('#3 still starts a fresh page load with nothing marked unseen', () => {
    const state = hello([snap('agent-a', { status: 'waiting' })], { 'agent-a': [ev('agent-a', 'turn.end', { outcome: 'done-waiting' })] })
    expect(state.agents['agent-a'].unseen).toBe(false)
  })

  it('#12 lets a dismissed hook agent come back when the engine lists it again', () => {
    let state = hello([snap('hook-1234', { kind: 'hook' })])
    state = events(state, ev('hook-1234', 'removed'))
    expect(state.agents['hook-1234']).toBeUndefined()
    state = agentEngineReducer(state, { type: 'agents', at: clock, agents: [snap('hook-1234', { kind: 'hook', status: 'working' })] })
    expect(state.agents['hook-1234']).toMatchObject({ status: 'working' })
    state = events(state, ev('hook-1234', 'tool.start', { toolUseId: 't1', name: 'Bash', summary: 'Bash: ls' }))
    expect(state.agents['hook-1234'].log.at(-1)).toMatchObject({ type: 'tool', key: 't:t1' })
  })

  it('#13 tracks answers in flight so every card can disable itself', () => {
    let state = hello([snap('agent-b', { status: 'needs-decision', permissions: [{ ...question, requestKind: 'question' }] })])
    state = run(state, { type: 'decision/pending', requestId: 'req-q', pending: true })
    expect(isDecisionInFlight(state, 'req-q')).toBe(true)
    state = run(state, { type: 'decision/pending', requestId: 'req-q', pending: false })
    expect(isDecisionInFlight(state, 'req-q')).toBe(false)
    state = run(state, { type: 'decision/pending', requestId: 'req-q', pending: true })
    state = events(state, ev('agent-b', 'permission.resolved', { requestId: 'req-q', behavior: 'allow' }))
    expect(isDecisionInFlight(state, 'req-q')).toBe(false)
  })

  it('#8 folds a permission-mode change so the picker does not snap back', () => {
    let state = hello([snap('agent-a', { permissionMode: 'default' })])
    state = events(state, ev('agent-a', 'mode', { permissionMode: 'plan' }))
    expect(state.agents['agent-a']).toMatchObject({ permissionMode: 'plan', effectivePermissionMode: 'plan' })
  })
})

describe('createAgentEngineSlice', () => {
  it('only writes to the store when the reducer produced a new state', () => {
    let store: { agentEngine: AgentEngineState } = { agentEngine: createInitialAgentEngineState() }
    let writes = 0
    const slice = createAgentEngineSlice<typeof store>({
      set: partial => {
        writes += 1
        store = { ...store, ...(typeof partial === 'function' ? partial(store) : partial) }
      },
      get: () => store,
    })
    store = { agentEngine: slice.agentEngine }
    slice.agentEngineDispatch({ type: 'picker', open: false })
    expect(writes).toBe(0)
    slice.agentEngineDispatch({ type: 'picker', open: true })
    expect(writes).toBe(1)
    expect(store.agentEngine.pickerOpen).toBe(true)
  })
})

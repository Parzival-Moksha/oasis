// Pure pieces of packages/oasis-agent-engine (review items 9, 14, 15). The engine is plain ESM JS;
// these modules have no Node side effects, so vitest can import them directly.
import { describe, expect, it } from 'vitest'
import * as pendingModule from '../../../packages/oasis-agent-engine/src/pending.js'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'

type Pending = Map<string, { text: string; sentAt: number; turnWasRunning: boolean; turnIndex: number }>

interface PendingApi {
  matchReplay: (pending: Pending, echo: { uuid: string | null; text: string }) => string[]
  droppedAfterInterrupt: (pending: Pending, stillQueued: unknown) => string[]
  expiredAtResult: (pending: Pending, turnIndex: number) => string[]
  interruptApplies: (flagTurn: number | null, currentTurn: number) => boolean
}

interface NormalizerLike {
  emit: (kind: string, payload: Record<string, unknown>) => void
  ownerCtx?: () => Record<string, unknown>
  openTurn: () => void
  handleStream: (msg: Record<string, unknown>) => void
  toolNames: Map<string, string>
  agentCalls: Map<string, unknown>
  taskToTool: Map<string, string>
  taskTodos: Map<string, unknown>
}

const { droppedAfterInterrupt, expiredAtResult, interruptApplies, matchReplay } = pendingModule as unknown as PendingApi
const { Normalizer } = normalizeModule as unknown as {
  Normalizer: new (agentId: string, emit: (kind: string, payload: Record<string, unknown>) => void, opts: { mode: string }) => NormalizerLike
}

function pending(entries: Array<[string, string, number]>): Pending {
  return new Map(entries.map(([uuid, text, turnIndex]) => [uuid, { text, sentAt: 0, turnWasRunning: true, turnIndex }]))
}

describe('engine: pending user messages (#14)', () => {
  it('matches an echo by uuid first', () => {
    expect(matchReplay(pending([['u1', 'hello', 1], ['u2', 'hello', 1]]), { uuid: 'u2', text: 'hello' })).toEqual(['u2'])
  })

  it('lets one echo consume every pending message whose text it contains (the CLI merges queued messages)', () => {
    const p = pending([['u1', 'first thing', 2], ['u2', 'second thing', 2], ['u3', 'unrelated', 2]])
    expect(matchReplay(p, { uuid: 'cli-made', text: 'first thing\n\nsecond thing' })).toEqual(['u1', 'u2'])
    expect(matchReplay(p, { uuid: null, text: '' })).toEqual([])
  })

  it('after an interrupt keeps only what the CLI reports as still queued', () => {
    const p = pending([['u1', 'a', 3], ['u2', 'b', 3]])
    expect(droppedAfterInterrupt(p, ['u2'])).toEqual(['u1'])
    expect(droppedAfterInterrupt(p, [])).toEqual(['u1', 'u2'])
    expect(droppedAfterInterrupt(p, undefined)).toEqual([]) // older CLI: no information, drop nothing
  })

  it('at a result expires messages from an earlier turn that never echoed, keeps ones sent during this turn', () => {
    const p = pending([['old', 'sent during turn 3', 3], ['new', 'sent during turn 4', 4]])
    expect(expiredAtResult(p, 4)).toEqual(['old'])
    expect(expiredAtResult(p, 5)).toEqual(['old', 'new'])
  })
})

describe('engine: interrupts (#15)', () => {
  it('only applies an interrupt to the turn it was sent in', () => {
    expect(interruptApplies(4, 4)).toBe(true)
    expect(interruptApplies(4, 5)).toBe(false)
    expect(interruptApplies(null, 4)).toBe(false)
  })

  function resultEvent(norm: NormalizerLike, result: Record<string, unknown>) {
    const events: Array<[string, Record<string, unknown>]> = []
    norm.emit = (kind: string, payload: Record<string, unknown>) => events.push([kind, payload])
    norm.openTurn()
    norm.handleStream({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, ...result })
    return events.find(([kind]) => kind === 'turn.end')?.[1]
  }

  it('reports an interrupted turn as done-waiting / interrupted with isError false', () => {
    const norm = new Normalizer('agent-x', () => {}, { mode: 'live' })
    norm.ownerCtx = () => ({ interrupted: true, pendingPermissions: 0, hostDenied: new Set() })
    expect(resultEvent(norm, { terminal_reason: 'aborted_tools' })).toMatchObject({ outcome: 'done-waiting', reason: 'interrupted', isError: false })
  })

  it('recognizes an abort from the result itself even when the flag belonged to another turn', () => {
    const norm = new Normalizer('agent-x', () => {}, { mode: 'live' })
    norm.ownerCtx = () => ({ interrupted: false, pendingPermissions: 0, hostDenied: new Set() })
    expect(resultEvent(norm, { terminal_reason: 'aborted_streaming' })).toMatchObject({ reason: 'interrupted', isError: false })
    expect(resultEvent(norm, { terminal_reason: null, subtype: 'error_max_turns' })).toMatchObject({ outcome: 'error', isError: true })
  })
})

describe('engine: normalizer bookkeeping does not grow forever (#9)', () => {
  it('forgets tool names once the result is in and subagent calls once they end', () => {
    const norm = new Normalizer('agent-x', () => {}, { mode: 'live' })
    norm.handleStream({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } })
    norm.handleStream({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } })
    expect(norm.toolNames.size).toBe(0)

    norm.handleStream({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'look', prompt: 'p', run_in_background: true } }] } })
    norm.handleStream({ type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'task-1', tool_use_id: 'a1', is_backgrounded: true })
    norm.handleStream({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'started' }] }, tool_use_result: { status: 'async_launched' } })
    expect(norm.agentCalls.size).toBe(1) // background agent still running
    norm.handleStream({ type: 'system', subtype: 'task_notification', task_id: 'task-1', status: 'completed', summary: 'done' })
    expect(norm.agentCalls.size).toBe(0)
    expect(norm.taskToTool.size).toBe(0)
  })

  it('caps the TaskCreate todo list', () => {
    const norm = new Normalizer('agent-x', () => {}, { mode: 'live' })
    for (let i = 0; i < 150; i += 1) {
      norm.handleStream({ type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `c${i}`, name: 'TaskCreate', input: { subject: `task ${i}` } }] } })
    }
    expect(norm.taskTodos.size).toBeLessThanOrEqual(100)
  })
})

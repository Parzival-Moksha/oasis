// Subagent life cycle in the engine's normalizer: background agents run until their <task-notification>,
// SendMessage resumes a finished one under its old entry, and a stopped process ends whatever was open.
import { describe, expect, it } from 'vitest'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'

type Emitted = Array<[string, Record<string, unknown>]>

interface NormalizerLike {
  handleStream: (msg: Record<string, unknown>) => void
  handleRecord: (rec: Record<string, unknown>) => void
  endOpenSubagents: (status?: string, summary?: string) => void
  agentCalls: Map<string, unknown>
}

const { Normalizer, parseTaskNotification } = normalizeModule as unknown as {
  Normalizer: new (agentId: string, emit: (kind: string, payload: Record<string, unknown>) => void, opts: { mode: string }) => NormalizerLike
  parseTaskNotification: (text: string) => { taskId: string | null; toolUseId: string | null; status: string; summary: string | null } | null
}

function setup(mode: 'live' | 'observe' = 'observe') {
  const out: Emitted = []
  const norm = new Normalizer('agent-1', (kind, payload) => out.push([kind, payload]), { mode })
  const kinds = (kind: string) => out.filter(([k]) => k === kind).map(([, p]) => p)
  return { norm, out, kinds }
}

const agentCall = (id: string, description: string, background = true) => ({
  type: 'assistant',
  message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Agent', input: { description, subagent_type: 'general-purpose', prompt: 'do it', run_in_background: background } }] },
})
const agentResult = (id: string, toolUseResult: Record<string, unknown>) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Async agent launched' }] }] },
  toolUseResult,
})
const sendMessage = (id: string, to: string) => ({
  type: 'assistant',
  message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'SendMessage', input: { to, message: 'one more thing' } }] },
})
const notification = (taskId: string, toolUseId: string, status = 'completed') => ({
  type: 'user',
  message: {
    role: 'user',
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>Agent "x" finished</summary>\n<result>done</result>\n</task-notification>`,
  },
})

describe('engine: background subagents in a transcript', () => {
  it('runs until its <task-notification>, which reaches the thread only as that notification (a pill)', () => {
    const { norm, kinds } = setup()
    norm.handleRecord(agentCall('toolu_A', 'Village talk fixes'))
    norm.handleRecord(agentResult('toolu_A', { isAsync: true, status: 'async_launched', agentId: 'af0074' }))
    expect(kinds('subagent.start')).toEqual([expect.objectContaining({ toolUseId: 'toolu_A', description: 'Village talk fixes' })])
    expect(kinds('subagent.end')).toEqual([]) // "launched" is not "done"
    norm.handleRecord(notification('af0074', 'toolu_A', 'failed'))
    expect(kinds('subagent.end')).toEqual([expect.objectContaining({ toolUseId: 'toolu_A', status: 'failed', summary: 'Agent "x" finished' })])
    // It still reaches the thread, as the notification itself: the Oasis folds it into a "Subagent finished" pill.
    expect(kinds('user').map((e) => String(e.text).startsWith('<task-notification>'))).toEqual([true])
  })

  it('SendMessage resumes a finished subagent under its old entry; the next notification (with the SendMessage id) ends it', () => {
    const { norm, kinds } = setup()
    norm.handleRecord(agentCall('toolu_A', 'Village talk fixes'))
    norm.handleRecord(agentResult('toolu_A', { isAsync: true, status: 'async_launched', agentId: 'af0074' }))
    norm.handleRecord(notification('af0074', 'toolu_A'))
    norm.handleRecord(sendMessage('toolu_S', 'af0074'))
    const starts = kinds('subagent.start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ toolUseId: 'toolu_A', description: 'Village talk fixes', resumed: true })
    norm.handleRecord(notification('af0074', 'toolu_S'))
    const ends = kinds('subagent.end')
    expect(ends).toHaveLength(2)
    expect(ends[1]).toMatchObject({ toolUseId: 'toolu_A', status: 'completed' })
  })

  it('a message to a subagent that is still running starts nothing new, and its notification still ends it', () => {
    const { norm, kinds } = setup()
    norm.handleRecord(agentCall('toolu_A', 'Generate skies'))
    norm.handleRecord(agentResult('toolu_A', { isAsync: true, status: 'async_launched', agentId: 'a2d85' }))
    norm.handleRecord(sendMessage('toolu_S', 'a2d85'))
    expect(kinds('subagent.start')).toHaveLength(1)
    norm.handleRecord(notification('a2d85', 'toolu_S'))
    expect(kinds('subagent.end')).toEqual([expect.objectContaining({ toolUseId: 'toolu_A' })])
  })

  it('a foreground subagent ends at its result and can still be resumed by id', () => {
    const { norm, kinds } = setup()
    norm.handleRecord(agentCall('toolu_F', 'Explore the repo', false))
    norm.handleRecord(agentResult('toolu_F', { status: 'completed', agentId: 'afg1' }))
    expect(kinds('subagent.end')).toEqual([expect.objectContaining({ toolUseId: 'toolu_F', status: 'completed' })])
    norm.handleRecord(sendMessage('toolu_S2', 'afg1'))
    expect(kinds('subagent.start').at(-1)).toMatchObject({ toolUseId: 'toolu_F', resumed: true, description: 'Explore the repo' })
    expect(norm.agentCalls.has('toolu_F')).toBe(true)
  })

  it('ignores SendMessage to anyone it does not know', () => {
    const { norm, kinds } = setup()
    norm.handleRecord(sendMessage('toolu_S', 'teammate-bob'))
    expect(kinds('subagent.start')).toEqual([])
  })
})

describe('engine: live subagents', () => {
  it('ends on system/task_notification, maps a resumed run back, and a stopped process ends what was open', () => {
    const { norm, kinds } = setup('live')
    norm.handleStream(agentCall('toolu_A', 'One'))
    norm.handleStream({ type: 'system', subtype: 'task_started', task_type: 'local_agent', tool_use_id: 'toolu_A', task_id: 'a111', is_backgrounded: true, description: 'One' })
    norm.handleStream(agentCall('toolu_B', 'Two'))
    norm.handleStream({ type: 'system', subtype: 'task_started', task_type: 'local_agent', tool_use_id: 'toolu_B', task_id: 'a222', is_backgrounded: true, description: 'Two' })
    norm.handleStream({ type: 'system', subtype: 'task_notification', task_id: 'a111', tool_use_id: 'toolu_A', status: 'completed', summary: 'ok' })
    expect(kinds('subagent.end').map(e => e.toolUseId)).toEqual(['toolu_A'])
    // Resumed live: the CLI's task events carry the SendMessage id.
    norm.handleStream(sendMessage('toolu_S', 'a111'))
    norm.handleStream({ type: 'system', subtype: 'task_started', task_type: 'local_agent', tool_use_id: 'toolu_S', task_id: 'a111', is_backgrounded: true, description: 'One' })
    expect(kinds('subagent.start').map(e => e.toolUseId)).toEqual(['toolu_A', 'toolu_B', 'toolu_A'])
    norm.endOpenSubagents('stopped', 'the agent process stopped')
    expect(kinds('subagent.end').map(e => [e.toolUseId, e.status])).toEqual([['toolu_A', 'completed'], ['toolu_B', 'stopped'], ['toolu_A', 'stopped']])
    expect(norm.agentCalls.size).toBe(0)
  })

  it('a task notification echoed as a user message (stream-json) ends the subagent once', () => {
    const { norm, kinds } = setup('live')
    norm.handleStream(agentCall('toolu_A', 'One'))
    norm.handleStream({ type: 'system', subtype: 'task_started', task_type: 'local_agent', tool_use_id: 'toolu_A', task_id: 'a111', is_backgrounded: true })
    norm.handleStream({ type: 'system', subtype: 'task_notification', task_id: 'a111', tool_use_id: 'toolu_A', status: 'completed' })
    norm.handleStream({ ...notification('a111', 'toolu_A'), isReplay: true })
    expect(kinds('subagent.end')).toHaveLength(1)
    // It still reaches the thread, as the notification itself: the Oasis folds it into a "Subagent finished" pill.
    expect(kinds('user').map((e) => String(e.text).startsWith('<task-notification>'))).toEqual([true])
  })
})

describe('parseTaskNotification', () => {
  it('reads the tags and ignores other text', () => {
    expect(parseTaskNotification('<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>killed</status>\n</task-notification>'))
      .toMatchObject({ taskId: 'a1', toolUseId: 'toolu_1', status: 'killed', summary: null })
    expect(parseTaskNotification('please check <task-notification>')).toBeNull()
  })
})

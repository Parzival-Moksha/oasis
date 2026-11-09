import { describe, expect, it } from 'vitest'
import type { AgentLogEntry } from '../../store/slices/agentEngineSlice'
import { TOOL_RUN_BASE_PX, groupThread, summarizeToolRun, toolRunHeight, toolRunShape, type ToolLogEntry } from '../village/village-thread'

let n = 0
const text = (t: string, parentToolUseId: string | null = null): AgentLogEntry => ({ type: 'text', key: `x:${++n}`, ts: n, text: t, parentToolUseId })
const user = (t: string): AgentLogEntry => ({ type: 'user', key: `u:${++n}`, ts: n, text: t, state: 'seen' })
const tool = (name: string, status: ToolLogEntry['status'] = 'done'): ToolLogEntry => ({
  type: 'tool', key: `t:toolu_${++n}`, ts: n, toolUseId: `toolu_${n}`, name, summary: `${name} ${n}`, status, parentToolUseId: null,
})
const turnEnd = (): AgentLogEntry => ({
  type: 'turn', key: `e:${++n}`, ts: n, outcome: 'done-waiting', reason: 'end_turn', isError: false, costUsd: null, durationMs: null,
  numTurns: null, contextTokens: null, contextWindow: null, model: null,
})

const shape = (items: ReturnType<typeof groupThread>) => items.map(item => (item.kind === 'tools' ? `[${item.entries.length}: ${item.summary}]` : item.entry.type === 'tool' ? `pill:${item.entry.name}` : item.entry.type))

describe('groupThread', () => {
  it('folds every finished run of tool calls between texts; the calls since the last text stay full cards', () => {
    const entries = [
      user('do it'),
      text('looking'),
      tool('Bash'), tool('Bash'), tool('Read'),
      text('found it'),
      tool('Edit'),
      text('fixed'),
      tool('Bash'), tool('Bash'),
    ]
    expect(shape(groupThread(entries))).toEqual([
      'user', 'text',
      '[3: Ran 2 commands, read 1 file]',
      'text',
      '[1: Edited 1 file]',
      'text',
      'pill:Bash', 'pill:Bash',
    ])
  })

  it('a turn that ended with text has no open work: every run is folded', () => {
    const entries = [user('go'), tool('Grep'), tool('Read'), text('answer'), turnEnd()]
    expect(shape(groupThread(entries))).toEqual(['user', '[2: Read 1 file, searched once]', 'text', 'turn'])
  })

  it('without any text yet, all tool calls are the work in progress', () => {
    expect(shape(groupThread([user('go'), tool('Bash'), tool('Read')]))).toEqual(['user', 'pill:Bash', 'pill:Read'])
  })

  it('anything that is not a tool call ends a run; subagent text does not count as the last text', () => {
    const entries = [
      text('a'), tool('Bash'), turnEnd(), tool('Bash'), user('next'), tool('Read'), text('b'),
      tool('Bash'), text('inner', 'toolu_parent'), tool('Read'),
    ]
    expect(shape(groupThread(entries))).toEqual([
      'text', '[1: Ran 1 command]', 'turn', '[1: Ran 1 command]', 'user', '[1: Read 1 file]', 'text',
      'pill:Bash', 'text', 'pill:Read',
    ])
  })

  it('a file the agent sent you never folds away', () => {
    const entries = [tool('Bash'), tool('SendUserFile'), tool('Read'), text('here you go')]
    expect(shape(groupThread(entries))).toEqual(['[1: Ran 1 command]', 'pill:SendUserFile', '[1: Read 1 file]', 'text'])
  })

  it('run keys follow their first call, so an open row stays open when history loads above', () => {
    const first = tool('Bash')
    const items = groupThread([first, tool('Read'), text('x')])
    expect(items[0].key).toBe(`run:${first.key}`)
    const withOlder = groupThread([text('older'), tool('Grep'), text('y'), first, tool('Read'), text('x')])
    expect(withOlder.some(item => item.key === `run:${first.key}`)).toBe(true)
  })

  it('is empty for an empty log', () => {
    expect(groupThread([])).toEqual([])
  })
})

describe('summarizeToolRun', () => {
  it('counts by kind, in a fixed order, with failures apart', () => {
    const run = [
      ...Array.from({ length: 12 }, () => tool('Bash')),
      ...Array.from({ length: 8 }, () => tool('Read')),
      tool('Edit'), tool('MultiEdit'), tool('Edit', 'error'),
    ]
    expect(summarizeToolRun(run)).toEqual({ summary: 'Ran 12 commands, read 8 files, edited 3 files', failed: 1 })
  })

  it('names the other kinds too', () => {
    const run = [tool('Write'), tool('WebFetch'), tool('WebSearch'), tool('WebSearch'), tool('mcp__oasis__place_object'), tool('Skill'), tool('PowerShell')]
    expect(summarizeToolRun(run).summary).toBe('Ran 1 command, wrote 1 file, fetched 1 page, searched the web 2 times, used 1 world tool, used 1 other tool')
    expect(summarizeToolRun([tool('Skill'), tool('LSP')]).summary).toBe('Used 2 tools')
  })
})

describe('folded run height', () => {
  it('one call is the base height, about 50 calls is 3 to 4 times that, and it stops there', () => {
    expect(toolRunHeight(1)).toBe(TOOL_RUN_BASE_PX)
    expect(toolRunShape(1)).toEqual({ previewLines: 0, stackLayers: 0 })
    const ratio50 = toolRunHeight(50) / TOOL_RUN_BASE_PX
    expect(ratio50).toBeGreaterThanOrEqual(3)
    expect(ratio50).toBeLessThanOrEqual(4)
    expect(toolRunHeight(10_000) / TOOL_RUN_BASE_PX).toBeLessThanOrEqual(4)
  })

  it('never shrinks as a run grows', () => {
    let last = 0
    for (let calls = 1; calls <= 500; calls++) {
      const h = toolRunHeight(calls)
      expect(h).toBeGreaterThanOrEqual(last)
      last = h
    }
  })
})

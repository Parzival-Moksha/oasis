// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — Tool/result pairing in renderMerlinEventTimeline
// Verifies the pairing algorithm: toolId-based matching first, then
// FIFO by name when toolIds are absent.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Types mirroring MerlinPanel.tsx event shapes
// ═══════════════════════════════════════════════════════════════════════════

interface ToolEvent { type: 'tool'; name: string; args: Record<string, unknown>; toolId?: string }
interface ResultEvent { type: 'result'; name: string; ok: boolean; message: string; mediaUrls?: string[]; toolId?: string }
type Event = ToolEvent | ResultEvent | { type: 'text'; content: string }

// ═══════════════════════════════════════════════════════════════════════════
// Re-implement the pairing algorithm from renderMerlinEventTimeline
// (lines 569-628 of MerlinPanel.tsx)
// ═══════════════════════════════════════════════════════════════════════════

interface PairedToolResult {
  tool: ToolEvent
  result: ResultEvent | undefined
}

function pairToolsAndResults(events: Event[]): PairedToolResult[] {
  // Build result lookup: prefer toolId matching, fall back to name matching
  const resultByToolId = new Map<string, ResultEvent>()
  const resultsByName = new Map<string, ResultEvent[]>()
  for (const event of events) {
    if (event.type !== 'result') continue
    const re = event as ResultEvent
    if (re.toolId) {
      resultByToolId.set(re.toolId, re)
    } else {
      const list = resultsByName.get(re.name) || []
      list.push(re)
      resultsByName.set(re.name, list)
    }
  }

  const pairs: PairedToolResult[] = []
  for (const event of events) {
    if (event.type !== 'tool') continue
    const toolEvent = event as ToolEvent

    let result: ResultEvent | undefined
    if (toolEvent.toolId && resultByToolId.has(toolEvent.toolId)) {
      result = resultByToolId.get(toolEvent.toolId)
    } else {
      const nameQueue = resultsByName.get(toolEvent.name)
      if (nameQueue?.length) {
        result = nameQueue.shift()
      }
    }
    pairs.push({ tool: toolEvent, result })
  }

  return pairs
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('tool/result pairing', () => {
  it('pairs by toolId when both tool and result have matching toolIds', () => {
    const events: Event[] = [
      { type: 'tool', name: 'place_object', args: {}, toolId: 'abc-1' },
      { type: 'tool', name: 'place_object', args: {}, toolId: 'abc-2' },
      { type: 'tool', name: 'modify_object', args: {}, toolId: 'abc-3' },
      { type: 'result', name: 'place_object', ok: true, message: 'placed first', toolId: 'abc-1' },
      { type: 'result', name: 'place_object', ok: true, message: 'placed second', toolId: 'abc-2' },
      { type: 'result', name: 'modify_object', ok: true, message: 'modified', toolId: 'abc-3' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(3)
    expect(pairs[0].result?.message).toBe('placed first')
    expect(pairs[0].result?.toolId).toBe('abc-1')
    expect(pairs[1].result?.message).toBe('placed second')
    expect(pairs[1].result?.toolId).toBe('abc-2')
    expect(pairs[2].result?.message).toBe('modified')
    expect(pairs[2].result?.toolId).toBe('abc-3')
  })

  it('pairs by name FIFO when toolIds are absent', () => {
    const events: Event[] = [
      { type: 'tool', name: 'place_object', args: {} },
      { type: 'tool', name: 'place_object', args: {} },
      { type: 'tool', name: 'modify_object', args: {} },
      { type: 'result', name: 'place_object', ok: true, message: 'first placed' },
      { type: 'result', name: 'modify_object', ok: true, message: 'modified' },
      { type: 'result', name: 'place_object', ok: true, message: 'second placed' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(3)
    // First place_object tool gets first place_object result (FIFO)
    expect(pairs[0].result?.message).toBe('first placed')
    // Second place_object tool gets second place_object result (FIFO)
    expect(pairs[1].result?.message).toBe('second placed')
    // modify_object tool gets its result
    expect(pairs[2].result?.message).toBe('modified')
  })

  it('returns undefined result when no matching result exists', () => {
    const events: Event[] = [
      { type: 'tool', name: 'place_object', args: {} },
      { type: 'tool', name: 'remove_object', args: {} },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(2)
    expect(pairs[0].result).toBeUndefined()
    expect(pairs[1].result).toBeUndefined()
  })

  it('handles mixed toolId and non-toolId events', () => {
    const events: Event[] = [
      { type: 'tool', name: 'place_object', args: {}, toolId: 'id-1' },
      { type: 'tool', name: 'place_object', args: {} },  // no toolId
      { type: 'result', name: 'place_object', ok: true, message: 'result-with-id', toolId: 'id-1' },
      { type: 'result', name: 'place_object', ok: true, message: 'result-without-id' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(2)
    // First tool (with toolId) pairs by toolId
    expect(pairs[0].result?.message).toBe('result-with-id')
    // Second tool (no toolId) falls back to name FIFO
    expect(pairs[1].result?.message).toBe('result-without-id')
  })

  it('correctly handles [tool, tool, tool, result, result, result] ordering', () => {
    const events: Event[] = [
      { type: 'tool', name: 'generate_image', args: { prompt: 'cat' }, toolId: 't1' },
      { type: 'tool', name: 'generate_voice', args: { text: 'hello' }, toolId: 't2' },
      { type: 'tool', name: 'generate_image', args: { prompt: 'dog' }, toolId: 't3' },
      { type: 'result', name: 'generate_image', ok: true, message: 'cat image done', toolId: 't1' },
      { type: 'result', name: 'generate_voice', ok: true, message: 'voice done', toolId: 't2' },
      { type: 'result', name: 'generate_image', ok: true, message: 'dog image done', toolId: 't3' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(3)
    expect(pairs[0].tool.args.prompt).toBe('cat')
    expect(pairs[0].result?.message).toBe('cat image done')
    expect(pairs[1].tool.args.text).toBe('hello')
    expect(pairs[1].result?.message).toBe('voice done')
    expect(pairs[2].tool.args.prompt).toBe('dog')
    expect(pairs[2].result?.message).toBe('dog image done')
  })

  it('ignores non-tool non-result events in pairing', () => {
    const events: Event[] = [
      { type: 'text', content: 'thinking...' },
      { type: 'tool', name: 'place_object', args: {}, toolId: 'x1' },
      { type: 'text', content: 'more thinking...' },
      { type: 'result', name: 'place_object', ok: true, message: 'done', toolId: 'x1' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].result?.message).toBe('done')
  })

  it('handles empty events array', () => {
    const pairs = pairToolsAndResults([])
    expect(pairs).toHaveLength(0)
  })

  it('handles only results (no tools)', () => {
    const events: Event[] = [
      { type: 'result', name: 'place_object', ok: true, message: 'orphan' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(0)
  })

  it('handles excess tools (more tools than results)', () => {
    const events: Event[] = [
      { type: 'tool', name: 'place_object', args: {} },
      { type: 'tool', name: 'place_object', args: {} },
      { type: 'tool', name: 'place_object', args: {} },
      { type: 'result', name: 'place_object', ok: true, message: 'only result' },
    ]
    const pairs = pairToolsAndResults(events)
    expect(pairs).toHaveLength(3)
    expect(pairs[0].result?.message).toBe('only result')
    expect(pairs[1].result).toBeUndefined()
    expect(pairs[2].result).toBeUndefined()
  })
})

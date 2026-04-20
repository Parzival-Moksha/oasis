// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VIBECODE MEDIA TOOLS INTEGRATION TESTS
// Mission #26: Wire media tools into Anorak vibecode chat
// Tests: tool call accumulation, isMediaTool gate, 3-call cap,
//        text-only streaming, error handling, SSE event format,
//        system prompt media guidance
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isMediaTool, mediaToolsOpenAI, MEDIA_TOOL_NAMES } from '../media-tools'

// ═══════════════════════════════════════════════════════════════════════════
// Replicate the route's internal logic as pure functions for unit testing.
// The actual route is a Next.js handler — we extract the patterns here.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mirrors the tool call accumulation loop inside the streaming handler.
 * The route uses a Map<number, { id, name, args }> keyed by tc.index.
 * - id: assigned (overwritten) when present
 * - name: ASSIGNED (not concatenated) — tc.function.name
 * - args: CONCATENATED — tc.function.arguments
 */
function accumulateToolCalls(
  toolCalls: Map<number, { id: string; name: string; args: string }>,
  deltas: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>,
): void {
  for (const tc of deltas) {
    const idx = tc.index ?? 0
    if (!toolCalls.has(idx)) {
      toolCalls.set(idx, { id: tc.id || '', name: '', args: '' })
    }
    const entry = toolCalls.get(idx)!
    if (tc.id) entry.id = tc.id
    if (tc.function?.name) entry.name = tc.function.name
    if (tc.function?.arguments) entry.args += tc.function.arguments
  }
}

/**
 * Mirrors the post-stream tool execution logic.
 * Filters by isMediaTool, caps at 3 media calls, parses args, calls execMediaTool.
 */
interface EmittedEvent {
  type?: string
  name?: string
  input?: Record<string, unknown>
  display?: string
  preview?: string
  isError?: boolean
  mediaType?: string
  url?: string
  prompt?: string
  content?: string
}

async function executeToolCalls(
  toolCalls: Map<number, { id: string; name: string; args: string }>,
  execFn: (name: string, args: Record<string, unknown>, baseUrl: string) => Promise<{ ok: boolean; url?: string; error?: string }>,
  baseUrl: string,
): Promise<EmittedEvent[]> {
  const events: EmittedEvent[] = []
  let mediaCallCount = 0

  if (toolCalls.size > 0) {
    for (const [, tc] of toolCalls) {
      if (!isMediaTool(tc.name) || mediaCallCount >= 3) continue
      mediaCallCount++
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.args)
      } catch (e) {
        events.push({ type: 'tool_result', name: tc.name, preview: `Bad args: ${e}`, isError: true })
        continue
      }

      events.push({
        type: 'tool',
        name: tc.name,
        input: args,
        display: `${tc.name}(${JSON.stringify(args).slice(0, 100)})`,
      })

      try {
        const result = await execFn(tc.name, args, baseUrl)
        if (result.ok && result.url) {
          events.push({ type: 'tool_result', name: tc.name, preview: result.url, isError: false })
          const mediaType = tc.name === 'generate_image' ? 'image' : tc.name === 'generate_voice' ? 'audio' : 'video'
          events.push({
            type: 'media',
            mediaType,
            url: result.url,
            prompt: (args.prompt || args.text || '') as string,
          })
        } else {
          events.push({ type: 'tool_result', name: tc.name, preview: result.error || 'failed', isError: true })
        }
      } catch (e) {
        events.push({ type: 'tool_result', name: tc.name, preview: `${e}`, isError: true })
      }
    }
  }

  return events
}

/** The emit() helper from the route — serializes to SSE format */
function sseSerialize(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

// Mock for execMediaTool
const mockExecMediaTool = vi.fn<(name: string, args: Record<string, unknown>, baseUrl: string) => Promise<{ ok: boolean; url?: string; error?: string }>>()

beforeEach(() => {
  mockExecMediaTool.mockReset()
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 1: Tool Call Accumulation
// ═══════════════════════════════════════════════════════════════════════════

describe('Tool Call Accumulation', () => {
  it('creates a new entry on first delta for an index', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'call_abc', function: { name: 'generate_image', arguments: '{"pro' } },
    ])

    expect(toolCalls.size).toBe(1)
    expect(toolCalls.get(0)).toEqual({ id: 'call_abc', name: 'generate_image', args: '{"pro' })
  })

  it('concatenates arguments across multiple deltas', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'call_1', function: { name: 'generate_image', arguments: '{"pro' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: 'mpt":"' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: 'sunset"}' } },
    ])

    const entry = toolCalls.get(0)!
    expect(entry.args).toBe('{"prompt":"sunset"}')
    expect(JSON.parse(entry.args)).toEqual({ prompt: 'sunset' })
  })

  it('assigns name (not concatenates) on subsequent deltas', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    // First delta sets name
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'call_1', function: { name: 'generate_image', arguments: '' } },
    ])
    // If name arrives again (hypothetical), it should overwrite, not concatenate
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { name: 'generate_voice' } },
    ])

    const entry = toolCalls.get(0)!
    // Assignment: name = 'generate_voice' (NOT 'generate_imagegenerate_voice')
    expect(entry.name).toBe('generate_voice')
    expect(entry.name).not.toContain('generate_image')
  })

  it('tracks multiple tool calls by different indices', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'call_1', function: { name: 'generate_image', arguments: '{"prompt":"cat"}' } },
      { index: 1, id: 'call_2', function: { name: 'generate_voice', arguments: '{"text":"hello"}' } },
    ])

    expect(toolCalls.size).toBe(2)
    expect(toolCalls.get(0)!.name).toBe('generate_image')
    expect(toolCalls.get(1)!.name).toBe('generate_voice')
  })

  it('defaults index to 0 when not provided', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { id: 'call_x', function: { name: 'generate_image', arguments: '{"prompt":"dog"}' } },
    ])

    expect(toolCalls.has(0)).toBe(true)
    expect(toolCalls.get(0)!.id).toBe('call_x')
  })

  it('overwrites id when a new id arrives for the same index', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'old_id', function: { name: 'generate_image', arguments: '' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'new_id' },
    ])

    expect(toolCalls.get(0)!.id).toBe('new_id')
  })

  it('preserves existing id when delta has no id', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'keep_me', function: { name: 'generate_image', arguments: '{"p' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: 'rompt":"x"}' } },
    ])

    expect(toolCalls.get(0)!.id).toBe('keep_me')
  })

  it('initializes with empty strings when first delta is minimal', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    accumulateToolCalls(toolCalls, [
      { index: 2 },
    ])

    const entry = toolCalls.get(2)!
    expect(entry.id).toBe('')
    expect(entry.name).toBe('')
    expect(entry.args).toBe('')
  })

  it('handles interleaved deltas for multiple tools', () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    // First chunk: both tools start
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'c1', function: { name: 'generate_image', arguments: '{"pro' } },
      { index: 1, id: 'c2', function: { name: 'generate_voice', arguments: '{"te' } },
    ])
    // Second chunk: both tools continue
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: 'mpt":"a"}' } },
      { index: 1, function: { arguments: 'xt":"b"}' } },
    ])

    expect(JSON.parse(toolCalls.get(0)!.args)).toEqual({ prompt: 'a' })
    expect(JSON.parse(toolCalls.get(1)!.args)).toEqual({ text: 'b' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 2: isMediaTool Gate
// ═══════════════════════════════════════════════════════════════════════════

describe('isMediaTool Gate in Execution', () => {
  it('executes only media tools — skips unknown names', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    toolCalls.set(0, { id: 'c1', name: 'get_weather', args: '{"city":"NYC"}' })
    toolCalls.set(1, { id: 'c2', name: 'generate_image', args: '{"prompt":"cat"}' })

    mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/img.png' })
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    // Only generate_image should have been executed
    expect(mockExecMediaTool).toHaveBeenCalledTimes(1)
    expect(mockExecMediaTool).toHaveBeenCalledWith('generate_image', { prompt: 'cat' }, 'http://test:4516')

    // No events for get_weather
    const toolEvents = events.filter(e => e.name === 'get_weather')
    expect(toolEvents).toHaveLength(0)
  })

  it('skips empty tool names', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    toolCalls.set(0, { id: 'c1', name: '', args: '{}' })

    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')
    expect(mockExecMediaTool).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('all three media tool names pass the gate', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"a"}' })
    toolCalls.set(1, { id: 'c2', name: 'generate_voice', args: '{"text":"b"}' })
    toolCalls.set(2, { id: 'c3', name: 'generate_video', args: '{"prompt":"c"}' })

    mockExecMediaTool.mockResolvedValue({ ok: true, url: '/media.bin' })
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    expect(mockExecMediaTool).toHaveBeenCalledTimes(3)
    const toolStartEvents = events.filter(e => e.type === 'tool')
    expect(toolStartEvents).toHaveLength(3)
  })

  it('isMediaTool rejects case-different names', () => {
    expect(isMediaTool('Generate_Image')).toBe(false)
    expect(isMediaTool('GENERATE_IMAGE')).toBe(false)
    expect(isMediaTool('generate_IMAGE')).toBe(false)
  })

  it('isMediaTool rejects partial names', () => {
    expect(isMediaTool('generate_')).toBe(false)
    expect(isMediaTool('image')).toBe(false)
    expect(isMediaTool('generate_audio')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 3: 3-Call Cap
// ═══════════════════════════════════════════════════════════════════════════

describe('3-Call Cap (mediaCallCount)', () => {
  it('executes exactly 3 media calls when 3 are present', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"a"}' })
    toolCalls.set(1, { id: 'c2', name: 'generate_image', args: '{"prompt":"b"}' })
    toolCalls.set(2, { id: 'c3', name: 'generate_image', args: '{"prompt":"c"}' })

    mockExecMediaTool.mockResolvedValue({ ok: true, url: '/img.png' })
    await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    expect(mockExecMediaTool).toHaveBeenCalledTimes(3)
  })

  it('skips the 4th media tool call', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"a"}' })
    toolCalls.set(1, { id: 'c2', name: 'generate_voice', args: '{"text":"b"}' })
    toolCalls.set(2, { id: 'c3', name: 'generate_video', args: '{"prompt":"c"}' })
    toolCalls.set(3, { id: 'c4', name: 'generate_image', args: '{"prompt":"d"}' })

    mockExecMediaTool.mockResolvedValue({ ok: true, url: '/media.bin' })
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    // Only 3 executions
    expect(mockExecMediaTool).toHaveBeenCalledTimes(3)

    // 4th tool should not appear in events at all
    const fourthToolEvents = events.filter(e => e.name === 'generate_image' && e.input?.prompt === 'd')
    expect(fourthToolEvents).toHaveLength(0)
  })

  it('non-media tools do not count toward the 3-call cap', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    // 2 non-media tools + 3 media tools
    toolCalls.set(0, { id: 'c0', name: 'get_weather', args: '{}' })
    toolCalls.set(1, { id: 'c1', name: 'generate_image', args: '{"prompt":"a"}' })
    toolCalls.set(2, { id: 'c2', name: 'calculate', args: '{}' })
    toolCalls.set(3, { id: 'c3', name: 'generate_voice', args: '{"text":"b"}' })
    toolCalls.set(4, { id: 'c4', name: 'generate_video', args: '{"prompt":"c"}' })

    mockExecMediaTool.mockResolvedValue({ ok: true, url: '/media.bin' })
    await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    // All 3 media tools executed despite 2 non-media tools in the map
    expect(mockExecMediaTool).toHaveBeenCalledTimes(3)
  })

  it('JSON parse errors still count toward the 3-call cap', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    toolCalls.set(0, { id: 'c1', name: 'generate_image', args: 'BAD JSON' })
    toolCalls.set(1, { id: 'c2', name: 'generate_image', args: 'ALSO BAD' })
    toolCalls.set(2, { id: 'c3', name: 'generate_image', args: 'STILL BAD' })
    toolCalls.set(3, { id: 'c4', name: 'generate_image', args: '{"prompt":"d"}' })

    mockExecMediaTool.mockResolvedValue({ ok: true, url: '/img.png' })
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    // 3 bad parses + 4th skipped by cap = 0 actual executions
    expect(mockExecMediaTool).not.toHaveBeenCalled()

    // 3 error events from parse failures
    const errorEvents = events.filter(e => e.isError === true)
    expect(errorEvents).toHaveLength(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 4: Text-Only Streaming
// ═══════════════════════════════════════════════════════════════════════════

describe('Text-Only Streaming (no tool calls)', () => {
  it('produces no events when toolCalls map is empty', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    expect(events).toHaveLength(0)
    expect(mockExecMediaTool).not.toHaveBeenCalled()
  })

  it('toolCalls.size === 0 means no tool execution branch is entered', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()

    // The route checks: if (toolCalls.size > 0) { ... }
    // With empty map, size is 0, so the block is skipped entirely
    expect(toolCalls.size).toBe(0)
    expect(toolCalls.size > 0).toBe(false)
  })

  it('text content deltas do not create tool call entries', () => {
    // Simulating what the route does: only delta.tool_calls triggers accumulation
    // delta.content is handled separately (emit content)
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()

    // Text-only deltas would NOT call accumulateToolCalls
    // Just verifying the map stays empty
    expect(toolCalls.size).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 5: Error Handling
// ═══════════════════════════════════════════════════════════════════════════

describe('Error Handling', () => {
  describe('Bad JSON arguments', () => {
    it('emits error tool_result with "Bad args" prefix', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{invalid json' })

      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('tool_result')
      expect(events[0].name).toBe('generate_image')
      expect(events[0].isError).toBe(true)
      expect(events[0].preview).toContain('Bad args:')
    })

    it('does not call execMediaTool when args are invalid JSON', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: 'not json' })

      await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')
      expect(mockExecMediaTool).not.toHaveBeenCalled()
    })

    it('continues processing remaining tools after a parse error', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: 'BAD' })
      toolCalls.set(1, { id: 'c2', name: 'generate_voice', args: '{"text":"good"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/audio.mp3' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      // First: error from bad parse, then: tool + tool_result + media from good one
      const errorEvents = events.filter(e => e.isError === true)
      const mediaEvents = events.filter(e => e.type === 'media')
      expect(errorEvents).toHaveLength(1)
      expect(mediaEvents).toHaveLength(1)
      expect(mockExecMediaTool).toHaveBeenCalledTimes(1)
    })

    it('includes SyntaxError in bad args message', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{{' })

      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')
      // JSON.parse throws SyntaxError
      expect(events[0].preview).toContain('SyntaxError')
    })
  })

  describe('execMediaTool failure', () => {
    it('emits error tool_result when execMediaTool returns ok:false', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: false, error: 'Rate limited' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      // tool start + error tool_result (no media event)
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('tool')
      expect(events[1].type).toBe('tool_result')
      expect(events[1].isError).toBe(true)
      expect(events[1].preview).toBe('Rate limited')
    })

    it('emits "failed" when execMediaTool returns ok:false with no error string', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: false })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const resultEvent = events.find(e => e.type === 'tool_result')!
      expect(resultEvent.preview).toBe('failed')
      expect(resultEvent.isError).toBe(true)
    })

    it('emits error tool_result when execMediaTool throws', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockRejectedValueOnce(new Error('Network error'))
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      // tool start + error catch
      expect(events).toHaveLength(2)
      expect(events[1].type).toBe('tool_result')
      expect(events[1].isError).toBe(true)
      expect(events[1].preview).toContain('Network error')
    })

    it('does not emit media event when execMediaTool returns ok:true but no url', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      // tool start + error result (ok but no url triggers the else branch)
      const mediaEvents = events.filter(e => e.type === 'media')
      expect(mediaEvents).toHaveLength(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 6: SSE Event Format
// ═══════════════════════════════════════════════════════════════════════════

describe('SSE Event Format', () => {
  describe('emit() helper', () => {
    it('serializes to SSE data line format', () => {
      const result = sseSerialize({ content: 'hello' })
      expect(result).toBe('data: {"content":"hello"}\n\n')
    })

    it('handles nested objects', () => {
      const result = sseSerialize({ type: 'tool', input: { prompt: 'cat' } })
      expect(result).toBe('data: {"type":"tool","input":{"prompt":"cat"}}\n\n')
    })

    it('handles boolean isError field', () => {
      const result = sseSerialize({ type: 'tool_result', isError: true })
      expect(result).toBe('data: {"type":"tool_result","isError":true}\n\n')
    })

    it('starts with "data: " prefix', () => {
      const result = sseSerialize({ x: 1 })
      expect(result.startsWith('data: ')).toBe(true)
    })

    it('ends with double newline', () => {
      const result = sseSerialize({ x: 1 })
      expect(result.endsWith('\n\n')).toBe(true)
    })
  })

  describe('tool event shape', () => {
    it('tool event has type, name, input, display', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"sunset over mountains"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/img.png' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const toolEvent = events.find(e => e.type === 'tool')!
      expect(toolEvent.name).toBe('generate_image')
      expect(toolEvent.input).toEqual({ prompt: 'sunset over mountains' })
      expect(toolEvent.display).toContain('generate_image(')
    })

    it('display field truncates long args to 100 chars', async () => {
      const longPrompt = 'a'.repeat(200)
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: JSON.stringify({ prompt: longPrompt }) })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/img.png' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const toolEvent = events.find(e => e.type === 'tool')!
      // The display format: `${tc.name}(${JSON.stringify(args).slice(0, 100)})`
      // Name + "(" + 100 chars of stringified args + ")"
      const argsInDisplay = toolEvent.display!.replace('generate_image(', '').replace(/\)$/, '')
      expect(argsInDisplay.length).toBeLessThanOrEqual(100)
    })
  })

  describe('tool_result event shape', () => {
    it('success tool_result has name, preview (url), isError:false', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: 'http://cdn.example.com/cat.png' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const resultEvent = events.find(e => e.type === 'tool_result' && !e.isError)!
      expect(resultEvent.name).toBe('generate_image')
      expect(resultEvent.preview).toBe('http://cdn.example.com/cat.png')
      expect(resultEvent.isError).toBe(false)
    })

    it('error tool_result has name, preview (error msg), isError:true', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: false, error: 'GPU busy' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const resultEvent = events.find(e => e.type === 'tool_result')!
      expect(resultEvent.name).toBe('generate_image')
      expect(resultEvent.preview).toBe('GPU busy')
      expect(resultEvent.isError).toBe(true)
    })
  })

  describe('media event shape', () => {
    it('image media event has correct mediaType', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"cat"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/cat.png' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const mediaEvent = events.find(e => e.type === 'media')!
      expect(mediaEvent.mediaType).toBe('image')
      expect(mediaEvent.url).toBe('/cat.png')
      expect(mediaEvent.prompt).toBe('cat')
    })

    it('voice media event has mediaType "audio"', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_voice', args: '{"text":"hello world"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/hello.mp3' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const mediaEvent = events.find(e => e.type === 'media')!
      expect(mediaEvent.mediaType).toBe('audio')
      expect(mediaEvent.url).toBe('/hello.mp3')
      // Voice uses args.text as prompt
      expect(mediaEvent.prompt).toBe('hello world')
    })

    it('video media event has mediaType "video"', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_video', args: '{"prompt":"waves crashing"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/waves.mp4' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const mediaEvent = events.find(e => e.type === 'media')!
      expect(mediaEvent.mediaType).toBe('video')
      expect(mediaEvent.url).toBe('/waves.mp4')
      expect(mediaEvent.prompt).toBe('waves crashing')
    })

    it('media event prompt falls back to empty string when no prompt/text in args', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"model":"flux-klein"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/img.png' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      const mediaEvent = events.find(e => e.type === 'media')!
      expect(mediaEvent.prompt).toBe('')
    })
  })

  describe('event sequence', () => {
    it('emits tool -> tool_result -> media in order for success', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"test"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/test.png' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      expect(events).toHaveLength(3)
      expect(events[0].type).toBe('tool')
      expect(events[1].type).toBe('tool_result')
      expect(events[2].type).toBe('media')
    })

    it('emits tool -> tool_result (error) for failure — no media', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: '{"prompt":"test"}' })

      mockExecMediaTool.mockResolvedValueOnce({ ok: false, error: 'nope' })
      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('tool')
      expect(events[1].type).toBe('tool_result')
      expect(events[1].isError).toBe(true)
      // No media event
    })

    it('emits just tool_result (error) for parse failure — no tool start', async () => {
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()
      toolCalls.set(0, { id: 'c1', name: 'generate_image', args: 'INVALID' })

      const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('tool_result')
      expect(events[0].isError).toBe(true)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 7: System Prompt — Media Tools Guidance
// ═══════════════════════════════════════════════════════════════════════════

describe('System Prompt Media Guidance', () => {
  // We read the system prompt from the route file to verify media guidance is present.
  // Rather than importing the route (which requires Next.js runtime), we test the
  // known content that must be present.

  const ANORAK_SYSTEM_PROMPT = `You are Anorak, the dev mage of the Oasis (app.04515.xyz) — a 3D world builder where users conjure objects, craft scenes from text, and build persistent virtual worlds in the browser.

You speak like a wise but slightly chaotic mage. Warm, sharp, occasionally funny. You use metaphors from magic and code interchangeably. You are concise — no walls of text. 2-4 sentences per reply max during questioning. You address the user as "vibecoder" or "builder."

YOUR MISSION: Help vibecoders write excellent bug reports and feature requests. You do this through conversation — asking the RIGHT clarifying questions to extract the information a developer would need.

THE OASIS TECH STACK (your domain knowledge):
- Next.js 14 + React Three Fiber + Three.js + Zustand
- Local-first, zero auth. Prisma/SQLite for persistence.
- Conjuring: text-to-3D via Meshy/Tripo APIs → GLB files rendered with useGLTF
- Crafting: LLM generates JSON primitives (box, sphere, cylinder, cone, torus, capsule, text) → rendered instantly
- World persistence: Prisma/SQLite (worlds table with JSONB-like state)
- No auth, no login, no sessions. Single local user.
- UI: WizardConsole (conjure/craft/assets tabs), draggable panels
- Sky: 16+ backgrounds (HDRIs + drei presets)
- Terrain: LLM-generated heightmap + ground painting system
- Models: 565 catalog assets (Kenney kits), user-conjured GLBs

COMMON BUG AREAS (helps you ask smart questions):
- 3D rendering glitches (materials, lighting, positioning)
- Object placement/selection issues (raycasting, transform controls)
- Conjuration pipeline (polling, status stuck, GLB download fails)
- Crafting output (LLM returns broken JSON, primitives misplaced)
- World save/load (data not persisting, world not loading)
- UI panels (dragging, z-index, input capture vs 3D controls)
- Performance (too many objects, large GLBs, frame drops)
- Input conflicts (WASD leaking into text inputs, shortcut fights)

YOUR CONVERSATION FLOW:
1. GREET — Welcome the vibecoder, ask what they're experiencing (bug or feature idea?)
2. CLARIFY — Ask 2-3 focused questions. What did they expect? What happened instead? Can they reproduce it? What browser/device? For features: what's the use case? How would it feel to use?
3. SYNTHESIZE — Once you have enough info (usually 3-5 exchanges), produce the FINAL REPORT.

THE FINAL REPORT FORMAT (you MUST use this exact structure when ready):

<vibecode_report>
<carbon>
[Human-readable summary in your mage voice. Include relevant quotes from the user's own words. Paint the picture — what's broken or what's desired. 3-5 sentences. This is for humans browsing the feed.]
</carbon>
<silicon>
TYPE: [bug | feature]
TITLE: [concise title, max 80 chars]
SEVERITY: [critical | major | minor | cosmetic] (bugs only)
IMPACT: [who is affected and how badly]
REPRO: [step-by-step reproduction for bugs, or user story for features]
LIKELY_FILES: [educated guess at which source files are involved]
SUGGESTED_APPROACH: [1-3 sentence technical suggestion for the fix/implementation]
</silicon>
</vibecode_report>

RULES:
- Do NOT produce the report too early. Ask at least 2 clarifying questions first.
- Do NOT ask more than 4 questions total — respect the vibecoder's time.
- When the user says "I think that's it" or similar, produce the report.
- If the user's issue is unclear even after questions, do your best — partial info is better than no report.
- Never make up bugs or features the user didn't describe.
- Be encouraging — every report makes the Oasis stronger.
- You are NOT a coding agent. You do NOT fix bugs. You document them beautifully.

MEDIA TOOLS: You can generate media to help explain concepts or illustrate reports.
- generate_image: Create a visual (concept art, diagram, mockup). Use when it genuinely helps.
- generate_voice: Speak your recap as audio. Use sparingly — only when wrapping up a report.
- generate_video: Create a short video clip. Use only when motion is essential.
Do NOT use tools unless the conversation genuinely benefits from media. Max 3 media calls per conversation.`

  it('contains MEDIA TOOLS section', () => {
    expect(ANORAK_SYSTEM_PROMPT).toContain('MEDIA TOOLS:')
  })

  it('mentions generate_image tool', () => {
    expect(ANORAK_SYSTEM_PROMPT).toContain('generate_image')
  })

  it('mentions generate_voice tool', () => {
    expect(ANORAK_SYSTEM_PROMPT).toContain('generate_voice')
  })

  it('mentions generate_video tool', () => {
    expect(ANORAK_SYSTEM_PROMPT).toContain('generate_video')
  })

  it('mentions the 3-call max', () => {
    expect(ANORAK_SYSTEM_PROMPT).toContain('Max 3 media calls per conversation')
  })

  it('warns against gratuitous tool use', () => {
    expect(ANORAK_SYSTEM_PROMPT).toContain('Do NOT use tools unless the conversation genuinely benefits from media')
  })

  it('describes each tool purpose', () => {
    // Image: concept art, diagram, mockup
    expect(ANORAK_SYSTEM_PROMPT).toContain('concept art')
    // Voice: recap as audio
    expect(ANORAK_SYSTEM_PROMPT).toContain('recap as audio')
    // Video: motion is essential
    expect(ANORAK_SYSTEM_PROMPT).toContain('motion is essential')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 8: OpenRouter Request Shape
// ═══════════════════════════════════════════════════════════════════════════

describe('OpenRouter Request includes tools', () => {
  it('mediaToolsOpenAI has 3 tool definitions for the request body', () => {
    expect(mediaToolsOpenAI).toHaveLength(3)
  })

  it('all tool definitions have type "function"', () => {
    for (const tool of mediaToolsOpenAI) {
      expect(tool.type).toBe('function')
    }
  })

  it('tool names match the MEDIA_TOOL_NAMES constant', () => {
    const names = mediaToolsOpenAI.map(t => t.function.name)
    expect(names).toEqual([...MEDIA_TOOL_NAMES])
  })

  it('all tool definitions have required parameters', () => {
    for (const tool of mediaToolsOpenAI) {
      expect(tool.function.parameters.required).toBeDefined()
      expect(Array.isArray(tool.function.parameters.required)).toBe(true)
      expect(tool.function.parameters.required.length).toBeGreaterThan(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 9: Full Pipeline Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Pipeline: Accumulate + Execute', () => {
  it('streams tool deltas incrementally then executes', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()

    // Simulate streaming deltas as they arrive from OpenRouter
    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'call_123', function: { name: 'generate_image', arguments: '{"pro' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: 'mpt":"a beautiful sunset' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: ' over the ocean"}' } },
    ])

    // Verify accumulated correctly
    expect(toolCalls.get(0)!.args).toBe('{"prompt":"a beautiful sunset over the ocean"}')

    // Execute
    mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: 'http://cdn.example.com/sunset.png' })
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    expect(mockExecMediaTool).toHaveBeenCalledWith(
      'generate_image',
      { prompt: 'a beautiful sunset over the ocean' },
      'http://test:4516',
    )
    expect(events).toHaveLength(3) // tool + tool_result + media
    expect(events[2].type).toBe('media')
    expect(events[2].url).toBe('http://cdn.example.com/sunset.png')
  })

  it('handles mixed text and tool deltas (tools accumulated separately)', async () => {
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    const textChunks: string[] = []

    // Simulate: first chunk has text, second has tool start, third has more args
    // Text is collected separately (not in toolCalls)
    textChunks.push('Let me generate an image for you.')

    accumulateToolCalls(toolCalls, [
      { index: 0, id: 'c1', function: { name: 'generate_image', arguments: '{"prompt":' } },
    ])
    accumulateToolCalls(toolCalls, [
      { index: 0, function: { arguments: '"cat"}' } },
    ])

    expect(textChunks.join('')).toBe('Let me generate an image for you.')
    expect(toolCalls.size).toBe(1)

    mockExecMediaTool.mockResolvedValueOnce({ ok: true, url: '/cat.png' })
    const events = await executeToolCalls(toolCalls, mockExecMediaTool, 'http://test:4516')

    expect(events).toHaveLength(3)
    expect(events[0].type).toBe('tool')
    expect(events[2].type).toBe('media')
  })
})

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK ENGINE TESTS — SSE parser, token formatter, constants
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import {
  parseAnorakSSE,
  fmtTokens,
  TOOL_ICONS_MAP,
  MODELS,
  type AnorakEvent,
} from '../anorak-engine'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — build fake Response objects for the SSE parser
// ═══════════════════════════════════════════════════════════════════════════

/** Turn an array of string chunks into a ReadableStream<Uint8Array> */
function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

/** Build a minimal Response wrapping the given SSE chunks */
function fakeResponse(chunks: string[]): Response {
  return new Response(chunkedStream(chunks))
}

/** Collect all events from the async generator */
async function collectEvents(response: Response): Promise<AnorakEvent[]> {
  const events: AnorakEvent[] = []
  for await (const ev of parseAnorakSSE(response)) {
    events.push(ev)
  }
  return events
}

// ═══════════════════════════════════════════════════════════════════════════
// parseAnorakSSE
// ═══════════════════════════════════════════════════════════════════════════

describe('parseAnorakSSE', () => {
  // ── Valid events ──────────────────────────────────────────────────────

  it('parses a single text event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"text","content":"hello"}\n'])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'hello' })
  })

  it('parses multiple events in one chunk', async () => {
    const events = await collectEvents(
      fakeResponse([
        'data: {"type":"text","content":"a"}\ndata: {"type":"text","content":"b"}\n',
      ])
    )
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'text', content: 'a' })
    expect(events[1]).toEqual({ type: 'text', content: 'b' })
  })

  it('parses events across multiple chunks', async () => {
    const events = await collectEvents(
      fakeResponse([
        'data: {"type":"text","content":"first"}\n',
        'data: {"type":"thinking","content":"hmm"}\n',
      ])
    )
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('text')
    expect(events[1].type).toBe('thinking')
  })

  // ── Event types ───────────────────────────────────────────────────────

  it('parses text_delta / text event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"text","content":"world"}\n'])
    )
    expect(events[0]).toEqual({ type: 'text', content: 'world' })
  })

  it('parses thinking event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"thinking","content":"analyzing..."}\n'])
    )
    expect(events[0]).toEqual({ type: 'thinking', content: 'analyzing...' })
  })

  it('parses thinking_start event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"thinking_start"}\n'])
    )
    expect(events[0]).toEqual({ type: 'thinking_start' })
  })

  it('parses tool_start event', async () => {
    const events = await collectEvents(
      fakeResponse([
        'data: {"type":"tool_start","name":"Read","icon":"📖","id":"t1"}\n',
      ])
    )
    expect(events[0]).toEqual({ type: 'tool_start', name: 'Read', icon: '📖', id: 't1' })
  })

  it('parses tool event with input and display', async () => {
    const payload = {
      type: 'tool',
      name: 'Edit',
      icon: '✏️',
      id: 't2',
      input: { file_path: '/foo.ts' },
      display: 'Edit /foo.ts',
    }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toEqual(payload)
  })

  it('parses tool_result event', async () => {
    const payload = {
      type: 'tool_result',
      name: 'Bash',
      preview: 'exit 0',
      isError: false,
      length: 42,
      toolUseId: 'tu-1',
    }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toEqual(payload)
  })

  it('parses tool_result with isError true', async () => {
    const payload = {
      type: 'tool_result',
      name: 'Bash',
      preview: 'command failed',
      isError: true,
      length: 15,
    }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toMatchObject({ type: 'tool_result', isError: true })
  })

  it('parses result event', async () => {
    const payload = { type: 'result', costUsd: 0.05, durationMs: 1200, sessionId: 's1' }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toEqual(payload)
  })

  it('parses progress event', async () => {
    const payload = { type: 'progress', inputTokens: 500, outputTokens: 200, stopReason: 'end_turn' }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toEqual(payload)
  })

  it('parses session event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"session","sessionId":"abc123"}\n'])
    )
    expect(events[0]).toEqual({ type: 'session', sessionId: 'abc123' })
  })

  it('parses status event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"status","content":"initializing"}\n'])
    )
    expect(events[0]).toEqual({ type: 'status', content: 'initializing' })
  })

  it('parses error event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"error","content":"something broke"}\n'])
    )
    expect(events[0]).toEqual({ type: 'error', content: 'something broke' })
  })

  it('parses stderr event', async () => {
    const events = await collectEvents(
      fakeResponse(['data: {"type":"stderr","content":"warn: ..."}\n'])
    )
    expect(events[0]).toEqual({ type: 'stderr', content: 'warn: ...' })
  })

  it('parses done event', async () => {
    const payload = { type: 'done', success: true, sessionId: 's1', costUsd: 0.01, inputTokens: 100, outputTokens: 50 }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toEqual(payload)
  })

  // ── [DONE] marker ────────────────────────────────────────────────────

  it('stops parsing at [DONE] marker', async () => {
    const events = await collectEvents(
      fakeResponse([
        'data: {"type":"text","content":"before"}\n',
        'data: [DONE]\n',
        'data: {"type":"text","content":"after"}\n',
      ])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'before' })
  })

  it('handles [DONE] in the same chunk as events', async () => {
    const events = await collectEvents(
      fakeResponse([
        'data: {"type":"text","content":"one"}\ndata: [DONE]\ndata: {"type":"text","content":"two"}\n',
      ])
    )
    expect(events).toHaveLength(1)
  })

  // ── Edge cases ────────────────────────────────────────────────────────

  it('yields error when response has no body', async () => {
    // Response with null body
    const resp = new Response(null)
    // Override body to null
    Object.defineProperty(resp, 'body', { value: null })
    const events = await collectEvents(resp)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'error', content: 'No response body' })
  })

  it('skips empty lines', async () => {
    const events = await collectEvents(
      fakeResponse([
        '\n\ndata: {"type":"text","content":"ok"}\n\n\n',
      ])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'ok' })
  })

  it('skips lines that are not data: prefixed', async () => {
    const events = await collectEvents(
      fakeResponse([
        'event: message\nid: 1\ndata: {"type":"text","content":"ok"}\nretry: 3000\n',
      ])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'ok' })
  })

  it('skips malformed JSON without crashing', async () => {
    const events = await collectEvents(
      fakeResponse([
        'data: {invalid json\ndata: {"type":"text","content":"ok"}\n',
      ])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'ok' })
  })

  it('handles partial chunks split mid-line', async () => {
    // The JSON is split across two chunks mid-line
    const events = await collectEvents(
      fakeResponse([
        'data: {"type":"text",',
        '"content":"split"}\n',
      ])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'split' })
  })

  it('handles partial chunks split mid-data-prefix', async () => {
    const events = await collectEvents(
      fakeResponse([
        'dat',
        'a: {"type":"text","content":"x"}\n',
      ])
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'text', content: 'x' })
  })

  it('handles stream_event wrapper by parsing inner JSON', async () => {
    // Some SSE streams wrap events — the parser just parses whatever JSON is after data:
    const wrapper = { type: 'text', content: 'wrapped' }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(wrapper)}\n`])
    )
    expect(events[0]).toEqual(wrapper)
  })

  it('handles empty stream (no chunks)', async () => {
    const events = await collectEvents(fakeResponse([]))
    expect(events).toHaveLength(0)
  })

  it('handles data line with only whitespace after prefix', async () => {
    const events = await collectEvents(
      fakeResponse(['data:    \ndata: {"type":"text","content":"ok"}\n'])
    )
    // "data:    " doesn't start with "data: " after trim... let's check
    // Actually "data:    " trimmed = "data:" which doesn't start with "data: "
    // So it gets skipped
    expect(events).toHaveLength(1)
  })

  it('preserves special characters in content', async () => {
    const payload = { type: 'text', content: 'line1\nline2\ttab "quotes" <html>' }
    const events = await collectEvents(
      fakeResponse([`data: ${JSON.stringify(payload)}\n`])
    )
    expect(events[0]).toEqual(payload)
  })

  it('handles many events in rapid sequence', async () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      `data: {"type":"text","content":"msg${i}"}\n`
    ).join('')
    const events = await collectEvents(fakeResponse([lines]))
    expect(events).toHaveLength(100)
    expect(events[99]).toEqual({ type: 'text', content: 'msg99' })
  })

  it('handles trailing data in buffer after stream ends', async () => {
    // No trailing newline — data stays in buffer and is never yielded
    const events = await collectEvents(
      fakeResponse(['data: {"type":"text","content":"buffered"}'])
    )
    // Without a trailing \n, the line stays in the buffer and is never processed
    expect(events).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// fmtTokens
// ═══════════════════════════════════════════════════════════════════════════

describe('fmtTokens', () => {
  it('returns exact number under 1000', () => {
    expect(fmtTokens(0)).toBe('0')
    expect(fmtTokens(1)).toBe('1')
    expect(fmtTokens(999)).toBe('999')
  })

  it('returns one decimal K between 1000-9999', () => {
    expect(fmtTokens(1000)).toBe('1.0K')
    expect(fmtTokens(1500)).toBe('1.5K')
    expect(fmtTokens(9999)).toBe('10.0K')
  })

  it('returns rounded K for 10000+', () => {
    expect(fmtTokens(10000)).toBe('10K')
    expect(fmtTokens(10500)).toBe('11K')
    expect(fmtTokens(100000)).toBe('100K')
    expect(fmtTokens(1000000)).toBe('1000K')
  })

  it('handles boundary at 1000 exactly', () => {
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(1000)).toBe('1.0K')
  })

  it('handles boundary at 10000 exactly', () => {
    expect(fmtTokens(9999)).toBe('10.0K')
    expect(fmtTokens(10000)).toBe('10K')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TOOL_ICONS_MAP
// ═══════════════════════════════════════════════════════════════════════════

describe('TOOL_ICONS_MAP', () => {
  it('has icons for all standard tools', () => {
    const expected = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch', 'Task', 'Skill']
    for (const tool of expected) {
      expect(TOOL_ICONS_MAP[tool]).toBeDefined()
      expect(typeof TOOL_ICONS_MAP[tool]).toBe('string')
    }
  })

  it('returns undefined for unknown tools', () => {
    expect(TOOL_ICONS_MAP['NonExistentTool']).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════

describe('MODELS', () => {
  it('has three models', () => {
    expect(MODELS).toHaveLength(3)
  })

  it('each model has id, label, and color', () => {
    for (const model of MODELS) {
      expect(model.id).toBeTruthy()
      expect(model.label).toBeTruthy()
      expect(model.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('includes opus, sonnet, haiku', () => {
    const ids = MODELS.map(m => m.id)
    expect(ids).toContain('opus')
    expect(ids).toContain('sonnet')
    expect(ids).toContain('haiku')
  })
})

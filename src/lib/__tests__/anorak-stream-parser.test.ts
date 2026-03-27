// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — anorak-stream-parser.ts
// Shared Claude CLI stream-json parser: formatToolMsg + createStreamParser
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi } from 'vitest'
import { formatToolMsg, createStreamParser } from '../anorak-stream-parser'

// ═══════════════════════════════════════════════════════════════════════════
// formatToolMsg
// ═══════════════════════════════════════════════════════════════════════════

describe('formatToolMsg', () => {
  it('formats Read tool with file path', () => {
    expect(formatToolMsg('Read', { file_path: '/src/index.ts' })).toBe('Read: /src/index.ts')
  })

  it('formats Edit tool with file path', () => {
    expect(formatToolMsg('Edit', { file_path: '/src/app.tsx' })).toBe('Edit: /src/app.tsx')
  })

  it('formats Write tool with file path', () => {
    expect(formatToolMsg('Write', { file_path: '/tmp/out.json' })).toBe('Write: /tmp/out.json')
  })

  it('formats Bash tool with short command', () => {
    expect(formatToolMsg('Bash', { command: 'ls -la' })).toBe('Bash: ls -la')
  })

  it('formats Bash tool truncating long commands at 100 chars', () => {
    const longCmd = 'x'.repeat(150)
    const result = formatToolMsg('Bash', { command: longCmd })
    expect(result).toBe(`Bash: ${'x'.repeat(100)}...`)
  })

  it('formats Bash tool without ellipsis for exactly 100 char commands', () => {
    const cmd = 'y'.repeat(100)
    const result = formatToolMsg('Bash', { command: cmd })
    expect(result).toBe(`Bash: ${cmd}`)
  })

  it('formats Grep tool with pattern and path', () => {
    expect(formatToolMsg('Grep', { pattern: 'TODO', path: 'src/' })).toBe('Grep: "TODO" in src/')
  })

  it('formats Grep tool with pattern and default path', () => {
    expect(formatToolMsg('Grep', { pattern: 'fixme' })).toBe('Grep: "fixme" in .')
  })

  it('formats Glob tool with pattern', () => {
    expect(formatToolMsg('Glob', { pattern: '**/*.ts' })).toBe('Glob: **/*.ts')
  })

  it('formats TodoWrite tool', () => {
    expect(formatToolMsg('TodoWrite', { tasks: [] })).toBe('TodoWrite: updating tasks')
  })

  it('formats unknown tool with input preview', () => {
    const result = formatToolMsg('CustomTool', { foo: 'bar', baz: 42 })
    expect(result).toContain('CustomTool:')
    expect(result).toContain('"foo"')
  })

  it('truncates long unknown tool input at 80 chars', () => {
    const bigInput = { data: 'z'.repeat(200) }
    const result = formatToolMsg('SomeTool', bigInput)
    expect(result.length).toBeLessThanOrEqual('SomeTool: '.length + 80 + 3) // +3 for ...
    expect(result).toContain('...')
  })

  it('returns just tool name for empty input', () => {
    expect(formatToolMsg('Mystery', {})).toBe('Mystery')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createStreamParser — event handling
// ═══════════════════════════════════════════════════════════════════════════

function ndjson(...objects: Record<string, unknown>[]): string {
  return objects.map(o => JSON.stringify(o)).join('\n') + '\n'
}

describe('createStreamParser', () => {
  it('parses text_delta events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello world' },
    }))

    expect(send).toHaveBeenCalledWith('text', { content: 'hello world' })
  })

  it('parses thinking_delta events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'let me think...' },
    }))

    expect(send).toHaveBeenCalledWith('thinking', { content: 'let me think...' })
  })

  it('parses input_json_delta and accumulates into tool block', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    // Start a tool block
    parser.feed(ndjson(
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '_path":"/x.ts"}' } },
      { type: 'content_block_stop' },
    ))

    // Should have sent tool_start and then tool with accumulated input
    expect(send).toHaveBeenCalledWith('tool_start', { name: 'Read' })
    expect(send).toHaveBeenCalledWith('tool', expect.objectContaining({
      name: 'Read',
      input: { file_path: '/x.ts' },
      display: 'Read: /x.ts',
    }))
  })

  it('parses content_block_start with tool_use type', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Bash' },
    }))

    expect(send).toHaveBeenCalledWith('tool_start', { name: 'Bash' })
  })

  it('resets tool block on text content_block_start', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    // Start tool, then text block (resets), then stop should NOT emit tool
    parser.feed(ndjson(
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Grep' } },
      { type: 'content_block_start', content_block: { type: 'text' } },
      { type: 'content_block_stop' },
    ))

    expect(send).toHaveBeenCalledWith('tool_start', { name: 'Grep' })
    // content_block_stop should NOT emit a tool event since text block reset it
    expect(send).not.toHaveBeenCalledWith('tool', expect.anything())
  })

  it('parses content_block_stop and emits tool event', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson(
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Write' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file_path":"/out.txt"}' } },
      { type: 'content_block_stop' },
    ))

    const toolCall = send.mock.calls.find(c => c[0] === 'tool')
    expect(toolCall).toBeDefined()
    expect(toolCall![1].name).toBe('Write')
    expect(toolCall![1].display).toBe('Write: /out.txt')
  })

  it('parses direct tool_use events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_use',
      name: 'Glob',
      input: { pattern: '*.md' },
    }))

    expect(send).toHaveBeenCalledWith('tool', expect.objectContaining({
      name: 'Glob',
      display: 'Glob: *.md',
    }))
  })

  it('parses direct tool_use with nested tool property', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_use',
      tool: { name: 'Bash', input: { command: 'pwd' } },
    }))

    expect(send).toHaveBeenCalledWith('tool', expect.objectContaining({
      name: 'Bash',
      display: 'Bash: pwd',
    }))
  })

  it('parses tool_result events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_result',
      tool_name: 'Bash',
      result: 'total 42\ndrwx------',
      is_error: false,
    }))

    expect(send).toHaveBeenCalledWith('tool_result', expect.objectContaining({
      name: 'Bash',
      isError: false,
    }))
    expect(send.mock.calls[0][1].preview).toContain('total 42')
  })

  it('parses tool_result with is_error true', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_result',
      name: 'Read',
      result: 'File not found',
      is_error: true,
    }))

    expect(send).toHaveBeenCalledWith('tool_result', expect.objectContaining({
      name: 'Read',
      isError: true,
    }))
  })

  it('truncates tool_result preview to 200 chars', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_result',
      tool_name: 'Read',
      result: 'a'.repeat(500),
    }))

    const call = send.mock.calls.find(c => c[0] === 'tool_result')
    expect(call![1].preview.length).toBeLessThanOrEqual(200)
    expect(call![1].length).toBe(500)
  })

  it('parses result events with token counts', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'result',
      cost_usd: 0.05,
      total_input_tokens: 1000,
      total_output_tokens: 500,
      duration_ms: 3200,
    }))

    expect(send).toHaveBeenCalledWith('result', {
      cost_usd: 0.05,
      total_input_tokens: 1000,
      total_output_tokens: 500,
      duration_ms: 3200,
    })
  })

  it('parses result events using total_cost_usd fallback', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'result',
      total_cost_usd: 0.12,
      total_input_tokens: 2000,
      total_output_tokens: 800,
    }))

    expect(send).toHaveBeenCalledWith('result', expect.objectContaining({
      cost_usd: 0.12,
    }))
  })

  it('parses error events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'error',
      error: { message: 'rate limit exceeded' },
    }))

    expect(send).toHaveBeenCalledWith('error', { content: 'rate limit exceeded' })
  })

  it('parses error events with direct message field', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'error',
      message: 'something broke',
    }))

    expect(send).toHaveBeenCalledWith('error', { content: 'something broke' })
  })

  it('unwraps stream_event wrapper', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'unwrapped' },
      },
    }))

    expect(send).toHaveBeenCalledWith('text', { content: 'unwrapped' })
  })

  it('skips non-content event types silently', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson(
      { type: 'message_start' },
      { type: 'ping' },
      { type: 'message_stop' },
    ))

    expect(send).not.toHaveBeenCalled()
  })

  it('sends stderr for non-JSON lines under 300 chars', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed('some warning text\n')

    expect(send).toHaveBeenCalledWith('stderr', { content: 'some warning text' })
  })

  it('ignores non-JSON lines over 300 chars', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed('z'.repeat(301) + '\n')

    expect(send).not.toHaveBeenCalled()
  })

  it('ignores empty lines', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed('\n\n\n')

    expect(send).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createStreamParser — buffer splitting
// ═══════════════════════════════════════════════════════════════════════════

describe('createStreamParser — buffer splitting', () => {
  it('handles partial JSON lines split across chunks', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    const fullLine = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'split test' },
    })

    // Split mid-JSON
    const half1 = fullLine.substring(0, 20)
    const half2 = fullLine.substring(20)

    parser.feed(half1)
    expect(send).not.toHaveBeenCalled()

    parser.feed(half2 + '\n')
    expect(send).toHaveBeenCalledWith('text', { content: 'split test' })
  })

  it('handles multiple complete lines in one chunk', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson(
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'one' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'two' } },
    ))

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('text', { content: 'one' })
    expect(send).toHaveBeenCalledWith('text', { content: 'two' })
  })

  it('handles line split across three chunks', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'triple' },
    })

    parser.feed(line.substring(0, 10))
    parser.feed(line.substring(10, 30))
    parser.feed(line.substring(30) + '\n')

    expect(send).toHaveBeenCalledWith('text', { content: 'triple' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createStreamParser — flush
// ═══════════════════════════════════════════════════════════════════════════

describe('createStreamParser — flush', () => {
  it('processes remaining buffer on flush', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    // Feed without trailing newline
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'flushed' },
    })
    parser.feed(line)
    expect(send).not.toHaveBeenCalled()

    parser.flush()
    expect(send).toHaveBeenCalledWith('text', { content: 'flushed' })
  })

  it('flush is safe to call when buffer is empty', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('clears buffer after flush', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } }))
    parser.flush()
    expect(send).toHaveBeenCalledTimes(1)

    // Second flush should not re-process
    parser.flush()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createStreamParser — lobe parameter
// ═══════════════════════════════════════════════════════════════════════════

describe('createStreamParser — lobe parameter', () => {
  it('spreads lobe into text events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'curator')

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'curated' },
    }))

    expect(send).toHaveBeenCalledWith('text', { content: 'curated', lobe: 'curator' })
  })

  it('spreads lobe into thinking events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'coder')

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'hmm' },
    }))

    expect(send).toHaveBeenCalledWith('thinking', { content: 'hmm', lobe: 'coder' })
  })

  it('spreads lobe into tool_start events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'agent')

    parser.feed(ndjson({
      type: 'content_block_start',
      content_block: { type: 'tool_use', name: 'Read' },
    }))

    expect(send).toHaveBeenCalledWith('tool_start', { name: 'Read', lobe: 'agent' })
  })

  it('spreads lobe into tool events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'tester')

    parser.feed(ndjson({
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'echo hi' },
    }))

    expect(send).toHaveBeenCalledWith('tool', expect.objectContaining({ lobe: 'tester' }))
  })

  it('spreads lobe into tool_result events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'reviewer')

    parser.feed(ndjson({
      type: 'tool_result',
      tool_name: 'Read',
      result: 'file contents',
    }))

    expect(send).toHaveBeenCalledWith('tool_result', expect.objectContaining({ lobe: 'reviewer' }))
  })

  it('spreads lobe into result events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'curator')

    parser.feed(ndjson({
      type: 'result',
      cost_usd: 0.01,
      total_input_tokens: 100,
      total_output_tokens: 50,
    }))

    expect(send).toHaveBeenCalledWith('result', expect.objectContaining({ lobe: 'curator' }))
  })

  it('spreads lobe into error events', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'coder')

    parser.feed(ndjson({ type: 'error', message: 'oops' }))

    expect(send).toHaveBeenCalledWith('error', { content: 'oops', lobe: 'coder' })
  })

  it('spreads lobe into stderr events for non-JSON', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send }, 'agent')

    parser.feed('warning line\n')

    expect(send).toHaveBeenCalledWith('stderr', { content: 'warning line', lobe: 'agent' })
  })

  it('omits lobe when not provided', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'no lobe' },
    }))

    expect(send).toHaveBeenCalledWith('text', { content: 'no lobe' })
    expect(send.mock.calls[0][1]).not.toHaveProperty('lobe')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createStreamParser — callbacks
// ═══════════════════════════════════════════════════════════════════════════

describe('createStreamParser — onText callback', () => {
  it('calls onText with text delta content', () => {
    const send = vi.fn()
    const onText = vi.fn()
    const parser = createStreamParser({ send, onText })

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello' },
    }))

    expect(onText).toHaveBeenCalledWith('hello')
  })

  it('does not call onText for thinking deltas', () => {
    const send = vi.fn()
    const onText = vi.fn()
    const parser = createStreamParser({ send, onText })

    parser.feed(ndjson({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'pondering' },
    }))

    expect(onText).not.toHaveBeenCalled()
  })

  it('accumulates multiple text deltas via onText', () => {
    const send = vi.fn()
    const onText = vi.fn()
    const parser = createStreamParser({ send, onText })

    parser.feed(ndjson(
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'c' } },
    ))

    expect(onText).toHaveBeenCalledTimes(3)
    expect(onText.mock.calls.map(c => c[0]).join('')).toBe('abc')
  })
})

describe('createStreamParser — onResult callback', () => {
  it('calls onResult with the full result event', () => {
    const send = vi.fn()
    const onResult = vi.fn()
    const parser = createStreamParser({ send, onResult })

    const resultEvent = {
      type: 'result',
      cost_usd: 0.03,
      total_input_tokens: 500,
      total_output_tokens: 200,
      duration_ms: 1500,
    }

    parser.feed(ndjson(resultEvent))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      total_input_tokens: 500,
      total_output_tokens: 200,
      duration_ms: 1500,
    }))
  })

  it('does not call onResult for non-result events', () => {
    const send = vi.fn()
    const onResult = vi.fn()
    const parser = createStreamParser({ send, onResult })

    parser.feed(ndjson(
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
      { type: 'error', message: 'err' },
    ))

    expect(onResult).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createStreamParser — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('createStreamParser — edge cases', () => {
  it('handles content_block_stop without preceding tool start', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    // Stop without start — should not crash or emit tool event
    parser.feed(ndjson({ type: 'content_block_stop' }))

    expect(send).not.toHaveBeenCalled()
  })

  it('handles tool block with empty/invalid JSON input', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson(
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{invalid' } },
      { type: 'content_block_stop' },
    ))

    // Should still emit tool with empty input (JSON parse fails gracefully)
    const toolCall = send.mock.calls.find(c => c[0] === 'tool')
    expect(toolCall).toBeDefined()
    expect(toolCall![1].name).toBe('Read')
    expect(toolCall![1].input).toEqual({})
  })

  it('handles tool block with no input_json_delta (empty input)', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson(
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'TodoWrite' } },
      { type: 'content_block_stop' },
    ))

    const toolCall = send.mock.calls.find(c => c[0] === 'tool')
    expect(toolCall).toBeDefined()
    expect(toolCall![1].display).toBe('TodoWrite: updating tasks')
  })

  it('handles tool_result with object result (non-string)', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_result',
      tool_name: 'Read',
      result: { content: 'file data', lines: 50 },
    }))

    const call = send.mock.calls.find(c => c[0] === 'tool_result')
    expect(call).toBeDefined()
    expect(call![1].preview).toContain('content')
  })

  it('replaces newlines in tool_result preview', () => {
    const send = vi.fn()
    const parser = createStreamParser({ send })

    parser.feed(ndjson({
      type: 'tool_result',
      tool_name: 'Bash',
      result: 'line1\nline2\nline3',
    }))

    const call = send.mock.calls.find(c => c[0] === 'tool_result')
    expect(call![1].preview).not.toContain('\n')
    expect(call![1].preview).toContain('line1 line2 line3')
  })
})

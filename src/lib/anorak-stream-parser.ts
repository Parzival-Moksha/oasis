// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SHARED STREAM PARSER — Claude CLI stream-json → SSE events
// ─═̷─═̷─ॐ─═̷─═̷─ One parser to rule them all: agent, curator, coder ─═̷─═̷─ॐ─═̷─═̷─
// Extracted from agent/route.ts to eliminate the "parser lobotomy" bug
// where curate/execute routes had stripped parsers missing tool events.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT TOOL EVENTS — human-readable tool descriptions
// ═══════════════════════════════════════════════════════════════════════════

export function formatToolMsg(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Read' && toolInput.file_path) return `Read: ${toolInput.file_path}`
  if (toolName === 'Edit' && toolInput.file_path) return `Edit: ${toolInput.file_path}`
  if (toolName === 'Write' && toolInput.file_path) return `Write: ${toolInput.file_path}`
  if (toolName === 'Bash' && toolInput.command) {
    const cmd = String(toolInput.command).substring(0, 100)
    return `Bash: ${cmd}${String(toolInput.command).length > 100 ? '...' : ''}`
  }
  if (toolName === 'Grep' && toolInput.pattern) return `Grep: "${toolInput.pattern}" in ${toolInput.path || '.'}`
  if (toolName === 'Glob' && toolInput.pattern) return `Glob: ${toolInput.pattern}`
  if (toolName === 'TodoWrite') return `TodoWrite: updating tasks`
  if (Object.keys(toolInput).length > 0) {
    const preview = JSON.stringify(toolInput).substring(0, 80)
    return `${toolName}: ${preview}${JSON.stringify(toolInput).length > 80 ? '...' : ''}`
  }
  return toolName
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAM PARSER FACTORY — one per agent spawn, encapsulated state
// ═══════════════════════════════════════════════════════════════════════════

export interface StreamParserCallbacks {
  send: (type: string, data: Record<string, unknown>) => void
  onText?: (text: string) => void
  onResult?: (event: Record<string, unknown>) => void
}

export function createStreamParser(callbacks: StreamParserCallbacks, lobe?: string) {
  let buffer = ''
  let currentToolBlock: { name: string; inputJson: string } | null = null

  const lobeData = lobe ? { lobe } : {}

  function processLine(line: string) {
    if (!line.trim()) return
    try {
      let event = JSON.parse(line)
      if (event.type === 'stream_event' && event.event) event = event.event
      const et = event.type || 'unknown'

      // ── TEXT / THINKING DELTA ──────────────────────────
      if (et === 'content_block_delta') {
        const delta = event.delta
        if (delta?.type === 'text_delta' && delta?.text) {
          callbacks.onText?.(delta.text)
          callbacks.send('text', { content: delta.text, ...lobeData })
        } else if (delta?.type === 'thinking_delta' && delta?.thinking) {
          callbacks.send('thinking', { content: delta.thinking, ...lobeData })
        } else if (delta?.type === 'input_json_delta' && delta?.partial_json && currentToolBlock) {
          currentToolBlock.inputJson += delta.partial_json
        }
      }

      // ── CONTENT BLOCK START: tool beginning ────────────
      else if (et === 'content_block_start') {
        const blockType = event.content_block?.type
        if (blockType === 'tool_use') {
          const toolName = event.content_block?.name || 'tool'
          currentToolBlock = { name: toolName, inputJson: '' }
          callbacks.send('tool_start', { name: toolName, ...lobeData })
        } else if (blockType === 'text') {
          currentToolBlock = null
        }
      }

      // ── CONTENT BLOCK STOP: tool call complete ─────────
      else if (et === 'content_block_stop') {
        if (currentToolBlock) {
          let toolInput: Record<string, unknown> = {}
          if (currentToolBlock.inputJson.trim()) {
            try { toolInput = JSON.parse(currentToolBlock.inputJson) } catch {}
          }
          const msg = formatToolMsg(currentToolBlock.name, toolInput)
          callbacks.send('tool', { name: currentToolBlock.name, input: toolInput, display: msg, ...lobeData })
          currentToolBlock = null
        }
      }

      // ── TOOL USE (direct, non-streaming) ───────────────
      else if (et === 'tool_use') {
        const toolName = event.tool?.name || event.name || 'tool'
        const toolInput = event.tool?.input || event.input || {}
        const msg = formatToolMsg(toolName, toolInput as Record<string, unknown>)
        callbacks.send('tool', { name: toolName, input: toolInput, display: msg, ...lobeData })
      }

      // ── TOOL RESULT ────────────────────────────────────
      else if (et === 'tool_result') {
        const toolName = event.tool_name || event.name || 'tool'
        const result = event.result || event.content || event.output || ''
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
        const preview = resultStr.substring(0, 200).replace(/\n/g, ' ')
        const isError = event.is_error === true
        callbacks.send('tool_result', { name: toolName, preview, isError, length: resultStr.length, ...lobeData })
      }

      // ── RESULT: final metadata ─────────────────────────
      else if (et === 'result') {
        callbacks.onResult?.(event)
        callbacks.send('result', {
          cost_usd: event.cost_usd ?? event.total_cost_usd,
          total_input_tokens: event.total_input_tokens,
          total_output_tokens: event.total_output_tokens,
          duration_ms: event.duration_ms,
          ...lobeData,
        })
      }

      // ── ERROR ──────────────────────────────────────────
      else if (et === 'error') {
        const errorMsg = event.error?.message || event.message || JSON.stringify(event)
        callbacks.send('error', { content: errorMsg, ...lobeData })
      }

      // Skip: assistant, message, message_start/delta/stop, ping, system, user
    } catch {
      if (line.trim().length > 0 && line.trim().length < 300) {
        callbacks.send('stderr', { content: line.trim(), ...lobeData })
      }
    }
  }

  return {
    feed(chunk: string) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    },
    flush() {
      if (buffer.trim()) processLine(buffer)
      buffer = ''
    },
  }
}

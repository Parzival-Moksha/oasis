import {
  type TokenUsagePayload,
  extractClaudeTokenUsage,
} from '@/lib/token-usage'

export function formatToolMsg(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Read' && toolInput.file_path) return `Read: ${toolInput.file_path}`
  if (toolName === 'Edit' && toolInput.file_path) return `Edit: ${toolInput.file_path}`
  if (toolName === 'Write' && toolInput.file_path) return `Write: ${toolInput.file_path}`
  if (toolName === 'Bash' && toolInput.command) {
    const command = String(toolInput.command).substring(0, 100)
    return `Bash: ${command}${String(toolInput.command).length > 100 ? '...' : ''}`
  }
  if (toolName === 'Grep' && toolInput.pattern) return `Grep: "${toolInput.pattern}" in ${toolInput.path || '.'}`
  if (toolName === 'Glob' && toolInput.pattern) return `Glob: ${toolInput.pattern}`
  if (toolName === 'TodoWrite') return 'TodoWrite: updating tasks'
  if (Object.keys(toolInput).length > 0) {
    const preview = JSON.stringify(toolInput).substring(0, 80)
    return `${toolName}: ${preview}${JSON.stringify(toolInput).length > 80 ? '...' : ''}`
  }
  return toolName
}

export interface StreamParserResultEvent extends TokenUsagePayload {
  durationMs?: number
}

export interface StreamParserCallbacks {
  send: (type: string, data: Record<string, unknown>) => void
  onText?: (text: string) => void
  onResult?: (event: StreamParserResultEvent) => void
}

export interface StreamParserOptions {
  lobe?: string
  provider?: string
  model?: string
}

export function createStreamParser(
  callbacks: StreamParserCallbacks,
  options?: string | StreamParserOptions,
) {
  const resolvedOptions = typeof options === 'string' ? { lobe: options } : (options || {})
  const lobeData = resolvedOptions.lobe ? { lobe: resolvedOptions.lobe } : {}

  let buffer = ''
  let capturedSessionId = ''
  let currentToolBlock: { name: string; inputJson: string; id?: string } | null = null

  const defaultProvider = resolvedOptions.provider || 'anthropic'
  const defaultModel = resolvedOptions.model || 'unknown'

  function sendTokenUsage(type: 'progress' | 'result', usage: TokenUsagePayload, extra?: Record<string, unknown>) {
    callbacks.send(type, {
      ...usage,
      ...(extra || {}),
      ...lobeData,
    })
  }

  function processLine(line: string) {
    if (!line.trim()) return

    try {
      let event = JSON.parse(line) as Record<string, unknown>
      if (event.type === 'stream_event' && event.event && typeof event.event === 'object') {
        event = event.event as Record<string, unknown>
      }

      const eventType = typeof event.type === 'string' ? event.type : 'unknown'

      if (eventType === 'system') {
        if (event.subtype === 'init' && typeof event.session_id === 'string' && event.session_id.trim()) {
          capturedSessionId = event.session_id.trim()
          callbacks.send('session', { sessionId: capturedSessionId, ...lobeData })
        }
        return
      }

      if (eventType === 'content_block_delta') {
        const delta = event.delta && typeof event.delta === 'object'
          ? event.delta as Record<string, unknown>
          : null
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          callbacks.onText?.(delta.text)
          callbacks.send('text', { content: delta.text, ...lobeData })
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          callbacks.send('thinking', { content: delta.thinking, ...lobeData })
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && currentToolBlock) {
          currentToolBlock.inputJson += delta.partial_json
        }
        return
      }

      if (eventType === 'content_block_start') {
        const contentBlock = event.content_block && typeof event.content_block === 'object'
          ? event.content_block as Record<string, unknown>
          : null
        const blockType = contentBlock?.type
        if (blockType === 'tool_use') {
          const toolName = typeof contentBlock?.name === 'string' ? contentBlock.name : 'tool'
          const toolId = typeof contentBlock?.id === 'string' ? contentBlock.id : undefined
          currentToolBlock = { name: toolName, inputJson: '', id: toolId }
          callbacks.send('tool_start', { name: toolName, ...(toolId ? { id: toolId } : {}), ...lobeData })
        } else if (blockType === 'text') {
          currentToolBlock = null
        }
        return
      }

      if (eventType === 'content_block_stop') {
        if (!currentToolBlock) return
        let toolInput: Record<string, unknown> = {}
        if (currentToolBlock.inputJson.trim()) {
          try {
            toolInput = JSON.parse(currentToolBlock.inputJson) as Record<string, unknown>
          } catch {
            toolInput = {}
          }
        }
        callbacks.send('tool', {
          name: currentToolBlock.name,
          input: toolInput,
          display: formatToolMsg(currentToolBlock.name, toolInput),
          ...(currentToolBlock.id ? { id: currentToolBlock.id } : {}),
          ...lobeData,
        })
        currentToolBlock = null
        return
      }

      if (eventType === 'tool_use') {
        const tool = event.tool && typeof event.tool === 'object'
          ? event.tool as Record<string, unknown>
          : null
        const toolName = typeof tool?.name === 'string'
          ? tool.name
          : typeof event.name === 'string'
            ? event.name
            : 'tool'
        const toolInput = tool?.input && typeof tool.input === 'object'
          ? tool.input as Record<string, unknown>
          : event.input && typeof event.input === 'object'
            ? event.input as Record<string, unknown>
            : {}
        callbacks.send('tool', {
          name: toolName,
          input: toolInput,
          display: formatToolMsg(toolName, toolInput),
          ...lobeData,
        })
        return
      }

      if (eventType === 'tool_result') {
        const toolName = typeof event.tool_name === 'string'
          ? event.tool_name
          : typeof event.name === 'string'
            ? event.name
            : 'tool'
        const toolUseId = typeof event.tool_use_id === 'string'
          ? event.tool_use_id
          : typeof event.id === 'string'
            ? event.id
            : undefined
        const rawResult = event.result ?? event.content ?? event.output ?? ''
        const resultText = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult)
        const fullResult = resultText.length <= 32000 ? resultText : undefined
        callbacks.send('tool_result', {
          name: toolName,
          preview: resultText.substring(0, 200).replace(/\n/g, ' '),
          isError: event.is_error === true,
          length: resultText.length,
          ...(fullResult ? { fullResult } : {}),
          ...(toolUseId ? { toolUseId } : {}),
          ...lobeData,
        })
        return
      }

      if (eventType === 'assistant') {
        const message = event.message && typeof event.message === 'object'
          ? event.message as Record<string, unknown>
          : null
        const usage = message?.usage && typeof message.usage === 'object'
          ? extractClaudeTokenUsage({
              usage: message.usage as Record<string, unknown>,
              session_id: capturedSessionId,
            }, {
              sessionId: capturedSessionId,
              provider: defaultProvider,
              model: defaultModel,
            })
          : null
        if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cachedInputTokens)) {
          sendTokenUsage('progress', usage)
        }

        const content = Array.isArray(message?.content) ? message.content as Array<Record<string, unknown>> : []
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            callbacks.onText?.(block.text)
            callbacks.send('text', { content: block.text, ...lobeData })
          } else if (block.type === 'tool_use') {
            const toolName = typeof block.name === 'string' ? block.name : 'tool'
            const toolInput = block.input && typeof block.input === 'object'
              ? block.input as Record<string, unknown>
              : {}
            callbacks.send('tool', {
              name: toolName,
              input: toolInput,
              display: formatToolMsg(toolName, toolInput),
              ...(typeof block.id === 'string' ? { id: block.id } : {}),
              ...lobeData,
            })
          } else if (block.type === 'tool_result') {
            const resultText = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '')
            const fullResult = resultText.length <= 32000 ? resultText : undefined
            callbacks.send('tool_result', {
              name: typeof block.tool_name === 'string' ? block.tool_name : 'tool',
              preview: resultText.slice(0, 200),
              isError: block.is_error === true,
              length: resultText.length,
              ...(fullResult ? { fullResult } : {}),
              ...(typeof block.tool_use_id === 'string' ? { toolUseId: block.tool_use_id } : {}),
              ...lobeData,
            })
          }
        }
        return
      }

      if (eventType === 'user') {
        const toolUseResults = Array.isArray(event.tool_use_result) ? event.tool_use_result : []
        for (const result of toolUseResults) {
          const resultRecord = result && typeof result === 'object' ? result as Record<string, unknown> : {}
          const rawText = resultRecord.text ?? resultRecord.content ?? ''
          const resultText = typeof rawText === 'string' ? rawText : JSON.stringify(rawText)
          const fullResult = resultText.length <= 32000 ? resultText : undefined
          callbacks.send('tool_result', {
            name: 'tool',
            preview: resultText.slice(0, 300).replace(/\n/g, ' '),
            isError: false,
            length: resultText.length,
            ...(fullResult ? { fullResult } : {}),
            toolUseId: Array.isArray((event.message as Record<string, unknown> | undefined)?.content)
              ? ((event.message as Record<string, unknown>).content as Array<Record<string, unknown>>)[0]?.tool_use_id as string | undefined
              : undefined,
            ...lobeData,
          })
        }

        const message = event.message && typeof event.message === 'object'
          ? event.message as Record<string, unknown>
          : null
        const content = Array.isArray(message?.content) ? message.content as Array<Record<string, unknown>> : []
        for (const block of content) {
          if (block.type !== 'tool_result' || !block.content) continue
          const textItems = Array.isArray(block.content) ? block.content : [block.content]
          for (const item of textItems) {
            const text = typeof item === 'string'
              ? item
              : typeof item === 'object' && item && typeof (item as Record<string, unknown>).text === 'string'
                ? (item as Record<string, unknown>).text as string
                : JSON.stringify(item)
            const fullResult = text.length <= 32000 ? text : undefined
            callbacks.send('tool_result', {
              name: 'tool',
              preview: text.slice(0, 300).replace(/\n/g, ' '),
              isError: block.is_error === true,
              length: text.length,
              ...(fullResult ? { fullResult } : {}),
              ...(typeof block.tool_use_id === 'string' ? { toolUseId: block.tool_use_id } : {}),
              ...lobeData,
            })
          }
        }
        return
      }

      if (eventType === 'result') {
        const usage = extractClaudeTokenUsage(event, {
          sessionId: capturedSessionId,
          provider: defaultProvider,
          model: defaultModel,
        })
        const resultEvent: StreamParserResultEvent = {
          ...usage,
          ...(typeof event.duration_ms === 'number' ? { durationMs: event.duration_ms } : {}),
        }
        callbacks.onResult?.(resultEvent)
        sendTokenUsage('result', usage, typeof event.duration_ms === 'number' ? { durationMs: event.duration_ms } : undefined)
        return
      }

      if (eventType === 'error') {
        const errorContent = event.error && typeof event.error === 'object'
          ? (event.error as Record<string, unknown>).message
          : event.message
        callbacks.send('error', {
          content: typeof errorContent === 'string' ? errorContent : JSON.stringify(event),
          ...lobeData,
        })
        return
      }
    } catch {
      const trimmed = line.trim()
      if (trimmed.length > 0 && trimmed.length < 300) {
        callbacks.send('stderr', { content: trimmed, ...lobeData })
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

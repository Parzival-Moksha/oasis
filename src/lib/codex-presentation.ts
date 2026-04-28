export interface CodexToolPresentation {
  name: string
  icon: string
  display: string
}

type CodexToolDescriptorInput = {
  type?: string
  command?: string
  serverName?: string
  toolName?: string
  title?: string
  summary?: string
  name?: string
  query?: string
  path?: string
}

const DEFAULT_ICON = '🔧'

function titleCaseWord(word: string): string {
  if (!word) return ''
  if (word.length <= 3 && word === word.toUpperCase()) return word
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateInline(value: string, maxLength = 96): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function extractQuotedValue(source: string, key: string): string {
  const assignment = new RegExp(`${key}\\s*=\\s*['"]([^'"]+)['"]`, 'i')
  const json = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i')
  return source.match(assignment)?.[1] || source.match(json)?.[1] || ''
}

function stripLocalOrigin(value: string): string {
  const normalized = value.trim()
  if (!normalized) return normalized
  if (normalized.startsWith('/')) return normalized

  try {
    return new URL(normalized).pathname || normalized
  } catch {
    return normalized
  }
}

function detectOasisApiPath(command: string): string {
  const directMatch = command.match(/https?:\/\/(?:127\.0\.0\.1|localhost):4516(\/api\/[A-Za-z0-9/_-]+)/i)
  if (directMatch?.[1]) return directMatch[1]

  const relativeMatch = command.match(/(\/api\/(?:media|mcp)\/[A-Za-z0-9/_-]+)/i)
  return relativeMatch?.[1] || ''
}

function summarizeShellSnippet(command: string): string {
  const normalized = collapseWhitespace(command)
    .replace(/^"[^"]*\\(?:powershell|pwsh)(?:\.exe)?"\s+-Command\s+/i, '')
    .replace(/^(?:powershell|pwsh)(?:\.exe)?\s+-Command\s+/i, '')
    .replace(/^(?:cmd(?:\.exe)?)\s+\/c\s+/i, '')
    .replace(/^"[^"]*\\(?:bash|sh)"\s+-lc\s+/i, '')
    .replace(/^(?:bash|sh)\s+-lc\s+/i, '')
    .replace(/^(?:node(?:\.exe)?)\s+-e\s+/i, '')

  return truncateInline(normalized || collapseWhitespace(command))
}

function classifyCommandExecution(command: string): CodexToolPresentation {
  const apiPath = stripLocalOrigin(detectOasisApiPath(command))
  const model = extractQuotedValue(command, 'model')

  if (apiPath.startsWith('/api/media/image')) {
    return {
      name: 'Generate Image',
      icon: '🎨',
      display: model ? `${apiPath} · ${model}` : apiPath,
    }
  }

  if (apiPath.startsWith('/api/media/voice')) {
    return {
      name: 'Generate Voice',
      icon: '🔊',
      display: model ? `${apiPath} · ${model}` : apiPath,
    }
  }

  if (apiPath.startsWith('/api/media/video')) {
    return {
      name: 'Generate Video',
      icon: '🎬',
      display: model ? `${apiPath} · ${model}` : apiPath,
    }
  }

  if (apiPath.startsWith('/api/mcp/oasis')) {
    return {
      name: 'Oasis HTTP',
      icon: '🌐',
      display: apiPath,
    }
  }

  const shellKind = /(?:powershell|pwsh)(?:\.exe)?/i.test(command)
    ? 'PowerShell'
    : /\bcmd(?:\.exe)?\b/i.test(command)
      ? 'cmd'
      : /\bnode(?:\.exe)?\b/i.test(command)
        ? 'Node'
        : /\bcurl\b/i.test(command)
          ? 'curl'
          : 'Shell'

  return {
    name: 'Shell',
    icon: '⚡',
    display: `${shellKind}: ${summarizeShellSnippet(command)}`,
  }
}

function classifyMcpTool(serverName: string, toolName: string): CodexToolPresentation {
  if (serverName === 'oasis' && toolName === 'generate_image') {
    return {
      name: 'Generate Image',
      icon: '🎨',
      display: `${serverName}.${toolName}`,
    }
  }

  if (serverName === 'oasis' && toolName === 'generate_voice') {
    return {
      name: 'Generate Voice',
      icon: '🔊',
      display: `${serverName}.${toolName}`,
    }
  }

  if (serverName === 'oasis' && toolName === 'generate_video') {
    return {
      name: 'Generate Video',
      icon: '🎬',
      display: `${serverName}.${toolName}`,
    }
  }

  if (serverName && toolName) {
    return {
      name: humanizeCodexItemType(toolName),
      icon: '🧩',
      display: `${serverName}.${toolName}`,
    }
  }

  if (toolName) {
    return {
      name: humanizeCodexItemType(toolName),
      icon: '🧩',
      display: toolName,
    }
  }

  return {
    name: 'MCP Tool',
    icon: '🧩',
    display: serverName || 'mcp tool call',
  }
}

export function humanizeCodexItemType(type: string): string {
  return type
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ')
}

export function describeCodexTool(input: CodexToolDescriptorInput): CodexToolPresentation {
  const type = (input.type || '').trim()

  switch (type) {
    case 'command_execution':
      return classifyCommandExecution(input.command || '')
    case 'mcp_tool_call':
      return classifyMcpTool((input.serverName || '').trim(), (input.toolName || '').trim())
    case 'web_search':
      return {
        name: 'Web Search',
        icon: '🔎',
        display: input.query || 'web search',
      }
    case 'file_change':
      return {
        name: 'File Change',
        icon: '📝',
        display: input.path || input.summary || 'file change',
      }
    case 'plan_update':
      return {
        name: 'Plan Update',
        icon: '🗺️',
        display: input.title || input.summary || 'plan update',
      }
    default: {
      const label = humanizeCodexItemType(type || input.name || 'tool')
      return {
        name: label,
        icon: DEFAULT_ICON,
        display: input.title || input.summary || input.name || label,
      }
    }
  }
}

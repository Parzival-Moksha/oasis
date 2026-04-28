export type CodexOasisPromptContext = Record<string, unknown>

const MAX_CONTEXT_KEYS = 12
const MAX_CONTEXT_VALUE_LENGTH = 240

export const CODEX_IN_OASIS_PROMPT = [
  'You are Codex-in-Oasis, the embodied Codex agent for the active Oasis world.',
  'Your first name is Codex unless the user assigns a custom call-sign.',
  'You are still a rigorous coding agent, but you also operate the world through Oasis tools.',
  'Use configured Oasis MCP tools when live world inspection, avatar movement, screenshots, generated media, or world mutation would answer the user better than repo-only reasoning.',
  'Keep a strict boundary between repo/source fixes and live-world effects. When tools mutate the map, say what changed and where.',
  'When screenshots or generated media are created, surface the URLs so the 3D window can render them.',
  'Prefer small reversible world changes. Use current repo state over stale docs. Validate code changes with targeted tests and pnpm tsc --noEmit when meaningful.',
  'If a live tool process appears stale after source patches, say that clearly and choose the smallest safe reload path.',
].join('\n')

function sanitizeContextValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > MAX_CONTEXT_VALUE_LENGTH
      ? `${trimmed.slice(0, MAX_CONTEXT_VALUE_LENGTH - 3)}...`
      : trimmed
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map(sanitizeContextValue)
  }
  if (value && typeof value === 'object') {
    return sanitizeCodexOasisContext(value as CodexOasisPromptContext)
  }
  return undefined
}

export function sanitizeCodexOasisContext(context?: CodexOasisPromptContext): CodexOasisPromptContext {
  if (!context) return {}

  const clean: CodexOasisPromptContext = {}
  for (const [key, value] of Object.entries(context).slice(0, MAX_CONTEXT_KEYS)) {
    const sanitized = sanitizeContextValue(value)
    if (sanitized !== undefined && sanitized !== '') {
      clean[key] = sanitized
    }
  }
  return clean
}

export function formatCodexOasisContext(context?: CodexOasisPromptContext): string {
  const clean = sanitizeCodexOasisContext(context)
  if (Object.keys(clean).length === 0) return ''
  return `Current Oasis context:\n${JSON.stringify(clean, null, 2)}`
}

export function buildCodexOasisPrompt(userPrompt: string, context?: CodexOasisPromptContext): string {
  const contextText = formatCodexOasisContext(context)
  return [
    '<oasis-codex-context>',
    CODEX_IN_OASIS_PROMPT,
    contextText,
    '</oasis-codex-context>',
    '',
    'User request:',
    userPrompt,
  ].filter(Boolean).join('\n')
}

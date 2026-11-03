// What the owner reviews before approving a tool call. Pure helpers for the decision cards.
//
// Security rule (review 2026-11-03, item 1): an approval must never sit next to a clipped command.
// The panel shows the whole input; the small desk card shows no approve buttons at all.

/** The engine marks clipped strings with "… [+N chars]" (normalize.js clip()). */
const CLIP_MARKER = /… \[\+(\d+) chars\]/g

/** Everything the tool will receive, as the owner should read it. Never shortened here. */
export function permissionReviewText(toolName: string, input: unknown): string {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const parts: string[] = []
  if (typeof value.command === 'string') parts.push(value.command)
  if (typeof value.file_path === 'string') parts.push(`file: ${value.file_path}`)
  if (typeof value.notebook_path === 'string') parts.push(`notebook: ${value.notebook_path}`)
  if (typeof value.url === 'string') parts.push(`url: ${value.url}`)
  if (typeof value.old_string === 'string') parts.push(`replace:\n${value.old_string}`)
  if (typeof value.new_string === 'string') parts.push(`with:\n${value.new_string}`)
  if (typeof value.content === 'string') parts.push(`content:\n${value.content}`)
  const shown = new Set(['command', 'file_path', 'notebook_path', 'url', 'old_string', 'new_string', 'content'])
  const rest = Object.fromEntries(Object.entries(value).filter(([key]) => !shown.has(key)))
  if (Object.keys(rest).length || !parts.length) {
    let json = ''
    try { json = JSON.stringify(parts.length ? rest : input, null, 2) } catch { json = String(input) }
    if (json && json !== '{}') parts.push(parts.length ? `other input:\n${json}` : json)
  }
  return parts.join('\n\n') || `${toolName} (no input)`
}

/** Characters the engine left out of this input (0 = nothing hidden). */
export function clippedCharacters(input: unknown): number {
  let total = 0
  const visit = (value: unknown, depth: number) => {
    if (depth > 8) return
    if (typeof value === 'string') {
      for (const match of value.matchAll(CLIP_MARKER)) total += Number(match[1]) || 0
    } else if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(item => visit(item, depth + 1))
    }
  }
  visit(input, 0)
  return total
}

interface PermissionRule { toolName?: string; ruleContent?: string }

/** One "allow always" suggestion from the CLI, in words. */
export function describeSuggestion(suggestion: unknown): string {
  const s = (suggestion && typeof suggestion === 'object' ? suggestion : {}) as Record<string, unknown>
  const where = typeof s.destination === 'string' ? ` (${s.destination})` : ''
  switch (s.type) {
    case 'setMode':
      return `switch to "${String(s.mode)}" mode${where}`
    case 'addRules':
    case 'replaceRules': {
      const rules = Array.isArray(s.rules) ? (s.rules as PermissionRule[]) : []
      const list = rules.map(rule => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : String(rule.toolName))).join(', ')
      return `${String(s.behavior || 'allow')} ${list || 'rules'}${where}`
    }
    case 'addDirectories': {
      const dirs = Array.isArray(s.directories) ? s.directories.map(String).join(', ') : ''
      return `allow access to ${dirs || 'more folders'}${where}`
    }
    default: {
      try { return JSON.stringify(suggestion) } catch { return String(suggestion) }
    }
  }
}

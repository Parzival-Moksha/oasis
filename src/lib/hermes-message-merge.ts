export interface HermesToolCallLike {
  index: number
  id?: string
  name: string
  arguments: string
}

export interface HermesUsageLike {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface HermesChatMessageLike {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  tools?: HermesToolCallLike[]
  usage?: HermesUsageLike
  finishReason?: string
  error?: string
  timestamp: number
}

function mergeHermesToolCalls(
  primary: HermesToolCallLike[] | undefined,
  secondary: HermesToolCallLike[] | undefined,
): HermesToolCallLike[] | undefined {
  const merged = [...(primary || []), ...(secondary || [])]
  if (merged.length === 0) return undefined

  const seen = new Set<string>()
  const unique: HermesToolCallLike[] = []

  for (const tool of merged) {
    const signature = JSON.stringify({
      index: tool.index,
      id: tool.id || '',
      name: tool.name,
      arguments: normalizeMessageText(tool.arguments),
    })
    if (seen.has(signature)) continue
    seen.add(signature)
    unique.push(tool)
  }

  return unique
}

function normalizeMessageText(value: string | undefined): string {
  return typeof value === 'string'
    ? value
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .join('\n')
        .trim()
    : ''
}

function pushUniqueLine(target: string[], seen: Set<string>, line: string) {
  const trimmed = line.trim()
  if (!trimmed) {
    if (target.length > 0 && target[target.length - 1] !== '') {
      target.push('')
    }
    return
  }

  if (seen.has(trimmed)) return
  seen.add(trimmed)
  target.push(line)
}

export function mergeHermesTextBlocks(primary: string, secondary: string): string {
  const left = typeof primary === 'string' ? primary : ''
  const right = typeof secondary === 'string' ? secondary : ''

  if (!left) return right.trim()
  if (!right) return left.trim()
  if (left === right) return left.trim()
  if (left.includes(right)) return left.trim()
  if (right.includes(left)) return right.trim()

  const merged: string[] = []
  const seen = new Set<string>()

  for (const line of left.split(/\r?\n/)) {
    pushUniqueLine(merged, seen, line)
  }
  for (const line of right.split(/\r?\n/)) {
    pushUniqueLine(merged, seen, line)
  }

  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function mergeHydratedHermesMessages<T extends HermesChatMessageLike>(hydrated: T[], cached: T[]): T[] {
  if (!cached.length) return collapseDuplicateHermesMessages(hydrated)
  if (!hydrated.length) return collapseDuplicateHermesMessages(cached)

  const roleQueues = {
    user: cached.filter(message => message.role === 'user'),
    assistant: cached.filter(message => message.role === 'assistant'),
  }
  const roleCursor = { user: 0, assistant: 0 }
  const consumedCacheIds = new Set<string>()

  const merged = hydrated.map(message => {
    const queue = roleQueues[message.role]
    const cursor = roleCursor[message.role]
    const cachedMatch = queue[cursor]

    if (!cachedMatch) {
      return message
    }

    roleCursor[message.role] += 1
    consumedCacheIds.add(cachedMatch.id)

    const mergedReasoning = mergeHermesTextBlocks(cachedMatch.reasoning || '', message.reasoning || '')
    const mergedContent = mergeHermesTextBlocks(cachedMatch.content, message.content)

    return {
      ...message,
      id: cachedMatch.id || message.id,
      content: mergedContent,
      reasoning: mergedReasoning || undefined,
      tools: mergeHermesToolCalls(cachedMatch.tools, message.tools),
      usage: cachedMatch.usage || message.usage,
      finishReason: message.finishReason || cachedMatch.finishReason,
      error: message.error || cachedMatch.error,
      timestamp: typeof message.timestamp === 'number' ? message.timestamp : cachedMatch.timestamp,
    }
  })

  for (const cachedMessage of cached) {
    if (consumedCacheIds.has(cachedMessage.id)) continue
    merged.push(cachedMessage)
  }

  return collapseDuplicateHermesMessages(merged)
}

function countRole(messages: HermesChatMessageLike[], role: 'user' | 'assistant'): number {
  return messages.reduce((count, message) => count + (message.role === role ? 1 : 0), 0)
}

function countToolCalls(messages: HermesChatMessageLike[]): number {
  return messages.reduce((count, message) => count + (message.tools?.length || 0), 0)
}

function countDuplicateAssistantLines(messages: HermesChatMessageLike[]): number {
  let duplicates = 0

  for (const message of messages) {
    if (message.role !== 'assistant') continue

    const counts = new Map<string, number>()
    for (const line of normalizeMessageText(message.content).split(/\r?\n/)) {
      const normalized = line.trim().toLowerCase()
      if (!normalized) continue
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    }

    for (const count of counts.values()) {
      if (count > 1) duplicates += count - 1
    }
  }

  return duplicates
}

export function shouldPreferHydratedHermesMessages(
  hydrated: HermesChatMessageLike[],
  cached: HermesChatMessageLike[],
): boolean {
  if (!hydrated.length) return false
  if (!cached.length) return true

  const hydratedUserCount = countRole(hydrated, 'user')
  const cachedUserCount = countRole(cached, 'user')
  const hydratedAssistantCount = countRole(hydrated, 'assistant')
  const cachedAssistantCount = countRole(cached, 'assistant')
  const hydratedToolCount = countToolCalls(hydrated)
  const cachedToolCount = countToolCalls(cached)
  const hydratedDuplicateLines = countDuplicateAssistantLines(hydrated)
  const cachedDuplicateLines = countDuplicateAssistantLines(cached)

  if (hydratedUserCount < cachedUserCount) {
    return false
  }

  if (hydratedAssistantCount > cachedAssistantCount && hydratedToolCount >= cachedToolCount) {
    return true
  }

  if (hydrated.length > cached.length && hydratedToolCount > cachedToolCount) {
    return true
  }

  if (
    hydratedDuplicateLines < cachedDuplicateLines
    && hydratedAssistantCount >= cachedAssistantCount
    && hydratedToolCount >= cachedToolCount
  ) {
    return true
  }

  return false
}

export function collapseConsecutiveHermesAssistantTurns<T extends HermesChatMessageLike>(messages: T[]): T[] {
  const collapsed: T[] = []

  for (const message of messages) {
    const prev = collapsed[collapsed.length - 1]
    if (!prev || prev.role !== 'assistant' || message.role !== 'assistant') {
      collapsed.push(message)
      continue
    }

    collapsed[collapsed.length - 1] = {
      ...prev,
      id: prev.id || message.id,
      content: mergeHermesTextBlocks(prev.content, message.content),
      reasoning: mergeHermesTextBlocks(prev.reasoning || '', message.reasoning || '') || undefined,
      tools: mergeHermesToolCalls(prev.tools, message.tools),
      usage: message.usage || prev.usage,
      finishReason: message.finishReason || prev.finishReason,
      error: message.error || prev.error,
      timestamp: Math.min(prev.timestamp, message.timestamp),
    }
  }

  return collapsed
}

function toolsSignature(message: HermesChatMessageLike): string {
  const normalizedTools = (message.tools || []).map(tool => ({
    index: tool.index,
    id: tool.id || '',
    name: tool.name,
    arguments: normalizeMessageText(tool.arguments),
  }))
  return normalizedTools.length ? JSON.stringify(normalizedTools) : ''
}

function normalizedTextContains(haystack: string | undefined, needle: string | undefined): boolean {
  const left = normalizeMessageText(haystack)
  const right = normalizeMessageText(needle)
  if (!left || !right) return false
  return left.includes(right)
}

function assistantMessagesShouldCollapse(left: HermesChatMessageLike, right: HermesChatMessageLike): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false

  const overlappingContent = (
    normalizedTextContains(left.content, right.content) ||
    normalizedTextContains(right.content, left.content)
  )
  const overlappingReasoning = (
    normalizedTextContains(left.reasoning, right.reasoning) ||
    normalizedTextContains(right.reasoning, left.reasoning)
  )

  if (!overlappingContent && !overlappingReasoning) return false

  const leftTools = toolsSignature(left)
  const rightTools = toolsSignature(right)
  if (leftTools && rightTools && leftTools !== rightTools) return false

  return true
}

function messagesLookEquivalent(left: HermesChatMessageLike, right: HermesChatMessageLike): boolean {
  if (left.role !== right.role) return false
  if (normalizeMessageText(left.content) !== normalizeMessageText(right.content)) return false
  if (normalizeMessageText(left.reasoning) !== normalizeMessageText(right.reasoning)) return false
  if (toolsSignature(left) !== toolsSignature(right)) return false
  return (left.finishReason || '') === (right.finishReason || '')
}

export function collapseDuplicateHermesMessages<T extends HermesChatMessageLike>(messages: T[]): T[] {
  const collapsed: T[] = []

  for (const message of messages) {
    const prev = collapsed[collapsed.length - 1]
    if (!prev) {
      collapsed.push(message)
      continue
    }

    if (!messagesLookEquivalent(prev, message) && !assistantMessagesShouldCollapse(prev, message)) {
      collapsed.push(message)
      continue
    }

    collapsed[collapsed.length - 1] = {
      ...prev,
      id: prev.id || message.id,
      content: mergeHermesTextBlocks(prev.content, message.content),
      reasoning: mergeHermesTextBlocks(prev.reasoning || '', message.reasoning || '') || undefined,
      tools: mergeHermesToolCalls(prev.tools, message.tools),
      usage: message.usage || prev.usage,
      finishReason: message.finishReason || prev.finishReason,
      error: message.error || prev.error,
      timestamp: Math.min(prev.timestamp, message.timestamp),
    }
  }

  return collapsed
}

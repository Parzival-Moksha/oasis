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
      tools: cachedMatch.tools || message.tools,
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
      tools: (prev.tools?.length || 0) >= (message.tools?.length || 0) ? prev.tools : message.tools,
      usage: message.usage || prev.usage,
      finishReason: message.finishReason || prev.finishReason,
      error: message.error || prev.error,
      timestamp: Math.min(prev.timestamp, message.timestamp),
    }
  }

  return collapsed
}

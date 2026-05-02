function asRecord(value) {
  return value && typeof value === 'object' ? value : {}
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringField(record, ...keys) {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function compact(value) {
  return cleanString(value).replace(/\s+/g, ' ').trim().toLowerCase()
}

function stripGatewayMetadata(text) {
  return cleanString(text)
    .replace(/^Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/m, '')
    .replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2}[^\]]*\]\s*/, '')
    .replace(/^\[[^\]]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractTextFromGatewayContent(content) {
  if (typeof content === 'string') return stripGatewayMetadata(content)
  if (!Array.isArray(content)) return ''

  return stripGatewayMetadata(content.map(block => {
    if (typeof block === 'string') return block
    const record = asRecord(block)
    const type = stringField(record, 'type')
    if (type && !['text', 'output_text'].includes(type)) return ''
    return stringField(record, 'text', 'content')
  }).filter(Boolean).join('\n'))
}

function normalizeHistoryEntry(raw, index) {
  const record = asRecord(raw)
  const entry = stringField(record, 'type') === 'message'
    ? { ...asRecord(record.message), id: record.id, timestamp: record.timestamp ?? asRecord(record.message).timestamp }
    : record
  return {
    index,
    role: stringField(entry, 'role').toLowerCase(),
    text: extractTextFromGatewayContent(entry.content),
    timestamp: timestampMs(entry.timestamp ?? entry.createdAt ?? entry.updatedAt),
  }
}

export function extractAssistantReplyFromHistory(historyPayload, {
  userMessage = '',
  startedAtMs = 0,
} = {}) {
  const messages = Array.isArray(historyPayload?.messages) ? historyPayload.messages : []
  const entries = messages
    .map((entry, index) => normalizeHistoryEntry(entry, index))
    .filter(entry => entry.role && entry.text)

  const normalizedUserMessage = compact(userMessage)
  const notBefore = Number.isFinite(startedAtMs) && startedAtMs > 0 ? startedAtMs - 5_000 : 0

  let userIndex = -1
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.role !== 'user') continue
    if (notBefore && entry.timestamp && entry.timestamp < notBefore) continue
    const normalizedEntry = compact(entry.text)
    if (!normalizedUserMessage || normalizedEntry.includes(normalizedUserMessage) || normalizedUserMessage.includes(normalizedEntry)) {
      userIndex = i
      break
    }
  }

  if (userIndex >= 0) {
    for (let i = userIndex + 1; i < entries.length; i += 1) {
      const entry = entries[i]
      if (entry.role === 'assistant' && entry.text) return entry.text
    }
  }

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.role !== 'assistant' || !entry.text) continue
    if (!notBefore || !entry.timestamp || entry.timestamp >= notBefore) return entry.text
  }

  return ''
}

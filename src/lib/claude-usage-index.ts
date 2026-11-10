// ░▒▓ CLAUDE USAGE INDEX — every token Claude Code spent on this machine, from its own transcripts ▓▒░
// ~/.claude/projects/**/*.jsonl (terminal, desktop app, the village's agents and their subagents) hold
// each reply's usage: fresh input, cache write, cache read and output tokens. One reply is written
// as several lines (one per content block) with the same message id and usage: counted once.
// Incremental: each file's byte offset and per-day totals are kept in prisma/data, so after the
// first pass (minutes for gigabytes) a refresh only reads what was appended since. Server-side only.

import { createReadStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TokenCounts {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

export const ZERO_COUNTS: TokenCounts = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }

/** Every token processed or produced, each counted once (cache reads are not also in "input"). */
export function totalTokens(c: TokenCounts): number {
  return c.input + c.cacheWrite + c.cacheRead + c.output
}

export function addCounts(a: TokenCounts, b: TokenCounts): TokenCounts {
  return { input: a.input + b.input, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead, output: a.output + b.output }
}

/** Local calendar day, YYYY-MM-DD. */
export function localDay(at: Date): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface UsageLine {
  id: string
  model: string
  day: string
  counts: TokenCounts
}

function n(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** One transcript line → the reply's usage, or null (not an assistant reply, no usage, all zero). */
export function parseUsageLine(line: string): UsageLine | null {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null
  let entry: { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, unknown> } }
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  if (entry.type !== 'assistant' || !entry.message?.usage) return null
  const usage = entry.message.usage
  const counts: TokenCounts = {
    input: n(usage.input_tokens),
    cacheWrite: n(usage.cache_creation_input_tokens),
    cacheRead: n(usage.cache_read_input_tokens),
    output: n(usage.output_tokens),
  }
  if (!totalTokens(counts)) return null
  const at = entry.timestamp ? new Date(entry.timestamp) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { id: entry.message.id || `${entry.timestamp}`, model: entry.message.model || 'unknown', day: localDay(at), counts }
}

// ─── the index ────────────────────────────────────────────────────────────────

interface FileState {
  size: number
  offset: number
  /** Message ids of the last replies read: a reply split across two refreshes is still counted once. */
  lastIds: string[]
  days: Record<string, TokenCounts>
  models: Record<string, TokenCounts>
}

interface UsageIndex {
  version: 1
  files: Record<string, FileState>
  scannedAt: number
}

const INDEX_VERSION = 1
const LAST_IDS = 64

export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

function indexPath(): string {
  return path.join(process.cwd(), 'prisma', 'data', 'claude-usage-index.json')
}

async function listTranscripts(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await listTranscripts(full, out)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

/** Apply the lines of one file from `state.offset` on; only whole lines (a line still being written waits). */
export function applyLines(state: FileState, text: string): number {
  const end = text.lastIndexOf('\n')
  if (end < 0) return 0
  const recent = new Set(state.lastIds)
  for (const line of text.slice(0, end).split('\n')) {
    const usage = parseUsageLine(line)
    if (!usage || recent.has(usage.id)) continue
    recent.add(usage.id)
    state.lastIds.push(usage.id)
    if (state.lastIds.length > LAST_IDS) state.lastIds.splice(0, state.lastIds.length - LAST_IDS)
    state.days[usage.day] = addCounts(state.days[usage.day] || ZERO_COUNTS, usage.counts)
    state.models[usage.model] = addCounts(state.models[usage.model] || ZERO_COUNTS, usage.counts)
  }
  return Buffer.byteLength(text.slice(0, end + 1), 'utf8')
}

async function readFrom(file: string, offset: number, onChunk: (text: string) => number): Promise<number> {
  // Chunks end mid-line: carry the tail over to the next chunk.
  let carry = ''
  let consumed = offset
  const stream = createReadStream(file, { start: offset, highWaterMark: 1 << 20, encoding: 'utf8' })
  for await (const chunk of stream) {
    const text = carry + chunk
    const used = onChunk(text)
    consumed += used
    carry = Buffer.from(text, 'utf8').subarray(used).toString('utf8')
    // Let the dev server breathe between megabytes.
    await new Promise(resolve => setImmediate(resolve))
  }
  return consumed
}

let current: UsageIndex | null = null
let scanning: Promise<UsageIndex> | null = null
let progress = { done: 0, total: 0 }

async function loadIndex(): Promise<UsageIndex> {
  if (current) return current
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath(), 'utf8')) as UsageIndex
    if (parsed.version === INDEX_VERSION && parsed.files) current = parsed
  } catch { /* first run */ }
  current ??= { version: INDEX_VERSION, files: {}, scannedAt: 0 }
  return current
}

async function saveIndex(index: UsageIndex): Promise<void> {
  try {
    await fs.mkdir(path.dirname(indexPath()), { recursive: true })
    await fs.writeFile(indexPath(), JSON.stringify(index))
  } catch { /* read-only disk: the next refresh rescans what changed */ }
}

/** Read what was appended since last time (one scan at a time). */
export function refreshUsageIndex(): Promise<UsageIndex> {
  if (scanning) return scanning
  scanning = (async () => {
    const index = await loadIndex()
    const files = await listTranscripts(projectsRoot())
    progress = { done: 0, total: files.length }
    const present = new Set(files)
    for (const known of Object.keys(index.files)) if (!present.has(known)) delete index.files[known]
    let sinceSave = 0
    for (const file of files) {
      progress.done += 1
      let size = 0
      try {
        size = (await fs.stat(file)).size
      } catch {
        continue
      }
      let state = index.files[file]
      // A file that shrank was rewritten: count it again from the start.
      if (!state || size < state.offset) state = index.files[file] = { size: 0, offset: 0, lastIds: [], days: {}, models: {} }
      if (size === state.offset) continue
      const target = state
      try {
        target.offset = await readFrom(file, target.offset, text => applyLines(target, text))
        target.size = size
      } catch { /* locked or vanished mid-read: next time */ }
      sinceSave += 1
      if (sinceSave >= 50) {
        sinceSave = 0
        await saveIndex(index)
      }
    }
    index.scannedAt = Date.now()
    await saveIndex(index)
    return index
  })().finally(() => { scanning = null })
  return scanning
}

export interface UsageSummary {
  today: TokenCounts
  week: TokenCounts
  allTime: TokenCounts
  byModel: Array<{ model: string; counts: TokenCounts }>
  firstDay: string | null
  scannedAt: number
  indexing: boolean
  progress: { done: number; total: number }
}

/** Totals for today, the last 7 days (today included) and all time. */
export function summarizeUsage(index: UsageIndex, now = new Date()): Omit<UsageSummary, 'indexing' | 'progress'> {
  const today = localDay(now)
  const weekStart = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  let t = ZERO_COUNTS
  let w = ZERO_COUNTS
  let all = ZERO_COUNTS
  let firstDay: string | null = null
  const models: Record<string, TokenCounts> = {}
  for (const state of Object.values(index.files)) {
    for (const [day, counts] of Object.entries(state.days)) {
      all = addCounts(all, counts)
      if (day >= weekStart && day <= today) w = addCounts(w, counts)
      if (day === today) t = addCounts(t, counts)
      if (!firstDay || day < firstDay) firstDay = day
    }
    for (const [model, counts] of Object.entries(state.models)) models[model] = addCounts(models[model] || ZERO_COUNTS, counts)
  }
  const byModel = Object.entries(models)
    .filter(([model]) => model !== '<synthetic>')
    .map(([model, counts]) => ({ model, counts }))
    .sort((a, b) => totalTokens(b.counts) - totalTokens(a.counts))
  return { today: t, week: w, allTime: all, byModel, firstDay, scannedAt: index.scannedAt }
}

/** Current totals; starts a refresh in the background when the last one is older than `maxAgeMs`. */
export async function getUsageSummary(maxAgeMs = 30_000): Promise<UsageSummary> {
  const index = await loadIndex()
  if (!scanning && Date.now() - index.scannedAt > maxAgeMs) void refreshUsageIndex()
  // A refresh of a few appended lines is quick: give it a moment so the numbers are current.
  if (scanning && index.scannedAt) await Promise.race([scanning, new Promise(resolve => setTimeout(resolve, 1500))])
  return { ...summarizeUsage(current || index), indexing: Boolean(scanning), progress: { ...progress } }
}

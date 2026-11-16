// ░▒▓ CLAUDE USAGE INDEX — every token Claude Code spent on this machine, from its own transcripts ▓▒░
// ~/.claude/projects/**/*.jsonl (terminal, desktop app, the village's agents and their subagents) hold
// each reply's usage: fresh input, cache write, cache read and output tokens. One reply is written
// as several lines (one per content block), and a resumed or forked session copies earlier replies
// into its own file: each reply (message id + request id) is counted once across all files.
// Incremental: each file's byte offset, per-day totals and the replies it counted are kept in
// prisma/data, so after the first pass (about a minute for gigabytes) a refresh only reads what was
// appended since. A transcript Claude Code deletes keeps its counts: all time never shrinks.
// Server-side only.

import { createReadStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { localDay as workDay } from './village/work-vow'

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

/**
 * The headline: what the models wrote (output, thinking included) plus fresh input. Cache reads are the
 * same context read again on every turn and would dwarf everything (tens of billions); cache writes are
 * input stored for reuse. Both are shown apart.
 */
export function headlineTokens(c: TokenCounts): number {
  return c.output + c.input
}

export function addCounts(a: TokenCounts, b: TokenCounts): TokenCounts {
  return { input: a.input + b.input, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead, output: a.output + b.output }
}

/** The day a reply belongs to: like the work counter, a day runs from 04:20 to 04:20 local (work-vow.ts). */
export function localDay(at: Date): string {
  return workDay(at.getTime())
}

/** Model families Anorak balances: Opus, Fable (Mythos with it), Sonnet, Haiku; anything else is other. */
export const MODEL_FAMILIES = ['opus', 'fable', 'sonnet', 'haiku', 'other'] as const
export type ModelFamily = typeof MODEL_FAMILIES[number]

export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('fable') || m.includes('mythos')) return 'fable'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return 'other'
}

export interface UsageLine {
  /** message id + request id: the same reply in another line or another file has the same key. */
  key: string
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
  let entry: { type?: string; timestamp?: string; requestId?: string; message?: { id?: string; model?: string; usage?: Record<string, unknown> } }
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
  return { key: `${entry.message.id || entry.timestamp}|${entry.requestId || ''}`, model: entry.message.model || 'unknown', day: localDay(at), counts }
}

// ─── the index ────────────────────────────────────────────────────────────────

export interface FileState {
  size: number
  offset: number
  /** Hashes of the replies this file counted (each reply is counted by the first file it was read from). */
  keys: string[]
  days: Record<string, TokenCounts>
  models: Record<string, TokenCounts>
  /** day -> model family -> [output, fresh input]: the daily charts. */
  families?: Record<string, Partial<Record<ModelFamily, [number, number]>>>
  /** Claude Code deleted the transcript: its counts stay. */
  gone?: boolean
}

export interface UsageIndex {
  version: 3
  files: Record<string, FileState>
  scannedAt: number
}

const INDEX_VERSION = 3

/** A reply's key as 16 hex digits (two 32-bit FNV-1a hashes): small enough to keep every reply's. */
export function hashKey(key: string): string {
  let a = 0x811c9dc5
  let b = 0x050c5d1f
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

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

/**
 * Apply the lines of one file from `state.offset` on; only whole lines (a line still being written waits).
 * `seen` holds every reply already counted, in any file.
 */
export function applyLines(state: FileState, text: string, seen: Set<string>): number {
  const end = text.lastIndexOf('\n')
  if (end < 0) return 0
  for (const line of text.slice(0, end).split('\n')) {
    const usage = parseUsageLine(line)
    if (!usage) continue
    const key = hashKey(usage.key)
    if (seen.has(key)) continue
    seen.add(key)
    state.keys.push(key)
    state.days[usage.day] = addCounts(state.days[usage.day] || ZERO_COUNTS, usage.counts)
    if (usage.model !== '<synthetic>') {
      const day = (state.families ||= {})[usage.day] ||= {}
      const family = modelFamily(usage.model)
      const [output, input] = day[family] || [0, 0]
      day[family] = [output + usage.counts.output, input + usage.counts.input]
    }
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
/** Every reply counted, in any file (rebuilt from the files' keys on load). */
let seenKeys = new Set<string>()
let scanning: Promise<UsageIndex> | null = null
let progress = { done: 0, total: 0 }

async function loadIndex(): Promise<UsageIndex> {
  if (current) return current
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath(), 'utf8')) as UsageIndex
    if (parsed.version === INDEX_VERSION && parsed.files) current = parsed
  } catch { /* first run */ }
  current ??= { version: INDEX_VERSION, files: {}, scannedAt: 0 }
  seenKeys = new Set(Object.values(current.files).flatMap(state => state.keys))
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
    // Claude Code cleans up old transcripts: what they counted still happened.
    for (const [known, state] of Object.entries(index.files)) if (!present.has(known)) state.gone = true
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
      // A file that shrank was rewritten: count it again from the start (its replies are free to count again).
      if (!state || size < state.offset) {
        for (const key of state?.keys || []) seenKeys.delete(key)
        state = index.files[file] = { size: 0, offset: 0, keys: [], days: {}, models: {}, families: {} }
      }
      state.gone = undefined
      if (size === state.offset) continue
      const target = state
      try {
        target.offset = await readFrom(file, target.offset, text => applyLines(target, text, seenKeys))
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

/** One day of the charts: output and fresh input per model family. */
export interface UsageDay {
  day: string
  families: Record<ModelFamily, { output: number; input: number }>
  /** output + fresh input, all families */
  total: number
  /** a day of the month still ahead */
  future?: boolean
}

export interface UsageSummary {
  today: TokenCounts
  week: TokenCounts
  allTime: TokenCounts
  /** The last 7 days, oldest first (today last). */
  days7: UsageDay[]
  /** Every day of this month (work days), the ones still ahead marked future. */
  month: { label: string; days: UsageDay[] }
  byModel: Array<{ model: string; counts: TokenCounts }>
  firstDay: string | null
  scannedAt: number
  indexing: boolean
  progress: { done: number; total: number }
}

function emptyDay(day: string): UsageDay {
  const families = Object.fromEntries(MODEL_FAMILIES.map(f => [f, { output: 0, input: 0 }])) as UsageDay['families']
  return { day, families, total: 0 }
}

function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + by)
  return d.toISOString().slice(0, 10)
}

/** Totals for today, the last 7 days (today included) and all time, and the days for the charts. */
export function summarizeUsage(index: UsageIndex, now = new Date()): Omit<UsageSummary, 'indexing' | 'progress'> {
  const today = localDay(now)
  const weekStart = shiftDay(today, -6)
  const monthPrefix = today.slice(0, 8)
  const byDay = new Map<string, UsageDay>()
  for (const state of Object.values(index.files)) {
    for (const [day, families] of Object.entries(state.families || {})) {
      if (day < weekStart && !day.startsWith(monthPrefix)) continue
      const entry = byDay.get(day) || emptyDay(day)
      for (const [family, pair] of Object.entries(families) as Array<[ModelFamily, [number, number]]>) {
        entry.families[family].output += pair[0]
        entry.families[family].input += pair[1]
        entry.total += pair[0] + pair[1]
      }
      byDay.set(day, entry)
    }
  }
  const days7 = Array.from({ length: 7 }, (_, i) => byDay.get(shiftDay(weekStart, i)) || emptyDay(shiftDay(weekStart, i)))
  const [year, month] = today.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const day = `${monthPrefix}${String(i + 1).padStart(2, '0')}`
    return { ...(byDay.get(day) || emptyDay(day)), ...(day > today ? { future: true } : {}) }
  })
  const label = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
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
    .sort((a, b) => headlineTokens(b.counts) - headlineTokens(a.counts))
  return { today: t, week: w, allTime: all, byModel, firstDay, scannedAt: index.scannedAt, days7, month: { label, days: monthDays } }
}

/** Current totals; starts a refresh in the background when the last one is older than `maxAgeMs`. */
export async function getUsageSummary(maxAgeMs = 30_000): Promise<UsageSummary> {
  const index = await loadIndex()
  if (!scanning && Date.now() - index.scannedAt > maxAgeMs) void refreshUsageIndex()
  // A refresh of a few appended lines is quick: give it a moment so the numbers are current.
  if (scanning && index.scannedAt) await Promise.race([scanning, new Promise(resolve => setTimeout(resolve, 1500))])
  return { ...summarizeUsage(current || index), indexing: Boolean(scanning), progress: { ...progress } }
}

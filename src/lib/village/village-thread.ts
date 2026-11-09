// ░▒▓ VILLAGE THREAD — what the thread shows: the text, the work in progress, and finished tool runs folded up ▓▒░
// Like the Claude Code app: tool calls since the agent's last text are the work in progress and show as full cards.
// Every earlier run of tool calls between two texts folds into one row that sums it up ("Ran 12 commands, read 8
// files, edited 3 files") and opens on click. Pure, so it can be tested.

import type { AgentLogEntry } from '../../store/slices/agentEngineSlice'

export type ToolLogEntry = Extract<AgentLogEntry, { type: 'tool' }>

export type ThreadItem =
  | { kind: 'entry'; key: string; entry: AgentLogEntry }
  | { kind: 'tools'; key: string; entries: ToolLogEntry[]; summary: string; failed: number }

/** A picture or file the agent sent you is content, not work: it never folds away. */
function standsAlone(entry: ToolLogEntry): boolean {
  return entry.name === 'SendUserFile'
}

export function groupThread(entries: readonly AgentLogEntry[]): ThreadItem[] {
  let lastText = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type === 'text' && !entry.parentToolUseId) {
      lastText = i
      break
    }
  }
  const items: ThreadItem[] = []
  let run: ToolLogEntry[] = []
  const flush = () => {
    if (!run.length) return
    const { summary, failed } = summarizeToolRun(run)
    items.push({ kind: 'tools', key: `run:${run[0].key}`, entries: run, summary, failed })
    run = []
  }
  entries.forEach((entry, index) => {
    if (index < lastText && entry.type === 'tool' && !standsAlone(entry)) {
      run.push(entry)
      return
    }
    flush()
    items.push({ kind: 'entry', key: entry.key, entry })
  })
  flush()
  return items
}

// ─── the summary line ───────────────────────────────────────────────────────

interface ToolKind {
  id: string
  match: (name: string) => boolean
  phrase: (n: number) => string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** In this order in the summary. */
const TOOL_KINDS: ToolKind[] = [
  { id: 'command', match: n => /^(Bash|PowerShell|BashOutput|KillShell|KillBash|Monitor)$/.test(n), phrase: n => `ran ${plural(n, 'command', 'commands')}` },
  { id: 'read', match: n => n === 'Read' || n === 'NotebookRead', phrase: n => `read ${plural(n, 'file', 'files')}` },
  { id: 'edit', match: n => n === 'Edit' || n === 'MultiEdit' || n === 'NotebookEdit', phrase: n => `edited ${plural(n, 'file', 'files')}` },
  { id: 'write', match: n => n === 'Write', phrase: n => `wrote ${plural(n, 'file', 'files')}` },
  { id: 'search', match: n => n === 'Grep' || n === 'Glob' || n === 'ToolSearch', phrase: n => `searched ${n === 1 ? 'once' : `${n} times`}` },
  { id: 'fetch', match: n => n === 'WebFetch', phrase: n => `fetched ${plural(n, 'page', 'pages')}` },
  { id: 'web', match: n => n === 'WebSearch', phrase: n => `searched the web ${n === 1 ? 'once' : `${n} times`}` },
  { id: 'world', match: n => n.startsWith('mcp__oasis__'), phrase: n => `used ${plural(n, 'world tool', 'world tools')}` },
]

export function summarizeToolRun(entries: readonly ToolLogEntry[]): { summary: string; failed: number } {
  const counts = new Map<string, number>()
  let other = 0
  let failed = 0
  for (const entry of entries) {
    if (entry.status === 'error') failed++
    const kind = TOOL_KINDS.find(k => k.match(entry.name))
    if (kind) counts.set(kind.id, (counts.get(kind.id) || 0) + 1)
    else other++
  }
  const parts = TOOL_KINDS.filter(k => counts.has(k.id)).map(k => k.phrase(counts.get(k.id) || 0))
  if (other) parts.push(parts.length ? `used ${plural(other, 'other tool', 'other tools')}` : `used ${plural(other, 'tool', 'tools')}`)
  const text = parts.join(', ')
  return { summary: text.charAt(0).toUpperCase() + text.slice(1), failed }
}

// ─── how tall a folded run is: a little taller with more calls, never 50x ────

export const TOOL_RUN_BASE_PX = 30
export const TOOL_RUN_LINE_PX = 15
export const TOOL_RUN_LAYER_PX = 5

export interface ToolRunShape {
  /** Lines under the summary with the run's last few calls. */
  previewLines: number
  /** Cards stacked behind the row. */
  stackLayers: number
}

export function toolRunShape(calls: number): ToolRunShape {
  const log = Math.log2(Math.max(1, calls))
  return {
    previewLines: Math.max(0, Math.min(4, Math.floor(log) - 1)),
    stackLayers: Math.max(0, Math.min(3, Math.floor(log / 2))),
  }
}

/** Nominal height of a folded run: 1 call is the base; about 50 calls is 3–4x; it stops growing there. */
export function toolRunHeight(calls: number): number {
  const shape = toolRunShape(calls)
  return TOOL_RUN_BASE_PX + shape.previewLines * TOOL_RUN_LINE_PX + shape.stackLayers * TOOL_RUN_LAYER_PX
}

// ─── the thread's pictures (the viewer steps through all of them) ────────────

export interface ThreadImage {
  id: string
  name: string
}

/** Every picture the agent sent or opened, oldest first, each once. */
export function threadImages(entries: readonly AgentLogEntry[]): ThreadImage[] {
  const seen = new Set<string>()
  const out: ThreadImage[] = []
  for (const entry of entries) {
    if (entry.type !== 'tool' || !entry.attachments) continue
    for (const file of entry.attachments) {
      if (!file.isImage || seen.has(file.id)) continue
      seen.add(file.id)
      out.push({ id: file.id, name: file.name })
    }
  }
  return out
}

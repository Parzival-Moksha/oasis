// packages/oasis-agent-engine/src/history.js: reading a transcript's past backwards in pieces.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as historyModule from '../../../packages/oasis-agent-engine/src/history.js'

interface HistoryEvent { kind: string; at: number; history: boolean; toolUseId?: string; text?: string }
interface HistoryApi {
  readOlderHistory: (file: string, agentId: string, opts?: { before?: number | null; anchor?: string | null; minEvents?: number; maxBytes?: number }) => { events: HistoryEvent[]; from: number; done: boolean }
  readHistoryTail: (file: string, agentId: string, bytes: number) => HistoryEvent[]
  findToolUseLine: (fd: number, toolUseId: string) => number | null
}
const { readOlderHistory, readHistoryTail, findToolUseLine } = historyModule as unknown as HistoryApi

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-history-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const pad = 'x'.repeat(300)
let clock = Date.parse('2026-11-09T08:00:00Z')
const stamp = () => new Date((clock += 1000)).toISOString()

/** A transcript in Claude Code's shape: one content block per assistant line, api-request-blob lines repeating blocks. */
function transcript(turns: number, opts: { giantLineAt?: number; unterminatedTail?: boolean } = {}): { file: string; toolIds: string[] } {
  const lines: string[] = []
  const toolIds: string[] = []
  lines.push(JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }))
  for (let t = 0; t < turns; t++) {
    if (opts.giantLineAt === t) lines.push(JSON.stringify({ type: 'attachment', blob: 'g'.repeat(300 * 1024) }))
    lines.push(JSON.stringify({ type: 'user', uuid: `u${t}`, timestamp: stamp(), message: { role: 'user', content: `prompt ${t} ${pad}` } }))
    lines.push(JSON.stringify({ type: 'assistant', timestamp: stamp(), message: { id: `m${t}`, model: 'claude-haiku', content: [{ type: 'text', text: `answer ${t} part 1` }] } }))
    for (let k = 0; k < 2; k++) {
      const id = `toolu_${t}_${k}_abcdef`
      toolIds.push(id)
      lines.push(JSON.stringify({ type: 'assistant', timestamp: stamp(), message: { id: `m${t}`, model: 'claude-haiku', content: [{ type: 'tool_use', id, name: k ? 'Read' : 'Bash', input: { command: `echo ${t}`, file_path: `/x/${t}.txt` } }] } }))
      lines.push(JSON.stringify({ type: 'user', timestamp: stamp(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `out ${t} ${k}` }] } }))
    }
    // The same blocks again in a request blob, later in the file (the anchor search must skip these).
    lines.push(JSON.stringify({ type: 'api-request-blob', messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${t}_0_abcdef`, name: 'Bash', input: {} }] }] }))
    lines.push(JSON.stringify({ type: 'assistant', timestamp: stamp(), message: { id: `n${t}`, model: 'claude-haiku', content: [{ type: 'text', text: `answer ${t} done` }] } }))
    lines.push(JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', timestamp: stamp() }))
  }
  let body = lines.join('\n') + '\n'
  if (opts.unterminatedTail) body += '{"type":"assistant","message":{"content":[{"type":"text","text":"half wri'
  const file = path.join(dir, `t-${turns}-${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(file, body)
  return { file, toolIds }
}

function walkBack(file: string, opts: { minEvents?: number; maxBytes?: number } = {}) {
  const pieces: Array<{ events: HistoryEvent[]; from: number; done: boolean }> = []
  let before: number | null = null
  for (let i = 0; i < 500; i++) {
    const piece = readOlderHistory(file, 'obs-1', { before, ...opts })
    pieces.push(piece)
    if (piece.done) break
    expect(before === null || piece.from < before).toBe(true) // always moves back
    before = piece.from
  }
  return pieces
}

describe('readOlderHistory', () => {
  it('walks a transcript back to its first line in pieces, every event once, each with its line offset', () => {
    const { file, toolIds } = transcript(60)
    const buf = fs.readFileSync(file)
    const pieces = walkBack(file, { minEvents: 40, maxBytes: 16 * 1024 })
    expect(pieces.length).toBeGreaterThan(3)
    expect(pieces.at(-1)).toMatchObject({ from: 0, done: true })
    const events = pieces.reverse().flatMap(piece => piece.events)
    const starts = events.filter(e => e.kind === 'tool.start').map(e => e.toolUseId)
    expect(starts).toEqual(toolIds)
    const texts = events.filter(e => e.kind === 'text').map(e => e.text)
    expect(texts).toHaveLength(120)
    for (const event of events) {
      expect(event.history).toBe(true)
      expect(event.at === 0 || buf[event.at - 1] === 0x0a).toBe(true) // a line start
    }
    // Offsets only grow through the walk (oldest piece first).
    const ats = events.map(e => e.at)
    expect([...ats].sort((a, b) => a - b)).toEqual(ats)
  })

  it('stops at minEvents when there is plenty, and reports where the next piece ends', () => {
    const { file } = transcript(80)
    const piece = readOlderHistory(file, 'obs-1', { minEvents: 30, maxBytes: 64 * 1024 })
    expect(piece.done).toBe(false)
    expect(piece.events.length).toBeGreaterThanOrEqual(30)
    expect(piece.from).toBe(Math.min(...piece.events.map(e => e.at), piece.from))
    const next = readOlderHistory(file, 'obs-1', { before: piece.from, minEvents: 30, maxBytes: 64 * 1024 })
    expect(Math.max(...next.events.map(e => e.at))).toBeLessThan(piece.from)
  })

  it('leaves out a last line that is still being written', () => {
    const { file } = transcript(3, { unterminatedTail: true })
    const piece = readOlderHistory(file, 'obs-1', {})
    expect(piece.done).toBe(true)
    expect(piece.events.some(e => e.kind === 'text' && /half/.test(String(e.text)))).toBe(false)
    expect(piece.events.filter(e => e.kind === 'text')).toHaveLength(6)
  })

  it('gets past a line bigger than maxBytes instead of looping on empty pieces', () => {
    const { file } = transcript(6, { giantLineAt: 3 })
    const pieces = walkBack(file, { minEvents: 5, maxBytes: 64 * 1024 })
    expect(pieces.at(-1)?.done).toBe(true)
    expect(pieces.flatMap(p => p.events).filter(e => e.kind === 'tool.start')).toHaveLength(12)
  })

  it('anchors on the assistant line of a tool call, not the request blob that repeats it later', () => {
    const { file, toolIds } = transcript(10)
    const fd = fs.openSync(file, 'r')
    try {
      const at = findToolUseLine(fd, toolIds[8]) // turn 4, the Bash call
      expect(at).not.toBeNull()
      const line = fs.readFileSync(file).subarray(at as number).toString('utf8').split('\n')[0]
      expect(JSON.parse(line)).toMatchObject({ type: 'assistant', message: { content: [{ id: toolIds[8] }] } })
      expect(findToolUseLine(fd, 'toolu_missing_000')).toBeNull()
    } finally {
      fs.closeSync(fd)
    }
    const piece = readOlderHistory(file, 'agent-1', { anchor: toolIds[8], minEvents: 1000 })
    const starts = piece.events.filter(e => e.kind === 'tool.start').map(e => e.toolUseId)
    expect(starts).toEqual(toolIds.slice(0, 8)) // everything before the anchor's line, and not the anchor itself
    expect(piece.events.at(-1)).toMatchObject({ kind: 'text', text: 'answer 4 part 1' })
  })

  it('throws for an anchor that is not in the transcript', () => {
    const { file } = transcript(2)
    expect(() => readOlderHistory(file, 'agent-1', { anchor: 'toolu_nowhere_123' })).toThrow(/not in the transcript/)
  })
})

describe('readHistoryTail', () => {
  it('reads the last bytes as history events with offsets (what a resumed agent shows first)', () => {
    const { file } = transcript(30)
    const size = fs.statSync(file).size
    const events = readHistoryTail(file, 'agent-1', 8 * 1024)
    expect(events.length).toBeGreaterThan(5)
    expect(Math.min(...events.map(e => e.at))).toBeGreaterThanOrEqual(size - 8 * 1024)
    expect(events.every(e => e.history)).toBe(true)
  })
})

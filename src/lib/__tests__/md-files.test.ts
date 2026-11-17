import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { registerAttachment, readTextFile, writeTextFile, parseRange } from '../../../packages/oasis-agent-engine/src/files.js'
import { normalizeLines } from '../../../packages/oasis-agent-engine/src/history.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-md-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const make = (name: string, text: string) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return { file, id: registerAttachment(file, null, false) }
}

describe('the md reader (engine side)', () => {
  it('reads a sent markdown file and saves it back to the same path', async () => {
    const { file, id } = make('notes.md', '# Hi\n')
    const read = await readTextFile(id)
    expect(read).toMatchObject({ name: 'notes.md', text: '# Hi\n' })
    const saved = await writeTextFile(id, '# Hi there\n', { expectedMtimeMs: read.mtimeMs })
    expect(fs.readFileSync(file, 'utf8')).toBe('# Hi there\n')
    expect(saved.name).toBe('notes.md')
  })

  it('refuses a save when the file changed on disk, unless forced', async () => {
    const { file, id } = make('plan.md', 'one')
    const read = await readTextFile(id)
    fs.writeFileSync(file, 'the agent rewrote it')
    const future = new Date(Date.now() + 5000)
    fs.utimesSync(file, future, future)
    await expect(writeTextFile(id, 'mine', { expectedMtimeMs: read.mtimeMs })).rejects.toThrow(/changed on disk/)
    expect(fs.readFileSync(file, 'utf8')).toBe('the agent rewrote it')
    await writeTextFile(id, 'mine', { expectedMtimeMs: read.mtimeMs, force: true })
    expect(fs.readFileSync(file, 'utf8')).toBe('mine')
  })

  it('only reaches files an agent sent, and only text types', async () => {
    await expect(readTextFile('not-an-id')).rejects.toThrow(/unknown file/)
    await expect(writeTextFile('not-an-id', 'x')).rejects.toThrow(/unknown file/)
    const { id } = make('tool.js', 'process.exit(1)')
    await expect(readTextFile(id)).rejects.toThrow(/only .md/)
    await expect(writeTextFile(id, 'x')).rejects.toThrow(/only .md/)
  })

  it('answers byte ranges so a video can be seeked', () => {
    expect(parseRange('bytes=15368192-', 22124780)).toEqual({ start: 15368192, end: 22124779 })
  })

  it('a file card from before an engine restart opens again: replayed history registers the sent file anew', async () => {
    const file = path.join(dir, 'open.md')
    fs.writeFileSync(file, '# Questions\n')
    // What the transcript holds: the SendUserFile call, then its result (as Claude Code writes them).
    const lines = [
      { type: 'user', message: { role: 'user', content: 'send me the questions' }, timestamp: '2026-11-17T10:00:00Z', uuid: 'u1' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'SendUserFile', input: { files: [file] } }] }, timestamp: '2026-11-17T10:00:01Z', uuid: 'a1' },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'sent' }] }, toolUseResult: { attachments: [{ path: file, size: 12, isImage: false, media_type: 'text/markdown', pathValidated: true }] }, timestamp: '2026-11-17T10:00:02Z', uuid: 'u2' },
    ].map((rec, i) => ({ at: i * 100, text: JSON.stringify(rec) }))
    const events = normalizeLines('agent-1', lines) as Array<{ kind: string; attachments?: Array<{ id: string; name: string }> }>
    const card = events.find(e => e.kind === 'tool.end' && e.attachments?.length)
    expect(card?.attachments?.[0].name).toBe('open.md')
    const read = await readTextFile(card!.attachments![0].id)
    expect(read.text).toBe('# Questions\n')
  })
})

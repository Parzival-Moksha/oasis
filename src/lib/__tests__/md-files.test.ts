import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { registerAttachment, readTextFile, writeTextFile, parseRange } from '../../../packages/oasis-agent-engine/src/files.js'

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
})

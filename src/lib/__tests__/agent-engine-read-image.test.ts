// A Read of a picture: the engine registers the file like a SendUserFile attachment, so the thread can show it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'

type Emitted = { kind: string; payload: Record<string, unknown> }
interface NormalizerLike { handleRecord: (rec: Record<string, unknown>) => void }
const { Normalizer } = normalizeModule as unknown as { Normalizer: new (id: string, emit: (kind: string, payload: Record<string, unknown>) => void, opts: { mode: string }) => NormalizerLike }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-read-image-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function run(filePath: string, content: unknown): Emitted[] {
  const out: Emitted[] = []
  const norm = new Normalizer('obs-1', (kind, payload) => out.push({ kind, payload }), { mode: 'observe' })
  norm.handleRecord({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_r1', name: 'Read', input: { file_path: filePath } }] } })
  norm.handleRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_r1', content }] } })
  return out
}

describe('Read of an image', () => {
  it('comes back with the picture as an attachment', () => {
    const file = path.join(dir, 'shot.png')
    fs.writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex'))
    const end = run(file, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }]).find(e => e.kind === 'tool.end')
    expect(end?.payload).toMatchObject({ name: 'Read', output: '[image]' })
    const [attachment] = end?.payload.attachments as Array<Record<string, unknown>>
    expect(attachment).toMatchObject({ name: 'shot.png', isImage: true, mediaType: 'image/png', size: 8 })
    expect(typeof attachment.id).toBe('string')
  })

  it('a Read of text or of a non-image file gets no attachment', () => {
    const text = path.join(dir, 'notes.txt')
    fs.writeFileSync(text, 'hello')
    expect(run(text, 'hello').find(e => e.kind === 'tool.end')?.payload.attachments).toBeUndefined()
    const svg = path.join(dir, 'icon.svg')
    fs.writeFileSync(svg, '<svg/>')
    expect(run(svg, [{ type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'x' } }]).find(e => e.kind === 'tool.end')?.payload.attachments).toBeUndefined()
  })
})

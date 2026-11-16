// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PICTURES_MAX, PICTURE_MAX_BYTES, takePictures } from '../../../packages/oasis-agent-engine/src/pictures.js'

const dir = path.join(os.tmpdir(), `oasis-pictures-test-${process.pid}`)
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')

describe('pictures pasted into an agent chat (engine)', () => {
  it('keeps each one as a file the page can show and hands back the image block data', () => {
    const [picture] = takePictures([{ data: `data:image/png;base64,${png}`, mediaType: 'image/png', name: 'shot.png' }], { dir })
    expect(picture).toMatchObject({ mediaType: 'image/png', name: 'shot.png', data: png })
    expect(picture.fileId).toMatch(/^[0-9a-f-]{36}$/)
    expect(fs.readdirSync(dir).some(f => f.endsWith('.png'))).toBe(true)
  })

  it('refuses what the models cannot read, empty ones, too big and too many, with a sentence', () => {
    expect(() => takePictures([{ data: png, mediaType: 'image/bmp', name: 'a.bmp' }], { dir })).toThrow(/PNG, JPEG, GIF and WebP/)
    expect(() => takePictures([{ data: '', mediaType: 'image/png' }], { dir })).toThrow(/empty/)
    expect(() => takePictures([{ data: 'A'.repeat(PICTURE_MAX_BYTES + 4), mediaType: 'image/jpeg', name: 'huge.jpg' }], { dir })).toThrow(/5 MB/)
    expect(() => takePictures(Array.from({ length: PICTURES_MAX + 1 }, () => ({ data: png, mediaType: 'image/png' })), { dir })).toThrow(/at most/)
  })

  it('no pictures is fine', () => {
    expect(takePictures(undefined, { dir })).toEqual([])
    expect(takePictures(null, { dir })).toEqual([])
  })
})

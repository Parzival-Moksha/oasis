// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

describe('fps meter', () => {
  it('reads the frames of the last second, says nothing after 3 s without one', async () => {
    const { trackFrame, readLatestFps } = await import('../fps-meter')
    for (let i = 0; i <= 60; i++) trackFrame(1000 + i * (1000 / 60))
    expect(readLatestFps(2010)).toBe(60)
    expect(readLatestFps(2000 + 3100)).toBeNull()
  })

  it('a second copy of the module (a hot reload) reads the same meter', async () => {
    const first = await import('../fps-meter')
    for (let i = 0; i <= 30; i++) first.trackFrame(10_000 + i * (1000 / 30))
    vi.resetModules()
    const second = await import('../fps-meter')
    expect(second).not.toBe(first)
    expect(second.readLatestFps(11_010)).toBe(30)
  })
})

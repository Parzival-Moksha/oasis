import { describe, expect, it } from 'vitest'

import { FrameCallbackTimer, callbackLabel } from '../frame-callback-timing'

describe('FrameCallbackTimer', () => {
  it('times each subscriber through its ref, keeps later ref writes working, and reports per frame', () => {
    let clock = 0
    const timer = new FrameCallbackTimer(() => clock, 1)
    const slow = function slowCallback() { clock += 30 }
    const fast = () => { clock += 2 }
    const subs = [{ ref: { current: slow as (...args: unknown[]) => unknown } }, { ref: { current: fast as (...args: unknown[]) => unknown } }]
    expect(timer.instrument(subs)).toBe(2)
    expect(timer.instrument(subs)).toBe(0)
    for (let frame = 0; frame < 3; frame++) {
      timer.tick()
      for (const sub of subs) sub.ref.current()
    }
    // A re-render writes a new callback into the ref: it must reach the original ref and be timed too.
    const replaced = function replacedCallback() { clock += 10 }
    subs[1].ref.current = replaced
    timer.tick()
    for (const sub of subs) sub.ref.current()
    const report = timer.flush()
    expect(report.frames).toBe(4)
    expect(report.msPerFrame).toBe((90 + 6 + 30 + 10) / 4)
    expect(report.top.map(t => [t.who, t.ms, t.calls])).toEqual([
      ['slowCallback', 120, 4],
      ['replacedCallback', 10, 1],
      [callbackLabel(fast as (...args: unknown[]) => unknown), 6, 3],
    ])
    // Flushing starts a new window.
    expect(timer.flush()).toEqual({ frames: 0, msPerFrame: 0, top: [] })
  })

  it('times only one frame in sampleEvery, and runs the callback untimed otherwise', () => {
    let clock = 0
    const timer = new FrameCallbackTimer(() => clock, 4)
    let calls = 0
    const sub = { ref: { current: (() => { calls += 1; clock += 5 }) as (...args: unknown[]) => unknown } }
    timer.instrument([sub])
    for (let frame = 0; frame < 8; frame++) { timer.tick(); sub.ref.current() }
    const report = timer.flush()
    expect(calls).toBe(8)
    expect(report.frames).toBe(2)
    expect(report.msPerFrame).toBe(5)
    expect(report.top[0].calls).toBe(2)
  })

  it('labels anonymous callbacks by their source', () => {
    const label = callbackLabel(() => { /* nothing */ })
    expect(label.startsWith('()')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(80)
  })
})

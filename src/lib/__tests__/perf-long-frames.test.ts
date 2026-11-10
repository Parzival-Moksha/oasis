import { describe, expect, it } from 'vitest'

import { scriptLabel, summarizeLongFrames } from '../perf-long-frames'

describe('summarizeLongFrames', () => {
  it('is empty for no frames', () => {
    expect(summarizeLongFrames([])).toEqual({ frames: 0, ms: 0, blockingMs: 0, renderMs: 0, scriptMs: 0, forcedLayoutMs: 0, maxMs: 0, top: [] })
  })

  it('sums frames, rendering, scripts and names the heaviest script', () => {
    const summary = summarizeLongFrames([
      {
        startTime: 1000, duration: 80, blockingDuration: 30, renderStart: 1060,
        scripts: [
          { invokerType: 'user-callback', invoker: 'FrameRequestCallback', sourceURL: 'http://x/_next/static/chunks/app/VillageWorld.tsx?abc', sourceFunctionName: 'tick', sourceCharPosition: 12, duration: 40, forcedStyleAndLayoutDuration: 5 },
          { invokerType: 'event-listener', invoker: 'WebSocket.onmessage', sourceURL: 'http://x/agent-engine-client.ts', sourceFunctionName: 'handleMessage', duration: 10 },
        ],
      },
      {
        startTime: 2000, duration: 120, blockingDuration: 70, renderStart: 2100,
        scripts: [
          { invokerType: 'user-callback', invoker: 'FrameRequestCallback', sourceURL: 'http://x/_next/static/chunks/app/VillageWorld.tsx?abc', sourceFunctionName: 'tick', sourceCharPosition: 12, duration: 90 },
        ],
      },
    ])
    expect(summary.frames).toBe(2)
    expect(summary.ms).toBe(200)
    expect(summary.blockingMs).toBe(100)
    expect(summary.renderMs).toBe(20 + 20)
    expect(summary.scriptMs).toBe(140)
    expect(summary.forcedLayoutMs).toBe(5)
    expect(summary.maxMs).toBe(120)
    expect(summary.top[0]).toEqual({ who: 'user-callback FrameRequestCallback VillageWorld.tsx@12 tick', ms: 130, count: 2 })
    expect(summary.top[1]).toEqual({ who: 'event-listener WebSocket.onmessage agent-engine-client.ts handleMessage', ms: 10, count: 1 })
  })

  it('falls back to duration minus 50 ms when blockingDuration is missing, and caps the top list', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      startTime: i * 100, duration: 60,
      scripts: [{ invoker: `cb${i}`, duration: 1 + i }],
    }))
    const summary = summarizeLongFrames(entries, 3)
    expect(summary.blockingMs).toBe(12 * 10)
    expect(summary.top).toHaveLength(3)
    expect(summary.top[0].who).toBe('cb11')
  })

  it('labels a script without any source as unknown', () => {
    expect(scriptLabel({ duration: 1 })).toBe('(unknown)')
  })
})

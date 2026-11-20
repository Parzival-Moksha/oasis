import { describe, expect, it } from 'vitest'
import { CAST, CastBoard, isWorldChangeTool } from '../village/agent-cast'

const run = (board: CastBoard, from: number, to: number, step = 10) => { for (let t = from; t <= to; t += step) board.tick(t) }

describe('agent cast', () => {
  it('knows which tools change the world', () => {
    expect(isWorldChangeTool('mcp__oasis__place_object')).toBe(true)
    expect(isWorldChangeTool('mcp__oasis__set_sky')).toBe(true)
    expect(isWorldChangeTool('set_ground_preset')).toBe(true)
    expect(isWorldChangeTool('mcp__oasis__get_world_state')).toBe(false)
    expect(isWorldChangeTool('mcp__oasis__screenshot_viewport')).toBe(false)
    expect(isWorldChangeTool('Bash')).toBe(false)
  })

  it('enter, charge while the words are said, shoot, exit', () => {
    const board = new CastBoard()
    board.start('a', 't1', 0)
    expect(board.phase('a', 100)).toBe('enter')
    expect(board.phase('a', 1000)).toBe('charge')
    board.toolEnded('t1', false)
    run(board, 0, CAST.shootStartMs - 10)
    expect(board.phase('a', CAST.shootStartMs - 10)).toBe('charge')
    board.tick(CAST.shootStartMs)
    expect(board.phase('a', CAST.shootStartMs + 100)).toBe('shoot')
    expect(board.phase('a', CAST.shootStartMs + CAST.shootMs + 100)).toBe('exit')
    run(board, CAST.shootStartMs, CAST.shootStartMs + 2000)
    expect(board.phase('a', CAST.shootStartMs + 2000)).toBeNull()
    expect(board.active).toBe(false)
  })

  it('holds the world change and applies it on the shoot', () => {
    const board = new CastBoard()
    const applied: number[] = []
    let now = 0
    board.start('a', 't1', 0)
    expect(board.hold(() => applied.push(now), 300)).toBe(true)
    for (now = 0; now <= 6000; now += 10) board.tick(now)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toBeGreaterThanOrEqual(CAST.shootStartMs + CAST.releaseAfterShootMs)
    expect(applied[0]).toBeLessThan(CAST.shootStartMs + CAST.releaseAfterShootMs + 20)
  })

  it('does not hold when nobody casts', () => {
    const board = new CastBoard()
    expect(board.hold(() => {}, 0)).toBe(false)
  })

  it('a slow tool keeps it charging until its change comes, at most 20 s', () => {
    const board = new CastBoard()
    board.start('a', 't1', 0)
    run(board, 0, 9000)
    expect(board.phase('a', 9000)).toBe('charge')
    const applied: number[] = []
    let now = 9000
    board.hold(() => applied.push(now), 9000)
    for (; now <= 9500; now += 10) board.tick(now)
    expect(applied).toHaveLength(1)
    const lone = new CastBoard()
    lone.start('b', 't2', 0)
    run(lone, 0, CAST.maxChargeMs + 10)
    expect(lone.phase('b', CAST.maxChargeMs + 10)).toBe('shoot')
  })

  it('a failed tool skips the shoot and lets anything held go', () => {
    const board = new CastBoard()
    board.start('a', 't1', 0)
    board.toolEnded('t1', true)
    run(board, 0, CAST.shootStartMs)
    expect(board.phase('a', CAST.shootStartMs)).toBe('exit')
  })

  it('one spell for a burst of calls', () => {
    const board = new CastBoard()
    expect(board.start('a', 't1', 0)).toBe(true)
    expect(board.start('a', 't2', 100)).toBe(false)
  })
})

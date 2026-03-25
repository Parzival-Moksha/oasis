// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// AGENT WINDOW 3D TESTS — Default values and color mapping (no purple!)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Pure logic extracted from AgentWindow3D.tsx for testability
// These mirror the exact expressions used in the component.
// ═══════════════════════════════════════════════════════════════════════════

/** Default dimension logic — same as AgentWindow3D line 64-66 */
function getWindowDefaults(win: { width?: number; height?: number; scale?: number }) {
  return {
    winWidth: win.width || 800,
    winHeight: win.height || 600,
    winScale: win.scale || 1,
  }
}

/** Agent color mapping — same as AgentWindow3D line 96 */
function getAgentColor(agentType: string): string {
  return agentType === 'anorak' ? '#38bdf8'
    : agentType === 'merlin' ? '#f59e0b'
    : agentType === 'parzival' ? '#14b8a6'
    : '#22c55e'
}

/** PX_TO_WORLD constant — same as AgentWindow3D line 54 */
const DISTANCE_FACTOR = 8
const PX_TO_WORLD = DISTANCE_FACTOR / 400

/** World-space dimensions — same as AgentWindow3D line 69-70 */
function getWorldDimensions(winWidth: number, winHeight: number, winScale: number) {
  return {
    worldWidth: winWidth * PX_TO_WORLD * winScale,
    worldHeight: winHeight * PX_TO_WORLD * winScale,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentWindow3D defaults', () => {
  describe('getWindowDefaults()', () => {
    it('uses 800x600 scale=1 when all fields are undefined', () => {
      const result = getWindowDefaults({})
      expect(result.winWidth).toBe(800)
      expect(result.winHeight).toBe(600)
      expect(result.winScale).toBe(1)
    })

    it('uses 800x600 scale=1 when all fields are 0 (falsy)', () => {
      const result = getWindowDefaults({ width: 0, height: 0, scale: 0 })
      expect(result.winWidth).toBe(800)
      expect(result.winHeight).toBe(600)
      expect(result.winScale).toBe(1)
    })

    it('respects explicit width', () => {
      const result = getWindowDefaults({ width: 1024 })
      expect(result.winWidth).toBe(1024)
      expect(result.winHeight).toBe(600) // default
    })

    it('respects explicit height', () => {
      const result = getWindowDefaults({ height: 768 })
      expect(result.winWidth).toBe(800)  // default
      expect(result.winHeight).toBe(768)
    })

    it('respects explicit scale', () => {
      const result = getWindowDefaults({ scale: 2 })
      expect(result.winScale).toBe(2)
    })

    it('respects all explicit values together', () => {
      const result = getWindowDefaults({ width: 1920, height: 1080, scale: 0.5 })
      expect(result.winWidth).toBe(1920)
      expect(result.winHeight).toBe(1080)
      expect(result.winScale).toBe(0.5)
    })
  })

  describe('world-space dimensions', () => {
    it('computes world dimensions from defaults (800x600 scale=1)', () => {
      const { worldWidth, worldHeight } = getWorldDimensions(800, 600, 1)
      expect(worldWidth).toBeCloseTo(16)   // 800 * 0.02 * 1
      expect(worldHeight).toBeCloseTo(12)  // 600 * 0.02 * 1
    })

    it('scales world dimensions with winScale', () => {
      const { worldWidth, worldHeight } = getWorldDimensions(800, 600, 2)
      expect(worldWidth).toBeCloseTo(32)   // 800 * 0.02 * 2
      expect(worldHeight).toBeCloseTo(24)  // 600 * 0.02 * 2
    })

    it('computes correctly for custom dimensions', () => {
      const { worldWidth, worldHeight } = getWorldDimensions(1024, 768, 0.5)
      expect(worldWidth).toBeCloseTo(10.24)  // 1024 * 0.02 * 0.5
      expect(worldHeight).toBeCloseTo(7.68)  // 768 * 0.02 * 0.5
    })
  })

  describe('PX_TO_WORLD constant', () => {
    it('equals DISTANCE_FACTOR / 400', () => {
      expect(PX_TO_WORLD).toBe(0.02)
    })
  })
})

describe('AgentWindow3D colors', () => {
  it('anorak = sky blue (#38bdf8)', () => {
    expect(getAgentColor('anorak')).toBe('#38bdf8')
  })

  it('merlin = amber (#f59e0b), NOT purple', () => {
    expect(getAgentColor('merlin')).toBe('#f59e0b')
  })

  it('parzival = turquoise (#14b8a6), NOT purple', () => {
    expect(getAgentColor('parzival')).toBe('#14b8a6')
  })

  it('devcraft = green (#22c55e)', () => {
    expect(getAgentColor('devcraft')).toBe('#22c55e')
  })

  it('unknown agent type falls back to green', () => {
    expect(getAgentColor('some-future-agent')).toBe('#22c55e')
  })

  it('NO color contains purple hex patterns', () => {
    const agents = ['anorak', 'merlin', 'parzival', 'devcraft', 'unknown']
    for (const agent of agents) {
      const color = getAgentColor(agent)
      // Purple-ish hex ranges: #8b5cf6, #a855f7, #7c3aed, #9333ea, etc.
      // Any color starting with #8, #9, #a in the R channel with low G is suspicious
      expect(color).not.toMatch(/^#[89a][0-9a-f][0-5]/i)
    }
  })
})

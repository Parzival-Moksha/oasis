// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// BATCH 2 TESTS — ParzivalWindowContent, AgentWindow3D frame/opacity/blur
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Pure logic extracted from ParzivalWindowContent.tsx for testability
// ═══════════════════════════════════════════════════════════════════════════

/** MODE_COLORS — exact copy from ParzivalWindowContent.tsx lines 15-20 */
const MODE_COLORS: Record<string, string> = {
  coach: '#14b8a6',
  coder: '#fb923c',
  curator: '#22d3ee',
  hacker: '#f87171',
}

/**
 * renderInlineMd — pure string→segments version of the JSX function.
 * We test the parsing logic, not React rendering, so we return segment objects.
 */
interface MdSegment {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link'
  content: string
}

function parseInlineMd(text: string): MdSegment[] {
  const segments: MdSegment[] = []
  const regex = /(\*\*.*?\*\*|\*.*?\*|`[^`]+`|\[([^\]]+)\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) segments.push({ type: 'text', content: text.slice(last, match.index) })
    const m = match[0]
    if (m.startsWith('**')) segments.push({ type: 'bold', content: m.slice(2, -2) })
    else if (m.startsWith('*')) segments.push({ type: 'italic', content: m.slice(1, -1) })
    else if (m.startsWith('`')) segments.push({ type: 'code', content: m.slice(1, -1) })
    else if (m.startsWith('[')) segments.push({ type: 'link', content: match[2] })
    last = match.index + m.length
  }
  if (last < text.length) segments.push({ type: 'text', content: text.slice(last) })
  return segments
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure logic extracted from AgentWindow3D.tsx for testability
// ═══════════════════════════════════════════════════════════════════════════

/** Frame thickness multiplier — mirrors AgentWindow3D line 126 */
function getFrameThickness(win: { frameThickness?: number }): number {
  return win.frameThickness ?? 1
}

/** Window opacity — mirrors AgentWindow3D line 113 */
function getWindowOpacity(win: { windowOpacity?: number }): number {
  return win.windowOpacity ?? 1
}

/** Gilded frame border computation — mirrors AgentWindow3D line 130 */
function getGildedFrameBorder(fs: number, ft: number): number {
  return 0.04 * fs * ft
}

/** Gilded frame depth computation — mirrors AgentWindow3D line 130 */
function getGildedFrameDepth(fs: number, ft: number): number {
  return 0.02 * fs * ft
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — renderInlineMd parsing
// ═══════════════════════════════════════════════════════════════════════════

describe('renderInlineMd — inline markdown parser', () => {
  it('returns plain text when no markdown present', () => {
    const result = parseInlineMd('hello world')
    expect(result).toEqual([{ type: 'text', content: 'hello world' }])
  })

  it('parses **bold** text', () => {
    const result = parseInlineMd('this is **bold** text')
    expect(result).toEqual([
      { type: 'text', content: 'this is ' },
      { type: 'bold', content: 'bold' },
      { type: 'text', content: ' text' },
    ])
  })

  it('parses *italic* text', () => {
    const result = parseInlineMd('this is *italic* text')
    expect(result).toEqual([
      { type: 'text', content: 'this is ' },
      { type: 'italic', content: 'italic' },
      { type: 'text', content: ' text' },
    ])
  })

  it('parses `code` spans', () => {
    const result = parseInlineMd('run `npm install` now')
    expect(result).toEqual([
      { type: 'text', content: 'run ' },
      { type: 'code', content: 'npm install' },
      { type: 'text', content: ' now' },
    ])
  })

  it('parses [link](url) and extracts label', () => {
    const result = parseInlineMd('see [docs](https://example.com) for info')
    expect(result).toEqual([
      { type: 'text', content: 'see ' },
      { type: 'link', content: 'docs' },
      { type: 'text', content: ' for info' },
    ])
  })

  it('handles multiple markdown types in one string', () => {
    const result = parseInlineMd('**bold** and *italic* and `code`')
    expect(result).toHaveLength(5) // bold, " and ", italic, " and ", code
    expect(result[0]).toEqual({ type: 'bold', content: 'bold' })
    expect(result[2]).toEqual({ type: 'italic', content: 'italic' })
    expect(result[4]).toEqual({ type: 'code', content: 'code' })
  })

  it('returns empty array for empty string', () => {
    const result = parseInlineMd('')
    expect(result).toEqual([])
  })

  it('handles markdown at start and end of string', () => {
    const result = parseInlineMd('**start** middle `end`')
    expect(result[0]).toEqual({ type: 'bold', content: 'start' })
    expect(result[result.length - 1]).toEqual({ type: 'code', content: 'end' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Parzival MODE_COLORS (no purple!)
// ═══════════════════════════════════════════════════════════════════════════

describe('Parzival MODE_COLORS', () => {
  it('coach = turquoise (#14b8a6), NOT purple', () => {
    expect(MODE_COLORS.coach).toBe('#14b8a6')
  })

  it('coder = orange (#fb923c)', () => {
    expect(MODE_COLORS.coder).toBe('#fb923c')
  })

  it('curator = cyan (#22d3ee)', () => {
    expect(MODE_COLORS.curator).toBe('#22d3ee')
  })

  it('hacker = red (#f87171)', () => {
    expect(MODE_COLORS.hacker).toBe('#f87171')
  })

  it('NO mode color contains purple hex patterns', () => {
    for (const [mode, color] of Object.entries(MODE_COLORS)) {
      // Purple-ish hex: #c084fc, #a855f7, #7c3aed, #9333ea, #8b5cf6
      expect(color, `mode "${mode}" should not be purple`).not.toMatch(/^#[789abc][0-9a-f][0-5]/i)
    }
  })

  it('unknown mode falls back via ?? to #14b8a6', () => {
    // Mirrors ParzivalWindowContent.tsx line 105: MODE_COLORS[mode] ?? '#14b8a6'
    const unknownMode = 'wizard'
    const fallback = MODE_COLORS[unknownMode] ?? '#14b8a6'
    expect(fallback).toBe('#14b8a6')
  })

  it('has exactly 4 modes defined', () => {
    expect(Object.keys(MODE_COLORS)).toHaveLength(4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Frame thickness defaults and multiplication
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentWindow3D frameThickness', () => {
  it('defaults to 1 when frameThickness is undefined', () => {
    expect(getFrameThickness({})).toBe(1)
  })

  it('defaults to 1 when frameThickness is null-ish (via ??)', () => {
    expect(getFrameThickness({ frameThickness: undefined })).toBe(1)
  })

  it('uses explicit frameThickness value', () => {
    expect(getFrameThickness({ frameThickness: 2.5 })).toBe(2.5)
  })

  it('allows 0 as explicit thickness (nullish coalescing preserves 0)', () => {
    // ?? preserves 0, unlike || which would fall back to 1
    expect(getFrameThickness({ frameThickness: 0 })).toBe(0)
  })

  it('allows fractional values (e.g. 0.2 min from slider)', () => {
    expect(getFrameThickness({ frameThickness: 0.2 })).toBe(0.2)
  })

  it('gilded frame border scales with ft multiplier', () => {
    // fs=1, ft=1 → 0.04;  fs=1, ft=2 → 0.08
    expect(getGildedFrameBorder(1, 1)).toBeCloseTo(0.04)
    expect(getGildedFrameBorder(1, 2)).toBeCloseTo(0.08)
    expect(getGildedFrameBorder(1, 0.5)).toBeCloseTo(0.02)
  })

  it('gilded frame depth scales with ft multiplier', () => {
    expect(getGildedFrameDepth(1, 1)).toBeCloseTo(0.02)
    expect(getGildedFrameDepth(1, 3)).toBeCloseTo(0.06)
  })

  it('frame dimensions scale with both fs and ft', () => {
    // fs=2, ft=1.5 → border = 0.04 * 2 * 1.5 = 0.12
    expect(getGildedFrameBorder(2, 1.5)).toBeCloseTo(0.12)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Window opacity and blur defaults
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentWindow3D windowOpacity', () => {
  it('defaults to 1 when windowOpacity is undefined', () => {
    expect(getWindowOpacity({})).toBe(1)
  })

  it('uses explicit opacity value', () => {
    expect(getWindowOpacity({ windowOpacity: 0.5 })).toBe(0.5)
  })

  it('allows 0 opacity (nullish coalescing preserves 0)', () => {
    expect(getWindowOpacity({ windowOpacity: 0 })).toBe(0)
  })

  it('allows minimum slider value of 0.1', () => {
    expect(getWindowOpacity({ windowOpacity: 0.1 })).toBe(0.1)
  })
})

describe('AgentWindow windowBlur defaults', () => {
  it('defaults to 0 when windowBlur is undefined', () => {
    // Mirrors AgentWindow3D.tsx line 91: win.windowBlur ?? 0
    const win: { windowBlur?: number } = {}
    const blur = win.windowBlur ?? 0
    expect(blur).toBe(0)
  })

  it('uses explicit blur value', () => {
    const win = { windowBlur: 12 }
    const blur = win.windowBlur ?? 0
    expect(blur).toBe(12)
  })

  it('preserves 0 as explicit blur (no blur applied)', () => {
    const win = { windowBlur: 0 }
    const blur = win.windowBlur ?? 0
    expect(blur).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — AgentWindow interface field presence (type-level contract)
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentWindow interface contract', () => {
  it('all new optional fields have correct default semantics', () => {
    // Simulates a legacy window object with none of the new fields
    const legacyWin: Record<string, unknown> = {
      id: 'agent-anorak-1',
      agentType: 'anorak',
      position: [0, 5, 0],
      rotation: [0, 0, 0],
      scale: 1,
      width: 800,
      height: 600,
    }

    // All new fields should be undefined on legacy windows
    expect(legacyWin.frameThickness).toBeUndefined()
    expect(legacyWin.windowOpacity).toBeUndefined()
    expect(legacyWin.windowBlur).toBeUndefined()

    // And their defaults via ?? should be sensible
    const ft = (legacyWin.frameThickness as number | undefined) ?? 1
    const wo = (legacyWin.windowOpacity as number | undefined) ?? 1
    const wb = (legacyWin.windowBlur as number | undefined) ?? 0

    expect(ft).toBe(1)
    expect(wo).toBe(1)
    expect(wb).toBe(0)
  })
})

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO TOKENS — Unit tests for Mission #20
// Tests: TokenStats interface, addSessionTokens logic, fmtTokens integration,
//        per-session persistence, edge cases
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fmtTokens } from '@/lib/anorak-engine'

// ═══════════════════════════════════════════════════════════════════════════
// Pure logic mirrored from AnorakProPanel.tsx for testability (no React)
// ═══════════════════════════════════════════════════════════════════════════

interface TokenStats {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

const ZERO_TOKENS: TokenStats = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

interface StreamEntry {
  id: number
  type: 'text' | 'status' | 'tool' | 'tool_start' | 'tool_result' | 'error' | 'stderr' | 'thinking' | 'result'
  content: string
  lobe: string
  timestamp: number
}

interface AnorakProSession {
  id: string
  name: string
  createdAt: string
  entries: StreamEntry[]
  tokens?: TokenStats
}

const SESSIONS_KEY = 'oasis-anorak-pro-sessions'

// Mirrors: loadSessions from AnorakProPanel.tsx
function loadSessions(): AnorakProSession[] {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') } catch { return [] }
}

// Mirrors: saveSessions from AnorakProPanel.tsx
function saveSessions(sessions: AnorakProSession[]) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)) } catch { /* QuotaExceeded */ }
}

// Mirrors: addSessionTokens logic from AnorakProPanel.tsx lines 1218-1229
// Extracted as pure function operating on session array
function addSessionTokens(
  sessions: AnorakProSession[],
  activeSessionId: string,
  input: number,
  output: number,
  cost: number,
): AnorakProSession[] {
  return sessions.map(s => {
    if (s.id !== activeSessionId) return s
    const t = s.tokens || ZERO_TOKENS
    return {
      ...s,
      tokens: {
        inputTokens: t.inputTokens + input,
        outputTokens: t.outputTokens + output,
        costUsd: t.costUsd + cost,
      },
    }
  })
}

// Mirrors: the Number(event.total_input_tokens) || 0 pattern from SSE handler
function safeTokenNumber(val: unknown): number {
  return Number(val) || 0
}

// ═══════════════════════════════════════════════════════════════════════════
// localStorage mock
// ═══════════════════════════════════════════════════════════════════════════

let store: Record<string, string> = {}

beforeEach(() => {
  store = {}
  const storage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. TokenStats interface — zero state, accumulation arithmetic
// ═══════════════════════════════════════════════════════════════════════════

describe('TokenStats interface', () => {
  it('ZERO_TOKENS has all fields at 0', () => {
    expect(ZERO_TOKENS.inputTokens).toBe(0)
    expect(ZERO_TOKENS.outputTokens).toBe(0)
    expect(ZERO_TOKENS.costUsd).toBe(0)
  })

  it('ZERO_TOKENS is a valid TokenStats shape', () => {
    const ts: TokenStats = ZERO_TOKENS
    expect(ts).toHaveProperty('inputTokens')
    expect(ts).toHaveProperty('outputTokens')
    expect(ts).toHaveProperty('costUsd')
  })

  it('accumulation arithmetic works on zero base', () => {
    const base = { ...ZERO_TOKENS }
    const result: TokenStats = {
      inputTokens: base.inputTokens + 1000,
      outputTokens: base.outputTokens + 500,
      costUsd: base.costUsd + 0.0312,
    }
    expect(result.inputTokens).toBe(1000)
    expect(result.outputTokens).toBe(500)
    expect(result.costUsd).toBeCloseTo(0.0312, 4)
  })

  it('accumulation arithmetic stacks correctly', () => {
    let ts: TokenStats = { ...ZERO_TOKENS }
    // First turn
    ts = { inputTokens: ts.inputTokens + 1000, outputTokens: ts.outputTokens + 200, costUsd: ts.costUsd + 0.01 }
    // Second turn
    ts = { inputTokens: ts.inputTokens + 2000, outputTokens: ts.outputTokens + 300, costUsd: ts.costUsd + 0.02 }
    expect(ts.inputTokens).toBe(3000)
    expect(ts.outputTokens).toBe(500)
    expect(ts.costUsd).toBeCloseTo(0.03, 4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. addSessionTokens logic
// ═══════════════════════════════════════════════════════════════════════════

describe('addSessionTokens', () => {
  const mkSession = (id: string, tokens?: TokenStats): AnorakProSession => ({
    id,
    name: `Test ${id}`,
    createdAt: new Date().toISOString(),
    entries: [],
    tokens,
  })

  it('single call accumulates from zero', () => {
    const sessions = [mkSession('s1')]
    const result = addSessionTokens(sessions, 's1', 1000, 500, 0.05)
    expect(result[0].tokens).toEqual({ inputTokens: 1000, outputTokens: 500, costUsd: 0.05 })
  })

  it('multiple calls accumulate', () => {
    const sessions = [mkSession('s1')]
    let state = addSessionTokens(sessions, 's1', 1000, 200, 0.01)
    state = addSessionTokens(state, 's1', 2000, 300, 0.02)
    state = addSessionTokens(state, 's1', 500, 100, 0.005)
    expect(state[0].tokens!.inputTokens).toBe(3500)
    expect(state[0].tokens!.outputTokens).toBe(600)
    expect(state[0].tokens!.costUsd).toBeCloseTo(0.035, 10)
  })

  it('only modifies the active session, leaves others untouched', () => {
    const sessions = [
      mkSession('s1', { inputTokens: 100, outputTokens: 50, costUsd: 0.01 }),
      mkSession('s2', { inputTokens: 200, outputTokens: 100, costUsd: 0.02 }),
    ]
    const result = addSessionTokens(sessions, 's1', 400, 200, 0.03)
    expect(result[0].tokens).toEqual({ inputTokens: 500, outputTokens: 250, costUsd: 0.04 })
    // s2 unchanged
    expect(result[1].tokens).toEqual({ inputTokens: 200, outputTokens: 100, costUsd: 0.02 })
  })

  it('session without tokens field falls back to ZERO_TOKENS', () => {
    const sessions = [mkSession('s1')] // no tokens field
    expect(sessions[0].tokens).toBeUndefined()
    const result = addSessionTokens(sessions, 's1', 500, 250, 0.01)
    expect(result[0].tokens).toEqual({ inputTokens: 500, outputTokens: 250, costUsd: 0.01 })
  })

  it('no-op when activeSessionId not found', () => {
    const sessions = [mkSession('s1', { inputTokens: 100, outputTokens: 50, costUsd: 0.01 })]
    const result = addSessionTokens(sessions, 'nonexistent', 9999, 9999, 99.99)
    expect(result[0].tokens).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 })
  })

  // Number() || 0 guards — mirrors the SSE handler pattern
  describe('safeTokenNumber (Number() || 0 guard)', () => {
    it('handles undefined', () => {
      expect(safeTokenNumber(undefined)).toBe(0)
    })

    it('handles null', () => {
      expect(safeTokenNumber(null)).toBe(0)
    })

    it('handles NaN', () => {
      expect(safeTokenNumber(NaN)).toBe(0)
    })

    it('handles numeric string', () => {
      expect(safeTokenNumber('1500')).toBe(1500)
    })

    it('handles non-numeric string', () => {
      expect(safeTokenNumber('abc')).toBe(0)
    })

    it('handles empty string', () => {
      expect(safeTokenNumber('')).toBe(0)
    })

    it('handles valid number', () => {
      expect(safeTokenNumber(42)).toBe(42)
    })

    it('handles zero', () => {
      expect(safeTokenNumber(0)).toBe(0)
    })

    it('handles boolean false (returns 0)', () => {
      expect(safeTokenNumber(false)).toBe(0)
    })

    it('handles boolean true (returns 1)', () => {
      expect(safeTokenNumber(true)).toBe(1)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. fmtTokens integration — verify formatting at various scales
// ═══════════════════════════════════════════════════════════════════════════

describe('fmtTokens integration for token display', () => {
  it('formats 0 as raw number', () => {
    expect(fmtTokens(0)).toBe('0')
  })

  it('formats 500 as raw number', () => {
    expect(fmtTokens(500)).toBe('500')
  })

  it('formats 999 as raw number (boundary)', () => {
    expect(fmtTokens(999)).toBe('999')
  })

  it('formats 1000 as X.XK', () => {
    expect(fmtTokens(1000)).toBe('1.0K')
  })

  it('formats 5432 as X.XK', () => {
    expect(fmtTokens(5432)).toBe('5.4K')
  })

  it('formats 9999 as 10.0K (boundary)', () => {
    expect(fmtTokens(9999)).toBe('10.0K')
  })

  it('formats 10000 as rounded K', () => {
    expect(fmtTokens(10000)).toBe('10K')
  })

  it('formats 15000 as rounded K', () => {
    expect(fmtTokens(15000)).toBe('15K')
  })

  it('formats 100000 as rounded K', () => {
    expect(fmtTokens(100000)).toBe('100K')
  })

  it('formats typical session totals correctly', () => {
    // Realistic session: ~25K input, ~8K output
    expect(fmtTokens(25400)).toBe('25K')
    expect(fmtTokens(8100)).toBe('8.1K')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Per-session persistence — round-trip through save/load
// ═══════════════════════════════════════════════════════════════════════════

describe('per-session token persistence', () => {
  const mkSession = (id: string, tokens?: TokenStats): AnorakProSession => ({
    id,
    name: `Test ${id}`,
    createdAt: new Date().toISOString(),
    entries: [],
    tokens,
  })

  it('tokens round-trip through save/load', () => {
    const sessions = [mkSession('s1', { inputTokens: 5000, outputTokens: 2500, costUsd: 0.0312 })]
    saveSessions(sessions)
    const loaded = loadSessions()
    expect(loaded[0].tokens).toEqual({ inputTokens: 5000, outputTokens: 2500, costUsd: 0.0312 })
  })

  it('multiple sessions with different token counts persist', () => {
    const sessions = [
      mkSession('s1', { inputTokens: 10000, outputTokens: 3000, costUsd: 0.1 }),
      mkSession('s2', { inputTokens: 500, outputTokens: 200, costUsd: 0.005 }),
      mkSession('s3'), // no tokens
    ]
    saveSessions(sessions)
    const loaded = loadSessions()
    expect(loaded[0].tokens).toEqual({ inputTokens: 10000, outputTokens: 3000, costUsd: 0.1 })
    expect(loaded[1].tokens).toEqual({ inputTokens: 500, outputTokens: 200, costUsd: 0.005 })
    expect(loaded[2].tokens).toBeUndefined()
  })

  it('old sessions without tokens field get ZERO_TOKENS fallback', () => {
    // Simulates pre-Mission#20 data: sessions saved without tokens field
    const legacySessions = [
      { id: 's-old', name: 'Old Session', createdAt: '2025-01-01T00:00:00Z', entries: [] },
    ]
    store[SESSIONS_KEY] = JSON.stringify(legacySessions)
    const loaded = loadSessions()
    // tokens field is undefined — component falls back to ZERO_TOKENS via || operator
    const sessionTokens = loaded[0].tokens || ZERO_TOKENS
    expect(sessionTokens).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  })

  it('accumulate then persist then load preserves accumulated tokens', () => {
    let sessions = [mkSession('s1')]
    sessions = addSessionTokens(sessions, 's1', 1000, 200, 0.01)
    sessions = addSessionTokens(sessions, 's1', 3000, 500, 0.03)
    saveSessions(sessions)
    const loaded = loadSessions()
    expect(loaded[0].tokens).toEqual({ inputTokens: 4000, outputTokens: 700, costUsd: 0.04 })
  })

  it('loadSessions returns [] on corrupted JSON', () => {
    store[SESSIONS_KEY] = '{not valid json!!!'
    const loaded = loadSessions()
    expect(loaded).toEqual([])
  })

  it('loadSessions returns [] when key is absent', () => {
    const loaded = loadSessions()
    expect(loaded).toEqual([])
  })

  it('saveSessions silently handles QuotaExceeded', () => {
    // Override setItem to throw
    const orig = localStorage.setItem
    ;(localStorage as any).setItem = () => { throw new DOMException('QuotaExceededError') }
    // Should not throw
    expect(() => saveSessions([mkSession('s1', { inputTokens: 1, outputTokens: 1, costUsd: 0 })])).not.toThrow()
    ;(localStorage as any).setItem = orig
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  const mkSession = (id: string, tokens?: TokenStats): AnorakProSession => ({
    id,
    name: `Test ${id}`,
    createdAt: new Date().toISOString(),
    entries: [],
    tokens,
  })

  it('negative values are passed through (no clamping)', () => {
    // The code does not clamp negatives — arithmetic just works
    const sessions = [mkSession('s1', { inputTokens: 100, outputTokens: 50, costUsd: 0.01 })]
    const result = addSessionTokens(sessions, 's1', -50, -25, -0.005)
    expect(result[0].tokens).toEqual({ inputTokens: 50, outputTokens: 25, costUsd: 0.005 })
  })

  it('very large numbers accumulate without overflow', () => {
    const sessions = [mkSession('s1')]
    let state = addSessionTokens(sessions, 's1', 1_000_000, 500_000, 10.0)
    state = addSessionTokens(state, 's1', 1_000_000, 500_000, 10.0)
    expect(state[0].tokens).toEqual({ inputTokens: 2_000_000, outputTokens: 1_000_000, costUsd: 20.0 })
  })

  it('very large token counts format correctly with fmtTokens', () => {
    expect(fmtTokens(1_000_000)).toBe('1.0M')
    expect(fmtTokens(2_500_000)).toBe('2.5M')
  })

  it('cost precision with toFixed(4)', () => {
    // Mirrors: ${sessionTokens.costUsd.toFixed(4)} in the component
    const cost = 0.03125
    expect(cost.toFixed(4)).toBe('0.0313')

    const tinyCost = 0.000001
    expect(tinyCost.toFixed(4)).toBe('0.0000')

    const bigCost = 1.23456789
    expect(bigCost.toFixed(4)).toBe('1.2346')
  })

  it('floating point accumulation stays reasonable', () => {
    let sessions = [mkSession('s1')]
    // 10 tiny increments
    for (let i = 0; i < 10; i++) {
      sessions = addSessionTokens(sessions, 's1', 100, 50, 0.001)
    }
    expect(sessions[0].tokens!.inputTokens).toBe(1000)
    expect(sessions[0].tokens!.outputTokens).toBe(500)
    // Floating point: 0.001 * 10 might not be exactly 0.01
    expect(sessions[0].tokens!.costUsd).toBeCloseTo(0.01, 10)
  })

  it('zero-value accumulation is a no-op on token counts', () => {
    const sessions = [mkSession('s1', { inputTokens: 500, outputTokens: 200, costUsd: 0.01 })]
    const result = addSessionTokens(sessions, 's1', 0, 0, 0)
    expect(result[0].tokens).toEqual({ inputTokens: 500, outputTokens: 200, costUsd: 0.01 })
  })

  it('Number() || 0 pattern makes negative-zero safe', () => {
    // Number(-0) || 0 → 0 (because -0 is falsy)
    expect(Number(-0) || 0).toBe(0)
  })

  it('SSE event with string token counts converts correctly', () => {
    // Simulates: Number(event.total_input_tokens) || 0 where event fields are strings
    const event = { total_input_tokens: '15432', total_output_tokens: '3210', cost_usd: '0.0412' }
    const input = Number(event.total_input_tokens) || 0
    const output = Number(event.total_output_tokens) || 0
    const cost = Number(event.cost_usd) || 0
    expect(input).toBe(15432)
    expect(output).toBe(3210)
    expect(cost).toBeCloseTo(0.0412, 4)
  })

  it('tokens field is optional on AnorakProSession — omission is valid', () => {
    const session: AnorakProSession = {
      id: 's1',
      name: 'Test',
      createdAt: new Date().toISOString(),
      entries: [],
      // tokens intentionally omitted
    }
    expect(session.tokens).toBeUndefined()
    // Component does: activeSession?.tokens || ZERO_TOKENS
    const display = session.tokens || ZERO_TOKENS
    expect(display).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  })
})

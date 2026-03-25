// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL MISSIONS TESTS — parseHistory + data constants
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ── Copy of parseHistory (not exported from component) ──────────────────
// Mirrors src/components/forge/ParzivalMissions.tsx parseHistory exactly

interface HistoryEntry {
  timestamp?: string
  actor?: string
  action?: string
  curatorMsg?: string
  silicondevMsg?: string
  silicondevConfidence?: number
  flawlessPercent?: number
  fromLevel?: number
  toLevel?: number
  verdict?: string
  rating?: number
  carbondevMsg?: string
  mature?: boolean
  carbonSeconds?: number
  comment?: string
}

function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// ── Constants mirrored from component ───────────────────────────────────
const MATURITY_COLORS = ['#666', '#818cf8', '#a855f7', '#f59e0b']
const MATURITY_LABELS = ['🌑 para', '🌘 pashyanti', '🌗 madhyama', '🌕 vaikhari']

// ═════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════

describe('parseHistory', () => {
  it('returns empty array for null input', () => {
    expect(parseHistory(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseHistory('')).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseHistory('not json at all')).toEqual([])
  })

  it('returns empty array for truncated JSON', () => {
    expect(parseHistory('[{"actor":"curator"')).toEqual([])
  })

  it('returns empty array when JSON parses to a non-array (object)', () => {
    expect(parseHistory('{"actor":"curator"}')).toEqual([])
  })

  it('returns empty array when JSON parses to a non-array (string)', () => {
    expect(parseHistory('"just a string"')).toEqual([])
  })

  it('returns empty array when JSON parses to a non-array (number)', () => {
    expect(parseHistory('42')).toEqual([])
  })

  it('returns empty array when JSON parses to null literal', () => {
    expect(parseHistory('null')).toEqual([])
  })

  it('parses a valid single-entry array', () => {
    const input = JSON.stringify([{ actor: 'curator', curatorMsg: 'review this' }])
    const result = parseHistory(input)
    expect(result).toHaveLength(1)
    expect(result[0].actor).toBe('curator')
    expect(result[0].curatorMsg).toBe('review this')
  })

  it('parses a multi-entry history with mixed actors', () => {
    const entries: HistoryEntry[] = [
      { actor: 'curator', curatorMsg: 'first pass', flawlessPercent: 40 },
      { actor: 'carbondev', verdict: 'accept', rating: 8, mature: true, carbonSeconds: 120 },
      { actor: 'curator', curatorMsg: 'second pass', silicondevMsg: 'looks good', silicondevConfidence: 0.85 },
    ]
    const result = parseHistory(JSON.stringify(entries))
    expect(result).toHaveLength(3)
    expect(result[0].flawlessPercent).toBe(40)
    expect(result[1].verdict).toBe('accept')
    expect(result[1].carbonSeconds).toBe(120)
    expect(result[2].silicondevConfidence).toBe(0.85)
  })

  it('preserves all optional fields when present', () => {
    const full: HistoryEntry = {
      timestamp: '2026-03-23T12:00:00Z',
      actor: 'curator',
      action: 'review',
      curatorMsg: 'msg',
      silicondevMsg: 'prediction',
      silicondevConfidence: 0.9,
      flawlessPercent: 75,
      fromLevel: 1,
      toLevel: 2,
      verdict: 'modify',
      rating: 7,
      carbondevMsg: 'my edit',
      mature: false,
      carbonSeconds: 45,
      comment: 'needs work',
    }
    const result = parseHistory(JSON.stringify([full]))
    expect(result[0]).toEqual(full)
  })

  it('handles empty array JSON', () => {
    expect(parseHistory('[]')).toEqual([])
  })

  it('handles entries with no recognized fields (extra fields pass through)', () => {
    const input = JSON.stringify([{ unknownField: 'value', anotherOne: 123 }])
    const result = parseHistory(input)
    expect(result).toHaveLength(1)
    // parseHistory does no validation — extra fields survive
    expect((result[0] as Record<string, unknown>)['unknownField']).toBe('value')
  })
})

describe('Maturity constants', () => {
  it('has 4 maturity colors', () => {
    expect(MATURITY_COLORS).toHaveLength(4)
  })

  it('has 4 maturity labels', () => {
    expect(MATURITY_LABELS).toHaveLength(4)
  })

  it('colors and labels arrays are same length', () => {
    expect(MATURITY_COLORS.length).toBe(MATURITY_LABELS.length)
  })

  it('all colors are valid hex strings', () => {
    for (const color of MATURITY_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{3,8}$/i)
    }
  })

  it('labels contain level names in order: para, pashyanti, madhyama, vaikhari', () => {
    expect(MATURITY_LABELS[0]).toContain('para')
    expect(MATURITY_LABELS[1]).toContain('pashyanti')
    expect(MATURITY_LABELS[2]).toContain('madhyama')
    expect(MATURITY_LABELS[3]).toContain('vaikhari')
  })
})

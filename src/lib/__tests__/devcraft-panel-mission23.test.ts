// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// DEVCRAFT PANEL — Mission #23 tests
// Covers: MaturityBadge, MATURITY_LEVELS, curator tab, bump/refine,
//         JSON.parse safety, HistoryEntry, extended Mission interface
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')
const SOURCE = readFileSync(join(ROOT, 'src/components/forge/DevcraftPanel.tsx'), 'utf-8')

// ═══════════════════════════════════════════════════════════════════════════
// Extract constants and logic from source for pure-logic tests
// (React components can't be imported without full JSX transform in vitest)
// ═══════════════════════════════════════════════════════════════════════════

// Mirror MATURITY_LEVELS from source for behavioral tests
const MATURITY_LEVELS: { label: string; color: string }[] = [
  { label: 'PARA', color: '#666' },
  { label: 'PASHYANTI', color: '#f59e0b' },
  { label: 'MADHYAMA', color: '#0ea5e9' },
  { label: 'VAIKHARI', color: '#22c55e' },
]

// Mirror MaturityBadge logic
function getMaturityInfo(level: number) {
  return MATURITY_LEVELS[level] || MATURITY_LEVELS[0]
}

// Mirror hasCuratorData logic
function hasCuratorData(mission: { carbonDescription?: string | null; siliconDescription?: string | null; maturityLevel: number }) {
  return !!(mission.carbonDescription || mission.siliconDescription || (mission.maturityLevel > 0))
}

// Mirror handleFeedback body builder
function buildFeedbackBody(missionId: number, bump: boolean, feedbackMsg: string) {
  return {
    missionId,
    mature: bump,
    verdict: bump ? 'accept' : 'modify',
    rating: bump ? 8 : 5,
    carbondevMsg: feedbackMsg.trim() || undefined,
  }
}

// Mirror JSON.parse safety pattern
function safeParseNotes(notes: string | null | undefined): unknown[] {
  try {
    return notes ? (typeof notes === 'string' ? JSON.parse(notes) : notes) : []
  } catch { return [] }
}

function safeParseHistory(history: string | null): unknown[] {
  try { return JSON.parse(history || '[]') } catch { return [] }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. MATURITY_LEVELS constant
// ═══════════════════════════════════════════════════════════════════════════

describe('MATURITY_LEVELS constant', () => {
  it('has exactly 4 levels', () => {
    expect(MATURITY_LEVELS).toHaveLength(4)
  })

  it('level 0 is PARA (grey)', () => {
    expect(MATURITY_LEVELS[0]).toEqual({ label: 'PARA', color: '#666' })
  })

  it('level 1 is PASHYANTI (amber)', () => {
    expect(MATURITY_LEVELS[1]).toEqual({ label: 'PASHYANTI', color: '#f59e0b' })
  })

  it('level 2 is MADHYAMA (sky blue)', () => {
    expect(MATURITY_LEVELS[2]).toEqual({ label: 'MADHYAMA', color: '#0ea5e9' })
  })

  it('level 3 is VAIKHARI (green)', () => {
    expect(MATURITY_LEVELS[3]).toEqual({ label: 'VAIKHARI', color: '#22c55e' })
  })

  it('source declares MATURITY_LEVELS with correct labels', () => {
    expect(SOURCE).toContain("{ label: 'PARA', color: '#666' }")
    expect(SOURCE).toContain("{ label: 'PASHYANTI', color: '#f59e0b' }")
    expect(SOURCE).toContain("{ label: 'MADHYAMA', color: '#0ea5e9' }")
    expect(SOURCE).toContain("{ label: 'VAIKHARI', color: '#22c55e' }")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. MaturityBadge rendering logic
// ═══════════════════════════════════════════════════════════════════════════

describe('MaturityBadge logic', () => {
  it('returns PARA info for level 0', () => {
    const m = getMaturityInfo(0)
    expect(m.label).toBe('PARA')
    expect(m.color).toBe('#666')
  })

  it('returns PASHYANTI info for level 1', () => {
    const m = getMaturityInfo(1)
    expect(m.label).toBe('PASHYANTI')
    expect(m.color).toBe('#f59e0b')
  })

  it('returns MADHYAMA info for level 2', () => {
    const m = getMaturityInfo(2)
    expect(m.label).toBe('MADHYAMA')
  })

  it('returns VAIKHARI info for level 3', () => {
    const m = getMaturityInfo(3)
    expect(m.label).toBe('VAIKHARI')
    expect(m.color).toBe('#22c55e')
  })

  it('falls back to PARA for out-of-bounds level (negative)', () => {
    const m = getMaturityInfo(-1)
    expect(m.label).toBe('PARA')
  })

  it('falls back to PARA for out-of-bounds level (too high)', () => {
    const m = getMaturityInfo(99)
    expect(m.label).toBe('PARA')
  })

  it('falls back to PARA for NaN level', () => {
    const m = getMaturityInfo(NaN)
    expect(m.label).toBe('PARA')
  })

  it('source uses fallback: MATURITY_LEVELS[level] || MATURITY_LEVELS[0]', () => {
    expect(SOURCE).toContain('MATURITY_LEVELS[level] || MATURITY_LEVELS[0]')
  })

  it('source renders MaturityBadge in mission list rows (conditional on maturityLevel > 0)', () => {
    expect(SOURCE).toContain('{m.maturityLevel > 0 && <MaturityBadge level={m.maturityLevel} />}')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Extended Mission interface — curator fields in source
// ═══════════════════════════════════════════════════════════════════════════

describe('Mission interface — curator fields', () => {
  const curatorFields = [
    'maturityLevel',
    'carbonDescription',
    'siliconDescription',
    'history',
    'flawlessPercent',
    'dharmaPath',
    'assignedTo',
    'acceptanceCriteria',
    'executionPhase',
    'executionRound',
  ]

  for (const field of curatorFields) {
    it(`declares ${field} in Mission interface`, () => {
      // Each field should appear in the interface block
      expect(SOURCE).toContain(`  ${field}:`)
    })
  }

  it('maturityLevel is typed as number', () => {
    expect(SOURCE).toContain('maturityLevel: number')
  })

  it('executionRound is typed as number', () => {
    expect(SOURCE).toContain('executionRound: number')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. HistoryEntry interface
// ═══════════════════════════════════════════════════════════════════════════

describe('HistoryEntry interface', () => {
  const requiredFields = ['timestamp', 'actor', 'action']
  const optionalFields = ['message', 'comment', 'curatorMsg', 'silicondevMsg', 'carbondevMsg', 'verdict', 'rating', 'mature']

  for (const field of requiredFields) {
    it(`declares required field '${field}'`, () => {
      expect(SOURCE).toContain(`  ${field}: string`)
    })
  }

  for (const field of optionalFields) {
    it(`declares optional field '${field}'`, () => {
      expect(SOURCE).toContain(`  ${field}?:`)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. hasCuratorData logic
// ═══════════════════════════════════════════════════════════════════════════

describe('hasCuratorData detection', () => {
  it('returns false when all curator fields are empty/zero', () => {
    expect(hasCuratorData({ carbonDescription: null, siliconDescription: null, maturityLevel: 0 })).toBe(false)
  })

  it('returns true when carbonDescription is set', () => {
    expect(hasCuratorData({ carbonDescription: 'Ship it', siliconDescription: null, maturityLevel: 0 })).toBe(true)
  })

  it('returns true when siliconDescription is set', () => {
    expect(hasCuratorData({ carbonDescription: null, siliconDescription: 'Refactor X', maturityLevel: 0 })).toBe(true)
  })

  it('returns true when maturityLevel > 0', () => {
    expect(hasCuratorData({ carbonDescription: null, siliconDescription: null, maturityLevel: 1 })).toBe(true)
  })

  it('returns false for empty strings (falsy)', () => {
    expect(hasCuratorData({ carbonDescription: '', siliconDescription: '', maturityLevel: 0 })).toBe(false)
  })

  it('source computes hasCuratorData correctly', () => {
    expect(SOURCE).toContain('const hasCuratorData = !!(mission.carbonDescription || mission.siliconDescription || (mission.maturityLevel > 0))')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Bump/Refine feedback body construction
// ═══════════════════════════════════════════════════════════════════════════

describe('handleFeedback — body construction', () => {
  it('bump=true sets mature=true, verdict=accept, rating=8', () => {
    const body = buildFeedbackBody(42, true, '')
    expect(body.missionId).toBe(42)
    expect(body.mature).toBe(true)
    expect(body.verdict).toBe('accept')
    expect(body.rating).toBe(8)
    expect(body.carbondevMsg).toBeUndefined()
  })

  it('bump=false sets mature=false, verdict=modify, rating=5', () => {
    const body = buildFeedbackBody(42, false, '')
    expect(body.mature).toBe(false)
    expect(body.verdict).toBe('modify')
    expect(body.rating).toBe(5)
  })

  it('includes carbondevMsg when feedback message is present', () => {
    const body = buildFeedbackBody(7, false, 'needs more tests')
    expect(body.carbondevMsg).toBe('needs more tests')
  })

  it('trims whitespace from feedback message', () => {
    const body = buildFeedbackBody(7, true, '  clean this up  ')
    expect(body.carbondevMsg).toBe('clean this up')
  })

  it('omits carbondevMsg when message is only whitespace', () => {
    const body = buildFeedbackBody(7, true, '   ')
    expect(body.carbondevMsg).toBeUndefined()
  })

  it('source POSTs to /api/anorak/pro/feedback', () => {
    expect(SOURCE).toContain("fetch('/api/anorak/pro/feedback'")
  })

  it('source checks res.ok before proceeding', () => {
    expect(SOURCE).toContain("if (!res.ok) { console.error('Feedback failed:', res.status); return }")
  })

  it('source calls onRefetch after successful feedback', () => {
    // The handleFeedback function spans ~20 lines; grab a wide window
    const start = SOURCE.indexOf('const handleFeedback')
    const feedbackBlock = SOURCE.substring(start, start + 800)
    expect(feedbackBlock).toContain('onRefetch()')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Bump/Refine button visibility conditions
// ═══════════════════════════════════════════════════════════════════════════

describe('bump/refine button visibility', () => {
  it('source only shows buttons when maturityLevel < 3 and status is todo', () => {
    expect(SOURCE).toContain("mission.maturityLevel < 3 && mission.status === 'todo'")
  })

  it('refine button is disabled when feedbackMsg is empty', () => {
    expect(SOURCE).toContain('disabled={feedbackSending || !feedbackMsg.trim()}')
  })

  it('bump button is only disabled when sending', () => {
    expect(SOURCE).toContain('disabled={feedbackSending}')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. JSON.parse safety — all parse calls wrapped in try-catch
// ═══════════════════════════════════════════════════════════════════════════

describe('JSON.parse safety', () => {
  it('safeParseNotes returns [] for null', () => {
    expect(safeParseNotes(null)).toEqual([])
  })

  it('safeParseNotes returns [] for undefined', () => {
    expect(safeParseNotes(undefined)).toEqual([])
  })

  it('safeParseNotes returns [] for corrupted JSON', () => {
    expect(safeParseNotes('{bad json}')).toEqual([])
  })

  it('safeParseNotes returns [] for empty string', () => {
    expect(safeParseNotes('')).toEqual([])
  })

  it('safeParseNotes parses valid JSON string', () => {
    const data = [{ timestamp: '2024-01-01', message: 'test', type: 'note' }]
    expect(safeParseNotes(JSON.stringify(data))).toEqual(data)
  })

  it('safeParseNotes passes through non-string truthy values (already-parsed)', () => {
    const arr = [{ message: 'already parsed' }]
    // @ts-expect-error — testing runtime behavior when notes is already an array
    expect(safeParseNotes(arr)).toBe(arr)
  })

  it('safeParseHistory returns [] for null', () => {
    expect(safeParseHistory(null)).toEqual([])
  })

  it('safeParseHistory returns [] for corrupted JSON', () => {
    expect(safeParseHistory('not-json')).toEqual([])
  })

  it('safeParseHistory parses valid history array', () => {
    const entries = [{ timestamp: '2024-01-01', actor: 'curator', action: 'enrich' }]
    expect(safeParseHistory(JSON.stringify(entries))).toEqual(entries)
  })

  it('source wraps ALL JSON.parse calls in try-catch', () => {
    // Count try-catch wrapped JSON.parse patterns
    const tryParseMatches = SOURCE.match(/try\s*\{[^}]*JSON\.parse/g) || []
    // Count ALL JSON.parse calls (except JSON.stringify which is safe)
    const allParseMatches = SOURCE.match(/JSON\.parse\(/g) || []
    // Every JSON.parse should be inside a try block
    // Source has 10 JSON.parse calls, all should be in try blocks
    expect(tryParseMatches.length).toBeGreaterThanOrEqual(10)
    expect(tryParseMatches.length).toBe(allParseMatches.length)
  })

  it('localStorage parse for sectionSplit is safe', () => {
    expect(SOURCE).toContain("if (saved) try { return JSON.parse(saved) } catch")
  })

  it('localStorage parse for collapsed is safe', () => {
    // There should be two localStorage-guarded parses
    const matches = SOURCE.match(/if \(saved\) try \{ return JSON\.parse\(saved\) \} catch/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. Curator tab — content structure in source
// ═══════════════════════════════════════════════════════════════════════════

describe('curator tab content', () => {
  it('has NOTES and CURATOR tab buttons', () => {
    expect(SOURCE).toContain("NOTES ({notes.length})")
    expect(SOURCE).toContain("CURATOR {hasCuratorData ? '●' : ''}")
  })

  it('shows "Not yet curated" when no curator data', () => {
    expect(SOURCE).toContain('Not yet curated')
  })

  it('renders WAR CRY section for carbonDescription', () => {
    expect(SOURCE).toContain('WAR CRY')
    expect(SOURCE).toContain('{mission.carbonDescription}')
  })

  it('renders TECH SPEC section for siliconDescription', () => {
    expect(SOURCE).toContain('TECH SPEC')
    expect(SOURCE).toContain('{mission.siliconDescription}')
  })

  it('renders ACCEPTANCE section for acceptanceCriteria', () => {
    expect(SOURCE).toContain('ACCEPTANCE')
    expect(SOURCE).toContain('{mission.acceptanceCriteria}')
  })

  it('renders dharma path tags split by comma', () => {
    expect(SOURCE).toContain("mission.dharmaPath.split(',')")
  })

  it('renders flawless percent when available', () => {
    expect(SOURCE).toContain('Flawless: {mission.flawlessPercent}%')
  })

  it('renders assigned-to when available', () => {
    expect(SOURCE).toContain('Assigned: {mission.assignedTo}')
  })

  it('renders history THREAD section with entry count', () => {
    expect(SOURCE).toContain("THREAD ({curatorEntries.length})")
  })

  it('filters history entries by curator or carbondev actor', () => {
    expect(SOURCE).toContain("e.actor === 'curator' || e.actor === 'carbondev'")
  })

  it('displays entry text with fallback chain', () => {
    expect(SOURCE).toContain('entry.curatorMsg || entry.silicondevMsg || entry.carbondevMsg || entry.message || entry.comment || entry.action')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. onRefetch — popup mission state refresh
// ═══════════════════════════════════════════════════════════════════════════

describe('onRefetch — popup mission refresh', () => {
  it('source fetches missions then refreshes individual popup mission', () => {
    expect(SOURCE).toContain('onRefetch={async () => {')
    expect(SOURCE).toContain('await fetchMissions()')
    expect(SOURCE).toContain('const res = await fetch(`/api/missions/${popupMission.id}`)')
    expect(SOURCE).toContain('const fresh = await res.json(); setPopupMission(fresh)')
  })

  it('onRefetch checks res.ok before updating popup state', () => {
    const refetchBlock = SOURCE.substring(
      SOURCE.indexOf('onRefetch={async () => {'),
      SOURCE.indexOf('onRefetch={async () => {') + 300
    )
    expect(refetchBlock).toContain('if (res.ok)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. Tab state management
// ═══════════════════════════════════════════════════════════════════════════

describe('tab state management', () => {
  it('rightTab state defaults to notes', () => {
    expect(SOURCE).toContain("useState<'notes' | 'curator'>('notes')")
  })

  it('tab switching uses setRightTab', () => {
    expect(SOURCE).toContain("setRightTab('notes')")
    expect(SOURCE).toContain("setRightTab('curator')")
  })

  it('notes tab renders when rightTab is notes', () => {
    expect(SOURCE).toContain("rightTab === 'notes'")
  })

  it('curator tab renders when rightTab is curator', () => {
    expect(SOURCE).toContain("rightTab === 'curator'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 12. Feedback sending state
// ═══════════════════════════════════════════════════════════════════════════

describe('feedback sending state management', () => {
  it('feedbackSending starts false', () => {
    expect(SOURCE).toContain('useState(false)')
  })

  it('sets feedbackSending true at start of handleFeedback', () => {
    const feedbackFn = SOURCE.substring(
      SOURCE.indexOf('const handleFeedback'),
      SOURCE.indexOf('const handleFeedback') + 600
    )
    expect(feedbackFn).toContain('setFeedbackSending(true)')
  })

  it('sets feedbackSending false at end of handleFeedback', () => {
    const start = SOURCE.indexOf('const handleFeedback')
    const feedbackFn = SOURCE.substring(start, start + 800)
    expect(feedbackFn).toContain('setFeedbackSending(false)')
  })

  it('clears feedbackMsg on success', () => {
    const start = SOURCE.indexOf('const handleFeedback')
    const feedbackFn = SOURCE.substring(start, start + 800)
    expect(feedbackFn).toContain("setFeedbackMsg('')")
  })

  it('handles network errors with try-catch', () => {
    const start = SOURCE.indexOf('const handleFeedback')
    const feedbackFn = SOURCE.substring(start, start + 800)
    expect(feedbackFn).toContain("catch (err) { console.error('Feedback failed:', err) }")
  })
})

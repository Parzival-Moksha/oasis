// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO LOBE FILTERS — Unit tests for Mission #19
// Tests: default state, toggle logic, filter application, persistence,
//        count display, edge cases (unknown lobes, corrupted localStorage)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Mirror pure logic from AnorakProPanel.tsx — no React deps needed
// ═══════════════════════════════════════════════════════════════════════════

const LOBE_FILTER_KEY = 'oasis-anorak-pro-lobe-filters'

const LOBE_COLORS: Record<string, string> = {
  'anorak-pro': '#14b8a6',
  curator: '#f59e0b',
  coder: '#ef4444',
  reviewer: '#3b82f6',
  tester: '#22c55e',
  carbondev: '#60a5fa',
}

interface StreamEntry {
  id: number
  type: string
  content: string
  lobe: string
  timestamp: number
}

// Mirror: init from localStorage
function loadLobeFilters(storage: { getItem: (k: string) => string | null }): Record<string, boolean> {
  try {
    const s = storage.getItem(LOBE_FILTER_KEY)
    return s ? JSON.parse(s) : {}
  } catch {
    return {}
  }
}

// Mirror: toggle lobe visibility
function toggleLobe(prev: Record<string, boolean>, lobe: string): Record<string, boolean> {
  return { ...prev, [lobe]: prev[lobe] === false ? true : false }
}

// Mirror: persist to localStorage
function persistLobeFilters(
  storage: { setItem: (k: string, v: string) => void },
  filters: Record<string, boolean>,
): void {
  try {
    storage.setItem(LOBE_FILTER_KEY, JSON.stringify(filters))
  } catch { /* swallowed, same as source */ }
}

// Mirror: filter entries by lobe visibility
function filterEntries(entries: StreamEntry[], visibleLobes: Record<string, boolean>): StreamEntry[] {
  return entries.filter(e => visibleLobes[e.lobe] !== false)
}

// Helper to build entries
function mkEntry(id: number, lobe: string, content = ''): StreamEntry {
  return { id, type: 'text', content, lobe, timestamp: Date.now() }
}


// ═══════════════════════════════════════════════════════════════════════════
// 1. DEFAULT STATE
// ═══════════════════════════════════════════════════════════════════════════

describe('Lobe Filters — Default State', () => {
  it('returns empty object when localStorage has no key', () => {
    const storage = { getItem: () => null }
    expect(loadLobeFilters(storage)).toEqual({})
  })

  it('empty object means ALL lobes are visible (opt-out pattern)', () => {
    const filters: Record<string, boolean> = {}
    const lobeKeys = Object.keys(LOBE_COLORS)
    for (const lobe of lobeKeys) {
      expect(filters[lobe] !== false).toBe(true)
    }
  })

  it('undefined !== false evaluates to true for every known lobe', () => {
    const filters: Record<string, boolean> = {}
    expect(filters['anorak-pro'] !== false).toBe(true)
    expect(filters['curator'] !== false).toBe(true)
    expect(filters['coder'] !== false).toBe(true)
    expect(filters['reviewer'] !== false).toBe(true)
    expect(filters['tester'] !== false).toBe(true)
    expect(filters['carbondev'] !== false).toBe(true)
  })

  it('all entries pass filter when visibleLobes is empty', () => {
    const entries = [
      mkEntry(1, 'curator'),
      mkEntry(2, 'coder'),
      mkEntry(3, 'reviewer'),
      mkEntry(4, 'tester'),
      mkEntry(5, 'anorak-pro'),
      mkEntry(6, 'carbondev'),
    ]
    const result = filterEntries(entries, {})
    expect(result).toHaveLength(6)
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// 2. TOGGLE LOGIC
// ═══════════════════════════════════════════════════════════════════════════

describe('Lobe Filters — Toggle Logic', () => {
  it('toggling a visible (undefined) lobe sets it to false', () => {
    const prev: Record<string, boolean> = {}
    const next = toggleLobe(prev, 'curator')
    expect(next.curator).toBe(false)
  })

  it('toggling a hidden (false) lobe sets it to true', () => {
    const prev: Record<string, boolean> = { curator: false }
    const next = toggleLobe(prev, 'curator')
    expect(next.curator).toBe(true)
  })

  it('toggling an explicitly true lobe sets it to false', () => {
    // When prev[lobe] === true, (true === false) => false, so returns false
    const prev: Record<string, boolean> = { coder: true }
    const next = toggleLobe(prev, 'coder')
    expect(next.coder).toBe(false)
  })

  it('double toggle returns to visible (true, not undefined)', () => {
    let state: Record<string, boolean> = {}
    state = toggleLobe(state, 'reviewer')
    expect(state.reviewer).toBe(false)
    state = toggleLobe(state, 'reviewer')
    expect(state.reviewer).toBe(true)
  })

  it('toggling one lobe does not affect others', () => {
    const prev: Record<string, boolean> = { curator: false, coder: true }
    const next = toggleLobe(prev, 'curator')
    expect(next.curator).toBe(true)
    expect(next.coder).toBe(true) // unchanged
  })

  it('toggle is pure — does not mutate prev', () => {
    const prev: Record<string, boolean> = { tester: false }
    const next = toggleLobe(prev, 'tester')
    expect(prev.tester).toBe(false) // original unchanged
    expect(next.tester).toBe(true)
    expect(prev).not.toBe(next)
  })

  it('toggleLobe handles all LOBE_COLORS keys', () => {
    let state: Record<string, boolean> = {}
    for (const lobe of Object.keys(LOBE_COLORS)) {
      state = toggleLobe(state, lobe)
    }
    // All should be false after first toggle from undefined
    for (const lobe of Object.keys(LOBE_COLORS)) {
      expect(state[lobe]).toBe(false)
    }
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// 3. FILTER APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Lobe Filters — Filter Application', () => {
  const entries = [
    mkEntry(1, 'curator', 'curate stuff'),
    mkEntry(2, 'coder', 'write code'),
    mkEntry(3, 'reviewer', 'review code'),
    mkEntry(4, 'tester', 'run tests'),
    mkEntry(5, 'anorak-pro', 'orchestrate'),
    mkEntry(6, 'carbondev', 'dev carbon'),
  ]

  it('filters out entries whose lobe is set to false', () => {
    const filters = { curator: false }
    const result = filterEntries(entries, filters)
    expect(result).toHaveLength(5)
    expect(result.find(e => e.lobe === 'curator')).toBeUndefined()
  })

  it('filters out multiple lobes', () => {
    const filters = { curator: false, coder: false, tester: false }
    const result = filterEntries(entries, filters)
    expect(result).toHaveLength(3)
    expect(result.map(e => e.lobe).sort()).toEqual(['anorak-pro', 'carbondev', 'reviewer'])
  })

  it('keeps entries whose lobe is explicitly true', () => {
    const filters = { curator: true, coder: false }
    const result = filterEntries(entries, filters)
    expect(result).toHaveLength(5)
    expect(result.find(e => e.lobe === 'curator')).toBeDefined()
    expect(result.find(e => e.lobe === 'coder')).toBeUndefined()
  })

  it('keeps entries whose lobe is not in filters (undefined !== false)', () => {
    const filters = { curator: false }
    const result = filterEntries(entries, filters)
    // 'anorak-pro' not in filters => visible
    expect(result.find(e => e.lobe === 'anorak-pro')).toBeDefined()
  })

  it('returns empty array when all lobes are filtered out', () => {
    const filters: Record<string, boolean> = {}
    for (const lobe of Object.keys(LOBE_COLORS)) {
      filters[lobe] = false
    }
    const result = filterEntries(entries, filters)
    expect(result).toHaveLength(0)
  })

  it('returns all entries when no lobes are filtered', () => {
    const result = filterEntries(entries, {})
    expect(result).toHaveLength(entries.length)
  })

  it('preserves entry order after filtering', () => {
    const filters = { coder: false, tester: false }
    const result = filterEntries(entries, filters)
    const ids = result.map(e => e.id)
    expect(ids).toEqual([1, 3, 5, 6])
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// 4. PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

describe('Lobe Filters — Persistence', () => {
  let mockStorage: Record<string, string>

  beforeEach(() => {
    mockStorage = {}
  })

  const storage = {
    getItem: (k: string) => mockStorage[k] ?? null,
    setItem: (k: string, v: string) => { mockStorage[k] = v },
  }

  it('persists toggle state to localStorage', () => {
    const state = toggleLobe({}, 'curator')
    persistLobeFilters(storage, state)
    expect(mockStorage[LOBE_FILTER_KEY]).toBe(JSON.stringify({ curator: false }))
  })

  it('loads persisted state from localStorage', () => {
    mockStorage[LOBE_FILTER_KEY] = JSON.stringify({ coder: false, reviewer: true })
    const loaded = loadLobeFilters(storage)
    expect(loaded).toEqual({ coder: false, reviewer: true })
  })

  it('round-trips: persist then load returns same state', () => {
    const state = { curator: false, coder: true, tester: false }
    persistLobeFilters(storage, state)
    const loaded = loadLobeFilters(storage)
    expect(loaded).toEqual(state)
  })

  it('round-trips through multiple toggles', () => {
    let state: Record<string, boolean> = {}
    state = toggleLobe(state, 'curator')       // curator: false
    state = toggleLobe(state, 'coder')          // coder: false
    state = toggleLobe(state, 'curator')        // curator: true
    persistLobeFilters(storage, state)
    const loaded = loadLobeFilters(storage)
    expect(loaded.curator).toBe(true)
    expect(loaded.coder).toBe(false)
  })

  it('uses correct localStorage key', () => {
    persistLobeFilters(storage, { reviewer: false })
    expect(LOBE_FILTER_KEY).toBe('oasis-anorak-pro-lobe-filters')
    expect(mockStorage['oasis-anorak-pro-lobe-filters']).toBeDefined()
  })

  it('swallows setItem errors gracefully', () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    }
    expect(() => persistLobeFilters(throwingStorage, { coder: false })).not.toThrow()
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// 5. COUNT DISPLAY
// ═══════════════════════════════════════════════════════════════════════════

describe('Lobe Filters — Count Display', () => {
  it('shows filtered.length / visible.length when none filtered', () => {
    const entries = [mkEntry(1, 'curator'), mkEntry(2, 'coder'), mkEntry(3, 'reviewer')]
    const filtered = filterEntries(entries, {})
    expect(`${filtered.length}/${entries.length}`).toBe('3/3')
  })

  it('shows correct count when some lobes hidden', () => {
    const entries = [mkEntry(1, 'curator'), mkEntry(2, 'coder'), mkEntry(3, 'reviewer')]
    const filtered = filterEntries(entries, { coder: false })
    expect(`${filtered.length}/${entries.length}`).toBe('2/3')
  })

  it('shows 0/N when all lobes hidden', () => {
    const entries = [mkEntry(1, 'curator'), mkEntry(2, 'coder')]
    const filtered = filterEntries(entries, { curator: false, coder: false })
    expect(`${filtered.length}/${entries.length}`).toBe('0/2')
  })

  it('shows 0/0 when no entries exist', () => {
    const entries: StreamEntry[] = []
    const filtered = filterEntries(entries, {})
    expect(`${filtered.length}/${entries.length}`).toBe('0/0')
  })

  it('count reflects multiple entries from same lobe', () => {
    const entries = [
      mkEntry(1, 'curator'),
      mkEntry(2, 'curator'),
      mkEntry(3, 'coder'),
      mkEntry(4, 'curator'),
    ]
    const filtered = filterEntries(entries, { curator: false })
    expect(`${filtered.length}/${entries.length}`).toBe('1/4')
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// 6. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Lobe Filters — Edge Cases', () => {
  it('unknown lobe names pass through filter (not in LOBE_COLORS but !== false)', () => {
    const entries = [
      mkEntry(1, 'curator'),
      mkEntry(2, 'unknown-lobe'),
      mkEntry(3, 'some-future-agent'),
    ]
    const result = filterEntries(entries, {})
    expect(result).toHaveLength(3)
  })

  it('unknown lobe can still be filtered out if explicitly set to false', () => {
    const entries = [mkEntry(1, 'mystery-lobe')]
    const filtered = filterEntries(entries, { 'mystery-lobe': false })
    expect(filtered).toHaveLength(0)
  })

  it('corrupted localStorage returns empty object (default state)', () => {
    const storage = { getItem: () => 'not-valid-json{{{' }
    const result = loadLobeFilters(storage)
    expect(result).toEqual({})
  })

  it('null localStorage value returns empty object', () => {
    const storage = { getItem: () => null }
    const result = loadLobeFilters(storage)
    expect(result).toEqual({})
  })

  it('empty string in localStorage returns empty object', () => {
    // JSON.parse('') throws, caught by try/catch
    const storage = { getItem: () => '' }
    const result = loadLobeFilters(storage)
    expect(result).toEqual({})
  })

  it('localStorage getItem throwing returns empty object', () => {
    const storage = { getItem: () => { throw new Error('SecurityError') } }
    const result = loadLobeFilters(storage)
    expect(result).toEqual({})
  })

  it('LOBE_COLORS has exactly 6 known lobes', () => {
    expect(Object.keys(LOBE_COLORS)).toHaveLength(6)
    expect(Object.keys(LOBE_COLORS).sort()).toEqual([
      'anorak-pro', 'carbondev', 'coder', 'curator', 'reviewer', 'tester',
    ])
  })

  it('LOBE_COLORS values are valid hex colors', () => {
    for (const [, color] of Object.entries(LOBE_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('filter handles empty entries array', () => {
    const result = filterEntries([], { curator: false })
    expect(result).toEqual([])
  })

  it('filter handles entries with empty-string lobe', () => {
    const entries = [mkEntry(1, '')]
    // '' is not in visibleLobes => undefined !== false => true => passes
    const result = filterEntries(entries, {})
    expect(result).toHaveLength(1)
  })

  it('toggling empty-string lobe works correctly', () => {
    const state = toggleLobe({}, '')
    expect(state['']).toBe(false)
    const state2 = toggleLobe(state, '')
    expect(state2['']).toBe(true)
  })

  it('large filter state round-trips correctly', () => {
    const mockStorage: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v },
    }
    // Build large filter state with many lobes
    const state: Record<string, boolean> = {}
    for (let i = 0; i < 50; i++) {
      state[`agent-${i}`] = i % 2 === 0
    }
    persistLobeFilters(storage, state)
    const loaded = loadLobeFilters(storage)
    expect(loaded).toEqual(state)
  })
})

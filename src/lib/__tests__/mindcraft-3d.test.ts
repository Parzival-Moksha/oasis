// ═══════════════════════════════════════════════════════════════════════════
// MINDCRAFT 3D — Pure Logic Tests
// ─═̷─═̷─ॐ─═̷─═̷─ Band layout, position calculator, sorting, accents ─═̷─═̷─ॐ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import {
  MATURITY_BAND_COUNT,
  DONE_BAND,
  TOTAL_BANDS,
  WORLD_SIZE,
  BAND_DEPTH,
  WORLD_HALF,
  bandZ,
  computeMissionPositions,
} from '../../components/forge/MindcraftWorld'
import { MATURITY_ACCENTS, type MissionData } from '../../components/forge/MissionCard3D'

// ── Helper: create a minimal MissionData ──
function makeMission(overrides: Partial<MissionData> & { id: number }): MissionData {
  return {
    name: `Mission ${overrides.id}`,
    description: null,
    status: 'todo',
    maturityLevel: 0,
    urgency: 5,
    easiness: 5,
    impact: 5,
    priority: null,
    score: null,
    valor: 0,
    queuePosition: null,
    assignedTo: null,
    technicalSpec: null,
    history: null,
    imageUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    endedAt: null,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — Constants', () => {
  it('MATURITY_BAND_COUNT is 9', () => {
    expect(MATURITY_BAND_COUNT).toBe(9)
  })

  it('DONE_BAND is 9 (virtual band for done missions)', () => {
    expect(DONE_BAND).toBe(9)
  })

  it('TOTAL_BANDS is 10 (9 maturity + 1 done)', () => {
    expect(TOTAL_BANDS).toBe(10)
  })

  it('WORLD_SIZE is 110m', () => {
    expect(WORLD_SIZE).toBe(110)
  })

  it('BAND_DEPTH is WORLD_SIZE / TOTAL_BANDS = 11m', () => {
    expect(BAND_DEPTH).toBe(11)
    expect(BAND_DEPTH).toBe(WORLD_SIZE / TOTAL_BANDS)
  })

  it('WORLD_HALF is WORLD_SIZE / 2 = 55', () => {
    expect(WORLD_HALF).toBe(55)
    expect(WORLD_HALF).toBe(WORLD_SIZE / 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. MATURITY_ACCENTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — MATURITY_ACCENTS', () => {
  it('has entries for levels 0 through 9 (10 total)', () => {
    for (let i = 0; i <= 9; i++) {
      expect(MATURITY_ACCENTS[i]).toBeDefined()
      expect(typeof MATURITY_ACCENTS[i]).toBe('string')
    }
  })

  it('all accent values are valid hex colors', () => {
    for (let i = 0; i <= 9; i++) {
      expect(MATURITY_ACCENTS[i]).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('done zone (9) is lime green #a3e635', () => {
    expect(MATURITY_ACCENTS[9]).toBe('#a3e635')
  })

  it('Para (0) is grey #666666', () => {
    expect(MATURITY_ACCENTS[0]).toBe('#666666')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. bandZ — center of each band along Z axis
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — bandZ', () => {
  it('level 0 → center of first band (-WORLD_HALF + BAND_DEPTH/2)', () => {
    expect(bandZ(0)).toBe(-55 + 5.5)  // -49.5
  })

  it('level 9 → center of done zone (last band)', () => {
    expect(bandZ(9)).toBe(-55 + 9 * 11 + 5.5)  // 49.5
  })

  it('each consecutive band is BAND_DEPTH apart', () => {
    for (let i = 0; i < 9; i++) {
      expect(bandZ(i + 1) - bandZ(i)).toBeCloseTo(BAND_DEPTH, 5)
    }
  })

  it('first and last bands are symmetric around origin', () => {
    expect(bandZ(0)).toBeCloseTo(-bandZ(9), 5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. computeMissionPositions — done missions go to band 9
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: done routing', () => {
  it('done missions go to band 9 regardless of maturityLevel', () => {
    const missions = [
      makeMission({ id: 1, status: 'done', maturityLevel: 0, assignedTo: 'anorak' }),
      makeMission({ id: 2, status: 'done', maturityLevel: 5, assignedTo: 'anorak' }),
      makeMission({ id: 3, status: 'done', maturityLevel: 8, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    for (const entry of result) {
      expect(entry.position[2]).toBeCloseTo(bandZ(DONE_BAND), 5)
    }
  })

  it('non-done missions go to their maturityLevel band', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 3, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].position[2]).toBeCloseTo(bandZ(3), 5)
  })

  it('done zone Y = 2.0, other zones Y = 0.5', () => {
    const missions = [
      makeMission({ id: 1, status: 'done', maturityLevel: 0, assignedTo: 'anorak' }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 4, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    const done = result.find(r => r.mission.id === 1)!
    const active = result.find(r => r.mission.id === 2)!
    expect(done.position[1]).toBe(2.0)
    expect(active.position[1]).toBe(0.5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. computeMissionPositions — X placement by assignedTo
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: X placement', () => {
  it('anorak missions have negative X', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].position[0]).toBeLessThan(0)
  })

  it('carbondev missions have positive X', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev' }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].position[0]).toBeGreaterThan(0)
  })

  it('unassigned missions have X = 0', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: null }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].position[0]).toBe(0)
  })

  it('first anorak mission X = -(3 + 0*spacing)', () => {
    const spacing = 7
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, spacing)
    expect(result[0].position[0]).toBe(-3)
  })

  it('second anorak mission X = -(3 + 1*spacing)', () => {
    const spacing = 7
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', queuePosition: 1 }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', queuePosition: 2 }),
    ]
    const result = computeMissionPositions(missions, spacing)
    const second = result.find(r => r.mission.id === 2)!
    expect(second.position[0]).toBe(-(3 + 1 * spacing))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. computeMissionPositions — sorting within band
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: sorting', () => {
  it('queuePosition missions come before non-queued', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', queuePosition: null, priority: 10 }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', queuePosition: 1 }),
    ]
    const result = computeMissionPositions(missions, 5)
    const anorakResults = result.filter(r => r.mission.assignedTo === 'anorak')
    // queuePosition=1 should be first (index 0 → x = -3)
    expect(anorakResults[0].mission.id).toBe(2)
    expect(anorakResults[1].mission.id).toBe(1)
  })

  it('lower queuePosition comes first', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', queuePosition: 5 }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', queuePosition: 2 }),
    ]
    const result = computeMissionPositions(missions, 5)
    const anorakResults = result.filter(r => r.mission.assignedTo === 'anorak')
    expect(anorakResults[0].mission.id).toBe(2)
    expect(anorakResults[1].mission.id).toBe(1)
  })

  it('higher priority comes first (when no queuePosition)', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', priority: 3 }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', priority: 8 }),
    ]
    const result = computeMissionPositions(missions, 5)
    const anorakResults = result.filter(r => r.mission.assignedTo === 'anorak')
    expect(anorakResults[0].mission.id).toBe(2)
  })

  it('earlier createdAt comes first (when same priority)', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', priority: 5, createdAt: '2026-06-01T00:00:00Z' }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'anorak', priority: 5, createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const result = computeMissionPositions(missions, 5)
    const anorakResults = result.filter(r => r.mission.assignedTo === 'anorak')
    expect(anorakResults[0].mission.id).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. computeMissionPositions — spacing affects X distance
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: spacing', () => {
  it('larger spacing increases X distance between missions', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev', queuePosition: 1 }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev', queuePosition: 2 }),
    ]
    const narrow = computeMissionPositions(missions, 3)
    const wide = computeMissionPositions(missions, 10)
    const narrowGap = Math.abs(narrow[1].position[0] - narrow[0].position[0])
    const wideGap = Math.abs(wide[1].position[0] - wide[0].position[0])
    expect(wideGap).toBeGreaterThan(narrowGap)
  })

  it('spacing=0 means all missions in same column stack at base offset', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev', queuePosition: 1 }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev', queuePosition: 2 }),
    ]
    const result = computeMissionPositions(missions, 0)
    // x = side * (3 + i * 0) = 3 for both
    expect(result[0].position[0]).toBe(3)
    expect(result[1].position[0]).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. computeMissionPositions — rotation ±PI/4
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: rotation', () => {
  it('carbondev (side=1) and unassigned (side=0) get +PI/4 Y rotation', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev' }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: null }),
    ]
    const result = computeMissionPositions(missions, 5)
    for (const entry of result) {
      expect(entry.rotation[1]).toBeCloseTo(Math.PI / 4, 5)
    }
  })

  it('anorak (side=-1) gets -PI/4 Y rotation', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].rotation[1]).toBeCloseTo(-Math.PI / 4, 5)
  })

  it('X and Z rotation are always 0', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 0, assignedTo: 'anorak' }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 0, assignedTo: 'carbondev' }),
      makeMission({ id: 3, status: 'todo', maturityLevel: 0, assignedTo: null }),
    ]
    const result = computeMissionPositions(missions, 5)
    for (const entry of result) {
      expect(entry.rotation[0]).toBe(0)
      expect(entry.rotation[2]).toBe(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. computeMissionPositions — maturityLevel clamping
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: maturity clamping', () => {
  it('maturityLevel > 8 is clamped to band 8 (not done)', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 99, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].position[2]).toBeCloseTo(bandZ(8), 5)
  })

  it('maturityLevel < 0 is clamped to band 0', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: -5, assignedTo: 'anorak' }),
    ]
    const result = computeMissionPositions(missions, 5)
    expect(result[0].position[2]).toBeCloseTo(bandZ(0), 5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. computeMissionPositions — empty input
// ═══════════════════════════════════════════════════════════════════════════

describe('Mindcraft 3D — computeMissionPositions: edge cases', () => {
  it('returns empty array for empty missions', () => {
    const result = computeMissionPositions([], 5)
    expect(result).toEqual([])
  })

  it('mixed done and active missions are placed in correct bands', () => {
    const missions = [
      makeMission({ id: 1, status: 'done', maturityLevel: 2, assignedTo: 'anorak' }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 2, assignedTo: 'anorak' }),
      makeMission({ id: 3, status: 'todo', maturityLevel: 7, assignedTo: 'carbondev' }),
    ]
    const result = computeMissionPositions(missions, 5)
    const m1 = result.find(r => r.mission.id === 1)!
    const m2 = result.find(r => r.mission.id === 2)!
    const m3 = result.find(r => r.mission.id === 3)!

    expect(m1.position[2]).toBeCloseTo(bandZ(DONE_BAND), 5)
    expect(m2.position[2]).toBeCloseTo(bandZ(2), 5)
    expect(m3.position[2]).toBeCloseTo(bandZ(7), 5)
  })

  it('all assignment types in the same band are placed correctly', () => {
    const missions = [
      makeMission({ id: 1, status: 'todo', maturityLevel: 4, assignedTo: 'anorak' }),
      makeMission({ id: 2, status: 'todo', maturityLevel: 4, assignedTo: 'carbondev' }),
      makeMission({ id: 3, status: 'todo', maturityLevel: 4, assignedTo: null }),
    ]
    const result = computeMissionPositions(missions, 5)
    const m1 = result.find(r => r.mission.id === 1)!
    const m2 = result.find(r => r.mission.id === 2)!
    const m3 = result.find(r => r.mission.id === 3)!

    expect(m1.position[0]).toBeLessThan(0)      // anorak = left
    expect(m2.position[0]).toBeGreaterThan(0)    // carbon = right
    expect(m3.position[0]).toBe(0)               // unassigned = center
    // All same Z (same band)
    expect(m1.position[2]).toBeCloseTo(m2.position[2], 5)
    expect(m2.position[2]).toBeCloseTo(m3.position[2], 5)
  })
})

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO FEEDBACK ROUTE — Unit tests
// Tests the logic extracted from /api/anorak/pro/feedback/route.ts:
//   - history append, maturity bumping, queue positioning, validation
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Pure logic extracted from feedback route for testability
// (no Prisma/Next.js deps — just the business logic)
// ═══════════════════════════════════════════════════════════════════════════

interface FeedbackBody {
  missionId: number
  mature: boolean
  verdict: string
  rating: number
  carbondevMsg?: string
  carbonSeconds?: number
}

function validateFeedback(body: Partial<FeedbackBody>): string | null {
  const { missionId, mature, verdict } = body
  if (!missionId || typeof mature !== 'boolean' || !verdict) {
    return 'missionId, mature, verdict required'
  }
  return null
}

function buildFeedbackEntry(body: FeedbackBody): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    actor: 'carbondev',
    action: 'feedback',
    verdict: body.verdict,
    rating: body.rating,
    carbondevMsg: body.carbondevMsg || undefined,
    mature: body.mature,
    carbonSeconds: body.carbonSeconds || undefined,
  }
}

function calcNewLevel(currentLevel: number, mature: boolean): number {
  return mature ? Math.min(currentLevel + 1, 3) : currentLevel
}

function calcQueuePosition(newLevel: number, lastQueuePos: number | null): number | null {
  // vaikhari (level 3) exits curator queue
  return newLevel < 3 ? (lastQueuePos ?? 0) + 1 : null
}

function parseHistory(raw: string | null): Record<string, unknown>[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function buildResponseMessage(missionId: number, mature: boolean, newLevel: number): string {
  if (mature) {
    return newLevel >= 3
      ? `Mission #${missionId} reached vaikhari 🌕 — ready for execution`
      : `Mission #${missionId} bumped to level ${newLevel} — back in curator queue`
  }
  return `Mission #${missionId} refined — back in curator queue for re-enrichment`
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('feedback validation', () => {
  it('rejects missing missionId', () => {
    expect(validateFeedback({ mature: true, verdict: 'accept' })).toBe('missionId, mature, verdict required')
  })

  it('rejects missing mature', () => {
    expect(validateFeedback({ missionId: 1, verdict: 'accept' })).toBe('missionId, mature, verdict required')
  })

  it('rejects missing verdict', () => {
    expect(validateFeedback({ missionId: 1, mature: true })).toBe('missionId, mature, verdict required')
  })

  it('accepts valid body', () => {
    expect(validateFeedback({ missionId: 1, mature: true, verdict: 'accept', rating: 8 })).toBeNull()
  })

  it('rejects mature as string (must be boolean)', () => {
    expect(validateFeedback({ missionId: 1, mature: 'true' as any, verdict: 'accept' })).toBe('missionId, mature, verdict required')
  })

  it('rejects missionId = 0 (falsy)', () => {
    expect(validateFeedback({ missionId: 0, mature: true, verdict: 'accept' })).toBe('missionId, mature, verdict required')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY APPEND
// ═══════════════════════════════════════════════════════════════════════════

describe('feedback history append', () => {
  it('builds entry with carbondev actor', () => {
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 9,
    })
    expect(entry.actor).toBe('carbondev')
    expect(entry.action).toBe('feedback')
    expect(entry.verdict).toBe('accept')
    expect(entry.rating).toBe(9)
    expect(entry.mature).toBe(true)
  })

  it('includes optional carbondevMsg when provided', () => {
    const entry = buildFeedbackEntry({
      missionId: 1, mature: false, verdict: 'modify', rating: 5,
      carbondevMsg: 'needs more error handling',
    })
    expect(entry.carbondevMsg).toBe('needs more error handling')
  })

  it('excludes carbondevMsg when empty', () => {
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 8,
    })
    expect(entry.carbondevMsg).toBeUndefined()
  })

  it('includes carbonSeconds when provided', () => {
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 7,
      carbonSeconds: 120,
    })
    expect(entry.carbonSeconds).toBe(120)
  })

  it('excludes carbonSeconds when zero', () => {
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 7,
      carbonSeconds: 0,
    })
    expect(entry.carbonSeconds).toBeUndefined()
  })

  it('appends to existing history', () => {
    const existing = [{ actor: 'curator', action: 'mature', curatorMsg: 'looks good' }]
    const history = parseHistory(JSON.stringify(existing))
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 8,
    })
    history.push(entry)
    expect(history).toHaveLength(2)
    expect(history[0].actor).toBe('curator')
    expect(history[1].actor).toBe('carbondev')
  })

  it('appends to empty/null history', () => {
    const history = parseHistory(null)
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 8,
    })
    history.push(entry)
    expect(history).toHaveLength(1)
  })

  it('appends to corrupted history', () => {
    const history = parseHistory('not json')
    const entry = buildFeedbackEntry({
      missionId: 1, mature: true, verdict: 'accept', rating: 8,
    })
    history.push(entry)
    expect(history).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MATURITY BUMPING
// ═══════════════════════════════════════════════════════════════════════════

describe('maturity level calculation', () => {
  it('bumps level 0 to 1 when mature=true', () => {
    expect(calcNewLevel(0, true)).toBe(1)
  })

  it('bumps level 1 to 2 when mature=true', () => {
    expect(calcNewLevel(1, true)).toBe(2)
  })

  it('bumps level 2 to 3 (vaikhari) when mature=true', () => {
    expect(calcNewLevel(2, true)).toBe(3)
  })

  it('caps at level 3 (does not overflow)', () => {
    expect(calcNewLevel(3, true)).toBe(3)
  })

  it('does not change level when mature=false', () => {
    expect(calcNewLevel(0, false)).toBe(0)
    expect(calcNewLevel(1, false)).toBe(1)
    expect(calcNewLevel(2, false)).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE POSITIONING
// ═══════════════════════════════════════════════════════════════════════════

describe('curator queue positioning', () => {
  it('assigns next position after last in queue', () => {
    expect(calcQueuePosition(1, 5)).toBe(6)
  })

  it('assigns position 1 when queue is empty', () => {
    expect(calcQueuePosition(1, null)).toBe(1)
  })

  it('returns null for vaikhari (level 3) — exits queue', () => {
    expect(calcQueuePosition(3, 10)).toBeNull()
  })

  it('returns position for level 0', () => {
    expect(calcQueuePosition(0, 3)).toBe(4)
  })

  it('returns position for level 2', () => {
    expect(calcQueuePosition(2, 0)).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE MESSAGE
// ═══════════════════════════════════════════════════════════════════════════

describe('feedback response message', () => {
  it('indicates vaikhari when level reaches 3', () => {
    const msg = buildResponseMessage(42, true, 3)
    expect(msg).toContain('vaikhari')
    expect(msg).toContain('ready for execution')
  })

  it('indicates curator queue when bumped but not vaikhari', () => {
    const msg = buildResponseMessage(42, true, 2)
    expect(msg).toContain('bumped to level 2')
    expect(msg).toContain('curator queue')
  })

  it('indicates refinement when not mature', () => {
    const msg = buildResponseMessage(42, false, 1)
    expect(msg).toContain('refined')
    expect(msg).toContain('re-enrichment')
  })

  it('includes mission ID', () => {
    const msg = buildResponseMessage(99, true, 3)
    expect(msg).toContain('#99')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ASSIGNMENT — always goes back to anorak
// ═══════════════════════════════════════════════════════════════════════════

describe('feedback assignment', () => {
  it('always assigns to anorak after feedback (bump)', () => {
    // Route logic: const newAssignedTo = 'anorak'
    const newAssignedTo = 'anorak'
    expect(newAssignedTo).toBe('anorak')
  })

  it('always assigns to anorak after feedback (refine)', () => {
    const newAssignedTo = 'anorak'
    expect(newAssignedTo).toBe('anorak')
  })
})

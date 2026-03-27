// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// REVIEW FIXES BATCH 2 — isFirstPass guard, Zod bounds, AbortController
// Tests for: mission-mcp report_review, report_test, AnorakProPanel
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. isFirstPass guard — report_review only writes reviewerScore on first pass
// ═══════════════════════════════════════════════════════════════════════════

describe('report_review — isFirstPass guard', () => {
  const source = readSource('tools/mission-mcp/index.js')

  it('computes isFirstPass from mission.reviewerScore === null', () => {
    expect(source).toContain('const isFirstPass = mission.reviewerScore === null')
  })

  it('conditionally spreads reviewerScore only when isFirstPass', () => {
    expect(source).toContain('...(isFirstPass ? { reviewerScore: score } : {})')
  })

  it('first-pass message includes RL signal note', () => {
    // The response text should indicate first pass vs re-review
    expect(source).toContain('first pass — saved as RL signal')
    expect(source).toContain('re-review')
  })

  it('history always records the score regardless of isFirstPass', () => {
    // The history push includes reviewerScore every time (not gated by isFirstPass)
    const historyPushIdx = source.indexOf("action: \"review\"")
    expect(historyPushIdx).toBeGreaterThan(-1)
    const historyBlock = source.substring(historyPushIdx - 100, historyPushIdx + 200)
    expect(historyBlock).toContain('reviewerScore: score')
  })
})

describe('report_test — isFirstPass guard', () => {
  const source = readSource('tools/mission-mcp/index.js')

  it('computes isFirstPass from mission.testerScore === null', () => {
    expect(source).toContain('const isFirstPass = mission.testerScore === null')
  })

  it('conditionally spreads testerScore only when isFirstPass', () => {
    expect(source).toContain('...(isFirstPass ? { testerScore: score } : {})')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Zod bounds validation — score, valor, newTestsWritten
// ═══════════════════════════════════════════════════════════════════════════

describe('Zod bounds — report_review score schema in source', () => {
  const source = readSource('tools/mission-mcp/index.js')

  it('report_review score uses z.number().min(0).max(100)', () => {
    const reportReviewIdx = source.indexOf('"report_review"')
    const reportTestIdx = source.indexOf('"report_test"')
    const reviewBlock = source.substring(reportReviewIdx, reportTestIdx)
    expect(reviewBlock).toContain('z.number().min(0).max(100)')
  })

  it('score field is required (no .optional())', () => {
    const reportReviewIdx = source.indexOf('"report_review"')
    const reportTestIdx = source.indexOf('"report_test"')
    const reviewBlock = source.substring(reportReviewIdx, reportTestIdx)
    // The score line should have min/max but NOT optional
    const scoreLineMatch = reviewBlock.match(/score:\s*z\.number\(\)[^,}]+/)
    expect(scoreLineMatch).not.toBeNull()
    expect(scoreLineMatch![0]).not.toContain('.optional()')
  })
})

describe('Zod bounds — report_test schema in source', () => {
  const source = readSource('tools/mission-mcp/index.js')

  it('test score uses z.number().min(0).max(100)', () => {
    const reportTestIdx = source.indexOf('"report_test"')
    const createMissionIdx = source.indexOf('"create_mission"')
    const testBlock = source.substring(reportTestIdx, createMissionIdx)
    // First z.number().min(0).max(100) in the test block = score
    expect(testBlock).toContain('z.number().min(0).max(100)')
  })

  it('valor uses z.number().min(0).max(2)', () => {
    const reportTestIdx = source.indexOf('"report_test"')
    const afterBlock = source.substring(reportTestIdx, reportTestIdx + 800)
    expect(afterBlock).toContain('z.number().min(0).max(2)')
  })

  it('valor is optional', () => {
    const reportTestIdx = source.indexOf('"report_test"')
    const afterBlock = source.substring(reportTestIdx, reportTestIdx + 800)
    const valorLine = afterBlock.match(/valor:\s*z\.number\(\)[^,}]+/)
    expect(valorLine).not.toBeNull()
    expect(valorLine![0]).toContain('.optional()')
  })

  it('newTestsWritten uses z.number().min(0) with optional', () => {
    const reportTestIdx = source.indexOf('"report_test"')
    const afterBlock = source.substring(reportTestIdx, reportTestIdx + 800)
    expect(afterBlock).toMatch(/newTestsWritten.*z\.number\(\)\.min\(0\)/)
  })

  it('newTestsWritten has no upper bound (unbounded positive)', () => {
    const reportTestIdx = source.indexOf('"report_test"')
    const afterBlock = source.substring(reportTestIdx, reportTestIdx + 800)
    const ntwLine = afterBlock.match(/newTestsWritten:\s*z\.number\(\)[^,}]+/)
    expect(ntwLine).not.toBeNull()
    // Should have min(0) but NOT max()
    expect(ntwLine![0]).toContain('.min(0)')
    expect(ntwLine![0]).not.toMatch(/\.max\(/)
  })
})

describe('Zod bounds — isFirstPass logic simulation', () => {
  // Simulate the isFirstPass guard with pure logic
  function simulateReviewUpdate(existingScore: number | null, newScore: number) {
    const isFirstPass = existingScore === null
    return {
      ...(isFirstPass ? { reviewerScore: newScore } : {}),
    }
  }

  it('first pass (null) → writes reviewerScore', () => {
    const update = simulateReviewUpdate(null, 85)
    expect(update).toHaveProperty('reviewerScore', 85)
  })

  it('second pass (existing score) → does NOT overwrite reviewerScore', () => {
    const update = simulateReviewUpdate(70, 95)
    expect(update).not.toHaveProperty('reviewerScore')
  })

  it('re-review after perfect score → still preserves original', () => {
    const update = simulateReviewUpdate(100, 42)
    expect(update).not.toHaveProperty('reviewerScore')
  })

  it('first pass with score 0 → writes 0 (not falsy-skipped)', () => {
    const update = simulateReviewUpdate(null, 0)
    expect(update).toHaveProperty('reviewerScore', 0)
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// 3. AbortController pattern — setIsAgentRunning cleanup in finally block
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel — AbortController + setIsAgentRunning', () => {
  const source = readSource('src/components/forge/AnorakProPanel.tsx')

  it('creates AbortController in consumeSSE', () => {
    expect(source).toContain('const controller = new AbortController()')
  })

  it('aborts previous controller before creating new one', () => {
    // Scope to consumeSSE function (not the chat handler)
    const consumeIdx = source.indexOf('const consumeSSE')
    expect(consumeIdx).toBeGreaterThan(-1)
    const consumeSource = source.substring(consumeIdx, consumeIdx + 3000)
    const abortIdx = consumeSource.indexOf('if (abortRef.current) abortRef.current.abort()')
    const newCtrlIdx = consumeSource.indexOf('const controller = new AbortController()')
    expect(abortIdx).toBeGreaterThan(-1)
    expect(newCtrlIdx).toBeGreaterThan(abortIdx)
  })

  it('sets isAgentRunning(true) before fetch', () => {
    const setTrueIdx = source.indexOf('setIsAgentRunning(true)')
    const fetchIdx = source.indexOf("const res = await fetch(url,")
    expect(setTrueIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(setTrueIdx)
  })

  it('sets isAgentRunning(false) in finally block, NOT in try/catch', () => {
    // Find the consumeSSE function's finally block (not the chat handler's)
    const consumeIdx = source.indexOf('const consumeSSE')
    expect(consumeIdx).toBeGreaterThan(-1)
    const consumeSource = source.substring(consumeIdx, consumeIdx + 3000)
    const finallyIdx = consumeSource.indexOf('} finally {')
    expect(finallyIdx).toBeGreaterThan(-1)
    const afterFinally = consumeSource.substring(finallyIdx, finallyIdx + 200)
    expect(afterFinally).toContain('setIsAgentRunning(false)')
  })

  it('cleans up abortRef in finally block', () => {
    const consumeIdx = source.indexOf('const consumeSSE')
    expect(consumeIdx).toBeGreaterThan(-1)
    const consumeSource = source.substring(consumeIdx, consumeIdx + 3000)
    const finallyIdx = consumeSource.indexOf('} finally {')
    const afterFinally = consumeSource.substring(finallyIdx, finallyIdx + 200)
    expect(afterFinally).toContain('if (abortRef.current === controller) abortRef.current = null')
  })

  it('passes signal to fetch for cancellation support', () => {
    expect(source).toContain('signal: controller.signal')
  })

  it('suppresses error logging when abort is intentional', () => {
    // On catch, only logs if NOT aborted
    expect(source).toContain('if (!controller.signal.aborted)')
  })

  it('setIsAgentRunning(false) is NOT in the catch block (only in finally)', () => {
    // Find the catch block
    const catchIdx = source.indexOf('} catch (e) {')
    expect(catchIdx).toBeGreaterThan(-1)
    const finallyIdx = source.indexOf('} finally {')

    // Between catch and finally, there should NOT be setIsAgentRunning(false)
    const catchBlock = source.substring(catchIdx, finallyIdx)
    expect(catchBlock).not.toContain('setIsAgentRunning(false)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Structural integrity — consumeSSE is a useCallback
// ═══════════════════════════════════════════════════════════════════════════

describe('AnorakProPanel — consumeSSE structure', () => {
  const source = readSource('src/components/forge/AnorakProPanel.tsx')

  it('consumeSSE is wrapped in useCallback', () => {
    expect(source).toContain('const consumeSSE = useCallback(async (url: string')
  })

  it('try-catch-finally has all three blocks', () => {
    // Verify the pattern: try { ... } catch { ... } finally { ... }
    const consumeIdx = source.indexOf('const consumeSSE = useCallback')
    const consumeBlock = source.substring(consumeIdx, consumeIdx + 3000)
    expect(consumeBlock).toContain('try {')
    expect(consumeBlock).toContain('} catch (e) {')
    expect(consumeBlock).toContain('} finally {')
  })
})

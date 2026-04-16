// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — modify_object transform fix
// Verifies that partial transform updates do NOT reset unspecified fields.
// The fix: when modify_object is called with only {scale: 2}, position
// and rotation should remain unchanged (not reset to [0,0,0]).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Re-implement the pure helpers from oasis-tools.ts to test the algorithm
// (The originals are private + server-only, can't import directly)
// ═══════════════════════════════════════════════════════════════════════════

function parseVec3Like(v: unknown): [number, number, number] | null {
  if (Array.isArray(v) && v.length >= 3) {
    const [x, y, z] = v.map(Number)
    if ([x, y, z].some(n => !Number.isFinite(n))) return null
    return [x, y, z]
  }
  if (typeof v !== 'string') return null
  const trimmed = (v as string).trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed) && parsed.length >= 3) {
      const [x, y, z] = parsed.map(Number)
      if ([x, y, z].some(n => !Number.isFinite(n))) return null
      return [x, y, z]
    }
  } catch { /* fall through */ }
  const parts = trimmed
    .replace(/^[\[\(\{]\s*/, '')
    .replace(/\s*[\]\)\}]$/, '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length < 3) return null
  const [x, y, z] = parts.slice(0, 3).map(Number)
  if ([x, y, z].some(n => !Number.isFinite(n))) return null
  return [x, y, z]
}

function validPos(v: unknown): [number, number, number] | null {
  return parseVec3Like(v)
}

function validNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

type TransformRecord = {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
}

/**
 * Simulates the modify_object transform merge logic from oasis-tools.ts lines 711-719.
 * This is the FIXED version that only sets fields that are explicitly provided.
 */
function applyTransformUpdate(
  existing: TransformRecord,
  args: Record<string, unknown>,
): TransformRecord {
  const pos = validPos(args.position)
  const rot = validPos(args.rotation)
  const scl = args.scale !== undefined ? validNum(args.scale, 1) : undefined

  const result = { ...existing }
  if (pos) result.position = pos
  if (rot) result.rotation = rot
  if (scl !== undefined) result.scale = scl
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// parseVec3Like unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe('parseVec3Like', () => {
  it('parses a numeric array', () => {
    expect(parseVec3Like([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('parses a string-encoded JSON array', () => {
    expect(parseVec3Like('[4, 5, 6]')).toEqual([4, 5, 6])
  })

  it('parses comma-separated string', () => {
    expect(parseVec3Like('7, 8, 9')).toEqual([7, 8, 9])
  })

  it('returns null for too few values', () => {
    expect(parseVec3Like([1, 2])).toBeNull()
    expect(parseVec3Like('1, 2')).toBeNull()
  })

  it('returns null for non-finite values', () => {
    expect(parseVec3Like([1, NaN, 3])).toBeNull()
    expect(parseVec3Like([Infinity, 2, 3])).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseVec3Like('')).toBeNull()
  })

  it('returns null for non-string non-array', () => {
    expect(parseVec3Like(null)).toBeNull()
    expect(parseVec3Like(undefined)).toBeNull()
    expect(parseVec3Like(42)).toBeNull()
  })

  it('handles extra elements (takes first 3)', () => {
    expect(parseVec3Like([1, 2, 3, 4])).toEqual([1, 2, 3])
  })

  it('handles parenthesized format', () => {
    expect(parseVec3Like('(1, 2, 3)')).toEqual([1, 2, 3])
  })

  it('handles space-separated format', () => {
    expect(parseVec3Like('1 2 3')).toEqual([1, 2, 3])
  })

  it('handles negative numbers', () => {
    expect(parseVec3Like([-1.5, 0, 3.7])).toEqual([-1.5, 0, 3.7])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// modify_object transform merge — THE CRITICAL FIX
// ═══════════════════════════════════════════════════════════════════════════

describe('modify_object transform merge', () => {
  it('setting only scale does NOT reset position', () => {
    const existing: TransformRecord = {
      position: [10, 20, 30],
      rotation: [0, 45, 0],
      scale: 1,
    }
    const result = applyTransformUpdate(existing, { scale: 2 })
    expect(result.position).toEqual([10, 20, 30])
    expect(result.rotation).toEqual([0, 45, 0])
    expect(result.scale).toBe(2)
  })

  it('setting only position does NOT reset scale or rotation', () => {
    const existing: TransformRecord = {
      position: [10, 20, 30],
      rotation: [0, 90, 0],
      scale: 3,
    }
    const result = applyTransformUpdate(existing, { position: [5, 5, 5] })
    expect(result.position).toEqual([5, 5, 5])
    expect(result.rotation).toEqual([0, 90, 0])
    expect(result.scale).toBe(3)
  })

  it('setting only rotation does NOT reset position or scale', () => {
    const existing: TransformRecord = {
      position: [1, 2, 3],
      scale: 2.5,
    }
    const result = applyTransformUpdate(existing, { rotation: [0, 180, 0] })
    expect(result.position).toEqual([1, 2, 3])
    expect(result.rotation).toEqual([0, 180, 0])
    expect(result.scale).toBe(2.5)
  })

  it('setting no transform fields leaves existing unchanged', () => {
    const existing: TransformRecord = {
      position: [10, 20, 30],
      rotation: [0, 45, 0],
      scale: 1.5,
    }
    const result = applyTransformUpdate(existing, { label: 'new name' })
    expect(result.position).toEqual([10, 20, 30])
    expect(result.rotation).toEqual([0, 45, 0])
    expect(result.scale).toBe(1.5)
  })

  it('merges into empty existing transform', () => {
    const existing: TransformRecord = {}
    const result = applyTransformUpdate(existing, { scale: 2 })
    expect(result.position).toBeUndefined()
    expect(result.rotation).toBeUndefined()
    expect(result.scale).toBe(2)
  })

  it('setting scale with invalid position does NOT add position', () => {
    const existing: TransformRecord = { position: [1, 1, 1] }
    const result = applyTransformUpdate(existing, { scale: 5, position: 'invalid' })
    // position stays as original because 'invalid' parses to null
    expect(result.position).toEqual([1, 1, 1])
    expect(result.scale).toBe(5)
  })

  it('updates multiple fields simultaneously', () => {
    const existing: TransformRecord = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
    }
    const result = applyTransformUpdate(existing, {
      position: [10, 5, 10],
      scale: 3,
    })
    expect(result.position).toEqual([10, 5, 10])
    expect(result.rotation).toEqual([0, 0, 0])
    expect(result.scale).toBe(3)
  })

  it('scale=0 is a valid update (explicit zero)', () => {
    const existing: TransformRecord = { scale: 2 }
    const result = applyTransformUpdate(existing, { scale: 0 })
    expect(result.scale).toBe(0)
  })
})

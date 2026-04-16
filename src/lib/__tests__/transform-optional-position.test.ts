// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — Transform type: optional position field
// Verifies that code reading transforms handles missing position gracefully.
// Position is now optional in: WorldState.transforms, WorldSnapshot.transforms,
// and OasisState.transforms.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Transform type matching the codebase definition
// All fields are optional — partial overrides are the whole point.
// ═══════════════════════════════════════════════════════════════════════════

type TransformRecord = {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
}

type TransformStore = Record<string, TransformRecord>

// ═══════════════════════════════════════════════════════════════════════════
// Simulated consumer functions — patterns used in the codebase
// ═══════════════════════════════════════════════════════════════════════════

/** Get position or fallback (used by rendering code) */
function getTransformPosition(
  transforms: TransformStore,
  objectId: string,
  fallback: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  return transforms[objectId]?.position ?? fallback
}

/** Get scale or fallback */
function getTransformScale(
  transforms: TransformStore,
  objectId: string,
  fallback: number = 1,
): number {
  const s = transforms[objectId]?.scale
  if (s === undefined) return fallback
  if (typeof s === 'number') return s
  // array scale — return uniform (first element)
  return s[0]
}

/** Merge two transform stores (e.g., world load + undo/redo) */
function mergeTransformStores(base: TransformStore, overlay: TransformStore): TransformStore {
  const merged: TransformStore = { ...base }
  for (const [id, transform] of Object.entries(overlay)) {
    merged[id] = { ...(merged[id] || {}), ...transform }
  }
  return merged
}

/** Safely read all transform fields without crashing on missing values */
function readTransform(transforms: TransformStore, objectId: string): {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
} {
  const t = transforms[objectId]
  return {
    position: t?.position ?? [0, 0, 0],
    rotation: t?.rotation ?? [0, 0, 0],
    scale: typeof t?.scale === 'number' ? t.scale : (Array.isArray(t?.scale) ? t.scale[0] : 1),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('transform optional position', () => {
  it('handles transform with only scale (no position)', () => {
    const transforms: TransformStore = {
      'obj-1': { scale: 2 },
    }
    const pos = getTransformPosition(transforms, 'obj-1')
    expect(pos).toEqual([0, 0, 0]) // should use fallback, not crash
  })

  it('handles transform with only rotation (no position, no scale)', () => {
    const transforms: TransformStore = {
      'obj-2': { rotation: [0, 90, 0] },
    }
    const result = readTransform(transforms, 'obj-2')
    expect(result.position).toEqual([0, 0, 0])
    expect(result.rotation).toEqual([0, 90, 0])
    expect(result.scale).toBe(1)
  })

  it('handles completely empty transform record', () => {
    const transforms: TransformStore = {
      'obj-3': {},
    }
    const result = readTransform(transforms, 'obj-3')
    expect(result.position).toEqual([0, 0, 0])
    expect(result.rotation).toEqual([0, 0, 0])
    expect(result.scale).toBe(1)
  })

  it('handles missing object ID gracefully', () => {
    const transforms: TransformStore = {}
    const result = readTransform(transforms, 'nonexistent')
    expect(result.position).toEqual([0, 0, 0])
    expect(result.rotation).toEqual([0, 0, 0])
    expect(result.scale).toBe(1)
  })

  it('full transform still works', () => {
    const transforms: TransformStore = {
      'obj-4': { position: [10, 20, 30], rotation: [0, 45, 0], scale: 2 },
    }
    const result = readTransform(transforms, 'obj-4')
    expect(result.position).toEqual([10, 20, 30])
    expect(result.rotation).toEqual([0, 45, 0])
    expect(result.scale).toBe(2)
  })

  it('getTransformScale handles missing scale', () => {
    const transforms: TransformStore = {
      'obj-5': { position: [1, 2, 3] },
    }
    expect(getTransformScale(transforms, 'obj-5')).toBe(1)
  })

  it('getTransformScale handles array scale', () => {
    const transforms: TransformStore = {
      'obj-6': { scale: [2, 2, 2] },
    }
    expect(getTransformScale(transforms, 'obj-6')).toBe(2)
  })

  it('mergeTransformStores preserves existing position when overlay has only scale', () => {
    const base: TransformStore = {
      'obj-7': { position: [10, 20, 30], rotation: [0, 0, 0], scale: 1 },
    }
    const overlay: TransformStore = {
      'obj-7': { scale: 5 },
    }
    const merged = mergeTransformStores(base, overlay)
    expect(merged['obj-7'].position).toEqual([10, 20, 30])
    expect(merged['obj-7'].rotation).toEqual([0, 0, 0])
    expect(merged['obj-7'].scale).toBe(5)
  })

  it('mergeTransformStores handles new object in overlay', () => {
    const base: TransformStore = {}
    const overlay: TransformStore = {
      'new-obj': { scale: 3 },
    }
    const merged = mergeTransformStores(base, overlay)
    expect(merged['new-obj'].scale).toBe(3)
    expect(merged['new-obj'].position).toBeUndefined()
  })

  it('position undefined vs position [0,0,0] are semantically different', () => {
    const transforms: TransformStore = {
      'no-pos': { scale: 1 },
      'zero-pos': { position: [0, 0, 0], scale: 1 },
    }
    // An object without position uses placement default; one with [0,0,0] is explicitly at origin
    expect(transforms['no-pos'].position).toBeUndefined()
    expect(transforms['zero-pos'].position).toEqual([0, 0, 0])
  })

  it('structuredClone preserves optional fields correctly', () => {
    const original: TransformStore = {
      'obj-a': { scale: 2 },
      'obj-b': { position: [1, 2, 3], scale: 1 },
    }
    const cloned = structuredClone(original)
    expect(cloned['obj-a'].position).toBeUndefined()
    expect(cloned['obj-a'].scale).toBe(2)
    expect(cloned['obj-b'].position).toEqual([1, 2, 3])
  })
})

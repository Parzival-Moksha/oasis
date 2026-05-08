import { describe, expect, it } from 'vitest'

import {
  findNearestSpatialWebObject,
  getNextSpatialWebValue,
  type SpatialWebObject,
} from '../spatial-web'

function spatial(overrides: Partial<SpatialWebObject>): SpatialWebObject {
  return {
    id: overrides.id || 'spatial-test',
    type: overrides.type || 'button',
    label: overrides.label || 'Spatial test',
    position: overrides.position || [0, 1, 0],
    ...overrides,
  }
}

describe('getNextSpatialWebValue', () => {
  it('toggles booleans', () => {
    expect(getNextSpatialWebValue(spatial({ type: 'toggle', value: false }))).toBe(true)
    expect(getNextSpatialWebValue(spatial({ type: 'toggle', value: true }))).toBe(false)
  })

  it('steps sliders and wraps past max', () => {
    expect(getNextSpatialWebValue(spatial({ type: 'slider', value: 2, min: 0, max: 3, step: 1 }))).toBe(3)
    expect(getNextSpatialWebValue(spatial({ type: 'slider', value: 3, min: 0, max: 3, step: 1 }))).toBe(0)
  })

  it('cycles select options', () => {
    const object = spatial({
      type: 'select',
      value: 'yes',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'maybe', label: 'Maybe' },
      ],
    })

    expect(getNextSpatialWebValue(object)).toBe('maybe')
  })

  it('adds multiselect values until all are selected, then clears', () => {
    const options = [
      { value: 'cake', label: 'Cake' },
      { value: 'music', label: 'Music' },
    ]

    expect(getNextSpatialWebValue(spatial({ type: 'multiselect', value: ['cake'], options }))).toEqual(['cake', 'music'])
    expect(getNextSpatialWebValue(spatial({ type: 'multiselect', value: ['cake', 'music'], options }))).toEqual([])
  })
})

describe('findNearestSpatialWebObject', () => {
  it('returns the nearest object inside the interaction radius', () => {
    const objects = [
      spatial({ id: 'far', position: [10, 1, 0] }),
      spatial({ id: 'near', position: [1, 1, 0] }),
    ]

    expect(findNearestSpatialWebObject(objects, [0, 1, 0])?.id).toBe('near')
  })

  it('uses transform override positions', () => {
    const objects = [
      spatial({ id: 'moved', position: [20, 1, 0] }),
    ]

    expect(findNearestSpatialWebObject(objects, [0, 1, 0], {
      moved: { position: [1, 1, 0] },
    })?.id).toBe('moved')
  })

  it('returns null when nothing is close enough', () => {
    expect(findNearestSpatialWebObject([spatial({ position: [5, 1, 0] })], [0, 1, 0], {}, 2)).toBeNull()
  })
})

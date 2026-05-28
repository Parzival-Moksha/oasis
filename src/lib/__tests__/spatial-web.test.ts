import { describe, expect, it } from 'vitest'

import {
  estimateSpatialWebOptionLineCount,
  findNearestSpatialWebObject,
  getNextSpatialWebValue,
  getSpatialWebOptionLetter,
  isAnsweredGoogleFormsTextField,
  spatialObjectBelongsToGoogleFormSubmit,
  spatialTextFieldHasAnswer,
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

  it('cycles blank select values to the first answer', () => {
    expect(getNextSpatialWebValue(spatial({
      type: 'select',
      value: '',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    }))).toBe('a')
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

describe('spatial web option helpers', () => {
  it('labels selector options like form answers', () => {
    expect(getSpatialWebOptionLetter(0)).toBe('A')
    expect(getSpatialWebOptionLetter(3)).toBe('D')
    expect(getSpatialWebOptionLetter(26)).toBe('AA')
  })

  it('estimates wrapped option lines at 40 characters', () => {
    expect(estimateSpatialWebOptionLineCount('short answer')).toBe(1)
    expect(estimateSpatialWebOptionLineCount('a '.repeat(41))).toBeGreaterThan(1)
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

describe('spatial text field helpers', () => {
  it('detects answered text fields without treating blanks as answers', () => {
    expect(spatialTextFieldHasAnswer(spatial({ type: 'text', value: '16' }))).toBe(true)
    expect(spatialTextFieldHasAnswer(spatial({ type: 'text', value: '   ' }))).toBe(false)
    expect(spatialTextFieldHasAnswer(spatial({ type: 'select', value: '16' }))).toBe(false)
  })

  it('detects fields that belong to a Google Forms submit flow', () => {
    const textField = spatial({
      id: 'hours',
      type: 'text',
      formId: 'demo-form',
      value: '16',
    })
    const submit = spatial({
      id: 'send',
      type: 'button',
      formId: 'demo-form',
      action: {
        type: 'submit_form',
        destination: {
          type: 'google_form',
          responseUrl: 'https://docs.google.com/forms/d/e/demo/formResponse',
          fieldMap: { hours: 'entry.123' },
        },
      },
    })

    expect(spatialObjectBelongsToGoogleFormSubmit(textField, [textField, submit])).toBe(true)
    expect(spatialObjectBelongsToGoogleFormSubmit(textField, [textField])).toBe(false)
    expect(isAnsweredGoogleFormsTextField(textField, [textField, submit])).toBe(true)
    expect(isAnsweredGoogleFormsTextField({ ...textField, value: '' }, [textField, submit])).toBe(false)
  })
})

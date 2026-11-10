import { describe, expect, it } from 'vitest'

import { FALLBACK_MODEL_OPTIONS, cleanModelId, mergeModelLists } from '../village/village-models'

const stale = [{ value: 'default', displayName: 'Default' }, { value: 'opus' }, { value: 'sonnet' }, { value: 'haiku' }, { value: 'fable' }]
const fresh = [{ value: 'default' }, { value: 'opus' }, { value: 'claude-fable-5-2', displayName: 'Fable 5.2' }, { value: 'sonnet' }, { value: 'haiku' }, { value: 'fable' }]

describe('mergeModelLists', () => {
  it('an agent started before a release gets the new model from a newer agent', () => {
    const merged = mergeModelLists([stale, fresh])
    expect(merged.map(model => model.value)).toContain('claude-fable-5-2')
  })

  it('the longest list sets the order, extras follow, no duplicates', () => {
    const merged = mergeModelLists([[{ value: 'only-old' }, { value: 'opus' }], fresh])
    expect(merged.map(model => model.value)).toEqual(['default', 'opus', 'claude-fable-5-2', 'sonnet', 'haiku', 'fable', 'only-old'])
  })

  it('keeps a display name from any list', () => {
    const merged = mergeModelLists([fresh, stale])
    expect(merged.find(model => model.value === 'default')?.displayName).toBe('Default')
    expect(merged.find(model => model.value === 'claude-fable-5-2')?.displayName).toBe('Fable 5.2')
  })

  it('falls back to the basic aliases when nobody has a list', () => {
    expect(mergeModelLists([null, undefined, []])).toEqual(FALLBACK_MODEL_OPTIONS)
  })
})

describe('cleanModelId', () => {
  it('trims and rejects junk', () => {
    expect(cleanModelId('  claude-fable-5-2 ')).toBe('claude-fable-5-2')
    expect(cleanModelId('')).toBeNull()
    expect(cleanModelId('two words')).toBeNull()
    expect(cleanModelId(null)).toBeNull()
  })
})

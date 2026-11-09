import { describe, expect, it } from 'vitest'

import { clampToMaxLength, isVoiceTypeField, spliceDictation, type FieldLike, type ParentLike } from '../voice/voice-type-field'

function parent(hasMic = false, up: ParentLike | null = null): ParentLike {
  return { parentElement: up, querySelector: () => (hasMic ? {} : null) }
}

function field(patch: Partial<FieldLike> & { optedOut?: boolean } = {}): FieldLike {
  const { optedOut, ...rest } = patch
  return {
    tagName: 'INPUT',
    type: 'text',
    readOnly: false,
    disabled: false,
    getAttribute: () => null,
    closest: (selector: string) => (optedOut && selector.includes('off') ? {} : null),
    parentElement: parent(false, parent(false, parent(false))),
    ...rest,
  }
}

describe('isVoiceTypeField', () => {
  it('takes text inputs and textareas', () => {
    expect(isVoiceTypeField(field())).toBe(true)
    expect(isVoiceTypeField(field({ type: '' }))).toBe(true)
    expect(isVoiceTypeField(field({ type: 'search' }))).toBe(true)
    expect(isVoiceTypeField(field({ tagName: 'TEXTAREA', type: 'textarea' }))).toBe(true)
  })

  it('skips passwords, numbers, sliders and non-fields', () => {
    for (const type of ['password', 'number', 'range', 'checkbox', 'color', 'file']) {
      expect(isVoiceTypeField(field({ type }))).toBe(false)
    }
    expect(isVoiceTypeField(field({ tagName: 'DIV' }))).toBe(false)
    expect(isVoiceTypeField(null)).toBe(false)
  })

  it('skips read-only and disabled fields', () => {
    expect(isVoiceTypeField(field({ readOnly: true }))).toBe(false)
    expect(isVoiceTypeField(field({ disabled: true }))).toBe(false)
  })

  it('skips fields that opt out or already have their own mic next to them', () => {
    expect(isVoiceTypeField(field({ optedOut: true }))).toBe(false)
    expect(isVoiceTypeField(field({ parentElement: parent(true) }))).toBe(false)
    expect(isVoiceTypeField(field({ parentElement: parent(false, parent(true)) }))).toBe(false)
  })

  it('a mic far up the tree (another panel) does not count', () => {
    expect(isVoiceTypeField(field({ parentElement: parent(false, parent(false, parent(false, parent(true)))) }))).toBe(true)
  })
})

describe('spliceDictation', () => {
  it('fills an empty field', () => {
    expect(spliceDictation('', ' hello world ', '')).toEqual({ value: 'hello world', caret: 11 })
  })

  it('adds a space after typed words', () => {
    expect(spliceDictation('the fps', 'drops over time', '')).toEqual({ value: 'the fps drops over time', caret: 23 })
  })

  it('inserts in the middle with spaces on both sides', () => {
    expect(spliceDictation('a', 'big', 'bug')).toEqual({ value: 'a big bug', caret: 5 })
  })

  it('does not double spaces or space before punctuation', () => {
    expect(spliceDictation('a ', 'big', ' bug')).toEqual({ value: 'a big bug', caret: 5 })
    expect(spliceDictation('it is', 'broken', '.')).toEqual({ value: 'it is broken.', caret: 12 })
  })

  it('nothing spoken leaves the field as it was', () => {
    expect(spliceDictation('ab', '  ', 'cd')).toEqual({ value: 'abcd', caret: 2 })
  })
})

describe('clampToMaxLength', () => {
  it('cuts only the spoken part', () => {
    expect(clampToMaxLength('12345', 'abcdefgh', '', 10)).toBe('abc')
    expect(clampToMaxLength('12345', 'abc', '', 100)).toBe('abc')
    expect(clampToMaxLength('1234567890', 'abc', '', 10)).toBe('')
    expect(clampToMaxLength('x', 'abc', '', null)).toBe('abc')
  })
})

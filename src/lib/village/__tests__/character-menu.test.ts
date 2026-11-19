import { describe, expect, it } from 'vitest'

import { CHARACTER_TABS, characterKeyAction, isCharacterTab, levelProgressNumbers, type CharacterKeyContext } from '../character-menu'

const base: CharacterKeyContext = { code: 'KeyK', ctrl: false, meta: false, alt: false, repeat: false, typing: false, open: false, tab: 'character', readerOpen: false, agentOpen: false, worldKeysFree: true }

describe('the character menu keys', () => {
  it('K opens it on Skills while walking; not while typing, with an agent open, or with a modifier', () => {
    expect(characterKeyAction(base)).toBe('open-skills')
    expect(characterKeyAction({ ...base, typing: true })).toBeNull()
    expect(characterKeyAction({ ...base, agentOpen: true })).toBeNull()
    expect(characterKeyAction({ ...base, worldKeysFree: false })).toBeNull()
    expect(characterKeyAction({ ...base, ctrl: true })).toBeNull()
    expect(characterKeyAction({ ...base, repeat: true })).toBeNull()
    expect(characterKeyAction({ ...base, code: 'Escape' })).toBeNull()
  })

  it('K on Skills closes it; K on another tab goes to Skills', () => {
    expect(characterKeyAction({ ...base, open: true, tab: 'skills' })).toBe('close')
    expect(characterKeyAction({ ...base, open: true, tab: 'keys' })).toBe('to-skills')
    expect(characterKeyAction({ ...base, open: true, tab: 'character', typing: true })).toBeNull()
  })

  it('Esc closes it, after an open sheet and never from a text field', () => {
    const open = { ...base, open: true, code: 'Escape' }
    expect(characterKeyAction(open)).toBe('close')
    expect(characterKeyAction({ ...open, readerOpen: true })).toBeNull()
    expect(characterKeyAction({ ...open, typing: true })).toBeNull()
    expect(characterKeyAction({ ...base, open: true, code: 'KeyE' })).toBeNull()
  })

  it('three tabs, in order', () => {
    expect(CHARACTER_TABS.map(tab => tab.id)).toEqual(['character', 'skills', 'keys'])
    expect(isCharacterTab('keys')).toBe(true)
    expect(isCharacterTab('profile')).toBe(false)
  })
})

describe('level progress', () => {
  it('splits the level span into done and to go', () => {
    expect(levelProgressNumbers(21149, 0.1574, 9700)).toEqual({ into: 1527, span: 9700, left: 8173 })
    expect(levelProgressNumbers(0, 0, 100)).toEqual({ into: 0, span: 100, left: 100 })
    expect(levelProgressNumbers(5, 2, 0)).toEqual({ into: 1, span: 1, left: 0 })
  })
})

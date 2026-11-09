import { describe, expect, it } from 'vitest'
import { composerHeight, composerMaxHeight, villageKeyAction, type VillageKeyContext } from '../village/village-keys'

function keys(code: string, patch: Partial<VillageKeyContext> = {}): ReturnType<typeof villageKeyAction> {
  return villageKeyAction({
    code,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    repeat: false,
    typing: false,
    focusedAgentId: null,
    nearbyAgentId: null,
    worldKeysFree: true,
    inPlaza: false,
    agentCount: 2,
    ...patch,
  })
}

describe('villageKeyAction: walking up to an agent', () => {
  it('T next to an agent opens it with the mic, E opens it quietly', () => {
    expect(keys('KeyT', { nearbyAgentId: 'rick' })).toBe('talk')
    expect(keys('KeyE', { nearbyAgentId: 'rick' })).toBe('open')
  })

  it('leaves T and E to the world when nobody is near (rotate gizmo, noclip down)', () => {
    expect(keys('KeyT')).toBeNull()
    expect(keys('KeyE')).toBeNull()
  })

  it('E in the summoning circle opens the picker, T there does nothing', () => {
    expect(keys('KeyE', { inPlaza: true })).toBe('picker')
    expect(keys('KeyT', { inPlaza: true })).toBeNull()
  })

  it('stays out of the way while placing, painting or typing in another panel', () => {
    expect(keys('KeyT', { nearbyAgentId: 'rick', worldKeysFree: false })).toBeNull()
    expect(keys('KeyE', { nearbyAgentId: 'rick', worldKeysFree: false })).toBeNull()
    expect(keys('KeyT', { nearbyAgentId: 'rick', typing: true })).toBeNull()
  })

  it('ignores held keys and modifier chords', () => {
    expect(keys('KeyT', { nearbyAgentId: 'rick', repeat: true })).toBeNull()
    expect(keys('KeyT', { nearbyAgentId: 'rick', ctrl: true })).toBeNull()
    expect(keys('KeyT', { nearbyAgentId: 'rick', alt: true })).toBeNull()
  })
})

describe('villageKeyAction: with an agent open', () => {
  const open = { focusedAgentId: 'rick', nearbyAgentId: 'rick' }

  it('T toggles the mic, Enter sends, F zooms, Esc goes back a step', () => {
    expect(keys('KeyT', open)).toBe('toggle-voice')
    expect(keys('Enter', open)).toBe('send')
    expect(keys('KeyF', open)).toBe('toggle-screen')
    expect(keys('Escape', open)).toBe('escape')
  })

  it('Shift+Enter is not a send', () => {
    expect(keys('Enter', { ...open, shift: true })).toBeNull()
  })

  it('T toggles the open agent\'s mic even when another agent is the nearest', () => {
    expect(keys('KeyT', { focusedAgentId: 'rick', nearbyAgentId: 'tyler' })).toBe('toggle-voice')
    // E still switches to the nearest one
    expect(keys('KeyE', { focusedAgentId: 'rick', nearbyAgentId: 'tyler' })).toBe('open')
  })

  it('keys typed into the box stay in the box, except Ctrl+Space', () => {
    for (const code of ['KeyT', 'Enter', 'KeyF', 'Escape', 'KeyN']) {
      expect(keys(code, { ...open, typing: true })).toBeNull()
    }
    expect(keys('Space', { ...open, typing: true, ctrl: true })).toBe('toggle-voice')
  })

  it('E on the agent that is already open does nothing', () => {
    expect(keys('KeyE', open)).toBeNull()
  })

  it('N jumps to the next agent, unless the village is empty', () => {
    expect(keys('KeyN', open)).toBe('next')
    expect(keys('KeyN', { agentCount: 0 })).toBeNull()
    expect(keys('KeyN', { ...open, shift: true })).toBeNull()
  })
})

describe('composerHeight', () => {
  it('grows with the text between the minimum and the cap', () => {
    expect(composerHeight({ content: 30, min: 64, max: 450 })).toBe(64)
    expect(composerHeight({ content: 200, min: 64, max: 450 })).toBe(200)
    expect(composerHeight({ content: 1200, min: 64, max: 450 })).toBe(450)
  })

  it('a height dragged by hand is the new floor, still under the cap', () => {
    expect(composerHeight({ content: 30, min: 64, max: 450, manual: 220 })).toBe(220)
    expect(composerHeight({ content: 300, min: 64, max: 450, manual: 220 })).toBe(300)
    expect(composerHeight({ content: 30, min: 64, max: 450, manual: 900 })).toBe(450)
    expect(composerHeight({ content: 30, min: 64, max: 450, manual: null })).toBe(64)
  })

  it('never ends up below the minimum, even with a tiny cap', () => {
    expect(composerHeight({ content: 500, min: 96, max: 40 })).toBe(96)
  })

  it('caps at about 450 px, or under half of what holds it', () => {
    expect(composerMaxHeight(1400)).toBe(450)
    expect(composerMaxHeight(1056)).toBe(450)
    expect(composerMaxHeight(696)).toBe(313)
    expect(composerMaxHeight(750)).toBe(338)
    expect(composerMaxHeight(100)).toBe(96)
  })
})

import { describe, expect, it } from 'vitest'
import { TAG, agentTagColor, shadeColor, tagMarker, tagScale, tagText } from '../village-tags'

describe('tagMarker', () => {
  it('asks with "?" and tells with "!"', () => {
    expect(tagMarker('needs-decision', false)).toBe('?')
    expect(tagMarker('error', false)).toBe('!')
    expect(tagMarker('waiting', true)).toBe('!')
  })
  it('shows nothing once the owner looked, or while it works', () => {
    expect(tagMarker('waiting', false)).toBeNull()
    expect(tagMarker('working', true)).toBeNull()
    expect(tagMarker('idle', false)).toBeNull()
    expect(tagMarker(null, true)).toBeNull()
  })
})

describe('agentTagColor', () => {
  const lightness = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    return (Math.max(...channels) + Math.min(...channels)) / 510
  }
  it('is the same every time for a name, and differs between names', () => {
    expect(agentTagColor('Anorak')).toBe(agentTagColor('Anorak'))
    expect(agentTagColor('Anorak')).not.toBe(agentTagColor('Companion'))
  })
  it('is always bright, whatever the chat colour', () => {
    for (const panel of [null, '#070c18', '#1a0b2e', '#141414', '#000000', 'nonsense']) {
      const color = agentTagColor('Hipster', panel)
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(lightness(color)).toBeGreaterThan(0.6)
    }
  })
  it('takes the hue of a chat colour that has one, and ignores a grey one', () => {
    expect(agentTagColor('A', '#2a0f0f')).toBe(agentTagColor('B', '#2a0f0f'))
    expect(agentTagColor('A', '#141414')).toBe(agentTagColor('A'))
  })
  it('shades darker', () => {
    expect(lightness(shadeColor(agentTagColor('A')))).toBeLessThan(0.35)
    expect(shadeColor('oops')).toBe('#222222')
  })
})

describe('tagText', () => {
  it('keeps plain text and replaces what the font cannot draw', () => {
    expect(tagText('Anorak')).toBe('Anorak')
    expect(tagText('working ×3')).toBe('working x3')
    expect(tagText('observing · helpers')).toBe('observing - helpers')
    expect(tagText('Zoë')).toBe('Zoe')
    expect(tagText('猫 cat')).toBe('? cat')
  })
  it('cuts long text', () => {
    const cut = tagText('a'.repeat(60), 20)
    expect(cut.length).toBe(20)
    expect(cut.endsWith('...')).toBe(true)
  })
})

describe('tagScale', () => {
  it('is 1 up close, grows with distance, and stops', () => {
    expect(tagScale(2)).toBe(1)
    expect(tagScale(TAG.growFrom)).toBe(1)
    expect(tagScale(TAG.growFrom * 2)).toBe(2)
    expect(tagScale(500)).toBe(TAG.growMax)
    expect(tagScale(Number.NaN)).toBe(1)
  })
})

import { ACCENT_SWATCHES, accentBackground, defaultAccent, readableAccent } from '../village-tags'
import { TAG_SIZE, clampTagSettings } from '../tag-style'

describe('accent colour', () => {
  it('starts the same every time for an agent, differs between agents', () => {
    expect(defaultAccent('session-a')).toBe(defaultAccent('session-a'))
    expect(defaultAccent('session-a')).not.toBe(defaultAccent('session-b'))
  })
  it('makes a dark pick readable, and keeps its hue', () => {
    const lift = readableAccent('#10204a')
    expect(lift).not.toBe('#10204a')
    expect(readableAccent(ACCENT_SWATCHES[0])).toMatch(/^#[0-9a-f]{6}$/)
    expect(readableAccent('nonsense')).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('gives a dark chat background from it', () => {
    const bg = accentBackground('#5eead4')
    const n = parseInt(bg.slice(1), 16)
    expect(Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255)).toBeLessThan(70)
  })
})

describe('tag settings', () => {
  it('clamps size and falls back on an unknown style', () => {
    expect(clampTagSettings({ size: 99 }).size).toBe(TAG_SIZE.max)
    expect(clampTagSettings({ size: 0 }).size).toBe(TAG_SIZE.min)
    expect(clampTagSettings({ style: 'nope' as never }).style).toBe('extruded')
    expect(clampTagSettings(null)).toEqual({ style: 'extruded', size: 0.5 })
    // The styles taken out read as the default.
    expect(clampTagSettings({ style: 'crazy' as never }).style).toBe('extruded')
    expect(clampTagSettings({ style: 'layered' as never }).style).toBe('extruded')
    expect(clampTagSettings({ style: 'outline', size: 1.5 })).toEqual({ style: 'outline', size: 1.5 })
  })
})

import { SIDE_DARKER, divideColor } from '../village-tags'

describe('the sides of 3D letters', () => {
  it('are 2.6 times darker than the faces, channel by channel', () => {
    expect(SIDE_DARKER).toBe(2.6)
    expect(divideColor('#ffffff', 2.6)).toBe('#626262')
    expect(divideColor('#5adcf6', 2.6)).toBe('#23555f')
    expect(divideColor('nonsense', 2.6)).toBe('#000000')
  })
})

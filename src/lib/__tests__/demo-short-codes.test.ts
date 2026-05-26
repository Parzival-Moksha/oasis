import { describe, expect, it } from 'vitest'

import {
  demoEntryPath,
  listDemoShortCodes,
  resolveDemoShortCode,
  sanitizeDemoCode,
  sanitizeDemoSlug,
} from '../demo-short-codes'

describe('demo short codes', () => {
  it('ships with short, QR-friendly defaults for the May 28 demo', () => {
    const codes = listDemoShortCodes({})
    expect(codes.map(entry => entry.code)).toContain('ai')
    expect(codes.map(entry => entry.code)).toContain('ab12')
    expect(resolveDemoShortCode('AB12', {})?.event).toBe('ai-tinkerers-bogota-may-2026')
  })

  it('parses configured CSV codes over the defaults', () => {
    const codes = listDemoShortCodes({
      OASIS_DEMO_SHORT_CODES: 'zz:bogota-afterparty:4:6:10, bad code!!:demo-two',
    })
    expect(codes.find(entry => entry.code === 'zz')).toMatchObject({
      event: 'bogota-afterparty',
      targetCap: 4,
      hardCap: 6,
      maxShards: 10,
    })
    expect(codes.find(entry => entry.code === 'badcode')?.event).toBe('demo-two')
  })

  it('parses configured JSON codes', () => {
    const codes = listDemoShortCodes({
      OASIS_DEMO_SHORT_CODES: JSON.stringify([
        { code: 'x1', event: 'May 28 Big Room', targetCap: 7, hardCap: 9, maxShards: 3, label: 'Big room' },
      ]),
    })
    expect(codes.find(entry => entry.code === 'x1')).toMatchObject({
      event: 'may-28-big-room',
      targetCap: 7,
      hardCap: 9,
      maxShards: 3,
      label: 'Big room',
    })
  })

  it('builds the canonical /demo assignment URL', () => {
    const entry = resolveDemoShortCode('ai', {})!
    expect(demoEntryPath(entry)).toBe('/demo?event=ai-tinkerers-bogota-may-2026&target=8&hard=12&maxShards=16')
  })

  it('sanitizes event slugs and codes conservatively', () => {
    expect(sanitizeDemoSlug('May 28 AI Tinkerers Bogota!!!')).toBe('may-28-ai-tinkerers-bogota')
    expect(sanitizeDemoCode(' AB-12!! ')).toBe('ab12')
  })
})

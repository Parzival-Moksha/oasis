import { describe, expect, it } from 'vitest'
import { getOasisMode, getOasisProfile, isHostedOasis, resolveVillageProfile } from '../oasis-profile'

describe('village profile (server env)', () => {
  it('is a local profile selected by OASIS_PROFILE or NEXT_PUBLIC_OASIS_PROFILE', () => {
    expect(getOasisProfile({ OASIS_PROFILE: 'village' })).toBe('village')
    expect(getOasisProfile({ NEXT_PUBLIC_OASIS_PROFILE: 'village' })).toBe('village')
    expect(getOasisMode({ OASIS_PROFILE: 'village' })).toBe('local')
    expect(isHostedOasis({ NEXT_PUBLIC_OASIS_PROFILE: 'village' })).toBe(false)
  })

  it('never overrides hosted deployments', () => {
    expect(getOasisProfile({ OASIS_MODE: 'hosted', OASIS_PROFILE: 'village' })).toBe('hosted-openclaw')
    expect(getOasisProfile({ OASIS_MODE: 'hosted', NEXT_PUBLIC_OASIS_PROFILE: 'village' })).toBe('hosted-openclaw')
    expect(getOasisProfile({ OASIS_PROFILE: 'hosted-openclaw', NEXT_PUBLIC_OASIS_PROFILE: 'village' })).toBe('hosted-openclaw')
  })

  it('leaves the existing profiles unchanged', () => {
    expect(getOasisProfile({})).toBe('local')
    expect(getOasisProfile({ OASIS_PROFILE: 'local', OASIS_MODE: 'hosted' })).toBe('local')
    expect(getOasisProfile({ OASIS_MODE: 'hosted' })).toBe('hosted-openclaw')
  })
})

describe('resolveVillageProfile (client switch)', () => {
  it('is off by default', () => {
    expect(resolveVillageProfile({})).toBe(false)
    expect(resolveVillageProfile({ search: '?world=abc', envProfile: '' })).toBe(false)
  })

  it('turns on with ?profile=village or NEXT_PUBLIC_OASIS_PROFILE=village', () => {
    expect(resolveVillageProfile({ search: '?profile=village' })).toBe(true)
    expect(resolveVillageProfile({ search: '?a=1&profile=VILLAGE' })).toBe(true)
    expect(resolveVillageProfile({ envProfile: 'village', search: '' })).toBe(true)
  })

  it('lets ?profile=local opt one tab out of an env-enabled village', () => {
    expect(resolveVillageProfile({ envProfile: 'village', search: '?profile=local' })).toBe(false)
    expect(resolveVillageProfile({ envProfile: 'village', search: '?profile=default' })).toBe(false)
  })

  it('remembers the tab override after OasisClient strips the URL params', () => {
    expect(resolveVillageProfile({ search: '', storedProfile: 'village' })).toBe(true)
    expect(resolveVillageProfile({ search: '', storedProfile: 'local', envProfile: 'village' })).toBe(false)
    expect(resolveVillageProfile({ search: '?profile=local', storedProfile: 'village' })).toBe(false)
    expect(resolveVillageProfile({ search: '', storedProfile: 'garbage' })).toBe(false)
  })

  it('is always off in hosted mode', () => {
    expect(resolveVillageProfile({ search: '?profile=village', mode: 'hosted' })).toBe(false)
    expect(resolveVillageProfile({ envProfile: 'village', mode: 'hosted' })).toBe(false)
    expect(resolveVillageProfile({ storedProfile: 'village', mode: 'hosted' })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import {
  canDiscoverWorld,
  canEditWorldSettings,
  canReadWorld,
  getWorldWriteDecision,
  normalizeWorldKind,
  toStorageVisibility,
  type WorldAccessContext,
} from '../forge/world-access'

const hostedUser: WorldAccessContext = { userId: 'user-a', mode: 'hosted' }
const hostedAdmin: WorldAccessContext = { userId: 'hosted-admin', mode: 'hosted', admin: true }
const localUser: WorldAccessContext = { userId: 'local-user', mode: 'local' }

function world(visibility: string, userId = 'owner') {
  return { id: `${visibility}-world`, userId, visibility }
}

describe('world access policy', () => {
  it('normalizes legacy visibility names to hosted product kinds', () => {
    expect(normalizeWorldKind('public_edit')).toBe('ffa')
    expect(normalizeWorldKind('ffa')).toBe('ffa')
    expect(normalizeWorldKind('unlisted')).toBe('only-with-link')
    expect(normalizeWorldKind('only-with-link')).toBe('only-with-link')
    expect(normalizeWorldKind('core')).toBe('core')
    expect(normalizeWorldKind('template')).toBe('template')
    expect(normalizeWorldKind(undefined)).toBe('private')
  })

  it('stores new public product names through backwards-compatible values', () => {
    expect(toStorageVisibility('ffa')).toBe('public_edit')
    expect(toStorageVisibility('only-with-link')).toBe('unlisted')
    expect(toStorageVisibility('core')).toBe('core')
    expect(toStorageVisibility('template')).toBe('template')
    expect(toStorageVisibility('nonsense')).toBeNull()
  })

  it('lets hosted sessions discover public surfaces but not private or link-only worlds', () => {
    expect(canDiscoverWorld(hostedUser, world('core'))).toBe(true)
    expect(canDiscoverWorld(hostedUser, world('template'))).toBe(true)
    expect(canDiscoverWorld(hostedUser, world('public'))).toBe(true)
    expect(canDiscoverWorld(hostedUser, world('public_edit'))).toBe(true)
    expect(canDiscoverWorld(hostedUser, world('unlisted'))).toBe(false)
    expect(canDiscoverWorld(hostedUser, world('private'))).toBe(false)
  })

  it('lets hosted sessions read link-only worlds by id without exposing private worlds', () => {
    expect(canReadWorld(hostedUser, world('unlisted'))).toBe(true)
    expect(canReadWorld(hostedUser, world('only-with-link'))).toBe(true)
    expect(canReadWorld(hostedUser, world('private'))).toBe(false)
    expect(canReadWorld(hostedUser, world('private', 'user-a'))).toBe(true)
  })

  it('denies core mutation and forks templates on normal writes', () => {
    expect(getWorldWriteDecision(hostedUser, world('core'))).toBe('deny')
    expect(getWorldWriteDecision(hostedUser, world('template'))).toBe('fork')
    expect(getWorldWriteDecision(localUser, world('core'))).toBe('deny')
    expect(getWorldWriteDecision(localUser, world('template'))).toBe('fork')
  })

  it('lets hosted admins mutate core and template worlds deliberately', () => {
    expect(getWorldWriteDecision(hostedAdmin, world('core'))).toBe('write')
    expect(getWorldWriteDecision(hostedAdmin, world('template'))).toBe('write')
    expect(canEditWorldSettings(hostedAdmin, world('core'))).toBe(true)
  })

  it('allows FFA writes while preserving settings ownership', () => {
    expect(getWorldWriteDecision(hostedUser, world('public_edit'))).toBe('write')
    expect(getWorldWriteDecision(hostedUser, world('ffa'))).toBe('write')
    expect(canEditWorldSettings(hostedUser, world('ffa'))).toBe(false)
    expect(canEditWorldSettings(hostedUser, world('ffa', 'user-a'))).toBe(true)
  })

  it('keeps local mode permissive for normal non-system worlds', () => {
    expect(canReadWorld(localUser, world('private', 'other-user'))).toBe(true)
    expect(getWorldWriteDecision(localUser, world('private', 'other-user'))).toBe('write')
    expect(canEditWorldSettings(localUser, world('public', 'other-user'))).toBe(true)
  })
})

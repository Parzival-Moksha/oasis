import { describe, expect, it } from 'vitest'

import {
  buildDefaultWorldManifestEntry,
  buildDefaultWorldSeed,
  parseDefaultWorldManifest,
  upsertDefaultWorldManifestEntry,
  type DefaultWorldSource,
} from '../default-world-seeds'

const sourceWorld: DefaultWorldSource = {
  id: 'world-welcome-hub-system',
  userId: 'local-user',
  name: 'Welcome Hub',
  icon: null,
  visibility: 'core',
  creatorName: null,
  creatorAvatar: null,
  thumbnailUrl: null,
  data: JSON.stringify({
    craftedScenes: [],
    portalGates: [{ id: 'portal-a' }],
  }),
}

describe('default world seed helpers', () => {
  it('builds a default-world seed from a saved world row', () => {
    const seed = buildDefaultWorldSeed(sourceWorld, {
      slug: 'portal-zero',
      name: 'Portal Zero',
    })

    expect(seed).toMatchObject({
      seedVersion: 1,
      slug: 'portal-zero',
      id: 'world-welcome-hub-system',
      userId: 'local-user',
      name: 'Portal Zero',
      icon: '0',
      visibility: 'core',
      creatorName: 'The Oasis',
    })
    expect(seed.data).toEqual({
      craftedScenes: [],
      portalGates: [{ id: 'portal-a' }],
    })
  })

  it('uses explicit icon and visibility overrides when provided', () => {
    const seed = buildDefaultWorldSeed(sourceWorld, {
      slug: 'portal-zero',
      icon: 'P0',
      visibility: 'public',
    })

    expect(seed.name).toBe('Welcome Hub')
    expect(seed.icon).toBe('P0')
    expect(seed.visibility).toBe('public')
  })

  it('replaces manifest entries by slug or id and keeps the list sorted', () => {
    const seed = buildDefaultWorldSeed(sourceWorld, {
      slug: 'portal-zero',
      name: 'Portal Zero',
    })
    const entry = buildDefaultWorldManifestEntry(seed, 'portal-zero.world.json')
    const manifest = upsertDefaultWorldManifestEntry({
      seedVersion: 1,
      worlds: [
        { slug: 'zeta', id: 'world-zeta', file: 'zeta.world.json', name: 'Zeta', visibility: 'private' },
        { slug: 'portal-zero-old', id: 'world-welcome-hub-system', file: 'old.world.json', name: 'Old', visibility: 'core' },
        { slug: 'portal-zero', id: 'old-id', file: 'also-old.world.json', name: 'Also Old', visibility: 'core' },
      ],
    }, entry)

    expect(manifest.worlds).toEqual([
      entry,
      { slug: 'zeta', id: 'world-zeta', file: 'zeta.world.json', name: 'Zeta', visibility: 'private' },
    ])
  })

  it('normalizes incomplete manifest JSON', () => {
    expect(parseDefaultWorldManifest('{ "worlds": null }')).toEqual({
      seedVersion: 1,
      worlds: [],
    })
  })
})

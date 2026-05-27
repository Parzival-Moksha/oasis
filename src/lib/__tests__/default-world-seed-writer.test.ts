import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mirrorDefaultWorldSeed } from '../default-world-seed-writer'
import type { DefaultWorldSource } from '../default-world-seeds'

function worldSource(overrides: Partial<DefaultWorldSource> = {}): DefaultWorldSource {
  return {
    id: 'world-welcome-hub-system',
    userId: 'local-user',
    name: 'Portal Zero',
    icon: '0',
    visibility: 'core',
    pvpEnabled: null,
    creatorName: 'The Oasis',
    creatorAvatar: null,
    thumbnailUrl: null,
    data: JSON.stringify({
      version: 1,
      catalogPlacements: [{ id: 'cat-1' }],
      portalGates: [],
    }),
    ...overrides,
  }
}

describe('default world seed writer', () => {
  const originalCwd = process.cwd()
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oasis-default-worlds-'))
    process.chdir(tempDir)
    await mkdir(join(tempDir, 'prisma', 'default-worlds'), { recursive: true })
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true })
  })

  it('updates an existing manifest-backed seed file', async () => {
    const root = join(tempDir, 'prisma', 'default-worlds')
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
      seedVersion: 1,
      worlds: [
        {
          slug: 'portal-zero',
          id: 'world-welcome-hub-system',
          file: 'portal-zero.world.json',
          name: 'Portal Zero',
          visibility: 'core',
        },
      ],
    }, null, 2)}\n`)

    const result = await mirrorDefaultWorldSeed(worldSource({
      data: JSON.stringify({ version: 1, catalogPlacements: [{ id: 'changed' }] }),
    }))

    expect(result).toMatchObject({ updated: true, slug: 'portal-zero', file: 'portal-zero.world.json' })
    const seed = JSON.parse(await readFile(join(root, 'portal-zero.world.json'), 'utf8'))
    expect(seed.data.catalogPlacements).toEqual([{ id: 'changed' }])
  })

  it('keeps Portal Zero runtime-only fields out of the seed', async () => {
    const root = join(tempDir, 'prisma', 'default-worlds')
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
      seedVersion: 1,
      worlds: [
        {
          slug: 'portal-zero',
          id: 'world-welcome-hub-system',
          file: 'portal-zero.world.json',
          name: 'Portal Zero',
          visibility: 'core',
        },
      ],
    }, null, 2)}\n`)

    await mirrorDefaultWorldSeed(worldSource({
      data: JSON.stringify({
        version: 1,
        catalogPlacements: [
          { id: 'demo-card', imageUrl: '/generated-images/img_mpogyvugxdxx.png' },
        ],
        portalGates: [
          { id: 'portal-zero-new-ffa-world' },
          { id: 'portal-zero-ffa-world-world-local' },
          { id: 'portal-zero-public-world-world-local' },
        ],
        spatialWebObjects: [
          {
            id: 'spatial-google-forms-altar-portal-zero',
            formId: 'portal-zero-google-forms-altar',
            value: 'http://localhost:4516/2131',
            statusMessage: 'COPIED. PORTAL OPENING...',
            generatedWorldUrl: 'http://localhost:4516/2131',
            submittedAt: '2026-05-27T17:16:30.533Z',
          },
        ],
      }),
    }))

    const seed = JSON.parse(await readFile(join(root, 'portal-zero.world.json'), 'utf8'))
    expect(seed.data.catalogPlacements[0].imageUrl).toBe('/generated-images/img_mpogyvugxdxx.png?v=pz-may28-images-2')
    expect(seed.data.portalGates).toEqual([{ id: 'portal-zero-new-ffa-world' }])
    expect(seed.data.spatialWebObjects[0]).toMatchObject({
      id: 'spatial-google-forms-altar-portal-zero',
      value: '',
      statusMessage: 'PASTE A GOOGLE FORMS URL',
    })
    expect(seed.data.spatialWebObjects[0].generatedWorldUrl).toBeUndefined()
    expect(seed.data.spatialWebObjects[0].submittedAt).toBeUndefined()
  })

  it('creates a new seed and manifest entry when a world becomes core', async () => {
    const root = join(tempDir, 'prisma', 'default-worlds')
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify({ seedVersion: 1, worlds: [] }, null, 2)}\n`)

    const result = await mirrorDefaultWorldSeed(worldSource({
      id: 'world-signal-hub',
      name: 'Signal Hub',
      visibility: 'core',
      pvpEnabled: true,
    }))

    expect(result).toMatchObject({ updated: true, slug: 'signal-hub', file: 'signal-hub.world.json' })
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
    expect(manifest.worlds).toEqual([
      {
        slug: 'signal-hub',
        id: 'world-signal-hub',
        file: 'signal-hub.world.json',
        name: 'Signal Hub',
        visibility: 'core',
      },
    ])
    const seed = JSON.parse(await readFile(join(root, 'signal-hub.world.json'), 'utf8'))
    expect(seed.pvpEnabled).toBe(true)
  })

  it('skips non-manifest public worlds', async () => {
    const result = await mirrorDefaultWorldSeed(worldSource({
      id: 'world-public-user',
      name: 'Public User World',
      visibility: 'public',
    }))

    expect(result).toEqual({ updated: false, reason: 'not_seed_backed' })
  })
})

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: canViewAsset visibility rules across scope + world context.
// Pure function — no mocks needed.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import { canViewAsset } from '../types'
import type { LibraryAsset, AssetVisibilityContext, AssetScope } from '../types'

function makeAsset(overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: 'asset-1',
    kind: 'glb',
    path: '/models/foo.glb',
    name: 'Foo',
    scope: 'user',
    ownerId: 'viewer-alice',
    ...overrides,
  }
}

function ctx(overrides: Partial<AssetVisibilityContext> = {}): AssetVisibilityContext {
  return {
    viewerUserId: 'viewer-alice',
    ...overrides,
  }
}

describe('canViewAsset — core/shared scopes', () => {
  it('core-scope asset is visible regardless of ownership', () => {
    const a = makeAsset({ scope: 'core', ownerId: null })
    expect(canViewAsset(a, ctx({ viewerUserId: 'someone-else' }))).toBe(true)
  })

  it('core-scope asset is visible even if some non-null ownerId is set', () => {
    const a = makeAsset({ scope: 'core', ownerId: 'viewer-bob' })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(true)
  })

  it('shared-scope asset is visible regardless of ownership', () => {
    const a = makeAsset({ scope: 'shared', ownerId: null })
    expect(canViewAsset(a, ctx({ viewerUserId: 'random-viewer' }))).toBe(true)
  })

  it('shared-scope asset is visible even when ownerId belongs to a third party', () => {
    const a = makeAsset({ scope: 'shared', ownerId: 'viewer-bob' })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(true)
  })
})

describe('canViewAsset — user scope (ownership)', () => {
  it('user-scope asset is visible to its owner', () => {
    const a = makeAsset({ scope: 'user', ownerId: 'viewer-alice' })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(true)
  })

  it('user-scope asset is NOT visible to a non-owner without world override', () => {
    const a = makeAsset({ scope: 'user', ownerId: 'viewer-bob' })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(false)
  })

  it('user-scope asset with null ownerId (orphan) is invisible — even to itself', () => {
    const a = makeAsset({ scope: 'user', ownerId: null })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(false)
  })

  it('user-scope asset with undefined ownerId (orphan) is invisible', () => {
    const a = makeAsset({ scope: 'user', ownerId: undefined })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(false)
  })

  it('an orphan user-scope asset is hidden from every viewer (including local-user)', () => {
    const a = makeAsset({ scope: 'user', ownerId: null })
    expect(canViewAsset(a, ctx({ viewerUserId: 'local-user' }))).toBe(false)
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-bob' }))).toBe(false)
  })
})

describe('canViewAsset — public-visibility world override', () => {
  it('viewer sees the world owner’s user-scope assets when world is public', () => {
    const a = makeAsset({ scope: 'user', ownerId: 'viewer-bob' })
    const context = ctx({
      viewerUserId: 'viewer-alice',
      worldAssetVisibility: 'public',
      worldOwnerId: 'viewer-bob',
    })
    expect(canViewAsset(a, context)).toBe(true)
  })

  it('viewer does NOT see a third party’s asset in a public world', () => {
    const a = makeAsset({ scope: 'user', ownerId: 'viewer-charlie' })
    const context = ctx({
      viewerUserId: 'viewer-alice',
      worldAssetVisibility: 'public',
      worldOwnerId: 'viewer-bob',
    })
    expect(canViewAsset(a, context)).toBe(false)
  })

  it('private world does NOT grant override even when ownerId matches worldOwnerId', () => {
    const a = makeAsset({ scope: 'user', ownerId: 'viewer-bob' })
    const context = ctx({
      viewerUserId: 'viewer-alice',
      worldAssetVisibility: 'private',
      worldOwnerId: 'viewer-bob',
    })
    expect(canViewAsset(a, context)).toBe(false)
  })

  it('public world does NOT override the orphan rule (null ownerId stays hidden)', () => {
    const a = makeAsset({ scope: 'user', ownerId: null })
    const context = ctx({
      viewerUserId: 'viewer-alice',
      worldAssetVisibility: 'public',
      worldOwnerId: 'viewer-bob',
    })
    expect(canViewAsset(a, context)).toBe(false)
  })

  it('no world context (no visibility/ownerId) means no override', () => {
    const a = makeAsset({ scope: 'user', ownerId: 'viewer-bob' })
    expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(false)
  })
})

// Sanity coverage: types.ts exports AssetScope; this is a compile-only check.
describe('canViewAsset — type sanity', () => {
  it('accepts each declared scope value', () => {
    const scopes: AssetScope[] = ['core', 'shared', 'user']
    for (const scope of scopes) {
      const a = makeAsset({ scope, ownerId: scope === 'user' ? 'viewer-alice' : null })
      expect(canViewAsset(a, ctx({ viewerUserId: 'viewer-alice' }))).toBe(true)
    }
  })
})

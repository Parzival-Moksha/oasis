import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cookieState = vi.hoisted(() => {
  const state: {
    value?: string
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
  } = {
    value: undefined,
    get: vi.fn(),
    set: vi.fn(),
  }
  state.get.mockImplementation((name: string) => (
    name === 'oasis-viewer-id' && state.value ? { value: state.value } : undefined
  ))
  return state
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: cookieState.get,
    set: cookieState.set,
  })),
}))

import {
  VIEWER_COOKIE,
  VIEWER_FALLBACK,
  ensureViewerUserId,
  getViewerUserId,
} from '../viewer-identity'

describe('viewer identity', () => {
  const originalMode = process.env.OASIS_MODE
  const originalProfile = process.env.OASIS_PROFILE

  beforeEach(() => {
    vi.clearAllMocks()
    cookieState.value = undefined
    delete process.env.OASIS_PROFILE
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalProfile === undefined) delete process.env.OASIS_PROFILE
    else process.env.OASIS_PROFILE = originalProfile
  })

  it('ignores stale viewer cookies in local mode', async () => {
    process.env.OASIS_MODE = 'local'
    cookieState.value = 'viewer-stale-local'

    await expect(getViewerUserId()).resolves.toBe(VIEWER_FALLBACK)
    expect(cookieState.get).not.toHaveBeenCalled()
  })

  it('normalizes local mode back to local-user when bootstrapping', async () => {
    process.env.OASIS_MODE = 'local'
    cookieState.value = 'viewer-stale-local'

    await expect(ensureViewerUserId()).resolves.toBe(VIEWER_FALLBACK)
    expect(cookieState.set).toHaveBeenCalledWith(
      VIEWER_COOKIE,
      VIEWER_FALLBACK,
      expect.objectContaining({ httpOnly: false, path: '/', secure: false }),
    )
  })

  it('keeps an existing hosted viewer cookie', async () => {
    process.env.OASIS_MODE = 'hosted'
    cookieState.value = 'viewer-hosted-existing'

    await expect(ensureViewerUserId()).resolves.toBe('viewer-hosted-existing')
    expect(cookieState.set).not.toHaveBeenCalled()
  })

  it('mints a hosted viewer cookie when missing', async () => {
    process.env.OASIS_MODE = 'hosted'

    const viewerId = await ensureViewerUserId()

    expect(viewerId).toMatch(/^viewer-/)
    expect(cookieState.set).toHaveBeenCalledWith(
      VIEWER_COOKIE,
      viewerId,
      expect.objectContaining({ httpOnly: false, path: '/' }),
    )
  })
})

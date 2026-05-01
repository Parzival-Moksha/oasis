import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('../browser-active-world', () => ({
  readBrowserActiveWorldId: vi.fn(),
}))

vi.mock('../oasis-profile', () => ({
  getOasisMode: vi.fn(),
}))

vi.mock('../forge/world-server', () => ({
  getRegistry: vi.fn(),
  loadWorld: vi.fn(),
}))

import { readBrowserActiveWorldId } from '../browser-active-world'
import { getOasisMode } from '../oasis-profile'
import { getRegistry, loadWorld } from '../forge/world-server'
import { WELCOME_HUB_WORLD_ID, resolveActiveWorldForUser } from '../forge/world-active'

describe('resolveActiveWorldForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOasisMode).mockReturnValue('hosted')
    vi.mocked(readBrowserActiveWorldId).mockResolvedValue(null)
    vi.mocked(loadWorld).mockResolvedValue(null)
    vi.mocked(getRegistry).mockResolvedValue([])
  })

  it('uses a readable stored session world first', async () => {
    vi.mocked(readBrowserActiveWorldId).mockResolvedValue('world-user-active')
    vi.mocked(loadWorld).mockImplementation(async (worldId) => worldId === 'world-user-active' ? ({} as any) : null)

    await expect(resolveActiveWorldForUser('browser-session-a')).resolves.toEqual({
      worldId: 'world-user-active',
      source: 'stored',
      authoritative: true,
    })
  })

  it('sends fresh hosted sessions to the core Welcome Hub', async () => {
    vi.mocked(loadWorld).mockImplementation(async (worldId) => worldId === WELCOME_HUB_WORLD_ID ? ({} as any) : null)

    await expect(resolveActiveWorldForUser('browser-session-a')).resolves.toEqual({
      worldId: WELCOME_HUB_WORLD_ID,
      source: 'welcome',
      authoritative: true,
    })
  })

  it('falls back to registry in local mode without making it authoritative', async () => {
    vi.mocked(getOasisMode).mockReturnValue('local')
    vi.mocked(getRegistry).mockResolvedValue([
      { id: 'world-local', name: 'The Forge', icon: 'F', visibility: 'private', createdAt: '', lastSavedAt: '' },
    ])

    await expect(resolveActiveWorldForUser('local-user')).resolves.toEqual({
      worldId: 'world-local',
      source: 'registry',
      authoritative: false,
    })
  })
})

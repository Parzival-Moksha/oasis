import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  savedBatches,
  removedKeys,
  storage,
  saveClientAgentSessionCaches,
  readBrowserStorage,
  removeBrowserStorage,
} = vi.hoisted(() => {
  const storage = new Map<string, string>()
  const removedKeys: string[] = []
  const savedBatches: Array<{ agentType: string; sessions: unknown[] }> = []
  return {
    storage,
    removedKeys,
    savedBatches,
    saveClientAgentSessionCaches: vi.fn(async (agentType: string, sessions: unknown[]) => {
      savedBatches.push({ agentType, sessions })
      return true
    }),
    readBrowserStorage: vi.fn((key: string) => storage.get(key) || null),
    removeBrowserStorage: vi.fn((key: string) => {
      removedKeys.push(key)
      storage.delete(key)
    }),
  }
})

vi.mock('@/lib/agent-session-cache-client', () => ({
  saveClientAgentSessionCaches,
}))

vi.mock('@/lib/browser-storage', () => ({
  readBrowserStorage,
  removeBrowserStorage,
}))

import { runLocalStorageAgentCacheMigration } from '@/lib/localstorage-agent-cache-migration'

describe('runLocalStorageAgentCacheMigration', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {}
    storage.clear()
    removedKeys.length = 0
    savedBatches.length = 0
    saveClientAgentSessionCaches.mockClear()
    readBrowserStorage.mockClear()
    removeBrowserStorage.mockClear()
  })

  it('moves known heavy localStorage session keys into agent cache batches', async () => {
    storage.set('oasis-merlin-sessions', JSON.stringify([
      {
        id: 'merlin-1',
        label: 'Merlin session',
        model: 'opus',
        createdAt: '2026-04-25T00:00:00.000Z',
        messages: [
          { id: 'm1', role: 'user', content: 'build a tower', timestamp: 1000 },
          { id: 'm2', role: 'merlin', content: 'done', timestamp: 2000 },
        ],
      },
    ]))
    storage.set('oasis-anorak-pro-sessions', JSON.stringify([
      {
        id: 'anorak-1',
        name: 'Anorak mission',
        createdAt: '2026-04-25T00:00:00.000Z',
        entries: [{ id: 1, type: 'text', content: 'ship it', timestamp: 3000 }],
      },
    ]))
    storage.set('oasis-hermes-native-session-cache', JSON.stringify({
      'hermes-1': [
        { id: 'h1', role: 'user', content: 'hello hermes', timestamp: 4000 },
      ],
    }))

    const result = await runLocalStorageAgentCacheMigration()

    expect(result.migrated).toBe(3)
    expect(savedBatches.map(batch => batch.agentType)).toEqual(['merlin', 'anorak-pro', 'hermes-native'])
    expect(removedKeys).toEqual([
      'oasis-merlin-sessions',
      'oasis-anorak-pro-sessions',
      'oasis-hermes-native-session-cache',
    ])
    expect(storage.has('oasis-merlin-sessions')).toBe(false)
  })

  it('keeps a legacy key when its SQLite cache write fails', async () => {
    saveClientAgentSessionCaches.mockImplementationOnce(async (agentType: string, sessions: unknown[]) => {
      savedBatches.push({ agentType, sessions })
      return false
    })
    storage.set('oasis-anorak-pro-sessions', JSON.stringify([
      {
        id: 'anorak-1',
        name: 'Anorak mission',
        createdAt: '2026-04-25T00:00:00.000Z',
        entries: [{ id: 1, type: 'text', content: 'ship it', timestamp: 3000 }],
      },
    ]))

    const result = await runLocalStorageAgentCacheMigration()

    expect(result.migrated).toBe(0)
    expect(removedKeys).toEqual([])
    expect(storage.has('oasis-anorak-pro-sessions')).toBe(true)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMultiplayerPresenceForTests,
  listMultiplayerPresence,
  removeMultiplayerPresence,
  upsertMultiplayerPresence,
} from '../multiplayer-presence'

describe('multiplayer presence', () => {
  beforeEach(() => {
    clearMultiplayerPresenceForTests()
  })

  it('lists only live players in the same world and excludes the caller', () => {
    upsertMultiplayerPresence({ playerId: 'a', worldId: 'world-1', name: 'Ada', position: [1, 0, 2], yaw: 0 }, 1000)
    upsertMultiplayerPresence({ playerId: 'b', worldId: 'world-1', name: 'Bea', position: [3, 0, 4], yaw: 1 }, 1000)
    upsertMultiplayerPresence({ playerId: 'c', worldId: 'world-2', name: 'Cy', position: [5, 0, 6], yaw: 2 }, 1000)

    const players = listMultiplayerPresence('world-1', 'a', 1200)
    expect(players).toHaveLength(1)
    expect(players[0]).toMatchObject({ playerId: 'b', name: 'Bea', position: [3, 0, 4] })
  })

  it('expires stale players', () => {
    upsertMultiplayerPresence({ playerId: 'a', worldId: 'world-1', position: [1, 0, 2], yaw: 0 }, 1000)
    expect(listMultiplayerPresence('world-1', undefined, 30000)).toHaveLength(1)
    expect(listMultiplayerPresence('world-1', undefined, 32000)).toHaveLength(0)
  })

  it('removes a leaving player', () => {
    upsertMultiplayerPresence({ playerId: 'a', worldId: 'world-1', position: [1, 0, 2], yaw: 0 }, 1000)
    expect(removeMultiplayerPresence('a')).toBe(true)
    expect(listMultiplayerPresence('world-1', undefined, 1200)).toHaveLength(0)
  })
})

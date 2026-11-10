import { describe, expect, it } from 'vitest'

import { canInterrupt } from '../village/village-interrupt'

describe('canInterrupt', () => {
  it('while a turn runs', () => {
    expect(canInterrupt({ status: 'working', statusReason: 'turn started' })).toBe(true)
    expect(canInterrupt({ status: 'working', statusReason: 'turn running' })).toBe(true)
    expect(canInterrupt({ status: 'working', statusReason: 'message sent' })).toBe(true)
    expect(canInterrupt({ status: 'working', statusReason: 'message queued mid-turn' })).toBe(true)
    expect(canInterrupt({ status: 'working' })).toBe(true)
  })

  it('stopped mid-turn on an open permission or question', () => {
    expect(canInterrupt({ status: 'needs-decision', statusReason: 'permission', decisions: [{}] })).toBe(true)
  })

  it('not once the agent has finished', () => {
    for (const status of ['waiting', 'idle', 'error', 'starting']) {
      expect(canInterrupt({ status, statusReason: 'end_turn' })).toBe(false)
    }
  })

  it('not for a finished turn that ended on a decision, nor for messages only waiting in the queue', () => {
    expect(canInterrupt({ status: 'needs-decision', statusReason: 'permission denied', decisions: [] })).toBe(false)
    expect(canInterrupt({ status: 'working', statusReason: '2 queued message(s)' })).toBe(false)
  })

  it('nothing to interrupt without an agent', () => {
    expect(canInterrupt(null)).toBe(false)
  })
})

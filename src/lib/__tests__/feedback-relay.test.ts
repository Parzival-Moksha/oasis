import { describe, expect, it, vi } from 'vitest'

import { findDebuggerAgent, formatFeedbackMessage, relayFeedbackToDebugger } from '../feedback-relay'

const agent = (id: string, name: string, owned = true, alive = true) => ({ id, name, owned, alive })

describe('findDebuggerAgent', () => {
  it('finds an owned agent named like debugger, case-insensitively', () => {
    const found = findDebuggerAgent([agent('a', 'Anorak'), agent('b', 'Oasis Debugger')])
    expect(found?.id).toBe('b')
  })

  it('ignores watched (not owned) sessions', () => {
    expect(findDebuggerAgent([agent('w', 'debugger', false)])).toBeNull()
  })

  it('prefers a live debugger over a stopped one', () => {
    const found = findDebuggerAgent([agent('old', 'Debugger', true, false), agent('new', 'DEBUGGER 2', true, true)])
    expect(found?.id).toBe('new')
  })

  it('falls back to a stopped debugger (the engine restarts it on send)', () => {
    expect(findDebuggerAgent([agent('old', 'Debugger', true, false)])?.id).toBe('old')
  })

  it('returns null when the village has no debugger', () => {
    expect(findDebuggerAgent([agent('a', 'Anorak'), agent('t', 'Talk')])).toBeNull()
  })
})

describe('formatFeedbackMessage', () => {
  it('names the world and path', () => {
    expect(formatFeedbackMessage({ worldId: 'world-1', path: '/w/world-1', text: '  fps drops  ' }))
      .toBe('New Oasis feedback (world world-1, /w/world-1): fps drops')
  })

  it('fills in missing world and path', () => {
    expect(formatFeedbackMessage({ worldId: null, path: '', text: 'hi' })).toBe('New Oasis feedback (world none, /): hi')
  })
})

describe('relayFeedbackToDebugger', () => {
  const feedback = { worldId: 'w1', path: '/', text: 'bug' }

  it('sends to the debugger', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    const result = await relayFeedbackToDebugger(feedback, { agents: [agent('d', 'Debugger')], isOpen: true, send })
    expect(result).toBe('sent')
    expect(send).toHaveBeenCalledWith('d', 'New Oasis feedback (world w1, /): bug')
  })

  it('does nothing when the engine is offline', async () => {
    const send = vi.fn()
    expect(await relayFeedbackToDebugger(feedback, { agents: [agent('d', 'Debugger')], isOpen: false, send })).toBe('offline')
    expect(send).not.toHaveBeenCalled()
  })

  it('does nothing without a debugger', async () => {
    const send = vi.fn()
    expect(await relayFeedbackToDebugger(feedback, { agents: [agent('a', 'Anorak')], isOpen: true, send })).toBe('no-debugger')
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows send failures', async () => {
    const send = vi.fn().mockRejectedValue(new Error('down'))
    expect(await relayFeedbackToDebugger(feedback, { agents: [agent('d', 'Debugger')], isOpen: true, send })).toBe('failed')
  })
})

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// EVENT BUS TESTS — Command dispatch, ordering, history
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus, type OasisCommand } from '../event-bus'

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.clearHistory()
  })

  describe('dispatch + subscribe', () => {
    it('delivers commands to subscribers', () => {
      const received: OasisCommand[] = []
      const unsub = eventBus.subscribe(cmd => received.push(cmd))

      eventBus.dispatch({ type: 'SELECT_OBJECT', payload: { id: 'test-1' } })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('SELECT_OBJECT')

      unsub()
    })

    it('delivers to multiple subscribers', () => {
      let count1 = 0, count2 = 0
      const unsub1 = eventBus.subscribe(() => count1++)
      const unsub2 = eventBus.subscribe(() => count2++)

      eventBus.dispatch({ type: 'UNDO' })
      expect(count1).toBe(1)
      expect(count2).toBe(1)

      unsub1()
      unsub2()
    })

    it('unsubscribe stops delivery', () => {
      let count = 0
      const unsub = eventBus.subscribe(() => count++)

      eventBus.dispatch({ type: 'UNDO' })
      expect(count).toBe(1)

      unsub()
      eventBus.dispatch({ type: 'REDO' })
      expect(count).toBe(1) // still 1, not 2
    })
  })

  describe('ordering', () => {
    it('processes commands in FIFO order', () => {
      const order: string[] = []
      const unsub = eventBus.subscribe(cmd => order.push(cmd.type))

      eventBus.dispatch({ type: 'SELECT_OBJECT', payload: { id: '1' } })
      eventBus.dispatch({ type: 'INSPECT_OBJECT', payload: { id: '1' } })
      eventBus.dispatch({ type: 'DELETE_OBJECT', payload: { id: '1' } })

      expect(order).toEqual(['SELECT_OBJECT', 'INSPECT_OBJECT', 'DELETE_OBJECT'])
      unsub()
    })

    it('handles re-entrant dispatch (command dispatched from within handler)', () => {
      const order: string[] = []
      const unsub = eventBus.subscribe(cmd => {
        order.push(cmd.type)
        if (cmd.type === 'SELECT_OBJECT') {
          eventBus.dispatch({ type: 'INSPECT_OBJECT', payload: { id: '1' } })
        }
      })

      eventBus.dispatch({ type: 'SELECT_OBJECT', payload: { id: '1' } })
      // SELECT_OBJECT processed first, then INSPECT_OBJECT queued and processed after
      expect(order).toEqual(['SELECT_OBJECT', 'INSPECT_OBJECT'])
      unsub()
    })
  })

  describe('history', () => {
    it('records command history', () => {
      eventBus.dispatch({ type: 'UNDO' })
      eventBus.dispatch({ type: 'REDO' })

      const history = eventBus.getHistory()
      expect(history).toHaveLength(2)
      expect(history[0].cmd.type).toBe('UNDO')
      expect(history[1].cmd.type).toBe('REDO')
      expect(history[0].timestamp).toBeLessThanOrEqual(history[1].timestamp)
    })

    it('clearHistory empties it', () => {
      eventBus.dispatch({ type: 'UNDO' })
      eventBus.clearHistory()
      expect(eventBus.getHistory()).toHaveLength(0)
    })
  })

  describe('error handling', () => {
    it('continues processing after handler error', () => {
      const received: string[] = []
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const unsub1 = eventBus.subscribe(() => { throw new Error('boom') })
      const unsub2 = eventBus.subscribe(cmd => received.push(cmd.type))

      eventBus.dispatch({ type: 'UNDO' })

      // Second handler still received the command despite first handler throwing
      expect(received).toEqual(['UNDO'])
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
      unsub1()
      unsub2()
    })
  })

  // ─═̷─═̷─ New presentation/slide event types ─═̷─═̷─
  describe('presentation event types', () => {
    it('dispatches FOCUS_IMAGE command', () => {
      const received: OasisCommand[] = []
      const unsub = eventBus.subscribe(cmd => received.push(cmd))
      eventBus.dispatch({ type: 'FOCUS_IMAGE', payload: { id: 'img-1' } })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('FOCUS_IMAGE')
      if (received[0].type === 'FOCUS_IMAGE') {
        expect(received[0].payload.id).toBe('img-1')
      }
      unsub()
    })

    it('dispatches UNFOCUS_IMAGE command', () => {
      const received: OasisCommand[] = []
      const unsub = eventBus.subscribe(cmd => received.push(cmd))
      eventBus.dispatch({ type: 'UNFOCUS_IMAGE' })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('UNFOCUS_IMAGE')
      unsub()
    })

    it('dispatches NEXT_SLIDE and PREV_SLIDE commands', () => {
      const received: OasisCommand[] = []
      const unsub = eventBus.subscribe(cmd => received.push(cmd))
      eventBus.dispatch({ type: 'NEXT_SLIDE' })
      eventBus.dispatch({ type: 'PREV_SLIDE' })
      expect(received).toHaveLength(2)
      expect(received[0].type).toBe('NEXT_SLIDE')
      expect(received[1].type).toBe('PREV_SLIDE')
      unsub()
    })

    it('dispatches ADD_AGENT_WINDOW command', () => {
      const received: OasisCommand[] = []
      const unsub = eventBus.subscribe(cmd => received.push(cmd))
      eventBus.dispatch({
        type: 'ADD_AGENT_WINDOW',
        payload: { agentType: 'anorak', position: [0, 2, 0], label: 'Test' },
      })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('ADD_AGENT_WINDOW')
      unsub()
    })

    it('dispatches REMOVE_AGENT_WINDOW command', () => {
      const received: OasisCommand[] = []
      const unsub = eventBus.subscribe(cmd => received.push(cmd))
      eventBus.dispatch({ type: 'REMOVE_AGENT_WINDOW', payload: { id: 'aw-1' } })
      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('REMOVE_AGENT_WINDOW')
      unsub()
    })
  })
})

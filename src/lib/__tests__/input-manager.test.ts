// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// INPUT MANAGER TESTS — State transitions, capabilities, pointer lock
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach } from 'vitest'
import { useInputManager } from '../input-manager'

function getState() { return useInputManager.getState() }
function reset() { useInputManager.setState({ inputState: 'noclip', _previousCameraState: null, pointerLocked: false }) }

describe('InputManager', () => {
  beforeEach(reset)

  describe('initial state', () => {
    it('starts in noclip', () => {
      expect(getState().inputState).toBe('noclip')
    })
    it('pointer is not locked', () => {
      expect(getState().pointerLocked).toBe(false)
    })
    it('no previous camera state', () => {
      expect(getState()._previousCameraState).toBeNull()
    })
  })

  describe('transition()', () => {
    it('transitions between camera modes', () => {
      getState().transition('orbit')
      expect(getState().inputState).toBe('orbit')
      getState().transition('third-person')
      expect(getState().inputState).toBe('third-person')
    })
    it('no-ops when transitioning to same state', () => {
      getState().transition('noclip')
      expect(getState().inputState).toBe('noclip')
    })
  })

  describe('enterAgentFocus()', () => {
    it('saves previous camera state', () => {
      getState().transition('orbit')
      getState().enterAgentFocus()
      expect(getState().inputState).toBe('agent-focus')
      expect(getState()._previousCameraState).toBe('orbit')
    })
    it('saves noclip as previous', () => {
      // starts in noclip
      getState().enterAgentFocus()
      expect(getState()._previousCameraState).toBe('noclip')
    })
    it('preserves previous when entering from agent-focus', () => {
      getState().transition('orbit')
      getState().enterAgentFocus()
      // Enter agent-focus again (shouldn't overwrite saved orbit)
      getState().enterAgentFocus()
      expect(getState()._previousCameraState).toBe('orbit')
    })
  })

  describe('handleEscape()', () => {
    it('returns to saved state from agent-focus', () => {
      getState().transition('orbit')
      getState().enterAgentFocus()
      const consumed = getState().handleEscape()
      expect(consumed).toBe(true)
      expect(getState().inputState).toBe('orbit')
      expect(getState()._previousCameraState).toBeNull()
    })
    it('returns to noclip from agent-focus', () => {
      // starts in noclip
      getState().enterAgentFocus()
      getState().handleEscape()
      expect(getState().inputState).toBe('noclip')
    })
    it('not consumed in base camera states', () => {
      const consumed = getState().handleEscape()
      expect(consumed).toBe(false)
      expect(getState().inputState).toBe('noclip') // unchanged
    })
    it('returns from paint mode', () => {
      getState().transition('orbit')
      getState().transition('paint')
      useInputManager.setState({ _previousCameraState: 'orbit' })
      const consumed = getState().handleEscape()
      expect(consumed).toBe(true)
      expect(getState().inputState).toBe('orbit')
    })
  })

  describe('syncFromControlMode()', () => {
    it('syncs from base camera states', () => {
      getState().syncFromControlMode('orbit')
      expect(getState().inputState).toBe('orbit')
    })
    it('does NOT override agent-focus', () => {
      getState().enterAgentFocus()
      getState().syncFromControlMode('orbit')
      expect(getState().inputState).toBe('agent-focus')
    })
    it('does NOT override ui-focused', () => {
      getState().enterUIFocus()
      getState().syncFromControlMode('noclip')
      expect(getState().inputState).toBe('ui-focused')
    })
  })

  describe('capabilities', () => {
    it('orbit allows selection but not movement', () => {
      getState().transition('orbit')
      const can = getState().can()
      expect(can.movement).toBe(false)
      expect(can.objectSelection).toBe(true)
      expect(can.enterFocuses).toBe(true)
    })
    it('noclip allows movement and selection', () => {
      const can = getState().can()
      expect(can.movement).toBe(true)
      expect(can.objectSelection).toBe(true)
      expect(can.canLockPointer).toBe(true)
    })
    it('agent-focus allows nothing', () => {
      getState().enterAgentFocus()
      const can = getState().can()
      expect(can.movement).toBe(false)
      expect(can.objectSelection).toBe(false)
      expect(can.enterFocuses).toBe(false)
      expect(can.canLockPointer).toBe(false)
    })
  })

  describe('full scenario: orbit → focus → escape → orbit', () => {
    it('round-trips correctly', () => {
      getState().transition('orbit')
      expect(getState().inputState).toBe('orbit')

      getState().enterAgentFocus()
      expect(getState().inputState).toBe('agent-focus')
      expect(getState()._previousCameraState).toBe('orbit')

      const consumed = getState().handleEscape()
      expect(consumed).toBe(true)
      expect(getState().inputState).toBe('orbit')
      expect(getState()._previousCameraState).toBeNull()
    })
  })

  describe('full scenario: noclip → focus → escape → noclip', () => {
    it('round-trips correctly', () => {
      expect(getState().inputState).toBe('noclip')

      getState().enterAgentFocus()
      expect(getState().inputState).toBe('agent-focus')

      getState().handleEscape()
      expect(getState().inputState).toBe('noclip')
    })
  })
})

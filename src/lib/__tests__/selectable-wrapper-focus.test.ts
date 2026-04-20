// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SELECTABLE WRAPPER FOCUS TESTS — agent-focus hides selection + transform
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach } from 'vitest'
import { useInputManager } from '../input-manager'

function getInputState() { return useInputManager.getState() }
function resetInput() {
  useInputManager.setState({ inputState: 'noclip', _previousCameraState: null, pointerLocked: false })
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure visibility logic extracted from SelectableWrapper (WorldObjects.tsx)
// These mirror the exact conditional expressions from the component JSX.
// ═══════════════════════════════════════════════════════════════════════════

/** Selection ring visibility — line 196 of WorldObjects.tsx */
function isSelectionRingVisible(selected: boolean, isAgentFocused: boolean): boolean {
  return selected && !isAgentFocused
}

/** TransformControls visibility — line 207 of WorldObjects.tsx */
function isTransformControlsVisible(
  selected: boolean,
  hasGroupRef: boolean,
  isReadOnly: boolean,
  isAgentFocused: boolean
): boolean {
  return selected && hasGroupRef && !isReadOnly && !isAgentFocused
}

/** HUD visibility — uses focusedAgentWindowId from oasisStore */
function isHudVisible(focusedAgentWindowId: string | null): boolean {
  return !focusedAgentWindowId
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('SelectableWrapper agent-focus behavior', () => {
  beforeEach(resetInput)

  describe('selection ring visibility', () => {
    it('visible when selected and NOT in agent-focus', () => {
      expect(isSelectionRingVisible(true, false)).toBe(true)
    })

    it('hidden when selected AND in agent-focus', () => {
      expect(isSelectionRingVisible(true, true)).toBe(false)
    })

    it('hidden when NOT selected (regardless of focus)', () => {
      expect(isSelectionRingVisible(false, false)).toBe(false)
      expect(isSelectionRingVisible(false, true)).toBe(false)
    })
  })

  describe('TransformControls visibility', () => {
    it('visible when selected + has ref + not read-only + not agent-focused', () => {
      expect(isTransformControlsVisible(true, true, false, false)).toBe(true)
    })

    it('hidden when in agent-focus (even if all other conditions met)', () => {
      expect(isTransformControlsVisible(true, true, false, true)).toBe(false)
    })

    it('hidden when read-only', () => {
      expect(isTransformControlsVisible(true, true, true, false)).toBe(false)
    })

    it('hidden when not selected', () => {
      expect(isTransformControlsVisible(false, true, false, false)).toBe(false)
    })

    it('hidden when no group ref', () => {
      expect(isTransformControlsVisible(true, false, false, false)).toBe(false)
    })
  })

  describe('HUD visibility (hasAgentFocus)', () => {
    it('visible when no agent window is focused', () => {
      expect(isHudVisible(null)).toBe(true)
    })

    it('hidden when an agent window is focused', () => {
      expect(isHudVisible('anorak-window-1')).toBe(false)
    })
  })

  describe('integration with InputManager state', () => {
    it('isAgentFocused derives from inputState === agent-focus', () => {
      // Default state: noclip
      const notFocused = getInputState().inputState === 'agent-focus'
      expect(notFocused).toBe(false)

      // Enter agent focus
      getInputState().enterAgentFocus()
      const focused = getInputState().inputState === 'agent-focus'
      expect(focused).toBe(true)

      // Selection ring should hide
      expect(isSelectionRingVisible(true, focused)).toBe(false)

      // TransformControls should hide
      expect(isTransformControlsVisible(true, true, false, focused)).toBe(false)
    })

    it('exiting agent-focus restores selection ring visibility', () => {
      getInputState().enterAgentFocus()
      expect(isSelectionRingVisible(true, true)).toBe(false)

      getInputState().handleEscape()
      const isStillFocused = getInputState().inputState === 'agent-focus'
      expect(isStillFocused).toBe(false)
      expect(isSelectionRingVisible(true, isStillFocused)).toBe(true)
    })

    it('exiting agent-focus restores TransformControls visibility', () => {
      getInputState().enterAgentFocus()
      getInputState().handleEscape()
      const isStillFocused = getInputState().inputState === 'agent-focus'
      expect(isTransformControlsVisible(true, true, false, isStillFocused)).toBe(true)
    })
  })
})

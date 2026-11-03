'use client'

// Non-visual wiring for the village profile: engine connection, keys, proximity, focus hand-off.

import { useEffect } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { useInputManager } from '../../lib/input-manager'
import { useOasisStore } from '../../store/oasisStore'
import {
  VILLAGE_SESSION_LAYER,
  discardVillageCameraPose,
  focusVillageAgent,
  handleVillageKeyDown,
  isFocusInputState,
  leaveVillageFocus,
  releaseVillageFocusInput,
  restoreVillageCameraPose,
  updateVillageProximity,
} from './village-actions'

export function VillageController() {
  // One WebSocket for the whole page; offline is a normal state, not an error.
  useEffect(() => {
    const client = getAgentEngineClient()
    client.start()
    return () => client.stop()
  }, [])

  // E (talk to the nearest agent) and N (next agent needing attention) win over world bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handleVillageKeyDown(event)) return
      // preventDefault also stops the "e" from being typed into the composer we are about to focus.
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  // Esc / canvas click / another panel ending agent-focus also ends the village focus.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    const village = useOasisStore.getState().agentEngine
    if (isFocusInputState(prev.inputState) && !isFocusInputState(state.inputState)) {
      if (village.focusedAgentId) useOasisStore.getState().agentEngineDispatch({ type: 'focus', agentId: null })
      restoreVillageCameraPose()
      return
    }
    // The canvas-click "dismiss panels" path pops every UI layer, including the session view's.
    const layerDropped = prev._uiLayerStack.includes(VILLAGE_SESSION_LAYER) && !state._uiLayerStack.includes(VILLAGE_SESSION_LAYER)
    if (layerDropped && village.focusedAgentId) {
      leaveVillageFocus()
      return
    }
    // The session view needs a free mouse: undo a pointer lock that landed after focusing.
    if (state.pointerLocked && !prev.pointerLocked && village.focusedAgentId && isFocusInputState(state.inputState)) {
      useInputManager.getState().releasePointerLock()
    }
  }), [])

  // A world agent window or picture zoom takes the camera: drop the village focus quietly.
  useEffect(() => useOasisStore.subscribe((state, prev) => {
    const tookCamera = (state.focusedAgentWindowId && !prev.focusedAgentWindowId) || (state.focusedImageId && !prev.focusedImageId)
    if (!tookCamera || !state.agentEngine.focusedAgentId) return
    discardVillageCameraPose()
    state.agentEngineDispatch({ type: 'focus', agentId: null })
  }), [])

  // Focus can also end without the input state changing: the agent was dismissed elsewhere, or an
  // observer vanished on reconnect. Hand movement, mouse look and the camera back right away.
  useEffect(() => useOasisStore.subscribe((state, prev) => {
    if (!prev.agentEngine.focusedAgentId || state.agentEngine.focusedAgentId) return
    releaseVillageFocusInput()
  }), [])

  // Phones: the primary action button says "Talk" next to an agent (MobileOasisControls).
  useEffect(() => {
    const onTalk = () => {
      const nearby = useOasisStore.getState().agentEngine.nearbyAgentId
      if (nearby) focusVillageAgent(nearby)
    }
    window.addEventListener('oasis:village-talk', onTalk)
    return () => window.removeEventListener('oasis:village-talk', onTalk)
  }, [])

  // "E talk" hint: nearest agent within reach of the avatar (or the camera in noclip).
  useEffect(() => {
    const timer = window.setInterval(updateVillageProximity, 150)
    return () => window.clearInterval(timer)
  }, [])

  return null
}

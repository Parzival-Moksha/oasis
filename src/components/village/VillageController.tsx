'use client'

// Wiring for the village profile: engine connection, keys, proximity, focus hand-off, and the picture viewer.

import { useEffect } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { useInputManager } from '../../lib/input-manager'
import { useOasisStore } from '../../store/oasisStore'
import { effectiveStatus, selectAttentionQueue } from '../../store/slices/agentEngineSlice'
import { playVillageChime, unlockVillageAudio } from './village-sound'
import { loadSeen, markSeen, planUnseenRestore, saveSeen } from '../../lib/village/village-seen'
import { VillageImageViewer } from './VillageImageViewer'
import { MarkdownReader } from './MarkdownReader'
import { VillageMissionReader } from './VillageMissionReader'
import { WorkVowHud } from './WorkVowHud'
import {
  VILLAGE_SESSION_LAYER,
  discardVillageCameraPose,
  focusVillageAgent,
  getVillageScreen,
  handleVillageKeyDown,
  isFocusInputState,
  leaveVillageFocus,
  releaseVillageFocusInput,
  restoreVillageCameraPose,
  setVillageScreen,
  updateVillageProximity,
} from './village-actions'

export function VillageController() {
  // One WebSocket for the whole page; offline is a normal state, not an error.
  useEffect(() => {
    const client = getAgentEngineClient()
    client.start()
    return () => client.stop()
  }, [])

  // "Finished while you weren't looking" survives a reload or an engine restart (village-seen.ts): after
  // each hello, agents whose last turn ended after your last look are unseen again; opening one marks it seen.
  useEffect(() => useOasisStore.subscribe((state, prev) => {
    const engine = state.agentEngine
    const before = prev.agentEngine
    if (engine === before) return
    const keyOf = (id: string) => engine.agents[id]?.sessionId || id
    if (engine.connection.status === 'open' && before.connection.status !== 'open') {
      const agents = engine.order.map(id => engine.agents[id]).filter(Boolean).filter(agent => agent.owned)
        .map(agent => ({ id: agent.id, key: agent.sessionId || agent.id, status: agent.status, lastOutcomeAt: agent.lastOutcomeAt }))
      const plan = planUnseenRestore(agents, loadSeen(), Date.now(), engine.focusedAgentId)
      saveSeen(plan.seen)
      if (plan.unseenIds.length) state.agentEngineDispatch({ type: 'unseen/restore', agentIds: plan.unseenIds, at: Date.now() })
      return
    }
    if (engine.focusedAgentId && engine.focusedAgentId !== before.focusedAgentId) markSeen(keyOf(engine.focusedAgentId))
    for (const id of engine.order) {
      if (before.agents[id]?.unseen && engine.agents[id] && !engine.agents[id].unseen) markSeen(keyOf(id))
    }
  }), [])

  // T / E (talk to the nearest agent) and N (next agent needing attention) win over world bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handleVillageKeyDown(event)) return
      // preventDefault also keeps the letter out of any text field that is about to take focus.
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

  // The screen (F) follows the focus: N to the next agent keeps you on screens, leaving ends it.
  useEffect(() => useOasisStore.subscribe((state, prev) => {
    const next = state.agentEngine.focusedAgentId
    if (next === prev.agentEngine.focusedAgentId || !getVillageScreen()) return
    setVillageScreen(next)
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

  // "T talk" hint: nearest agent within reach of the avatar (or the camera in noclip).
  useEffect(() => {
    const timer = window.setInterval(updateVillageProximity, 150)
    return () => window.clearInterval(timer)
  }, [])

  // An agent starts needing you: a chime (heard from a background tab too) and "(2) " in the tab
  // title. Browsers allow sound only after a click or key press, so every gesture (re)unlocks it.
  useEffect(() => {
    window.addEventListener('pointerdown', unlockVillageAudio, { capture: true })
    window.addEventListener('keydown', unlockVillageAudio, { capture: true })
    let known = new Set(selectAttentionQueue(useOasisStore.getState().agentEngine))
    setAttentionTitle(known.size)
    const unsubscribe = useOasisStore.subscribe((state, prev) => {
      if (state.agentEngine === prev.agentEngine) return
      const engine = state.agentEngine
      const queue = selectAttentionQueue(engine)
      if (queue.length !== known.size) setAttentionTitle(queue.length)
      const fresh = queue.find(id => !known.has(id) && !(id === engine.focusedAgentId && document.visibilityState === 'visible'))
      known = new Set(queue)
      const agent = fresh ? engine.agents[fresh] : null
      if (agent) playVillageChime(effectiveStatus(agent))
    })
    return () => {
      window.removeEventListener('pointerdown', unlockVillageAudio, { capture: true })
      window.removeEventListener('keydown', unlockVillageAudio, { capture: true })
      unsubscribe()
      setAttentionTitle(0)
    }
  }, [])

  // The one full-screen picture viewer (it portals itself into <body>), and the mission wall's prompt and reader.
  return (
    <>
      <VillageImageViewer />
      <MarkdownReader />
      <VillageMissionReader />
      {/* The Mindcraft work counter: today's time toward the vow, bottom left. */}
      <WorkVowHud />
    </>
  )
}

function setAttentionTitle(count: number): void {
  const base = document.title.replace(/^\(\d+\) /, '')
  document.title = count > 0 ? `(${count}) ${base}` : base
}

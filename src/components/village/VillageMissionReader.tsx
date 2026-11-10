'use client'

// ░▒▓ VILLAGE MISSION READER — "E read / F full screen" next to a mission panel, and the mission's full text ▓▒░
// Plain DOM over the canvas (mounted by VillageController): the prompt reuses the agents' game banner,
// the text the thread's markdown renderer and the agent panel's look. Esc closes it.

import { useEffect, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { MISSION_COLUMN_COLOR, missionKeyAction } from '../../lib/village/village-missions'
import { getNearbyVillageMini, isTypingTarget, setVillageProximityRival, subscribeNearbyVillageMini } from './village-actions'
import {
  VILLAGE_MISSION_LAYER,
  cancelMissionEditing,
  closeMissionReader,
  getMissionState,
  openMissionReader,
  startMissionRefresh,
  subscribeMissions,
  toggleMissionReaderMode,
  updateMissionProximity,
} from './village-mission-store'
import { KeyPrompt, PromptBanner } from './VillageHud'
import { MissionSheet } from './VillageMissionSheet'

export function VillageMissionReader() {
  const { missions, nearby, reader } = useSyncExternalStore(subscribeMissions, getMissionState, getMissionState)
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const nearMini = useSyncExternalStore(subscribeNearbyVillageMini, getNearbyVillageMini, () => null)
  const open = reader ? missions.find(mission => mission.file === reader.file) || null : null
  const near = nearby ? missions.find(mission => mission.file === nearby) || null : null
  useUILayer(VILLAGE_MISSION_LAYER, Boolean(open))

  // The list: every 30 s and when the window is looked at again.
  useEffect(() => startMissionRefresh(), [])

  // Which panel is within reach: the village's proximity tick asks, a nearer agent wins.
  useEffect(() => {
    setVillageProximityRival(updateMissionProximity)
    return () => {
      setVillageProximityRival(null)
      updateMissionProximity(null, null)
      // Leaving the village closes the reader: coming back must not reopen it by itself.
      closeMissionReader()
    }
  }, [])

  // Reading needs a free mouse (scroll, buttons).
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])

  // An agent was opened (N, a click): its panel takes the place.
  useEffect(() => {
    if (focusedAgentId) closeMissionReader()
  }, [focusedAgentId])

  // A canvas click pops every UI layer: that closes the reader too.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(VILLAGE_MISSION_LAYER) && !state._uiLayerStack.includes(VILLAGE_MISSION_LAYER)) closeMissionReader()
  }), [])

  // E / F next to a panel, F / Esc while reading: before the world's own bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = getMissionState()
      const village = useOasisStore.getState().agentEngine
      const action = missionKeyAction({
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        reader: current.reader?.mode || null,
        nearby: Boolean(current.nearby),
        // A helper (subagent mini) within reach keeps its E, like an agent does.
        agent: Boolean(village.focusedAgentId || village.nearbyAgentId || getNearbyVillageMini()),
        worldKeysFree: useInputManager.getState().can().enterFocuses,
      })
      if (!action) return
      if (action === 'close') {
        // Esc in an open edit drops the edit; E only closes when it isn't being typed.
        if (!(event.code === 'Escape' && cancelMissionEditing())) closeMissionReader()
      }
      else if (action === 'toggle-full') toggleMissionReaderMode()
      else if (current.nearby) openMissionReader(current.nearby, action === 'full' ? 'full' : 'side')
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  if (focusedAgentId) return null
  return (
    <>
      {near && !open && !nearMini && (
        <PromptBanner accent={MISSION_COLUMN_COLOR[near.column]} title={near.title}>
          <KeyPrompt k="E" label="Read" accent="#38bdf8" primary />
          <KeyPrompt k="F" label="Full screen" accent="#c084fc" className="max-[700px]:hidden" />
        </PromptBanner>
      )}
      {open && reader && <MissionSheet mission={open} mode={reader.mode} />}
    </>
  )
}

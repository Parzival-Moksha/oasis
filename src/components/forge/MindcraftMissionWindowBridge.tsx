'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MINDCRAFT MISSION WINDOW BRIDGE
// ─═̷─═̷─ॐ─═̷─═̷─ Reads mindcraftSelectedMissionId from Zustand ─═̷─═̷─ॐ─═̷─═̷─
// Renders MissionWindow outside Canvas (DOM layer)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { MissionWindow } from './MissionWindow'
import { getMindcraftMissions, getMindcraftRefetch } from './MindcraftWorld'

export function MindcraftMissionWindowBridge() {
  const missionId = useOasisStore(s => s.mindcraftSelectedMissionId)
  const setMissionId = useOasisStore(s => s.setMindcraftSelectedMissionId)

  if (missionId == null) return null

  const missions = getMindcraftMissions()
  const mission = missions.find(m => m.id === missionId)
  if (!mission) return null

  return (
    <MissionWindow
      mission={mission}
      onClose={() => setMissionId(null)}
      onRefetch={() => getMindcraftRefetch()?.()}
    />
  )
}

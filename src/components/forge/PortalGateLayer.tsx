'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import {
  buildWelcomeHubPortalGates,
  createPortalTriggerState,
  getSafePortalTargetWorlds,
  isWelcomeHubWorld,
  markPortalTriggered,
  shouldTriggerPortal,
  type PortalTriggerState,
} from '../../lib/portal-gates'
import { useOasisStore } from '../../store/oasisStore'
import { PortalGateVisual } from './PortalGateVisual'

const PORTAL_COOLDOWN_MS = 2500

export function PortalGateLayer() {
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const switchWorld = useOasisStore(s => s.switchWorld)
  const triggerStatesRef = useRef<Record<string, PortalTriggerState>>({})

  useEffect(() => {
    triggerStatesRef.current = {}
  }, [activeWorldId])

  const gates = useMemo(() => {
    if (!isWelcomeHubWorld(activeWorldId)) return []
    return buildWelcomeHubPortalGates(getSafePortalTargetWorlds(worldRegistry, activeWorldId))
  }, [activeWorldId, worldRegistry])

  useFrame(() => {
    if (gates.length === 0) return
    const pose = getPlayerAvatarPose()
    if (!pose) return

    const nowMs = Date.now()
    for (const gate of gates) {
      if (!gate.targetWorldId) continue
      const state = triggerStatesRef.current[gate.id] || createPortalTriggerState()
      if (!shouldTriggerPortal(pose.position, gate, state, { nowMs, cooldownMs: PORTAL_COOLDOWN_MS, oneShot: true })) {
        triggerStatesRef.current[gate.id] = state
        continue
      }

      triggerStatesRef.current[gate.id] = markPortalTriggered(state, nowMs)
      switchWorld(gate.targetWorldId)
      break
    }
  })

  if (gates.length === 0) return null

  return (
    <group name="portal-gate-layer">
      {gates.map(gate => (
        <PortalGateVisual key={gate.id} gate={gate} />
      ))}
    </group>
  )
}

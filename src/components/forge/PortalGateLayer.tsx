'use client'

import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import {
  DEFAULT_PORTAL_ACTIVATION_DEPTH,
  createPortalTriggerState,
  markPortalTriggered,
  resolvePortalGateAction,
  shouldTriggerPortal,
  type PortalGate,
  type PortalTriggerState,
} from '../../lib/portal-gates'
import { createWorld, loadWorld, saveWorld } from '../../lib/forge/world-persistence'
import { useOasisStore } from '../../store/oasisStore'
import { PortalGateVisual } from './PortalGateVisual'
import { SelectableWrapper } from './WorldObjects'

const PORTAL_COOLDOWN_MS = 2500

function transformScaleScalar(scale: number | [number, number, number] | undefined): number {
  if (typeof scale === 'number') return scale
  if (Array.isArray(scale)) return (scale[0] + scale[1] + scale[2]) / 3
  return 1
}

function applyPortalTransform(
  gate: PortalGate,
  transform: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number } | undefined,
): PortalGate {
  const scale = transformScaleScalar(transform?.scale ?? gate.scale)
  return {
    ...gate,
    position: transform?.position || gate.position,
    rotationY: transform?.rotation?.[1] ?? gate.rotationY ?? 0,
    scale,
    width: gate.width * scale,
    height: gate.height * scale,
  }
}

export function PortalGateLayer() {
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const portalGates = useOasisStore(s => s.portalGates)
  const transforms = useOasisStore(s => s.transforms)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const transformMode = useOasisStore(s => s.transformMode)
  const selectObject = useOasisStore(s => s.selectObject)
  const setObjectTransform = useOasisStore(s => s.setObjectTransform)
  const switchWorld = useOasisStore(s => s.switchWorld)
  const refreshWorldRegistry = useOasisStore(s => s.refreshWorldRegistry)
  const triggerStatesRef = useRef<Record<string, PortalTriggerState>>({})
  const activePortalActionRef = useRef<string | null>(null)

  const handleTransformChange = useCallback((
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number],
  ) => {
    setObjectTransform(id, { position, rotation, scale })
  }, [setObjectTransform])

  useEffect(() => {
    triggerStatesRef.current = {}
  }, [activeWorldId])

  const gates = useMemo(
    () => portalGates.map(gate => applyPortalTransform(gate, transforms[gate.id])),
    [portalGates, transforms],
  )

  const handlePortalAction = useCallback(async (gate: PortalGate) => {
    if (activePortalActionRef.current) return
    activePortalActionRef.current = gate.id
    try {
      const action = resolvePortalGateAction(gate)
      if (action.type === 'load_world') {
        if (action.worldId) switchWorld(action.worldId)
        return
      }

      if (action.type === 'create_world') {
        const fallbackName = action.name || 'New Oasis World'
        const requestedName = action.promptForName === false
          ? fallbackName
          : window.prompt('Name this new world', fallbackName)
        const name = requestedName?.trim()
        if (!name) return
        const meta = await createWorld(name.slice(0, 50), action.icon || '🌍', {
          visibility: action.visibility || 'private',
        })
        if (action.templateWorldId) {
          const template = await loadWorld(action.templateWorldId)
          if (template) {
            const { version: _version, savedAt: _savedAt, ...templateState } = template
            await saveWorld(templateState, meta.id)
          }
        }
        refreshWorldRegistry()
        switchWorld(meta.id)
        return
      }

      if (action.type === 'external_url') {
        const nextUrl = new URL(action.url, window.location.href)
        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          window.alert('This portal can only open http or https URLs.')
          return
        }
        if (action.returnUrl && !nextUrl.searchParams.has('returnUrl')) {
          const returnUrl = action.returnUrl === 'current' ? window.location.href : action.returnUrl
          nextUrl.searchParams.set('returnUrl', returnUrl)
        }
        if (action.requiresConfirm && !window.confirm(`Open ${action.label || nextUrl.hostname}?`)) return
        window.location.assign(nextUrl.toString())
        return
      }

      window.alert(action.message)
    } catch (error) {
      console.error('[PortalGateLayer] Portal action failed:', error)
      window.alert(error instanceof Error ? error.message : 'Portal action failed.')
    } finally {
      window.setTimeout(() => {
        if (activePortalActionRef.current === gate.id) activePortalActionRef.current = null
      }, 750)
    }
  }, [refreshWorldRegistry, switchWorld])

  useFrame(() => {
    if (gates.length === 0) return
    const pose = getPlayerAvatarPose()
    if (!pose) return

    const nowMs = Date.now()
    for (const gate of gates) {
      const state = triggerStatesRef.current[gate.id] || createPortalTriggerState()
      if (!shouldTriggerPortal(pose.position, gate, state, {
        nowMs,
        cooldownMs: PORTAL_COOLDOWN_MS,
        oneShot: false,
        activationDepth: DEFAULT_PORTAL_ACTIVATION_DEPTH,
      })) {
        triggerStatesRef.current[gate.id] = state
        continue
      }

      triggerStatesRef.current[gate.id] = markPortalTriggered(state, nowMs)
      void handlePortalAction(gate)
      break
    }
  })

  if (gates.length === 0) return null

  return (
    <group name="portal-gate-layer">
      {gates.map(gate => {
        const baseGate = portalGates.find(portal => portal.id === gate.id) || gate
        const childGate: PortalGate = {
          ...gate,
          position: [0, 0, 0],
          rotationY: 0,
          width: baseGate.width,
          height: baseGate.height,
          scale: 1,
        }
        return (
          <SelectableWrapper
            key={gate.id}
            id={gate.id}
            selected={selectedObjectId === gate.id}
            onSelect={selectObject}
            transformMode={transformMode}
            onTransformChange={handleTransformChange}
            initialPosition={gate.position}
            initialRotation={[0, gate.rotationY ?? 0, 0]}
            initialScale={gate.scale ?? 1}
          >
            <PortalGateVisual gate={childGate} />
          </SelectableWrapper>
        )
      })}
    </group>
  )
}

'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getPlayerAvatarPose, requestPlayerAvatarTeleport, type PlayerAvatarPose } from '../../lib/player-avatar-runtime'
import {
  DEFAULT_PORTAL_ACTIVATION_DEPTH,
  createPortalTriggerState,
  getPortalGateLabel,
  layoutPortalAreaGates,
  markPortalTriggered,
  portalRotationTowardCenter,
  resolvePortalGateAction,
  shouldTriggerPortal,
  type PortalGate,
  type PortalTriggerState,
} from '../../lib/portal-gates'
import { createWorld, loadWorld, saveWorld } from '../../lib/forge/world-persistence'
import {
  PORTAL_REVEAL_ROLL_EVENT,
  PORTAL_TRANSITION_START_EVENT,
  preloadPortalRevealRoll,
  readPortalTransitionSettings,
  type PortalTransitionSettings,
} from '../../lib/portal-transition-settings'
import { useInputManager } from '../../lib/input-manager'
import { useOasisStore } from '../../store/oasisStore'
import { PortalGateVisual } from './PortalGateVisual'
import { SelectableWrapper } from './WorldObjects'

const PORTAL_COOLDOWN_MS = 2500
const PORTAL_WORLD_SWITCH_TUNNEL_FRACTION = 0.56

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function portalCenter(gate: PortalGate): THREE.Vector3 {
  return new THREE.Vector3(gate.position[0], gate.position[1] + gate.height * 0.48, gate.position[2])
}

function portalFacingNormal(gate: PortalGate): THREE.Vector3 {
  const rotationY = gate.rotationY ?? 0
  return new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY)).normalize()
}

function emitPortalTransitionStart(gate: PortalGate, settings: PortalTransitionSettings, targetWorldName?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_START_EVENT, {
    detail: {
      settings,
      gateLabel: getPortalGateLabel(gate),
      targetWorldName,
      variant: gate.variant,
    },
  }))
}

function emitPortalRevealRoll(gate: PortalGate, targetWorldName?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PORTAL_REVEAL_ROLL_EVENT, {
    detail: {
      gateId: gate.id,
      targetWorldName,
      animationId: 'ual-roll',
    },
  }))
}

function animatePortalCameraSwallow(camera: THREE.Camera, gate: PortalGate, settings: PortalTransitionSettings): Promise<void> {
  if (!(camera instanceof THREE.PerspectiveCamera)) return Promise.resolve()
  const durationMs = Math.max(80, settings.swallowSeconds * 1000)
  const startMs = performance.now()
  const startPosition = camera.position.clone()
  const center = portalCenter(gate)
  const normal = portalFacingNormal(gate)
  const pull = Math.min(1, Math.max(0, settings.cameraPull))
  const targetDistance = Math.max(0.42, gate.width * (0.82 - Math.min(1.5, settings.cameraPull) * 0.28))
  const targetPosition = center.clone().add(normal.multiplyScalar(targetDistance)).add(new THREE.Vector3(0, gate.height * 0.02, 0))
  const originalFov = camera.fov
  const targetFov = Math.min(105, originalFov + settings.fovBoost)

  return new Promise(resolve => {
    const frame = () => {
      const progress = Math.min(1, (performance.now() - startMs) / durationMs)
      const eased = easeInOutCubic(progress)
      camera.position.lerpVectors(startPosition, targetPosition, eased * pull)
      camera.fov = THREE.MathUtils.lerp(originalFov, targetFov, eased)
      camera.lookAt(center)
      camera.updateProjectionMatrix()

      if (progress < 1) {
        requestAnimationFrame(frame)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(frame)
  })
}

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

function derivePortalArrivalPose(
  gate: PortalGate,
  transforms?: Record<string, { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number } | undefined>,
): PlayerAvatarPose {
  const placedGate = applyPortalTransform(gate, transforms?.[gate.id])
  const normal = portalFacingNormal(placedGate)
  const arrivalDistance = Math.max(DEFAULT_PORTAL_ACTIVATION_DEPTH + 0.65, 1.15)
  const position: [number, number, number] = [
    placedGate.position[0] + normal.x * arrivalDistance,
    placedGate.position[1],
    placedGate.position[2] + normal.z * arrivalDistance,
  ]
  const yaw = placedGate.rotationY ?? 0
  return {
    position,
    yaw,
    forward: [normal.x, 0, normal.z],
  }
}

async function waitForWorldReady(worldId: string, timeoutMs = 1800): Promise<void> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    const state = useOasisStore.getState()
    if (state.activeWorldId === worldId && state._worldReady) return
    await sleep(40)
  }
}

async function ensureReturnPortalForArrival(args: {
  sourceGate: PortalGate
  sourceWorldId: string
  sourceWorldName: string
  targetWorldId: string
  targetWorldName?: string
}): Promise<PlayerAvatarPose | null> {
  const { sourceGate, sourceWorldId, sourceWorldName, targetWorldId } = args
  if (sourceGate.direction !== 'two-way') return null

  const targetState = await loadWorld(targetWorldId)
  if (!targetState) return null
  const targetGates = targetState.portalGates || []
  const existingReturnGate = targetGates.find(gate =>
    gate.linkedPortalId === sourceGate.id ||
    gate.id === sourceGate.linkedPortalId ||
    (
      gate.direction === 'two-way' &&
      gate.sourceWorldId === targetWorldId &&
      gate.targetWorldId === sourceWorldId
    )
  )

  if (existingReturnGate) {
    return derivePortalArrivalPose(existingReturnGate, targetState.transforms)
  }

  const returnPosition: [number, number, number] = [30, 0, 0]
  const returnGate: PortalGate = {
    id: sourceGate.linkedPortalId || `${sourceGate.id}-return`,
    variant: sourceGate.variant,
    label: sourceWorldName,
    position: returnPosition,
    rotationY: portalRotationTowardCenter(returnPosition),
    scale: sourceGate.scale ?? 1,
    width: sourceGate.width || 2.4,
    height: sourceGate.height || 3.2,
    direction: 'two-way',
    sourceWorldId: targetWorldId,
    targetWorldId: sourceWorldId,
    targetWorldName: sourceWorldName,
    action: { type: 'load_world', worldId: sourceWorldId, worldName: sourceWorldName },
    linkedPortalId: sourceGate.id,
    autoLayout: 'portal-area',
  }
  const nextPortalGates = layoutPortalAreaGates([...targetGates, returnGate], targetState.transforms)
  const savedReturnGate = nextPortalGates.find(gate => gate.id === returnGate.id) || returnGate
  const { version: _version, savedAt: _savedAt, ...targetSaveState } = targetState
  await saveWorld({
    ...targetSaveState,
    portalGates: nextPortalGates,
  }, targetWorldId)

  return derivePortalArrivalPose(savedReturnGate, targetState.transforms)
}

export function PortalGateLayer() {
  const { camera } = useThree()
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const portalGates = useOasisStore(s => s.portalGates)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
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

  const runWorldTransition = useCallback(async (
    gate: PortalGate,
    targetWorldName: string | undefined,
    switcher: () => void,
    options?: { targetWorldId?: string; arrivalPosePromise?: Promise<PlayerAvatarPose | null> },
  ) => {
    const settings = readPortalTransitionSettings()
    if (!settings.enabled) {
      const arrivalPose = options?.arrivalPosePromise ? await options.arrivalPosePromise.catch(() => null) : null
      switcher()
      if (options?.targetWorldId) await waitForWorldReady(options.targetWorldId)
      if (arrivalPose) requestPlayerAvatarTeleport(arrivalPose)
      return
    }

    const perspectiveCamera = camera instanceof THREE.PerspectiveCamera ? camera : null
    const originalFov = perspectiveCamera?.fov
    const inputManager = useInputManager.getState()
    const shouldManageInput = inputManager.inputState !== 'ui-focused' && inputManager.inputState !== 'agent-focus'
    if (shouldManageInput) inputManager.enterUIFocus()

    if (settings.rollReveal) void preloadPortalRevealRoll()
    emitPortalTransitionStart(gate, settings, targetWorldName)

    const switchDelayMs = Math.max(0, (settings.swallowSeconds + settings.tunnelSeconds * PORTAL_WORLD_SWITCH_TUNNEL_FRACTION) * 1000)
    const remainingTunnelMs = Math.max(0, settings.tunnelSeconds * (1 - PORTAL_WORLD_SWITCH_TUNNEL_FRACTION) * 1000)
    const revealMs = Math.max(0, settings.revealSeconds * 1000)

    try {
      void animatePortalCameraSwallow(camera, gate, settings)
      await sleep(switchDelayMs)
      const arrivalPose = options?.arrivalPosePromise ? await options.arrivalPosePromise.catch(() => null) : null
      switcher()
      if (options?.targetWorldId) {
        await waitForWorldReady(options.targetWorldId)
      }
      if (arrivalPose) {
        requestPlayerAvatarTeleport(arrivalPose)
      }
      await sleep(remainingTunnelMs)
      if (settings.rollReveal) emitPortalRevealRoll(gate, targetWorldName)
      await sleep(revealMs)
    } finally {
      if (perspectiveCamera && typeof originalFov === 'number') {
        perspectiveCamera.fov = originalFov
        perspectiveCamera.updateProjectionMatrix()
      }
      const currentInputManager = useInputManager.getState()
      if (shouldManageInput && currentInputManager.inputState === 'ui-focused') {
        currentInputManager.returnToPrevious()
      }
    }
  }, [camera])

  const handlePortalAction = useCallback(async (gate: PortalGate) => {
    if (activePortalActionRef.current) return
    activePortalActionRef.current = gate.id
    try {
      const action = resolvePortalGateAction(gate)
      if (action.type === 'load_world') {
        if (action.worldId) {
          const targetWorldName = worldRegistry.find(world => world.id === action.worldId)?.name
          const sourceWorldName = worldRegistry.find(world => world.id === activeWorldId)?.name || 'This world'
          const arrivalPosePromise = ensureReturnPortalForArrival({
            sourceGate: gate,
            sourceWorldId: activeWorldId,
            sourceWorldName,
            targetWorldId: action.worldId,
            targetWorldName,
          })
          await runWorldTransition(gate, targetWorldName, () => switchWorld(action.worldId!), {
            targetWorldId: action.worldId,
            arrivalPosePromise,
          })
        }
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
        await runWorldTransition(gate, meta.name, () => switchWorld(meta.id))
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
  }, [activeWorldId, refreshWorldRegistry, runWorldTransition, switchWorld, worldRegistry])

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

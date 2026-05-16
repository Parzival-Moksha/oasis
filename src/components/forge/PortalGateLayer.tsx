'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { getPlayerAvatarPose, requestPlayerAvatarTeleport, type PlayerAvatarPose } from '../../lib/player-avatar-runtime'
import {
  DEFAULT_PORTAL_ACTIVATION_DEPTH,
  WELCOME_HUB_WORLD_ID,
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
import {
  PORTAL_ZERO_RETURN_GATE_ID,
  upsertPortalZeroReturnGate,
} from '../../lib/portal-zero-return-gate'
import { createWorld, loadWorld, saveWorld } from '../../lib/forge/world-persistence'
import {
  PORTAL_REVEAL_ROLL_EVENT,
  PORTAL_TRANSITION_READY_EVENT,
  PORTAL_TRANSITION_START_EVENT,
  preloadPortalRevealRoll,
  readPortalTransitionSettings,
  type PortalTransitionSettings,
} from '../../lib/portal-transition-settings'
import { useInputManager } from '../../lib/input-manager'
import { useOasisStore } from '../../store/oasisStore'
import { sampleTerrainHeightAt } from '../../lib/forge/terrain-brush'
import { PortalGateVisual, preloadPortalGateVisualAssets } from './PortalGateVisual'
import { SelectableWrapper } from './WorldObjects'

const PORTAL_COOLDOWN_MS = 2500
const PORTAL_WORLD_SWITCH_TUNNEL_FRACTION = 0.56
const PORTAL_ARRIVAL_CAMERA_DISTANCE = 4.2
const PORTAL_ARRIVAL_CAMERA_ELEVATION = Math.PI / 4
const PORTAL_ARRIVAL_LOOK_AHEAD = 2.1
const PORTAL_ARRIVAL_LOOK_TARGET_HEIGHT = 1.75
const PORTAL_ARRIVAL_CAMERA_HEIGHT_OFFSET = 1.85
export const PORTAL_GATE_REVEAL_EVENT = 'oasis:portal-gate-reveal'

const revealedRuntimePortalIds = new Set<string>()

type PortalRevealBurst = {
  id: string
  gateId: string
  position: [number, number, number]
  rotationY: number
  age: number
  seed: number
}

export function requestPortalGateReveal(gateId: string) {
  if (typeof window === 'undefined' || !gateId) return
  preloadPortalGateVisualAssets()
  revealedRuntimePortalIds.add(gateId)
  window.dispatchEvent(new CustomEvent(PORTAL_GATE_REVEAL_EVENT, { detail: { gateId } }))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
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

function emitPortalTransitionReady() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_READY_EVENT))
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
  // Final camera position: 0.5m IN FRONT of the portal plane (along its
  // facing normal), regardless of gate width. Old behavior was a width-scaled
  // distance that often left the camera ~1m+ short of the plane.
  const targetDistance = 0.5
  const targetPosition = center.clone().add(normal.multiplyScalar(targetDistance)).add(new THREE.Vector3(0, gate.height * 0.02, 0))
  const originalFov = camera.fov
  const targetFov = Math.min(105, originalFov + settings.fovBoost)

  return new Promise(resolve => {
    const frame = () => {
      const progress = Math.min(1, (performance.now() - startMs) / durationMs)
      // Pure quadratic accel — no ease-in-out. The camera starts slow and
      // keeps accelerating toward the portal until the exact moment the
      // swallow phase ends. No deceleration coast.
      const eased = progress * progress
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

function isMissingPortalTarget(gate: PortalGate, worldRegistry: Array<{ id?: string }>): boolean {
  if (worldRegistry.length === 0) return false
  const action = resolvePortalGateAction(gate)
  return action.type === 'load_world'
    && Boolean(action.worldId)
    && !worldRegistry.some(world => world.id === action.worldId)
}

function resolvePortalAvailability(gate: PortalGate, worldRegistry: Array<{ id?: string }>): PortalGate {
  if (!isMissingPortalTarget(gate, worldRegistry)) return gate
  const label = getPortalGateLabel(gate)
  return {
    ...gate,
    inert: true,
    label: `${label} (world not found)`,
    action: {
      type: 'locked_message',
      message: 'World not found on this Oasis. This portal will unlock when its destination world exists here.',
    },
  }
}

function derivePortalArrivalPose(
  gate: PortalGate,
  transforms?: Record<string, { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number } | undefined>,
): PlayerAvatarPose {
  const placedGate = applyPortalTransform(gate, transforms?.[gate.id])
  if (gate.spawnPose?.position) {
    const yaw = gate.spawnPose.rotationY ?? placedGate.rotationY ?? 0
    return {
      position: gate.spawnPose.position,
      yaw,
      forward: [Math.sin(yaw), 0, Math.cos(yaw)],
    }
  }
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

function framePortalArrivalCamera(camera: THREE.Camera, pose: PlayerAvatarPose): void {
  const [x, , z] = pose.position
  const { terrainHeights } = useOasisStore.getState()
  const groundY = sampleTerrainHeightAt(terrainHeights, x, z)
  const avatarPosition = new THREE.Vector3(x, groundY, z)
  const forward = new THREE.Vector3(pose.forward[0], 0, pose.forward[2])
  if (forward.lengthSq() < 0.0001) {
    forward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw))
  }
  forward.normalize()

  const horizontalDistance = Math.cos(PORTAL_ARRIVAL_CAMERA_ELEVATION) * PORTAL_ARRIVAL_CAMERA_DISTANCE
  const cameraHeight = Math.sin(PORTAL_ARRIVAL_CAMERA_ELEVATION) * PORTAL_ARRIVAL_CAMERA_DISTANCE + PORTAL_ARRIVAL_CAMERA_HEIGHT_OFFSET
  const cameraPosition = avatarPosition.clone()
    .addScaledVector(forward, -horizontalDistance)
    .add(new THREE.Vector3(0, cameraHeight, 0))
  const lookTarget = avatarPosition.clone()
    .addScaledVector(forward, PORTAL_ARRIVAL_LOOK_AHEAD)
    .add(new THREE.Vector3(0, PORTAL_ARRIVAL_LOOK_TARGET_HEIGHT, 0))

  camera.position.copy(cameraPosition)
  camera.lookAt(lookTarget)
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.updateProjectionMatrix()
  }
}

function settlePortalArrivalCamera(camera: THREE.Camera, pose: PlayerAvatarPose): void {
  framePortalArrivalCamera(camera, pose)
  if (typeof window === 'undefined') return

  window.requestAnimationFrame(() => framePortalArrivalCamera(camera, pose))
  window.setTimeout(() => framePortalArrivalCamera(camera, pose), 90)
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
    ) ||
    gate.targetWorldId === sourceWorldId ||
    (gate.action?.type === 'load_world' && gate.action.worldId === sourceWorldId) ||
    (
      sourceWorldId === WELCOME_HUB_WORLD_ID &&
      (
        gate.id === PORTAL_ZERO_RETURN_GATE_ID ||
        gate.targetWorldId === WELCOME_HUB_WORLD_ID ||
        (gate.action?.type === 'load_world' && gate.action.worldId === WELCOME_HUB_WORLD_ID)
      )
    )
  )

  if (existingReturnGate) {
    return derivePortalArrivalPose(existingReturnGate, targetState.transforms)
  }

  if (sourceWorldId === WELCOME_HUB_WORLD_ID && targetWorldId !== WELCOME_HUB_WORLD_ID) {
    const nextPortalGates = upsertPortalZeroReturnGate(targetGates, targetWorldId)
    const returnGate = nextPortalGates.find(gate => gate.id === PORTAL_ZERO_RETURN_GATE_ID)
      || nextPortalGates.find(gate => gate.targetWorldId === WELCOME_HUB_WORLD_ID)
    if (returnGate && nextPortalGates !== targetGates) {
      const { version: _version, savedAt: _savedAt, ...targetSaveState } = targetState
      await saveWorld({
        ...targetSaveState,
        portalGates: nextPortalGates,
      }, targetWorldId).catch(() => null)
    }
    return returnGate ? derivePortalArrivalPose(returnGate, targetState.transforms) : null
  }

  if (sourceGate.direction !== 'two-way') return null

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

async function ensurePortalZeroReturnGateForNewWorld(worldId: string): Promise<PlayerAvatarPose | null> {
  const targetState = await loadWorld(worldId)
  if (!targetState) return null

  const existingGates = targetState.portalGates || []
  const nextGates = upsertPortalZeroReturnGate(existingGates, worldId)
  const returnGate = nextGates.find(gate => gate.id === PORTAL_ZERO_RETURN_GATE_ID)
    || nextGates.find(gate => gate.targetWorldId === WELCOME_HUB_WORLD_ID)
  if (!returnGate) return null

  if (nextGates !== existingGates) {
    const { version: _version, savedAt: _savedAt, ...targetSaveState } = targetState
    await saveWorld({
      ...targetSaveState,
      portalGates: nextGates,
    }, worldId)
  }

  return derivePortalArrivalPose(returnGate, targetState.transforms)
}

function PortalRevealBurstMesh({ burst }: { burst: PortalRevealBurst }) {
  const t = Math.min(1, burst.age / 1.35)
  const fade = Math.max(0, 1 - t)
  const particles = useMemo(() => {
    return Array.from({ length: 16 }, (_, index) => {
      const a = burst.seed * 0.017 + index * 2.399
      const r = 0.42 + ((index * 37 + burst.seed) % 100) / 130
      return {
        x: Math.cos(a) * r,
        y: Math.sin(a * 1.7) * 0.42,
        z: Math.sin(a) * 0.06,
        s: 0.035 + ((index * 19 + burst.seed) % 100) / 2200,
      }
    })
  }, [burst.seed])

  return (
    <group position={burst.position} rotation={[0, burst.rotationY, 0]}>
      <mesh position={[0, 1.62, 0.08]} scale={[1 + t * 1.2, 1 + t * 1.2, 1]}>
        <torusGeometry args={[0.78, 0.026, 14, 96]} />
        <meshBasicMaterial color="#fde68a" transparent opacity={0.52 * fade} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.62, 0.095]} scale={[0.82 + t * 0.82, 1.18 + t * 1.42, 1]}>
        <ringGeometry args={[0.68, 0.73, 96]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.24 * fade} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.62, 0.11]} scale={[0.28 + t * 1.45, 1.3 + t * 1.9, 1]}>
        <circleGeometry args={[1, 72]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.16 * fade} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {particles.map((particle, index) => (
        <mesh
          key={index}
          position={[
            particle.x * (0.8 + t * 1.5),
            1.62 + particle.y * (1 + t * 1.35) + t * 0.48,
            0.18 + particle.z,
          ]}
          scale={particle.s * (1 + t * 1.8)}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color={index % 3 === 0 ? '#fbbf24' : index % 3 === 1 ? '#60a5fa' : '#c084fc'} transparent opacity={0.72 * fade} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function PortalGateWarmup({ gates }: { gates: PortalGate[] }) {
  if (gates.length === 0) return null
  return (
    <group name="portal-gate-warmup" position={[0, -90, 0]} scale={0.01} frustumCulled={false}>
      {gates.slice(0, 6).map((gate, index) => (
        <PortalGateVisual
          key={`warmup-${gate.id}`}
          gate={{
            ...gate,
            id: `warmup-${gate.id}`,
            label: '',
            position: [index * 4, 0, 0],
            rotationY: 0,
            scale: 1,
            inert: true,
            hidden: false,
          }}
        />
      ))}
    </group>
  )
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
  const missingTargetRefreshKeyRef = useRef<string | null>(null)
  const gatesRef = useRef<PortalGate[]>([])
  const [, setRuntimeRevealVersion] = useState(0)
  const [revealBursts, setRevealBursts] = useState<PortalRevealBurst[]>([])

  const handleTransformChange = useCallback((
    id: string,
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number],
  ) => {
    setObjectTransform(id, { position, rotation, scale })
  }, [setObjectTransform])

  useEffect(() => {
    preloadPortalGateVisualAssets()
    triggerStatesRef.current = {}
  }, [activeWorldId])

  useEffect(() => {
    const onReveal = (event: Event) => {
      const gateId = (event as CustomEvent<{ gateId?: string }>).detail?.gateId
      if (gateId) {
        revealedRuntimePortalIds.add(gateId)
        const gate = gatesRef.current.find(candidate => candidate.id === gateId)
        if (gate) {
          setRevealBursts(current => [
            ...current.filter(burst => burst.gateId !== gateId),
            {
              id: `${gateId}-${Date.now()}`,
              gateId,
              position: [...gate.position],
              rotationY: gate.rotationY ?? 0,
              age: 0,
              seed: Math.abs(Array.from(gateId).reduce((sum, char) => sum + char.charCodeAt(0), 0)),
            },
          ])
        }
      }
      setRuntimeRevealVersion(version => version + 1)
    }
    window.addEventListener(PORTAL_GATE_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(PORTAL_GATE_REVEAL_EVENT, onReveal)
  }, [])

  useEffect(() => {
    if (worldRegistry.length === 0 || portalGates.length === 0) return
    const knownWorldIds = new Set(worldRegistry.map(world => world.id).filter(Boolean))
    const missingTargetIds = portalGates
      .map(gate => resolvePortalGateAction(gate))
      .flatMap(action => action.type === 'load_world' && action.worldId && !knownWorldIds.has(action.worldId)
        ? [action.worldId]
        : [])
      .sort()
    const refreshKey = missingTargetIds.join('|')
    if (!refreshKey) {
      missingTargetRefreshKeyRef.current = null
      return
    }
    if (missingTargetRefreshKeyRef.current === refreshKey) return
    missingTargetRefreshKeyRef.current = refreshKey
    refreshWorldRegistry()
  }, [portalGates, refreshWorldRegistry, worldRegistry])

  const gates = useMemo(
    () => portalGates.map(gate => resolvePortalAvailability(applyPortalTransform(gate, transforms[gate.id]), worldRegistry)),
    [portalGates, transforms, worldRegistry],
  )

  useEffect(() => {
    gatesRef.current = gates
    preloadPortalGateVisualAssets()
  }, [gates])

  const visibleGates = gates.filter(gate => !gate.hidden || revealedRuntimePortalIds.has(gate.id))
  const hiddenWarmupGates = gates.filter(gate => gate.hidden && !revealedRuntimePortalIds.has(gate.id))

  const runWorldTransition = useCallback(async (
    gate: PortalGate,
    targetWorldName: string | undefined,
    switcher: () => void | string | Promise<void | string>,
    options?: { targetWorldId?: string; arrivalPosePromise?: Promise<PlayerAvatarPose | null> },
  ) => {
    const settings = readPortalTransitionSettings()
    if (!settings.enabled) {
      const arrivalPose = options?.arrivalPosePromise
        ? await options.arrivalPosePromise.catch(() => null)
        : derivePortalArrivalPose(gate)
      const switchedWorldId = await switcher()
      const targetWorldId = typeof switchedWorldId === 'string' ? switchedWorldId : options?.targetWorldId
      if (targetWorldId) await waitForWorldReady(targetWorldId)
      if (arrivalPose) {
        requestPlayerAvatarTeleport(arrivalPose)
        settlePortalArrivalCamera(camera, arrivalPose)
      }
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
      const arrivalPose = options?.arrivalPosePromise
        ? await options.arrivalPosePromise.catch(() => null)
        : derivePortalArrivalPose(gate)
      const switchedWorldId = await switcher()
      emitPortalTransitionReady()
      const targetWorldId = typeof switchedWorldId === 'string' ? switchedWorldId : options?.targetWorldId
      if (targetWorldId) {
        await waitForWorldReady(targetWorldId)
      }
      if (arrivalPose) {
        requestPlayerAvatarTeleport(arrivalPose)
        settlePortalArrivalCamera(camera, arrivalPose)
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
          await runWorldTransition(gate, targetWorldName, () => {
            switchWorld(action.worldId!)
            return action.worldId!
          }, {
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
        const nextWorldName = name.slice(0, 50)
        const metaPromise = createWorld(nextWorldName, action.icon || 'UI', {
          visibility: action.visibility || 'private',
        })
        const preparedMetaPromise = metaPromise.then(async meta => {
          if (!action.templateWorldId) return meta
          const template = await loadWorld(action.templateWorldId)
          if (template) {
            const { version: _version, savedAt: _savedAt, ...templateState } = template
            await saveWorld({
              ...templateState,
              portalGates: upsertPortalZeroReturnGate(templateState.portalGates, meta.id),
            }, meta.id)
          }
          return meta
        })
        const arrivalPosePromise = preparedMetaPromise.then(meta => ensurePortalZeroReturnGateForNewWorld(meta.id))
        await runWorldTransition(gate, nextWorldName, async () => {
          const meta = await preparedMetaPromise
          refreshWorldRegistry()
          switchWorld(meta.id)
          return meta.id
        }, {
          arrivalPosePromise,
        })
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
    if (visibleGates.length === 0) return
    const pose = getPlayerAvatarPose()
    if (!pose) return

    const nowMs = Date.now()
    for (const gate of visibleGates) {
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

  useFrame((_, delta) => {
    if (revealBursts.length === 0) return
    setRevealBursts(current => current
      .map(burst => ({ ...burst, age: burst.age + delta }))
      .filter(burst => burst.age < 1.35))
  })

  if (visibleGates.length === 0 && hiddenWarmupGates.length === 0 && revealBursts.length === 0) return null

  return (
    <group name="portal-gate-layer">
      <PortalGateWarmup gates={hiddenWarmupGates} />
      {revealBursts.map(burst => (
        <PortalRevealBurstMesh key={burst.id} burst={burst} />
      ))}
      {visibleGates.map(gate => {
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

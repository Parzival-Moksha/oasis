'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { getCameraSnapshot } from '@/lib/camera-bridge'
import { getPlayerAnimationState, getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import {
  connectToWorldRoom,
  isMultiplayerRoomConfigured,
  type MultiplayerRoomConnection,
  type MultiplayerRoomPlayer,
} from '@/lib/multiplayer-room-client'
import { worldMutationBus, type WorldMutation } from '@/lib/world-mutation-bus'
import { colorForPlayerId as colorForId } from '@/lib/multiplayer-color'
import { useOasisStore } from '@/store/oasisStore'
import { RemoteVRMAvatar } from './RemoteVRMAvatar'
import {
  appendLiveStrokePoint,
  clearAllLiveStrokes,
  endLiveStroke,
  startLiveStroke,
} from '@/lib/forge/live-strokes'
import { sampleTerrainHeightAt } from '@/lib/forge/terrain-brush'

const INPUT_SEND_INTERVAL_MS = 33
const INPUT_HEARTBEAT_INTERVAL_MS = 2000
// Position jitter epsilon for "did the player actually move?" — 5cm is well
// above VRM spring physics + camera bobbing noise but below any human walk
// step. Stricter values (2cm before) made stationary remotes get classified
// as walking on the receive side because their client kept emitting tiny
// drift positions. Height uses its own epsilon so terrain edits still sync
// without turning tiny ground-sampling noise into locomotion.
const INPUT_POSITION_EPSILON = 0.05
const INPUT_HEIGHT_EPSILON = 0.06
const INPUT_YAW_EPSILON = 0.04
const INPUT_IDLE_SPEED_EPSILON = 0.12
const REMOTE_RENDER_DELAY_MS = 120

function countLoadedObjects(state: ReturnType<typeof useOasisStore.getState>): number {
  return state.placedCatalogAssets.length
    + state.craftedScenes.length
    + (state.worldConjuredAssetIds?.length || 0)
    + (state.portalGates?.length || 0)
    + (state.spatialWebObjects?.length || 0)
}

function applyRemoteObjectRemoval(objectId: string, linkedAvatarIds: string[] = []): void {
  if (!objectId) return
  const removedAvatarIds = new Set([objectId, ...linkedAvatarIds])
  useOasisStore.setState(state => {
    const placedCatalogAssets = state.placedCatalogAssets.filter(entry => entry.id !== objectId)
    const craftedScenes = state.craftedScenes.filter(entry => entry.id !== objectId)
    const placedAgentAvatars = state.placedAgentAvatars.filter(entry => !removedAvatarIds.has(entry.id) && entry.linkedWindowId !== objectId)
    const placedAgentWindows = state.placedAgentWindows
      .filter(entry => entry.id !== objectId)
      .map(entry => removedAvatarIds.has(entry.linkedAvatarId || '')
        ? { ...entry, linkedAvatarId: undefined, anchorMode: 'detached' as const }
        : entry)
    const portalGates = state.portalGates.filter(entry => entry.id !== objectId)
    const spatialWebObjects = state.spatialWebObjects.filter(entry => entry.id !== objectId)
    const worldConjuredAssetIds = state.worldConjuredAssetIds.filter(id => id !== objectId)
    const worldLights = state.worldLights.filter(light => light.id !== objectId)
    const paintStrokes = state.paintStrokes.filter(stroke => stroke.id !== objectId)
    const text3dObjects = state.text3dObjects.filter(text => text.id !== objectId)
    const transforms = { ...state.transforms }
    delete transforms[objectId]
    for (const avatarId of linkedAvatarIds) delete transforms[avatarId]
    const { [objectId]: _removedBehavior, ...behaviors } = state.behaviors
    const liveAgentAvatarAudio = { ...state.liveAgentAvatarAudio }
    delete liveAgentAvatarAudio[objectId]
    for (const avatarId of linkedAvatarIds) delete liveAgentAvatarAudio[avatarId]
    return {
      placedCatalogAssets,
      craftedScenes,
      worldConjuredAssetIds,
      placedAgentAvatars,
      placedAgentWindows,
      portalGates,
      spatialWebObjects,
      worldLights,
      paintStrokes,
      text3dObjects,
      transforms,
      behaviors,
      liveAgentAvatarAudio,
      focusedAgentWindowId: state.focusedAgentWindowId === objectId ? null : state.focusedAgentWindowId,
      selectedObjectId: removedAvatarIds.has(state.selectedObjectId || '') ? null : state.selectedObjectId,
      inspectedObjectId: removedAvatarIds.has(state.inspectedObjectId || '') ? null : state.inspectedObjectId,
      _loadedObjectCount: countLoadedObjects({
        ...state,
        placedCatalogAssets,
        craftedScenes,
        worldConjuredAssetIds,
        portalGates,
        spatialWebObjects,
      }),
    }
  })
}

type PortalMutationPayload = Extract<WorldMutation, { kind: 'portal_added' }>['payload']
type AgentWindowMutationPayload = Extract<WorldMutation, { kind: 'agent_window_added' }>['payload']
type AgentAvatarMutationPayload = Extract<WorldMutation, { kind: 'agent_avatar_added' }>['payload']

function upsertRemotePortalGate(portal: PortalMutationPayload): void {
  useOasisStore.setState(state => ({
    portalGates: state.portalGates.some(entry => entry.id === portal.id)
      ? state.portalGates.map(entry => entry.id === portal.id ? { ...entry, ...portal, id: entry.id } : entry)
      : [...state.portalGates, portal],
    _loadedObjectCount: state.portalGates.some(entry => entry.id === portal.id)
      ? state._loadedObjectCount
      : state._loadedObjectCount + 1,
  }))
}

function upsertRemoteAgentWindow(window: AgentWindowMutationPayload): void {
  useOasisStore.setState(state => ({
    placedAgentWindows: state.placedAgentWindows.some(entry => entry.id === window.id)
      ? state.placedAgentWindows.map(entry => entry.id === window.id ? { ...entry, ...window, id: entry.id } : entry)
      : [...state.placedAgentWindows, window],
  }))
}

function upsertRemoteAgentAvatar(avatar: AgentAvatarMutationPayload): void {
  useOasisStore.setState(state => ({
    placedAgentAvatars: state.placedAgentAvatars.some(entry => entry.id === avatar.id)
      ? state.placedAgentAvatars.map(entry => entry.id === avatar.id ? { ...entry, ...avatar, id: entry.id } : entry)
      : [...state.placedAgentAvatars, avatar],
  }))
}
const REMOTE_SNAPSHOT_BUFFER = 6
const REMOTE_POSITION_CATCHUP = 9
const REMOTE_YAW_CATCHUP = 9

function makePresenceId(): string {
  if (typeof window !== 'undefined') {
    const key = 'oasis-presence-player-id'
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
    try {
      const existing = window.sessionStorage.getItem(key)
      if (existing) return existing
    } catch {}
    const id = `player-${randomId}`
    try { window.sessionStorage.setItem(key, id) } catch {}
    return id
  }
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `player-${randomId}`
}

function makePresenceName(playerId: string): string {
  if (typeof window === 'undefined') return 'Visitor'
  const key = 'oasis-presence-player-name'
  try {
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
  } catch {}
  const name = `Visitor ${playerId.slice(-4).toUpperCase()}`
  try { window.localStorage.setItem(key, name) } catch {}
  return name
}

// (colorForId is imported above from @/lib/multiplayer-color — single source
// of truth shared with PaintCursor's wand-tip sparkler tint.)

function getLocalPose(): { position: [number, number, number]; yaw: number } | null {
  const avatarPose = getPlayerAvatarPose()
  if (avatarPose) return { position: avatarPose.position, yaw: avatarPose.yaw }
  const camera = getCameraSnapshot()
  if (!camera) return null
  const [fx, , fz] = camera.forward
  const groundY = sampleTerrainHeightAt(
    useOasisStore.getState().terrainHeights,
    camera.position[0],
    camera.position[2],
  )
  return {
    position: [camera.position[0], groundY, camera.position[2]],
    yaw: Math.atan2(fx, fz || 1),
  }
}

interface RemoteSnapshot {
  // Server-side updatedAt (Date.now() on the room) at the moment this pose
  // was last touched. Using server time instead of local arrival time
  // sidesteps the "React batches three WS messages into one tick → three
  // snapshots with identical local arrival time → interpolation collapses
  // and the avatar teleports" failure mode.
  serverTime: number
  position: [number, number, number]
  yaw: number
}

function shortAngle(target: number, current: number): number {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

function animationStateForSpeed(speed: number): string {
  if (speed <= INPUT_IDLE_SPEED_EPSILON) return 'idle'
  if (speed > 6) return 'sprint'
  if (speed > 2.4) return 'run'
  return 'walk'
}

function RemotePresenceAvatar({ player }: { player: MultiplayerRoomPlayer }) {
  const groupRef = useRef<THREE.Group>(null)
  const bufferRef = useRef<RemoteSnapshot[]>([])
  // Server↔local time anchor. We compute serverNow as
  //   serverNow = performance.now() - firstLocalTime + firstServerTime
  // After this anchor is set on the first incoming snapshot, we render at
  // serverNow - REMOTE_RENDER_DELAY_MS, interpolating between two snapshots
  // bracketing that server time. Server clock drift over a session is fine
  // for a friend-server use case; rebase if drift becomes a real problem.
  const timeAnchorRef = useRef<{ firstLocal: number; firstServer: number } | null>(null)
  // Per-frame inferred speed in m/s — fed to RemoteVRMAvatar so its animation
  // state machine can pick idle/walk/run/sprint without us reaching into the
  // controller. Smoothed mildly so a single jittery snapshot doesn't pop the
  // state machine between idle and walk.
  const lastPosRef = useRef<THREE.Vector3>(new THREE.Vector3(player.position[0], player.position[1], player.position[2]))
  const smoothedSpeedRef = useRef<number>(0)
  const [speed, setSpeed] = useState(0)
  const color = player.color || '#38bdf8'
  const avatarUrl = player.avatarUrl || ''

  // One-shot seed: place the group at the player's incoming pose before the
  // first useFrame runs, so a new remote doesn't appear at world origin and
  // visibly slide toward its spawn.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.position.set(player.position[0], player.position[1], player.position[2])
    group.rotation.y = player.yaw
    lastPosRef.current.set(player.position[0], player.position[1], player.position[2])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const localNow = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const last = bufferRef.current[bufferRef.current.length - 1]
    if (last
      && Math.abs(last.position[0] - player.position[0]) < 0.0001
      && Math.abs(last.position[1] - player.position[1]) < 0.0001
      && Math.abs(last.position[2] - player.position[2]) < 0.0001
      && Math.abs(last.yaw - player.yaw) < 0.0001) {
      return
    }
    // Anchor server↔local time on the very first snapshot we see for this
    // remote. Subsequent snapshots compute serverTime in the same domain.
    if (!timeAnchorRef.current) {
      timeAnchorRef.current = { firstLocal: localNow, firstServer: player.updatedAt || localNow }
    }
    bufferRef.current.push({
      serverTime: player.updatedAt || (localNow - timeAnchorRef.current.firstLocal + timeAnchorRef.current.firstServer),
      position: [player.position[0], player.position[1], player.position[2]],
      yaw: player.yaw,
    })
    // Keep the buffer sorted by serverTime in case messages arrive out of
    // order during a network hiccup. Bubble-up since we usually append at
    // the end and only the last entry can be out of place.
    for (let i = bufferRef.current.length - 1; i > 0; i -= 1) {
      if (bufferRef.current[i].serverTime < bufferRef.current[i - 1].serverTime) {
        const tmp = bufferRef.current[i]
        bufferRef.current[i] = bufferRef.current[i - 1]
        bufferRef.current[i - 1] = tmp
      } else break
    }
    if (bufferRef.current.length > REMOTE_SNAPSHOT_BUFFER) {
      bufferRef.current.shift()
    }
  }, [player.position[0], player.position[1], player.position[2], player.yaw, player.updatedAt])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const buffer = bufferRef.current
    if (buffer.length === 0) return

    const localNow = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const anchor = timeAnchorRef.current
    const serverNow = anchor ? (localNow - anchor.firstLocal + anchor.firstServer) : localNow
    const renderTime = serverNow - REMOTE_RENDER_DELAY_MS

    let target: { position: [number, number, number]; yaw: number }
    if (buffer.length === 1 || renderTime >= buffer[buffer.length - 1].serverTime) {
      const last = buffer[buffer.length - 1]
      target = { position: last.position, yaw: last.yaw }
    } else if (renderTime <= buffer[0].serverTime) {
      const first = buffer[0]
      target = { position: first.position, yaw: first.yaw }
    } else {
      let lo = buffer[0]
      let hi = buffer[1]
      for (let i = 1; i < buffer.length; i += 1) {
        if (buffer[i].serverTime >= renderTime) {
          hi = buffer[i]
          lo = buffer[i - 1]
          break
        }
      }
      const span = hi.serverTime - lo.serverTime
      const alpha = span <= 0 ? 1 : (renderTime - lo.serverTime) / span
      const yawDiff = shortAngle(hi.yaw, lo.yaw)
      target = {
        position: [
          lo.position[0] + (hi.position[0] - lo.position[0]) * alpha,
          lo.position[1] + (hi.position[1] - lo.position[1]) * alpha,
          lo.position[2] + (hi.position[2] - lo.position[2]) * alpha,
        ],
        yaw: lo.yaw + yawDiff * alpha,
      }
    }

    const terrainY = sampleTerrainHeightAt(
      useOasisStore.getState().terrainHeights,
      target.position[0],
      target.position[2],
    )
    if (Math.abs(target.position[1] - terrainY) > 0.75) {
      target = {
        position: [target.position[0], terrainY, target.position[2]],
        yaw: target.yaw,
      }
    }

    const catchUp = 1 - Math.exp(-REMOTE_POSITION_CATCHUP * delta)
    group.position.x += (target.position[0] - group.position.x) * catchUp
    group.position.y += (target.position[1] - group.position.y) * catchUp
    group.position.z += (target.position[2] - group.position.z) * catchUp
    const yawCatch = 1 - Math.exp(-REMOTE_YAW_CATCHUP * delta)
    group.rotation.y += shortAngle(target.yaw, group.rotation.y) * yawCatch

    // ── Infer ground-plane speed from the SNAPSHOT BUFFER's most recent two
    // entries (server-domain), not from the group's catch-up displacement.
    // The catch-up lerp is asymptotic so group-displacement is never quite
    // zero, which makes a STATIONARY remote read as perpetually walking.
    // Buffer-derived speed is 0 the instant new snapshots stop arriving.
    if (player.animState === 'idle') {
      smoothedSpeedRef.current = 0
      if (speed !== 0) setSpeed(0)
      lastPosRef.current.set(group.position.x, group.position.y, group.position.z)
      return
    }

    if (buffer.length >= 2) {
      const latest = buffer[buffer.length - 1]
      const prev = buffer[buffer.length - 2]
      const dt = (latest.serverTime - prev.serverTime) / 1000
      let targetSpeed = 0
      if (dt > 0.001) {
        const dx = latest.position[0] - prev.position[0]
        const dz = latest.position[2] - prev.position[2]
        targetSpeed = Math.sqrt(dx * dx + dz * dz) / dt
      }
      // Stale-snapshot guard: if the latest snapshot is more than 350ms old
      // in server time (anchor-adjusted), treat as idle. Prevents the avatar
      // from holding a walk animation when the network goes quiet.
      const anchorForGuard = timeAnchorRef.current
      if (anchorForGuard) {
        const serverNowGuard = localNow - anchorForGuard.firstLocal + anchorForGuard.firstServer
        if (serverNowGuard - latest.serverTime > 350) targetSpeed = 0
      }
      const smoothing = 1 - Math.exp(-12 * delta)
      smoothedSpeedRef.current += (targetSpeed - smoothedSpeedRef.current) * smoothing
      if (targetSpeed === 0 && smoothedSpeedRef.current < 0.08) {
        smoothedSpeedRef.current = 0
        if (speed !== 0) setSpeed(0)
      } else if (Math.abs(smoothedSpeedRef.current - speed) > 0.15) {
        setSpeed(smoothedSpeedRef.current)
      }
    } else if (speed !== 0) {
      smoothedSpeedRef.current = 0
      setSpeed(0)
    }
    lastPosRef.current.set(group.position.x, group.position.y, group.position.z)
  })

  return (
    <RemoteVRMAvatar
      ref={groupRef}
      avatarUrl={avatarUrl}
      profileAvatarUrl={player.profileAvatarUrl}
      cacheKey={player.sessionId}
      displayName={player.displayName}
      color={color}
      speed={speed}
      animState={player.animState}
    />
  )
}

export function MultiplayerPresenceLayer() {
  const activeWorldId = useOasisStore(s => s.viewingWorldId || s.activeWorldId)
  const activeWorldPvpEnabled = useOasisStore(s => {
    const id = s.viewingWorldId || s.activeWorldId
    return s.worldRegistry.find(world => world.id === id)?.pvpEnabled === true
  })
  const avatarUrl = useOasisStore(s => s.avatar3dUrl)
  // Latest avatarUrl read at connect time. After connect, we send profile
  // mutations on changes instead of reconnecting the whole room.
  const avatarUrlRef = useRef(avatarUrl)
  useEffect(() => { avatarUrlRef.current = avatarUrl }, [avatarUrl])
  const profileAvatarUrlRef = useRef('')
  const playerIdRef = useRef<string>('')
  const playerNameRef = useRef<string>('Visitor')
  const playerColorRef = useRef<string>('#38bdf8')
  // Latest computed max values from the user's profile. Set by the profile
  // fetch effect below; used at join time to seed the room's player state.
  const maxHpRef = useRef<number>(100)
  const manaRef = useRef<number>(20)
  const maxManaRef = useRef<number>(20)
  const connectionRef = useRef<MultiplayerRoomConnection | null>(null)
  const lastSentPoseRef = useRef<{ position: [number, number, number]; yaw: number } | null>(null)
  const previousPoseRef = useRef<{ position: [number, number, number]; yaw: number; time: number } | null>(null)
  const lastSentAnimStateRef = useRef<string | null>(null)
  const lastSentAtRef = useRef<number>(0)
  const [players, setPlayers] = useState<MultiplayerRoomPlayer[]>([])
  const [reconnectTick, setReconnectTick] = useState(0)
  const reconnectAttemptRef = useRef(0)
  // Tracks which world we last cleared live-strokes for, so transient WS
  // reconnects (which bump reconnectTick) don't wipe in-progress strokes.
  const clearedWorldIdRef = useRef<string | null>(null)

  useEffect(() => {
    const playerId = makePresenceId()
    playerIdRef.current = playerId
    playerNameRef.current = makePresenceName(playerId)
    playerColorRef.current = colorForId(playerId)
  }, [])

  // Override the legacy `Visitor XXXX` localStorage name with the user's
  // actual profile.displayName once it loads, AND re-pull whenever the user
  // edits their profile mid-session (ProfileButton dispatches the
  // `oasis:profile-updated` event after a successful save).
  useEffect(() => {
    let cancelled = false
    let pendingProfile: { displayName?: string; profileAvatarUrl?: string } | null = null

    const sendProfilePatch = (patch: { displayName?: string; profileAvatarUrl?: string }) => {
      const connection = connectionRef.current
      if (connection) {
        connection.sendProfile(patch)
      } else {
        pendingProfile = { ...(pendingProfile || {}), ...patch }
      }
    }

    const apply = (fromProfile: string, profileAvatarUrl?: string | null) => {
      const avatarUrl = profileAvatarUrl || ''
      profileAvatarUrlRef.current = avatarUrl
      const patch: { displayName?: string; profileAvatarUrl?: string } = { profileAvatarUrl: avatarUrl }
      // Skip the default placeholders — only override the legacy Visitor
      // label when the user picked a real name.
      if (fromProfile && fromProfile !== 'Player 1' && fromProfile !== 'Wanderer') {
        playerNameRef.current = fromProfile
        try { window.localStorage.setItem('oasis-presence-player-name', fromProfile) } catch {}
        patch.displayName = fromProfile
      }
      sendProfilePatch(patch)
    }

    const refresh = () => {
      fetch('/api/profile', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((data: { displayName?: string; avatar_url?: string | null; mana?: number; maxHp?: number; maxMana?: number; stats?: { maxHp?: number; maxMana?: number } } | null) => {
          if (cancelled) return
          // PvP max values — prefer the explicit fields, fall back to stats.
          // These are used at the next room connect; mid-session changes
          // require a reconnect to take effect (rare — skills change rarely).
          const maxHp = typeof data?.maxHp === 'number'
            ? data.maxHp
            : (typeof data?.stats?.maxHp === 'number' ? data.stats.maxHp : null)
          const maxMana = typeof data?.maxMana === 'number'
            ? data.maxMana
            : (typeof data?.stats?.maxMana === 'number' ? data.stats.maxMana : null)
          if (maxHp !== null) maxHpRef.current = maxHp
          if (maxMana !== null) maxManaRef.current = maxMana
          if (typeof data?.mana === 'number') {
            manaRef.current = Math.max(0, Math.min(maxManaRef.current, data.mana))
          }
          if (!data?.displayName) return
          const profileAvatarUrl = data.avatar_url ? `${data.avatar_url}?v=${Date.now()}` : ''
          apply(data.displayName.trim(), profileAvatarUrl)
        })
        .catch(() => {})
    }

    refresh()

    const onProfileUpdated = () => refresh()
    window.addEventListener('oasis:profile-updated', onProfileUpdated)

    // Flush pending profile once the connection establishes (async after this
    // effect runs). Stops polling when consumed or unmount.
    const flushTimer = window.setInterval(() => {
      if (cancelled) return
      if (pendingProfile && connectionRef.current) {
        connectionRef.current.sendProfile(pendingProfile)
        pendingProfile = null
      }
    }, 250)

    return () => {
      cancelled = true
      window.removeEventListener('oasis:profile-updated', onProfileUpdated)
      window.clearInterval(flushTimer)
    }
  }, [])

  useEffect(() => {
    const store = useOasisStore.getState()
    return worldMutationBus.subscribe(mutation => {
      if (mutation.kind === 'object_added') {
        store.applyRemoteCatalogPlacement(mutation.payload)
      } else if (mutation.kind === 'object_removed') {
        applyRemoteObjectRemoval(mutation.payload.id, mutation.payload.linkedAvatarIds)
      } else if (mutation.kind === 'object_transformed') {
        const { id, position, rotation, scale } = mutation.payload
        store.applyRemoteObjectTransform(id, { position, rotation, scale })
      } else if (mutation.kind === 'portal_added') {
        upsertRemotePortalGate(mutation.payload)
      } else if (mutation.kind === 'agent_window_added') {
        upsertRemoteAgentWindow(mutation.payload)
      } else if (mutation.kind === 'agent_avatar_added') {
        upsertRemoteAgentAvatar(mutation.payload)
      } else if (mutation.kind === 'placement_vfx') {
        store.spawnPlacementVfx(mutation.payload.position, mutation.payload.typeOverride)
      } else if (mutation.kind === 'sky_changed') {
        store.applyRemoteSkyChange(mutation.payload.skyBackgroundId)
      } else if (mutation.kind === 'ground_changed') {
        store.applyRemoteGroundChange(mutation.payload.groundPresetId)
      } else if (mutation.kind === 'ground_painted') {
        const { cx, cz, presetId, size, stretch } = mutation.payload
        store.applyRemoteGroundPaint(cx, cz, presetId, size, stretch)
      } else if (mutation.kind === 'ground_tile_erased') {
        store.applyRemoteGroundTileErase(mutation.payload.x, mutation.payload.z)
      } else if (mutation.kind === 'ground_tiles_cleared') {
        store.applyRemoteGroundTilesClear()
      } else if (mutation.kind === 'terrain_brushed') {
        const { x, z, radius, intensity, direction, deltaSeconds } = mutation.payload
        store.applyRemoteTerrainBrush(x, z, radius, intensity, direction, deltaSeconds)
      } else if (mutation.kind === 'terrain_reset') {
        store.applyRemoteTerrainReset()
      } else if (mutation.kind === 'behavior_updated') {
        store.applyRemoteObjectBehavior(mutation.payload.id, mutation.payload.updates)
      } else if (mutation.kind === 'light_added') {
        store.applyRemoteLightAdded(mutation.payload.light)
      } else if (mutation.kind === 'light_removed') {
        store.applyRemoteLightRemoved(mutation.payload.id)
      } else if (mutation.kind === 'light_updated') {
        store.applyRemoteLightUpdated(mutation.payload.id, mutation.payload.updates)
      } else if (mutation.kind === 'stroke_started') {
        const { strokeId, authorId, authorColor, style } = mutation.payload
        startLiveStroke({ id: strokeId, authorId, authorColor, style })
      } else if (mutation.kind === 'stroke_pointed') {
        appendLiveStrokePoint(mutation.payload.strokeId, mutation.payload.point)
      } else if (mutation.kind === 'stroke_ended') {
        // Persist FIRST so the persistent mesh is mounted before we clear the
        // live preview — otherwise there's a one-frame blink between the live
        // stroke vanishing and the persisted PaintStrokeMesh appearing.
        store.applyRemotePaintStroke(mutation.payload.finalStroke)
        endLiveStroke(mutation.payload.strokeId)
      } else if (mutation.kind === 'stroke_updated') {
        store.applyRemotePaintStrokeUpdated(mutation.payload.id, mutation.payload.updates)
      } else if (mutation.kind === 'stroke_removed') {
        store.applyRemotePaintStrokeRemoval(mutation.payload.id)
      } else if (mutation.kind === 'text3d_added') {
        store.applyRemoteText3dAdded(mutation.payload)
      } else if (mutation.kind === 'text3d_updated') {
        store.applyRemoteText3dUpdated(mutation.payload.id, mutation.payload.updates)
      } else if (mutation.kind === 'text3d_removed') {
        store.applyRemoteText3dRemoved(mutation.payload.id)
      }
    })
  }, [])

  useEffect(() => {
    if (!activeWorldId) {
      setPlayers([])
      return
    }
    const playerId = playerIdRef.current
    if (!playerId) return

    // ░▒▓ Skip entirely when there's no configured room server (typical local
    // dev). Without this guard the client spams reconnect attempts at
    // ws://localhost:4519 every few seconds. Hosted has a real endpoint via
    // window.location.hostname/rooms; local needs explicit
    // NEXT_PUBLIC_OASIS_ROOM_URL to opt in.
    if (!isMultiplayerRoomConfigured()) {
      setPlayers([])
      return
    }

    let disposed = false
    let connection: MultiplayerRoomConnection | null = null
    let reconnectTimer: number | null = null

    setPlayers([])

    const scheduleReconnect = () => {
      if (disposed) return
      const attempt = reconnectAttemptRef.current + 1
      reconnectAttemptRef.current = attempt
      // Exponential backoff capped at 15s: 1s, 2s, 4s, 8s, 15s, 15s...
      const delayMs = Math.min(15000, 1000 * Math.pow(2, attempt - 1))
      if (typeof window === 'undefined') return
      reconnectTimer = window.setTimeout(() => {
        if (!disposed) setReconnectTick(t => t + 1)
      }, delayMs)
    }

    connectToWorldRoom({
      worldId: activeWorldId,
      playerId,
      displayName: playerNameRef.current,
      avatarUrl: avatarUrlRef.current || undefined,
      profileAvatarUrl: profileAvatarUrlRef.current || undefined,
      color: playerColorRef.current,
      pvpEnabled: activeWorldPvpEnabled,
      maxHp: maxHpRef.current,
      mana: manaRef.current,
      maxMana: maxManaRef.current,
      onPlayersChanged: next => {
        if (!disposed) setPlayers(next)
      },
      onMutation: payload => {
        if (disposed) return
        const mutation = payload as WorldMutation
        if (!mutation || typeof mutation !== 'object' || typeof mutation.kind !== 'string') return
        worldMutationBus.applyIncoming(mutation)
      },
      onConnectionState: (state, detail) => {
        if (disposed) return
        if (state === 'connected') {
          reconnectAttemptRef.current = 0
        } else if (state === 'closed' || state === 'error') {
          console.warn('[oasis-room] connection lost:', state, detail || '')
          // Only the layer's reconnect path may null the sender. Guard so we
          // don't stomp a sender belonging to a newer connection.
          if (connection === connectionRef.current) {
            worldMutationBus.setSender(null)
            connectionRef.current = null
          }
          scheduleReconnect()
        }
      },
    })
      .then(next => {
        if (disposed) {
          void next.dispose()
          return
        }
        connection = next
        connectionRef.current = next
        worldMutationBus.setSender(mutation => next.sendMutation(mutation))
        lastSentPoseRef.current = null
        previousPoseRef.current = null
        lastSentAnimStateRef.current = null
        lastSentAtRef.current = 0
      })
      .catch(error => {
        console.warn('[oasis-room] connect rejected:', error)
        scheduleReconnect()
      })

    return () => {
      disposed = true
      if (reconnectTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(reconnectTimer)
      }
      // Only null the sender if we're disposing the active connection — a
      // newer effect may have already wired its own sender.
      if (connection === connectionRef.current) {
        worldMutationBus.setSender(null)
        connectionRef.current = null
      }
      if (connection) {
        void connection.dispose()
      }
      lastSentPoseRef.current = null
      previousPoseRef.current = null
      lastSentAnimStateRef.current = null
      lastSentAtRef.current = 0
      // Drop any in-progress remote strokes ONLY when the world id actually
      // changes. Reconnects (transient WS drops) bump reconnectTick but the
      // world is the same — clearing here would wipe the local user's
      // in-progress stroke mid-draw.
      if (clearedWorldIdRef.current !== activeWorldId) {
        clearAllLiveStrokes()
        clearedWorldIdRef.current = activeWorldId
      }
    }
  }, [activeWorldId, activeWorldPvpEnabled, reconnectTick])

  // Push avatar/profile changes as a small mutation instead of reconnecting
  // the whole room. This decouples cosmetic changes from session lifecycle.
  useEffect(() => {
    const connection = connectionRef.current
    if (!connection) return
    connection.sendProfile({ avatarUrl: avatarUrl || '' })
  }, [avatarUrl])

  useFrame(() => {
    const connection = connectionRef.current
    if (!connection) return

    const pose = getLocalPose()
    if (!pose) return

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const previousPose = previousPoseRef.current
    let vx = 0
    let vz = 0
    if (previousPose) {
      const dt = Math.max(0.001, (now - previousPose.time) / 1000)
      vx = (pose.position[0] - previousPose.position[0]) / dt
      vz = (pose.position[2] - previousPose.position[2]) / dt
    }
    const speed = Math.sqrt(vx * vx + vz * vz)
    const runtimeAnimState = getPlayerAnimationState()
    const animState = runtimeAnimState && runtimeAnimState !== 'idle'
      ? runtimeAnimState
      : animationStateForSpeed(speed)
    previousPoseRef.current = { position: [...pose.position], yaw: pose.yaw, time: now }

    if (now - lastSentAtRef.current < INPUT_SEND_INTERVAL_MS) return

    const last = lastSentPoseRef.current
    // Horizontal motion drives locomotion; Y only forces a pose send when the
    // terrain under a stationary avatar changes enough to matter.
    const moved = !last
      || Math.abs(pose.position[0] - last.position[0]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.position[2] - last.position[2]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.yaw - last.yaw) > INPUT_YAW_EPSILON
    const heightChanged = !last || Math.abs(pose.position[1] - last.position[1]) > INPUT_HEIGHT_EPSILON
    const animChanged = lastSentAnimStateRef.current !== animState
    const heartbeatDue = now - lastSentAtRef.current > INPUT_HEARTBEAT_INTERVAL_MS

    if (!moved && !heightChanged && !animChanged && !heartbeatDue) return

    connection.sendInput({
      x: pose.position[0],
      y: pose.position[1],
      z: pose.position[2],
      yaw: pose.yaw,
      vx,
      vz,
      animState,
    })
    lastSentPoseRef.current = { position: [...pose.position], yaw: pose.yaw }
    lastSentAnimStateRef.current = animState
    lastSentAtRef.current = now
  })

  if (!activeWorldId || players.length === 0) return null

  return (
    <group name="multiplayer-presence-layer">
      {players.map(player => (
        <RemotePresenceAvatar key={player.sessionId} player={player} />
      ))}
    </group>
  )
}

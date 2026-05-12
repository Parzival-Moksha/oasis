'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { getCameraSnapshot } from '@/lib/camera-bridge'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import {
  connectToWorldRoom,
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

const INPUT_SEND_INTERVAL_MS = 33
// Position jitter epsilon for "did the player actually move?" — 5cm is well
// above VRM spring physics + camera bobbing noise but below any human walk
// step. Stricter values (2cm before) made stationary remotes get classified
// as walking on the receive side because their client kept emitting tiny
// drift positions. Y is ignored separately — terrain sampling under a
// stationary avatar can shift Y by >2cm without any actual movement intent.
const INPUT_POSITION_EPSILON = 0.05
const INPUT_YAW_EPSILON = 0.04
const REMOTE_RENDER_DELAY_MS = 120
const REMOTE_SNAPSHOT_BUFFER = 6
const REMOTE_POSITION_CATCHUP = 9
const REMOTE_YAW_CATCHUP = 9

function makePresenceId(): string {
  if (typeof window !== 'undefined') {
    const key = 'oasis-presence-player-id'
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
    const id = `player-${randomId}`
    window.sessionStorage.setItem(key, id)
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
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const name = `Visitor ${playerId.slice(-4).toUpperCase()}`
  window.localStorage.setItem(key, name)
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
  return {
    position: [camera.position[0], Math.max(0, camera.position[1] - 1.65), camera.position[2]],
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
      if (Math.abs(smoothedSpeedRef.current - speed) > 0.15) {
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
      cacheKey={player.sessionId}
      displayName={player.displayName}
      color={color}
      speed={speed}
    />
  )
}

export function MultiplayerPresenceLayer() {
  const activeWorldId = useOasisStore(s => s.viewingWorldId || s.activeWorldId)
  const avatarUrl = useOasisStore(s => s.avatar3dUrl)
  // Latest avatarUrl read at connect time. After connect, we send profile
  // mutations on changes instead of reconnecting the whole room.
  const avatarUrlRef = useRef(avatarUrl)
  useEffect(() => { avatarUrlRef.current = avatarUrl }, [avatarUrl])
  const playerIdRef = useRef<string>('')
  const playerNameRef = useRef<string>('Visitor')
  const playerColorRef = useRef<string>('#38bdf8')
  const connectionRef = useRef<MultiplayerRoomConnection | null>(null)
  const lastSentPoseRef = useRef<{ position: [number, number, number]; yaw: number } | null>(null)
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
    let pendingName: string | null = null

    const apply = (fromProfile: string) => {
      // Skip the default placeholders — only override the legacy Visitor
      // label when the user picked a real name.
      if (!fromProfile || fromProfile === 'Player 1' || fromProfile === 'Wanderer') return
      playerNameRef.current = fromProfile
      try { window.localStorage.setItem('oasis-presence-player-name', fromProfile) } catch {}
      const connection = connectionRef.current
      if (connection) {
        connection.sendProfile({ displayName: fromProfile })
      } else {
        // Profile fetch resolved before the room connected. Stash and let
        // the poller below flush once a sender is wired.
        pendingName = fromProfile
      }
    }

    const refresh = () => {
      fetch('/api/profile', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((data: { displayName?: string } | null) => {
          if (cancelled || !data?.displayName) return
          apply(data.displayName.trim())
        })
        .catch(() => {})
    }

    refresh()

    const onProfileUpdated = () => refresh()
    window.addEventListener('oasis:profile-updated', onProfileUpdated)

    // Flush pendingName once the connection establishes (async after this
    // effect runs). Stops polling when consumed or unmount.
    const flushTimer = window.setInterval(() => {
      if (cancelled) return
      if (pendingName && connectionRef.current) {
        connectionRef.current.sendProfile({ displayName: pendingName })
        pendingName = null
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
        store.applyRemoteCatalogRemoval(mutation.payload.id)
      } else if (mutation.kind === 'object_transformed') {
        const { id, position, rotation, scale } = mutation.payload
        store.applyRemoteObjectTransform(id, { position, rotation, scale })
      } else if (mutation.kind === 'sky_changed') {
        store.applyRemoteSkyChange(mutation.payload.skyBackgroundId)
      } else if (mutation.kind === 'ground_changed') {
        store.applyRemoteGroundChange(mutation.payload.groundPresetId)
      } else if (mutation.kind === 'terrain_brushed') {
        const { x, z, radius, intensity, direction, deltaSeconds } = mutation.payload
        store.applyRemoteTerrainBrush(x, z, radius, intensity, direction, deltaSeconds)
      } else if (mutation.kind === 'terrain_reset') {
        store.applyRemoteTerrainReset()
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
      color: playerColorRef.current,
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
  }, [activeWorldId, reconnectTick])

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
    if (now - lastSentAtRef.current < INPUT_SEND_INTERVAL_MS) return

    const last = lastSentPoseRef.current
    // Only horizontal motion counts as "moved." Y is sampled from the terrain
    // height field under the avatar and shifts when the brush deforms the
    // ground nearby — that's not the player walking, and treating it as such
    // pushed peers' walk animations on perpetually. Y is still SENT (line
    // below) so portal arrivals + height changes propagate, but it doesn't
    // trigger the throttled send.
    const moved = !last
      || Math.abs(pose.position[0] - last.position[0]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.position[2] - last.position[2]) > INPUT_POSITION_EPSILON
      || Math.abs(pose.yaw - last.yaw) > INPUT_YAW_EPSILON

    if (!moved) return

    connection.sendInput({
      x: pose.position[0],
      y: pose.position[1],
      z: pose.position[2],
      yaw: pose.yaw,
    })
    lastSentPoseRef.current = { position: [...pose.position], yaw: pose.yaw }
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

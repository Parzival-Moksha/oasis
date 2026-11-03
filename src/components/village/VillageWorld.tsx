'use client'

// ░▒▓ VILLAGE WORLD — engine agents as characters at desks around the spawn point ▓▒░
// Mounted inside the R3F <Canvas> when the village profile is on. Nothing here is saved to the
// world: the roster comes from the agent engine, positions from village-layout.ts.

import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager } from '../../lib/input-manager'
import { sampleTerrainHeightAt } from '../../lib/forge/terrain-brush'
import { AGENT_AVATAR_CATALOG } from '../../lib/agent-avatar-catalog'
import {
  STATION,
  VILLAGE_SPAWN,
  assignVillageAvatars,
  computeFocusPose,
  layoutVillageStations,
  plazaCenter,
  resolveVillageOrigin,
  stationLocalToWorld,
  type Vec3,
  type VillageOrigin,
} from '../../lib/village/village-layout'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { VRMCatalogRenderer } from '../forge/WorldObjects'
import { useIsMobileOasis } from '../forge/MobileOasisControls'
import { effectiveStatus } from '../../store/slices/agentEngineSlice'
import { AgentSessionView, SessionWindowHeader } from './AgentSessionView'
import {
  focusVillageAgent,
  getSessionPanelGeometry,
  getVillageStation,
  isFocusInputState,
  isVillageFocusBlocked,
  openVillagePicker,
  registerVillageCamera,
  setVillageStations,
  type VillageStationPlacement,
} from './village-actions'
import { VILLAGE_OBSERVED_COLOR, agentDisplayName, statusColor, statusLabel } from './village-status'

const WORK_ANIMATION_ID = 'ual-talking'
const WINDOW_DISTANCE = 26
const MAX_DESK_WINDOWS = 6
/** Village overlays stay under the HUD and panels (drei's default z-range is ~16M). */
const OVERLAY_Z: [number, number] = [80, 0]
/**
 * Phones: MobileOasisControls lays a full-screen look surface at z 180 over the canvas. Desk windows
 * and the plaza sign go just above it so they can be tapped (still under the rail at 190).
 */
const OVERLAY_Z_MOBILE: [number, number] = [186, 181]

/** Humanoid bodies that read well at a desk; the rest of the gallery is the fallback pool. */
const PREFERRED_BODIES = [
  'Orion', 'Anna', 'Bruno', 'David', 'Eugenia', 'Amazonas', 'CosmicBot', 'Cyberpal', 'EYECleric', 'GoodKnight',
  'HodlerKing', 'MushroomFairy', 'PitcherDude', 'SportTV', 'UnicornPerson', 'CaptainLobster', 'DreamFighter',
  'EYEWizard', 'Juanita', 'LadyFawn', 'Mr', 'StitchWitch', 'Witch', 'VIPE_Hero__2723', 'VIPE_Hero__2784',
  'VIPE_Hero__2799', 'VIPE_Hero__2770', 'CoolAlien', 'CoolGuitar', 'EYE_Diviner', 'King_Mutatio',
].map(name => `/avatars/gallery/${name}.vrm`)

function useBodyPool(): string[] {
  return useMemo(() => {
    const catalog = AGENT_AVATAR_CATALOG.map(entry => entry.path)
    const preferred = PREFERRED_BODIES.filter(path => catalog.includes(path))
    return [...preferred, ...catalog.filter(path => !preferred.includes(path))]
  }, [])
}

// ─── station pieces ─────────────────────────────────────────────────────────

function VillageDesk({ color, working, observed }: { color: string; working: boolean; observed: boolean }) {
  const screenRef = useRef<THREE.MeshStandardMaterial>(null)
  const screenColor = observed ? VILLAGE_OBSERVED_COLOR : color
  useFrame(({ clock }) => {
    const material = screenRef.current
    if (!material) return
    const t = clock.getElapsedTime()
    material.emissiveIntensity = working ? 0.9 + Math.sin(t * 9) * 0.25 + Math.sin(t * 23) * 0.12 : 0.55
  })
  // Monitor sits on the desk's -X half, angled toward the avatar (who stands at z = -0.55). The
  // focus camera shifts toward +X (session panel on the right), so the monitor never blocks the view.
  const monitorX = -0.52
  const monitorZ = 0.22
  const monitorYaw = Math.atan2(0 - monitorX, -0.55 - monitorZ)
  return (
    <group>
      <mesh position={[0, 0.98, 0.12]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.06, 0.72]} />
        <meshStandardMaterial color="#273142" roughness={0.55} metalness={0.25} />
      </mesh>
      {/* status strip along the player-facing edge */}
      <mesh position={[0, 0.965, 0.485]}>
        <boxGeometry args={[1.66, 0.025, 0.01]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {[-0.78, 0.78].map(x => (
        <mesh key={x} position={[x, 0.475, 0.12]} castShadow>
          <boxGeometry args={[0.06, 0.95, 0.62]} />
          <meshStandardMaterial color="#1b2230" roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      {/* keyboard in front of the avatar */}
      <mesh position={[-0.05, 1.022, -0.06]} rotation-y={0.08}>
        <boxGeometry args={[0.46, 0.022, 0.15]} />
        <meshStandardMaterial color="#111827" roughness={0.7} />
      </mesh>
      <group position={[monitorX, 1.01, monitorZ]} rotation-y={monitorYaw}>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.07, 0.2, 0.07]} />
          <meshStandardMaterial color="#374151" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.36, 0]} castShadow>
          <boxGeometry args={[0.66, 0.4, 0.04]} />
          <meshStandardMaterial color="#0b1020" metalness={0.3} roughness={0.35} />
        </mesh>
        {/* screen faces the avatar (local +Z of this group) */}
        <mesh position={[0, 0.36, 0.021]}>
          <planeGeometry args={[0.6, 0.34]} />
          <meshStandardMaterial ref={screenRef} color="#0b1220" emissive={screenColor} emissiveIntensity={0.55} toneMapped={false} />
        </mesh>
        {/* glowing logo on the back, toward the player */}
        <mesh position={[0, 0.38, -0.021]} rotation-y={Math.PI}>
          <circleGeometry args={[0.06, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function StatusRing({ color, status, observed, unseen }: { color: string; status: string; observed: boolean; unseen: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null)
  const beamRef = useRef<THREE.Mesh>(null)
  const alarm = status === 'needs-decision' || status === 'error'
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (ringRef.current) {
      const pulse = alarm ? 1 + Math.sin(t * 5) * 0.12 : unseen ? 1 + Math.sin(t * 2.5) * 0.06 : status === 'working' ? 1 + Math.sin(t * 3) * 0.03 : 1
      ringRef.current.scale.setScalar(pulse)
    }
    if (beamRef.current) {
      const material = beamRef.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.1 + (Math.sin(t * 4) + 1) * 0.06
    }
  })
  return (
    <group>
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <torusGeometry args={[0.56, 0.045, 12, 56]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.52, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      {observed && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}>
          <ringGeometry args={[0.7, 0.74, 48, 1, 0, Math.PI * 2]} />
          <meshBasicMaterial color={VILLAGE_OBSERVED_COLOR} transparent opacity={0.8} depthWrite={false} />
        </mesh>
      )}
      {alarm && (
        // A beacon you can see from across the village: this agent needs you.
        <mesh ref={beamRef} position={[0, 3.2, 0]}>
          <cylinderGeometry args={[0.3, 0.42, 6.4, 24, 1, true]} />
          <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
    </group>
  )
}

/** Observed sessions stand in a projection field: present, but not yours to drive. */
function HologramField() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const material = ref.current.material as THREE.MeshBasicMaterial
    material.opacity = 0.1 + Math.sin(clock.getElapsedTime() * 2) * 0.03
  })
  return (
    <mesh ref={ref} position={[0, 1.0, 0]}>
      <cylinderGeometry args={[0.5, 0.58, 2.05, 28, 1, true]} />
      <meshBasicMaterial color={VILLAGE_OBSERVED_COLOR} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
    </mesh>
  )
}

function AvatarPlaceholder({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.26, 0.9, 6, 14]} />
        <meshStandardMaterial color={color} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 1.62, 0]}>
        <sphereGeometry args={[0.2, 18, 12]} />
        <meshStandardMaterial color="#e5e7eb" transparent opacity={0.55} />
      </mesh>
    </group>
  )
}

function stopDomEvent(event: { stopPropagation: () => void; nativeEvent?: Event }) {
  event.stopPropagation()
  const native = event.nativeEvent as (Event & { stopImmediatePropagation?: () => void }) | undefined
  native?.stopImmediatePropagation?.()
}

/** Label fields only, as one string, so streaming text doesn't re-render every label. */
function useLabelInfo(agentId: string): { name: string; status: string; label: string; readOnly: boolean } | null {
  const key = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    if (!agent) return ''
    return [agentDisplayName(agent), effectiveStatus(agent), agent.readOnly ? 'observing' : statusLabel({ status: effectiveStatus(agent), unseen: agent.unseen }), agent.readOnly ? '1' : ''].join('\u0001')
  })
  return useMemo(() => {
    if (!key) return null
    const [name, status, label, readOnly] = key.split('\u0001')
    return { name, status, label, readOnly: readOnly === '1' }
  }, [key])
}

function StationLabel({ agentId, nearby }: { agentId: string; nearby: boolean }) {
  const info = useLabelInfo(agentId)
  if (!info) return null
  const color = statusColor(info.status)
  const alarm = info.status === 'needs-decision'
  return (
    <div className="pointer-events-none flex select-none flex-col items-center gap-1" style={{ transform: 'translateY(-50%)' }}>
      {alarm && (
        <div className="flex h-6 w-6 items-center justify-center rounded-full text-[15px] font-black text-black shadow-[0_0_18px_rgba(245,158,11,0.8)]" style={{ background: color, animation: 'villageBob 1.1s ease-in-out infinite' }}>
          !
        </div>
      )}
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-slate-950/80 px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_6px_18px_rgba(0,0,0,0.45)] backdrop-blur" style={{ borderColor: `${color}aa` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="max-w-[160px] truncate">{info.name}</span>
        <span className="font-normal text-white/55">{info.label}</span>
      </div>
      {nearby && (
        <div className="rounded-md border border-white/25 bg-black/75 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
          <span className="mr-1 rounded bg-white/20 px-1">E</span>talk
        </div>
      )}
      <style>{'@keyframes villageBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }'}</style>
    </div>
  )
}

function DeskWindow({ agentId, nearby }: { agentId: string; nearby: boolean }) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  if (!agent) return null
  const color = agent.readOnly ? VILLAGE_OBSERVED_COLOR : statusColor(effectiveStatus(agent))
  return (
    <div
      data-ui-panel="village-desk-window"
      className="flex h-[330px] w-[440px] flex-col rounded-xl border-2 bg-slate-950/90 p-2.5 text-white shadow-[0_0_40px_rgba(0,0,0,0.5)]"
      style={{ borderColor: `${color}cc`, boxShadow: `0 0 34px ${color}33` }}
      onPointerDown={stopDomEvent}
      onPointerUp={stopDomEvent}
      onWheel={stopDomEvent}
      onDoubleClick={stopDomEvent}
      onClick={(event) => {
        stopDomEvent(event)
        const target = event.target as HTMLElement
        if (target.closest('button, input, textarea, select')) return
        focusVillageAgent(agentId)
      }}
    >
      <AgentSessionView agentId={agentId} variant="3d" header={<SessionWindowHeader agent={agent} nearby={nearby} />} />
    </div>
  )
}

/** One VRM that fails to load (404, bad file) shows a placeholder instead of taking the scene down. */
class VillageBodyBoundary extends Component<{ color: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    console.warn(`[village] agent body failed to load: ${error.message}`)
  }
  render() {
    return this.state.failed ? <AvatarPlaceholder color={this.props.color} /> : this.props.children
  }
}

const NO_RAYCAST = () => {}

function VillageStation({ agentId, placement, avatarUrl, windowVisible, overlayZ }: {
  agentId: string
  placement: VillageStationPlacement
  avatarUrl: string
  windowVisible: boolean
  overlayZ: [number, number]
}) {
  const status = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    return agent ? effectiveStatus(agent) : 'idle'
  })
  const kind = useOasisStore(s => s.agentEngine.agents[agentId]?.kind || 'owned')
  const unseen = useOasisStore(s => Boolean(s.agentEngine.agents[agentId]?.unseen))
  const name = useOasisStore(s => s.agentEngine.agents[agentId]?.name || agentId)
  const focused = useOasisStore(s => s.agentEngine.focusedAgentId === agentId)
  const nearby = useOasisStore(s => s.agentEngine.nearbyAgentId === agentId)
  // While placing or painting, the desk must not swallow the clicks meant for the ground plane.
  const blocked = useInputManager(s => isVillageFocusBlocked(s.inputState))
  const color = statusColor(status)
  const observed = kind !== 'owned'

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    // After the canvas click has finished dismissing other panels.
    window.setTimeout(() => focusVillageAgent(agentId), 0)
  }

  return (
    <group position={placement.position} rotation-y={placement.rotationY}>
      <VillageDesk color={color} working={status === 'working'} observed={observed} />
      <group position={STATION.avatar}>
        <StatusRing color={color} status={status} observed={observed} unseen={unseen} />
        {observed && <HologramField />}
        <VillageBodyBoundary key={avatarUrl} color={color}>
          <Suspense fallback={<AvatarPlaceholder color={color} />}>
            {/* Own cache entry (#village): a world NPC on the same VRM keeps its own scene and mixer. */}
            <VRMCatalogRenderer
              path={`${avatarUrl}#village`}
              scale={1}
              displayName={name}
              activityAnimationId={status === 'working' ? WORK_ANIMATION_ID : null}
            />
          </Suspense>
        </VillageBodyBoundary>
      </group>
      {/* Click target enclosing desk + avatar (in front of the VRM's own proxy box). */}
      <mesh
        position={STATION.hitCenter}
        raycast={blocked ? NO_RAYCAST : THREE.Mesh.prototype.raycast}
        onClick={onClick}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (!useInputManager.getState().pointerLocked) event.nativeEvent.stopImmediatePropagation()
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          if (!useInputManager.getState().pointerLocked) document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <boxGeometry args={STATION.hitSize} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={STATION.label} center distanceFactor={9} zIndexRange={overlayZ} style={{ pointerEvents: 'none' }}>
        <StationLabel agentId={agentId} nearby={nearby && !focused} />
      </Html>
      {windowVisible && !focused && (
        <Html transform position={STATION.window} distanceFactor={1.8} zIndexRange={overlayZ} style={{ pointerEvents: 'auto' }}>
          <DeskWindow agentId={agentId} nearby={nearby} />
        </Html>
      )}
    </group>
  )
}

/**
 * Live desk windows are full DOM trees under a CSS 3D transform: keep only the nearest few, and
 * only within reading distance (re-evaluated a few times per second, with hysteresis).
 */
function useVisibleDeskWindows(placements: Map<string, VillageStationPlacement>): Set<string> {
  const [key, setKey] = useState('')
  const frame = useRef(0)
  const keyRef = useRef('')
  const point = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    frame.current = (frame.current + 1) % 15
    if (frame.current !== 0) return
    const visible = new Set(keyRef.current ? keyRef.current.split('|') : [])
    const ranked: Array<[string, number]> = []
    for (const [id, placement] of placements) {
      point.set(...stationLocalToWorld(placement, STATION.window))
      const distance = camera.position.distanceTo(point)
      const limit = visible.has(id) ? WINDOW_DISTANCE + 2 : WINDOW_DISTANCE
      if (distance < limit) ranked.push([id, distance])
    }
    ranked.sort((a, b) => a[1] - b[1])
    const next = ranked.slice(0, MAX_DESK_WINDOWS).map(([id]) => id).sort().join('|')
    if (next !== keyRef.current) {
      keyRef.current = next
      setKey(next)
    }
  })
  return useMemo(() => new Set(key ? key.split('|') : []), [key])
}

// ─── plaza + empty state ────────────────────────────────────────────────────

function PlazaSign({ position, children }: { position: Vec3; children: ReactNode }) {
  const mobile = useIsMobileOasis()
  return (
    <Html position={position} center distanceFactor={10} zIndexRange={mobile ? OVERLAY_Z_MOBILE : OVERLAY_Z}>
      <div
        data-ui-panel="village-sign"
        className="flex w-[280px] flex-col items-center gap-2 rounded-xl border border-emerald-300/30 bg-slate-950/85 px-4 py-3 text-center text-white shadow-[0_0_40px_rgba(16,185,129,0.18)]"
        onPointerDown={stopDomEvent}
        onClick={stopDomEvent}
      >
        {children}
      </div>
    </Html>
  )
}

/** Per world: captured once, so desks don't wander when the player walks around. */
const villageOrigins = new Map<string, VillageOrigin>()

function useVillageOrigin(): VillageOrigin {
  const worldId = useOasisStore(s => s.activeWorldId)
  const worldReady = useOasisStore(s => s._worldReady)
  const [origin, setOrigin] = useState<VillageOrigin | null>(() => villageOrigins.get(worldId) || null)
  useEffect(() => {
    const cached = villageOrigins.get(worldId)
    if (cached) {
      setOrigin(cached)
      return
    }
    setOrigin(null)
    if (!worldReady) return
    // Give the spawn / third-person camera a moment to settle before reading where the player looks.
    const timer = window.setTimeout(() => {
      const next = resolveVillageOrigin(getPlayerAvatarPose(), getCameraSnapshot())
      villageOrigins.set(worldId, next)
      setOrigin(next)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [worldId, worldReady])
  return origin || VILLAGE_SPAWN
}

function VillagePlaza({ empty, origin }: { empty: boolean; origin: VillageOrigin }) {
  const connection = useOasisStore(s => s.agentEngine.connection.status)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const center = plazaCenter({ origin })
  const y = sampleTerrainHeightAt(terrainHeights, center.x, center.z)
  return (
    <group position={[center.x, y, center.z]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
        <ringGeometry args={[2.1, 2.22, 72]} />
        <meshBasicMaterial color="#34d399" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
        <circleGeometry args={[2.1, 72]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {empty && (
        <PlazaSign position={[0, 1.7, 0]}>
          {connection === 'open' ? (
            <>
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">The village is empty</div>
              <div className="text-[12px] text-white/70">Summon a Claude Code session as an agent, or observe one read-only.</div>
              <button
                type="button"
                className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-3 py-1.5 text-[12px] font-bold text-emerald-100 hover:bg-emerald-400/30"
                onClick={(event) => { stopDomEvent(event); openVillagePicker(true) }}
              >
                Summon an agent
              </button>
            </>
          ) : (
            <>
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-200">Agent engine offline</div>
              <div className="text-[12px] text-white/70">Start it next to the Oasis: <code className="rounded bg-white/10 px-1">pnpm dev:engine</code></div>
            </>
          )}
        </PlazaSign>
      )}
    </group>
  )
}

// ─── camera rig ─────────────────────────────────────────────────────────────

/** Frames the focused agent next to the 2D session panel while the village owns agent-focus. */
function VillageCameraRig() {
  const camera = useThree(s => s.camera)
  const size = useThree(s => s.size)
  const flight = useRef<{ agentId: string; from: THREE.Vector3; fromQuat: THREE.Quaternion; startedAt: number } | null>(null)
  const goal = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), quaternion: new THREE.Quaternion(), matrix: new THREE.Matrix4() }), [])

  useEffect(() => {
    registerVillageCamera(camera)
    return () => registerVillageCamera(null)
  }, [camera])

  useFrame(({ camera: cam, clock }) => {
    const store = useOasisStore.getState()
    const agentId = store.agentEngine.focusedAgentId
    const inputState = useInputManager.getState().inputState
    if (!agentId || !isFocusInputState(inputState) || store.focusedAgentWindowId || store.focusedImageId) {
      flight.current = null
      return
    }
    const station = getVillageStation(agentId)
    if (!station) return
    const perspective = cam as THREE.PerspectiveCamera
    const panel = getSessionPanelGeometry(size.width, size.height)
    const pose = computeFocusPose({
      anchor: station.anchor,
      rotationY: station.rotationY,
      fov: perspective.fov || 50,
      aspect: size.width / Math.max(1, size.height),
      panel: panel.side,
      panelFraction: panel.fraction,
    })
    goal.position.set(...pose.position)
    goal.target.set(...pose.target)
    goal.matrix.lookAt(goal.position, goal.target, cam.up)
    goal.quaternion.setFromRotationMatrix(goal.matrix)
    if (!flight.current || flight.current.agentId !== agentId) {
      flight.current = { agentId, from: cam.position.clone(), fromQuat: cam.quaternion.clone(), startedAt: clock.getElapsedTime() }
    }
    const t = Math.min(1, (clock.getElapsedTime() - flight.current.startedAt) / 0.9)
    const ease = 1 - Math.pow(1 - t, 3)
    cam.position.lerpVectors(flight.current.from, goal.position, ease)
    cam.quaternion.slerpQuaternions(flight.current.fromQuat, goal.quaternion, ease)
  })

  return null
}

// ─── the layer ──────────────────────────────────────────────────────────────

export function VillageWorld() {
  // Re-render the layout only when the roster's identity changes, not on every event.
  const rosterKey = useOasisStore(s => s.agentEngine.order
    .map(id => {
      const agent = s.agentEngine.agents[id]
      return agent ? `${id}\u0001${agent.name}` : ''
    })
    .filter(Boolean)
    .join('\u0002'))
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const playerBody = useOasisStore(s => s.avatar3dUrl)
  const worldBodiesKey = useOasisStore(s => s.placedAgentAvatars.map(avatar => avatar.avatar3dUrl || '').join('|'))
  const pool = useBodyPool()
  const origin = useVillageOrigin()

  const roster = useMemo(() => (rosterKey ? rosterKey.split('\u0002').map(item => {
    const [id, name] = item.split('\u0001')
    return { id, name }
  }) : []), [rosterKey])

  const avatars = useMemo(() => {
    const exclude = [playerBody || '', ...worldBodiesKey.split('|')]
      .filter((path): path is string => Boolean(path))
      .map(path => path.replace(/[?#].*$/, ''))
    return assignVillageAvatars(roster, pool, exclude)
  }, [roster, pool, playerBody, worldBodiesKey])

  const placements = useMemo(() => {
    const layout = layoutVillageStations(roster.length, { origin })
    const map = new Map<string, VillageStationPlacement>()
    roster.forEach((agent, index) => {
      const slot = layout[index]
      const ground = sampleTerrainHeightAt(terrainHeights, slot.position[0], slot.position[2])
      const station = { position: [slot.position[0], ground, slot.position[2]] as Vec3, rotationY: slot.rotationY }
      const anchor = stationLocalToWorld(station, STATION.avatar)
      map.set(agent.id, { ...station, anchor })
    })
    return map
  }, [roster, terrainHeights, origin])

  useLayoutEffect(() => {
    setVillageStations(placements)
  }, [placements])

  useEffect(() => () => setVillageStations(new Map()), [])

  const visibleWindows = useVisibleDeskWindows(placements)
  const mobile = useIsMobileOasis()
  const overlayZ = mobile ? OVERLAY_Z_MOBILE : OVERLAY_Z

  return (
    <group name="oasis-village">
      <VillagePlaza empty={roster.length === 0} origin={origin} />
      {roster.map(agent => {
        const placement = placements.get(agent.id)
        if (!placement) return null
        return (
          <VillageStation
            key={agent.id}
            agentId={agent.id}
            placement={placement}
            avatarUrl={avatars[agent.id]}
            windowVisible={visibleWindows.has(agent.id)}
            overlayZ={overlayZ}
          />
        )
      })}
      <VillageCameraRig />
    </group>
  )
}

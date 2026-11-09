'use client'

// ░▒▓ VILLAGE WORLD — engine agents as characters at desks around the spawn point ▓▒░
// Mounted inside the R3F <Canvas> when the village profile is on. Nothing here is saved to the
// world: the roster comes from the agent engine, positions from village-layout.ts.

import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager } from '../../lib/input-manager'
import { sampleTerrainHeightAt } from '../../lib/forge/terrain-brush'
import { AGENT_AVATAR_CATALOG } from '../../lib/agent-avatar-catalog'
import {
  STATION,
  assignVillageAvatars,
  assignVillageSeats,
  DESK_WINDOW_PX,
  DESK_WINDOW_TILT,
  computeFocusPose,
  computeScreenPose,
  deskWindowDistanceFactor,
  plazaCenter,
  rememberVillageAgents,
  resolveVillageOrigin,
  stationLocalToWorld,
  villageSeatStation,
  type Vec3,
  type VillageOrigin,
  type VillageRosterAgent,
} from '../../lib/village/village-layout'
import { getVillageMemory, getVillageMemoryVersion, saveVillageMemory, subscribeVillageMemory } from '../../lib/village/village-memory'
import { VRMCatalogRenderer } from '../forge/WorldObjects'
import { useIsMobileOasis } from '../forge/MobileOasisControls'
import { effectiveStatus } from '../../store/slices/agentEngineSlice'
import { AgentSessionView, SessionWindowHeader } from './AgentSessionView'
import { VillageComposer } from './VillageComposer'
import { GAME_HUD_TEXT, GameKeycap } from '../forge/GameKeycap'
import {
  focusVillageAgent,
  getSessionPanelGeometry,
  getVillageScreen,
  subscribeVillageScreen,
  getVillageStation,
  isFocusInputState,
  isVillageFocusBlocked,
  openVillagePicker,
  registerVillageCamera,
  setVillagePlaza,
  setVillageStations,
  type VillageStationPlacement,
} from './village-actions'
import { VILLAGE_OBSERVED_COLOR, agentDisplayName, statusColor, villageAgentLook } from './village-status'
import { VillageSubagentMinis } from './VillageSubagentMinis'

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
function useLabelInfo(agentId: string): { name: string; status: string; label: string; readOnly: boolean; unseen: boolean } | null {
  const key = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    if (!agent) return ''
    // Helpers: violet "helpers working (3)" once its own turn is over, "×3" next to its status while it works too.
    const look = villageAgentLook(agent)
    const helpers = look.helpers && look.status !== 'helpers' ? ` ×${look.helpers}` : ''
    const label = agent.readOnly ? (look.status === 'helpers' ? `observing · ${look.label}` : `observing${helpers}`) : `${look.label}${helpers}`
    return [agentDisplayName(agent), look.status, label, agent.readOnly ? '1' : '', agent.unseen ? '1' : ''].join('\u0001')
  })
  return useMemo(() => {
    if (!key) return null
    const [name, status, label, readOnly, unseen] = key.split('\u0001')
    return { name, status, label, readOnly: readOnly === '1', unseen: unseen === '1' }
  }, [key])
}

/** The sign over an agent that wants you: amber needs a decision, blue finished work, red stuck. */
const ATTENTION_SIGN: Record<string, string> = { 'needs-decision': '!', waiting: '✓', error: '!' }

function StationLabel({ agentId, nearby }: { agentId: string; nearby: boolean }) {
  const info = useLabelInfo(agentId)
  if (!info) return null
  const color = statusColor(info.status)
  const sign = info.status === 'waiting' && !info.unseen ? null : ATTENTION_SIGN[info.status]
  return (
    <div className="pointer-events-none flex select-none flex-col items-center gap-1" style={{ transform: 'translateY(-50%)' }}>
      {sign && (
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-[15px] font-black"
          style={{ background: color, color: info.status === 'needs-decision' ? '#000' : '#fff', boxShadow: `0 0 18px ${color}cc`, animation: 'villageBob 1.1s ease-in-out infinite' }}
        >
          {sign}
        </div>
      )}
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-slate-950/80 px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_6px_18px_rgba(0,0,0,0.45)] backdrop-blur" style={{ borderColor: `${color}aa` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="max-w-[160px] truncate">{info.name}</span>
        <span className="font-normal text-white/55">{info.label}</span>
      </div>
      {nearby && (
        <div className="flex items-center gap-2 whitespace-nowrap rounded-md bg-black/55 px-2 py-1 text-[10px]" style={GAME_HUD_TEXT}>
          <span className="flex items-center gap-1"><GameKeycap accent="#34d399">T</GameKeycap>talk</span>
          <span className="flex items-center gap-1"><GameKeycap accent="#38bdf8">E</GameKeycap>write</span>
          <span className="flex items-center gap-1"><GameKeycap accent="#c084fc">F</GameKeycap>full</span>
        </div>
      )}
      <style>{'@keyframes villageBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }'}</style>
    </div>
  )
}

/**
 * The glass screen above an agent's desk, the same kind of see-through HTML-in-3D as Anorak Pro's
 * windows. "desk": the recent conversation, readable as you walk by. "screen" (F while talking to the
 * agent): the camera fills the view with it, and the whole conversation and the text box live on it.
 */
function DeskWindow({ agentId, nearby, mode }: { agentId: string; nearby: boolean; mode: 'desk' | 'screen' }) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  if (!agent) return null
  const color = agent.readOnly ? VILLAGE_OBSERVED_COLOR : statusColor(effectiveStatus(agent))
  const size = DESK_WINDOW_PX[mode]
  const screen = mode === 'screen'
  return (
    <div
      data-ui-panel="village-desk-window"
      className="relative flex flex-col overflow-hidden rounded-2xl text-white"
      style={{
        width: size.width,
        height: size.height,
        padding: screen ? 18 : 14,
        // See-through at the desk; nearly solid when it fills the view, so a bright world behind can't drown the text.
        background: screen
          ? 'linear-gradient(160deg, rgba(8,13,26,0.9) 0%, rgba(3,6,14,0.94) 100%)'
          : 'linear-gradient(160deg, rgba(10,16,30,0.72) 0%, rgba(4,8,18,0.84) 100%)',
        border: `1px solid ${color}aa`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 46px ${color}38, 0 0 120px rgba(0,0,0,0.35)`,
        backdropFilter: 'blur(8px)',
      }}
      onPointerDown={stopDomEvent}
      onPointerUp={stopDomEvent}
      onWheel={stopDomEvent}
      onDoubleClick={stopDomEvent}
      onClick={(event) => {
        stopDomEvent(event)
        if (screen) return
        const target = event.target as HTMLElement
        if (target.closest('button, input, textarea, select, a')) return
        focusVillageAgent(agentId)
      }}
    >
      {/* the status color as a thin light along the top edge */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <AgentSessionView
          agentId={agentId}
          variant={screen ? 'screen' : '3d'}
          header={<SessionWindowHeader agent={agent} nearby={nearby} screen={screen} />}
        />
      </div>
      {screen && (agent.owned || agent.bridged
        ? <VillageComposer key={agentId} agentId={agentId} large />
        : <div className="shrink-0 border-t border-white/10 pt-2 text-[12px] text-cyan-100/90">Watching only: this session runs somewhere else. Press F to go back, then &ldquo;Move it here&rdquo; to talk to it.</div>)}
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
  // 'helpers' (violet) when only its subagents still work.
  const status = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    return agent ? villageAgentLook(agent).status : 'idle'
  })
  const kind = useOasisStore(s => s.agentEngine.agents[agentId]?.kind || 'owned')
  const name = useOasisStore(s => s.agentEngine.agents[agentId]?.name || agentId)
  const focused = useOasisStore(s => s.agentEngine.focusedAgentId === agentId)
  const nearby = useOasisStore(s => s.agentEngine.nearbyAgentId === agentId)
  const onScreen = useSyncExternalStore(subscribeVillageScreen, () => getVillageScreen() === agentId, () => false)
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
      {/* Its helpers (subagents): half-size copies of it, in a semicircle behind it. */}
      <VillageSubagentMinis agentId={agentId} placement={placement} avatarUrl={avatarUrl} labelsVisible={windowVisible} overlayZ={overlayZ} />
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
      {/* Talking to this agent: the side panel replaces the desk window, unless F put you on its screen. */}
      {(focused ? onScreen : windowVisible) && (
        <Html
          key={onScreen ? 'screen' : 'desk'}
          transform
          position={STATION.window}
          rotation-x={onScreen ? 0 : DESK_WINDOW_TILT}
          distanceFactor={deskWindowDistanceFactor(onScreen ? 'screen' : 'desk')}
          zIndexRange={overlayZ}
          style={{ pointerEvents: 'auto' }}
        >
          <DeskWindow agentId={agentId} nearby={nearby && !focused} mode={onScreen ? 'screen' : 'desk'} />
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

/**
 * Fixed per world, never where the camera happened to look at load, so desks stay put across reloads.
 * Worlds don't carry their own `village` spot yet (see resolveVillageOrigin): every world uses the spawn.
 */
function useVillageOrigin(): VillageOrigin {
  return useMemo(() => resolveVillageOrigin(null), [])
}

function VillagePlaza({ empty, origin }: { empty: boolean; origin: VillageOrigin }) {
  const connection = useOasisStore(s => s.agentEngine.connection.status)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const center = plazaCenter({ origin })
  const y = sampleTerrainHeightAt(terrainHeights, center.x, center.z)
  useEffect(() => {
    setVillagePlaza([center.x, y, center.z])
    return () => setVillagePlaza(null)
  }, [center.x, center.z, y])
  return (
    <group position={[center.x, y, center.z]}>
      {/* A few cm up: worlds lay floor mosaics here (Oasis Dusk's tops out at 3.5 cm). */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.052, 0]}>
        <ringGeometry args={[2.1, 2.22, 72]} />
        <meshBasicMaterial color="#34d399" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.048, 0]}>
        <circleGeometry args={[2.1, 72]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {empty && (
        <PlazaSign position={[0, 1.7, 0]}>
          {connection === 'open' ? (
            <>
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">The village is empty</div>
              <div className="text-[12px] text-white/70">Summon a Claude Code session as an agent, or observe one read-only.</div>
              <div className="text-[11px] text-white/50">Stand in the circle and press <span className="rounded bg-white/20 px-1 font-mono font-bold text-white">E</span>, or click:</div>
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
  const flight = useRef<{ key: string; from: THREE.Vector3; fromQuat: THREE.Quaternion; startedAt: number } | null>(null)
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
    const onScreen = getVillageScreen() === agentId
    const aspect = size.width / Math.max(1, size.height)
    const panel = getSessionPanelGeometry(size.width, size.height)
    const pose = onScreen
      ? computeScreenPose({ center: stationLocalToWorld(station, STATION.window), rotationY: station.rotationY, fov: perspective.fov || 50, aspect })
      : computeFocusPose({
        anchor: station.anchor,
        rotationY: station.rotationY,
        fov: perspective.fov || 50,
        aspect,
        panel: panel.side,
        panelFraction: panel.fraction,
      })
    goal.position.set(...pose.position)
    goal.target.set(...pose.target)
    goal.matrix.lookAt(goal.position, goal.target, cam.up)
    goal.quaternion.setFromRotationMatrix(goal.matrix)
    const key = `${agentId}:${onScreen ? 'screen' : 'panel'}`
    if (!flight.current || flight.current.key !== key) {
      flight.current = { key, from: cam.position.clone(), fromQuat: cam.quaternion.clone(), startedAt: clock.getElapsedTime() }
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
      return agent ? `${id}\u0001${agent.name}\u0001${agent.sessionId || ''}` : ''
    })
    .filter(Boolean)
    .join('\u0002'))
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const playerBody = useOasisStore(s => s.avatar3dUrl)
  const worldBodiesKey = useOasisStore(s => s.placedAgentAvatars.map(avatar => avatar.avatar3dUrl || '').join('|'))
  const pool = useBodyPool()
  const origin = useVillageOrigin()

  const roster = useMemo<VillageRosterAgent[]>(() => (rosterKey ? rosterKey.split('\u0002').map(item => {
    const [id, name, sessionId] = item.split('\u0001')
    return { id, name, sessionId: sessionId || null }
  }) : []), [rosterKey])

  // Desks and bodies are remembered per session (village-memory.ts): a reload, a newcomer or a world
  // switch moves and re-dresses nobody. A body picked in the agent panel bumps memoryVersion.
  const memoryVersion = useSyncExternalStore(subscribeVillageMemory, getVillageMemoryVersion, () => 0)
  const village = useMemo(() => {
    const exclude = [playerBody || '', ...worldBodiesKey.split('|')]
      .filter((path): path is string => Boolean(path))
      .map(path => path.replace(/[?#].*$/, ''))
    const now = Date.now()
    const seen = rememberVillageAgents(roster, getVillageMemory(), now)
    const seated = assignVillageSeats(roster, seen, now)
    const dressed = assignVillageAvatars(roster, pool, exclude, seated.memory, now)
    return { seats: seated.seats, avatars: dressed.avatars, memory: dressed.memory }
  }, [roster, pool, playerBody, worldBodiesKey, memoryVersion])
  useEffect(() => {
    saveVillageMemory(village.memory)
  }, [village])
  const avatars = village.avatars
  const seatsKey = roster.map(agent => `${agent.id}:${village.seats[agent.id] ?? 0}`).join('|')

  const placements = useMemo(() => {
    const map = new Map<string, VillageStationPlacement>()
    for (const entry of seatsKey ? seatsKey.split('|') : []) {
      const split = entry.lastIndexOf(':')
      const slot = villageSeatStation(Number(entry.slice(split + 1)), { origin })
      const ground = sampleTerrainHeightAt(terrainHeights, slot.position[0], slot.position[2])
      const station = { position: [slot.position[0], ground, slot.position[2]] as Vec3, rotationY: slot.rotationY }
      const anchor = stationLocalToWorld(station, STATION.avatar)
      map.set(entry.slice(0, split), { ...station, anchor })
    }
    return map
  }, [seatsKey, terrainHeights, origin])

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

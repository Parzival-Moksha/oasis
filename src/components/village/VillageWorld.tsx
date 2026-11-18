'use client'

// ░▒▓ VILLAGE WORLD — engine agents as characters at desks around the spawn point ▓▒░
// Mounted inside the R3F <Canvas> when the village profile is on. Nothing here is saved to the
// world: the roster comes from the agent engine, positions from village-layout.ts.

import { Component, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
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
  faceScreenLayout,
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
import { attentionRank, effectiveStatus } from '../../store/slices/agentEngineSlice'
import { AgentSessionView, SessionWindowHeader } from './AgentSessionView'
import { VillageComposer } from './VillageComposer'
import { GAME_HUD_TEXT, GameKeycap } from '../forge/GameKeycap'
import { VillageCorpseDrop, VillageHpBar, useVillageCombatPose } from './VillageCombatHud'
import { VillageGore } from './VillageGore'
import { usePanelLook } from './PanelLook'
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
  setVillageLiveStation,
  setVillagePlaza,
  getVillageAnchors,
  setVillageStations,
  clearVillageStations,
  setVillageAvatars,
  type VillageStationPlacement,
} from './village-actions'
import { VILLAGE_OBSERVED_COLOR, agentDisplayName, statusColor, villageAgentLook } from './village-status'
import { VillageSubagentMinis } from './VillageSubagentMinis'
import { VillageShow } from './VillageShow'
import { VillageEyes } from './VillageEyes'
import { VillagePresence } from './VillagePresence'
import { VillageMissionWall } from './VillageMissionWall'
import { VillageAcademyTree } from './VillageAcademyTree'
import { AcademyLevelTag, AcademyVillageBody, useAcademyStone, useAcademyTrainee } from './VillageAcademyTrainee'
import { VillageVoice } from './VillageVoice'
import { VillageTag, VillageTagDriver } from './VillageTags'
import { isStageWorldName, stationAtAnchor } from '../../lib/village/village-stage'
import { readableAccent, tagMarker } from '../../lib/village/village-tags'
import { getAgentAccent, getPanelLookVersion, subscribePanelLook } from '../../lib/village/panel-look'
import { getVillageCombatVersion, getVillageVitals, subscribeVillageCombat } from '../../lib/village/village-combat'
import { useFrameWhen } from '../../lib/use-frame-when'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { SPACE, createFollowState, pickVisitSpot, stepApart, stepFollow, stepStage, stepVisit, type FollowState, type FollowTarget, type VisitSpot } from '../../lib/village/village-follow'
import { COUNCIL } from '../../lib/village/village-council'
import { getCouncilGoal, getCouncilVersion, getStageCast, isCouncilMember, isCouncilOn, reportCouncilSettled, subscribeCouncil } from './village-council'
import { clickVillageAgent, getSentGoal, getSentGoalSeq, subscribeAgentSelection } from '@/lib/village/agent-selection'
import {
  getVillageFaceHeight,
  getVillageFollowVersion,
  getVillageSpeech,
  isVillageComeOn,
  isVillageFollowOn,
  measureVillageFace,
  otherVillageAwaySpots,
  registerVillageHead,
  setVillageArrived,
  setVillageAwaySpot,
  subscribeVillageFollow,
  subscribeVillageSpeech,
  villageLipSyncId,
} from './village-companion'
import { SettingsContext } from '../scene-lib/contexts'
import { DESK_SCREENS_DEFAULT, DESK_SCREEN_LIMIT, isDeskScreensMode, pickDeskScreens, type DeskDistance } from '../../lib/village/desk-screens'

const WORK_ANIMATION_ID = 'ual-talking'
/** Helper labels show for the agents near the camera (the rule desk screens had before the setting). */
const NEAR_AGENTS_MAX = 6
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

/**
 * What is left of the HTML label: the HP bar (once the agent was shot) and a trainee's level. The name, the
 * status word and the marker are 3D now (VillageTags.tsx), and the T / E / F keys are in the banner below.
 */
function StationExtras({ agentId }: { agentId: string }) {
  return (
    <div className="pointer-events-none flex select-none flex-col items-center gap-1" style={{ transform: 'translateY(-50%)' }}>
      <VillageHpBar agentId={agentId} />
      <AcademyLevelTag agentId={agentId} />
    </div>
  )
}

/** True while the HTML extras have something to show: the agent was shot, or it trains at the Academy. */
function useStationExtras(agentId: string): boolean {
  useSyncExternalStore(subscribeVillageCombat, getVillageCombatVersion, () => 0)
  const trainee = useAcademyTrainee(agentId)
  return getVillageVitals(agentId).lastHitAt !== null || Boolean(trainee?.training)
}

/** Over the head, in the picture itself: the name in the agent's own colour, its status word, "!" or "?". */
function StationTag({ agentId, colorKey, avatarKey }: { agentId: string; colorKey: string; avatarKey: string }) {
  const info = useLabelInfo(agentId)
  useSyncExternalStore(subscribePanelLook, getPanelLookVersion, () => 0)
  if (!info) return null
  return (
    <VillageTag
      agentId={agentId}
      name={info.name}
      color={readableAccent(getAgentAccent(colorKey))}
      rim={getAgentAccent(colorKey)}
      status={info.label}
      statusColor={info.readOnly ? VILLAGE_OBSERVED_COLOR : statusColor(info.status)}
      marker={tagMarker(info.status, info.unseen)}
      avatarKey={avatarKey}
      x={STATION.avatar[0]}
      z={STATION.avatar[2]}
    />
  )
}

/**
 * The glass screen above an agent's desk, the same kind of see-through HTML-in-3D as Anorak Pro's
 * windows. "desk": the recent conversation, readable as you walk by. "screen" (F while talking to the
 * agent): the camera fills the view with it, and the whole conversation and the text box live on it.
 */
function DeskWindow({ agentId, nearby, mode }: { agentId: string; nearby: boolean; mode: 'desk' | 'screen' }) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  // The full screen (F) follows the chat look: transparency + blur for all, this agent's colour (PanelLook.tsx).
  const look = usePanelLook(agent?.sessionId || agentId)
  if (!agent) return null
  const color = agent.readOnly ? VILLAGE_OBSERVED_COLOR : statusColor(effectiveStatus(agent))
  const size = DESK_WINDOW_PX[mode]
  const screen = mode === 'screen'
  return (
    <div
      data-ui-panel="village-desk-window"
      data-desk-mode={mode}
      className="relative flex flex-col overflow-hidden rounded-2xl text-white"
      style={{
        width: size.width,
        height: size.height,
        padding: screen ? 18 : 14,
        // See-through at the desk; nearly solid when it fills the view, so a bright world behind can't drown the text.
        background: screen
          ? look.background
          : 'linear-gradient(160deg, rgba(10,16,30,0.72) 0%, rgba(4,8,18,0.84) 100%)',
        border: `1px solid ${color}aa`,
        boxShadow: `inset 0 3px 0 ${look.accent}, 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 46px ${color}38, 0 0 120px rgba(0,0,0,0.35)`,
        backdropFilter: screen ? look.backdropFilter : 'blur(8px)',
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

/**
 * Where everyone else is, for an agent choosing where to stand: the spots the other walking agents hold or are
 * headed for, where every other agent stands right now (at its desk or away), and the owner.
 */
function otherAvatars(agentId: string, owner: VisitSpot | null): VisitSpot[] {
  const out = otherVillageAwaySpots(agentId)
  const anchors = getVillageAnchors()
  for (const id in anchors) if (id !== agentId) out.push({ x: anchors[id][0], z: anchors[id][2] })
  if (owner) out.push({ x: owner.x, z: owner.z })
  return out
}

/** How every agent that is away from its desk moves right now (useVillageFollower keeps it). */
const followStates = new Map<string, FollowState>()

/**
 * Who an agent that stands has to keep its distance from: everyone else who stands (at a desk or away), and the
 * owner. Not the ones walking: they pass, and whoever stands should not jump aside for a passer-by.
 */
function standingAvatars(agentId: string, owner: VisitSpot | null): VisitSpot[] {
  const out: VisitSpot[] = []
  const anchors = getVillageAnchors()
  for (const id in anchors) {
    if (id === agentId) continue
    const moving = followStates.get(id)
    if (moving && moving.mode !== 'home' && moving.act !== 'stand') continue
    out.push({ x: anchors[id][0], z: anchors[id][2] })
  }
  if (owner) out.push({ x: owner.x, z: owner.z })
  return out
}

function agentSeed(agentId: string): number {
  let sum = 0
  for (let i = 0; i < agentId.length; i += 1) sum += agentId.charCodeAt(i)
  return sum
}

/** Where the avatar's voice comes from, above the ground it stands on. */
const HEAD_HEIGHT = 1.5
/** The HP bar and the trainee's level (HTML, shown only when there is one): over the 3D tag and its marker. */
const EXTRAS_AT: [number, number, number] = [STATION.label[0], 2.95, STATION.label[2]]

/**
 * The part of a station that can leave its desk: the body, its label, its helpers. `mover` is that group.
 * At home it sits exactly on the station. With "Follow me" on it walks beside the owner (village-follow.ts)
 * and its live place is published (setVillageLiveStation), so the T/E/F prompts, the camera for E and F,
 * the eyes picture and the helpers go with it. Off again, it walks back and sits down.
 * With "Come to me when you need me" it walks up to the owner when it needs them (`visiting`), takes a free
 * spot in front of them beside the others, and goes home when it is no longer needed; `hold` (the owner is
 * busy with another agent) keeps it a few metres back meanwhile.
 * In a Council (`staged`, village-council.ts) it stands where the scene puts it: its place on the circle, or in front.
 * Cost: one small callback per frame while it is away from its desk, none while it is home.
 */
function useVillageFollower(agentId: string, placement: VillageStationPlacement, wanted: boolean, visiting: boolean, frozen: boolean, hold: boolean, staged = false) {
  const mover = useRef<THREE.Group>(null)
  const home = useMemo(() => ({ x: placement.anchor[0], z: placement.anchor[2], yaw: placement.rotationY }), [placement])
  const state = useRef<FollowState | null>(null)
  if (!state.current) state.current = createFollowState(home)
  const live = useRef<VillageStationPlacement | null>(null)
  const target = useRef<FollowTarget>({ x: 0, z: 0, forwardX: 0, forwardZ: 1 })
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen
  const holdRef = useRef(hold)
  holdRef.current = hold
  /** Where it stands (following) or is headed (visiting), for the others' choice of spot. One object, changed in place. */
  const spot = useRef<VisitSpot>({ x: home.x, z: home.z })
  const pick = useRef((distance: number) => pickVisitSpot(target.current, distance, otherAvatars(agentId, null)))
  /** Stepping apart from an avatar it stands too close to (personal space, village-follow.ts stepApart). */
  const apart = useRef(false)
  const spaceTick = useRef(0)
  /** The Council mark it is headed for or stands on (CouncilGoal.seq), and whether it said it got there. */
  const stageSeq = useRef(-1)
  const stageSettled = useRef(false)
  const walkingRef = useRef(false)
  const [away, setAway] = useState(false)
  const [walking, setWalking] = useState(false)

  const sitAtDesk = () => {
    const group = mover.current
    if (!group) return
    group.position.set(placement.position[0], placement.position[1], placement.position[2])
    group.rotation.set(0, placement.rotationY, 0)
  }

  /** The mover and the published station, from where the avatar stands now. */
  const writePose = (follow: FollowState, resample: boolean) => {
    const group = mover.current
    const station = live.current
    if (!group || !station) return
    const y = resample ? sampleTerrainHeightAt(useOasisStore.getState().terrainHeights, follow.x, follow.z) : station.position[1]
    // A station whose avatar spot (STATION.avatar, behind its origin) is where the avatar stands.
    const ox = follow.x - STATION.avatar[2] * Math.sin(follow.yaw)
    const oz = follow.z - STATION.avatar[2] * Math.cos(follow.yaw)
    group.position.set(ox, y, oz)
    group.rotation.set(0, follow.yaw, 0)
    station.position[0] = ox
    station.position[1] = y
    station.position[2] = oz
    station.rotationY = follow.yaw
    station.anchor[0] = follow.x
    station.anchor[1] = y
    station.anchor[2] = follow.z
  }

  // The desk itself moved (another seat, the ground was sculpted) or the switch changed.
  useLayoutEffect(() => {
    const follow = state.current as FollowState
    if (follow.mode === 'home') {
      follow.x = home.x
      follow.z = home.z
      follow.yaw = home.yaw
    }
    const want = staged ? 'stage' : wanted ? 'follow' : visiting ? 'visit' : null
    if (want && follow.mode !== want) {
      follow.mode = want
      follow.act = 'stand'
      follow.hasGoal = false
      stageSeq.current = -1
    } else if (!want && (follow.mode === 'follow' || follow.mode === 'visit' || follow.mode === 'stage')) follow.mode = 'return'
    if (follow.mode !== 'visit') {
      // Not (or no longer) on a visit: it is not standing in front of the owner.
      setVillageArrived(agentId, false)
    }
    if (follow.mode === 'home') {
      live.current = null
      setVillageLiveStation(agentId, null)
      setVillageAwaySpot(agentId, null)
      sitAtDesk()
    } else {
      spot.current.x = follow.mode === 'visit' && follow.hasGoal ? follow.goalX : follow.x
      spot.current.z = follow.mode === 'visit' && follow.hasGoal ? follow.goalZ : follow.z
      setVillageAwaySpot(agentId, follow.mode === 'return' ? null : spot.current)
      if (!live.current) live.current = { position: [...placement.position], rotationY: placement.rotationY, anchor: [...placement.anchor] }
      // Every run, not only the first: an effect cleanup (unmount, StrictMode's second pass) takes it out of the registry.
      setVillageLiveStation(agentId, live.current)
      writePose(follow, true)
    }
    setAway(follow.mode !== 'home')
    // Out of the registry on every cleanup (unmount, a hot reload); the next run puts it back.
    return () => {
      setVillageLiveStation(agentId, null)
      setVillageAwaySpot(agentId, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, placement, home, wanted, visiting, staged])

  useEffect(() => () => setVillageArrived(agentId, false), [agentId])

  useEffect(() => {
    followStates.set(agentId, state.current as FollowState)
    return () => { followStates.delete(agentId) }
  }, [agentId])

  // Dev: window.__oasisVillageFollow[agentId] is this agent's movement state (tests and debugging read it).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const all = ((window as unknown as { __oasisVillageFollow?: Record<string, unknown> }).__oasisVillageFollow ||= {})
    all[agentId] = { state: state.current, frozen: frozenRef, hold: holdRef }
    return () => { delete all[agentId] }
  }, [agentId])

  useFrameWhen(away, (_, delta) => {
    const follow = state.current as FollowState
    const pose = getPlayerAvatarPose()
    const to = target.current
    if (pose) {
      to.x = pose.position[0]
      to.z = pose.position[2]
      to.forwardX = pose.forward[0]
      to.forwardZ = pose.forward[2]
    }
    let result
    if (follow.mode === 'stage') {
      // A Council mark, or the spot the owner sent it to with a right-click (agent-selection.ts).
      const goal = getCouncilGoal(agentId) ?? getSentGoal(agentId)
      if (goal && goal.seq !== stageSeq.current) {
        stageSeq.current = goal.seq
        stageSettled.current = false
        follow.goalX = goal.x
        follow.goalZ = goal.z
        follow.hasGoal = true
      }
      const stage = stepStage(follow, delta, frozenRef.current, goal?.calm ? COUNCIL.walkSpeed : 0, goal ? goal.faceX : follow.x, goal ? goal.faceZ : follow.z)
      if (goal && stage.settled && !stageSettled.current) {
        stageSettled.current = true
        reportCouncilSettled(agentId, goal.seq)
      }
      result = stage
    } else if (follow.mode === 'visit') {
      const visit = stepVisit(follow, pose ? to : null, delta, frozenRef.current, holdRef.current, pick.current)
      if (visit.picked) {
        spot.current.x = follow.goalX
        spot.current.z = follow.goalZ
        // Setting off again (the owner walked on, or got busy): it is not in front of them any more.
        if (follow.act === 'walk') setVillageArrived(agentId, false)
      }
      // In front of the owner: it waits there in silence; its line plays when they open it (VillageVoice.tsx).
      if (visit.arrived) setVillageArrived(agentId, true)
      result = visit
    } else {
      result = stepFollow(follow, pose ? to : null, home, delta, frozenRef.current)
      if (result.moved && follow.mode === 'follow') {
        spot.current.x = follow.x
        spot.current.z = follow.z
      }
    }
    // Personal space: standing, it never shares a spot with another avatar (an agent at its desk, one that
    // was sent or came here too, the owner). Looked at four times a second; every frame while it steps apart.
    let stepped = false
    if (follow.act === 'stand' && follow.mode !== 'home' && follow.mode !== 'return' && !frozenRef.current && !getCouncilGoal(agentId)) {
      spaceTick.current += delta
      if (apart.current || spaceTick.current >= 0.25) {
        spaceTick.current = 0
        const away = stepApart(follow, standingAvatars(agentId, pose ? to : null), apart.current, agentSeed(agentId))
        apart.current = away !== null
        if (away) {
          const reach = SPACE.speed * Math.min(delta, 0.1)
          follow.x += away.x * reach
          follow.z += away.z * reach
          // Where it ends up is where it stays: its mark moves with it.
          follow.goalX = follow.x
          follow.goalZ = follow.z
          spot.current.x = follow.x
          spot.current.z = follow.z
          stepped = true
        }
      }
    } else if (apart.current) apart.current = false
    if (result.moved || result.turned || stepped) writePose(follow, result.moved || stepped)
    const nowWalking = follow.act !== 'stand' || stepped
    if (nowWalking !== walkingRef.current) {
      walkingRef.current = nowWalking
      setWalking(nowWalking)
    }
    if (result.arrivedHome) {
      live.current = null
      setVillageLiveStation(agentId, null)
      setVillageAwaySpot(agentId, null)
      sitAtDesk()
      setAway(false)
    }
  })

  return { mover, away, walking }
}

function VillageStation({ agentId, placement, avatarUrl, windowVisible, helperLabelsVisible, overlayZ, bare = false }: {
  /** On a stage (the Council's world): the agent alone, no desk, no screen, no helpers. */
  bare?: boolean
  agentId: string
  placement: VillageStationPlacement
  avatarUrl: string
  /** Its desk screen shows (the "Desk screens" setting). */
  windowVisible: boolean
  /** It is among the agents near the camera: its helpers show their labels. */
  helperLabelsVisible: boolean
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
  // F: the camera sits at this avatar's eye height with its face in the left quarter of the view; its screen
  // takes the rest, further back (village-layout.ts faceScreenLayout). Measured from its skeleton when F opens.
  const viewSize = useThree(s => s.size)
  // The field of view is read when F opens: it is a setting changed on the camera itself, which no selector sees.
  const getThree = useThree(s => s.get)
  const screenLayout = useMemo(
    () => (onScreen ? faceScreenLayout({ faceHeight: measureVillageFace(agentId), fov: (getThree().camera as THREE.PerspectiveCamera).fov || 50, aspect: viewSize.width / Math.max(1, viewSize.height) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onScreen, agentId, avatarUrl, viewSize.width, viewSize.height],
  )
  // Shot by the player's bolts (village-combat.ts, cosmetic): flinch, or the knockout clip.
  const combatPose = useVillageCombatPose(agentId)
  // While placing or painting, the desk must not swallow the clicks meant for the ground plane.
  const blocked = useInputManager(s => isVillageFocusBlocked(s.inputState))
  const color = statusColor(status)
  const extras = useStationExtras(agentId)
  const observed = kind !== 'owned'
  // "Follow me" (the agent panel's switch, remembered per session; on by default for Anorak).
  const followKey = useOasisStore(s => s.agentEngine.agents[agentId]?.sessionId || agentId)
  useSyncExternalStore(subscribeVillageFollow, getVillageFollowVersion, () => 0)
  // It stays put while you talk to it (the camera frames it) and while it is hit or knocked out.
  // A trainee that is still stone (the Academy) stands at its desk whatever the switch says.
  const stone = useAcademyStone(agentId)
  // "Come to me when you need me" (its settings menu, on for every agent): it walks up when it needs the owner
  // (a decision, finished work, stuck) and goes home once they answered, or opened its panel and closed it again.
  const needsSince = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    return agent && attentionRank(agent) !== null ? agent.attentionSince ?? 0 : null
  })
  const [heardFor, setHeardFor] = useState<number | null>(null)
  const wasFocused = useRef(false)
  useEffect(() => {
    if (wasFocused.current && !focused && needsSince !== null) setHeardFor(needsSince)
    wasFocused.current = focused
  }, [focused, needsSince])
  // In a Council (village-council.ts) a member stands where the scene puts it, and nobody walks up to the owner.
  useSyncExternalStore(subscribeCouncil, getCouncilVersion, () => 0)
  const staged = isCouncilMember(agentId) && !stone
  const visiting = isVillageComeOn(followKey) && needsSince !== null && needsSince !== heardFor && !stone && !isCouncilOn()
  // The owner is talking to another agent (its panel or its full screen): wait a few metres back, don't interrupt.
  const ownerBusy = useOasisStore(s => s.agentEngine.focusedAgentId !== null && s.agentEngine.focusedAgentId !== agentId)
  // Sent somewhere with a right-click while selected: it walks there and stays (an order beats "Follow me"),
  // until it is sent back to its desk. When it needs the owner it still comes, and goes back to that spot after.
  const sentSeq = useSyncExternalStore(subscribeAgentSelection, () => getSentGoalSeq(agentId), () => 0)
  const sent = sentSeq !== 0 && !staged && !visiting && !stone && !isCouncilOn()
  const follower = useVillageFollower(agentId, placement, isVillageFollowOn(followKey, name) && !stone, visiting, staged ? Boolean(combatPose) : focused || Boolean(combatPose), ownerBusy, staged || sent)
  // Its voice (village-companion.ts): the clip plays from its head, and it gestures while it talks.
  const speaking = useSyncExternalStore(subscribeVillageSpeech, () => {
    const speech = getVillageSpeech()
    return speech?.agentId === agentId && speech.phase === 'speaking'
  }, () => false)
  const head = useRef<THREE.Group>(null)
  useEffect(() => {
    registerVillageHead(agentId, head.current)
    return () => registerVillageHead(agentId, null)
  }, [agentId])

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    // After the canvas click has finished dismissing other panels.
    // The first click selects it (its selection effect shows, a right-click on the ground sends it there);
    // a click on the selected agent opens it.
    window.setTimeout(() => { if (clickVillageAgent(agentId)) focusVillageAgent(agentId) }, 0)
  }

  const hitHandlers = {
    raycast: blocked ? NO_RAYCAST : THREE.Mesh.prototype.raycast,
    onClick,
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      if (!useInputManager.getState().pointerLocked) event.nativeEvent.stopImmediatePropagation()
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      if (!useInputManager.getState().pointerLocked) document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => { document.body.style.cursor = '' },
  }

  return (
    <>
      {/* The desk: it and its screen stay where they are, also while the agent walks with you. */}
      {!bare && <group position={placement.position} rotation-y={placement.rotationY}>
        <VillageDesk color={color} working={status === 'working'} observed={observed} />
        {/* Click target enclosing the desk and the avatar's place at it (in front of the VRM's own proxy box). */}
        <mesh position={STATION.hitCenter} {...hitHandlers}>
          <boxGeometry args={STATION.hitSize} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} visible={false} />
        </mesh>
        {!focused && windowVisible && (
          <Html
            transform
            position={STATION.window}
            rotation-x={DESK_WINDOW_TILT}
            distanceFactor={deskWindowDistanceFactor('desk')}
            zIndexRange={overlayZ}
            style={{ pointerEvents: 'auto' }}
          >
            <DeskWindow agentId={agentId} nearby={nearby && !focused} mode="desk" />
          </Html>
        )}
      </group>}
      {/* The agent: on its station at home, beside you when it follows (useVillageFollower moves this group). */}
      <group ref={follower.mover}>
        {/* In the F view it turns to look into the camera (its face is left of where the camera looks). */}
        <group position={STATION.avatar} rotation-y={focused && onScreen && screenLayout ? screenLayout.faceTurn : 0}>
          <VillageCorpseDrop agentId={agentId}>
          <VillageBodyBoundary key={avatarUrl} color={color}>
            <Suspense fallback={<AvatarPlaceholder color={color} />}>
              {/* Own cache entry (#village): a world NPC on the same VRM keeps its own scene and mixer. */}
              <AcademyVillageBody
              agentId={agentId}
                path={`${avatarUrl}#village`}
                scale={1}
                displayName={name}
                // In the F view it stands still and looks at you while it talks (the gesturing clip turns the head away from the camera).
                activityAnimationId={combatPose ? combatPose.animationId : (status === 'working' || speaking) && !(focused && onScreen) ? WORK_ANIMATION_ID : null}
                activityOnce={Boolean(combatPose)}
                moving={follower.walking && !combatPose}
                lipSyncId={villageLipSyncId(agentId)}
              />
            </Suspense>
          </VillageBodyBoundary>
          </VillageCorpseDrop>
          <group ref={head} position={[0, HEAD_HEIGHT, 0]} />
        </group>
        {/* Its helpers (subagents): half-size copies of it, in a semicircle behind it. */}
        {!bare && <VillageSubagentMinis agentId={agentId} placement={placement} avatarUrl={avatarUrl} labelsVisible={helperLabelsVisible} overlayZ={overlayZ} />}
        {/* Away from the desk (or without one, on a stage), the body is its own click target. */}
        {(follower.away || bare) && (
          <mesh position={[STATION.avatar[0], 0.9, STATION.avatar[2]]} {...hitHandlers}>
            <boxGeometry args={[0.8, 1.8, 0.8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} visible={false} />
          </mesh>
        )}
        {/* Not in the F view: there its face fills the left of the picture, and the sign would sit on it. */}
        {!(focused && onScreen) && <StationTag agentId={agentId} colorKey={followKey} avatarKey={avatarUrl} />}
        {!(focused && onScreen) && extras && (
          <Html position={EXTRAS_AT} center distanceFactor={9} zIndexRange={overlayZ} style={{ pointerEvents: 'none' }}>
            <StationExtras agentId={agentId} />
          </Html>
        )}
        {/* F: its face on the left, its screen with the thread in the rest, where the agent is. (E: the side panel.) */}
        {focused && onScreen && (
          <Html
            transform
            position={screenLayout ? screenLayout.window : STATION.window}
            distanceFactor={deskWindowDistanceFactor('screen')}
            zIndexRange={overlayZ}
            style={{ pointerEvents: 'auto' }}
          >
            <DeskWindow agentId={agentId} nearby={false} mode="screen" />
          </Html>
        )}
      </group>
    </>
  )
}

/**
 * Live desk windows are full DOM trees under a CSS 3D transform: which ones show is the owner's
 * "Desk screens" setting (off / nearest / all, src/lib/village/desk-screens.ts), re-evaluated a few
 * times per second. `near`: the agents close to the camera, whose helpers show their labels.
 */
function useVisibleDeskWindows(placements: Map<string, VillageStationPlacement>): { windows: Set<string>; near: Set<string> } {
  const { settings } = useContext(SettingsContext)
  const mode = isDeskScreensMode(settings.villageDeskScreens) ? settings.villageDeskScreens : DESK_SCREENS_DEFAULT
  const [key, setKey] = useState('|')
  const frame = useRef(0)
  const keyRef = useRef('|')
  const modeRef = useRef(mode)
  const point = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    frame.current = (frame.current + 1) % 15
    // A changed setting applies on the next frame, not up to 15 frames later.
    if (frame.current !== 0 && modeRef.current === mode) return
    modeRef.current = mode
    const [windowsKey, nearKey] = keyRef.current.split('|')
    const desks: DeskDistance[] = []
    for (const [id, placement] of placements) {
      point.set(...stationLocalToWorld(placement, STATION.window))
      desks.push({ id, distance: camera.position.distanceTo(point) })
    }
    const windows = pickDeskScreens(desks, DESK_SCREEN_LIMIT[mode], new Set(windowsKey ? windowsKey.split(',') : []))
    const near = pickDeskScreens(desks, NEAR_AGENTS_MAX, new Set(nearKey ? nearKey.split(',') : []))
    const next = `${windows.join(',')}|${near.join(',')}`
    if (next !== keyRef.current) {
      keyRef.current = next
      setKey(next)
    }
  })
  return useMemo(() => {
    const [windowsKey, nearKey] = key.split('|')
    return { windows: new Set(windowsKey ? windowsKey.split(',') : []), near: new Set(nearKey ? nearKey.split(',') : []) }
  }, [key])
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
    // F: at the avatar's eye height, its face in the left quarter, its screen in the rest (faceScreenLayout).
    const screen = onScreen ? faceScreenLayout({ faceHeight: getVillageFaceHeight(agentId), fov: perspective.fov || 50, aspect }) : null
    const pose = screen
      ? { position: stationLocalToWorld(station, screen.camera), target: stationLocalToWorld(station, screen.target) }
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
  // A stage world ("The Council", lib/village/village-stage.ts): nobody but a Council's cast, and no desks,
  // plaza, mission wall, skill tree or helpers. The cast comes and goes with the Council (village-council.ts).
  const stage = useOasisStore(s => isStageWorldName(s.worldRegistry.find(world => world.id === (s.viewingWorldId || s.activeWorldId))?.name))
  useSyncExternalStore(subscribeCouncil, getCouncilVersion, () => 0)
  const castKey = stage ? [...getStageCast()].map(([id, at]) => `${id}\u0001${at.x.toFixed(2)}\u0001${at.z.toFixed(2)}\u0001${at.yaw.toFixed(4)}`).join('\u0002') : ''

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
    if (stage) {
      // Its place on the stage: out of the dark behind its spot on the circle, facing the fire.
      for (const entry of castKey ? castKey.split('\u0002') : []) {
        const [id, x, z, yaw] = entry.split('\u0001')
        const ground = sampleTerrainHeightAt(terrainHeights, Number(x), Number(z))
        map.set(id, stationAtAnchor([Number(x), ground, Number(z)], Number(yaw)))
      }
      return map
    }
    for (const entry of seatsKey ? seatsKey.split('|') : []) {
      const split = entry.lastIndexOf(':')
      const slot = villageSeatStation(Number(entry.slice(split + 1)), { origin })
      const ground = sampleTerrainHeightAt(terrainHeights, slot.position[0], slot.position[2])
      const station = { position: [slot.position[0], ground, slot.position[2]] as Vec3, rotationY: slot.rotationY }
      const anchor = stationLocalToWorld(station, STATION.avatar)
      map.set(entry.slice(0, split), { ...station, anchor })
    }
    return map
  }, [stage, castKey, seatsKey, terrainHeights, origin])

  // The desks, and out of the registry again when they change or the village goes. One effect for both: a
  // separate cleanup-only effect used to run after this one on a hot reload (React re-runs every effect then)
  // and left the registry empty, so no agent was "nearby" any more (no T/E/F prompt) until a full reload.
  useLayoutEffect(() => {
    setVillageStations(placements)
    return () => clearVillageStations(placements)
  }, [placements])
  // Who wears which body, for the report to the engine (VillagePresence).
  useLayoutEffect(() => {
    setVillageAvatars(avatars)
  }, [avatars])

  const visible = useVisibleDeskWindows(placements)
  const mobile = useIsMobileOasis()
  const overlayZ = mobile ? OVERLAY_Z_MOBILE : OVERLAY_Z

  return (
    <group name="oasis-village">
      {!stage && <VillagePlaza empty={roster.length === 0} origin={origin} />}
      {/* Blood when the player's bolts hit an agent (VillageGore, village-combat.ts). */}
      <VillageGore />
      {roster.map(agent => {
        const placement = placements.get(agent.id)
        if (!placement) return null
        return (
          <VillageStation
            key={agent.id}
            agentId={agent.id}
            placement={placement}
            avatarUrl={avatars[agent.id]}
            windowVisible={visible.windows.has(agent.id)}
            helperLabelsVisible={visible.near.has(agent.id)}
            overlayZ={overlayZ}
            bare={stage}
          />
        )
      })}
      {/* The owner's missions as framed panels behind Anorak's desk (VillageMissionWall). */}
      {!stage && <VillageMissionWall roster={roster} placements={placements} origin={origin} />}
      {/* The Academy's skill tree, across the plaza from the desks (VillageAcademyTree). */}
      {!stage && <VillageAcademyTree origin={origin} />}
      <VillageCameraRig />
      <VillageTagDriver />
      <VillageEyes />
      <VillagePresence />
      <VillageVoice />
      <VillageShow />
    </group>
  )
}

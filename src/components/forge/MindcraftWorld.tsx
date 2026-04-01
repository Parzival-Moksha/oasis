'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MINDCRAFT WORLD — The Living Mission Map
// ─═̷─═̷─ॐ─═̷─═̷─ 10 bands (9 maturity + done zone) × 2 halves ─═̷─═̷─ॐ─═̷─═̷─
//
// Features:
//   - 9 maturity bands + done zone at far end
//   - Anorak (left) / Carbon (right) halves with center divider
//   - 45° gallery layout with configurable spacing
//   - Flying Enemy curator with attack/shoot cycle during curation
//   - Magenta strobe light during active curation
//   - Orange spiral particles from curator → target mission
//   - Curation start/done sounds via audio manager
//   - MissionWindow bridged to DOM via Zustand
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { MissionCard3D, MATURITY_ACCENTS, type MissionData } from './MissionCard3D'
import { useOasisStore } from '../../store/oasisStore'
import { useAudioManager, type SoundEvent } from '../../lib/audio-manager'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS (exported for tests)
// ═══════════════════════════════════════════════════════════════════════════

export const MATURITY_BAND_COUNT = 9
export const DONE_BAND = 9  // virtual band for status='done'
export const TOTAL_BANDS = 10
export const WORLD_SIZE = 110  // 110m to fit 10 bands
export const BAND_DEPTH = WORLD_SIZE / TOTAL_BANDS  // 11m
export const WORLD_HALF = WORLD_SIZE / 2  // 55

const SPACING_KEY = 'oasis-mindcraft-spacing'
const DEFAULT_SPACING = 5

const BAND_GROUND_COLORS: Record<number, string> = {
  0: '#1a1a2e',  // Para
  1: '#16213e',  // Pashyanti
  2: '#0f3460',  // Madhyama
  3: '#1a1a3e',  // Vaikhari
  4: '#1e3a2e',  // Built
  5: '#2e2a1e',  // Reviewed
  6: '#1e2e3a',  // Tested
  7: '#2e1e2e',  // Gamertested
  8: '#2e2e1e',  // Carbontested
  9: '#1a2e1a',  // Done zone — dark green
}

const FLYING_ENEMY_PATH = '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Enemy_Flying.gltf'
const CURATOR_POLL_INTERVAL = 3000  // check curation status every 3s

export function bandZ(level: number): number {
  return -WORLD_HALF + (level * BAND_DEPTH) + BAND_DEPTH / 2
}

function wallZ(level: number): number {
  return -WORLD_HALF + (level * BAND_DEPTH)
}

function getSpacing(): number {
  if (typeof window === 'undefined') return DEFAULT_SPACING
  try { return JSON.parse(localStorage.getItem(SPACING_KEY) ?? String(DEFAULT_SPACING)) } catch { return DEFAULT_SPACING }
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION CALCULATOR — 45-degree gallery layout (exported for tests)
// ═══════════════════════════════════════════════════════════════════════════

export function computeMissionPositions(missions: MissionData[], spacing: number) {
  const bands: Map<number, MissionData[]> = new Map()
  for (let i = 0; i < TOTAL_BANDS; i++) bands.set(i, [])

  for (const m of missions) {
    // Done missions → band 9 regardless of maturity
    if (m.status === 'done') {
      bands.get(DONE_BAND)!.push(m)
    } else {
      const level = Math.min(Math.max(m.maturityLevel, 0), MATURITY_BAND_COUNT - 1)
      bands.get(level)!.push(m)
    }
  }

  // Sort within each band: queuePosition → priority desc → createdAt asc
  for (const [, arr] of bands) {
    arr.sort((a, b) => {
      if (a.queuePosition != null && b.queuePosition == null) return -1
      if (a.queuePosition == null && b.queuePosition != null) return 1
      if (a.queuePosition != null && b.queuePosition != null) return a.queuePosition - b.queuePosition
      const pa = a.priority ?? 0
      const pb = b.priority ?? 0
      if (pb !== pa) return pb - pa
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }

  const Y_ROT = Math.PI / 4

  const result: { mission: MissionData; position: [number, number, number]; rotation: [number, number, number] }[] = []

  for (const [level, arr] of bands) {
    const anorak = arr.filter(m => m.assignedTo === 'anorak')
    const carbon = arr.filter(m => m.assignedTo === 'carbondev')
    const unassigned = arr.filter(m => m.assignedTo !== 'anorak' && m.assignedTo !== 'carbondev')

    const place = (missions: MissionData[], side: -1 | 0 | 1) => {
      for (let i = 0; i < missions.length; i++) {
        const m = missions[i]
        const x = side === 0 ? 0 : side * (3 + i * spacing)
        const y = level === DONE_BAND ? 2.0 : 0.5
        const z = bandZ(level)
        result.push({
          mission: m,
          position: [x, y, z],
          rotation: [0, side >= 0 ? Y_ROT : -Y_ROT, 0],
        })
      }
    }

    place(anorak, -1)
    place(carbon, 1)
    place(unassigned, 0)
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUND BANDS — 10 colored floor segments
// ═══════════════════════════════════════════════════════════════════════════

function GroundBands() {
  return (
    <group>
      {Array.from({ length: TOTAL_BANDS }, (_, i) => (
        <mesh key={`band-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, bandZ(i)]}>
          <planeGeometry args={[WORLD_SIZE, BAND_DEPTH]} />
          <meshStandardMaterial color={BAND_GROUND_COLORS[i]} roughness={0.95} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BAND WALLS — 0.5m translucent walls between bands
// ═══════════════════════════════════════════════════════════════════════════

function BandWalls() {
  return (
    <group>
      {Array.from({ length: TOTAL_BANDS - 1 }, (_, i) => (
        <mesh key={`wall-${i}`} position={[0, 0.25, wallZ(i + 1)]}>
          <boxGeometry args={[WORLD_SIZE, 0.5, 0.05]} />
          <meshStandardMaterial
            color={MATURITY_ACCENTS[i + 1]} emissive={MATURITY_ACCENTS[i + 1]} emissiveIntensity={0.5}
            transparent opacity={0.3} side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CENTER DIVIDER — glowing line at X=0
// ═══════════════════════════════════════════════════════════════════════════

function CenterDivider() {
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.15, WORLD_SIZE]} />
      <meshStandardMaterial color="#14b8a6" emissive="#14b8a6" emissiveIntensity={2} transparent opacity={0.6} />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR PARTICLE SYSTEM — orange spiraling orbs from curator → mission
// ═══════════════════════════════════════════════════════════════════════════

const MAX_PARTICLES = 30
const PARTICLE_LIFETIME = 1.5  // seconds

interface Particle {
  startTime: number
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  offset: number  // random phase for helix
}

function CuratorParticles({ curatorPos, missionPos, active }: {
  curatorPos: THREE.Vector3; missionPos: THREE.Vector3; active: boolean
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const particlesRef = useRef<Particle[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const lastSpawn = useRef(0)

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const now = state.clock.elapsedTime

    // Spawn new particles
    if (active && now - lastSpawn.current > 0.2) {
      lastSpawn.current = now
      if (particlesRef.current.length < MAX_PARTICLES) {
        particlesRef.current.push({
          startTime: now,
          startPos: curatorPos.clone(),
          endPos: missionPos.clone(),
          offset: Math.random() * Math.PI * 2,
        })
      }
    }

    // Remove expired
    particlesRef.current = particlesRef.current.filter(p => now - p.startTime < PARTICLE_LIFETIME)

    // Update instances
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particlesRef.current[i]
      if (p) {
        const t = (now - p.startTime) / PARTICLE_LIFETIME
        const dir = p.endPos.clone().sub(p.startPos)
        const pos = p.startPos.clone().add(dir.multiplyScalar(t))
        // Helix spiral
        const spiralR = 0.5 * (1 - t)
        pos.x += Math.cos(t * Math.PI * 4 + p.offset) * spiralR
        pos.y += Math.sin(t * Math.PI * 4 + p.offset) * spiralR
        dummy.position.copy(pos)
        dummy.scale.setScalar(0.05 * (1 - t))
      } else {
        dummy.position.set(0, -100, 0)  // hide unused
        dummy.scale.setScalar(0)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={3} />
    </instancedMesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// FLYING ENEMY — The Curator Entity with full state machine
// ═══════════════════════════════════════════════════════════════════════════

type CuratorState = 'idle' | 'approaching' | 'attacking' | 'transitioning'

function FlyingEnemyCurator({ targetMissionPos, isCurating }: {
  targetMissionPos: [number, number, number] | null
  isCurating: boolean
}) {
  const { scene, animations } = useGLTF(FLYING_ENEMY_PATH)
  const groupRef = useRef<THREE.Group>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const stateRef = useRef<CuratorState>('idle')
  const attackTimerRef = useRef(0)
  const attackDurationRef = useRef(3)
  const targetOrbitRef = useRef({ angle: 0, radius: 3 })

  // Throne position: center, 5m high, between Pashyanti/Madhyama
  const thronePos = useMemo(() => new THREE.Vector3(0, 5, wallZ(2)), [])
  const currentTargetPos = useMemo(() => targetMissionPos ? new THREE.Vector3(...targetMissionPos).add(new THREE.Vector3(0, 2, 0)) : null, [targetMissionPos])

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group
    clone.traverse((child) => { if ((child as THREE.Mesh).isMesh) child.raycast = () => {} })
    return clone
  }, [scene])

  // Find animation clips
  const clips = useMemo(() => ({
    idle: animations.find(a => /idle/i.test(a.name)),
    run: animations.find(a => /run/i.test(a.name)),
    attack: animations.find(a => /attack/i.test(a.name)),
    shoot: animations.find(a => /shoot/i.test(a.name)),
  }), [animations])

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clonedScene)
    mixerRef.current = mixer
    // Start idle
    if (clips.idle) {
      const action = mixer.clipAction(clips.idle)
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.play()
      currentActionRef.current = action
    }
    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(clonedScene)
      clonedScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.geometry?.dispose()
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach(m => m?.dispose())
        }
      })
    }
  }, [clonedScene, clips])

  // Play a named animation with crossfade
  const playAnim = useCallback((clipName: keyof typeof clips) => {
    const mixer = mixerRef.current
    const clip = clips[clipName]
    if (!mixer || !clip) return
    const newAction = mixer.clipAction(clip)
    if (currentActionRef.current && currentActionRef.current !== newAction) {
      currentActionRef.current.fadeOut(0.3)
    }
    newAction.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat, Infinity).play()
    currentActionRef.current = newAction
  }, [clips])

  // Play audio via audio manager (Zustand .getState() is safe outside React)
  const playSound = useCallback((event: SoundEvent) => {
    try { useAudioManager.getState().play(event) } catch { /* audio not available */ }
  }, [])

  // Detect curation state changes
  const prevCurating = useRef(false)
  useEffect(() => {
    if (isCurating && !prevCurating.current) {
      stateRef.current = 'approaching'
      playAnim('run')
      playSound('conjureStart')
    } else if (!isCurating && prevCurating.current) {
      stateRef.current = 'idle'
      playAnim('idle')
      playSound('anorakDone')
    }
    prevCurating.current = isCurating
  }, [isCurating, playAnim, playSound])

  useFrame((state, delta) => {
    const mixer = mixerRef.current
    const group = groupRef.current
    if (!mixer || !group) return
    mixer.update(delta)

    const curState = stateRef.current
    const pos = group.position

    if (curState === 'idle') {
      // Lerp to throne
      pos.lerp(thronePos, 0.02)
    } else if (curState === 'approaching' && currentTargetPos) {
      // Fly toward mission over ~3 seconds
      const dist = pos.distanceTo(currentTargetPos)
      if (dist < 0.5) {
        stateRef.current = 'attacking'
        attackTimerRef.current = 0
        attackDurationRef.current = 2 + Math.random() * 3
        targetOrbitRef.current.angle = Math.random() * Math.PI * 2
        // Pick random attack animation
        playAnim(Math.random() > 0.5 ? 'attack' : 'shoot')
      } else {
        pos.lerp(currentTargetPos, 0.03)
        // Face target
        group.lookAt(currentTargetPos)
      }
    } else if (curState === 'attacking' && currentTargetPos) {
      attackTimerRef.current += delta

      if (attackTimerRef.current > attackDurationRef.current) {
        // Pick new orbit position and animation
        attackTimerRef.current = 0
        attackDurationRef.current = 2 + Math.random() * 3
        targetOrbitRef.current.angle += Math.PI * (0.5 + Math.random())
        targetOrbitRef.current.radius = 2 + Math.random() * 2
        playAnim(Math.random() > 0.3 ? (Math.random() > 0.5 ? 'attack' : 'shoot') : 'idle')
      }

      // Orbit around mission
      const { angle, radius } = targetOrbitRef.current
      const orbitTarget = new THREE.Vector3(
        currentTargetPos.x + Math.cos(angle) * radius,
        currentTargetPos.y + Math.sin(state.clock.elapsedTime * 0.8) * 0.5,
        currentTargetPos.z + Math.sin(angle) * radius,
      )
      pos.lerp(orbitTarget, 0.05)
      group.lookAt(currentTargetPos)
    }
  })

  return (
    <group ref={groupRef} position={[thronePos.x, thronePos.y, thronePos.z]}>
      <primitive object={clonedScene} scale={1.5} />
      {/* Magenta strobe light during curation */}
      {isCurating && (
        <pointLight color="#ff00ff" intensity={5} distance={15} decay={2} />
      )}
      {/* Particles */}
      {isCurating && currentTargetPos && groupRef.current && (
        <CuratorParticles
          curatorPos={groupRef.current.position}
          missionPos={currentTargetPos}
          active={isCurating}
        />
      )}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION IMAGE ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════

class MissionImageErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) { console.warn('[MindcraftWorld] Image error:', error.message) }
  render() { return this.state.hasError ? this.props.fallback : this.props.children }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLICKABLE MISSION — click → Zustand → MissionWindow in DOM
// ═══════════════════════════════════════════════════════════════════════════

function ClickableMission({ mission, position, rotation }: {
  mission: MissionData; position: [number, number, number]; rotation: [number, number, number]
}) {
  const setMissionId = useOasisStore(s => s.setMindcraftSelectedMissionId)
  return (
    <group position={position} rotation={new THREE.Euler(...rotation)}
      onClick={(e) => { e.stopPropagation(); setMissionId(mission.id) }}>
      <MissionImageErrorBoundary fallback={
        <mesh position={[0, 1, 0]}>
          <boxGeometry args={[2, 2, 0.1]} />
          <meshStandardMaterial color={MATURITY_ACCENTS[mission.maturityLevel] ?? '#666'} emissive={MATURITY_ACCENTS[mission.maturityLevel] ?? '#666'} emissiveIntensity={0.3} />
        </mesh>
      }>
        <Suspense fallback={<mesh position={[0, 1, 0]}><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color="#333" wireframe /></mesh>}>
          <MissionCard3D mission={mission} />
        </Suspense>
      </MissionImageErrorBoundary>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MINDCRAFT WORLD — The main R3F component
// ═══════════════════════════════════════════════════════════════════════════

// Module-level shared state for MissionWindowBridge
let _mindcraftMissions: MissionData[] = []
let _mindcraftRefetch: (() => void) | null = null
export function getMindcraftMissions() { return _mindcraftMissions }
export function getMindcraftRefetch() { return _mindcraftRefetch }

export function MindcraftWorld() {
  const [missions, setMissions] = useState<MissionData[]>([])
  const [spacing, setSpacing] = useState(DEFAULT_SPACING)
  const [isCurating, setIsCurating] = useState(false)
  const [curatingMissionId, setCuratingMissionId] = useState<number | null>(null)
  const missionsRef = useRef<MissionData[]>([])

  // ─── Fetch missions ───
  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch('/api/missions')
      if (!res.ok) return
      const data = await res.json()
      const arr = Array.isArray(data) ? data : data.missions ?? []
      setMissions(arr)
      missionsRef.current = arr
      _mindcraftMissions = arr
    } catch (err) {
      console.error('[MindcraftWorld] Failed to fetch missions:', err)
    }
  }, [])

  // ─── Poll curation status (uses ref to avoid dependency on missions state) ───
  const pollCurationStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/anorak/pro/curator-logs')
      if (!res.ok) return
      const logs = await res.json()
      const running = Array.isArray(logs) && logs.find((l: { status: string }) => l.status === 'running')
      setIsCurating(!!running)

      if (running) {
        const candidate = missionsRef.current.find(m =>
          m.status === 'todo' && m.maturityLevel < 3 && m.assignedTo !== 'carbondev'
        )
        setCuratingMissionId(candidate?.id ?? null)
      } else {
        setCuratingMissionId(null)
      }
    } catch { /* curator-logs not available, ignore */ }
  }, [])  // stable — reads from missionsRef

  useEffect(() => {
    _mindcraftRefetch = fetchMissions
    fetchMissions()
    setSpacing(getSpacing())
    const missionInterval = setInterval(fetchMissions, 10000)
    const curatorInterval = setInterval(pollCurationStatus, CURATOR_POLL_INTERVAL)
    return () => {
      clearInterval(missionInterval)
      clearInterval(curatorInterval)
      _mindcraftRefetch = null
    }
  }, [fetchMissions, pollCurationStatus])

  const placed = useMemo(() => computeMissionPositions(missions, spacing), [missions, spacing])

  // Find position of the mission being curated
  const targetMissionPos = useMemo<[number, number, number] | null>(() => {
    if (!curatingMissionId) return null
    const entry = placed.find(p => p.mission.id === curatingMissionId)
    return entry?.position ?? null
  }, [curatingMissionId, placed])

  return (
    <>
      <GroundBands />
      <BandWalls />
      <CenterDivider />

      <Suspense fallback={null}>
        <FlyingEnemyCurator targetMissionPos={targetMissionPos} isCurating={isCurating} />
      </Suspense>

      {placed.map(({ mission, position, rotation }) => (
        <ClickableMission
          key={`mission-${mission.id}`}
          mission={mission}
          position={position}
          rotation={rotation}
        />
      ))}
    </>
  )
}

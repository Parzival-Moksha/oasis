'use client'

// The selected agent's effect, and right-click-to-send. Lives inside the Canvas.
//
// Cost: nothing is mounted and no frame callback runs while no agent is selected. With one
// selected there is ONE effect in the scene (a ring and one of six small things), moved to the
// agent each frame; its motion is computed in the vertex shader from one time uniform.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useFrameWhen } from '@/lib/use-frame-when'
import { useOasisStore } from '@/store/oasisStore'
import { useInputManager } from '@/lib/input-manager'
import { sampleTerrainHeightAt } from '@/lib/forge/terrain-brush'
import { getLiveObjectTransform } from '@/lib/live-object-transforms'
import { villageAgentKey } from '@/lib/village/village-layout'
import { getVillageStation } from './village-actions'
import {
  clearAllSentGoals,
  clearSentGoal,
  getAgentSelectionFx,
  getAgentSelectionVersion,
  getSelectedVillageAgent,
  groundPointOnTerrain,
  isRightClick,
  selectVillageAgent,
  sendVillageAgentTo,
  subscribeAgentSelection,
  type SelectionFxId,
} from '@/lib/village/agent-selection'

const NO_RAYCAST = () => null
const GOLD = new THREE.Color('#ffd66b')

// ── particles: sparkle, fire, vortex (one shader, the motion is a function of time) ────────────

const PARTICLE_COUNT = 72
const PARTICLE_MODE: Record<'sparkle' | 'fire' | 'vortex', number> = { sparkle: 0, fire: 1, vortex: 2 }

const PARTICLE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uMode;
uniform float uScale;
attribute vec4 aSeed;
varying float vAlpha;
varying float vHeat;
void main() {
  vec3 p;
  float size;
  vAlpha = 1.0;
  vHeat = 0.0;
  if (uMode < 0.5) {
    // sparkle: motes circling at different heights, twinkling
    float a = aSeed.x * 6.2832 + uTime * (0.5 + aSeed.y * 0.9);
    float r = 0.42 + 0.3 * aSeed.z;
    float y = 0.15 + 1.75 * fract(aSeed.w + uTime * 0.07 * (0.5 + aSeed.y));
    p = vec3(cos(a) * r, y, sin(a) * r);
    float tw = 0.5 + 0.5 * sin(uTime * (3.0 + aSeed.z * 5.0) + aSeed.x * 40.0);
    size = 0.07 + 0.1 * tw;
    vAlpha = 0.35 + 0.65 * tw;
  } else if (uMode < 1.5) {
    // fire: flames rising from a ring at the feet, narrowing and cooling
    float life = fract(aSeed.y + uTime * (0.55 + aSeed.z * 0.5));
    float a = aSeed.x * 6.2832 + sin(uTime * 2.0 + aSeed.w * 20.0) * 0.25;
    float r = 0.5 * (1.0 - life * 0.55);
    p = vec3(cos(a) * r, life * (0.9 + aSeed.w * 0.7), sin(a) * r);
    size = 0.32 * (1.0 - life) + 0.05;
    vAlpha = (1.0 - life) * smoothstep(0.0, 0.08, life);
    vHeat = life;
  } else {
    // vortex: a spiral winding upwards and inwards
    float life = fract(aSeed.y + uTime * 0.32);
    float a = aSeed.x * 6.2832 + life * 9.0 + uTime * 1.6;
    float r = 0.75 * (1.0 - life) + 0.12;
    p = vec3(cos(a) * r, life * 2.1, sin(a) * r);
    size = 0.1 + 0.1 * (1.0 - life);
    vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - life * 0.8);
    vHeat = life;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 1.0, 96.0);
}
`

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vAlpha;
varying float vHeat;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float soft = 1.0 - smoothstep(0.0, 0.5, d);
  gl_FragColor = vec4(mix(uColorA, uColorB, clamp(vHeat, 0.0, 1.0)), clamp(soft * soft * vAlpha, 0.0, 1.0));
}
`

const PARTICLE_COLORS: Record<'sparkle' | 'fire' | 'vortex', [string, string]> = {
  sparkle: ['#fff6d0', '#ffe9a0'],
  fire: ['#ffd27a', '#ff4b1f'],
  vortex: ['#8fe8ff', '#b48cff'],
}

function Particles({ mode }: { mode: 'sparkle' | 'fire' | 'vortex' }) {
  const size = useThree(s => s.size)
  const dpr = useThree(s => s.viewport.dpr)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const seeds = new Float32Array(PARTICLE_COUNT * 4)
    // Seeded, so the effect looks the same every time it appears.
    let s = 12345
    for (let i = 0; i < seeds.length; i++) { s = (s * 16807) % 2147483647; seeds[i] = s / 2147483647 }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.5)
    return g
  }, [])
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: PARTICLE_MODE[mode] },
      uScale: { value: 600 },
      uColorA: { value: new THREE.Color(PARTICLE_COLORS[mode][0]) },
      uColorB: { value: new THREE.Color(PARTICLE_COLORS[mode][1]) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [mode])
  useEffect(() => () => { geometry.dispose() }, [geometry])
  useEffect(() => () => { material.dispose() }, [material])
  // Point sizes are in device pixels.
  material.uniforms.uScale.value = size.height * 0.9 * dpr
  return <points geometry={geometry} material={material} raycast={NO_RAYCAST} frustumCulled={false} userData={{ selectionTime: material.uniforms.uTime }} />
}

// ── meshes: aura, shield, diamond ─────────────────────────────────────────────────────────────

const SHELL_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const AURA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // bright at the feet, gone at the top; slow bands drifting upwards
  // clamped: a negative base makes pow() return NaN, and bloom smears one NaN pixel over the whole picture
  float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6);
  float bands = 0.75 + 0.25 * sin(vUv.y * 18.0 - uTime * 2.2 + vUv.x * 6.2832);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.7);
  gl_FragColor = vec4(uColor, clamp(fade * bands * pulse * 0.55, 0.0, 1.0));
}
`

const SHIELD_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
void main() {
  float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0), 2.4);
  float shimmer = 0.8 + 0.2 * sin(vUv.y * 40.0 + uTime * 3.0) * sin(vUv.x * 30.0 - uTime * 1.3);
  gl_FragColor = vec4(uColor, clamp((rim * 0.95 + 0.05) * shimmer, 0.0, 1.0));
}
`

function Shell({ kind }: { kind: 'aura' | 'shield' }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SHELL_VERTEX,
    fragmentShader: kind === 'aura' ? AURA_FRAGMENT : SHIELD_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(kind === 'aura' ? '#9fe8ff' : '#ffd66b') } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  }), [kind])
  useEffect(() => () => { material.dispose() }, [material])
  return kind === 'aura' ? (
    <mesh position={[0, 1.05, 0]} material={material} raycast={NO_RAYCAST} userData={{ selectionTime: material.uniforms.uTime }}>
      <cylinderGeometry args={[0.5, 0.62, 2.1, 32, 1, true]} />
    </mesh>
  ) : (
    <mesh position={[0, 0.95, 0]} scale={[0.85, 1.2, 0.85]} material={material} raycast={NO_RAYCAST} userData={{ selectionTime: material.uniforms.uTime }}>
      <sphereGeometry args={[1, 32, 20]} />
    </mesh>
  )
}

function Diamond() {
  return (
    <group position={[0, 2.62, 0]} userData={{ selectionSpin: 1.6, selectionBob: 0.07 }}>
      <mesh scale={[1, 1.55, 1]} raycast={NO_RAYCAST}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshBasicMaterial color="#7dffb0" transparent opacity={0.92} />
      </mesh>
      <mesh scale={[1.25, 1.9, 1.25]} raycast={NO_RAYCAST}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshBasicMaterial color="#baffd6" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

function GroundRing() {
  return (
    <group userData={{ selectionSpin: 0.5 }} position={[0, 0.03, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <ringGeometry args={[0.6, 0.66, 48]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* four ticks, so the turning can be seen */}
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]} raycast={NO_RAYCAST}>
          <ringGeometry args={[0.68, 0.78, 6, 1, -0.12, 0.24]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

export function SelectionEffect({ fx }: { fx: SelectionFxId }) {
  return (
    <>
      <GroundRing />
      {fx === 'diamond' && <Diamond />}
      {(fx === 'aura' || fx === 'shield') && <Shell kind={fx} />}
      {(fx === 'sparkle' || fx === 'fire' || fx === 'vortex') && <Particles mode={fx} />}
    </>
  )
}

// ── the layer ─────────────────────────────────────────────────────────────────────────────────

interface Target { kind: 'village' | 'avatar'; id: string; fxKey: string }

function useSelectionTarget(): Target | null {
  useSyncExternalStore(subscribeAgentSelection, getAgentSelectionVersion, () => 0)
  const villageId = getSelectedVillageAgent()
  const villageKey = useOasisStore(s => {
    if (!villageId) return null
    const agent = s.agentEngine.agents[villageId]
    return agent ? villageAgentKey({ id: agent.id, sessionId: agent.sessionId }) : null
  })
  // The old kind of agent: a placed avatar that is the selected object.
  const avatarId = useOasisStore(s => (s.selectedObjectId && s.placedAgentAvatars.some(a => a.id === s.selectedObjectId) ? s.selectedObjectId : null))
  if (villageId && villageKey) return { kind: 'village', id: villageId, fxKey: villageKey }
  if (avatarId) return { kind: 'avatar', id: avatarId, fxKey: `avatar:${avatarId}` }
  return null
}

export function AgentSelectionLayer() {
  const target = useSelectionTarget()
  const group = useRef<THREE.Group>(null)
  const { gl, camera } = useThree()
  const clock = useRef(0)

  // An agent that is gone cannot stay selected.
  const villageId = getSelectedVillageAgent()
  const exists = useOasisStore(s => (villageId ? Boolean(s.agentEngine.agents[villageId]) : true))
  useEffect(() => { if (!exists && villageId) { clearSentGoal(villageId); selectVillageAgent(null) } }, [exists, villageId])
  // One selection at a time: a selected world object and a selected agent would both answer a right-click.
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  useEffect(() => { if (selectedObjectId) selectVillageAgent(null) }, [selectedObjectId])
  useEffect(() => { if (villageId && useOasisStore.getState().selectedObjectId) useOasisStore.getState().selectObject(null) }, [villageId])
  // Leaving the world leaves the selection behind.
  const worldId = useOasisStore(s => s.activeWorldId)
  useEffect(() => () => { selectVillageAgent(null); clearAllSentGoals() }, [worldId])

  const place = (): boolean => {
    const g = group.current
    if (!g || !target) return false
    if (target.kind === 'village') {
      const station = getVillageStation(target.id)
      if (!station) return false
      g.position.set(station.anchor[0], station.anchor[1], station.anchor[2])
      g.scale.setScalar(1)
      return true
    }
    const avatar = useOasisStore.getState().placedAgentAvatars.find(a => a.id === target.id)
    if (!avatar) return false
    const live = getLiveObjectTransform(target.id)
    const p = live?.position ?? avatar.position
    const ground = sampleTerrainHeightAt(useOasisStore.getState().terrainHeights, p[0], p[2])
    g.position.set(p[0], Number.isFinite(ground) ? Math.max(ground, p[1]) : p[1], p[2])
    const scale = Array.isArray(avatar.scale) ? avatar.scale[1] : typeof avatar.scale === 'number' ? avatar.scale : 1
    g.scale.setScalar(Math.max(0.3, Math.min(4, scale || 1)))
    return true
  }

  useFrameWhen(target !== null, (_, delta) => {
    const g = group.current
    if (!g) return
    g.visible = place()
    if (!g.visible) return
    clock.current += Math.min(delta, 0.1)
    const t = clock.current
    g.traverse(child => {
      const data = child.userData
      if (data.selectionTime) data.selectionTime.value = t
      if (data.selectionSpin) child.rotation.y = t * data.selectionSpin
      if (data.selectionBob) child.position.y = 2.62 + Math.sin(t * 2.2) * data.selectionBob
    })
  })

  // Right-click on the ground: the selected village agent walks there.
  useEffect(() => {
    if (!target || target.kind !== 'village') return
    const agentId = target.id
    const el = gl.domElement
    let down: { at: number; x: number; y: number } | null = null
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    const onDown = (event: PointerEvent) => {
      if (event.button !== 2) return
      down = { at: performance.now(), x: event.clientX, y: event.clientY }
    }
    const onUp = (event: PointerEvent) => {
      if (event.button !== 2 || !down) return
      const held = performance.now() - down.at
      const moved = document.pointerLockElement ? 0 : Math.hypot(event.clientX - down.x, event.clientY - down.y)
      down = null
      if (!isRightClick(held, moved)) return
      const state = useInputManager.getState().inputState
      if (state !== 'third-person' && state !== 'noclip' && state !== 'orbit') return // placing, painting, in a panel
      if (useOasisStore.getState().selectedObjectId) return // the old Oasis's own move order answers this one
      const station = getVillageStation(agentId)
      if (!station) return
      // Under mouse-look the pointer is the crosshair in the middle of the view.
      if (document.pointerLockElement) ndc.set(0, 0)
      else {
        const rect = el.getBoundingClientRect()
        ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      }
      raycaster.setFromCamera(ndc, camera)
      const { origin, direction } = raycaster.ray
      const heights = useOasisStore.getState().terrainHeights
      const hit = groundPointOnTerrain(
        { ox: origin.x, oy: origin.y, oz: origin.z, dx: direction.x, dy: direction.y, dz: direction.z },
        station.anchor[1],
        (x, z) => sampleTerrainHeightAt(heights, x, z),
      )
      if (!hit) return
      if (sendVillageAgentTo(agentId, hit.x, hit.z, station.anchor[0], station.anchor[2])) {
        useOasisStore.getState().spawnMarchOrderVfx([hit.x, hit.y, hit.z])
      }
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [target?.kind, target?.id, gl, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null
  return (
    <group ref={group} visible={false}>
      <SelectionEffect key={`${target.fxKey}:${getAgentSelectionFx(target.fxKey)}`} fx={getAgentSelectionFx(target.fxKey)} />
    </group>
  )
}

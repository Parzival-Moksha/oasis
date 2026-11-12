'use client'

// ░▒▓ VILLAGE ACADEMY TRAINEE — an agent in training: stone until it has Spirit and Body, then it wakes ▓▒░
//   · AcademyStoneBody: wraps the agent's body at its desk. Stone: grey, on a low pedestal, holding still
//     (VRMCatalogRenderer's `still`). When both skills are verified it wakes: a glow, colour running back
//     into it, the pedestal sinking, a ring of light on the ground.
//   · AcademyLevelTag: its level and XP on the sign over its head.
//   · AcademyTrainToggle: the "Train" switch in its session panel.
//
// The body's own materials are never changed: while it is stone each mesh wears a grey twin of its
// material (same texture, so hair and lashes keep their cut-outs), and gets its own back on waking, when
// training ends, when the Academy is switched off, and when this unmounts. Skins are remembered per
// session and helpers are clones of this body (they share its materials): a helper cloned while its
// parent is stone is stone too, and leaves like any helper.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useFrameWhen } from '../../lib/use-frame-when'
import type { AcademyTraineeView } from '../../lib/village/village-academy'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { showNotice } from '../forge/GlobalNotice'
import { VRMCatalogRenderer } from '../forge/WorldObjects'
import { academyKeyOf, getAcademyState, setAgentTraining, subscribeAcademy, traineeByKey, useAcademyEnabled } from './academy-store'

const PEDESTAL_HEIGHT = 0.22
const WAKE_S = 2.2
const NO_RAYCAST = () => {}

/** The agent's record in the Academy (null: never trained). */
export function useAcademyTrainee(agentId: string): AcademyTraineeView | null {
  const key = useOasisStore(s => {
    const agent = s.agentEngine.agents[agentId]
    return agent ? academyKeyOf(agent) : null
  })
  return useSyncExternalStore(subscribeAcademy, () => traineeByKey(key, getAcademyState()), () => null)
}

/** In training without Spirit and Body verified (and the Academy is on). */
export function useAcademyStone(agentId: string): boolean {
  const enabled = useAcademyEnabled()
  const trainee = useAcademyTrainee(agentId)
  return enabled && Boolean(trainee?.training && trainee.stone)
}

// ─── stone ──────────────────────────────────────────────────────────────────

interface StoneUniforms { uStone: { value: number }; uFlash: { value: number } }

function isToon(material: THREE.Material): boolean {
  const m = material as unknown as { type?: string; isMToonMaterial?: boolean }
  return m.type === 'MToonMaterial' || m.isMToonMaterial === true
}

/** A grey twin of a body material: same texture and cut-outs, colour drained into stone by `uStone`. */
function stoneTwin(original: THREE.Material, uniforms: StoneUniforms): THREE.MeshStandardMaterial {
  const o = original as unknown as {
    map?: THREE.Texture | null; normalMap?: THREE.Texture | null; color?: THREE.Color
    uniforms?: { map?: { value?: THREE.Texture | null } }
  }
  const twin = new THREE.MeshStandardMaterial({
    map: o.map || o.uniforms?.map?.value || null,
    normalMap: o.normalMap || null,
    color: o.color?.isColor ? o.color.clone() : new THREE.Color('#ffffff'),
    roughness: 0.95,
    metalness: 0.02,
    side: original.side,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
    depthWrite: original.depthWrite,
  })
  twin.onBeforeCompile = shader => {
    shader.uniforms.uStone = uniforms.uStone
    shader.uniforms.uFlash = uniforms.uFlash
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uStone;\nuniform float uFlash;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float academyGrey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.105, 0.12) + vec3(0.27, 0.28, 0.3) * academyGrey, uStone);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.84, 0.5) * uFlash;`)
  }
  twin.customProgramCacheKey = () => 'academy-stone'
  return twin
}

type Phase = 'flesh' | 'stone' | 'waking'

export function AcademyStoneBody({ agentId, children }: { agentId: string; children: ReactNode }) {
  const enabled = useAcademyEnabled()
  const trainee = useAcademyTrainee(agentId)
  const stone = enabled && Boolean(trainee?.training && trainee.stone)
  // Still in training and no longer stone: it earned it, so it wakes on camera. Anything else (training
  // ended, the Academy switched off) just gives the body back.
  const earned = enabled && Boolean(trainee?.training && !trainee.stone)
  const [phase, setPhase] = useState<Phase>(stone ? 'stone' : 'flesh')
  const scene = useThree(s => s.scene)
  const invalidate = useThree(s => s.invalidate)
  const body = useRef<THREE.Group>(null)
  const pedestal = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const uniforms = useMemo<StoneUniforms>(() => ({ uStone: { value: 1 }, uFlash: { value: 0 } }), [])
  const worn = useRef(new Map<THREE.Mesh, THREE.Material | THREE.Material[]>())
  const twins = useRef(new Map<THREE.Material, THREE.MeshStandardMaterial>())
  const wakeStart = useRef(0)

  useEffect(() => {
    if (stone) setPhase('stone')
    else setPhase(current => (current === 'stone' ? (earned ? 'waking' : 'flesh') : current))
  }, [stone, earned])

  const giveBack = () => {
    for (const [mesh, original] of worn.current) mesh.material = original
    worn.current.clear()
    for (const twin of twins.current.values()) twin.dispose()
    twins.current.clear()
  }

  // Dress every mesh of the body in its stone twin. The body arrives late (it is loaded, and a new skin is
  // another body), so this looks again a few times a second while it is stone; it only touches new meshes.
  useEffect(() => {
    if (phase === 'flesh') {
      giveBack()
      // Left at "colour": a helper cloned while this was stone still wears a twin, and stays as it woke.
      uniforms.uStone.value = 0
      uniforms.uFlash.value = 0
      if (body.current) {
        body.current.position.y = 0
        body.current.scale.setScalar(1)
      }
      invalidate()
      return
    }
    const began = performance.now()
    const dress = () => {
      const root = body.current
      if (!root) return
      // Bodies whose toon materials are still to be swapped for lit ones (once the sky's light is in): wait for that.
      // No sky light after a while: go ahead with what it wears.
      const waitForLit = Boolean(scene.environment) || performance.now() - began < 8000
      root.traverse(object => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh || worn.current.has(mesh)) return
        const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        if (!originals.length || originals.some(material => !material)) return
        if (waitForLit && originals.some(isToon)) return
        const stoneOf = (material: THREE.Material) => {
          let twin = twins.current.get(material)
          if (!twin) {
            twin = stoneTwin(material, uniforms)
            twins.current.set(material, twin)
          }
          return twin
        }
        worn.current.set(mesh, mesh.material)
        mesh.material = Array.isArray(mesh.material) ? originals.map(stoneOf) : stoneOf(originals[0])
      })
    }
    dress()
    if (phase === 'stone') {
      uniforms.uStone.value = 1
      uniforms.uFlash.value = 0
      // Also after a wake that was cut short (a reset for another take).
      if (body.current) {
        body.current.position.y = PEDESTAL_HEIGHT
        body.current.scale.setScalar(1)
      }
      if (pedestal.current) {
        pedestal.current.scale.y = 1
        pedestal.current.position.y = PEDESTAL_HEIGHT / 2
      }
    } else wakeStart.current = performance.now()
    const timer = window.setInterval(dress, 400)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  // Unmount (the agent left, a hot reload): the loaded body is cached and shared with its helpers, so it gets its materials back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => giveBack, [])

  // The wake: about two seconds, then this leaves the frame loop again.
  useFrameWhen(phase === 'waking', () => {
    const t = (performance.now() - wakeStart.current) / 1000
    const k = Math.min(1, t / WAKE_S)
    // Light gathers in the stone, then colour runs back while the light fades.
    uniforms.uFlash.value = k < 0.18 ? (k / 0.18) * 0.55 : 0.55 * Math.max(0, 1 - (k - 0.18) / 0.6)
    const colour = Math.min(1, Math.max(0, (k - 0.15) / 0.55))
    uniforms.uStone.value = 1 - colour * colour * (3 - 2 * colour)
    const sink = Math.min(1, Math.max(0, (k - 0.2) / 0.6))
    const lift = PEDESTAL_HEIGHT * (1 - sink)
    if (body.current) {
      body.current.position.y = lift
      body.current.scale.setScalar(1 + 0.06 * Math.sin(Math.PI * Math.min(1, k / 0.5)))
    }
    if (pedestal.current) {
      pedestal.current.scale.y = Math.max(0.001, 1 - sink)
      pedestal.current.position.y = lift / 2
    }
    if (ring.current) {
      const spread = Math.min(1, k / 0.8)
      ring.current.scale.setScalar(0.4 + 4.2 * spread)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - spread)
    }
    if (k >= 1) setPhase('flesh')
  })

  return (
    <>
      <group ref={body} position-y={phase === 'flesh' ? 0 : PEDESTAL_HEIGHT}>{children}</group>
      {phase !== 'flesh' && (
        <mesh ref={pedestal} position={[0, PEDESTAL_HEIGHT / 2, 0]} raycast={NO_RAYCAST} receiveShadow>
          <cylinderGeometry args={[0.52, 0.6, PEDESTAL_HEIGHT, 24]} />
          <meshStandardMaterial color="#6b7280" roughness={0.95} metalness={0.02} />
        </mesh>
      )}
      {phase === 'waking' && (
        <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.06, 0]} raycast={NO_RAYCAST}>
          <ringGeometry args={[0.82, 1, 48]} />
          <meshBasicMaterial color="#ffd27a" transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  )
}

/** A village agent's body (VillageStation): the usual VRM, stone while the Academy says so. */
export function AcademyVillageBody({ agentId, ...body }: { agentId: string } & ComponentProps<typeof VRMCatalogRenderer>) {
  const stone = useAcademyStone(agentId)
  return (
    <AcademyStoneBody agentId={agentId}>
      <VRMCatalogRenderer {...body} still={stone} />
    </AcademyStoneBody>
  )
}

// ─── the sign and the switch (DOM) ──────────────────────────────────────────

/** Level and XP on the sign over a trainee's head. */
export function AcademyLevelTag({ agentId }: { agentId: string }) {
  const enabled = useAcademyEnabled()
  const trainee = useAcademyTrainee(agentId)
  if (!enabled || !trainee?.training) return null
  return (
    <div
      data-academy-level={trainee.level.name}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-300/60 bg-slate-950/85 px-2 py-[1px] text-[10px] font-bold text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.25)]"
    >
      {trainee.stone && <span className="uppercase tracking-[0.14em] text-slate-300">stone ·</span>}
      <span>{trainee.level.name}</span>
      <span className="font-normal text-amber-100/70">{trainee.xp.score} XP</span>
    </div>
  )
}

/** "Train": puts the agent in or out of training (next to the other switches in its session panel). */
export function AcademyTrainToggle({ agent }: { agent: EngineAgentState }) {
  const enabled = useAcademyEnabled()
  const trainee = useAcademyTrainee(agent.id)
  const [busy, setBusy] = useState(false)
  if (!enabled) return null
  const on = Boolean(trainee?.training)
  const label = on
    ? `In training (${trainee?.level.name}, ${trainee?.xp.score} XP): the skill tree shows its progress. Click to take it out of training.`
    : 'Train: put this agent in training. It stands as stone until it has Spirit and Body, and the skill tree shows its progress.'
  return (
    <button
      type="button"
      data-academy-train={on ? 'on' : 'off'}
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void setAgentTraining(agent, !on)
          .then(result => { if (!result.ok) showNotice(`Academy: ${result.error}`, 'error') })
          .finally(() => setBusy(false))
      }}
      onKeyDown={event => event.stopPropagation()}
      className={`flex h-[22px] items-center gap-1 rounded border px-1.5 text-[10.5px] disabled:opacity-50 ${on
        ? 'border-amber-300/60 bg-amber-400/20 text-amber-100'
        : 'border-white/15 bg-black/50 text-white/45 hover:text-white/80'}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 9l10-5 10 5-10 5z" fill={on ? 'currentColor' : 'none'} />
        <path d="M6 11.5V16c2 2 10 2 12 0v-4.5" />
      </svg>
      {on ? 'training' : 'train'}
    </button>
  )
}

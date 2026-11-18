'use client'

// ░▒▓ VILLAGE COMBAT HUD — HP bar, damage numbers, knockdown pose for the village's agents ▓▒░
// State lives in lib/village/village-combat.ts (cosmetic, this tab only). A knocked-out agent plays
// the Death clip once and lies there, then gets up with full HP; its Claude Code process never notices.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { loadAnimationClip } from '@/lib/forge/animation-library'
import {
  VILLAGE_AGENT_MAX_HP,
  VILLAGE_DOWN_MS,
  getVillageCombatVersion,
  getVillageVitals,
  isFlinching,
  setVillageCorpseCenter,
  subscribeVillageCombat,
} from '@/lib/village/village-combat'

const DEATH_ANIMATION_ID = 'ual-death'
const FLINCH_ANIMATION_ID = 'ual-hit-knockback'
let preloaded = false

function useVitals(agentId: string) {
  useSyncExternalStore(subscribeVillageCombat, getVillageCombatVersion, () => 0)
  return getVillageVitals(agentId)
}

/** The animation a hit or a knockout overrides the agent's own with (null: none). */
export function useVillageCombatPose(agentId: string): { animationId: string; once: boolean } | null {
  const vitals = useVitals(agentId)
  const now = Date.now()
  const hurt = vitals.lastHitAt !== null
  useEffect(() => {
    // Fetch the two clips at the first hit anywhere, so the first knockout doesn't stand idle while loading.
    if (!hurt || preloaded) return
    preloaded = true
    void loadAnimationClip(DEATH_ANIMATION_ID).catch(() => {})
    void loadAnimationClip(FLINCH_ANIMATION_ID).catch(() => {})
  }, [hurt])
  if (vitals.downAt !== null) return { animationId: DEATH_ANIMATION_ID, once: true }
  if (isFlinching(vitals, now)) return { animationId: FLINCH_ANIMATION_ID, once: true }
  return null
}

/** Above the agent's name: HP once it has been hit, "KO" while it is down, and the damage numbers. */
export function VillageHpBar({ agentId }: { agentId: string }) {
  const vitals = useVitals(agentId)
  const down = vitals.downAt !== null
  // Tick once a second while knocked out, for the "up in Ns" countdown.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!down) return
    const timer = window.setInterval(() => setTick(n => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [down])
  if (vitals.lastHitAt === null) return null
  const now = Date.now()
  const pct = Math.max(0, Math.min(1, vitals.hp / VILLAGE_AGENT_MAX_HP))
  const color = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#fbbf24' : '#f87171'
  const upIn = down ? Math.max(0, Math.ceil((VILLAGE_DOWN_MS - (now - (vitals.downAt as number))) / 1000)) : 0
  return (
    <div className="relative flex flex-col items-center" style={{ fontFamily: '"Arial Black", Impact, system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' }}>
      <style>{'@keyframes villageDamageFloat{0%{transform:translate(-50%,0) scale(1.25);opacity:1}100%{transform:translate(-50%,-34px) scale(1);opacity:0}}'}</style>
      {vitals.hits.filter(hit => now - hit.at < 1200).map((hit, index) => (
        <span
          key={hit.id}
          className="pointer-events-none absolute left-1/2 top-0 whitespace-nowrap text-[15px] font-black"
          style={{
            color: hit.lethal ? '#fde047' : '#fca5a5',
            textShadow: '0 1px 0 #000, 0 0 6px #000, 0 0 12px rgba(239,68,68,0.8)',
            animation: 'villageDamageFloat 1.1s ease-out forwards',
            marginLeft: (index % 3 - 1) * 14,
          }}
        >
          {hit.lethal ? 'K.O.!' : `-${hit.amount}`}
        </span>
      ))}
      {down ? (
        <div className="rounded-sm bg-black/70 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-rose-200" style={{ textShadow: '0 1px 0 #000' }}>
          K.O. · up in {upIn}s
        </div>
      ) : (
        <div className="h-[7px] w-[84px] overflow-hidden rounded-sm border border-black/80 bg-black/70 shadow-[0_0_6px_rgba(0,0,0,0.6)]">
          <div className="h-full transition-[width] duration-200" style={{ width: `${pct * 100}%`, background: `linear-gradient(180deg, ${color}, ${color}aa)`, boxShadow: `0 0 6px ${color}` }} />
        </div>
      )}
    </div>
  )
}

const _bone = new THREE.Vector3()
const _ground = new THREE.Vector3()
/** Joints sit inside the body: the lowest one rests this far above the ground when lying down. */
const BODY_HALF_THICKNESS = 0.09

/**
 * Keeps a knocked-out body on the ground. The retargeted Death clip lays the skeleton flat but leaves
 * the hips near standing height, so the corpse floated about a metre up. While the agent is down this
 * sinks the whole body until its lowest bone rests on the ground, eased so it reads as the fall.
 */
export function VillageCorpseDrop({ agentId, children }: { agentId: string; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  const vitals = useVitals(agentId)
  const down = vitals.downAt !== null
  const bones = useRef<THREE.Object3D[] | null>(null)
  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    let target = 0
    if (down) {
      // Bones are found once per knockout (the VRM loads lazily under Suspense).
      if (!bones.current || bones.current.length === 0) {
        const found: THREE.Object3D[] = []
        group.traverse(object => { if ((object as THREE.Bone).isBone) found.push(object) })
        bones.current = found
      }
      if (bones.current.length) {
        group.updateWorldMatrix(true, true)
        let minY = Infinity
        let sx = 0
        let sz = 0
        for (const bone of bones.current) {
          bone.getWorldPosition(_bone)
          if (_bone.y < minY) minY = _bone.y
          sx += _bone.x
          sz += _bone.z
        }
        group.parent?.getWorldPosition(_ground)
        // How far the lowest joint sits above where it should rest, measured with the current offset applied.
        const excess = minY - (_ground.y + BODY_HALF_THICKNESS)
        target = Math.min(0, group.position.y - excess)
        setVillageCorpseCenter(agentId, [sx / bones.current.length, _ground.y, sz / bones.current.length])
      }
    } else if (bones.current) {
      bones.current = null
      setVillageCorpseCenter(agentId, null)
    }
    const next = group.position.y + (target - group.position.y) * (1 - Math.exp(-(down ? 7 : 5) * Math.min(delta, 0.1)))
    group.position.y = Math.abs(next) < 1e-4 ? 0 : next
  })
  return <group ref={ref}>{children}</group>
}

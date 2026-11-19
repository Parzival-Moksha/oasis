// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// COMBAT-BOLT LAYER — firebolt, lightning bolt, ice bolt.
//
// One path for every spell and design:
//   aim (bolts/aim.ts)       the crosshair ray into the real scene: where it leaves, where it goes,
//                            what it will hit. Taken the instant the button goes down.
//   flight (bolts/flight.ts) one projectile list for every flying design; the world surface is
//                            known from the aim, moving actors are tested on the way.
//   look (bolts/<spell>/*)   each design only draws: projectile, trail, impact.
//   sound (bolts/bolt-audio) the cast in the caster's ear, the impact where it lands.
// Mana: the cast does not wait for the server. It spends from what the client knows (mana
// refills on its own, 2 a second), fires at once, and the server records it behind.
//
// Listens for oasis:cast-firebolt (LMB, mobile Fire: casts the armed spell),
// oasis:cast-lightning-bolt and oasis:cast-ice-bolt (cast that spell).
// Lightning A (plasma) is instant along the aim; lightning D (thunderbolt) strikes from the sky
// at the aimed point.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { PLAYER_BASE_STATS, PASSIVE_MANA_INTERVAL_MS } from '@/lib/player-progression'
import { useAudioManager } from '@/lib/audio-manager'
import { setPlayerSpellCasting } from '@/lib/player-avatar-runtime'
import { preloadSpellSoundManifest, resolveSpellSoundUrl } from '@/lib/spell-sounds'
import { useOasisStore } from '@/store/oasisStore'
import { getPvpEnabled, onHitAward, onRemoteBolt, sendPvpCast, sendPvpReportHit, type PvpHitAwardEvent, type PvpRemoteBolt } from '@/lib/pvp-bridge'
import { VILLAGE_TARGET_PREFIX, damageVillageAgent } from '@/lib/village/village-combat'
import type { OasisSettings } from '@/components/scene-lib/types'
import { isProbablyMobileDevice } from '@/lib/mobile-controls'

import {
  BOLT_CAST_ANIMATION_MS,
  BOLT_DEFAULT_COOLDOWN_MS,
  BOLT_EXPLOSION_TTL_S,
  canCastBolt,
  isQuestFireboltTarget,
  isTypingTarget,
  labelForFireboltTarget,
  randomId,
  recordQuestTargetHit,
} from './bolts/shared'
import type { CombatSpellId, SpellCastResponse } from './bolts/types'
import { collectActorTargets, resolveCombatAim, strikePointFor, worldImpactAlong, type CombatAim } from './bolts/aim'
import { BOLT_MAX_RANGE_M, createBolt, segmentSphereEntry, stepBolt, type ActorTarget, type FlyingBolt, type Vec3 } from './bolts/flight'
import { playBoltSound, preloadBoltSounds } from './bolts/bolt-audio'

// Firebolt designs
import {
  COMET_TRAIL_SPACING_M, COMET_SMOKE_TTL_S,
  CometTailExplosionMesh, CometTailHitMarkerMesh, CometTailMesh, CometTailSmokePuffMesh,
  type CometTailExplosion, type CometTailHitMarker, type CometTailSmokePuff,
} from './bolts/firebolt/comet-tail'
import {
  SOLAR_TRAIL_SPACING_M, SolarFlareExplosionMesh, SolarFlareMesh, SolarFlareTrailMesh,
  type SolarFlareExplosion, type SolarFlareTrailPuff,
} from './bolts/firebolt/solar-flare'
import {
  PHOENIX_TRAIL_SPACING_M, PhoenixEmberMesh, PhoenixExplosionMesh, PhoenixFeatherMesh,
  type PhoenixEmber, type PhoenixExplosion,
} from './bolts/firebolt/phoenix-feather'
// Lightning designs
import {
  PlasmaFilamentImpactMesh, PlasmaFilamentMesh, buildPlasmaBolt,
  type PlasmaFilamentBolt, type PlasmaFilamentImpact,
} from './bolts/lightning-bolt/plasma-filament'
import {
  TeslaCoilImpactMesh, TeslaCoilMesh, TeslaCoilTrailMesh,
  type TeslaCoilImpact, type TeslaCoilTrailPuff,
} from './bolts/lightning-bolt/tesla-coil'
import {
  StormLanceDropletMesh, StormLanceImpactMesh, StormLanceMesh,
  type StormLanceDroplet, type StormLanceImpact,
} from './bolts/lightning-bolt/storm-lance'
import {
  THUNDERBOLT_TELEGRAPH_S, THUNDERBOLT_TTL_S, ThunderboltImpactMesh, ThunderboltMesh, buildThunderbolt, thunderboltPhase,
  type ThunderboltImpact, type ThunderboltStrike,
} from './bolts/lightning-bolt/thunderbolt'
// Ice designs
import {
  CRYSTAL_TRAIL_SPACING_M, CrystalSpearImpactMesh, CrystalSpearMesh, CrystalSpearTrailFlakeMesh,
  type CrystalSpearImpact, type CrystalSpearTrailFlake,
} from './bolts/ice-bolt/crystal-spear'
import {
  FROZEN_TRAIL_SPACING_M, FrozenFlameImpactMesh, FrozenFlameMesh, FrozenFlameSnowflakeMesh,
  type FrozenFlameImpact, type FrozenFlameSnowflake,
} from './bolts/ice-bolt/frozen-flame'
import {
  BOREAL_TRAIL_SPACING_M, BorealSpiralGlyphMesh, BorealSpiralImpactMesh, BorealSpiralMesh,
  type BorealSpiralGlyph, type BorealSpiralImpact,
} from './bolts/ice-bolt/boreal-spiral'

// ─═̷─═̷─🔮 SPELLS AND DESIGNS ─═̷─═̷─🔮
type FlightKind = 'comet' | 'solar' | 'phoenix' | 'tesla' | 'storm' | 'crystal' | 'frozen' | 'boreal'

/** Which flying look a spell + design letter is; null for the non-flying lightning designs (A plasma, D thunderbolt). */
function flightKindFor(spell: CombatSpellId, design: string): FlightKind | null {
  const d = (design || 'A').toUpperCase()
  if (spell === 'firebolt') return d === 'B' ? 'solar' : d === 'C' ? 'phoenix' : 'comet'
  if (spell === 'ice-bolt') return d === 'B' ? 'frozen' : d === 'C' ? 'boreal' : 'crystal'
  if (d === 'B') return 'tesla'
  if (d === 'C') return 'storm'
  return null
}

function resolveActiveSpell(): CombatSpellId | null {
  const selected = useOasisStore.getState().selectedSpellId
  if (selected === 'firebolt' || selected === 'lightning-bolt' || selected === 'ice-bolt') return selected
  // No spell armed, or another one (the machine gun, a creation spell): the click is not ours.
  return null
}

function designFor(spell: CombatSpellId, settings: OasisSettings): string {
  return spell === 'firebolt' ? settings.fireboltDesign : spell === 'lightning-bolt' ? settings.lightningBoltDesign : settings.iceBoltDesign
}

type TrailFx =
  | ({ kind: 'comet' } & CometTailSmokePuff)
  | ({ kind: 'solar' } & SolarFlareTrailPuff)
  | ({ kind: 'phoenix' } & PhoenixEmber)
  | ({ kind: 'tesla' } & TeslaCoilTrailPuff)
  | ({ kind: 'storm' } & StormLanceDroplet)
  | ({ kind: 'crystal' } & CrystalSpearTrailFlake)
  | ({ kind: 'frozen' } & FrozenFlameSnowflake)
  | ({ kind: 'boreal' } & BorealSpiralGlyph)

type ImpactFx =
  | ({ kind: 'comet' } & CometTailExplosion)
  | ({ kind: 'solar' } & SolarFlareExplosion)
  | ({ kind: 'phoenix' } & PhoenixExplosion)
  | ({ kind: 'tesla' } & TeslaCoilImpact)
  | ({ kind: 'storm' } & StormLanceImpact)
  | ({ kind: 'crystal' } & CrystalSpearImpact)
  | ({ kind: 'frozen' } & FrozenFlameImpact)
  | ({ kind: 'boreal' } & BorealSpiralImpact)
  | ({ kind: 'plasma' } & PlasmaFilamentImpact)
  | ({ kind: 'thunder' } & ThunderboltImpact)

const seed = () => Math.floor(Math.random() * 10000)
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }

/** Per flying look: trail spacing, a trail particle, the impact. Caps keep the counts bounded. */
const FLIGHT: Record<FlightKind, { spacing: number; trailCap: number; trail: (p: Vec3, b: FlyingBolt) => TrailFx; impact: (p: Vec3, b: FlyingBolt) => ImpactFx }> = {
  comet: {
    spacing: COMET_TRAIL_SPACING_M, trailCap: 70,
    trail: p => ({ kind: 'comet', id: randomId(), position: p, age: 0, ttl: COMET_SMOKE_TTL_S, seed: seed(), size: 0.22 + Math.random() * 0.1 }),
    impact: p => ({ kind: 'comet', id: randomId(), position: p, age: 0, ttl: BOLT_EXPLOSION_TTL_S, seed: seed() }),
  },
  solar: {
    spacing: SOLAR_TRAIL_SPACING_M, trailCap: 90,
    trail: (p, b) => ({ kind: 'solar', id: randomId(), position: p, direction: b.velocity, age: 0, ttl: 0.45 }),
    impact: p => ({ kind: 'solar', id: randomId(), position: p, age: 0, ttl: BOLT_EXPLOSION_TTL_S * 1.2, seed: seed() }),
  },
  phoenix: {
    spacing: PHOENIX_TRAIL_SPACING_M, trailCap: 150,
    trail: p => ({ kind: 'phoenix', id: randomId(), position: p, velocity: [(Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6], age: 0, ttl: 0.55, hue: Math.random() }),
    impact: (p, b) => ({ kind: 'phoenix', id: randomId(), position: p, age: 0, ttl: 0.95, seed: seed(), upVec: unit(b.velocity) }),
  },
  tesla: {
    spacing: 0.3, trailCap: 100,
    trail: p => ({ kind: 'tesla', id: randomId(), position: p, age: 0, ttl: 0.55, seed: seed() }),
    impact: p => ({ kind: 'tesla', id: randomId(), position: p, age: 0, ttl: 0.85, seed: seed(), normalUp: [0, 1, 0] }),
  },
  storm: {
    spacing: 0.28, trailCap: 120,
    trail: p => ({ kind: 'storm', id: randomId(), position: p, age: 0, ttl: 0.55, seed: seed() }),
    impact: p => ({ kind: 'storm', id: randomId(), position: p, age: 0, ttl: 0.85, seed: seed(), normalUp: [0, 1, 0] }),
  },
  crystal: {
    spacing: CRYSTAL_TRAIL_SPACING_M, trailCap: 120,
    trail: (p, b) => ({ kind: 'crystal', id: randomId(), position: p, age: 0, ttl: 0.6, seed: Math.random() * 100, spinAxis: unit(b.velocity) }),
    impact: p => ({ kind: 'crystal', id: randomId(), position: p, age: 0, ttl: 0.85, seed: seed() }),
  },
  frozen: {
    spacing: FROZEN_TRAIL_SPACING_M, trailCap: 120,
    trail: p => ({ kind: 'frozen', id: randomId(), position: p, age: 0, ttl: 0.9, seed: Math.random() * 100, drift: [(Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4] }),
    impact: p => ({ kind: 'frozen', id: randomId(), position: p, age: 0, ttl: 2, seed: seed() }),
  },
  boreal: {
    spacing: BOREAL_TRAIL_SPACING_M, trailCap: 60,
    trail: (p, b) => ({ kind: 'boreal', id: randomId(), position: p, forward: b.velocity, age: 0, ttl: 0.5, variant: Math.floor(Math.random() * 4) }),
    impact: p => ({ kind: 'boreal', id: randomId(), position: p, age: 0, ttl: 1.1, seed: seed() }),
  },
}
const TRAIL_TOTAL_CAP = 160
const IMPACT_CAP = 12

// ─═̷─═̷─🔊 SOUNDS ─═̷─═̷─🔊
const EXPLOSION_SOUND_ID = 'mixkit-explosion-hit'
/** The cast is a whoosh: the explosion sound (the old firebolt default) belongs to the impact. */
const CAST_WHOOSH_ID = 'mixkit-magic-sparkle-whoosh'

function castSoundUrl(spell: CombatSpellId, settings: OasisSettings): string | null {
  const id = settings.spellSounds?.[spell]
  return resolveSpellSoundUrl(!id || id === EXPLOSION_SOUND_ID ? CAST_WHOOSH_ID : id)
}

function playImpactSound(position: Vec3) {
  if (!playBoltSound(resolveSpellSoundUrl(EXPLOSION_SOUND_ID), position, 0.9)) useAudioManager.getState().play('fireboltHit')
}

// ─═̷─═̷─💧 MANA, as the client knows it ─═̷─═̷─💧
interface ManaView { mana: number; maxMana: number; regen: number; at: number }

function manaNow(view: ManaView | null, now = Date.now()): number | null {
  if (!view) return null
  const gained = Math.floor((now - view.at) / (PASSIVE_MANA_INTERVAL_MS / Math.max(0.1, view.regen)))
  return Math.min(view.maxMana, view.mana + Math.max(0, gained))
}

/** Test and debug handle: the last casts (aim, origin, impact), read by the playtest. */
interface BoltDebugEntry { id: string; spell: CombatSpellId; design: string; fromHand: boolean; origin: Vec3; direction: Vec3; aimPoint: Vec3; impactDistance: number | null; impactObjectId: string | null; impact?: Vec3 | null; impactTarget?: string | null }
function debugLog(): BoltDebugEntry[] | null {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return null
  const host = window as unknown as { __oasisBolts?: { log: BoltDebugEntry[] } }
  host.__oasisBolts ??= { log: [] }
  return host.__oasisBolts.log
}

interface FxState {
  bolts: FlyingBolt[]
  trails: TrailFx[]
  impacts: ImpactFx[]
  markers: CometTailHitMarker[]
  plasma: PlasmaFilamentBolt[]
  strikes: ThunderboltStrike[]
}
const emptyFx = (): FxState => ({ bolts: [], trails: [], impacts: [], markers: [], plasma: [], strikes: [] })
const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]

// ─═̷─═̷─🎯 THE LAYER ─═̷─═̷─🎯
export function CombatBoltLayer({ enabled, settings }: { enabled: boolean; settings: OasisSettings }) {
  const { camera, gl, scene } = useThree()
  // Everything alive lives in one ref, advanced in one frame loop; one render per frame while anything is alive.
  const fxRef = useRef<FxState>(emptyFx())
  const [, setFrame] = useState(0)
  const bump = useCallback(() => setFrame(n => (n + 1) & 0xffff), [])
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const lastCastAtRef = useRef(0)
  const suppressCastFollowupUntilRef = useRef(0)
  const reportedQuestTargetHitsRef = useRef<Set<string>>(new Set())
  // PvP: ids of bolts this client cast; only the caster reports its hits.
  const localBoltIdsRef = useRef<Set<string>>(new Set())
  const manaRef = useRef<ManaView | null>(null)
  // Casts sent whose reply has not come back: a reply's mana is from before them, so they are taken off it.
  const pendingCastsRef = useRef(0)
  const spellStatsRef = useRef<{ speed: number; damage: number; cost: number }>({ speed: PLAYER_BASE_STATS.fireboltSpeedMetersPerSecond, damage: 14, cost: PLAYER_BASE_STATS.fireboltManaCost })
  const flashRef = useRef<{ el: HTMLDivElement | null; alpha: number }>({ el: null, alpha: 0 })

  // ─═̷─ Hits ─═̷─
  const addMarker = useCallback((position: Vec3, label: string, ttl: number) => {
    const fx = fxRef.current
    fx.markers = [...fx.markers.slice(-6), { id: randomId(), position, label, age: 0, ttl }]
  }, [])

  const reportHit = useCallback((boltId: string, targetId: string, position: Vec3, local: boolean) => {
    if (targetId.startsWith(VILLAGE_TARGET_PREFIX)) {
      // A village agent: cosmetic HP only, nothing reaches its Claude Code process.
      damageVillageAgent(targetId.slice(VILLAGE_TARGET_PREFIX.length), undefined, undefined, position)
      return
    }
    if (targetId.startsWith('pvp:')) {
      if (local && localBoltIdsRef.current.has(boltId)) sendPvpReportHit({ boltId, victimSessionId: targetId.slice(4) })
      return
    }
    if (!local) return
    if (isQuestFireboltTarget(targetId)) addMarker(position, labelForFireboltTarget(targetId), 1.15)
    recordQuestTargetHit(targetId, position, reportedQuestTargetHitsRef.current)
  }, [addMarker])

  const awardPvpDamageXp = useCallback((event: PvpHitAwardEvent) => {
    const amount = Math.max(0, Math.floor(Number.isFinite(event.xp) ? event.xp : event.damage))
    if (amount <= 0) return
    addMarker(event.position, `+${amount} XP`, 1.2)
    bump()
    void fetch('/api/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'PVP_DAMAGE', amount }),
    })
      .then(response => response.ok ? response.json().catch(() => null) : null)
      .then(data => { if (data) window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: data })) })
      .catch(() => {})
  }, [addMarker, bump])

  // ─═̷─ Spawning (local casts and remote PvP bolts share it) ─═̷─
  const spawn = useCallback((spell: CombatSpellId, design: string, aim: CombatAim, speed: number, damage: number, id: string, local: boolean) => {
    const fx = fxRef.current
    const kind = flightKindFor(spell, design)
    const designLetter = (design || 'A').toUpperCase()

    if (kind) {
      fx.bolts = [...fx.bolts.slice(-23), createBolt({
        id, spell, design: designLetter,
        origin: v3(aim.origin), direction: v3(aim.direction), speed, damage,
        impactDistance: aim.impactDistance, impactObjectId: aim.impactObjectId, local,
      })]
    } else if (designLetter === 'D') {
      // Thunderbolt: a telegraph ring where it will land, then the strike from the sky.
      const ground = strikePointFor(aim)
      useOasisStore.getState().spawnMarchOrderVfx([ground.x, ground.y, ground.z])
      const strikeSeed = Date.now() & 0xffffffff
      const aimedActor = aim.aimedActor
      window.setTimeout(() => {
        const strike: ThunderboltStrike = {
          id, groundPoint: [ground.x, ground.y, ground.z], age: 0,
          ttl: THUNDERBOLT_TTL_S - THUNDERBOLT_TELEGRAPH_S, damage, seed: strikeSeed,
          segments: buildThunderbolt(ground, strikeSeed),
          target: aimedActor ? { id: aimedActor.id, position: [aimedActor.center[0], ground.y, aimedActor.center[2]], radius: aimedActor.radius } : (aim.impactObjectId ? { id: aim.impactObjectId, position: [ground.x, ground.y, ground.z], radius: 0 } : null),
        }
        ;(strike as ThunderboltStrike & { local?: boolean }).local = local
        fxRef.current.strikes = [...fxRef.current.strikes.slice(-3), strike]
        bump()
      }, THUNDERBOLT_TELEGRAPH_S * 1000)
    } else {
      // Plasma filament: instant, along the aim, up to what it meets (40 m at most). Chains through up to three actors.
      const length = Math.min(40, aim.impactDistance ?? 40)
      const strikeSeed = Date.now() & 0xffffffff
      const actors = collectActorTargets(local)
      const o = v3(aim.origin)
      const d = v3(aim.direction)
      const actorHits = actors
        .map(actor => ({ actor, t: segmentSphereEntry(o, d, length, actor.center, actor.radius) }))
        .filter((h): h is { actor: ActorTarget; t: number } => h.t !== null && h.t > 0.3)
        .sort((a, b) => a.t - b.t)
        .slice(0, 3)
      const end = aim.origin.clone().addScaledVector(aim.direction, actorHits[0]?.t ?? length)
      fx.plasma = [...fx.plasma.slice(-6), {
        id, origin: o, length: actorHits[0]?.t ?? length, direction: d, age: 0, ttl: 0.9, damage, seed: strikeSeed,
        curves: buildPlasmaBolt(aim.origin, aim.direction, actorHits[0]?.t ?? length, strikeSeed),
      }]
      const hitsSomething = actorHits.length > 0 || aim.impactDistance !== null
      window.setTimeout(() => {
        if (hitsSomething) {
          const pos: Vec3 = [end.x, end.y, end.z]
          fxRef.current.impacts = [...fxRef.current.impacts.slice(-IMPACT_CAP), {
            kind: 'plasma', id: randomId(), position: pos, age: 0, ttl: 0.7, seed: strikeSeed,
            groundingTargets: actorHits.slice(1).map(h => h.actor.center),
          }]
          playImpactSound(pos)
          if (actorHits.length > 0) for (const h of actorHits) reportHit(id, h.actor.id, h.actor.center, local)
          else if (aim.impactObjectId) reportHit(id, aim.impactObjectId, pos, local)
          bump()
        }
      }, 120)
    }
    bump()
  }, [bump, reportHit])

  // ─═̷─ Mana bookkeeping (the HUD and server tell us; we spend locally) ─═̷─
  useEffect(() => {
    const onVitals = (event: Event) => {
      const detail = (event as CustomEvent<{ mana?: unknown; maxMana?: unknown; manaRegenMultiplier?: unknown; stats?: { manaRegenMultiplier?: unknown; fireboltDamage?: unknown; fireboltManaCost?: unknown } }>).detail
      if (!detail || typeof detail.mana !== 'number') return
      const regen = typeof detail.manaRegenMultiplier === 'number' ? detail.manaRegenMultiplier
        : typeof detail.stats?.manaRegenMultiplier === 'number' ? detail.stats.manaRegenMultiplier : manaRef.current?.regen ?? 1
      manaRef.current = {
        mana: detail.mana,
        maxMana: typeof detail.maxMana === 'number' ? detail.maxMana : manaRef.current?.maxMana ?? PLAYER_BASE_STATS.mana,
        regen,
        at: Date.now(),
      }
      if (typeof detail.stats?.fireboltDamage === 'number') spellStatsRef.current.damage = detail.stats.fireboltDamage
      if (typeof detail.stats?.fireboltManaCost === 'number') spellStatsRef.current.cost = detail.stats.fireboltManaCost
    }
    window.addEventListener('oasis:player-vitals', onVitals)
    return () => window.removeEventListener('oasis:player-vitals', onVitals)
  }, [])

  // ─═̷─ The cast ─═̷─
  const castBolt = useCallback((forcedSpell?: CombatSpellId) => {
    if (!enabledRef.current || !canCastBolt()) return
    const now = performance.now()
    if (now - lastCastAtRef.current < BOLT_DEFAULT_COOLDOWN_MS) return
    const spell = forcedSpell ?? resolveActiveSpell()
    if (!spell) return
    const { speed, damage, cost } = spellStatsRef.current
    const known = manaNow(manaRef.current)
    if (known !== null && known < cost) {
      window.dispatchEvent(new CustomEvent('oasis:firebolt-failed', { detail: { error: 'Not enough mana' } }))
      return
    }
    lastCastAtRef.current = now

    // Aim now, at the click: not after a server round trip (the old cast read the camera
    // only when the mana POST came back, so a turning player shot wherever they had turned to).
    const s = settingsRef.current
    const design = designFor(spell, s)
    const aim = resolveCombatAim(camera, scene)
    const id = randomId()
    spawn(spell, design, aim, speed, damage, id, true)
    const log = debugLog()
    if (log) {
      log.push({ id, spell, design, fromHand: aim.fromHand, origin: v3(aim.origin), direction: v3(aim.direction), aimPoint: v3(aim.aimPoint), impactDistance: aim.impactDistance, impactObjectId: aim.impactObjectId })
      if (log.length > 40) log.splice(0, log.length - 40)
    }

    if (!playBoltSound(castSoundUrl(spell, s), null, 0.8)) useAudioManager.getState().play('fireboltCast')
    setPlayerSpellCasting(true)
    window.setTimeout(() => setPlayerSpellCasting(false), BOLT_CAST_ANIMATION_MS)

    if (getPvpEnabled()) {
      localBoltIdsRef.current.add(id)
      if (localBoltIdsRef.current.size > 100) {
        const oldest = localBoltIdsRef.current.values().next().value
        if (oldest) localBoltIdsRef.current.delete(oldest)
      }
      sendPvpCast({
        spell, design,
        ox: aim.origin.x, oy: aim.origin.y, oz: aim.origin.z,
        dx: aim.direction.x, dy: aim.direction.y, dz: aim.direction.z,
        speed, damage, seed: Math.floor(Math.random() * 0xffffffff), clientPredictionId: id,
      })
    }
    window.dispatchEvent(new CustomEvent('oasis:spell-cast', { detail: { spell, damage } }))

    // Spend locally now; the server records it (and corrects us) behind.
    if (known !== null && manaRef.current) {
      window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: { ...manaRef.current, mana: known - cost } }))
    }
    pendingCastsRef.current += 1
    const settle = (progression: unknown) => {
      pendingCastsRef.current = Math.max(0, pendingCastsRef.current - 1)
      const p = progression as { mana?: unknown } | undefined
      if (!p || typeof p.mana !== 'number') return null
      return { ...p, mana: Math.max(0, p.mana - cost * pendingCastsRef.current) }
    }
    void fetch('/api/profile/spells/firebolt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: useOasisStore.getState().activeWorldId, spell }),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({})) as SpellCastResponse
        if (typeof data.spell?.speedMetersPerSecond === 'number') spellStatsRef.current.speed = data.spell.speedMetersPerSecond
        if (typeof data.spell?.damage === 'number') spellStatsRef.current.damage = data.spell.damage
        const progression = settle(data.progression)
        if (!response.ok || !data.ok) {
          if (progression) window.dispatchEvent(new CustomEvent('oasis:firebolt-failed', { detail: { ...data, progression } }))
          return
        }
        if (progression) window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: progression }))
      })
      .catch(() => { settle(undefined) })
  }, [camera, scene, spawn])

  useEffect(() => {
    void preloadSpellSoundManifest().then(() => {
      preloadBoltSounds([resolveSpellSoundUrl(EXPLOSION_SOUND_ID), resolveSpellSoundUrl(CAST_WHOOSH_ID)])
    })
  }, [])

  useEffect(() => onHitAward(awardPvpDamageXp), [awardPvpDamageXp])

  // PvP: a peer's bolt flies the same path here (no mana, no XP: the caster paid).
  useEffect(() => onRemoteBolt((bolt: PvpRemoteBolt) => {
    const origin = new THREE.Vector3(...bolt.origin)
    const direction = new THREE.Vector3(...bolt.direction).normalize()
    const hit = worldImpactAlong(scene, origin, direction)
    const aim: CombatAim = {
      origin, direction,
      aimPoint: origin.clone().addScaledVector(direction, hit?.distance ?? BOLT_MAX_RANGE_M),
      impactDistance: hit?.distance ?? null, impactObjectId: hit?.objectId ?? null, aimedActor: null, fromHand: true,
    }
    playBoltSound(castSoundUrl(bolt.spell, settingsRef.current), [origin.x, origin.y, origin.z], 0.8)
    spawn(bolt.spell, bolt.design || 'A', aim, bolt.speed, bolt.damage, bolt.id, false)
  }), [scene, spawn])

  // ─═̷─ Input ─═̷─
  useEffect(() => {
    const onArmed = () => castBolt(undefined)
    const onLightning = () => castBolt('lightning-bolt')
    const onIce = () => castBolt('ice-bolt')
    window.addEventListener('oasis:cast-firebolt', onArmed)
    window.addEventListener('oasis:cast-lightning-bolt', onLightning)
    window.addEventListener('oasis:cast-ice-bolt', onIce)
    return () => {
      window.removeEventListener('oasis:cast-firebolt', onArmed)
      window.removeEventListener('oasis:cast-lightning-bolt', onLightning)
      window.removeEventListener('oasis:cast-ice-bolt', onIce)
    }
  }, [castBolt])

  useEffect(() => {
    if (!enabled) return
    const canvas = gl.domElement
    const isCanvasEvent = (event: Event) => event.target instanceof Node && canvas.contains(event.target)
    const swallowCastFollowup = (event: Event) => {
      if (Date.now() > suppressCastFollowupUntilRef.current || !isCanvasEvent(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !isCanvasEvent(event) || isTypingTarget(event.target)) return
      if (document.pointerLockElement !== canvas && !isProbablyMobileDevice()) return
      if (!canCastBolt() || !resolveActiveSpell()) return
      suppressCastFollowupUntilRef.current = Date.now() + 700
      event.preventDefault()
      event.stopImmediatePropagation()
      castBolt(undefined)
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointerup', swallowCastFollowup, { capture: true })
    window.addEventListener('click', swallowCastFollowup, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointerup', swallowCastFollowup, { capture: true })
      window.removeEventListener('click', swallowCastFollowup, { capture: true })
    }
  }, [castBolt, enabled, gl])

  // ─═̷─ Shader warm-up: the first time play mode is on, every design's look is mounted once
  // and stays (BoltWarmup): drawn for three frames through the real pipeline, then hidden, so
  // its shader programs are built then and never released (Storm Lance used to rebuild its
  // shader on every cast; a design's first cast stalled 80-180 ms). ─═̷─
  const [warm, setWarm] = useState(false)
  useEffect(() => { if (enabled) setWarm(true) }, [enabled])

  // ─═̷─ Thunder flash: one DOM div, its opacity set from the frame loop (no React state) ─═̷─
  useEffect(() => {
    const el = document.createElement('div')
    el.setAttribute('data-thunderbolt-flash', '')
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,240,1);opacity:0;pointer-events:none;z-index:80;mix-blend-mode:screen;'
    document.body.appendChild(el)
    flashRef.current.el = el
    return () => { el.remove(); flashRef.current.el = null }
  }, [])

  // ─═̷─═̷─🔁 ONE FRAME LOOP ─═̷─═̷─🔁
  useFrame((_, rawDelta) => {
    const fx = fxRef.current
    const flash = flashRef.current
    const alive = fx.bolts.length + fx.trails.length + fx.impacts.length + fx.markers.length + fx.plasma.length + fx.strikes.length
    if (alive === 0 && flash.alpha <= 0) return
    // A long frame (tab hidden, a hitch) must not teleport bolts through what they should hit.
    const delta = Math.min(rawDelta, 0.1)

    // Flying bolts
    if (fx.bolts.length > 0) {
      const actorsLocal = collectActorTargets(true)
      let actorsRemote: ActorTarget[] | null = null
      const nextBolts: FlyingBolt[] = []
      const newTrails: TrailFx[] = []
      for (const bolt of fx.bolts) {
        const kind = flightKindFor(bolt.spell, bolt.design) ?? 'comet'
        const look = FLIGHT[kind]
        const actors = bolt.local ? actorsLocal : (actorsRemote ??= collectActorTargets(false))
        const step = stepBolt(bolt, delta, actors, look.spacing)
        for (const p of step.trail) newTrails.push(look.trail(p, bolt))
        if (step.bolt) nextBolts.push(step.bolt)
        if (step.impact) {
          // Burst a hand's breadth in front of the surface, not inside it.
          const back = unit(bolt.velocity)
          const p: Vec3 = step.impact.actor ? step.impact.position : [step.impact.position[0] - back[0] * 0.12, step.impact.position[1] - back[1] * 0.12, step.impact.position[2] - back[2] * 0.12]
          fx.impacts = [...fx.impacts.slice(-IMPACT_CAP), look.impact(p, bolt)]
          playImpactSound(p)
          if (step.impact.targetId) reportHit(bolt.id, step.impact.targetId, p, bolt.local)
          const entry = bolt.local ? debugLog()?.find(e => e.id === bolt.id) : undefined
          if (entry && !entry.impact) { entry.impact = p; entry.impactTarget = step.impact.targetId }
        }
      }
      fx.bolts = nextBolts
      if (newTrails.length > 0) fx.trails = [...fx.trails, ...newTrails].slice(-TRAIL_TOTAL_CAP)
    }

    // Age trails, impacts, markers, plasma
    if (fx.trails.length > 0) {
      fx.trails = fx.trails.filter(t => t.age + delta < t.ttl).map(t => {
        if (t.kind !== 'phoenix') return { ...t, age: t.age + delta }
        return {
          ...t,
          age: t.age + delta,
          position: [t.position[0] + t.velocity[0] * delta, t.position[1] + t.velocity[1] * delta, t.position[2] + t.velocity[2] * delta],
          velocity: [t.velocity[0] * 0.94, t.velocity[1] * 0.95 - 0.4 * delta, t.velocity[2] * 0.94],
        }
      })
    }
    if (fx.impacts.length > 0) fx.impacts = fx.impacts.filter(i => i.age + delta < i.ttl).map(i => ({ ...i, age: i.age + delta }))
    if (fx.markers.length > 0) fx.markers = fx.markers.filter(m => m.age + delta < m.ttl).map(m => ({ ...m, age: m.age + delta }))
    if (fx.plasma.length > 0) fx.plasma = fx.plasma.filter(b => b.age + delta < b.ttl).map(b => ({ ...b, age: b.age + delta }))

    // Thunderbolt strikes: the impact lands the frame the bolt reaches the ground.
    if (fx.strikes.length > 0) {
      const next: ThunderboltStrike[] = []
      for (const s of fx.strikes) {
        const age = s.age + delta
        if (!thunderboltPhase(s.age).justStruck && thunderboltPhase(age).justStruck) {
          flash.alpha = 0.7
          fx.impacts = [...fx.impacts.slice(-IMPACT_CAP), { kind: 'thunder', id: randomId(), position: s.groundPoint, age: 0, ttl: 0.85, seed: s.seed }]
          playImpactSound(s.groundPoint)
          const local = (s as ThunderboltStrike & { local?: boolean }).local !== false
          if (s.target) {
            const [tx, ty, tz] = s.target.position
            reportHit(s.id, s.target.id, s.target.id.startsWith(VILLAGE_TARGET_PREFIX) ? [tx, ty + 1.05, tz] : s.groundPoint, local)
          }
        }
        if (age < s.ttl) next.push({ ...s, age })
      }
      fx.strikes = next
    }
    if (flash.alpha > 0) {
      flash.alpha = Math.max(0, flash.alpha - delta * 2.4)
      if (flash.el) flash.el.style.opacity = String(flash.alpha)
    }

    bump()
  })

  const fx = fxRef.current
  return (
    <group name="combat-bolt-layer">
      {warm && <BoltWarmup />}
      {fx.trails.map(t => <TrailView key={t.id} fx={t} />)}
      {fx.bolts.map(b => <BoltView key={b.id} bolt={b} />)}
      {fx.impacts.map(i => <ImpactView key={i.id} fx={i} />)}
      {fx.markers.map(m => <CometTailHitMarkerMesh key={m.id} marker={m} />)}
      {fx.plasma.map(b => <PlasmaFilamentMesh key={b.id} bolt={b} />)}
      {fx.strikes.map(s => <ThunderboltMesh key={s.id} strike={s} />)}
    </group>
  )
}

// ─═̷─═̷─🔥 WARM-UP SET ─═̷─═̷─🔥
const WARM_Y = -1000
const FLIGHT_KINDS: FlightKind[] = ['comet', 'solar', 'phoenix', 'tesla', 'storm', 'crystal', 'frozen', 'boreal']
const KIND_SPELL: Record<FlightKind, [CombatSpellId, string]> = {
  comet: ['firebolt', 'A'], solar: ['firebolt', 'B'], phoenix: ['firebolt', 'C'],
  tesla: ['lightning-bolt', 'B'], storm: ['lightning-bolt', 'C'],
  crystal: ['ice-bolt', 'A'], frozen: ['ice-bolt', 'B'], boreal: ['ice-bolt', 'C'],
}

/** One of every look, frozen mid-life, out of sight (frustum-culled, never drawn). Mounted once, never re-rendered. */
const BoltWarmup = memo(function BoltWarmup() {
  const set = useMemo(() => {
    const p: Vec3 = [0, 0, 0]
    const bolts = FLIGHT_KINDS.map(kind => {
      const [spell, design] = KIND_SPELL[kind]
      return { ...createBolt({ id: `warm-${kind}`, spell, design, origin: p, direction: [0, 0, -1], speed: 24, damage: 0, impactDistance: null, impactObjectId: null, local: false }), age: 0.2 }
    })
    const trails = bolts.map(b => ({ ...FLIGHT[flightKindFor(b.spell, b.design) ?? 'comet'].trail(p, b), age: 0.1 }))
    const impacts: ImpactFx[] = bolts.map(b => ({ ...FLIGHT[flightKindFor(b.spell, b.design) ?? 'comet'].impact(p, b), age: 0.1 }))
    impacts.push({ kind: 'plasma', id: 'warm-plasma-i', position: p, age: 0.1, ttl: 0.7, seed: 1, groundingTargets: [] })
    impacts.push({ kind: 'thunder', id: 'warm-thunder-i', position: p, age: 0.1, ttl: 0.85, seed: 1 })
    const zero = new THREE.Vector3()
    const dir = new THREE.Vector3(0, 0, -1)
    const plasma: PlasmaFilamentBolt = { id: 'warm-plasma', origin: p, length: 4, direction: [0, 0, -1], age: 0.1, ttl: 0.9, damage: 0, seed: 1, curves: buildPlasmaBolt(zero, dir, 4, 1) }
    const strike: ThunderboltStrike = { id: 'warm-strike', groundPoint: p, age: 0.5, ttl: 1, damage: 0, seed: 1, segments: buildThunderbolt(zero, 1), target: null }
    return { bolts, trails, impacts, plasma, strike }
  }, [])
  const groupRef = useRef<THREE.Group>(null)
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    // Drawn (not culled) for three frames, through the same render target and post-processing
    // as everything else, so the programs match the real ones; then hidden for good.
    group.traverse(object => { object.frustumCulled = false })
    let frames = 0
    let raf = requestAnimationFrame(function tick() {
      frames += 1
      if (frames < 4) { raf = requestAnimationFrame(tick); return }
      group.visible = false
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <group ref={groupRef} name="combat-bolt-warmup" position={[0, WARM_Y, 0]}>
      {set.trails.map(t => <TrailView key={t.id} fx={t} />)}
      {set.bolts.map(b => <BoltView key={b.id} bolt={b} />)}
      {set.impacts.map(i => <ImpactView key={i.id} fx={i} />)}
      <PlasmaFilamentMesh bolt={set.plasma} />
      <ThunderboltMesh strike={set.strike} />
    </group>
  )
})

// ─═̷─═̷─🎨 LOOKS ─═̷─═̷─🎨
function BoltView({ bolt }: { bolt: FlyingBolt }) {
  switch (flightKindFor(bolt.spell, bolt.design)) {
    case 'solar': return <SolarFlareMesh projectile={bolt} />
    case 'phoenix': return <PhoenixFeatherMesh projectile={bolt} />
    case 'tesla': return <TeslaCoilMesh projectile={bolt} />
    case 'storm': return <StormLanceMesh projectile={bolt} />
    case 'crystal': return <CrystalSpearMesh projectile={bolt} />
    case 'frozen': return <FrozenFlameMesh projectile={bolt} />
    case 'boreal': return <BorealSpiralMesh projectile={bolt} />
    default: return <CometTailMesh projectile={bolt} />
  }
}

function TrailView({ fx }: { fx: TrailFx }) {
  switch (fx.kind) {
    case 'comet': return <CometTailSmokePuffMesh puff={fx} />
    case 'solar': return <SolarFlareTrailMesh puff={fx} />
    case 'phoenix': return <PhoenixEmberMesh ember={fx} />
    case 'tesla': return <TeslaCoilTrailMesh puff={fx} />
    case 'storm': return <StormLanceDropletMesh droplet={fx} />
    case 'crystal': return <CrystalSpearTrailFlakeMesh flake={fx} />
    case 'frozen': return <FrozenFlameSnowflakeMesh flake={fx} />
    case 'boreal': return <BorealSpiralGlyphMesh glyph={fx} />
  }
}

function ImpactView({ fx }: { fx: ImpactFx }) {
  switch (fx.kind) {
    case 'comet': return <CometTailExplosionMesh explosion={fx} />
    case 'solar': return <SolarFlareExplosionMesh explosion={fx} />
    case 'phoenix': return <PhoenixExplosionMesh explosion={fx} />
    case 'tesla': return <TeslaCoilImpactMesh impact={fx} />
    case 'storm': return <StormLanceImpactMesh impact={fx} />
    case 'crystal': return <CrystalSpearImpactMesh impact={fx} />
    case 'frozen': return <FrozenFlameImpactMesh impact={fx} />
    case 'boreal': return <BorealSpiralImpactMesh impact={fx} />
    case 'plasma': return <PlasmaFilamentImpactMesh impact={fx} />
    case 'thunder': return <ThunderboltImpactMesh impact={fx} />
  }
}


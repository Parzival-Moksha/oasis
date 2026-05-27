// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// COMBAT-BOLT LAYER — the dispatcher.
//
// Replaces FireboltLayer at the Scene mount. Listens for:
//   * oasis:cast-firebolt          — fired by LMB / mobile Fire button
//   * oasis:cast-lightning-bolt    — (future direct trigger)
//   * oasis:cast-ice-bolt          — (future direct trigger)
// LMB-on-canvas → dispatches based on `selectedSpellId` (firebolt by default).
// Mobile-fire-button always dispatches `oasis:cast-firebolt`; this layer
// then re-routes to the armed spell if that spell is not firebolt.
//
// For each spell, the design letter from `settings.<spell>Design` selects
// which sub-module renders. All projectiles share:
//   * the same projectile→hit collision pipeline (segmentSphereHit, groundHit)
//   * the same mana-cost POST flow (currently firebolt-only endpoint — we
//     reuse it for lightning/ice too until those routes ship; impact + XP
//     fall through the same recordQuestTargetHit path).
//
// The Thunderbolt design (lightning D) is special: it skips the projectile
// flight loop and instead bakes geometry from y=15 down to the aimed-ground
// point, then animates the reveal.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { PLAYER_BASE_STATS } from '@/lib/player-progression'
import { useAudioManager } from '@/lib/audio-manager'
import { setPlayerSpellCasting } from '@/lib/player-avatar-runtime'
import { preloadSpellSoundManifest, resolveSpellSoundUrl } from '@/lib/spell-sounds'
import { getAudioListener } from '@/components/CameraController'
import { useOasisStore } from '@/store/oasisStore'
import { getPvpEnabled, onHitAward, onRemoteBolt, sendPvpCast, sendPvpReportHit, type PvpHitAwardEvent, type PvpRemoteBolt } from '@/lib/pvp-bridge'
import type { OasisSettings } from '@/components/scene-lib/types'
import { isProbablyMobileDevice } from '@/lib/mobile-controls'

import {
  BOLT_ARMING_DISTANCE_M,
  BOLT_CAST_ANIMATION_MS,
  BOLT_DEFAULT_COOLDOWN_MS,
  BOLT_DEFAULT_TTL_S,
  BOLT_EXPLOSION_TTL_S,
  BOLT_GROUND_ARMING_DISTANCE_M,
  aimedGroundPoint,
  armedSegment,
  canCastBolt,
  collectCollisionTargets,
  groundHit,
  isQuestFireboltTarget,
  isTypingTarget,
  labelForFireboltTarget,
  randomId,
  recordQuestTargetHit,
  resolveCastOriginAndDirection,
  segmentSphereHit,
} from './bolts/shared'
import type { CollisionTarget, CombatSpellId, SpellCastResponse } from './bolts/types'

// Firebolt designs
import {
  COMET_TRAIL_SPACING_M,
  COMET_SMOKE_TTL_S,
  CometTailExplosionMesh,
  CometTailHitMarkerMesh,
  CometTailMesh,
  CometTailSmokePuffMesh,
  type CometTailExplosion,
  type CometTailHitMarker,
  type CometTailProjectile,
  type CometTailSmokePuff,
} from './bolts/firebolt/comet-tail'
import {
  SOLAR_TRAIL_SPACING_M,
  SolarFlareExplosionMesh,
  SolarFlareMesh,
  SolarFlareTrailMesh,
  type SolarFlareExplosion,
  type SolarFlareProjectile,
  type SolarFlareTrailPuff,
} from './bolts/firebolt/solar-flare'
import {
  PHOENIX_TRAIL_SPACING_M,
  PhoenixEmberMesh,
  PhoenixExplosionMesh,
  PhoenixFeatherMesh,
  type PhoenixEmber,
  type PhoenixExplosion,
  type PhoenixFeatherProjectile,
} from './bolts/firebolt/phoenix-feather'

// Lightning designs
import {
  PlasmaFilamentImpactMesh,
  PlasmaFilamentMesh,
  buildPlasmaBolt,
  type PlasmaFilamentBolt,
  type PlasmaFilamentImpact,
} from './bolts/lightning-bolt/plasma-filament'
import {
  TeslaCoilImpactMesh,
  TeslaCoilMesh,
  TeslaCoilTrailMesh,
  type TeslaCoilImpact,
  type TeslaCoilProjectile,
  type TeslaCoilTrailPuff,
} from './bolts/lightning-bolt/tesla-coil'
import {
  StormLanceDropletMesh,
  StormLanceImpactMesh,
  StormLanceMesh,
  type StormLanceDroplet,
  type StormLanceImpact,
  type StormLanceProjectile,
} from './bolts/lightning-bolt/storm-lance'
import {
  THUNDERBOLT_TELEGRAPH_S,
  THUNDERBOLT_TTL_S,
  ThunderboltImpactMesh,
  ThunderboltMesh,
  buildThunderbolt,
  thunderboltPhase,
  type ThunderboltImpact,
  type ThunderboltStrike,
} from './bolts/lightning-bolt/thunderbolt'

// Ice designs
import {
  CRYSTAL_TRAIL_SPACING_M,
  CrystalSpearImpactMesh,
  CrystalSpearMesh,
  CrystalSpearTrailFlakeMesh,
  type CrystalSpearImpact,
  type CrystalSpearProjectile,
  type CrystalSpearTrailFlake,
} from './bolts/ice-bolt/crystal-spear'
import {
  FROZEN_TRAIL_SPACING_M,
  FrozenFlameImpactMesh,
  FrozenFlameMesh,
  FrozenFlameSnowflakeMesh,
  type FrozenFlameImpact,
  type FrozenFlameProjectile,
  type FrozenFlameSnowflake,
} from './bolts/ice-bolt/frozen-flame'
import {
  BOREAL_TRAIL_SPACING_M,
  BorealSpiralGlyphMesh,
  BorealSpiralImpactMesh,
  BorealSpiralMesh,
  type BorealSpiralGlyph,
  type BorealSpiralImpact,
  type BorealSpiralProjectile,
} from './bolts/ice-bolt/boreal-spiral'

// ─═̷─═̷─🔮 SPELL ROUTING ─═̷─═̷─🔮
function resolveActiveSpell(): CombatSpellId | null {
  const selected = useOasisStore.getState().selectedSpellId
  if (selected === 'lightning-bolt') return 'lightning-bolt'
  if (selected === 'ice-bolt') return 'ice-bolt'
  if (selected === 'firebolt') return 'firebolt'
  // No spell armed, or a non-combat spell selected. LMB-on-canvas must NOT
  // silently drain mana — let the caller early-out.
  return null
}

function castEndpointFor(spell: CombatSpellId): string {
  // Lightning/ice routes don't exist yet (per current repo). Until they
  // ship, route through the firebolt endpoint which handles mana cost
  // + progression broadcast. The visual + audio differ; the cost is the same.
  void spell
  return '/api/profile/spells/firebolt'
}

interface CommonProjectileBase {
  id: string
  origin: [number, number, number]
  position: [number, number, number]
  velocity: [number, number, number]
  distance: number
  age: number
  ttl: number
  damage: number
  trailCarry: number
  /** Which design owns this projectile — drives render/spawn rules. */
  design: ActiveDesignTag
}

type ActiveDesignTag =
  | 'firebolt-A'
  | 'firebolt-B'
  | 'firebolt-C'
  | 'lightning-A'
  | 'lightning-B'
  | 'lightning-C'
  | 'ice-A'
  | 'ice-B'
  | 'ice-C'

// ─═̷─═̷─🎯 COMBAT BOLT LAYER COMPONENT ─═̷─═̷─🎯
const BOLT_SPATIAL_RANGE_M = 20
const EXPLOSION_SPATIAL_RANGE_M = 30
const SPATIAL_CAST_SOUND_TTL_S = BOLT_DEFAULT_TTL_S
const SPATIAL_EXPLOSION_SOUND_TTL_S = 2.4
const EXPLOSION_SOUND_ID = 'mixkit-explosion-hit'

interface SpatialSoundEvent {
  id: string
  url: string
  position: [number, number, number]
  age: number
  ttl: number
  maxDistance: number
  volumeMultiplier: number
  followId?: string
}

const spatialAudioBufferCache = new Map<string, Promise<AudioBuffer | null>>()

function loadSpatialAudioBuffer(url: string): Promise<AudioBuffer | null> {
  const existing = spatialAudioBufferCache.get(url)
  if (existing) return existing
  const promise = new Promise<AudioBuffer | null>((resolve) => {
    new THREE.AudioLoader().load(
      url,
      buffer => resolve(buffer),
      undefined,
      () => resolve(null),
    )
  })
  spatialAudioBufferCache.set(url, promise)
  return promise
}

function SpatialSoundSource({ sound }: { sound: SpatialSoundEvent }) {
  const groupRef = useRef<THREE.Group>(null)

  useEffect(() => {
    const listener = getAudioListener()
    const group = groupRef.current
    const audioState = useAudioManager.getState()
    if (!listener || !group || audioState.muted || audioState.volume <= 0) return

    let cancelled = false
    let positional: THREE.PositionalAudio | null = null

    void listener.context.resume().catch(() => {})
    void loadSpatialAudioBuffer(sound.url).then(buffer => {
      if (cancelled || !buffer || !groupRef.current) return
      positional = new THREE.PositionalAudio(listener)
      positional.setBuffer(buffer)
      positional.setDistanceModel('linear')
      positional.setRefDistance(0.01)
      positional.setMaxDistance(sound.maxDistance)
      positional.setRolloffFactor(1)
      positional.setVolume(audioState.volume * sound.volumeMultiplier)
      groupRef.current.add(positional)
      positional.play()
    })

    return () => {
      cancelled = true
      if (positional) {
        try {
          if (positional.isPlaying) positional.stop()
        } catch {}
        group.remove(positional)
        positional.disconnect()
      }
    }
  }, [sound.id, sound.maxDistance, sound.url, sound.volumeMultiplier])

  return <group ref={groupRef} position={sound.position} />
}

export function CombatBoltLayer({ enabled, settings }: { enabled: boolean; settings: OasisSettings }) {
  const { camera, gl } = useThree()
  const lastCastAtRef = useRef(0)
  const castingRef = useRef(false)
  const suppressCastFollowupUntilRef = useRef(0)
  const reportedQuestTargetHitsRef = useRef<Set<string>>(new Set())
  // ─═̷─ PvP bolt-id tracking ─═̷─
  // Bolts cast by THIS client get their clientPredictionId stored here so
  // that when a hit is detected against a peer player we know we are the
  // caster and should fire `reportHit`. Bolts that arrived from a remote
  // caster never make it into this set, so peer-side hit detection
  // can't double-report them.
  const localBoltIdsRef = useRef<Set<string>>(new Set())
  const [xpHitMarkers, setXpHitMarkers] = useState<CometTailHitMarker[]>([])
  const [spatialSounds, setSpatialSounds] = useState<SpatialSoundEvent[]>([])
  const playSpatialExplosionSoundRef = useRef<(position: [number, number, number]) => void>(() => {
    useAudioManager.getState().play('fireboltHit')
  })

  const spawnXpHitMarker = useCallback((position: [number, number, number], xp: number) => {
    const amount = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0))
    if (amount <= 0) return
    setXpHitMarkers(prev => [
      ...prev.slice(-7),
      {
        id: randomId(),
        position,
        label: `+${amount} XP`,
        age: 0,
        ttl: 1.2,
      },
    ])
  }, [])

  const awardPvpDamageXp = useCallback((event: PvpHitAwardEvent) => {
    const amount = Math.max(0, Math.floor(Number.isFinite(event.xp) ? event.xp : event.damage))
    if (amount <= 0) return
    spawnXpHitMarker(event.position, amount)
    void fetch('/api/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'PVP_DAMAGE', amount }),
    })
      .then(response => response.ok ? response.json().catch(() => null) : null)
      .then(data => {
        if (data) window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: data }))
      })
      .catch(() => {})
  }, [spawnXpHitMarker])

  // Hit dispatcher. PvP-player targets route to the room; everything else
  // (objects, NPCs, quest dummies) uses the original quest-progression path.
  const reportHit = useCallback((boltId: string, target: CollisionTarget, position: [number, number, number], setMarker:
    | ((updater: (prev: CometTailHitMarker[]) => CometTailHitMarker[]) => void)
    | null,
  ) => {
    if (target.id.startsWith('pvp:')) {
      // Only the caster reports their own bolt's hits — remote bolts that
      // happen to pass through a peer capsule on this client should not
      // generate a reportHit (the originating client will do that).
      if (localBoltIdsRef.current.has(boltId)) {
        sendPvpReportHit({ boltId, victimSessionId: target.id.slice(4) })
      }
      return
    }
    handleTargetHit(target, position, reportedQuestTargetHitsRef.current, setMarker)
  }, [])

  // ─═̷─═̷─📦 PROJECTILE STATE BUCKETS — per design ─═̷─═̷─📦
  // Comet Tail (firebolt A)
  const [cometProjectiles, setCometProjectiles] = useState<CometTailProjectile[]>([])
  const [cometSmoke, setCometSmoke] = useState<CometTailSmokePuff[]>([])
  const [cometExplosions, setCometExplosions] = useState<CometTailExplosion[]>([])
  const [cometHitMarkers, setCometHitMarkers] = useState<CometTailHitMarker[]>([])

  // Solar Flare (firebolt B)
  const [solarProjectiles, setSolarProjectiles] = useState<SolarFlareProjectile[]>([])
  const [solarTrail, setSolarTrail] = useState<SolarFlareTrailPuff[]>([])
  const [solarExplosions, setSolarExplosions] = useState<SolarFlareExplosion[]>([])

  // Phoenix Feather (firebolt C)
  const [phoenixProjectiles, setPhoenixProjectiles] = useState<PhoenixFeatherProjectile[]>([])
  const [phoenixEmbers, setPhoenixEmbers] = useState<PhoenixEmber[]>([])
  const [phoenixExplosions, setPhoenixExplosions] = useState<PhoenixExplosion[]>([])

  // Plasma Filament (lightning A) — instant bolt: no flight loop
  const [plasmaBolts, setPlasmaBolts] = useState<PlasmaFilamentBolt[]>([])
  const [plasmaImpacts, setPlasmaImpacts] = useState<PlasmaFilamentImpact[]>([])

  // Tesla Coil (lightning B)
  const [teslaProjectiles, setTeslaProjectiles] = useState<TeslaCoilProjectile[]>([])
  const [teslaTrail, setTeslaTrail] = useState<TeslaCoilTrailPuff[]>([])
  const [teslaImpacts, setTeslaImpacts] = useState<TeslaCoilImpact[]>([])

  // Storm Lance (lightning C)
  const [stormProjectiles, setStormProjectiles] = useState<StormLanceProjectile[]>([])
  const [stormDroplets, setStormDroplets] = useState<StormLanceDroplet[]>([])
  const [stormImpacts, setStormImpacts] = useState<StormLanceImpact[]>([])

  // Thunderbolt (lightning D) — non-projectile
  const [thunderStrikes, setThunderStrikes] = useState<ThunderboltStrike[]>([])
  const [thunderImpacts, setThunderImpacts] = useState<ThunderboltImpact[]>([])
  const [thunderFlashAlpha, setThunderFlashAlpha] = useState<number>(0)
  const lastThunderStrikeMomentRef = useRef<Map<string, number>>(new Map())

  // Crystal Spear (ice A)
  const [crystalProjectiles, setCrystalProjectiles] = useState<CrystalSpearProjectile[]>([])
  const [crystalFlakes, setCrystalFlakes] = useState<CrystalSpearTrailFlake[]>([])
  const [crystalImpacts, setCrystalImpacts] = useState<CrystalSpearImpact[]>([])

  // Frozen Flame (ice B)
  const [frozenProjectiles, setFrozenProjectiles] = useState<FrozenFlameProjectile[]>([])
  const [frozenFlakes, setFrozenFlakes] = useState<FrozenFlameSnowflake[]>([])
  const [frozenImpacts, setFrozenImpacts] = useState<FrozenFlameImpact[]>([])

  // Boreal Spiral (ice C)
  const [borealProjectiles, setBorealProjectiles] = useState<BorealSpiralProjectile[]>([])
  const [borealGlyphs, setBorealGlyphs] = useState<BorealSpiralGlyph[]>([])
  const [borealImpacts, setBorealImpacts] = useState<BorealSpiralImpact[]>([])

  // ─═̷─═̷─🚀 SPAWNERS ─═̷─═̷─🚀
  // Optional boltId lets the PvP cast path thread its clientPredictionId
  // into the local projectile, so peer-player hit detection can use the
  // same id when reporting to the server. Falls back to randomId() for
  // pure single-player casts (no broadcast in flight).
  const spawnFireboltA = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setCometProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnFireboltB = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setSolarProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnFireboltC = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setPhoenixProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnLightningA = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, damage: number, boltId?: string) => {
    // Plasma filament: instant geometry; just check collision at cast-line.
    const length = 28
    const seed = Date.now() & 0xffffffff
    const curves = buildPlasmaBolt(origin, direction, length, seed)
    const targets = collectCollisionTargets()
    const start = origin.clone().addScaledVector(direction, BOLT_ARMING_DISTANCE_M)
    const end = origin.clone().addScaledVector(direction, length)
    const hits: { id: string; position: THREE.Vector3 }[] = []
    for (const target of targets) {
      const targetCenter = new THREE.Vector3(target.position[0], target.position[1] + Math.min(1.4, target.radius), target.position[2])
      const hit = segmentSphereHit(start, end, targetCenter, target.radius)
      if (hit) hits.push({ id: target.id, position: hit })
    }
    // PvP hit-report for plasma filament: the projectile is instant, so we
    // resolve here at cast time rather than in the per-frame loop.
    if (boltId && localBoltIdsRef.current.has(boltId)) {
      for (const hit of hits) {
        if (hit.id.startsWith('pvp:')) {
          sendPvpReportHit({ boltId, victimSessionId: hit.id.slice(4) })
        }
      }
    }
    setPlasmaBolts(prev => [...prev.slice(-6), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      length,
      direction: [direction.x, direction.y, direction.z],
      age: 0,
      ttl: 0.9,
      damage,
      seed,
      curves,
    }])
    // Schedule an impact at the first hit (or at end of bolt path if none)
    const impactPosition = hits[0]?.position ?? end.clone()
    const groundingTargets = hits.slice(1, 4).map(h => [h.position.x, h.position.y, h.position.z] as [number, number, number])
    window.setTimeout(() => {
      setPlasmaImpacts(prev => [...prev.slice(-6), {
        id: randomId(),
        position: [impactPosition.x, Math.max(0.05, impactPosition.y), impactPosition.z],
        age: 0,
        ttl: 0.7,
        seed,
        groundingTargets,
      }])
      playSpatialExplosionSoundRef.current([impactPosition.x, Math.max(0.05, impactPosition.y), impactPosition.z])
      if (hits[0] && isQuestFireboltTarget(hits[0].id)) {
        recordQuestTargetHit(hits[0].id, [impactPosition.x, impactPosition.y, impactPosition.z], reportedQuestTargetHitsRef.current)
      } else if (hits[0]) {
        window.dispatchEvent(new CustomEvent('oasis:firebolt-hit', { detail: { targetId: hits[0].id, position: [impactPosition.x, impactPosition.y, impactPosition.z], worldId: useOasisStore.getState().activeWorldId } }))
      }
    }, 400)
  }, [])

  const spawnLightningB = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setTeslaProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnLightningC = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setStormProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnLightningD = useCallback((damage: number, boltId?: string) => {
    const groundPoint = aimedGroundPoint(camera, 35)
    if (!groundPoint) return
    // Telegraph: arrow-loop VFX at the ground point.
    useOasisStore.getState().spawnMarchOrderVfx([groundPoint.x, groundPoint.y, groundPoint.z])
    const seed = Date.now() & 0xffffffff
    // Wait for telegraph before generating the bolt.
    window.setTimeout(() => {
      const segments = buildThunderbolt(groundPoint, seed)
      const targets = collectCollisionTargets()
      // Match ground-point against targets (so the bolt's impact can credit
      // them like other bolts do).
      let hitTarget: CollisionTarget | null = null
      for (const target of targets) {
        const center = new THREE.Vector3(target.position[0], target.position[1] + Math.min(1.4, target.radius), target.position[2])
        if (center.distanceTo(groundPoint) <= target.radius + 0.4) {
          hitTarget = target
          break
        }
      }
      // PvP hit-report for thunderbolt: ground-point-based; check after the
      // telegraph delay so the victim's authoritative position is fresh.
      if (boltId && hitTarget && hitTarget.id.startsWith('pvp:') && localBoltIdsRef.current.has(boltId)) {
        sendPvpReportHit({ boltId, victimSessionId: hitTarget.id.slice(4) })
      }
      const strike: ThunderboltStrike = {
        id: boltId ?? randomId(),
        groundPoint: [groundPoint.x, groundPoint.y, groundPoint.z],
        age: 0,
        ttl: THUNDERBOLT_TTL_S - THUNDERBOLT_TELEGRAPH_S,
        damage,
        seed,
        segments,
        target: hitTarget ? { id: hitTarget.id, position: hitTarget.position, radius: hitTarget.radius } : null,
      }
      setThunderStrikes(prev => [...prev.slice(-3), strike])
    }, THUNDERBOLT_TELEGRAPH_S * 1000)
  }, [camera])

  const spawnIceA = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setCrystalProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnIceB = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setFrozenProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  const spawnIceC = useCallback((origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, boltId?: string) => {
    const velocity = direction.clone().multiplyScalar(speed)
    setBorealProjectiles(prev => [...prev.slice(-15), {
      id: boltId ?? randomId(),
      origin: [origin.x, origin.y, origin.z],
      position: [origin.x, origin.y, origin.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      distance: 0,
      age: 0,
      ttl: BOLT_DEFAULT_TTL_S,
      damage,
      trailCarry: 0,
    }])
  }, [])

  // ─═̷─═̷─🎤 CAST ─═̷─═̷─🎤
  const queueSpatialSound = useCallback((
    url: string | null,
    position: [number, number, number],
    maxDistance: number,
    volumeMultiplier: number,
    ttl: number,
    followId?: string,
  ) => {
    if (!url) return false
    setSpatialSounds(prev => [
      ...prev.slice(-23),
      {
        id: randomId(),
        url,
        position,
        age: 0,
        ttl,
        maxDistance,
        volumeMultiplier,
        followId,
      },
    ])
    return true
  }, [])

  const playSpatialCastSound = useCallback((spell: CombatSpellId, boltId: string, origin: THREE.Vector3) => {
    const url = resolveSpellSoundUrl(settings.spellSounds?.[spell])
    if (url) {
      queueSpatialSound(
        url,
        [origin.x, origin.y, origin.z],
        BOLT_SPATIAL_RANGE_M,
        0.85,
        SPATIAL_CAST_SOUND_TTL_S,
        boltId,
      )
      return
    }

    const audio = useAudioManager.getState()
    if (spell === 'firebolt') audio.play('fireboltVoice')
    else if (spell === 'lightning-bolt') audio.play('fireboltCast')
    else if (spell === 'ice-bolt') audio.play('buttonClick')
  }, [queueSpatialSound, settings.spellSounds])

  const playSpatialExplosionSound = useCallback((position: [number, number, number]) => {
    const played = queueSpatialSound(
      resolveSpellSoundUrl(EXPLOSION_SOUND_ID),
      position,
      EXPLOSION_SPATIAL_RANGE_M,
      0.9,
      SPATIAL_EXPLOSION_SOUND_TTL_S,
    )
    if (!played) useAudioManager.getState().play('fireboltHit')
  }, [queueSpatialSound])

  useEffect(() => {
    playSpatialExplosionSoundRef.current = playSpatialExplosionSound
  }, [playSpatialExplosionSound])

  const castBolt = useCallback(async (forcedSpell?: CombatSpellId) => {
    if (!enabled || castingRef.current || !canCastBolt()) return
    const now = performance.now()
    if (now - lastCastAtRef.current < BOLT_DEFAULT_COOLDOWN_MS) return
    // Bail when no combat spell is armed — prevents LMB from firing firebolt
    // while a non-combat spell (catalog-place, brush-wand, text-to-pic, etc)
    // is selected. Without this, mana drains silently and the player thinks
    // their click did nothing or got eaten by an unrelated panel.
    const spell = forcedSpell ?? resolveActiveSpell()
    if (!spell) return
    lastCastAtRef.current = now
    castingRef.current = true
    try {
      // POST mana cost (routes through firebolt endpoint until lightning/ice
      // endpoints exist — same cost, same XP).
      const response = await fetch(castEndpointFor(spell), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId: useOasisStore.getState().activeWorldId }),
      })
      const data = await response.json().catch(() => ({})) as SpellCastResponse
      if (!response.ok || !data.ok) {
        window.dispatchEvent(new CustomEvent('oasis:firebolt-failed', { detail: data }))
        return
      }
      const speed = typeof data.spell?.speedMetersPerSecond === 'number'
        ? data.spell.speedMetersPerSecond
        : PLAYER_BASE_STATS.fireboltSpeedMetersPerSecond
      const damage = typeof data.spell?.damage === 'number' ? data.spell.damage : 14

      const { origin, direction } = resolveCastOriginAndDirection(camera)
      const visualBoltId = randomId()

      playSpatialCastSound(spell, visualBoltId, origin)

      setPlayerSpellCasting(true)
      window.setTimeout(() => setPlayerSpellCasting(false), BOLT_CAST_ANIMATION_MS)

      // ─═̷─ PvP broadcast ─═̷─
      // Only broadcast when we're in a PvP-enabled room. Outside PvP (or
      // when there's no room connection at all), the cast is purely local —
      // no extra network traffic, same as before.
      if (getPvpEnabled()) {
        const designLetter = spell === 'firebolt' ? settings.fireboltDesign
          : spell === 'lightning-bolt' ? settings.lightningBoltDesign
          : settings.iceBoltDesign
        // Thunderbolt (lightning D) skips the projectile flight loop — but
        // we still broadcast it so peers see the strike at the same ground
        // point. The seed reproduces identical geometry on every client.
        const seed = Math.floor(Math.random() * 0xffffffff)
        localBoltIdsRef.current.add(visualBoltId)
        // Prune the set so it doesn't grow unbounded across a long session.
        // BOLT_DEFAULT_TTL_S is ~2.5s — keep at most the last 100 bolts.
        if (localBoltIdsRef.current.size > 100) {
          const oldest = localBoltIdsRef.current.values().next().value
          if (oldest) localBoltIdsRef.current.delete(oldest)
        }
        sendPvpCast({
          spell,
          design: designLetter,
          ox: origin.x, oy: origin.y, oz: origin.z,
          dx: direction.x, dy: direction.y, dz: direction.z,
          speed,
          damage,
          seed,
          clientPredictionId: visualBoltId,
        })
      }

      // Dispatch to the correct design.
      if (spell === 'firebolt') {
        if (settings.fireboltDesign === 'B') spawnFireboltB(origin, direction, speed, damage, visualBoltId)
        else if (settings.fireboltDesign === 'C') spawnFireboltC(origin, direction, speed, damage, visualBoltId)
        else spawnFireboltA(origin, direction, speed, damage, visualBoltId)
      } else if (spell === 'lightning-bolt') {
        if (settings.lightningBoltDesign === 'B') spawnLightningB(origin, direction, speed, damage, visualBoltId)
        else if (settings.lightningBoltDesign === 'C') spawnLightningC(origin, direction, speed, damage, visualBoltId)
        else if (settings.lightningBoltDesign === 'D') spawnLightningD(damage, visualBoltId)
        else spawnLightningA(origin, direction, damage, visualBoltId)
      } else if (spell === 'ice-bolt') {
        if (settings.iceBoltDesign === 'B') spawnIceB(origin, direction, speed, damage, visualBoltId)
        else if (settings.iceBoltDesign === 'C') spawnIceC(origin, direction, speed, damage, visualBoltId)
        else spawnIceA(origin, direction, speed, damage, visualBoltId)
      }

      window.dispatchEvent(new CustomEvent('oasis:spell-cast', { detail: { spell, damage } }))
      if (data.progression) {
        window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: data.progression }))
      }
    } finally {
      castingRef.current = false
    }
  }, [
    camera, enabled, settings.fireboltDesign, settings.lightningBoltDesign, settings.iceBoltDesign,
    playSpatialCastSound,
    spawnFireboltA, spawnFireboltB, spawnFireboltC,
    spawnLightningA, spawnLightningB, spawnLightningC, spawnLightningD,
    spawnIceA, spawnIceB, spawnIceC,
  ])

  // Preload the spell-sound manifest on mount so per-spell overrides resolve
  // on the first cast (otherwise the first cast falls back to defaults while
  // the manifest is still in flight).
  useEffect(() => { void preloadSpellSoundManifest() }, [])

  useEffect(() => onHitAward(awardPvpDamageXp), [awardPvpDamageXp])

  // ─═̷─ PvP remote-bolt receive ─═̷─
  // Subscribe to incoming bolts from peers. Spawns the same visual designs
  // as a local cast — no mana cost, no XP (the originating client paid those).
  // The bolt id is NOT added to localBoltIdsRef, so the hit-detection path
  // won't try to reportHit on these.
  useEffect(() => {
    const unsubscribe = onRemoteBolt((bolt: PvpRemoteBolt) => {
      const origin = new THREE.Vector3(bolt.origin[0], bolt.origin[1], bolt.origin[2])
      const direction = new THREE.Vector3(bolt.direction[0], bolt.direction[1], bolt.direction[2]).normalize()
      playSpatialCastSound(bolt.spell, bolt.id, origin)

      // Dispatch to the per-design spawner. Design letter is room-validated
      // upstream so we just defensively fall through to A on garbage values.
      const design = (bolt.design || 'A').toUpperCase()
      if (bolt.spell === 'firebolt') {
        if (design === 'B') spawnFireboltB(origin, direction, bolt.speed, bolt.damage, bolt.id)
        else if (design === 'C') spawnFireboltC(origin, direction, bolt.speed, bolt.damage, bolt.id)
        else spawnFireboltA(origin, direction, bolt.speed, bolt.damage, bolt.id)
      } else if (bolt.spell === 'lightning-bolt') {
        if (design === 'B') spawnLightningB(origin, direction, bolt.speed, bolt.damage, bolt.id)
        else if (design === 'C') spawnLightningC(origin, direction, bolt.speed, bolt.damage, bolt.id)
        else if (design === 'D') spawnLightningD(bolt.damage, bolt.id)
        else spawnLightningA(origin, direction, bolt.damage, bolt.id)
      } else if (bolt.spell === 'ice-bolt') {
        if (design === 'B') spawnIceB(origin, direction, bolt.speed, bolt.damage, bolt.id)
        else if (design === 'C') spawnIceC(origin, direction, bolt.speed, bolt.damage, bolt.id)
        else spawnIceA(origin, direction, bolt.speed, bolt.damage, bolt.id)
      }
    })
    return unsubscribe
  }, [
    playSpatialCastSound,
    spawnFireboltA, spawnFireboltB, spawnFireboltC,
    spawnLightningA, spawnLightningB, spawnLightningC, spawnLightningD,
    spawnIceA, spawnIceB, spawnIceC,
  ])

  // ─═̷─═̷─📡 EVENT WIRING ─═̷─═̷─📡
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onFire = () => void castBolt('firebolt')
    const onLightning = () => void castBolt('lightning-bolt')
    const onIce = () => void castBolt('ice-bolt')
    // For backward-compat: the mobile Fire button still dispatches
    // oasis:cast-firebolt. When the player has armed a non-firebolt spell,
    // re-route at this listener so the armed spell fires from mobile/UI too.
    const onLegacyCastFirebolt = () => void castBolt(undefined)
    window.addEventListener('oasis:cast-firebolt', onLegacyCastFirebolt)
    window.addEventListener('oasis:cast-lightning-bolt', onLightning)
    window.addEventListener('oasis:cast-ice-bolt', onIce)
    void onFire // (referenced for clarity; legacy handler resolves to armed spell)
    return () => {
      window.removeEventListener('oasis:cast-firebolt', onLegacyCastFirebolt)
      window.removeEventListener('oasis:cast-lightning-bolt', onLightning)
      window.removeEventListener('oasis:cast-ice-bolt', onIce)
    }
  }, [castBolt])

  // LMB on canvas → cast armed spell.
  useEffect(() => {
    if (!enabled) return
    const canvas = gl.domElement
    const isCanvasEvent = (event: Event) => {
      const target = event.target
      return target instanceof Node && canvas.contains(target)
    }
    const swallowCastFollowup = (event: Event) => {
      if (Date.now() > suppressCastFollowupUntilRef.current) return
      if (!isCanvasEvent(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!isCanvasEvent(event)) return
      if (isTypingTarget(event.target)) return
      if (document.pointerLockElement !== canvas && !isProbablyMobileDevice()) return
      if (!canCastBolt()) return
      suppressCastFollowupUntilRef.current = Date.now() + 700
      event.preventDefault()
      event.stopImmediatePropagation()
      void castBolt(undefined)
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

  // ─═̷─═̷─🔁 ANIMATE EVERYTHING (one frame loop) ─═̷─═̷─🔁
  useFrame((_, delta) => {
    // ──── Comet Tail (firebolt A) — projectile loop + collision ────
    if (cometProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newExplosions: CometTailExplosion[] = []
      const newPuffs: CometTailSmokePuff[] = []
      const next: CometTailProjectile[] = []
      for (const p of cometProjectiles) {
        const result = stepProjectile(p, delta, targets, COMET_TRAIL_SPACING_M)
        if (result.expired) {
          newExplosions.push({ id: randomId(), position: result.endPos, age: 0, ttl: BOLT_EXPLOSION_TTL_S, seed: Math.floor(Math.random() * 10000) })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, setCometHitMarkers)
        } else {
          next.push(result.next as CometTailProjectile)
        }
        for (const pp of result.puffPositions) {
          newPuffs.push({ id: randomId(), position: pp, age: 0, ttl: COMET_SMOKE_TTL_S, seed: Math.floor(Math.random() * 10000), size: 0.22 + Math.random() * 0.1 })
        }
      }
      setCometProjectiles(next)
      if (newPuffs.length > 0) setCometSmoke(prev => [...prev.slice(-70), ...newPuffs])
      if (newExplosions.length > 0) {
        newExplosions.forEach(e => playSpatialExplosionSound(e.position))
        setCometExplosions(prev => [...prev.slice(-10), ...newExplosions])
      }
    }

    // ──── Solar Flare (firebolt B) ────
    if (solarProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newExplosions: SolarFlareExplosion[] = []
      const newPuffs: SolarFlareTrailPuff[] = []
      const next: SolarFlareProjectile[] = []
      for (const p of solarProjectiles) {
        const result = stepProjectile(p, delta, targets, SOLAR_TRAIL_SPACING_M)
        if (result.expired) {
          newExplosions.push({ id: randomId(), position: result.endPos, age: 0, ttl: BOLT_EXPLOSION_TTL_S * 1.2, seed: Math.floor(Math.random() * 10000) })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as SolarFlareProjectile)
        }
        for (const pp of result.puffPositions) {
          newPuffs.push({ id: randomId(), position: pp, direction: p.velocity, age: 0, ttl: 0.45 })
        }
      }
      setSolarProjectiles(next)
      if (newPuffs.length > 0) setSolarTrail(prev => [...prev.slice(-90), ...newPuffs])
      if (newExplosions.length > 0) {
        newExplosions.forEach(e => playSpatialExplosionSound(e.position))
        setSolarExplosions(prev => [...prev.slice(-10), ...newExplosions])
      }
    }

    // ──── Phoenix Feather (firebolt C) ────
    if (phoenixProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newExplosions: PhoenixExplosion[] = []
      const newEmbers: PhoenixEmber[] = []
      const next: PhoenixFeatherProjectile[] = []
      for (const p of phoenixProjectiles) {
        const result = stepProjectile(p, delta, targets, PHOENIX_TRAIL_SPACING_M)
        if (result.expired) {
          const vel = new THREE.Vector3(...p.velocity).normalize()
          newExplosions.push({ id: randomId(), position: result.endPos, age: 0, ttl: 0.95, seed: Math.floor(Math.random() * 10000), upVec: [vel.x, vel.y, vel.z] })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as PhoenixFeatherProjectile)
        }
        for (const pp of result.puffPositions) {
          newEmbers.push({
            id: randomId(),
            position: pp,
            velocity: [(Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6],
            age: 0,
            ttl: 0.55,
            hue: Math.random(),
          })
        }
      }
      setPhoenixProjectiles(next)
      if (newEmbers.length > 0) setPhoenixEmbers(prev => [...prev.slice(-150), ...newEmbers])
      if (newExplosions.length > 0) {
        newExplosions.forEach(e => playSpatialExplosionSound(e.position))
        setPhoenixExplosions(prev => [...prev.slice(-10), ...newExplosions])
      }
    }

    // ──── Plasma Filament (lightning A) — no flight loop ────
    if (plasmaBolts.length > 0) {
      setPlasmaBolts(prev => prev.map(b => ({ ...b, age: b.age + delta })).filter(b => b.age < b.ttl))
    }

    // ──── Tesla Coil (lightning B) ────
    if (teslaProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newImpacts: TeslaCoilImpact[] = []
      const newTrail: TeslaCoilTrailPuff[] = []
      const next: TeslaCoilProjectile[] = []
      for (const p of teslaProjectiles) {
        const result = stepProjectile(p, delta, targets, 0.3)
        if (result.expired) {
          newImpacts.push({ id: randomId(), position: result.endPos, age: 0, ttl: 0.85, seed: Math.floor(Math.random() * 10000), normalUp: [0, 1, 0] })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as TeslaCoilProjectile)
        }
        for (const pp of result.puffPositions) {
          newTrail.push({ id: randomId(), position: pp, age: 0, ttl: 0.55, seed: Math.floor(Math.random() * 10000) })
        }
      }
      setTeslaProjectiles(next)
      if (newTrail.length > 0) setTeslaTrail(prev => [...prev.slice(-100), ...newTrail])
      if (newImpacts.length > 0) {
        newImpacts.forEach(i => playSpatialExplosionSound(i.position))
        setTeslaImpacts(prev => [...prev.slice(-10), ...newImpacts])
      }
    }

    // ──── Storm Lance (lightning C) ────
    if (stormProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newImpacts: StormLanceImpact[] = []
      const newDroplets: StormLanceDroplet[] = []
      const next: StormLanceProjectile[] = []
      for (const p of stormProjectiles) {
        const result = stepProjectile(p, delta, targets, 0.28)
        if (result.expired) {
          newImpacts.push({ id: randomId(), position: result.endPos, age: 0, ttl: 0.85, seed: Math.floor(Math.random() * 10000), normalUp: [0, 1, 0] })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as StormLanceProjectile)
        }
        for (const pp of result.puffPositions) {
          newDroplets.push({ id: randomId(), position: pp, age: 0, ttl: 0.55, seed: Math.floor(Math.random() * 10000) })
        }
      }
      setStormProjectiles(next)
      if (newDroplets.length > 0) setStormDroplets(prev => [...prev.slice(-120), ...newDroplets])
      if (newImpacts.length > 0) {
        newImpacts.forEach(i => playSpatialExplosionSound(i.position))
        setStormImpacts(prev => [...prev.slice(-10), ...newImpacts])
      }
    }

    // ──── Thunderbolt (lightning D) — non-projectile, screen flash ────
    if (thunderStrikes.length > 0) {
      const newImpacts: ThunderboltImpact[] = []
      const nextStrikes: ThunderboltStrike[] = []
      let flashAlphaTarget = thunderFlashAlpha
      for (const s of thunderStrikes) {
        const newAge = s.age + delta
        const phaseBefore = thunderboltPhase(s.age)
        const phaseAfter = thunderboltPhase(newAge)
        // Detect strike moment (reveal just hit ground)
        const lastMoment = lastThunderStrikeMomentRef.current.get(s.id) || 0
        const struckThisFrame = !lastMoment && phaseAfter.justStruck
        if (struckThisFrame) {
          lastThunderStrikeMomentRef.current.set(s.id, performance.now())
          flashAlphaTarget = 0.7
          // Spawn impact
          newImpacts.push({
            id: randomId(),
            position: s.groundPoint,
            age: 0,
            ttl: 0.85,
            seed: s.seed,
          })
          playSpatialExplosionSound(s.groundPoint)
          if (s.target?.id.startsWith('pvp:')) {
            // PvP thunderbolt hit. Only the caster reports it.
            if (localBoltIdsRef.current.has(s.id)) {
              sendPvpReportHit({ boltId: s.id, victimSessionId: s.target.id.slice(4) })
            }
          } else if (s.target && isQuestFireboltTarget(s.target.id)) {
            recordQuestTargetHit(s.target.id, s.groundPoint, reportedQuestTargetHitsRef.current)
          } else if (s.target) {
            window.dispatchEvent(new CustomEvent('oasis:firebolt-hit', { detail: { targetId: s.target.id, position: s.groundPoint, worldId: useOasisStore.getState().activeWorldId } }))
          }
        }
        void phaseBefore // phase change comparison reserved for future polish
        if (newAge < s.ttl) {
          nextStrikes.push({ ...s, age: newAge })
        }
      }
      setThunderStrikes(nextStrikes)
      if (newImpacts.length > 0) setThunderImpacts(prev => [...prev.slice(-6), ...newImpacts])
      if (flashAlphaTarget !== thunderFlashAlpha || thunderFlashAlpha > 0) {
        // Decay the flash alpha over ~0.35s
        const decayed = Math.max(0, thunderFlashAlpha - delta * 2.4)
        setThunderFlashAlpha(Math.max(decayed, flashAlphaTarget > thunderFlashAlpha ? flashAlphaTarget : decayed))
      }
    } else if (thunderFlashAlpha > 0) {
      setThunderFlashAlpha(Math.max(0, thunderFlashAlpha - delta * 2.4))
    }

    // ──── Crystal Spear (ice A) ────
    if (crystalProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newImpacts: CrystalSpearImpact[] = []
      const newFlakes: CrystalSpearTrailFlake[] = []
      const next: CrystalSpearProjectile[] = []
      for (const p of crystalProjectiles) {
        const result = stepProjectile(p, delta, targets, CRYSTAL_TRAIL_SPACING_M)
        if (result.expired) {
          newImpacts.push({ id: randomId(), position: result.endPos, age: 0, ttl: 0.85, seed: Math.floor(Math.random() * 10000) })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as CrystalSpearProjectile)
        }
        const velNorm = new THREE.Vector3(...p.velocity).normalize()
        for (const pp of result.puffPositions) {
          newFlakes.push({ id: randomId(), position: pp, age: 0, ttl: 0.6, seed: Math.random() * 100, spinAxis: [velNorm.x, velNorm.y, velNorm.z] })
        }
      }
      setCrystalProjectiles(next)
      if (newFlakes.length > 0) setCrystalFlakes(prev => [...prev.slice(-120), ...newFlakes])
      if (newImpacts.length > 0) {
        newImpacts.forEach(i => playSpatialExplosionSound(i.position))
        setCrystalImpacts(prev => [...prev.slice(-10), ...newImpacts])
      }
    }

    // ──── Frozen Flame (ice B) ────
    if (frozenProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newImpacts: FrozenFlameImpact[] = []
      const newFlakes: FrozenFlameSnowflake[] = []
      const next: FrozenFlameProjectile[] = []
      for (const p of frozenProjectiles) {
        const result = stepProjectile(p, delta, targets, FROZEN_TRAIL_SPACING_M)
        if (result.expired) {
          newImpacts.push({ id: randomId(), position: result.endPos, age: 0, ttl: 2, seed: Math.floor(Math.random() * 10000) })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as FrozenFlameProjectile)
        }
        for (const pp of result.puffPositions) {
          newFlakes.push({
            id: randomId(),
            position: pp,
            age: 0,
            ttl: 0.9,
            seed: Math.random() * 100,
            drift: [(Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4],
          })
        }
      }
      setFrozenProjectiles(next)
      if (newFlakes.length > 0) setFrozenFlakes(prev => [...prev.slice(-120), ...newFlakes])
      if (newImpacts.length > 0) {
        newImpacts.forEach(i => playSpatialExplosionSound(i.position))
        setFrozenImpacts(prev => [...prev.slice(-10), ...newImpacts])
      }
    }

    // ──── Boreal Spiral (ice C) ────
    if (borealProjectiles.length > 0) {
      const targets = collectCollisionTargets()
      const newImpacts: BorealSpiralImpact[] = []
      const newGlyphs: BorealSpiralGlyph[] = []
      const next: BorealSpiralProjectile[] = []
      for (const p of borealProjectiles) {
        const result = stepProjectile(p, delta, targets, BOREAL_TRAIL_SPACING_M)
        if (result.expired) {
          newImpacts.push({ id: randomId(), position: result.endPos, age: 0, ttl: 1.1, seed: Math.floor(Math.random() * 10000) })
          if (result.impactTarget) reportHit(p.id, result.impactTarget, result.endPos, null)
        } else {
          next.push(result.next as BorealSpiralProjectile)
        }
        for (const pp of result.puffPositions) {
          newGlyphs.push({
            id: randomId(),
            position: pp,
            forward: p.velocity,
            age: 0,
            ttl: 0.5,
            variant: Math.floor(Math.random() * 4),
          })
        }
      }
      setBorealProjectiles(next)
      if (newGlyphs.length > 0) setBorealGlyphs(prev => [...prev.slice(-60), ...newGlyphs])
      if (newImpacts.length > 0) {
        newImpacts.forEach(i => playSpatialExplosionSound(i.position))
        setBorealImpacts(prev => [...prev.slice(-10), ...newImpacts])
      }
    }

    // ──── Age + retire trail particles + impacts ────
    if (cometSmoke.length > 0) setCometSmoke(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (cometExplosions.length > 0) setCometExplosions(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (cometHitMarkers.length > 0) setCometHitMarkers(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (xpHitMarkers.length > 0) setXpHitMarkers(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (solarTrail.length > 0) setSolarTrail(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (solarExplosions.length > 0) setSolarExplosions(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (phoenixEmbers.length > 0) setPhoenixEmbers(prev => prev.map(e => {
      const next = { ...e, age: e.age + delta }
      next.position = [
        e.position[0] + e.velocity[0] * delta,
        e.position[1] + e.velocity[1] * delta,
        e.position[2] + e.velocity[2] * delta,
      ]
      // Drag
      next.velocity = [e.velocity[0] * 0.94, e.velocity[1] * 0.95 - 0.4 * delta, e.velocity[2] * 0.94]
      return next
    }).filter(e => e.age < e.ttl))
    if (phoenixExplosions.length > 0) setPhoenixExplosions(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (plasmaImpacts.length > 0) setPlasmaImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (teslaTrail.length > 0) setTeslaTrail(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (teslaImpacts.length > 0) setTeslaImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (stormDroplets.length > 0) setStormDroplets(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (stormImpacts.length > 0) setStormImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (thunderImpacts.length > 0) setThunderImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (crystalFlakes.length > 0) setCrystalFlakes(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (crystalImpacts.length > 0) setCrystalImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (frozenFlakes.length > 0) setFrozenFlakes(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (frozenImpacts.length > 0) setFrozenImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (borealGlyphs.length > 0) setBorealGlyphs(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (borealImpacts.length > 0) setBorealImpacts(prev => prev.map(p => ({ ...p, age: p.age + delta })).filter(p => p.age < p.ttl))
    if (spatialSounds.length > 0) {
      const projectilePositionFor = (id: string): [number, number, number] | null => {
        const findMoving = (items: Array<{ id: string; position: [number, number, number] }>) => {
          for (const item of items) if (item.id === id) return item.position
          return null
        }
        const moving = findMoving(cometProjectiles)
          ?? findMoving(solarProjectiles)
          ?? findMoving(phoenixProjectiles)
          ?? findMoving(teslaProjectiles)
          ?? findMoving(stormProjectiles)
          ?? findMoving(crystalProjectiles)
          ?? findMoving(frozenProjectiles)
          ?? findMoving(borealProjectiles)
        if (moving) return moving
        const thunder = thunderStrikes.find(strike => strike.id === id)
        if (thunder) return thunder.groundPoint
        return null
      }

      setSpatialSounds(prev => prev
        .map(sound => {
          const followed = sound.followId ? projectilePositionFor(sound.followId) : null
          return {
            ...sound,
            age: sound.age + delta,
            position: followed ?? sound.position,
          }
        })
        .filter(sound => sound.age < sound.ttl))
    }
  })

  // Reveal trigger of thunderbolt: capture spike of strike moment for the screen flash.
  // (Handled inline in useFrame above; flash decays naturally.)

  const showFlash = thunderFlashAlpha > 0

  return (
    <>
      <group name="combat-bolt-layer">
        {/* Comet Tail (firebolt A) */}
        {cometSmoke.map(puff => <CometTailSmokePuffMesh key={puff.id} puff={puff} />)}
        {cometProjectiles.map(p => <CometTailMesh key={p.id} projectile={p} />)}
        {cometExplosions.map(e => <CometTailExplosionMesh key={e.id} explosion={e} />)}
        {cometHitMarkers.map(m => <CometTailHitMarkerMesh key={m.id} marker={m} />)}
        {xpHitMarkers.map(m => <CometTailHitMarkerMesh key={m.id} marker={m} />)}

        {/* Solar Flare (firebolt B) */}
        {solarTrail.map(p => <SolarFlareTrailMesh key={p.id} puff={p} />)}
        {solarProjectiles.map(p => <SolarFlareMesh key={p.id} projectile={p} />)}
        {solarExplosions.map(e => <SolarFlareExplosionMesh key={e.id} explosion={e} />)}

        {/* Phoenix Feather (firebolt C) */}
        {phoenixEmbers.map(e => <PhoenixEmberMesh key={e.id} ember={e} />)}
        {phoenixProjectiles.map(p => <PhoenixFeatherMesh key={p.id} projectile={p} />)}
        {phoenixExplosions.map(e => <PhoenixExplosionMesh key={e.id} explosion={e} />)}

        {/* Plasma Filament (lightning A) */}
        {plasmaBolts.map(b => <PlasmaFilamentMesh key={b.id} bolt={b} />)}
        {plasmaImpacts.map(i => <PlasmaFilamentImpactMesh key={i.id} impact={i} />)}

        {/* Tesla Coil (lightning B) */}
        {teslaTrail.map(p => <TeslaCoilTrailMesh key={p.id} puff={p} />)}
        {teslaProjectiles.map(p => <TeslaCoilMesh key={p.id} projectile={p} />)}
        {teslaImpacts.map(i => <TeslaCoilImpactMesh key={i.id} impact={i} />)}

        {/* Storm Lance (lightning C) */}
        {stormDroplets.map(p => <StormLanceDropletMesh key={p.id} droplet={p} />)}
        {stormProjectiles.map(p => <StormLanceMesh key={p.id} projectile={p} />)}
        {stormImpacts.map(i => <StormLanceImpactMesh key={i.id} impact={i} />)}

        {/* Thunderbolt (lightning D) */}
        {thunderStrikes.map(s => <ThunderboltMesh key={s.id} strike={s} />)}
        {thunderImpacts.map(i => <ThunderboltImpactMesh key={i.id} impact={i} />)}

        {/* Crystal Spear (ice A) */}
        {crystalFlakes.map(f => <CrystalSpearTrailFlakeMesh key={f.id} flake={f} />)}
        {crystalProjectiles.map(p => <CrystalSpearMesh key={p.id} projectile={p} />)}
        {crystalImpacts.map(i => <CrystalSpearImpactMesh key={i.id} impact={i} />)}

        {/* Frozen Flame (ice B) */}
        {frozenFlakes.map(f => <FrozenFlameSnowflakeMesh key={f.id} flake={f} />)}
        {frozenProjectiles.map(p => <FrozenFlameMesh key={p.id} projectile={p} />)}
        {frozenImpacts.map(i => <FrozenFlameImpactMesh key={i.id} impact={i} />)}

        {/* Boreal Spiral (ice C) */}
        {borealGlyphs.map(g => <BorealSpiralGlyphMesh key={g.id} glyph={g} />)}
        {borealProjectiles.map(p => <BorealSpiralMesh key={p.id} projectile={p} />)}
        {borealImpacts.map(i => <BorealSpiralImpactMesh key={i.id} impact={i} />)}
        {spatialSounds.map(sound => <SpatialSoundSource key={sound.id} sound={sound} />)}
      </group>
      {/* Thunderbolt screen flash — DOM overlay driven via a side-effect that
          owns a singleton <div> attached to document.body. Stays outside the
          R3F render so it can use mix-blend-mode + DOM stacking. */}
      <ThunderboltScreenFlashSink alpha={thunderFlashAlpha} visible={showFlash} />
    </>
  )
}

// ─═̷─═̷─🌩 SCREEN-FLASH SINK ─═̷─═̷─🌩
// Mounts a singleton <div> on document.body and mutates its inline style
// each frame. The component itself renders nothing into the R3F tree.
function ThunderboltScreenFlashSink({ alpha, visible }: { alpha: number; visible: boolean }) {
  const divRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const el = document.createElement('div')
    el.setAttribute('data-thunderbolt-flash', '')
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,240,1);opacity:0;pointer-events:none;z-index:80;mix-blend-mode:screen;'
    document.body.appendChild(el)
    divRef.current = el
    return () => {
      el.remove()
      divRef.current = null
    }
  }, [])
  useEffect(() => {
    if (!divRef.current) return
    divRef.current.style.opacity = String(visible ? alpha : 0)
  }, [alpha, visible])
  return null
}

// ─═̷─═̷─🔁 SHARED PROJECTILE STEP ─═̷─═̷─🔁
// (Re-used by every flight-based design. Returns whether the projectile
// expired (impact / TTL), where it ended up, and any trail-puff positions.)
function stepProjectile<TProj extends CommonProjectileBase | (Omit<CommonProjectileBase, 'design'>)>(
  projectile: TProj,
  delta: number,
  targets: CollisionTarget[],
  trailSpacingM: number,
): {
  expired: boolean
  endPos: [number, number, number]
  next: TProj
  puffPositions: [number, number, number][]
  impactTarget: CollisionTarget | null
} {
  const start = new THREE.Vector3(...projectile.position)
  const velocity = new THREE.Vector3(...projectile.velocity)
  const end = start.clone().addScaledVector(velocity, delta)
  const segmentLength = start.distanceTo(end)
  const nextDistance = (projectile.distance || 0) + segmentLength
  const nextAge = projectile.age + delta
  const oldTrailCarry = projectile.trailCarry || 0
  const carriedDistance = oldTrailCarry + segmentLength
  const puffCount = Math.floor(carriedDistance / trailSpacingM)
  const nextTrailCarry = carriedDistance % trailSpacingM
  const puffPositions: [number, number, number][] = []
  for (let index = 0; index < puffCount; index += 1) {
    const distanceAlong = (trailSpacingM - oldTrailCarry) + index * trailSpacingM
    if (segmentLength <= 0 || distanceAlong < 0 || distanceAlong > segmentLength) continue
    const t = distanceAlong / segmentLength
    const position = start.clone().lerp(end, t)
    puffPositions.push([position.x, position.y, position.z])
  }

  const activeSegment = armedSegment(start, end, projectile.distance || 0, nextDistance)
  const groundSegment = armedSegment(start, end, projectile.distance || 0, nextDistance, BOLT_GROUND_ARMING_DISTANCE_M)
  const origin = new THREE.Vector3(...projectile.origin)
  let impact: THREE.Vector3 | null = groundSegment ? groundHit(groundSegment.start, groundSegment.end) : null
  let impactTarget: CollisionTarget | null = null

  if (!impact && activeSegment) {
    for (const target of targets) {
      const targetCenter = new THREE.Vector3(target.position[0], target.position[1] + Math.min(1.4, target.radius), target.position[2])
      if (origin.distanceTo(targetCenter) < target.radius + BOLT_ARMING_DISTANCE_M + 0.2) continue
      impact = segmentSphereHit(activeSegment.start, activeSegment.end, targetCenter, target.radius)
      if (impact) {
        impactTarget = target
        break
      }
    }
  }

  const expired = nextAge >= projectile.ttl || end.y <= -8 || !!impact
  const endPos: [number, number, number] = impact
    ? [impact.x, Math.max(0.05, impact.y), impact.z]
    : [end.x, end.y, end.z]

  const next = {
    ...(projectile as object),
    age: nextAge,
    position: [end.x, end.y, end.z] as [number, number, number],
    distance: nextDistance,
    trailCarry: nextTrailCarry,
  } as unknown as TProj

  return { expired, endPos, next, puffPositions, impactTarget }
}

function handleTargetHit(
  target: CollisionTarget,
  position: [number, number, number],
  reportedHits: Set<string>,
  setMarker:
    | ((updater: (prev: CometTailHitMarker[]) => CometTailHitMarker[]) => void)
    | null,
) {
  if (setMarker && isQuestFireboltTarget(target.id)) {
    setMarker(prev => [
      ...prev.slice(-4),
      {
        id: randomId(),
        position,
        label: labelForFireboltTarget(target.id),
        age: 0,
        ttl: 1.15,
      },
    ])
  }
  recordQuestTargetHit(target.id, position, reportedHits)
}

'use client'

// ░▒▓ MACHINE GUN — hold left click, a hail of hitscan bullets ▓▒░
// Spellbook → Combat → Machine Gun arms it (RP1 on, like the bolts). While the pointer is locked
// (or on a phone, the Fire button) holding LMB fires ~11 rounds a second along the crosshair: tracer,
// muzzle flash, a synthesized shot, sparks or dust where it lands. Village agents take 8 damage a
// round (cosmetic HP, village-combat.ts: blood, K.O., respawn). No mana and no server call per round.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { useAudioManager } from '@/lib/audio-manager'
import { isProbablyMobileDevice } from '@/lib/mobile-controls'
import { setPlayerSpellCasting } from '@/lib/player-avatar-runtime'
import { VILLAGE_TARGET_PREFIX, damageVillageAgent } from '@/lib/village/village-combat'
import { useOasisStore } from '@/store/oasisStore'
import { canCastBolt, isTypingTarget } from './bolts/shared'
import { castOrigin, collectActorTargets, worldImpactAlong } from './bolts/aim'
import { segmentSphereEntry } from './bolts/flight'

const ROUND_MS = 90
const BULLET_DAMAGE = 8
const RANGE_M = 90
const SPREAD_RAD = 0.011
const TRACERS = 14
const SPARKS = 14
const TRACER_LIFE_S = 0.06
const SPARK_LIFE_S = 0.14

// ─── sound: a short noise crack plus a low thump, made once with WebAudio ─────

let audio: { ctx: AudioContext; noise: AudioBuffer } | null = null

function gunshot(): void {
  const manager = useAudioManager.getState()
  if (manager.muted || manager.volume <= 0) return
  try {
    if (!audio) {
      const ctx = new AudioContext()
      const length = Math.floor(ctx.sampleRate * 0.16)
      const noise = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.4)
      audio = { ctx, noise }
    }
    const { ctx, noise } = audio
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const volume = 0.32 * manager.volume
    const crack = ctx.createBufferSource()
    crack.buffer = noise
    crack.playbackRate.value = 0.85 + Math.random() * 0.3
    const band = ctx.createBiquadFilter()
    band.type = 'lowpass'
    band.frequency.value = 2600 + Math.random() * 900
    const crackGain = ctx.createGain()
    crackGain.gain.setValueAtTime(volume, t)
    crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    crack.connect(band).connect(crackGain).connect(ctx.destination)
    crack.start(t)
    const thump = ctx.createOscillator()
    thump.type = 'triangle'
    thump.frequency.setValueAtTime(150, t)
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.09)
    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(volume * 1.2, t)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    thump.connect(thumpGain).connect(ctx.destination)
    thump.start(t)
    thump.stop(t + 0.11)
  } catch {
    // No audio here: the gun still shoots.
  }
}

// ─── aiming ───────────────────────────────────────────────────────────────────

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _muzzleCam = new THREE.Vector3()
interface Shot { point: THREE.Vector3; targetId: string | null; ground: boolean }

/** A round along the crosshair (with a little spread): the first real mesh, terrain or ground, or an actor before it. */
function traceShot(camera: THREE.Camera, scene: THREE.Object3D): Shot {
  camera.getWorldPosition(_origin)
  camera.getWorldDirection(_dir)
  _dir.x += (Math.random() - 0.5) * SPREAD_RAD * 2
  _dir.y += (Math.random() - 0.5) * SPREAD_RAD * 2
  _dir.z += (Math.random() - 0.5) * SPREAD_RAD * 2
  _dir.normalize()
  const world = worldImpactAlong(scene, _origin, _dir, RANGE_M)
  let best = world ? world.distance : RANGE_M
  let targetId: string | null = world?.objectId ?? null
  let ground = Boolean(world && !world.objectId)
  for (const actor of collectActorTargets(true)) {
    if (actor.id.startsWith('pvp:')) continue
    const t = segmentSphereEntry([_origin.x, _origin.y, _origin.z], [_dir.x, _dir.y, _dir.z], best, actor.center, actor.radius)
    if (t !== null && t > 0.3 && t < best) {
      best = t
      targetId = actor.id
      ground = false
    }
  }
  return { point: _origin.clone().addScaledVector(_dir, best), targetId, ground }
}

// ─── the layer ────────────────────────────────────────────────────────────────

interface Tracer { from: THREE.Vector3; to: THREE.Vector3; age: number; alive: boolean }
interface Spark { at: THREE.Vector3; age: number; alive: boolean; blood: boolean; dust: boolean }

export function MachineGunLayer({ enabled }: { enabled: boolean }) {
  const { camera, gl, scene } = useThree()
  const firingRef = useRef(false)
  const lastShotRef = useRef(0)
  const tracerRefs = useRef<Array<THREE.Mesh | null>>([])
  const sparkRefs = useRef<Array<THREE.Mesh | null>>([])
  const flashRef = useRef<THREE.Mesh>(null)
  const flashAgeRef = useRef(1)
  const pool = useMemo(() => ({
    tracers: Array.from({ length: TRACERS }, (): Tracer => ({ from: new THREE.Vector3(), to: new THREE.Vector3(), age: 0, alive: false })),
    sparks: Array.from({ length: SPARKS }, (): Spark => ({ at: new THREE.Vector3(), age: 0, alive: false, blood: false, dust: false })),
    nextTracer: 0,
    nextSpark: 0,
  }), [])
  const assets = useMemo(() => ({
    tracerGeometry: new THREE.BoxGeometry(1, 1, 1),
    sparkGeometry: new THREE.SphereGeometry(1, 8, 6),
    flashGeometry: new THREE.OctahedronGeometry(1, 0),
    tracerMaterials: Array.from({ length: TRACERS }, () => new THREE.MeshBasicMaterial({ color: '#ffe9a3', transparent: true, opacity: 0, depthWrite: false })),
    sparkMaterials: Array.from({ length: SPARKS }, () => new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0, depthWrite: false })),
    flashMaterial: new THREE.MeshBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0, depthWrite: false }),
  }), [])
  useEffect(() => () => {
    assets.tracerGeometry.dispose()
    assets.sparkGeometry.dispose()
    assets.flashGeometry.dispose()
    assets.tracerMaterials.forEach(material => material.dispose())
    assets.sparkMaterials.forEach(material => material.dispose())
    assets.flashMaterial.dispose()
  }, [assets])

  const armed = () => useOasisStore.getState().selectedSpellId === 'machine-gun'

  // Hold LMB to fire. The click never reaches the world (no selecting a desk mid-burst).
  useEffect(() => {
    if (!enabled) return
    const canvas = gl.domElement
    const onCanvas = (event: Event) => event.target instanceof Node && canvas.contains(event.target)
    const stop = () => {
      if (!firingRef.current) return
      firingRef.current = false
      setPlayerSpellCasting(false)
    }
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !onCanvas(event) || isTypingTarget(event.target)) return
      if (document.pointerLockElement !== canvas && !isProbablyMobileDevice()) return
      if (!armed() || !canCastBolt()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      firingRef.current = true
      lastShotRef.current = 0 // first round right away
      setPlayerSpellCasting(true)
    }
    const onUp = (event: PointerEvent) => {
      if (event.button !== 0 || !firingRef.current) return
      if (onCanvas(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      // A tap (a phone's Fire button) still lets the first round out: stop after this frame.
      window.setTimeout(stop, 0)
    }
    const swallowClick = (event: MouseEvent) => {
      if (armed() && onCanvas(event) && (document.pointerLockElement === canvas || isProbablyMobileDevice())) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('pointerup', onUp, { capture: true })
    window.addEventListener('click', swallowClick, { capture: true })
    window.addEventListener('blur', stop)
    document.addEventListener('pointerlockchange', stop)
    return () => {
      stop()
      window.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('click', swallowClick, { capture: true })
      window.removeEventListener('blur', stop)
      document.removeEventListener('pointerlockchange', stop)
    }
  }, [enabled, gl])

  // Phones and tests: oasis:fire-machine-gun fires one round.
  useEffect(() => {
    const onFire = () => { if (enabled && armed() && canCastBolt()) shoot() }
    window.addEventListener('oasis:fire-machine-gun', onFire)
    return () => window.removeEventListener('oasis:fire-machine-gun', onFire)
  })

  function shoot(): void {
    const shot = traceShot(camera, scene)
    const { origin: muzzle } = castOrigin(camera, shot.point.distanceTo(camera.getWorldPosition(_muzzleCam)))
    const tracer = pool.tracers[pool.nextTracer]
    pool.nextTracer = (pool.nextTracer + 1) % TRACERS
    tracer.from.copy(muzzle)
    tracer.to.copy(shot.point)
    tracer.age = 0
    tracer.alive = true
    const spark = pool.sparks[pool.nextSpark]
    pool.nextSpark = (pool.nextSpark + 1) % SPARKS
    spark.at.copy(shot.point)
    spark.age = 0
    spark.alive = true
    spark.blood = Boolean(shot.targetId?.startsWith(VILLAGE_TARGET_PREFIX))
    spark.dust = shot.ground
    flashAgeRef.current = 0
    flashRef.current?.position.copy(muzzle)
    gunshot()
    if (shot.targetId?.startsWith(VILLAGE_TARGET_PREFIX)) {
      damageVillageAgent(shot.targetId.slice(VILLAGE_TARGET_PREFIX.length), BULLET_DAMAGE, Date.now(), [shot.point.x, shot.point.y, shot.point.z])
    }
  }

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    if (firingRef.current) {
      if (!enabled || !armed() || !canCastBolt()) {
        firingRef.current = false
        setPlayerSpellCasting(false)
      } else {
        const now = performance.now()
        if (now - lastShotRef.current >= ROUND_MS) {
          lastShotRef.current = now
          shoot()
        }
      }
    }

    for (let i = 0; i < TRACERS; i++) {
      const t = pool.tracers[i]
      const mesh = tracerRefs.current[i]
      if (!mesh) continue
      if (!t.alive) { mesh.visible = false; continue }
      t.age += delta
      if (t.age > TRACER_LIFE_S) { t.alive = false; mesh.visible = false; continue }
      // A short bright slug racing from the muzzle to the impact.
      const length = t.from.distanceTo(t.to)
      const progress = Math.min(1, t.age / TRACER_LIFE_S)
      const slug = Math.min(length, 2.2)
      const headAt = THREE.MathUtils.lerp(slug, length, progress)
      mesh.visible = true
      mesh.position.copy(t.from).lerp(t.to, (headAt - slug / 2) / Math.max(0.001, length))
      mesh.lookAt(t.to)
      mesh.scale.set(0.022, 0.022, slug)
      assets.tracerMaterials[i].opacity = 0.95 * (1 - progress * 0.5)
    }

    for (let i = 0; i < SPARKS; i++) {
      const s = pool.sparks[i]
      const mesh = sparkRefs.current[i]
      if (!mesh) continue
      if (!s.alive) { mesh.visible = false; continue }
      s.age += delta
      if (s.age > SPARK_LIFE_S) { s.alive = false; mesh.visible = false; continue }
      const k = s.age / SPARK_LIFE_S
      mesh.visible = true
      mesh.position.copy(s.at)
      mesh.scale.setScalar((s.dust ? 0.22 : 0.09) * (0.5 + k * (s.dust ? 1.6 : 1.1)))
      const material = assets.sparkMaterials[i]
      material.color.set(s.blood ? '#c00a0a' : s.dust ? '#b89a72' : '#ffd166')
      material.opacity = (s.dust ? 0.55 : 0.95) * (1 - k)
    }

    const flash = flashRef.current
    if (flash) {
      flashAgeRef.current += delta
      const k = flashAgeRef.current / 0.045
      flash.visible = k < 1
      if (k < 1) {
        flash.scale.set(0.13 * (1 - k * 0.4), 0.13 * (1 - k * 0.4), 0.2)
        flash.rotation.z = Math.random() * Math.PI
        assets.flashMaterial.opacity = 0.95 * (1 - k)
      }
    }
  })

  return (
    <group name="machine-gun">
      {assets.tracerMaterials.map((material, i) => (
        <mesh key={`t${i}`} ref={el => { tracerRefs.current[i] = el }} geometry={assets.tracerGeometry} material={material} visible={false} frustumCulled={false} renderOrder={5} />
      ))}
      {assets.sparkMaterials.map((material, i) => (
        <mesh key={`s${i}`} ref={el => { sparkRefs.current[i] = el }} geometry={assets.sparkGeometry} material={material} visible={false} renderOrder={5} />
      ))}
      <mesh ref={flashRef} geometry={assets.flashGeometry} material={assets.flashMaterial} visible={false} frustumCulled={false} renderOrder={6} />
    </group>
  )
}

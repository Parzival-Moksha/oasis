'use client'

// ░▒▓ VILLAGE GORE — blood for the village shooting gallery ▓▒░
// Every landed bolt sprays droplets along the shot (gravity, ground splats where they land) and a red
// mist puff; a knockout adds a bigger spray and a pool spreading under the body. Splats and pools dry
// up after a while. One instanced mesh per kind, capped, and no work at all while nothing is flying.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { getVillageCorpseCenter, onVillageHit, type VillageHitEvent } from '@/lib/village/village-combat'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { getVillageAnchors } from './village-actions'

const MAX_DROPS = 600
const MAX_SPLATS = 220
const MAX_PUFFS = 10
const MAX_POOLS = 8
const GRAVITY = -13
const SPLAT_LIFE_S = 45
const POOL_LIFE_S = 30
const PUFF_LIFE_S = 0.32
const BLOOD = new THREE.Color('#6d0000')

interface Drop { alive: boolean; p: THREE.Vector3; v: THREE.Vector3; size: number; ground: number }
interface Splat { alive: boolean; x: number; y: number; z: number; size: number; rot: number; age: number; grow: number }
interface Puff { alive: boolean; p: THREE.Vector3; age: number; size: number }
interface Pool { alive: boolean; x: number; y: number; z: number; size: number; age: number; rot: number }

/** A splat that isn't a perfect circle: a blob with a few spikes, built once. */
function makeBlobGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const n = 22
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const spike = i % 5 === 0 ? 1.45 : i % 3 === 0 ? 0.82 : 1
    const r = spike * (0.9 + 0.12 * Math.sin(a * 3.7) + 0.08 * Math.cos(a * 7.1))
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _zero = new THREE.Matrix4().makeScale(0, 0, 0)

export function VillageGore() {
  const dropsRef = useRef<THREE.InstancedMesh>(null)
  const splatsRef = useRef<THREE.InstancedMesh>(null)
  const poolsRef = useRef<THREE.InstancedMesh>(null)
  const puffRefs = useRef<Array<THREE.Mesh | null>>([])

  const sim = useMemo(() => ({
    drops: Array.from({ length: MAX_DROPS }, (): Drop => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0, ground: 0 })),
    splats: Array.from({ length: MAX_SPLATS }, (): Splat => ({ alive: false, x: 0, y: 0, z: 0, size: 0, rot: 0, age: 0, grow: 0 })),
    puffs: Array.from({ length: MAX_PUFFS }, (): Puff => ({ alive: false, p: new THREE.Vector3(), age: 0, size: 0 })),
    pools: Array.from({ length: MAX_POOLS }, (): Pool => ({ alive: false, x: 0, y: 0, z: 0, size: 0, age: 0, rot: 0 })),
    nextDrop: 0, nextSplat: 0, nextPuff: 0, nextPool: 0,
    active: false,
    dirtySplats: true,
  }), [])

  const geometries = useMemo(() => ({
    drop: new THREE.IcosahedronGeometry(1, 2),
    blob: makeBlobGeometry(),
    puff: new THREE.SphereGeometry(1, 12, 8),
  }), [])
  const materials = useMemo(() => ({
    // Matte and a little self-lit: glossy dark red mirrored the sky and read purple at dusk.
    drop: new THREE.MeshStandardMaterial({ color: '#9a0000', emissive: '#4a0000', emissiveIntensity: 0.7, roughness: 0.35, metalness: 0, envMapIntensity: 0.25 }),
    // Unlit: a lit dark red picks up the sky's blue at dusk and reads purple. Blood should read as blood.
    splat: new THREE.MeshBasicMaterial({ color: '#5a0303', transparent: true, opacity: 0.93, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    pool: new THREE.MeshBasicMaterial({ color: '#470202', transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  }), [])
  const puffMaterials = useMemo(() => Array.from({ length: MAX_PUFFS }, () => new THREE.MeshBasicMaterial({ color: '#c00808', transparent: true, opacity: 0, depthWrite: false })), [])

  // Instances start as identity matrices (a unit blob at the origin): hide them all until used.
  useLayoutEffect(() => {
    for (const [mesh, count] of [[dropsRef.current, MAX_DROPS], [splatsRef.current, MAX_SPLATS], [poolsRef.current, MAX_POOLS]] as const) {
      if (!mesh) continue
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, _zero)
      mesh.instanceMatrix.needsUpdate = true
    }
  }, [])

  useEffect(() => () => {
    Object.values(geometries).forEach(geometry => geometry.dispose())
    Object.values(materials).forEach(material => material.dispose())
    puffMaterials.forEach(material => material.dispose())
  }, [geometries, materials, puffMaterials])

  useEffect(() => {
    const addSplat = (x: number, y: number, z: number, size: number, grow = 0) => {
      const s = sim.splats[sim.nextSplat]
      sim.nextSplat = (sim.nextSplat + 1) % MAX_SPLATS
      Object.assign(s, { alive: true, x, y: y + 0.004 + Math.random() * 0.006, z, size, rot: Math.random() * Math.PI * 2, age: 0, grow })
      sim.dirtySplats = true
    }

    const spray = (event: VillageHitEvent) => {
      const anchor = getVillageAnchors()[event.agentId]
      if (!anchor) return
      const ground = anchor[1]
      const at = event.at ? new THREE.Vector3(...event.at) : new THREE.Vector3(anchor[0], anchor[1] + 1.1, anchor[2])
      // The shot's direction: from the shooter to the wound; blood leaves through the back.
      const pose = getPlayerAvatarPose()
      if (pose) _dir.set(at.x - pose.position[0], 0, at.z - pose.position[2])
      else _dir.set(0, 0, 1)
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1)
      _dir.normalize()
      const bullet = event.amount < 20
      const count = event.lethal ? 240 : bullet ? 28 : 90
      for (let i = 0; i < count; i++) {
        const d = sim.drops[sim.nextDrop]
        sim.nextDrop = (sim.nextDrop + 1) % MAX_DROPS
        // Mostly out the back, a fan of it sideways and up; a little spits back towards the shooter, slowly.
        const backwards = Math.random() < 0.08
        const speed = backwards ? 1 + Math.random() * 1.5 : 1.8 + Math.random() * (event.lethal ? 7.5 : 5.5)
        const back = backwards ? -0.5 : 1
        const spread = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.25 + Math.random() * 1.1, (Math.random() - 0.5) * 1.6)
        d.v.copy(_dir).multiplyScalar(back).add(spread).normalize().multiplyScalar(speed)
        d.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.12))
        d.size = 0.012 + Math.random() * (event.lethal ? 0.042 : 0.03)
        d.ground = ground
        d.alive = true
      }
      for (let i = 0; i < (event.lethal ? 3 : bullet ? 0 : 1); i++) {
        const puff = sim.puffs[sim.nextPuff]
        sim.nextPuff = (sim.nextPuff + 1) % MAX_PUFFS
        puff.alive = true
        puff.age = -i * 0.06
        puff.size = (event.lethal ? 0.55 : 0.32) * (1 + i * 0.4)
        puff.p.copy(at).addScaledVector(_dir, 0.15 + i * 0.25)
      }
      // A splash right under the wound, and on a knockout a pool spreading under the body.
      if (!bullet || event.lethal || Math.random() < 0.35) addSplat(at.x + _dir.x * 0.5, ground, at.z + _dir.z * 0.5, event.lethal ? 0.7 : bullet ? 0.18 : 0.38)
      if (event.lethal) {
        const dirX = _dir.x
        const dirZ = _dir.z
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2
          const r = 0.8 + Math.random() * 2.2
          addSplat(anchor[0] + dirX * 1.2 + Math.cos(a) * r, ground, anchor[2] + dirZ * 1.2 + Math.sin(a) * r, 0.2 + Math.random() * 0.45)
        }
        // The pool spreads from under the body once it has landed (VillageCorpseDrop reports where).
        window.setTimeout(() => {
          const center = getVillageCorpseCenter(event.agentId)
          const pool = sim.pools[sim.nextPool]
          sim.nextPool = (sim.nextPool + 1) % MAX_POOLS
          const x = center ? center[0] : anchor[0] + dirX * 0.75
          const z = center ? center[2] : anchor[2] + dirZ * 0.75
          Object.assign(pool, { alive: true, x, y: ground + 0.012, z, size: 1.35 + Math.random() * 0.4, age: 0, rot: Math.random() * Math.PI * 2 })
          sim.active = true
        }, 1100)
      }
      sim.active = true
    }

    ;(sim as unknown as { addSplat: typeof addSplat }).addSplat = addSplat
    return onVillageHit(spray)
  }, [sim])

  useFrame((_, rawDelta) => {
    if (!sim.active) return
    const delta = Math.min(rawDelta, 0.05)
    const drops = dropsRef.current
    const splats = splatsRef.current
    const pools = poolsRef.current
    if (!drops || !splats || !pools) return
    const addSplat = (sim as unknown as { addSplat?: (x: number, y: number, z: number, size: number) => void }).addSplat
    let anything = false

    // Droplets: fly, fall, and leave a splat where some of them land.
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = sim.drops[i]
      if (!d.alive) { drops.setMatrixAt(i, _zero); continue }
      anything = true
      d.v.y += GRAVITY * delta
      d.v.multiplyScalar(1 - 0.6 * delta)
      d.p.addScaledVector(d.v, delta)
      if (d.p.y <= d.ground + 0.01) {
        d.alive = false
        drops.setMatrixAt(i, _zero)
        if (addSplat && Math.random() < 0.6) addSplat(d.p.x, d.ground, d.p.z, 0.06 + d.size * (4 + 6 * Math.random()))
        continue
      }
      // Stretch along the velocity: streaks, not beads.
      const speed = d.v.length()
      _q.setFromUnitVectors(_up, _dir.copy(d.v).normalize())
      _s.set(d.size, d.size * (1 + Math.min(5, speed * 0.6)), d.size)
      _m.compose(d.p, _q, _s)
      drops.setMatrixAt(i, _m)
    }
    drops.instanceMatrix.needsUpdate = true

    // Mist puffs.
    for (let i = 0; i < MAX_PUFFS; i++) {
      const puff = sim.puffs[i]
      const mesh = puffRefs.current[i]
      if (!mesh) continue
      if (!puff.alive) { mesh.visible = false; continue }
      puff.age += delta
      if (puff.age >= PUFF_LIFE_S) { puff.alive = false; mesh.visible = false; continue }
      anything = true
      const t = Math.max(0, puff.age) / PUFF_LIFE_S
      mesh.visible = puff.age >= 0
      mesh.position.copy(puff.p)
      mesh.scale.setScalar(puff.size * (0.4 + t * 1.3))
      puffMaterials[i].opacity = 0.75 * (1 - t) * (1 - t)
    }

    // Splats: pop in, sit, then shrink away.
    for (let i = 0; i < MAX_SPLATS; i++) {
      const s = sim.splats[i]
      if (!s.alive) { if (sim.dirtySplats) splats.setMatrixAt(i, _zero); continue }
      anything = true
      s.age += delta
      if (s.age >= SPLAT_LIFE_S) { s.alive = false; splats.setMatrixAt(i, _zero); continue }
      const popIn = Math.min(1, s.age / 0.12)
      const fade = s.age > SPLAT_LIFE_S - 4 ? (SPLAT_LIFE_S - s.age) / 4 : 1
      const size = s.size * popIn * fade
      _q.setFromAxisAngle(_up, s.rot)
      _s.set(size, 1, size * 0.85)
      _m.compose(_dir.set(s.x, s.y, s.z), _q, _s)
      splats.setMatrixAt(i, _m)
    }
    sim.dirtySplats = false
    splats.instanceMatrix.needsUpdate = true

    // Pools: spread over two seconds, then dry up at the end.
    for (let i = 0; i < MAX_POOLS; i++) {
      const p = sim.pools[i]
      if (!p.alive) { pools.setMatrixAt(i, _zero); continue }
      anything = true
      p.age += delta
      if (p.age >= POOL_LIFE_S) { p.alive = false; pools.setMatrixAt(i, _zero); continue }
      const spread = 1 - Math.pow(1 - Math.min(1, p.age / 2.2), 3)
      const fade = p.age > POOL_LIFE_S - 5 ? (POOL_LIFE_S - p.age) / 5 : 1
      const size = p.size * spread * fade
      _q.setFromAxisAngle(_up, p.rot)
      _s.set(size, 1, size * 0.8)
      _m.compose(_dir.set(p.x, p.y, p.z), _q, _s)
      pools.setMatrixAt(i, _m)
    }
    pools.instanceMatrix.needsUpdate = true

    if (!anything) sim.active = false
  })

  return (
    <group name="village-gore">
      <instancedMesh ref={dropsRef} args={[geometries.drop, materials.drop, MAX_DROPS]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={splatsRef} args={[geometries.blob, materials.splat, MAX_SPLATS]} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={poolsRef} args={[geometries.blob, materials.pool, MAX_POOLS]} frustumCulled={false} renderOrder={1} />
      {puffMaterials.map((material, i) => (
        <mesh key={i} ref={el => { puffRefs.current[i] = el }} geometry={geometries.puff} material={material} visible={false} renderOrder={3} />
      ))}
    </group>
  )
}

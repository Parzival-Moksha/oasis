'use client'

// ░▒▓ VILLAGE LEAVE EFFECT — what a dismissed agent's body does on its way out (village-leave.ts) ▓▒░
//   spin  the owner's own (walk-through, 1:00:24): it spins faster and faster while it stretches sideways, slow for
//         two seconds (about 3 m wide by then), then runs off toward the horizon and rips apart at three seconds.
//   crt   an old screen switching off (58:03): squashed to a line while it stretches wide, a bright line, gone.
//   poof  squeezed to nothing, a puff of smoke.
//   fade  two seconds from opaque to gone.
// Costs nothing until an agent leaves: the frame loop runs only while it does. It works on copies of the body's
// materials, so another agent wearing the same avatar never fades with it, and puts the originals back after.

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrameWhen } from '../../lib/use-frame-when'
import { crtAt, leaveEffectMs, poofAt, spinAt } from '../../lib/village/village-looks'
import { useVillageLeaving } from './village-leave'

/** About the middle of a body: where the CRT squeezes to and the smoke starts. */
const MIDDLE = 0.9
const PUFFS = 8

export function VillageLeaveEffect({ agentId, children }: { agentId: string; children: ReactNode }) {
  const leaving = useVillageLeaving(agentId)
  const group = useRef<THREE.Group>(null)
  const line = useRef<THREE.Mesh>(null)
  const smoke = useRef<THREE.Group>(null)
  const swapped = useRef<Array<{ mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; copies: THREE.Material[]; base: number[] }>>([])
  const turn = useRef(0)
  const start = useRef(new THREE.Vector3())
  const away = useRef(new THREE.Vector3())
  const puffs = useMemo(() => Array.from({ length: PUFFS }, (_, i) => {
    const angle = (i / PUFFS) * Math.PI * 2 + (i % 2) * 0.4
    return { x: Math.cos(angle) * 0.25, z: Math.sin(angle) * 0.25, y: MIDDLE + ((i * 37) % 7) * 0.05 - 0.15, size: 0.28 + ((i * 13) % 5) * 0.05 }
  }), [])

  // Start: copies of the materials (for opacity); end or unmount: the body as it was.
  useEffect(() => {
    const body = group.current
    if (!leaving || !body) return
    turn.current = 0
    body.getWorldPosition(start.current)
    const swaps: typeof swapped.current = []
    body.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material || mesh.userData.leaveFx) return
      const original = mesh.material
      const list = Array.isArray(original) ? original : [original]
      const copies = list.map(material => {
        const copy = material.clone()
        copy.transparent = true
        return copy
      })
      mesh.material = Array.isArray(original) ? copies : copies[0]
      swaps.push({ mesh, original, copies, base: list.map(material => material.opacity ?? 1) })
    })
    swapped.current = swaps
    return () => {
      for (const swap of swaps) {
        swap.mesh.material = swap.original
        swap.copies.forEach(copy => copy.dispose())
      }
      swapped.current = []
      body.position.set(0, 0, 0)
      body.rotation.set(0, 0, 0)
      body.scale.set(1, 1, 1)
      if (line.current) line.current.visible = false
      if (smoke.current) smoke.current.visible = false
    }
  }, [leaving])

  const setOpacity = (value: number) => {
    for (const swap of swapped.current) swap.copies.forEach((copy, i) => { copy.opacity = swap.base[i] * value })
  }

  useFrameWhen(Boolean(leaving), ({ camera }, delta) => {
    const body = group.current
    if (!body || !leaving) return
    const t = Math.min(leaveEffectMs(leaving.effect), performance.now() - leaving.at) / 1000
    if (leaving.effect === 'spin') {
      const at = spinAt(t)
      turn.current += at.turnRate * Math.min(delta, 0.05)
      body.rotation.y = turn.current
      body.scale.set(at.wide, at.tall, at.wide)
      // Off toward the horizon: away from the camera, along the ground.
      if (at.run > 0 && body.parent) {
        away.current.set(start.current.x - camera.position.x, 0, start.current.z - camera.position.z).normalize().multiplyScalar(at.run).add(start.current)
        body.position.copy(body.parent.worldToLocal(away.current.clone()))
        body.position.y = 0
      }
      setOpacity(at.opacity)
    } else if (leaving.effect === 'crt') {
      const at = crtAt(t)
      body.scale.set(at.wide, at.tall, at.wide)
      // Squeezed toward the middle of the body, not down to its feet.
      body.position.y = MIDDLE * (1 - at.tall)
      setOpacity(at.opacity)
      if (line.current) {
        line.current.visible = at.glow > 0.02
        line.current.scale.set(0.6 * at.wide, 1, 1)
        ;(line.current.material as THREE.MeshBasicMaterial).opacity = at.glow
      }
    } else if (leaving.effect === 'poof') {
      const at = poofAt(t)
      body.scale.setScalar(at.scale)
      body.position.y = MIDDLE * (1 - at.scale)
      if (smoke.current) {
        smoke.current.visible = at.smoke > 0 && at.smoke < 1
        smoke.current.children.forEach((child, i) => {
          const puff = puffs[i]
          const grow = 1 + at.smoke * 2.4
          child.position.set(puff.x * grow, puff.y + at.smoke * 0.5, puff.z * grow)
          child.scale.setScalar(puff.size * grow)
          ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - at.smoke)
        })
      }
    } else {
      setOpacity(Math.max(0, 1 - t / 2))
    }
  })

  return (
    <>
      <group ref={group}>{children}</group>
      {/* The CRT's bright line, and the poof's smoke: only while they play. */}
      <mesh ref={line} position={[0, MIDDLE, 0]} visible={false} userData={{ leaveFx: true }} raycast={() => {}}>
        <boxGeometry args={[1, 0.025, 0.025]} />
        <meshBasicMaterial color="#e8fbff" transparent opacity={0} toneMapped={false} />
      </mesh>
      <group ref={smoke} visible={false}>
        {puffs.map((_, i) => (
          <mesh key={i} userData={{ leaveFx: true }} raycast={() => {}}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshBasicMaterial color="#cfd6de" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  )
}

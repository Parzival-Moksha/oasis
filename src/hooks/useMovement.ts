// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useMovement — Procedural animation for placed objects
// ─═̷─═̷─ॐ─═̷─═̷─ Objects in motion stay in motion ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
// Silicon Mother's kinetic toolbox for The Forge.
// Each MovementPreset maps to a useFrame callback that nudges
// position / rotation every tick. Zero cost for 'static' or undefined.
//
// Performance contract:
//   - delta capped at 50 ms (prevents tab-switch teleportation)
//   - initial position captured lazily on first observed frame
//   - preset change resets capture so orbits re-center correctly
//
// ▓▓▓▓【M̸O̸T̸I̸O̸N̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓

import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { MovementPreset } from '../lib/conjure/types'
import { useOasisStore } from '../store/oasisStore'
import { isAvatarLocomotionReady } from '../lib/avatar-locomotion-ready'
import { clearLiveObjectTransform, setLiveObjectTransform } from '../lib/live-object-transforms'

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL STATE — refs that survive across frames without triggering renders
// ═══════════════════════════════════════════════════════════════════════════

interface MovementState {
  initialized: boolean
  elapsed: number
  initialY: number
  initialPos: { x: number; y: number; z: number }
  prevType: string | undefined
}

// ═══════════════════════════════════════════════════════════════════════════
// THE HOOK — plug it into any <group ref={groupRef}> and watch it dance
// Now supports RTS-style moveTarget + patrol orbits
// ═══════════════════════════════════════════════════════════════════════════

/** Max delta (seconds) to prevent physics explosions on tab-switch / lag */
const MAX_DELTA = 0.05
/** Distance threshold to consider "arrived" at moveTarget — tight to avoid position snap */
const ARRIVE_THRESHOLD = 0.05

export function useMovement(
  groupRef: React.RefObject<Group>,
  movement: MovementPreset | undefined,
  objectId?: string,
  moveTarget?: [number, number, number],
  moveSpeed?: number,
): void {
  const stateRef = useRef<MovementState>({
    initialized: false,
    elapsed: 0,
    initialY: 0,
    initialPos: { x: 0, y: 0, z: 0 },
    prevType: undefined,
  })

  useEffect(() => {
    return () => {
      if (objectId) {
        clearLiveObjectTransform(objectId)
      }
    }
  }, [objectId])

  useFrame((_, rawDelta) => {
    const group = groupRef.current
    if (!group) return

    const delta = Math.min(rawDelta, MAX_DELTA)

    const syncLiveTransform = () => {
      if (!objectId) return
      setLiveObjectTransform(objectId, {
        position: [group.position.x, group.position.y, group.position.z],
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
        scale: [group.scale.x, group.scale.y, group.scale.z],
      })
    }

    // ═════════════════════════════════════════════════════════════════
    // RTS MOVE-TO — overrides everything when active
    // ░▒▓ Object walks toward target, rotates to face direction ▓▒░
    // ═════════════════════════════════════════════════════════════════
    if (moveTarget && objectId) {
      if (!isAvatarLocomotionReady(objectId)) {
        return
      }
      const [tx, , tz] = moveTarget
      const speed = moveSpeed || 3
      const dx = tx - group.position.x
      const dz = tz - group.position.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist < ARRIVE_THRESHOLD) {
        // Arrived — snap XZ to target, preserve Y elevation
        group.position.x = tx
        group.position.z = tz
        syncLiveTransform()
        useOasisStore.getState().clearMoveTarget(objectId)
        useOasisStore.getState().setObjectTransform(objectId, {
          position: [tx, group.position.y, tz],
          rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
          scale: [group.scale.x, group.scale.y, group.scale.z],
        })
        return
      }

      // Move toward target — XZ only, Y stays untouched
      const step = speed * delta
      const ratio = Math.min(step / dist, 1)
      group.position.x += dx * ratio
      group.position.z += dz * ratio

      // Face movement direction (smooth rotation)
      const targetAngle = Math.atan2(dx, dz)
      let angleDiff = targetAngle - group.rotation.y
      // Wrap to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
      group.rotation.y += angleDiff * Math.min(8 * delta, 1)
      syncLiveTransform()

      return // moveTarget overrides all other movement
    }

    // ── static or undefined = zero cost ──────────────────────────────
    if (!movement || movement.type === 'static') return

    const s = stateRef.current

    // ── Reset capture when movement type changes ─────────────────────
    if (s.prevType !== movement.type) {
      s.initialized = false
      s.prevType = movement.type
    }

    // ── Lazy capture of initial transform on first active frame ──────
    if (!s.initialized) {
      s.initialY = group.position.y
      s.initialPos = {
        x: group.position.x,
        y: group.position.y,
        z: group.position.z,
      }
      s.elapsed = 0
      s.initialized = true
    }

    s.elapsed += delta

    // ═════════════════════════════════════════════════════════════════
    // MOVEMENT DISPATCH — each branch is a tiny physics poem
    // ═════════════════════════════════════════════════════════════════

    switch (movement.type) {
      // ── SPIN: continuous rotation around a single axis ────────────
      case 'spin': {
        group.rotation[movement.axis] += movement.speed * delta
        syncLiveTransform()
        break
      }

      // ── HOVER: sinusoidal vertical bob ────────────────────────────
      case 'hover': {
        const phase = movement.offset * Math.PI * 2
        group.position.y =
          s.initialY +
          Math.sin(s.elapsed * movement.speed + phase) * movement.amplitude
        syncLiveTransform()
        break
      }

      // ── ORBIT: circular path in a chosen plane ────────────────────
      case 'orbit': {
        const angle = s.elapsed * movement.speed
        const cos = Math.cos(angle) * movement.radius
        const sin = Math.sin(angle) * movement.radius

        switch (movement.axis) {
          case 'xz':
            group.position.x = s.initialPos.x + cos
            group.position.z = s.initialPos.z + sin
            group.position.y = s.initialPos.y
            break
          case 'xy':
            group.position.x = s.initialPos.x + cos
            group.position.y = s.initialPos.y + sin
            group.position.z = s.initialPos.z
            break
          case 'yz':
            group.position.y = s.initialPos.y + cos
            group.position.z = s.initialPos.z + sin
            group.position.x = s.initialPos.x
            break
        }
        syncLiveTransform()
        break
      }

      // ── BOUNCE: absolute sine for that rubber-ball feel ───────────
      case 'bounce': {
        group.position.y =
          s.initialY +
          Math.abs(Math.sin(s.elapsed * movement.speed)) * movement.height
        syncLiveTransform()
        break
      }

      // ── PENDULUM: oscillating rotation like a grandfather clock ───
      case 'pendulum': {
        const maxRad = (movement.angle * Math.PI) / 180
        group.rotation[movement.axis] =
          Math.sin(s.elapsed * movement.speed) * maxRad
        syncLiveTransform()
        break
      }

      // ── PATROL: circular path on XZ plane, face direction ─────────
      case 'patrol': {
        const angle = s.elapsed * movement.speed + (movement.startAngle || 0)
        group.position.x = s.initialPos.x + Math.cos(angle) * movement.radius
        group.position.z = s.initialPos.z + Math.sin(angle) * movement.radius
        group.position.y = s.initialPos.y
        group.rotation.y = -angle // face direction of travel
        syncLiveTransform()
        break
      }
    }
  })
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// "Everything flows and nothing abides;
//  everything gives way and nothing stays fixed." — Heraclitus
// A love letter to every future mother who wires motion into matter.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

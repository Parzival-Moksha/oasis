// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPARKLER ░▒▓█ csillagszóró — the wand-tip particle that sells the wizardry █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ Tiny bright sparks emitted at the leading point of any active stroke ─═̷─═̷─ॐ─═̷─═̷─
//
// Implementation: a single THREE.Points buffer of MAX_PARTICLES, recycled
// indices, gravity + radial impulse + flicker. One Sparkler component per
// active stroke (local cursor + each remote drawer + active playback).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

const MAX_PARTICLES = 48
const EMIT_PER_SECOND = 70
const PARTICLE_LIFETIME_S = 0.55
const PARTICLE_SPEED = 1.4
const PARTICLE_GRAVITY = 1.8
const BASE_SIZE = 0.045

interface SparklerProps {
  position: [number, number, number]
  /** Hex color tinting the spark; defaults to white-yellow. */
  color?: string
  /** When false, emission halts but existing particles fade out. */
  active?: boolean
  /** Multiplier on emission rate / brightness — used for big finishes. */
  intensity?: number
}

export function Sparkler({ position, color = '#fff7c2', active = true, intensity = 1 }: SparklerProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const positionsRef = useRef<Float32Array>(new Float32Array(MAX_PARTICLES * 3))
  const velocitiesRef = useRef<Float32Array>(new Float32Array(MAX_PARTICLES * 3))
  const livesRef = useRef<Float32Array>(new Float32Array(MAX_PARTICLES))
  const indexRef = useRef(0)
  const carryRef = useRef(0)

  const tintColor = useMemo(() => new THREE.Color(color), [color])

  const geometry = useMemo(() => {
    // Park every particle far below the world so they don't render at (0,0,0)
    // until the first emission cycle pulls them up to the cursor. Without this,
    // every Sparkler flashes 48 bright dots at world origin on mount.
    const positions = positionsRef.current
    for (let i = 0; i < MAX_PARTICLES; i += 1) positions[i * 3 + 1] = -1e6
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
  }, [])

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      color: tintColor,
      size: BASE_SIZE,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  }, [tintColor])

  // Split disposal: geometry only on unmount; material on identity change OR unmount.
  // The merged effect would dispose the (memo-stable) geometry every time the
  // material identity changed (e.g. color prop change), causing use-after-dispose.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const positions = positionsRef.current
    const velocities = velocitiesRef.current
    const lives = livesRef.current

    if (active) {
      const target = EMIT_PER_SECOND * Math.max(0.1, intensity) * dt
      carryRef.current += target
      const toEmit = Math.floor(carryRef.current)
      carryRef.current -= toEmit
      for (let n = 0; n < toEmit; n += 1) {
        const i = indexRef.current
        indexRef.current = (indexRef.current + 1) % MAX_PARTICLES
        positions[i * 3]     = position[0]
        positions[i * 3 + 1] = position[1]
        positions[i * 3 + 2] = position[2]
        const theta = Math.random() * Math.PI * 2
        const phi   = (Math.random() - 0.5) * Math.PI
        const speed = PARTICLE_SPEED * (0.6 + Math.random() * 0.8)
        velocities[i * 3]     = Math.cos(theta) * Math.cos(phi) * speed
        velocities[i * 3 + 1] = Math.sin(phi) * speed + 0.3
        velocities[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * speed
        lives[i] = PARTICLE_LIFETIME_S
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (lives[i] <= 0) continue
      lives[i] -= dt
      velocities[i * 3 + 1] -= PARTICLE_GRAVITY * dt
      positions[i * 3]     += velocities[i * 3]     * dt
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt
      if (lives[i] <= 0) {
        // Park dead particles below ground so they don't render at origin.
        positions[i * 3 + 1] = -1e6
      }
    }

    geometry.attributes.position.needsUpdate = true
    // Quick size flicker for sparkle feel
    const flicker = 0.8 + Math.sin(performance.now() * 0.04) * 0.2
    material.size = BASE_SIZE * flicker * (0.8 + intensity * 0.4)
  })

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
}

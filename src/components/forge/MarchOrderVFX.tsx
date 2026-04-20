'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ActiveMarchOrderVfx } from '../../store/oasisStore'
import { useOasisStore } from '../../store/oasisStore'

const ARROW_COUNT = 5
const ORDER_RADIUS = 2
const START_HEIGHT = 1.5
const ARROW_TRAVEL_DURATION = 1.5
const ARROW_FADE_IN_DURATION = 0.5
const IMPACT_DURATION = 0.55
const IMPACT_PARTICLE_COUNT = 72
const TURN_RADIANS = Math.PI
const LOOKAHEAD_DELTA = 0.01
const ARROW_FORWARD = new THREE.Vector3(0, 1, 0)
const ARROW_OPACITY = 0.4

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function sampleArrowTipPosition(target: THREE.Vector3, baseAngle: number, progress: number): THREE.Vector3 {
  const clamped = clamp01(progress)
  const radius = ORDER_RADIUS * (1 - clamped) * (1 - clamped) * (1 + clamped)
  const angle = baseAngle + TURN_RADIANS * clamped
  const y = START_HEIGHT * (1 - clamped * clamped)
  return target.set(
    Math.cos(angle) * radius,
    y,
    Math.sin(angle) * radius,
  )
}

function collectArrowMaterials(node: THREE.Group | null): THREE.Material[] {
  if (!node) return []
  const materials: THREE.Material[] = []
  node.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const mesh = child as THREE.Mesh
    const materialValue = mesh.material
    if (Array.isArray(materialValue)) {
      materials.push(...materialValue)
      return
    }
    materials.push(materialValue)
  })
  return materials
}

// ░▒▓ RMB-FREEZE FIX (oasisspec3): swap meshStandardMaterial -> meshBasicMaterial.
// Burst right-clicks were freezing the scene 1-10s. Two compounding causes:
//   1. Each VFX spawned a <pointLight>, forcing three.js to recompile EVERY
//      meshStandardMaterial in the scene (light-count change → shader rebind).
//   2. Each arrow had its own PBR meshStandardMaterial → first-use shader
//      compile is multi-frame on stock GPUs.
// VFX is emissive/transparent/additive — PBR contributes nothing visually here.
function OrderArrow({ register }: { register: (node: THREE.Group | null) => void }) {
  return (
    <group ref={register}>
      <mesh position={[0, -0.46, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 0.72, 10]} />
        <meshBasicMaterial
          color="#2dd4bf"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh position={[0, -0.15, 0]}>
        <coneGeometry args={[0.15, 0.3, 14]} />
        <meshBasicMaterial
          color="#5eead4"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {Array.from({ length: 3 }, (_, index) => (
        <mesh
          key={index}
          position={[0, -0.72, 0]}
          rotation={[0, (index * Math.PI * 2) / 3, 0]}
        >
          <boxGeometry args={[0.018, 0.14, 0.18]} />
          <meshBasicMaterial
            color="#14b8a6"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

function MarchOrderVFX({ vfx, onComplete }: { vfx: ActiveMarchOrderVfx; onComplete: (id: string) => void }) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const arrowRefs = useRef<(THREE.Group | null)[]>([])
  const arrowMaterialsRef = useRef<THREE.Material[][]>(Array.from({ length: ARROW_COUNT }, () => []))
  const shockwaveRef = useRef<THREE.Mesh>(null)
  const flashRef = useRef<THREE.Mesh>(null)
  const coreGlowRef = useRef<THREE.Mesh>(null)
  const particlesRef = useRef<THREE.Points>(null)

  const arrowAngles = useMemo(
    () => Array.from({ length: ARROW_COUNT }, (_, index) => (index / ARROW_COUNT) * Math.PI * 2),
    [],
  )

  const setArrowRef = useMemo(
    () => Array.from({ length: ARROW_COUNT }, (_, index) => (node: THREE.Group | null) => {
      arrowRefs.current[index] = node
      arrowMaterialsRef.current[index] = collectArrowMaterials(node)
    }),
    [],
  )

  const particleData = useMemo(() => {
    const positions = new Float32Array(IMPACT_PARTICLE_COUNT * 3)
    const velocities = new Float32Array(IMPACT_PARTICLE_COUNT * 3)
    for (let index = 0; index < IMPACT_PARTICLE_COUNT; index += 1) {
      const i3 = index * 3
      const angle = Math.random() * Math.PI * 2
      const spread = 0.65 + Math.random() * 1.35
      positions[i3] = 0
      positions[i3 + 1] = 0
      positions[i3 + 2] = 0
      velocities[i3] = Math.cos(angle) * spread
      velocities[i3 + 1] = 0.7 + Math.random() * 1.5
      velocities[i3 + 2] = Math.sin(angle) * spread
    }
    return { positions, velocities }
  }, [])

  const currentTipPosition = useMemo(() => new THREE.Vector3(), [])
  const nextTipPosition = useMemo(() => new THREE.Vector3(), [])
  const targetQuat = useMemo(() => new THREE.Quaternion(), [])
  const direction = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, rawDelta) => {
    if (completed.current) return

    const delta = Math.min(rawDelta, 0.05)
    elapsed.current += delta

    if (elapsed.current >= vfx.duration) {
      completed.current = true
      onComplete(vfx.id)
      return
    }

    const arrowProgress = clamp01(elapsed.current / ARROW_TRAVEL_DURATION)
    const impactProgress = clamp01((elapsed.current - ARROW_TRAVEL_DURATION) / Math.max(0.0001, IMPACT_DURATION))

    arrowRefs.current.forEach((arrow, index) => {
      if (!arrow) return

      const materialize = smoothstep(0, ARROW_FADE_IN_DURATION, elapsed.current)
      const fadeProgress = impactProgress

      sampleArrowTipPosition(currentTipPosition, arrowAngles[index], arrowProgress)
      sampleArrowTipPosition(
        nextTipPosition,
        arrowAngles[index],
        Math.min(1, arrowProgress + LOOKAHEAD_DELTA),
      )
      arrow.position.copy(currentTipPosition)

      direction.copy(nextTipPosition).sub(currentTipPosition)
      if (direction.lengthSq() < 0.000001) {
        direction.set(0, -1, 0)
      } else {
        direction.normalize()
      }

      targetQuat.setFromUnitVectors(ARROW_FORWARD, direction)
      arrow.quaternion.copy(targetQuat)

      const scale = 0.001 + materialize * (1 - impactProgress * 0.1)
      arrow.scale.setScalar(scale)

      // Arrow materials are all MeshBasicMaterial additive (see OrderArrow).
      // Only opacity animates; PBR emissiveIntensity branch was deleted with
      // the RMB-freeze fix.
      const opacity = ARROW_OPACITY * materialize * (1 - fadeProgress) * 0.5
      const materials = arrowMaterialsRef.current[index]
      materials.forEach((material: THREE.Material) => {
        if ('opacity' in material) material.opacity = opacity
      })
    })

    if (coreGlowRef.current) {
      const material = coreGlowRef.current.material as THREE.MeshBasicMaterial
      const opacity = impactProgress < 0.18
        ? (impactProgress / 0.18) * 0.42
        : (1 - impactProgress) * 0.42
      coreGlowRef.current.scale.setScalar(0.35 + impactProgress * 1.25)
      material.opacity = Math.max(0, opacity)
    }

    if (flashRef.current) {
      const material = flashRef.current.material as THREE.MeshBasicMaterial
      const opacity = impactProgress < 0.12
        ? (impactProgress / 0.12) * 0.75
        : (1 - impactProgress) * 0.58
      flashRef.current.scale.setScalar(0.15 + impactProgress * 1.35)
      material.opacity = Math.max(0, opacity)
    }

    if (shockwaveRef.current) {
      const material = shockwaveRef.current.material as THREE.MeshBasicMaterial
      shockwaveRef.current.scale.setScalar(0.2 + impactProgress * 2.8)
      material.opacity = Math.max(0, (1 - impactProgress) * 0.65)
    }

    if (particlesRef.current) {
      const geometry = particlesRef.current.geometry
      const material = particlesRef.current.material as THREE.PointsMaterial
      const time = impactProgress * 0.5

      for (let index = 0; index < IMPACT_PARTICLE_COUNT; index += 1) {
        const i3 = index * 3
        const vx = particleData.velocities[i3]
        const vy = particleData.velocities[i3 + 1]
        const vz = particleData.velocities[i3 + 2]
        particleData.positions[i3] = vx * time
        particleData.positions[i3 + 1] = Math.max(0, vy * time - 1.8 * time * time)
        particleData.positions[i3 + 2] = vz * time
      }

      const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute
      positionAttr.copyArray(particleData.positions)
      positionAttr.needsUpdate = true
      material.opacity = impactProgress > 0 ? Math.max(0, (1 - impactProgress) * 0.85) : 0
      material.size = 0.06 + impactProgress * 0.08
    }
  })

  return (
    <group position={vfx.position}>
      {setArrowRef.map((register, index) => (
        <OrderArrow key={index} register={register} />
      ))}

      <mesh ref={coreGlowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.28, 0.58, 48]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={flashRef} position={[0, 0.14, 0]}>
        <sphereGeometry args={[0.45, 18, 18]} />
        <meshBasicMaterial
          color="#f8fafc"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={shockwaveRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.2, 0.32, 48]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <points ref={particlesRef} position={[0, 0.04, 0]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={IMPACT_PARTICLE_COUNT}
            array={particleData.positions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#fde68a"
          size={0.06}
          transparent
          opacity={0}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </points>

      {/* pointLight removed (oasisspec3 RMB-freeze fix): adding/removing scene
          lights forces three.js to recompile every PBR material in the scene.
          Rapid burst RMB → cumulative shader-compile freezes of 3-10s.
          Visual loss is negligible — additive emissive geometry already glows. */}
    </group>
  )
}

export function MarchOrderVFXRenderer() {
  const activeMarchOrderVfx = useOasisStore((state) => state.activeMarchOrderVfx)
  const removeMarchOrderVfx = useOasisStore((state) => state.removeMarchOrderVfx)

  if (activeMarchOrderVfx.length === 0) return null

  return (
    <group>
      {activeMarchOrderVfx.map((vfx) => (
        <MarchOrderVFX key={vfx.id} vfx={vfx} onComplete={removeMarchOrderVfx} />
      ))}
    </group>
  )
}

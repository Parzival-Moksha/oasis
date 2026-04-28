'use client'

import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ActivePlacementVfx } from '../../store/oasisStore'

type Vec3 = [number, number, number]

interface ConjureEffectProps {
  position: Vec3
  progress: number
  prompt: string
}

interface PlacementEffectProps {
  vfx: ActivePlacementVfx
  onComplete: (id: string) => void
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp01(value), 3)
const easeInCubic = (value: number) => Math.pow(clamp01(value), 3)
const easePulse = (value: number) => Math.sin(clamp01(value) * Math.PI)

function useSmokeTexture() {
  return useMemo(() => {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48)
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.42)')
    gradient.addColorStop(0.68, 'rgba(255,255,255,0.12)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 96, 96)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }, [])
}

function usePlasmaMaterial(colorA: string, colorB: string) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform float uTime;
      uniform float uProgress;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        float warp = sin(position.x * 7.0 + uTime * 3.0)
          * sin(position.y * 5.0 - uTime * 2.0)
          * sin(position.z * 6.0 + uTime * 2.7);
        vec3 warped = position + normal * warp * (0.08 + uProgress * 0.18);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(warped, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform float uTime;
      uniform float uProgress;
      uniform vec3 uColorA;
      uniform vec3 uColorB;

      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.4);
        float bands = sin(length(vPosition.xy) * 14.0 - uTime * 7.0) * 0.5 + 0.5;
        float pulse = sin(uTime * 8.0 + uProgress * 5.0) * 0.5 + 0.5;
        vec3 color = mix(uColorA, uColorB, bands * 0.65 + pulse * 0.35);
        float alpha = (0.12 + rim * 0.75 + bands * 0.18) * (0.25 + uProgress * 0.75);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }), [colorA, colorB])

  return material
}

function LightningField({
  color = '#aef7ff',
  count = 18,
  radius = 2.2,
  height = 3.4,
  intensity = 1,
  progress = 1,
}: {
  color?: string
  count?: number
  radius?: number
  height?: number
  intensity?: number
  progress?: number
}) {
  const linesRef = useRef<THREE.LineSegments>(null)
  const positions = useMemo(() => new Float32Array(count * 2 * 3), [count])
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2 + Math.random() * 0.5,
    offset: Math.random() * Math.PI * 2,
    reach: 0.55 + Math.random() * 0.7,
  })), [count])

  useFrame((state) => {
    const line = linesRef.current
    if (!line) return
    const t = state.clock.elapsedTime
    const flicker = 0.3 + Math.pow(Math.sin(t * 18), 2) * 0.7

    for (let i = 0; i < count; i++) {
      const seed = seeds[i]
      const ix = i * 6
      const orbit = seed.angle + t * (0.7 + seed.reach * 0.5)
      const zig = Math.sin(t * 9 + seed.offset) * 0.35
      const r = radius * seed.reach * (0.55 + progress * 0.45)
      const y1 = 0.35 + Math.sin(t * 2.1 + seed.offset) * 0.35
      const y2 = height * (0.4 + progress * 0.6) + Math.cos(t * 3.4 + seed.offset) * 0.65

      positions[ix] = Math.cos(orbit) * r
      positions[ix + 1] = y1
      positions[ix + 2] = Math.sin(orbit) * r
      positions[ix + 3] = Math.cos(orbit + zig) * r * 0.18
      positions[ix + 4] = y2
      positions[ix + 5] = Math.sin(orbit + zig) * r * 0.18
    }

    const geometry = line.geometry
    ;(geometry.attributes.position as THREE.BufferAttribute).set(positions)
    geometry.attributes.position.needsUpdate = true
    const material = line.material as THREE.LineBasicMaterial
    material.opacity = clamp01(intensity * flicker * (0.25 + progress * 0.75))
  })

  return (
    <lineSegments ref={linesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count * 2} array={positions} itemSize={3} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
  )
}

function SmokeField({
  count = 180,
  color = '#7f756d',
  hotColor = '#ff9a3d',
  radius = 2.8,
  height = 3,
  progress = 1,
  rising = true,
}: {
  count?: number
  color?: string
  hotColor?: string
  radius?: number
  height?: number
  progress?: number
  rising?: boolean
}) {
  const smokeTexture = useSmokeTexture()
  const pointsRef = useRef<THREE.Points>(null)
  const data = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const phases = new Float32Array(count)
    const speeds = new Float32Array(count)
    const baseR = new Float32Array(count)
    const baseY = new Float32Array(count)
    const smoke = new THREE.Color(color)
    const ember = new THREE.Color(hotColor)

    for (let i = 0; i < count; i++) {
      const ix = i * 3
      const angle = Math.random() * Math.PI * 2
      const r = Math.pow(Math.random(), 0.65) * radius
      const y = Math.random() * height
      positions[ix] = Math.cos(angle) * r
      positions[ix + 1] = y
      positions[ix + 2] = Math.sin(angle) * r
      phases[i] = angle
      speeds[i] = 0.25 + Math.random() * 0.9
      baseR[i] = r
      baseY[i] = y
      const mix = Math.random() < 0.16 ? 0.75 : Math.random() * 0.35
      const c = new THREE.Color().lerpColors(smoke, ember, mix)
      colors[ix] = c.r
      colors[ix + 1] = c.g
      colors[ix + 2] = c.b
    }

    return { positions, colors, phases, speeds, baseR, baseY }
  }, [color, count, height, hotColor, radius])

  useFrame((state, delta) => {
    const points = pointsRef.current
    if (!points) return
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const p = clamp01(progress)
    const positions = data.positions

    for (let i = 0; i < count; i++) {
      const ix = i * 3
      data.phases[i] += data.speeds[i] * dt
      const expansion = 0.35 + p * 1.3
      const r = data.baseR[i] * expansion + Math.sin(t * 1.9 + i) * 0.09
      const spin = data.phases[i] + t * 0.16
      let y = data.baseY[i] * (0.55 + p * 0.75)
      y += rising ? ((t * data.speeds[i] * 0.32) % height) : Math.sin(t + i) * 0.15
      if (y > height + 0.4) y -= height
      positions[ix] = Math.cos(spin) * r
      positions[ix + 1] = y
      positions[ix + 2] = Math.sin(spin) * r
    }

    const geometry = points.geometry
    ;(geometry.attributes.position as THREE.BufferAttribute).set(positions)
    geometry.attributes.position.needsUpdate = true
    const material = points.material as THREE.PointsMaterial
    material.opacity = 0.05 + p * 0.24
    material.size = 0.35 + p * 0.65
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={data.positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={data.colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        map={smokeTexture || undefined}
        transparent
        opacity={0.12}
        vertexColors
        size={0.7}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  )
}

function ShockwaveStack({
  progress,
  color = '#fff4b8',
  count = 4,
  maxRadius = 5,
  height = 0.05,
}: {
  progress: number
  color?: string
  count?: number
  maxRadius?: number
  height?: number
}) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => {
        const local = clamp01(progress * 1.25 - i * 0.15)
        const scale = 0.25 + easeOutCubic(local) * maxRadius
        const opacity = Math.max(0, easePulse(local) * (0.65 - i * 0.1))
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, height + i * 0.015, 0]} scale={[scale, scale, 1]}>
            <ringGeometry args={[0.78, 0.96, 72]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}

function GlyphRingStack({
  progress,
  palette = ['#00f5ff', '#ff4dff', '#fff7a8'],
  ringCount = 5,
  baseRadius = 1.3,
}: {
  progress: number
  palette?: string[]
  ringCount?: number
  baseRadius?: number
}) {
  const refs = useRef<Array<THREE.Mesh | null>>([])
  const setRef = useMemo(() => Array.from({ length: ringCount }, (_, i) => (mesh: THREE.Mesh | null) => {
    refs.current[i] = mesh
  }), [ringCount])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    refs.current.forEach((mesh, i) => {
      if (!mesh) return
      const dir = i % 2 === 0 ? 1 : -1
      mesh.rotation.z = t * dir * (0.8 + i * 0.22)
      mesh.rotation.x = -Math.PI / 2 + Math.sin(t * 0.9 + i) * 0.08 * progress
      const pulse = 1 + Math.sin(t * 5 + i) * 0.04
      mesh.scale.setScalar((0.45 + progress * 0.65) * pulse)
      const material = mesh.material as THREE.MeshBasicMaterial
      material.opacity = (0.08 + progress * 0.44) * (1 - i * 0.09)
    })
  })

  return (
    <group>
      {Array.from({ length: ringCount }, (_, i) => {
        const radius = baseRadius + i * 0.34
        return (
          <mesh key={i} ref={setRef[i]} position={[0, 0.04 + i * 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius, 0.015 + i * 0.003, 6, 84]} />
            <meshBasicMaterial color={palette[i % palette.length]} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}

function ShardStorm({
  count = 64,
  progress,
  color = '#f7fbff',
  radius = 3,
  violent = false,
}: {
  count?: number
  progress: number
  color?: string
  radius?: number
  violent?: boolean
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(() => Array.from({ length: count }, () => ({
    angle: Math.random() * Math.PI * 2,
    y: Math.random() * 3.6,
    r: 0.4 + Math.random() * radius,
    speed: 0.5 + Math.random() * 2.3,
    spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
    size: 0.08 + Math.random() * 0.22,
    phase: Math.random() * Math.PI * 2,
  })), [count, radius])

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = state.clock.elapsedTime
    const p = clamp01(progress)
    const collapse = 1 - easeOutCubic(p)
    const burst = violent ? easePulse(p) : p

    seeds.forEach((seed, i) => {
      const orbit = seed.angle + t * seed.speed * (violent ? 1.4 : 0.65)
      const r = seed.r * (violent ? (0.25 + burst * 1.25) : collapse)
      const y = seed.y * (0.25 + collapse * 0.75) + Math.sin(t * seed.speed + seed.phase) * 0.25
      dummy.position.set(Math.cos(orbit) * r, y + 0.3, Math.sin(orbit) * r)
      dummy.rotation.set(
        t * seed.spin.x * 3 + seed.phase,
        t * seed.spin.y * 3.7,
        t * seed.spin.z * 4.1,
      )
      const s = seed.size * (0.4 + p * 1.5)
      dummy.scale.set(s * 0.38, s * 1.8, s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })

    mesh.instanceMatrix.needsUpdate = true
    const material = mesh.material as THREE.MeshBasicMaterial
    material.opacity = violent ? Math.max(0, easePulse(p) * 0.8) : 0.15 + p * 0.65
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  )
}

function PlasmaCore({
  progress,
  colorA,
  colorB,
  scale = 1,
  position = [0, 1.6, 0],
}: {
  progress: number
  colorA: string
  colorB: string
  scale?: number
  position?: Vec3
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const material = usePlasmaMaterial(colorA, colorB)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const p = clamp01(progress)
    material.uniforms.uTime.value = t
    material.uniforms.uProgress.value = p
    if (meshRef.current) {
      const pulse = 1 + Math.sin(t * 8) * 0.08 + Math.sin(t * 2.7) * 0.12
      const s = scale * (0.2 + easePulse(p) * 1.2 + p * 0.35) * pulse
      meshRef.current.scale.setScalar(Math.max(0.001, s))
      meshRef.current.rotation.y = t * 0.8
      meshRef.current.rotation.x = Math.sin(t * 0.6) * 0.4
    }
  })

  return (
    <mesh ref={meshRef} position={position}>
      <icosahedronGeometry args={[1, 5]} />
      <primitive attach="material" object={material} />
    </mesh>
  )
}

function ImpossiblePolyhedra({ progress, palette = ['#ffffff', '#00f5ff', '#ff44cc'] }: { progress: number; palette?: string[] }) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    const group = groupRef.current
    if (!group) return
    const t = state.clock.elapsedTime
    const p = clamp01(progress)
    group.rotation.y = t * (0.6 + p)
    group.rotation.x = Math.sin(t * 0.5) * 0.35
    group.children.forEach((child, i) => {
      const obj = child as THREE.Mesh
      const s = (0.45 + i * 0.28) * (0.25 + p * 0.9) * (1 + Math.sin(t * 3.2 + i) * 0.1)
      obj.scale.set(s, s * (1 + Math.sin(t * 2 + i) * 0.35 * p), s)
      obj.rotation.z = t * (i % 2 === 0 ? 1 : -1) * (0.5 + i * 0.22)
      const material = obj.material as THREE.MeshBasicMaterial
      material.opacity = (0.12 + p * 0.5) * (1 - i * 0.08)
    })
  })

  return (
    <group ref={groupRef} position={[0, 1.65, 0]}>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i}>
          {i % 2 === 0 ? <icosahedronGeometry args={[1, 1]} /> : <octahedronGeometry args={[1, 0]} />}
          <meshBasicMaterial color={palette[i % palette.length]} transparent opacity={0} wireframe blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function RiftSlit({ progress, color = '#ff33dd', secondary = '#00f5ff' }: { progress: number; color?: string; secondary?: string }) {
  const leftRef = useRef<THREE.Mesh>(null)
  const rightRef = useRef<THREE.Mesh>(null)
  const coreRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const p = clamp01(progress)
    const open = easePulse(p)
    const width = 0.12 + open * 0.65
    const height = 0.7 + open * 3.8
    const jitter = Math.sin(t * 26) * 0.03 * open
    if (leftRef.current) {
      leftRef.current.position.x = -width + jitter
      leftRef.current.scale.set(0.08, height, 1)
      ;(leftRef.current.material as THREE.MeshBasicMaterial).opacity = open * 0.85
    }
    if (rightRef.current) {
      rightRef.current.position.x = width - jitter
      rightRef.current.scale.set(0.08, height, 1)
      ;(rightRef.current.material as THREE.MeshBasicMaterial).opacity = open * 0.85
    }
    if (coreRef.current) {
      coreRef.current.scale.set(width * 1.6, height * 0.95, 1)
      ;(coreRef.current.material as THREE.MeshBasicMaterial).opacity = open * 0.26
    }
  })

  return (
    <group position={[0, 1.8, 0]}>
      <mesh ref={coreRef}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={secondary} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={leftRef} rotation={[0, 0, 0.08]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={rightRef} rotation={[0, 0, -0.08]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function CompletionFlash({ progress, color = '#ffffff', radius = 2.2 }: { progress: number; color?: string; radius?: number }) {
  const local = clamp01((progress - 0.72) / 0.28)
  const opacity = Math.max(0, easePulse(local) * 0.65)
  const scale = 0.1 + easeOutCubic(local) * radius
  return (
    <mesh position={[0, 1.4, 0]} scale={[scale, scale, scale]}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function RealityStormConjureEffect({ position, progress }: ConjureEffectProps) {
  const p = clamp01(progress / 100)
  return (
    <group position={position}>
      <SmokeField progress={p} count={220} color="#5d6572" hotColor="#d8fbff" radius={2.6} height={3.6} />
      <ShardStorm progress={p} count={92} color="#d7fbff" radius={4.1} />
      <GlyphRingStack progress={p} palette={['#00f5ff', '#ff39db', '#fff7b0']} ringCount={7} baseRadius={0.9} />
      <ImpossiblePolyhedra progress={p} palette={['#f5ffff', '#00ddff', '#ff3fd7']} />
      <LightningField color="#adf7ff" count={22} radius={2.8} height={4.2} progress={p} intensity={0.9} />
      <PlasmaCore progress={p} colorA="#00f5ff" colorB="#ff3fd7" scale={0.9} />
      <CompletionFlash progress={p} color="#ffffff" radius={3.0} />
    </group>
  )
}

export function RiftstormConjureEffect({ position, progress }: ConjureEffectProps) {
  const p = clamp01(progress / 100)
  return (
    <group position={position}>
      <SmokeField progress={p} count={190} color="#171022" hotColor="#b43cff" radius={2.2} height={4.4} />
      <RiftSlit progress={p} color="#ff33dd" secondary="#00f5ff" />
      <LightningField color="#ff83f3" count={30} radius={2.4} height={4.6} progress={p} intensity={1.0} />
      <ShardStorm progress={p} count={72} color="#ffccff" radius={3.6} violent />
      <ShockwaveStack progress={p} color="#ff44cc" count={5} maxRadius={4.4} height={0.04} />
      <PlasmaCore progress={p} colorA="#120019" colorB="#ff33dd" scale={0.72} position={[0, 1.75, 0]} />
      <CompletionFlash progress={p} color="#ffb8ff" radius={3.4} />
    </group>
  )
}

export function CataclysmConjureEffect({ position, progress }: ConjureEffectProps) {
  const p = clamp01(progress / 100)
  return (
    <group position={position}>
      <SmokeField progress={p} count={260} color="#5e4b3f" hotColor="#ff6a00" radius={3.1} height={4.1} />
      <ShockwaveStack progress={p} color="#ffb11f" count={6} maxRadius={5.2} height={0.035} />
      <ShardStorm progress={p} count={110} color="#ffead1" radius={3.5} violent />
      <GlyphRingStack progress={p} palette={['#ff4000', '#ffd36a', '#ffffff']} ringCount={4} baseRadius={1.4} />
      <LightningField color="#fff0a6" count={18} radius={2.5} height={4.0} progress={p} intensity={0.75} />
      <PlasmaCore progress={p} colorA="#ff3100" colorB="#ffe56b" scale={1.05} />
      <CompletionFlash progress={p} color="#fff1bf" radius={3.8} />
    </group>
  )
}

export function RealityDetonationPlacementEffect({ vfx, onComplete }: PlacementEffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const groupRef = useRef<THREE.Group>(null)
  const [progress, setProgress] = useState(0)

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += Math.min(delta, 0.05)
    const p = clamp01(elapsed.current / vfx.duration)
    setProgress(p)
    if (groupRef.current) {
      const kick = Math.sin(p * Math.PI * 18) * (1 - p) * 0.025
      groupRef.current.position.set(vfx.position[0] + kick, vfx.position[1], vfx.position[2] - kick)
    }
    if (p >= 1) {
      completed.current = true
      onComplete(vfx.id)
    }
  })

  const p = progress
  return (
    <group ref={groupRef} position={vfx.position}>
      <ShockwaveStack progress={p} color="#fff4c7" count={6} maxRadius={5.8} />
      <SmokeField progress={p} count={260} color="#6c625c" hotColor="#ff8d2a" radius={3.6} height={3.8} />
      <ShardStorm progress={p} count={120} color="#ffffff" radius={4.2} violent />
      <LightningField color="#ffffff" count={26} radius={3.2} height={4.1} progress={easePulse(p)} intensity={1.15} />
      <PlasmaCore progress={easePulse(p)} colorA="#ff3a00" colorB="#fff4a8" scale={1.1} />
      <CompletionFlash progress={p} color="#fff6d6" radius={4.2} />
    </group>
  )
}

export function DimensionalMawPlacementEffect({ vfx, onComplete }: PlacementEffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const [progress, setProgress] = useState(0)

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += Math.min(delta, 0.05)
    const p = clamp01(elapsed.current / vfx.duration)
    setProgress(p)
    if (p >= 1) {
      completed.current = true
      onComplete(vfx.id)
    }
  })

  const p = progress
  return (
    <group position={vfx.position}>
      <RiftSlit progress={p} color="#ff38df" secondary="#00f5ff" />
      <SmokeField progress={p} count={220} color="#1f1231" hotColor="#9b4dff" radius={2.8} height={4.6} />
      <GlyphRingStack progress={easePulse(p)} palette={['#ff44dd', '#00e5ff', '#2200ff']} ringCount={6} baseRadius={1.1} />
      <ShardStorm progress={p} count={94} color="#e7d3ff" radius={3.4} violent />
      <LightningField color="#ff8af7" count={34} radius={2.7} height={4.8} progress={easePulse(p)} intensity={1.1} />
      <CompletionFlash progress={p} color="#ffc8ff" radius={3.7} />
    </group>
  )
}

export function HexstormPlacementEffect({ vfx, onComplete }: PlacementEffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const [progress, setProgress] = useState(0)

  useFrame((_, delta) => {
    if (completed.current) return
    elapsed.current += Math.min(delta, 0.05)
    const p = clamp01(elapsed.current / vfx.duration)
    setProgress(p)
    if (p >= 1) {
      completed.current = true
      onComplete(vfx.id)
    }
  })

  const p = progress
  return (
    <group position={vfx.position}>
      <GlyphRingStack progress={p} palette={['#00f5ff', '#fff36a', '#ff43e7', '#72ff8c']} ringCount={9} baseRadius={0.65} />
      <ImpossiblePolyhedra progress={p} palette={['#ffffff', '#00f5ff', '#fff36a']} />
      <ShardStorm progress={p} count={80} color="#dffcff" radius={3.2} />
      <LightningField color="#b8fff4" count={20} radius={2.5} height={3.8} progress={p} intensity={0.8} />
      <PlasmaCore progress={easePulse(p)} colorA="#00f5ff" colorB="#fff36a" scale={0.8} />
      <CompletionFlash progress={p} color="#f5ffff" radius={3.0} />
    </group>
  )
}

export function SingularityDropPlacementEffect({ vfx, onComplete }: PlacementEffectProps) {
  const elapsed = useRef(0)
  const completed = useRef(false)
  const [progress, setProgress] = useState(0)
  const coreRef = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    if (completed.current) return
    elapsed.current += Math.min(delta, 0.05)
    const p = clamp01(elapsed.current / vfx.duration)
    setProgress(p)
    if (coreRef.current) {
      const drop = p < 0.35 ? 1 - easeInCubic(p / 0.35) : 0
      coreRef.current.position.y = 3.2 * drop + 0.85
      const s = 0.25 + easePulse(p) * 0.7
      coreRef.current.scale.setScalar(s)
      coreRef.current.rotation.y = state.clock.elapsedTime * 2.5
      ;(coreRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, easePulse(p) * 0.92)
    }
    if (p >= 1) {
      completed.current = true
      onComplete(vfx.id)
    }
  })

  const p = progress
  return (
    <group position={vfx.position}>
      <mesh ref={coreRef} position={[0, 3.2, 0]}>
        <icosahedronGeometry args={[1, 3]} />
        <meshBasicMaterial color="#05020a" transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
      <SmokeField progress={p} count={210} color="#07050d" hotColor="#5a2dff" radius={3.4} height={3.2} rising={false} />
      <ShockwaveStack progress={p} color="#6d45ff" count={5} maxRadius={5.0} />
      <GlyphRingStack progress={p} palette={['#20134d', '#7447ff', '#9edcff']} ringCount={6} baseRadius={0.9} />
      <ShardStorm progress={p} count={120} color="#9edcff" radius={3.8} />
      <LightningField color="#7a55ff" count={16} radius={3.0} height={3.4} progress={easePulse(p)} intensity={0.85} />
      <CompletionFlash progress={p} color="#9e8cff" radius={3.6} />
    </group>
  )
}

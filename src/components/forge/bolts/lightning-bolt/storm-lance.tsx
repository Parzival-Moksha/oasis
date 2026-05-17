// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIGHTNING C — Storm Lance.
//
// Long lance ribbon. Outer sleeve = swirling stormcloud (CylinderGeometry
// with a custom ShaderMaterial — animated curl-noise UV scroll). Inner core
// = thin emissive gold lightning shaft visible through the translucent
// cloud sleeve. Trail = rain droplets that mist away (small instanced
// spheres with scale-down + fade). Impact = small thunderclap shockwave
// (expanding ring) + outward gust of 40-60 dust-style particles.
//
// Phase-1 visual choices:
//   * The "curl noise" cloud is approximated with a 2D sine-noise hash
//     scrolling its UV — full curl-noise would require a 3D texture pass.
// TODO(polish): replace approximated noise with a real curl-noise shader
//   (FBM with vector-field rotation) once you have a texture pass.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type StormLanceProjectile = {
  id: string
  origin: [number, number, number]
  position: [number, number, number]
  velocity: [number, number, number]
  distance: number
  age: number
  ttl: number
  damage: number
  trailCarry: number
}

export type StormLanceDroplet = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
}

export type StormLanceImpact = {
  id: string
  position: [number, number, number]
  age: number
  ttl: number
  seed: number
  normalUp: [number, number, number]
}

const cloudFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCloudColor;
  uniform vec3 uCoreColor;
  uniform float uOpacity;
  varying vec2 vUv;

  // 2D sinusoidal noise (cheap approximation; replace with FBM later)
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    // Scroll UV along Y (Z in world) like wind inside the lance.
    vec2 uv = vUv;
    uv.y += uTime * 1.4;
    uv.x += sin(uTime * 0.8 + vUv.y * 6.0) * 0.06;
    float n = noise(uv * 4.0) * 0.65 + noise(uv * 9.0 + uTime * 0.3) * 0.35;
    // Edge fade so the cylinder ends taper.
    float edgeFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
    // Radial darkness (assume cylinder normal already encoded via uv.x)
    float radialMask = 1.0 - abs(vUv.x - 0.5) * 1.4;
    vec3 col = mix(uCloudColor * 0.6, uCloudColor, n);
    col = mix(col, uCoreColor, max(0.0, n - 0.7));
    float alpha = clamp(n * radialMask * edgeFade, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`

const cloudVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

function makeCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCloudColor: { value: new THREE.Color('#697ab0') },
      uCoreColor: { value: new THREE.Color('#d6dfff') },
      uOpacity: { value: 0.72 },
    },
    vertexShader: cloudVertexShader,
    fragmentShader: cloudFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
}

export function StormLanceMesh({ projectile }: { projectile: StormLanceProjectile }) {
  const groupRef = useRef<THREE.Group>(null)
  const cloudMat = useMemo(() => makeCloudMaterial(), [])
  // Dispose the per-projectile ShaderMaterial when this projectile expires
  // and unmounts (filtered out of the state array by CombatBoltLayer).
  useEffect(() => () => cloudMat.dispose(), [cloudMat])
  const direction = useMemo(() => new THREE.Vector3(...projectile.velocity).normalize(), [projectile.velocity])
  const orientation = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
    return q
  }, [direction])

  useFrame((_, delta) => {
    cloudMat.uniforms.uTime.value += delta
  })

  const opacity = Math.max(0, Math.min(1, 1 - projectile.age / projectile.ttl))
  cloudMat.uniforms.uOpacity.value = 0.78 * opacity

  return (
    <group ref={groupRef} position={projectile.position} quaternion={orientation}>
      {/* Outer storm cloud sleeve (cylinder along +Y) */}
      <mesh material={cloudMat}>
        <cylinderGeometry args={[0.16, 0.22, 1.2, 18, 6, true]} />
      </mesh>
      {/* Inner gold core */}
      <mesh>
        <cylinderGeometry args={[0.025, 0.025, 1.18, 10, 1, false]} />
        <meshStandardMaterial color="#fff5a4" emissive="#ffd700" emissiveIntensity={3.6} transparent opacity={opacity} toneMapped={false} />
      </mesh>
      {/* Lance tip flare */}
      <mesh position={[0, 0.6, 0]}>
        <coneGeometry args={[0.12, 0.34, 14, 1, true]} />
        <meshBasicMaterial color="#fff5a4" transparent opacity={0.7 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Backward glow */}
      <mesh position={[0, -0.6, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.08, 0.22, 12, 1, true]} />
        <meshBasicMaterial color="#697ab0" transparent opacity={0.5 * opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export function StormLanceDropletMesh({ droplet }: { droplet: StormLanceDroplet }) {
  const t = Math.max(0, Math.min(1, droplet.age / droplet.ttl))
  const opacity = Math.max(0, 0.45 * Math.pow(1 - t, 1.4))
  const scale = 0.04 * (1 - t * 0.5)
  const drift = Math.sin(droplet.seed * 0.21 + t * 6) * 0.1
  return (
    <mesh position={[droplet.position[0] + drift, droplet.position[1] - t * 0.6, droplet.position[2] + drift * 0.6]} scale={scale}>
      <sphereGeometry args={[1, 6, 5]} />
      <meshBasicMaterial color="#a8b3d4" transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export function StormLanceImpactMesh({ impact }: { impact: StormLanceImpact }) {
  const t = Math.max(0, Math.min(1, impact.age / impact.ttl))
  const upDir = new THREE.Vector3(...impact.normalUp).normalize()
  const ringQuat = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upDir)
    return q
  }, [upDir])
  const dust = useMemo(() => {
    const rng = mulberry(impact.seed || 1)
    const count = 50
    return Array.from({ length: count }, () => ({
      angle: rng() * Math.PI * 2,
      speed: 1.4 + rng() * 2.6,
      size: 0.05 + rng() * 0.06,
      vert: 0.2 + rng() * 0.6,
      hue: rng(),
    }))
  }, [impact.seed])

  return (
    <group position={impact.position}>
      {/* Thunderclap shockwave ring */}
      <mesh quaternion={ringQuat} scale={0.4 + t * 4.4}>
        <ringGeometry args={[0.5, 0.7, 36]} />
        <meshBasicMaterial color="#fff5a4" transparent opacity={Math.max(0, 0.8 - t * 1.0)} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Cloud burst */}
      <mesh scale={0.6 + t * 3}>
        <sphereGeometry args={[0.34, 14, 10]} />
        <meshBasicMaterial color="#697ab0" transparent opacity={Math.max(0, 0.55 - t * 0.85)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {/* Dust particles */}
      {dust.map((d, i) => {
        const life = t * 1.4
        const x = Math.cos(d.angle) * d.speed * life
        const z = Math.sin(d.angle) * d.speed * life
        const y = Math.max(0.04, d.vert * life - 1.2 * life * life)
        return (
          <mesh key={i} position={[x, y, z]} scale={Math.max(0.1, d.size * (1 - t * 0.6))}>
            <sphereGeometry args={[1, 5, 4]} />
            <meshBasicMaterial color={d.hue < 0.5 ? '#a8b3d4' : '#fff5a4'} transparent opacity={Math.max(0, 0.8 - t * 1.1)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        )
      })}
    </group>
  )
}

function mulberry(seedIn: number): () => number {
  let seed = seedIn >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SHADER PRIMITIVES — procedural effects that bring crafted scenes to life
// ─═̷─═̷─ॐ─═̷─═̷─ Flame, Flag, Crystal, Water, Particles, Glow, Aurora ─═̷─═̷─ॐ─═̷─═̷─
// Each component encapsulates a custom GLSL shader effect that the LLM
// can invoke by specifying type: "flame" | "flag" | etc. in the JSON.
// Techniques drawn from arena.html, aurora_fortress, underwater_temple.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CraftedPrimitive } from '../../lib/conjure/types'

// Hard cap on intensity to prevent GPU blowout regardless of LLM output
const clampIntensity = (v: number) => Math.min(v, 2.0)

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED GLSL — FBM noise + output safety clamp
// ═══════════════════════════════════════════════════════════════════════════════

const GLSL_FBM = /* glsl */ `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}
`

// ═══════════════════════════════════════════════════════════════════════════════
// FLAME — vertex-displaced cone with gradient fragment, additive blending
// ═══════════════════════════════════════════════════════════════════════════════

const FLAME_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
varying float vNoise;
${GLSL_FBM}
void main() {
  vUv = uv;
  vec3 pos = position;
  float t = uv.y;
  float sway1 = sin(uTime * uSpeed * 4.2 + t * 5.0) * 0.10 * t;
  float sway2 = sin(uTime * uSpeed * 3.1 + t * 3.5) * 0.06 * t;
  float sway3 = cos(uTime * uSpeed * 2.8 + t * 3.6) * 0.07 * t;
  pos.x += sway1 + sway2;
  pos.z += sway3;
  float n = fbm(vec2(pos.x * 1.8 + uTime * uSpeed * 0.8, pos.y * 1.4 - uTime * uSpeed * 2.1));
  vNoise = n;
  float taper = 1.0 - t * 0.3;
  pos.x *= taper;
  pos.z *= taper;
  pos.x += (n - 0.5) * 0.2 * t;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const FLAME_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
varying vec2 vUv;
varying float vNoise;
void main() {
  float t = vUv.y;
  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, 0.45, t));
  col = mix(col, uColor3, smoothstep(0.45, 1.0, t));
  col += vNoise * 0.1;
  float flicker = sin(uTime * uSpeed * 8.0 + t * 3.0) * 0.08 + 0.92;
  float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float alpha = (1.0 - t) * 0.7 * flicker * radial;
  gl_FragColor = clamp(vec4(col * uIntensity, alpha), 0.0, 1.0);
}
`

export function FlameShader({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uIntensity: { value: clampIntensity(primitive.intensity ?? 1.0) },
    uColor1: { value: new THREE.Color(primitive.color || '#FFFFDD') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#FF6A00') },
    uColor3: { value: new THREE.Color(primitive.color3 || '#B30000') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <mesh ref={meshRef} position={primitive.position} rotation={primitive.rotation || [0, 0, 0]} scale={primitive.scale}>
      <coneGeometry args={[0.5, 1, 16, 8, true]} />
      <shaderMaterial
        vertexShader={FLAME_VERT} fragmentShader={FLAME_FRAG} uniforms={uniforms}
        transparent blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLAG — plane with UV-weighted sine-wave vertex displacement
// ═══════════════════════════════════════════════════════════════════════════════

const FLAG_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 pos = position;
  float wf = uv.x;
  float freq = 3.5;
  float wave1 = sin(pos.y * freq + uTime * uSpeed * 3.1) * 0.13;
  float wave2 = sin(pos.y * freq * 2.2 + uTime * uSpeed * 5.0) * 0.06;
  float wave3 = sin(pos.x * freq * 1.7 + uTime * uSpeed * 2.3) * 0.04;
  pos.z += wf * (wave1 + wave2 + wave3);
  pos.y += wf * sin(pos.x * 4.0 + uTime * uSpeed * 2.0) * 0.015;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const FLAG_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  float stripe = step(0.5, fract(vUv.x * 4.0)) * step(0.5, fract(vUv.y * 6.0));
  vec3 col = mix(uColor1, uColor2, vUv.y * 0.6 + stripe * 0.12);
  float shade = 0.9 + 0.1 * sin(vUv.x * 8.0 + uTime * uSpeed * 2.0);
  gl_FragColor = vec4(col * shade, 1.0);
}
`

export function FlagShader({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uColor1: { value: new THREE.Color(primitive.color || '#0044AA') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#001166') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <mesh ref={meshRef} position={primitive.position} rotation={primitive.rotation || [0, 0, 0]} scale={primitive.scale}>
      <planeGeometry args={[1, 1, 32, 16]} />
      <shaderMaterial vertexShader={FLAG_VERT} fragmentShader={FLAG_FRAG} uniforms={uniforms} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRYSTAL — octahedron with fresnel rim + internal banding + pulsing glow
// Uses NormalBlending (NOT additive) to prevent black-canvas depth corruption
// ═══════════════════════════════════════════════════════════════════════════════

const CRYSTAL_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uSeed;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  vPos = position;
  vNormalW = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  vec3 pos = position;
  float pulse = 0.04 * sin(uTime * uSpeed * (0.45 + fract(uSeed * 2.0)) + position.y * 1.8 + uSeed * 10.0);
  pos += normal * pulse;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const CRYSTAL_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uTime;
uniform float uSpeed;
uniform float uSeed;
uniform float uIntensity;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec2 vUv;
${GLSL_FBM}
void main() {
  float heightMix = smoothstep(-1.2, 1.6, vPos.y);
  float travel = fbm(vPos.xz * 2.4 + vec2(uTime * uSpeed * 0.08 + uSeed * 3.0, -uTime * uSpeed * 0.06));
  vec3 baseCol = mix(uColor1, uColor2, clamp(heightMix + travel * 0.3, 0.0, 1.0));
  // Internal banding
  float internal = smoothstep(0.34, 0.92,
    sin(vPos.y * 6.0 + travel * 6.0 + uTime * uSpeed * 1.1 + uSeed * 9.0) * 0.5 + 0.5);
  // Fresnel — use view direction, guard against NaN
  float NdotV = abs(dot(normalize(vNormalW), normalize(vViewDir)));
  float fresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), 1.8);
  // Pulsing
  float pulse = 0.62 + 0.38 * sin(uTime * uSpeed * (0.8 + fract(uSeed * 4.0)) + uSeed * 6.0);
  vec3 col = baseCol + internal * uColor2 * 0.3 + fresnel * uColor2 * 0.4;
  col *= pulse * uIntensity;
  float alpha = 0.75 + fresnel * 0.25;
  gl_FragColor = clamp(vec4(col, alpha), 0.0, 1.0);
}
`

export function CrystalShader({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const seed = primitive.seed ?? Math.random() * 100
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uSeed: { value: seed },
    uIntensity: { value: clampIntensity(primitive.intensity ?? 1.0) },
    uColor1: { value: new THREE.Color(primitive.color || '#4400CC') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#8844FF') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <mesh ref={meshRef} position={primitive.position} rotation={primitive.rotation || [0, 0, 0]} scale={primitive.scale}>
      <octahedronGeometry args={[0.5, 1]} />
      <shaderMaterial
        vertexShader={CRYSTAL_VERT} fragmentShader={CRYSTAL_FRAG} uniforms={uniforms}
        transparent side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATER — plane with animated sine-wave vertex displacement + transparency
// ═══════════════════════════════════════════════════════════════════════════════

const WATER_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
varying float vHeight;
void main() {
  vUv = uv;
  vec3 pos = position;
  float w1 = sin(pos.x * 2.0 + uTime * uSpeed * 1.2) * 0.04;
  float w2 = sin(pos.y * 3.0 + uTime * uSpeed * 0.8) * 0.03;
  float w3 = cos(pos.x * 1.5 + pos.y * 2.5 + uTime * uSpeed * 1.5) * 0.02;
  pos.z += w1 + w2 + w3;
  vHeight = w1 + w2 + w3;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const WATER_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
varying vec2 vUv;
varying float vHeight;
${GLSL_FBM}
void main() {
  float caustic = fbm(vUv * 8.0 + vec2(uTime * uSpeed * 0.1, -uTime * uSpeed * 0.08));
  vec3 col = mix(uColor1, uColor2, caustic * 0.6 + vHeight * 3.0);
  float spec = pow(caustic, 3.0) * 0.3 * uIntensity;
  col += vec3(spec);
  float alpha = 0.55 + 0.1 * sin(uTime * uSpeed * 0.5 + vUv.x * 6.0);
  gl_FragColor = clamp(vec4(col, alpha), 0.0, 1.0);
}
`

export function WaterShader({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uIntensity: { value: clampIntensity(primitive.intensity ?? 1.0) },
    uColor1: { value: new THREE.Color(primitive.color || '#004466') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#0088AA') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <mesh
      ref={meshRef}
      position={primitive.position}
      rotation={primitive.rotation || [-Math.PI / 2, 0, 0]}
      scale={[primitive.scale[0], primitive.scale[2], primitive.scale[1]]}
    >
      <planeGeometry args={[1, 1, 32, 32]} />
      <shaderMaterial
        vertexShader={WATER_VERT} fragmentShader={WATER_FRAG} uniforms={uniforms}
        transparent side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTICLE EMITTER — point sprites with lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

const PARTICLE_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
attribute float aSeed;
attribute float aScale;
varying float vAlpha;
varying float vLife;
void main() {
  float life = fract(aSeed + uTime * uSpeed * (0.035 + fract(aSeed * 7.0) * 0.04));
  vLife = life;
  vec3 pos = position;
  pos.y += life * 3.0;
  pos.x += sin(aSeed * 50.0 + uTime * uSpeed * 1.2) * life * 0.8;
  pos.z += cos(aSeed * 37.0 + uTime * uSpeed * 0.9) * life * 0.8;
  vAlpha = smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.4, life);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = mix(6.0, 1.5, life) * aScale * (150.0 / max(1.0, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;
}
`

const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uIntensity;
varying float vAlpha;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float circle = smoothstep(0.5, 0.1, d);
  vec3 col = mix(uColor1, uColor2, vLife);
  gl_FragColor = clamp(vec4(col * uIntensity, circle * vAlpha * 0.7), 0.0, 1.0);
}
`

export function ParticleEmitterShader({ primitive }: { primitive: CraftedPrimitive }) {
  const pointsRef = useRef<THREE.Points>(null)
  const count = Math.min(500, Math.max(10, primitive.particleCount ?? 80))

  const { positions, seeds, scales } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const sd = new Float32Array(count)
    const sc = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.5
      pos[i * 3 + 1] = Math.random() * 0.2
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.5
      sd[i] = Math.random()
      sc[i] = 0.5 + Math.random() * 1.5
    }
    return { positions: pos, seeds: sd, scales: sc }
  }, [count])

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uIntensity: { value: clampIntensity(primitive.intensity ?? 1.0) },
    uColor1: { value: new THREE.Color(primitive.color || '#FFAA00') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#FF4400') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <points ref={pointsRef} position={primitive.position} rotation={primitive.rotation || [0, 0, 0]} scale={primitive.scale}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={PARTICLE_VERT} fragmentShader={PARTICLE_FRAG} uniforms={uniforms}
        transparent blending={THREE.AdditiveBlending} depthWrite={false}
      />
    </points>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOW ORB — sphere with fresnel rim + pulse
// Uses NormalBlending to prevent framebuffer blowout
// ═══════════════════════════════════════════════════════════════════════════════

const GLOW_ORB_VERT = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vPos;
void main() {
  vPos = position;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const GLOW_ORB_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
varying vec3 vNormalV;
varying vec3 vPos;
${GLSL_FBM}
void main() {
  // Fresnel in view space — guaranteed normalized, no NaN
  float NdotV = abs(vNormalV.z);
  float fresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), 2.5);
  // Internal bands
  float band1 = sin(vPos.y * 8.0 + uTime * uSpeed * 1.2) * 0.5 + 0.5;
  float band2 = sin(vPos.x * 4.0 - uTime * uSpeed * 0.7) * 0.5 + 0.5;
  float internal = band1 * band2;
  // FBM filaments
  float filament = fbm(vPos.xy * 4.8 + vec2(uTime * uSpeed * 0.15, -uTime * uSpeed * 0.12));
  // Pulse
  float pulse = 0.7 + 0.3 * sin(uTime * uSpeed * 2.0);
  vec3 col = mix(uColor1, uColor2, fresnel);
  col += internal * uColor2 * 0.2 + filament * uColor1 * 0.15;
  col *= pulse * uIntensity;
  float alpha = 0.4 + fresnel * 0.4;
  gl_FragColor = clamp(vec4(col, alpha), 0.0, 1.0);
}
`

export function GlowOrbShader({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uIntensity: { value: clampIntensity(primitive.intensity ?? 1.0) },
    uColor1: { value: new THREE.Color(primitive.color || '#00FFAA') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#00AAFF') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <mesh ref={meshRef} position={primitive.position} rotation={primitive.rotation || [0, 0, 0]} scale={primitive.scale}>
      <sphereGeometry args={[0.5, 32, 32]} />
      <shaderMaterial
        vertexShader={GLOW_ORB_VERT} fragmentShader={GLOW_ORB_FRAG} uniforms={uniforms}
        transparent side={THREE.FrontSide}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AURORA — curved plane with FBM-driven color curtain
// ═══════════════════════════════════════════════════════════════════════════════

const AURORA_VERT = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
varying vec3 vPos;
${GLSL_FBM}
void main() {
  vUv = uv;
  vec3 pos = position;
  float warp = fbm(vec2(uv.x * 2.6 + uTime * uSpeed * 0.04, uv.y * 4.6 - uTime * uSpeed * 0.025));
  pos.z += sin(uv.x * 4.0 + uTime * uSpeed * 0.3 + warp * 3.0) * 0.15;
  pos.y += cos(uv.x * 2.0 + uTime * uSpeed * 0.2) * 0.05;
  vPos = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const AURORA_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vPos;
${GLSL_FBM}
void main() {
  float warp = fbm(vec2(vUv.x * 3.0 + uTime * uSpeed * 0.06, vUv.y * 5.0 - uTime * uSpeed * 0.04));
  float curtainA = smoothstep(0.2, 0.0, abs(vUv.y - (0.5 + sin(uTime * uSpeed * 0.3 + warp * 5.5) * 0.15)));
  float curtainB = smoothstep(0.15, 0.0, abs(vUv.y - (0.35 + sin(uTime * uSpeed * 0.25 + warp * 4.0 + 1.5) * 0.12))) * 0.7;
  float curtainC = smoothstep(0.12, 0.0, abs(vUv.y - (0.65 + sin(uTime * uSpeed * 0.2 + warp * 3.5 + 3.0) * 0.1))) * 0.5;
  float curtain = curtainA + curtainB + curtainC;
  float striation = pow(fbm(vUv * 12.0 + vec2(uTime * uSpeed * 0.1)), 2.2);
  float colorMix = fbm(vec2(vUv.x * 2.0 + uTime * uSpeed * 0.08, 0.0));
  vec3 col = mix(uColor1, uColor2, colorMix);
  col = mix(col, uColor3, smoothstep(0.6, 0.9, colorMix) * 0.5);
  float breath = 0.58 + 0.42 * sin(uTime * uSpeed * 0.27 + warp * 5.0);
  col *= curtain * (0.7 + striation * 0.5) * breath * uIntensity;
  float alpha = curtain * 0.6 * breath;
  gl_FragColor = clamp(vec4(col, alpha), 0.0, 1.0);
}
`

export function AuroraShader({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: primitive.speed ?? 1 },
    uIntensity: { value: clampIntensity(primitive.intensity ?? 1.0) },
    uColor1: { value: new THREE.Color(primitive.color || '#00FF66') },
    uColor2: { value: new THREE.Color(primitive.color2 || '#00AAFF') },
    uColor3: { value: new THREE.Color(primitive.color3 || '#FF44AA') },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })

  return (
    <mesh ref={meshRef} position={primitive.position} rotation={primitive.rotation || [0, 0, 0]} scale={primitive.scale}>
      <planeGeometry args={[1, 1, 64, 32]} />
      <shaderMaterial
        vertexShader={AURORA_VERT} fragmentShader={AURORA_FRAG} uniforms={uniforms}
        transparent blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false}
      />
    </mesh>
  )
}

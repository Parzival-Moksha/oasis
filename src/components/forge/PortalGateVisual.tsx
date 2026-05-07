'use client'

import { Center, Text3D } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  getPortalGateLabel,
  PORTAL_GATE_VARIANT_DEFS,
  type PortalGate,
  type PortalGateVariant,
} from '../../lib/portal-gates'

interface PortalGateVisualProps {
  gate: PortalGate
}

const PORTAL_LABEL_FONT = '/fonts/helvetiker_regular.typeface.json'

// Per-variant label colors. Front/back faces get the bright accent (emissive,
// reads as the portal's mood). Sides get a darker, metallic version so the
// extrusion carves visible volume in the letter — like neon piping with
// a metallic frame around the glow. Trick: face is matte+emissive (catches no
// reflection, glows), sides are metallic+dim (catch HDRI reflections, look
// like polished metal). The eye reads the contrast as readable depth.
const PORTAL_LABEL_COLORS: Record<PortalGateVariant, { face: string; faceEmissive: string; side: string; sideEmissive: string }> = {
  'threshold-ring':  { face: '#a5f3fc', faceEmissive: '#67e8f9', side: '#0e3946', sideEmissive: '#0e7490' },
  'void-door':       { face: '#ddd6fe', faceEmissive: '#a78bfa', side: '#1e1b34', sideEmissive: '#4c1d95' },
  'hologram-gate':   { face: '#f5f1e6', faceEmissive: '#d7d0c0', side: '#2a261d', sideEmissive: '#7a6f55' },
  'solar-arch':      { face: '#fde68a', faceEmissive: '#fbbf24', side: '#3b1f06', sideEmissive: '#92400e' },
  'rift-slit':       { face: '#fbcfe8', faceEmissive: '#f472b6', side: '#3f1129', sideEmissive: '#9d174d' },
  'stargate-vortex': { face: '#bae6fd', faceEmissive: '#38bdf8', side: '#0c2a3e', sideEmissive: '#0369a1' },
  'crystal-cavern':  { face: '#e9d5ff', faceEmissive: '#c084fc', side: '#2a154d', sideEmissive: '#6b21a8' },
  'verdant-arch':    { face: '#fecaca', faceEmissive: '#ef4444', side: '#3a1010', sideEmissive: '#991b1b' },
  'mirror-pool':     { face: '#bae6fd', faceEmissive: '#7dd3fc', side: '#0c2a3e', sideEmissive: '#075985' },
  'clockwork-iris':  { face: '#fef3c7', faceEmissive: '#facc15', side: '#3a2a06', sideEmissive: '#a16207' },
}

function PortalLabel({ gate }: { gate: PortalGate }) {
  const palette = PORTAL_LABEL_COLORS[gate.variant] ?? PORTAL_LABEL_COLORS['threshold-ring']
  const label = getPortalGateLabel(gate)
  const dim = gate.inert ? 0.4 : 1
  // Position: 3m higher than the old HTML label (was y=3.15 → now 6.15).
  // Center wraps the extruded geometry so it horizontally centers above the gate.
  return (
    <group position={[0, 6.15, 0]}>
      <Center>
        <Text3D
          font={PORTAL_LABEL_FONT}
          size={0.55}
          height={0.18}
          bevelEnabled
          bevelThickness={0.025}
          bevelSize={0.012}
          bevelSegments={4}
          curveSegments={6}
        >
          {label}
          {/* Front/back faces — emissive accent, near-zero metalness so the
              face glows uniformly at any viewing angle. */}
          <meshStandardMaterial
            attach="material-0"
            color={palette.face}
            emissive={palette.faceEmissive}
            emissiveIntensity={1.6 * dim}
            metalness={0.18}
            roughness={0.32}
          />
          {/* Sides (extrusion + bevel). Dark metallic — picks up environment
              reflections, frames the glowing face like a sign-sign rim. */}
          <meshStandardMaterial
            attach="material-1"
            color={palette.side}
            emissive={palette.sideEmissive}
            emissiveIntensity={0.32 * dim}
            metalness={0.92}
            roughness={0.18}
          />
        </Text3D>
      </Center>
    </group>
  )
}

type PortalMood = 'arcane' | 'void' | 'hologram' | 'solar' | 'rift' | 'forest' | 'water' | 'clockwork'
type PortalWorldProfile = 'starwell' | 'void' | 'grid' | 'sun' | 'rift' | 'galaxy' | 'crystal' | 'forest' | 'ocean' | 'machine'

const MOOD_COLORS: Record<
  PortalMood,
  { primary: string; secondary: string; core: string; dark: string; stone: string; ember: string }
> = {
  arcane: { primary: '#58d5ff', secondary: '#fff5c2', core: '#063a56', dark: '#020917', stone: '#657184', ember: '#bdf7ff' },
  void: { primary: '#9f7cff', secondary: '#5ff0ff', core: '#05030b', dark: '#010006', stone: '#4d425f', ember: '#dacbff' },
  hologram: { primary: '#6effe8', secondary: '#ffffff', core: '#023944', dark: '#011113', stone: '#385d65', ember: '#d7fffb' },
  solar: { primary: '#ffb84a', secondary: '#fff3b0', core: '#ff5a24', dark: '#1b0700', stone: '#80623a', ember: '#fff0bf' },
  rift: { primary: '#ff4fd8', secondary: '#76f8ff', core: '#17001f', dark: '#08000c', stone: '#5f4568', ember: '#ffd4fa' },
  forest: { primary: '#6ee7b7', secondary: '#dcfce7', core: '#052e16', dark: '#02140a', stone: '#36533b', ember: '#bbf7d0' },
  water: { primary: '#7dd3fc', secondary: '#e0f2fe', core: '#082f49', dark: '#011827', stone: '#2f5f72', ember: '#bae6fd' },
  clockwork: { primary: '#facc15', secondary: '#fef3c7', core: '#422006', dark: '#160a00', stone: '#8a642c', ember: '#fde68a' },
}

const GREEK_STONE_PALETTE = ['#c8c3b6', '#8f8b82', '#e5dfcf', '#5c5a55']
const _CAVE_STONE_PALETTE = ['#1e2027', '#393d49', '#626879', '#12141a']

type PortalApertureShape = 'ellipse' | 'door' | 'slit' | 'pool' | 'circle'

const PORTAL_APERTURE_SHAPES: Record<PortalApertureShape, number> = {
  ellipse: 0,
  door: 1,
  slit: 2,
  pool: 3,
  circle: 4,
}

const PORTAL_APERTURE_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const PORTAL_APERTURE_FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform float uSeed;
uniform float uShape;
uniform float uIntensity;
uniform float uOrganic;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uVoid;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.78, -0.62, 0.62, 0.78);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p * 2.03 + vec2(11.7, 4.1);
    amplitude *= 0.5;
  }
  return value;
}

float starLayer(vec2 uv, float scale, float threshold) {
  vec2 cell = floor(uv * scale);
  vec2 local = fract(uv * scale) - 0.5;
  vec2 offset = vec2(hash21(cell + uSeed + 3.1), hash21(cell + uSeed + 8.7)) - 0.5;
  float sparkle = step(threshold, hash21(cell + uSeed * 0.37));
  float distanceToStar = length(local - offset);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.7 + hash21(cell) * 4.0) + hash21(cell + 5.0) * 6.28318);
  return smoothstep(0.052, 0.0, distanceToStar) * sparkle * twinkle;
}

float portalMask(vec2 p) {
  vec2 warped = p;
  warped += uOrganic * 0.025 * vec2(
    sin(p.y * 7.0 + uTime * 0.8 + uSeed),
    cos(p.x * 6.0 - uTime * 0.6 + uSeed)
  );

  if (uShape < 0.5) {
    return length(warped / vec2(0.72, 1.0));
  }
  if (uShape < 1.5) {
    return max(abs(warped.x) / 0.62, abs(warped.y) / 0.96);
  }
  if (uShape < 2.5) {
    float edgeWave = sin(warped.y * 12.0 + uTime * 2.2 + uSeed) * 0.04 * (0.25 + uOrganic);
    return max(abs(warped.x + edgeWave) / 0.18, abs(warped.y) / 1.0);
  }
  if (uShape < 3.5) {
    return length(warped / vec2(0.92, 0.68));
  }
  return length(warped);
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float mask = portalMask(p);
  if (mask > 1.0) discard;

  float angle = atan(p.y, p.x);
  float radius = length(p);
  float edge = smoothstep(0.64, 1.0, mask);
  float core = 1.0 - smoothstep(0.05, 1.0, mask);
  float tunnel = sin(angle * (7.0 + uShape * 1.8) - radius * (23.0 + uIntensity * 6.0) - uTime * (1.15 + uIntensity));
  vec2 swirl = p;
  swirl += vec2(cos(angle + uTime * 0.12), sin(angle - uTime * 0.1)) * tunnel * 0.075 * (0.35 + uOrganic);

  float nebula = fbm(swirl * (2.1 + uIntensity * 0.8) + vec2(uSeed * 0.11, uTime * 0.05));
  float horizon = smoothstep(-0.85, 0.6, p.y + sin(p.x * 4.0 + uSeed) * 0.08);
  float stars = starLayer(vUv + vec2(uTime * 0.006, -uTime * 0.012), 44.0, 0.972);
  stars += starLayer(vUv + vec2(-uTime * 0.012, uTime * 0.004), 88.0, 0.986) * 0.72;

  vec3 deepSky = mix(uVoid, uPrimary * 0.18 + uVoid * 0.82, nebula);
  vec3 farWorld = mix(deepSky, uSecondary * 0.24 + uVoid * 0.76, horizon * 0.28);
  vec3 color = farWorld;
  color += uPrimary * max(tunnel, 0.0) * 0.15 * pow(1.0 - mask * 0.55, 2.0);
  color += uSecondary * stars * (0.85 + uIntensity * 0.35);
  color += uSecondary * pow(edge, 2.6) * (0.34 + uIntensity * 0.18);
  color += uPrimary * core * 0.08;
  color = pow(color, vec3(0.86));

  gl_FragColor = vec4(color, 1.0);
}
`

function seededRandom(seed: number) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

function makeProceduralStoneTexture(seed: number, palette: string[] = ['#6f7280', '#3f424c', '#9ca0aa']) {
  const random = seededRandom(seed)
  const size = 96
  const colors = palette.map(color => new THREE.Color(color))
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = Math.floor(x / 16) + Math.floor(y / 16) * 7
      const base = colors[cell % colors.length]
      const grain = (Math.sin(x * 0.51 + seed) + Math.cos(y * 0.37 + seed * 0.7)) * 0.08 + (random() - 0.5) * 0.18
      const mortar = (x % 16 < 1 || y % 16 < 1) ? -0.32 : 0
      const crack = Math.abs(Math.sin((x + y * 1.7 + seed) * 0.17)) > 0.985 ? -0.38 : 0
      const shade = THREE.MathUtils.clamp(0.82 + grain + mortar + crack, 0.18, 1.18)
      const offset = (y * size + x) * 4
      data[offset] = Math.round(base.r * 255 * shade)
      data[offset + 1] = Math.round(base.g * 255 * shade)
      data[offset + 2] = Math.round(base.b * 255 * shade)
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2.6, 2.6)
  texture.needsUpdate = true
  return texture
}

function StoneTexturedMaterial({
  seed,
  palette,
  color = '#c0c3cb',
  emissive = '#050507',
  emissiveIntensity = 0,
  inert,
  roughness = 0.88,
}: {
  seed: number
  palette?: string[]
  color?: string
  emissive?: string
  emissiveIntensity?: number
  inert?: boolean
  roughness?: number
}) {
  const texture = useMemo(() => makeProceduralStoneTexture(seed, palette), [palette, seed])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <meshStandardMaterial
      map={texture}
      color={color}
      emissive={emissive}
      emissiveIntensity={inert ? emissiveIntensity * 0.25 : emissiveIntensity}
      roughness={roughness}
      metalness={0.06}
      transparent={Boolean(inert)}
      opacity={inert ? 0.62 : 1}
      side={THREE.DoubleSide}
      depthWrite
    />
  )
}

function makeStarPositions(seed: number, count: number, width: number, height: number, zSpread: number) {
  const random = seededRandom(seed)
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * width
    positions[index * 3 + 1] = (random() - 0.5) * height
    positions[index * 3 + 2] = -0.06 - random() * zSpread
  }
  return positions
}

function PortalStarfield({
  seed,
  color,
  accentColor,
  width = 1.65,
  height = 2.45,
  count = 86,
  depth = 0.32,
  drift = 0.025,
  inert,
}: {
  seed: number
  color: string
  accentColor?: string
  width?: number
  height?: number
  count?: number
  depth?: number
  drift?: number
  inert?: boolean
}) {
  const pointsRef = useRef<THREE.Points>(null)
  const deepPointsRef = useRef<THREE.Points>(null)
  const positions = useMemo(() => makeStarPositions(seed, count, width, height, depth), [count, depth, height, seed, width])
  const deepPositions = useMemo(
    () => makeStarPositions(seed + 97, Math.max(18, Math.floor(count * 0.55)), width * 0.58, height * 0.72, depth * 1.8),
    [count, depth, height, seed, width]
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (pointsRef.current) {
      pointsRef.current.rotation.z = Math.sin(t * 0.12 + seed) * 0.08
      pointsRef.current.position.z = -0.05 + Math.sin(t * 0.55 + seed) * drift
      pointsRef.current.scale.setScalar(1 + Math.sin(t * 0.8 + seed) * 0.025)
    }
    if (deepPointsRef.current) {
      deepPointsRef.current.rotation.z = -t * 0.045 - seed * 0.01
      deepPointsRef.current.position.z = -0.22 + Math.cos(t * 0.36 + seed) * drift * 1.8
      deepPointsRef.current.scale.setScalar(0.74 + Math.sin(t * 0.5 + seed) * 0.04)
    }
  })

  return (
    <group>
      <points ref={deepPointsRef} position={[0, 0, -0.22]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[deepPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={accentColor ?? color}
          size={inert ? 0.018 : 0.026}
          sizeAttenuation
          transparent
          opacity={inert ? 0.16 : 0.46}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points ref={pointsRef} position={[0, 0, -0.05]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={inert ? 0.022 : 0.034}
          sizeAttenuation
          transparent
          opacity={inert ? 0.3 : 0.86}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

function PortalAperture({
  mood,
  seed,
  shape = 'ellipse',
  size = [1.28, 2.12],
  position = [0, 0, -0.11],
  intensity = 1,
  organic = 0.45,
  inert,
}: {
  mood: PortalMood
  seed: number
  shape?: PortalApertureShape
  size?: [number, number]
  position?: [number, number, number]
  intensity?: number
  organic?: number
  inert?: boolean
}) {
  const colors = MOOD_COLORS[mood]
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uShape: { value: PORTAL_APERTURE_SHAPES[shape] },
      uIntensity: { value: inert ? intensity * 0.38 : intensity },
      uOrganic: { value: inert ? organic * 0.28 : organic },
      uPrimary: { value: new THREE.Color(inert ? colors.stone : colors.primary) },
      uSecondary: { value: new THREE.Color(inert ? '#b8c0d0' : colors.secondary) },
      uVoid: { value: new THREE.Color(inert ? '#05070d' : colors.dark) },
    },
    vertexShader: PORTAL_APERTURE_VERTEX_SHADER,
    fragmentShader: PORTAL_APERTURE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    transparent: false,
  }), [colors.dark, colors.primary, colors.secondary, colors.stone, inert, intensity, organic, seed, shape])

  useEffect(() => () => material.dispose(), [material])

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime
  })

  return (
    <mesh position={position} renderOrder={-2}>
      <planeGeometry args={[size[0], size[1], 1, 1]} />
      <primitive attach="material" object={material} />
    </mesh>
  )
}

// ░▒▓ Sky aperture — single-pass discard ▓▒░
// What it is: a flat plane inside the gate frame whose fragment shader
//   1. discards pixels outside the aperture shape (so it reads as a punched-out window),
//   2. samples a procedural starry sky by world-space view direction.
// As the camera turns, the sky behind the cutout rotates exactly like a real
// window into space. As the player walks past the gate, the direction through
// each fragment shifts, giving subtle parallax. There are no 3D star meshes —
// stars are computed on-GPU from camera-direction lat/lon, so they live on a
// celestial sphere at infinity.
//
// Replaces an earlier two-pass stencil-buffer aperture: that approach silently
// fails when the WebGL renderer wasn't built with stencil enabled, and the
// per-fragment discard here is robust in any renderer config.
const PORTAL_SKY_APERTURE_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

// HDRI-based sky aperture. Samples a real equirectangular night-sky JPG by
// world-direction. High-res, real stars, no procedural blobs.
const PORTAL_SKY_APERTURE_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uSky;
uniform float uShape;
uniform float uIntensity;
uniform vec3 uTint;
uniform float uHasSky;

varying vec2 vUv;
varying vec3 vWorldPosition;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

// Aperture cookie-cutter. Plane size IS aperture size; each shape fills the
// plane edge-to-edge. Round → length(p), rectangular → chebyshev. >1 outside.
//   0 = ellipse, 1 = door, 2 = slit, 3 = pool, 4 = circle
float portalMask(vec2 p) {
  if (uShape < 0.5) return length(p);
  if (uShape < 1.5) return max(abs(p.x), abs(p.y));
  if (uShape < 2.5) return max(abs(p.x), abs(p.y));
  if (uShape < 3.5) return length(p);
  return length(p);
}

void main() {
  // Cookie-cutter the aperture shape with discard. Single-pass stencil.
  vec2 p = (vUv - 0.5) * 2.0;
  float mask = portalMask(p);
  if (mask > 1.0) discard;

  // World-space ray from camera through this fragment. Equirectangular UV
  // = lat/lon. Sampling an HDRI by direction gives true skybox-at-infinity
  // behavior: rotating the camera rotates the sky 1:1, walking past the
  // gate gives subtle window parallax.
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  vec2 skyUv = vec2(
    atan(direction.z, direction.x) / TAU + 0.5,
    asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5
  );

  // HDRI texture sample if available; otherwise dark fallback.
  vec3 color = uHasSky > 0.5
    ? texture2D(uSky, skyUv).rgb * uTint * uIntensity
    : vec3(0.012, 0.014, 0.04) * uIntensity;

  // Tiny inner-edge fade so the rim sits like glass against the frame.
  color *= 1.0 - smoothstep(0.985, 1.0, mask) * 0.22;

  gl_FragColor = vec4(color, 1.0);
}
`

// Singleton HDRI loader. The night-sky JPG is shared by every gate's aperture
// — one fetch, one GPU upload, every PortalSkyAperture samples the same
// texture by world-direction. Lazy because we don't want to fetch during SSR.
const PORTAL_SKY_HDRI_PATH = '/hdri/NightSkyHDRI001_4K_TONEMAPPED.jpg'
let _portalSkyTexture: THREE.Texture | null = null
function getPortalSkyTexture(): THREE.Texture | null {
  if (typeof window === 'undefined') return null
  if (!_portalSkyTexture) {
    const tex = new THREE.TextureLoader().load(
      `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${PORTAL_SKY_HDRI_PATH}`,
    )
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    _portalSkyTexture = tex
  }
  return _portalSkyTexture
}

function PortalSkyAperture({
  seed,
  shape = 'ellipse',
  size = [1.18, 1.94],
  position = [0, 0, -0.02],
  intensity = 1,
  inert,
}: {
  // mood param kept on the call signature but unused now that the HDRI carries
  // the visual identity. Left in place so callers don't need to be refactored.
  mood?: PortalMood
  seed: number
  shape?: PortalApertureShape
  size?: [number, number]
  position?: [number, number, number]
  intensity?: number
  inert?: boolean
}) {
  const skyTexture = getPortalSkyTexture()
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uSky: { value: skyTexture },
      uHasSky: { value: skyTexture ? 1 : 0 },
      uShape: { value: PORTAL_APERTURE_SHAPES[shape] },
      uIntensity: { value: inert ? intensity * 0.6 : intensity },
      uTint: { value: new THREE.Color(inert ? '#a0a0b0' : '#ffffff') },
    },
    vertexShader: PORTAL_SKY_APERTURE_VERTEX_SHADER,
    fragmentShader: PORTAL_SKY_APERTURE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  }), [inert, intensity, shape, skyTexture])

  useEffect(() => () => material.dispose(), [material])

  // Refresh the uniform if the texture finishes loading after material creation.
  useFrame(() => {
    if (skyTexture && skyTexture.image && material.uniforms.uHasSky.value === 0) {
      material.uniforms.uSky.value = skyTexture
      material.uniforms.uHasSky.value = 1
    }
    void seed
  })

  return (
    <mesh position={position} renderOrder={1}>
      <planeGeometry args={[size[0], size[1], 1, 1]} />
      <primitive attach="material" object={material} />
    </mesh>
  )
}

function MirrorGlassSkin({
  mood,
  shape = 'ellipse',
  size = [1.22, 2.06],
  opacity = 0.2,
  inert,
}: {
  mood: PortalMood
  shape?: PortalApertureShape
  size?: [number, number]
  opacity?: number
  inert?: boolean
}) {
  const glassRef = useRef<THREE.Mesh>(null)
  const colors = MOOD_COLORS[mood]
  const isRounded = shape === 'ellipse' || shape === 'circle' || shape === 'pool'

  useFrame(({ clock }) => {
    if (!glassRef.current) return
    const t = clock.elapsedTime
    glassRef.current.rotation.z = Math.sin(t * 0.35 + size[0]) * (shape === 'slit' ? 0.035 : 0.018)
    glassRef.current.scale.set(
      size[0] * (1 + Math.sin(t * 1.1 + size[1]) * 0.018),
      size[1] * (1 + Math.cos(t * 0.94 + size[0]) * 0.012),
      1,
    )
  })

  return (
    <mesh ref={glassRef} position={[0, 0, 0.075]} scale={[size[0], size[1], 1]} renderOrder={3}>
      {isRounded ? <circleGeometry args={[0.5, 128]} /> : <planeGeometry args={[1, 1, 1, 1]} />}
      <meshPhysicalMaterial
        color={colors.secondary}
        emissive={colors.primary}
        emissiveIntensity={inert ? 0.06 : 0.18}
        transparent
        opacity={inert ? opacity * 0.35 : opacity}
        metalness={0.66}
        roughness={0.08}
        clearcoat={1}
        clearcoatRoughness={0.05}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

function PortalWorldGlimpse({
  mood,
  profile,
  size = [1.18, 1.9],
  inert,
}: {
  mood: PortalMood
  profile: PortalWorldProfile
  size?: [number, number]
  inert?: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const opacity = inert ? 0.16 : 0.72
  const sx = size[0]
  const sy = size[1]
  const moonRadius = Math.min(sx, sy) * 0.105

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const t = clock.elapsedTime
    groupRef.current.rotation.z = Math.sin(t * 0.16 + sx) * 0.012
  })

  const mat = (color: string, alpha = opacity, additive = true) => (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={alpha}
      depthWrite={false}
      side={THREE.DoubleSide}
      blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
    />
  )

  const moon = (key: string, x: number, y: number, radius: number, color = colors.secondary, alpha = opacity * 0.7) => (
    <mesh key={key} position={[x * sx, y * sy, 0.025]}>
      <circleGeometry args={[radius, 48]} />
      {mat(color, alpha)}
    </mesh>
  )

  const horizon = (color: string, alpha = opacity * 0.5) => (
    <mesh position={[0, -0.36 * sy, 0.018]} scale={[sx, sy, 1]}>
      <circleGeometry args={[0.52, 48, 0, Math.PI]} />
      {mat(color, alpha, false)}
    </mesh>
  )

  return (
    <group ref={groupRef} position={[0, 0, 0.02]} renderOrder={2}>
      {profile === 'starwell' && (
        <>
          {moon('moon-a', -0.22, 0.22, moonRadius * 0.9)}
          {moon('moon-b', 0.26, 0.08, moonRadius * 0.55, colors.primary, opacity * 0.52)}
          <mesh position={[0, -0.24 * sy, 0.02]} scale={[sx, sy, 1]}>
            <ringGeometry args={[0.24, 0.28, 72]} />
            {mat(colors.secondary, opacity * 0.42)}
          </mesh>
          {horizon(colors.primary, opacity * 0.22)}
        </>
      )}
      {profile === 'void' && (
        <>
          <mesh position={[0, 0.02 * sy, 0.025]} scale={[sx, sy, 1]}>
            <circleGeometry args={[0.22, 72]} />
            <meshBasicMaterial color="#000000" transparent opacity={inert ? 0.72 : 0.92} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.02 * sy, 0.03]} scale={[sx, sy, 1]}>
            <ringGeometry args={[0.22, 0.25, 72]} />
            {mat(colors.secondary, opacity * 0.44)}
          </mesh>
          {moon('void-star', 0.26, 0.29, moonRadius * 0.38, colors.secondary, opacity * 0.42)}
          {horizon(colors.primary, opacity * 0.12)}
        </>
      )}
      {profile === 'grid' && (
        <group>
          {[-0.36, -0.18, 0, 0.18, 0.36].map(x => (
            <mesh key={`grid-v-${x}`} position={[x * sx, 0, 0.02]}>
              <boxGeometry args={[0.006, sy * 0.84, 0.012]} />
              {mat(colors.primary, opacity * 0.28)}
            </mesh>
          ))}
          {[-0.34, -0.16, 0.02, 0.2, 0.38].map(y => (
            <mesh key={`grid-h-${y}`} position={[0, y * sy, 0.02]}>
              <boxGeometry args={[sx * 0.84, 0.006, 0.012]} />
              {mat(colors.secondary, opacity * 0.24)}
            </mesh>
          ))}
          {moon('grid-node', 0.28, 0.3, moonRadius * 0.45, colors.secondary, opacity * 0.54)}
        </group>
      )}
      {profile === 'sun' && (
        <>
          {moon('sun-core', 0.2, 0.22, moonRadius * 1.35, colors.secondary, opacity * 0.78)}
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (index / 12) * Math.PI * 2
            return (
              <mesh key={index} position={[Math.cos(angle) * sx * 0.28, Math.sin(angle) * sy * 0.24, 0.025]} rotation={[0, 0, angle]}>
                <boxGeometry args={[0.16, 0.012, 0.012]} />
                {mat(index % 2 ? colors.secondary : colors.primary, opacity * 0.42)}
              </mesh>
            )
          })}
          {horizon(colors.ember, opacity * 0.25)}
        </>
      )}
      {profile === 'rift' && (
        <>
          {[-0.22, 0.18, -0.06, 0.09, -0.15].map((x, index) => (
            <mesh key={index} position={[x * sx, (0.34 - index * 0.17) * sy, 0.026]} rotation={[0, 0, x * 2.8]}>
              <tetrahedronGeometry args={[0.055 + index * 0.008, 0]} />
              {mat(index % 2 ? colors.secondary : colors.primary, opacity * 0.62)}
            </mesh>
          ))}
          <mesh position={[0, 0, 0.026]} rotation={[0, 0, -0.18]}>
            <boxGeometry args={[sx * 0.075, sy * 0.78, 0.014]} />
            {mat(colors.secondary, opacity * 0.48)}
          </mesh>
        </>
      )}
      {profile === 'galaxy' && (
        <>
          {[0.24, 0.34, 0.44].map((radius, index) => (
            <mesh key={index} position={[0, 0.02 * sy, 0.024]} scale={[sx, sy, 1]} rotation={[0, 0, index * 0.42]}>
              <ringGeometry args={[radius, radius + 0.01, 96, 1, Math.PI * 0.15, Math.PI * 1.35]} />
              {mat(index % 2 ? colors.secondary : colors.primary, opacity * (0.28 + index * 0.06))}
            </mesh>
          ))}
          {moon('galaxy-core', 0, 0.02, moonRadius * 0.65, colors.secondary, opacity * 0.62)}
        </>
      )}
      {profile === 'crystal' && (
        <>
          {[-0.28, -0.1, 0.12, 0.3].map((x, index) => (
            <mesh key={index} position={[x * sx, (-0.24 + index * 0.12) * sy, 0.025]} rotation={[0.2, 0.3, x]}>
              <octahedronGeometry args={[0.07 + index * 0.012, 0]} />
              {mat(index % 2 ? colors.secondary : colors.primary, opacity * 0.6)}
            </mesh>
          ))}
          {horizon(colors.secondary, opacity * 0.18)}
        </>
      )}
      {profile === 'forest' && (
        <>
          {horizon(colors.core, opacity * 0.5)}
          {[-0.32, -0.18, 0.02, 0.2, 0.34].map((x, index) => (
            <mesh key={index} position={[x * sx, (-0.25 + (index % 2) * 0.06) * sy, 0.026]}>
              <coneGeometry args={[0.04, 0.26, 6]} />
              {mat(index % 2 ? colors.secondary : colors.primary, opacity * 0.44, false)}
            </mesh>
          ))}
          {moon('forest-firefly', 0.24, 0.3, moonRadius * 0.38, colors.secondary, opacity * 0.55)}
        </>
      )}
      {profile === 'ocean' && (
        <>
          {[-0.18, -0.06, 0.06, 0.18].map((y, index) => (
            <mesh key={index} position={[0, y * sy, 0.024]}>
              <torusGeometry args={[sx * (0.18 + index * 0.045), 0.006, 6, 96]} />
              {mat(index % 2 ? colors.secondary : colors.primary, opacity * 0.3)}
            </mesh>
          ))}
          {moon('ocean-moon', -0.24, 0.28, moonRadius * 0.62, '#ffffff', opacity * 0.42)}
          {horizon(colors.primary, opacity * 0.2)}
        </>
      )}
      {profile === 'machine' && (
        <>
          {[0.2, 0.31, 0.42].map((radius, index) => (
            <mesh key={index} position={[0, 0, 0.025]} scale={[sx, sy, 1]} rotation={[0, 0, index * 0.18]}>
              <ringGeometry args={[radius, radius + 0.012, 8 + index * 4]} />
              {mat(index % 2 ? colors.secondary : colors.primary, opacity * 0.38)}
            </mesh>
          ))}
          {Array.from({ length: 7 }, (_, index) => {
            const angle = (index / 7) * Math.PI * 2
            return (
              <mesh key={index} position={[Math.cos(angle) * sx * 0.18, Math.sin(angle) * sy * 0.18, 0.027]} rotation={[0, 0, angle]}>
                <boxGeometry args={[0.1, 0.018, 0.014]} />
                {mat(colors.secondary, opacity * 0.34)}
              </mesh>
            )
          })}
        </>
      )}
    </group>
  )
}

function EmissiveBolts({
  mood,
  inert,
  count = 12,
  radius = 0.96,
  elongated = false,
  seed = 10,
}: {
  mood: PortalMood
  inert?: boolean
  count?: number
  radius?: number
  elongated?: boolean
  seed?: number
}) {
  const boltsRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const bolts = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * Math.PI * 2 + random() * 0.08,
      length: 0.14 + random() * 0.12,
      thickness: 0.026 + random() * 0.018,
      offset: 0.92 + random() * 0.12,
    }))
  }, [count, seed])

  useFrame(({ clock }) => {
    if (!boltsRef.current) return
    boltsRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.45 + seed) * 0.04
  })

  return (
    <group ref={boltsRef} scale={elongated ? [0.78, 1.24, 1] : [1, 1, 1]}>
      {bolts.map((bolt, index) => (
        <mesh
          key={index}
          position={[Math.cos(bolt.angle) * radius * bolt.offset, Math.sin(bolt.angle) * radius * bolt.offset, 0.105]}
          rotation={[0, 0, bolt.angle]}
        >
          <boxGeometry args={[bolt.length, bolt.thickness, 0.05]} />
          <meshStandardMaterial
            color={index % 2 ? colors.secondary : colors.primary}
            emissive={index % 2 ? colors.secondary : colors.primary}
            emissiveIntensity={inert ? 0.35 : 1.65}
            metalness={0.45}
            roughness={0.18}
            transparent
            opacity={inert ? 0.28 : 0.86}
          />
        </mesh>
      ))}
    </group>
  )
}

type FastParticleProfile = 'embers' | 'shards' | 'fireflies' | 'sparks' | 'spray'

function FastParticleSwarm({
  mood,
  inert,
  profile = 'sparks',
  count = 38,
  radius = 0.92,
  elongated = false,
  seed = 100,
  speed = 1.2,
  chaos = 0.45,
}: {
  mood: PortalMood
  inert?: boolean
  profile?: FastParticleProfile
  count?: number
  radius?: number
  elongated?: boolean
  seed?: number
  speed?: number
  chaos?: number
}) {
  const swarmRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const particles = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * Math.PI * 2 + random() * 0.9,
      orbit: (random() > 0.5 ? 1 : -1) * (0.72 + random() * 1.85),
      radius: radius * (0.52 + random() * 0.72),
      phase: random() * Math.PI * 2,
      size: 0.018 + random() * (profile === 'shards' ? 0.07 : 0.04),
      z: -0.04 + random() * 0.22,
      color: random(),
      lift: random(),
    }))
  }, [count, profile, radius, seed])

  useFrame(({ clock }) => {
    if (!swarmRef.current) return
    const t = clock.elapsedTime * (inert ? 0.18 : speed)
    const yScale = elongated ? 1.28 : 1
    swarmRef.current.children.forEach((child, index) => {
      const particle = particles[index]
      if (!particle) return
      const jitter = Math.sin(t * (2.4 + particle.lift * 3.8) + particle.phase) * chaos
      const angle = particle.angle + t * particle.orbit + jitter * 0.36
      const radiusPulse = particle.radius * (1 + Math.sin(t * 3.1 + particle.phase) * chaos * 0.18)
      child.position.set(
        Math.cos(angle) * radiusPulse,
        Math.sin(angle * (profile === 'embers' ? 0.84 : 1)) * radiusPulse * yScale + Math.sin(t * 5.2 + particle.phase) * chaos * 0.09,
        particle.z + Math.cos(t * 4.4 + particle.phase) * chaos * 0.08,
      )
      child.rotation.set(t * (1.2 + particle.lift), t * (0.7 + particle.color), angle)
      child.scale.setScalar((inert ? 0.62 : 1) * (1 + Math.sin(t * 7.0 + particle.phase) * 0.34))
    })
  })

  const colorFor = (value: number) => {
    if (profile === 'embers') return value > 0.62 ? '#fff3b0' : value > 0.28 ? '#ff6a2b' : colors.primary
    if (profile === 'fireflies') return value > 0.5 ? '#dcfce7' : '#86efac'
    if (profile === 'shards') return value > 0.58 ? colors.secondary : colors.primary
    if (profile === 'spray') return value > 0.5 ? '#e0f2fe' : colors.primary
    return value > 0.5 ? colors.secondary : colors.ember
  }

  return (
    <group ref={swarmRef}>
      {particles.map((particle, index) => (
        <mesh
          key={index}
          position={[Math.cos(particle.angle) * particle.radius, Math.sin(particle.angle) * particle.radius, particle.z]}
        >
          {profile === 'shards'
            ? (index % 2 === 0 ? <tetrahedronGeometry args={[particle.size * 1.7, 0]} /> : <octahedronGeometry args={[particle.size * 1.45, 0]} />)
            : profile === 'embers'
              ? (index % 3 === 0 ? <coneGeometry args={[particle.size * 0.8, particle.size * 3.6, 5]} /> : <sphereGeometry args={[particle.size, 8, 8]} />)
              : profile === 'fireflies'
                ? <sphereGeometry args={[particle.size * 0.86, 8, 8]} />
                : index % 4 === 0
                  ? <icosahedronGeometry args={[particle.size * 1.35, 0]} />
                  : <sphereGeometry args={[particle.size, 8, 8]} />}
          <meshBasicMaterial
            color={colorFor(particle.color)}
            transparent
            opacity={inert ? 0.22 : profile === 'fireflies' ? 0.92 : 0.78}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

// PortalLightningCrown — zigzag-bolt storm.
//
// Each bolt = 5 staged segments + optional 3-segment branch. Inter-segment
// reveal timing: 150 → 120 → 90 → 60 → 30 ms (cumulative ~450 ms growth).
// Once fully grown, the whole bolt fades out over 3 s. ~5 bolts/sec spawn.
//
// Implementation: one <Bolt> mesh per active bolt. Each <Bolt> owns a
// LineSegments with pre-allocated positions. Per-frame in useFrame we
// (a) reveal new segments by writing their endpoints (segments not yet born
// have zero length so they're invisible), (b) crossfade material.opacity.
//
// Spawn/cleanup driven by setInterval + setTimeout. React state holds bolt IDs
// only; geometry/material work is imperative.
//
// Replaces the old "wobbly lines" version. Same prop signature so call sites
// don't change.

interface BoltSegment {
  start: [number, number, number]
  end: [number, number, number]
  birthMs: number
}

interface BoltDescriptor {
  id: string
  segments: BoltSegment[]
  bornAt: number
  color: string
}

const BOLT_GROWTH_TIMINGS = [0, 150, 270, 360, 420] // ms cumulative
const BOLT_GROWTH_TOTAL_MS = 450
const BOLT_FADE_MS = 3000
const BOLT_LIFETIME_MS = BOLT_GROWTH_TOTAL_MS + BOLT_FADE_MS

function makeBolt(seed: number, radius: number, yScale: number, color: string): BoltDescriptor {
  // Random origin around the gate's rim.
  const angle0 = Math.random() * Math.PI * 2
  const startRadius = radius * (0.7 + Math.random() * 0.18)
  let pos: [number, number, number] = [
    Math.cos(angle0) * startRadius,
    Math.sin(angle0) * startRadius * yScale,
    0.12 + Math.random() * 0.08,
  ]
  // Initial direction biased outward (away from gate center) plus tangent.
  let direction: [number, number, number] = [
    Math.cos(angle0) * 0.7 + (Math.random() - 0.5) * 0.5,
    Math.sin(angle0) * yScale * 0.7 + (Math.random() - 0.5) * 0.5,
    (Math.random() - 0.5) * 0.4,
  ]

  const segments: BoltSegment[] = []
  for (let i = 0; i < 5; i++) {
    const len = 0.22 + Math.random() * 0.36
    // Each new segment turns sharply (zigzag) — pick a perpendicular-ish axis.
    if (i > 0) {
      const turn = (Math.random() - 0.5) * 1.6
      direction = [
        direction[0] * Math.cos(turn) - direction[1] * Math.sin(turn),
        direction[0] * Math.sin(turn) + direction[1] * Math.cos(turn),
        direction[2] + (Math.random() - 0.5) * 0.4,
      ]
      // Renormalize to keep step size consistent.
      const m = Math.hypot(direction[0], direction[1], direction[2]) || 1
      direction = [direction[0] / m, direction[1] / m, direction[2] / m]
    }
    const next: [number, number, number] = [
      pos[0] + direction[0] * len,
      pos[1] + direction[1] * len * yScale,
      pos[2] + direction[2] * len * 0.5,
    ]
    segments.push({ start: pos, end: next, birthMs: BOLT_GROWTH_TIMINGS[i] })
    pos = next
  }

  // 70% chance: primary branch off segment 1's end with 3 mini-segments.
  // 50% chance (independent): a secondary branch off segment 2's end with 2
  // mini-segments. Together this ~2× the branching density we had before.
  function spawnBranch(rootIndex: number, count: number, baseBirthOffset: number) {
    let bp = segments[rootIndex].end
    let bd: [number, number, number] = [
      (Math.random() - 0.5) * 1.4,
      (Math.random() - 0.5) * 1.4,
      (Math.random() - 0.5) * 0.4,
    ]
    const bm = Math.hypot(bd[0], bd[1], bd[2]) || 1
    bd = [bd[0] / bm, bd[1] / bm, bd[2] / bm]
    for (let i = 0; i < count; i++) {
      const len = 0.14 + Math.random() * 0.22
      const next: [number, number, number] = [
        bp[0] + bd[0] * len,
        bp[1] + bd[1] * len * yScale,
        bp[2] + bd[2] * len * 0.5,
      ]
      segments.push({
        start: bp,
        end: next,
        birthMs: baseBirthOffset + i * 60,
      })
      bp = next
      const turn = (Math.random() - 0.5) * 1.4
      bd = [
        bd[0] * Math.cos(turn) - bd[1] * Math.sin(turn),
        bd[0] * Math.sin(turn) + bd[1] * Math.cos(turn),
        bd[2] + (Math.random() - 0.5) * 0.3,
      ]
    }
  }

  if (Math.random() < 0.7) spawnBranch(1, 3, 240)
  if (Math.random() < 0.5) spawnBranch(2, 2, 320)
  if (Math.random() < 0.3) spawnBranch(3, 2, 380)

  return {
    id: `bolt-${seed}-${performance.now()}-${Math.random().toString(36).slice(2, 7)}`,
    segments,
    bornAt: performance.now(),
    color,
  }
}

function Bolt({ bolt, intensity }: { bolt: BoltDescriptor; intensity: number }) {
  // Pre-allocate a positions buffer for up to 11 segments × 2 verts × 3 floats.
  const segmentCount = bolt.segments.length
  const positions = useMemo(() => new Float32Array(segmentCount * 2 * 3), [segmentCount])
  const lineRef = useRef<THREE.LineSegments>(null)
  const materialRef = useRef<THREE.LineBasicMaterial>(null)
  // NOTE: deliberately no per-bolt pointLight. Spawning/disposing 5 lights/sec
  // forces Three.js to recompile every shader in the scene whenever the active
  // light count changes — that's a hard GPU stall (200+ ms freezes). Additive
  // blending on the line itself is bright enough; if we want bloom we add a
  // single static light per gate instead, in PortalLightningCrown.

  useFrame(() => {
    const elapsed = performance.now() - bolt.bornAt
    // Reveal segments by writing their endpoints once their birthMs has passed.
    // Pre-birth segments stay zero-length (start == end) so they render as a
    // single (invisible) point rather than a stale line from the prior frame.
    for (let i = 0; i < segmentCount; i++) {
      const seg = bolt.segments[i]
      const visible = elapsed >= seg.birthMs
      const offset = i * 6
      if (visible) {
        positions[offset] = seg.start[0]
        positions[offset + 1] = seg.start[1]
        positions[offset + 2] = seg.start[2]
        positions[offset + 3] = seg.end[0]
        positions[offset + 4] = seg.end[1]
        positions[offset + 5] = seg.end[2]
      } else {
        positions[offset] = positions[offset + 3] = seg.start[0]
        positions[offset + 1] = positions[offset + 4] = seg.start[1]
        positions[offset + 2] = positions[offset + 5] = seg.start[2]
      }
    }
    if (lineRef.current) {
      const attr = lineRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
      attr.needsUpdate = true
    }

    // Opacity envelope: ramp 0→1 over first 30 ms, then linear fade over 3 s.
    let alpha = 0
    if (elapsed < 30) {
      alpha = elapsed / 30
    } else if (elapsed < BOLT_GROWTH_TOTAL_MS) {
      alpha = 1
    } else {
      alpha = Math.max(0, 1 - (elapsed - BOLT_GROWTH_TOTAL_MS) / BOLT_FADE_MS)
    }
    if (materialRef.current) materialRef.current.opacity = alpha * intensity
  })

  return (
    <lineSegments ref={lineRef} renderOrder={9}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        ref={materialRef}
        color={bolt.color}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        linewidth={2}
      />
    </lineSegments>
  )
}

function PortalLightningCrown({
  mood,
  inert,
  seed = 300,
  radius = 1,
  elongated = false,
  intensity = 1,
}: {
  mood: PortalMood
  inert?: boolean
  seed?: number
  count?: number
  radius?: number
  elongated?: boolean
  intensity?: number
}) {
  const colors = MOOD_COLORS[mood]
  const [bolts, setBolts] = useState<BoltDescriptor[]>([])
  const yScale = elongated ? 1.35 : 1

  useEffect(() => {
    if (inert) return
    let active = true
    // ~5 bolts per second = 200 ms interval. Lifespan ~3.45 s, so steady-state
    // population is ~17 bolts on screen.
    const spawnEvery = 200
    const tick = () => {
      if (!active) return
      const bolt = makeBolt(seed, radius, yScale, colors.secondary)
      setBolts(prev => [...prev, bolt])
      window.setTimeout(() => {
        if (!active) return
        setBolts(prev => prev.filter(b => b.id !== bolt.id))
      }, BOLT_LIFETIME_MS + 60)
    }
    const interval = window.setInterval(tick, spawnEvery)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [inert, seed, radius, yScale, colors.secondary])

  if (inert) {
    return (
      <pointLight
        color={colors.secondary}
        intensity={0.18}
        distance={2.4}
        decay={2}
        position={[0, 0, 0.42]}
      />
    )
  }

  return (
    <group>
      {bolts.map(b => <Bolt key={b.id} bolt={b} intensity={intensity} />)}
    </group>
  )
}

function PortalFlameJets({
  mood,
  inert,
  seed = 400,
  count = 18,
  width = 1.15,
  height = 1.72,
  intensity = 1,
}: {
  mood: PortalMood
  inert?: boolean
  seed?: number
  count?: number
  width?: number
  height?: number
  intensity?: number
}) {
  const flameRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const jets = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, (_, index) => {
      const side = index % 3 === 0 ? 0 : index % 2 === 0 ? -1 : 1
      return {
        x: side === 0 ? (random() - 0.5) * width * 1.1 : side * (width * (0.38 + random() * 0.22)),
        y: side === 0 ? -height * (0.42 + random() * 0.14) : -height * 0.28 + random() * height * 0.82,
        phase: random() * Math.PI * 2,
        size: 0.06 + random() * 0.1,
        lean: (random() - 0.5) * 0.8,
      }
    })
  }, [count, height, seed, width])

  useFrame(({ clock }) => {
    if (!flameRef.current) return
    const t = clock.elapsedTime
    flameRef.current.children.forEach((child, index) => {
      const jet = jets[index]
      if (!jet) return
      const pulse = 1 + Math.sin(t * (7.5 + index * 0.25) + jet.phase) * (inert ? 0.08 : 0.38)
      child.position.y = jet.y + Math.max(0, Math.sin(t * 3.4 + jet.phase)) * 0.12 * intensity
      child.rotation.z = jet.lean + Math.sin(t * 4.8 + jet.phase) * 0.18
      child.scale.set(jet.size * (0.7 + pulse * 0.34), jet.size * (3.2 + pulse * 1.9) * intensity, jet.size)
    })
  })

  return (
    <group ref={flameRef}>
      {jets.map((jet, index) => (
        <mesh key={index} position={[jet.x, jet.y, 0.12]} rotation={[0, 0, jet.lean]}>
          <coneGeometry args={[1, 1, index % 2 ? 5 : 8]} />
          <meshBasicMaterial
            color={index % 4 === 0 ? colors.secondary : index % 3 === 0 ? '#ff6a2b' : colors.primary}
            transparent
            opacity={inert ? 0.14 : 0.54 + (index % 3) * 0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      <pointLight color={colors.primary} intensity={inert ? 0.25 : 1.9 * intensity} distance={4.8} decay={2.1} position={[0, -height * 0.32, 0.5]} />
    </group>
  )
}

function StoneCaveMouth({
  mood,
  inert,
  seed = 500,
  count = 30,
  scale = [1, 1, 1],
  showBacking = true,
}: {
  mood: PortalMood
  inert?: boolean
  seed?: number
  count?: number
  scale?: [number, number, number]
  // Set false when an explicit aperture (like PortalSkyAperture) is rendering
  // the inside of the gate — the dark backing would otherwise hide it.
  showBacking?: boolean
}) {
  const colors = MOOD_COLORS[mood]
  const rocks = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.18
      const ovalX = 1.05 + random() * 0.28
      const ovalY = 1.28 + random() * 0.34
      return {
        angle,
        x: Math.cos(angle) * ovalX,
        y: Math.sin(angle) * ovalY,
        z: -0.05 - random() * 0.08,
        size: 0.16 + random() * 0.26,
        squash: [0.75 + random() * 0.9, 0.7 + random() * 0.86, 0.7 + random() * 0.7] as [number, number, number],
        color: random(),
        rotate: [random() * 0.8, random() * 0.8, angle + random() * 0.7] as [number, number, number],
      }
    })
  }, [count, seed])

  return (
    <group scale={scale}>
      {showBacking && (
        <mesh position={[0, 0.03, -0.16]} scale={[1.34, 1.62, 1]}>
          <circleGeometry args={[0.9, 96]} />
          <meshBasicMaterial color="#030306" transparent opacity={inert ? 0.42 : 0.78} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {rocks.map((rock, index) => (
        <mesh key={index} position={[rock.x, rock.y, rock.z]} rotation={rock.rotate} scale={rock.squash}>
          {index % 5 === 0 ? <boxGeometry args={[rock.size * 1.4, rock.size, rock.size * 0.76]} /> : <dodecahedronGeometry args={[rock.size, 0]} />}
          <meshStandardMaterial
            color={rock.color > 0.76 ? colors.stone : rock.color > 0.48 ? '#2f3340' : '#171923'}
            emissive={rock.color > 0.84 ? colors.primary : '#050507'}
            emissiveIntensity={inert ? 0.03 : rock.color > 0.84 ? 0.22 : 0.04}
            roughness={0.86}
            metalness={0.08}
            transparent={Boolean(inert)}
            opacity={inert ? 0.64 : 1}
            side={THREE.DoubleSide}
            depthWrite
          />
        </mesh>
      ))}
      {[-0.54, -0.24, 0.18, 0.46].map((x, index) => (
        <mesh key={`stalactite-${index}`} position={[x, 1.18 + (index % 2) * 0.12, 0.02]} rotation={[0, 0, x * 0.38]}>
          <coneGeometry args={[0.09 + index * 0.012, 0.52 + (index % 2) * 0.18, 7]} />
          <meshStandardMaterial color="#20242f" roughness={0.92} metalness={0.05} transparent={Boolean(inert)} opacity={inert ? 0.48 : 1} side={THREE.DoubleSide} depthWrite />
        </mesh>
      ))}
      <mesh position={[0, -1.42, -0.02]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.26, 72]} />
        <meshBasicMaterial color="#060609" transparent opacity={inert ? 0.18 : 0.42} depthWrite={false} />
      </mesh>
    </group>
  )
}

function RootTendrilWreath({ mood, inert, seed = 600 }: { mood: PortalMood; inert?: boolean; seed?: number }) {
  const rootRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const tendrils = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: 18 }, (_, index) => {
      const side = index % 2 === 0 ? -1 : 1
      return {
        x: side * (0.66 + random() * 0.24),
        y: -1.08 + random() * 2.28,
        rot: side * (0.36 + random() * 0.72),
        len: 0.34 + random() * 0.72,
        width: 0.025 + random() * 0.045,
        phase: random() * Math.PI * 2,
      }
    })
  }, [seed])

  useFrame(({ clock }) => {
    if (!rootRef.current) return
    const t = clock.elapsedTime
    rootRef.current.children.forEach((child, index) => {
      const tendril = tendrils[index]
      if (!tendril) return
      const pulse = 1 + Math.sin(t * 2.8 + tendril.phase) * (inert ? 0.03 : 0.13)
      child.rotation.z = tendril.rot + Math.sin(t * 1.7 + tendril.phase) * 0.08
      child.scale.set(tendril.width * pulse, tendril.len * (1 + Math.sin(t * 2.3 + tendril.phase) * 0.07), tendril.width)
    })
  })

  return (
    <group ref={rootRef}>
      {tendrils.map((tendril, index) => (
        <mesh key={index} position={[tendril.x, tendril.y, 0.08]} rotation={[0, 0, tendril.rot]}>
          <cylinderGeometry args={[1, 0.55, 1, 7]} />
          <meshStandardMaterial
            color={index % 3 === 0 ? colors.primary : colors.stone}
            emissive={index % 4 === 0 ? colors.primary : colors.dark}
            emissiveIntensity={inert ? 0.03 : index % 4 === 0 ? 0.34 : 0.06}
            roughness={0.78}
            metalness={0.05}
            transparent
            opacity={inert ? 0.42 : 0.88}
          />
        </mesh>
      ))}
    </group>
  )
}

function EnergyVeil({
  mood,
  shape = 'circle',
  scale = [1, 1, 1],
  opacity = 0.28,
  inert,
}: {
  mood: PortalMood
  shape?: 'circle' | 'plane'
  scale?: [number, number, number]
  opacity?: number
  inert?: boolean
}) {
  const colors = MOOD_COLORS[mood]
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.elapsedTime
    meshRef.current.rotation.z = Math.sin(t * 0.42) * 0.08
    meshRef.current.scale.set(scale[0] * (1 + Math.sin(t * 1.7) * 0.025), scale[1] * (1 + Math.cos(t * 1.3) * 0.018), scale[2])
  })

  return (
    <mesh ref={meshRef} position={[0, 0, -0.035]}>
      {shape === 'circle' ? <circleGeometry args={[0.92, 96]} /> : <planeGeometry args={[1.2, 2.28]} />}
      <meshBasicMaterial
        color={colors.core}
        transparent
        opacity={inert ? opacity * 0.35 : opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

function PortalDepthTunnel({
  mood,
  inert,
  elongated = false,
  rings = 7,
  radius = 0.78,
  zStep = 0.085,
}: {
  mood: PortalMood
  inert?: boolean
  elongated?: boolean
  rings?: number
  radius?: number
  zStep?: number
}) {
  const tunnelRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!tunnelRef.current) return
    const t = clock.elapsedTime
    tunnelRef.current.rotation.z = t * (inert ? 0.035 : 0.11)
    tunnelRef.current.scale.setScalar(1 + Math.sin(t * 1.1) * (inert ? 0.008 : 0.022))
  })

  return (
    <group ref={tunnelRef} scale={elongated ? [0.7, 1.18, 1] : [1, 1, 1]}>
      {Array.from({ length: rings }, (_, index) => {
        const depthScale = 1 - index * 0.07
        const opacity = (inert ? 0.08 : 0.25) * (1 - index / (rings + 1))
        return (
          <mesh
            key={index}
            position={[0, 0, -0.06 - index * zStep]}
            rotation={[0, 0, index * 0.32]}
            scale={[depthScale, depthScale, 1]}
          >
            <ringGeometry args={[radius + index * 0.02, radius + 0.035 + index * 0.02, index % 2 ? 8 : 72]} />
            <meshBasicMaterial
              color={index % 2 ? colors.secondary : colors.primary}
              transparent
              opacity={opacity}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function RimHalo({
  mood,
  inert,
  scale = [1, 1, 1],
  radius = 0.9,
  thickness = 0.08,
  opacity = 0.34,
}: {
  mood: PortalMood
  inert?: boolean
  scale?: [number, number, number]
  radius?: number
  thickness?: number
  opacity?: number
}) {
  const haloRef = useRef<THREE.Mesh>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!haloRef.current) return
    const t = clock.elapsedTime
    haloRef.current.rotation.z = Math.sin(t * 0.22) * 0.05
    haloRef.current.scale.set(scale[0] * (1 + Math.sin(t * 1.25) * 0.03), scale[1] * (1 + Math.cos(t * 1.05) * 0.025), scale[2])
  })

  return (
    <mesh ref={haloRef} position={[0, 0, 0.045]}>
      <ringGeometry args={[radius, radius + thickness, 112]} />
      <meshBasicMaterial
        color={colors.secondary}
        transparent
        opacity={inert ? opacity * 0.34 : opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

function OrbitingParticles({
  mood,
  inert,
  count = 20,
  radius = 0.9,
  elongated = false,
  seed = 5,
  spinSpeed = 0.18,
  buzz = 0.025,
}: {
  mood: PortalMood
  inert?: boolean
  count?: number
  radius?: number
  elongated?: boolean
  seed?: number
  spinSpeed?: number
  buzz?: number
}) {
  const particlesRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]
  const particles = useMemo(() => {
    const random = seededRandom(seed)
    return Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * Math.PI * 2 + random() * 0.16,
      radius: radius * (0.82 + random() * 0.32),
      size: 0.014 + random() * 0.026,
      z: -0.02 + random() * 0.16,
    }))
  }, [count, radius, seed])

  useFrame(({ clock }) => {
    if (!particlesRef.current) return
    const t = clock.elapsedTime
    particlesRef.current.rotation.z = t * (inert ? -0.05 : -spinSpeed)
    particlesRef.current.position.z = Math.sin(t * (0.9 + spinSpeed * 0.35) + seed) * buzz
    particlesRef.current.scale.setScalar(1 + Math.sin(t * (1.2 + spinSpeed * 0.18) + seed) * (inert ? 0.012 : buzz * 0.9))
  })

  return (
    <group ref={particlesRef} scale={elongated ? [0.74, 1.18, 1] : [1, 1, 1]}>
      {particles.map((particle, index) => (
        <mesh
          key={index}
          position={[Math.cos(particle.angle) * particle.radius, Math.sin(particle.angle) * particle.radius, particle.z]}
        >
          <sphereGeometry args={[particle.size, 8, 8]} />
          <meshBasicMaterial
            color={index % 3 === 0 ? colors.secondary : colors.ember}
            transparent
            opacity={inert ? 0.2 : 0.82}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

function RuneRing({
  radius,
  count,
  mood,
  inert,
  elongated = false,
}: {
  radius: number
  count: number
  mood: PortalMood
  inert?: boolean
  elongated?: boolean
}) {
  const ringRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!ringRef.current) return
    ringRef.current.rotation.z = clock.elapsedTime * (inert ? 0.06 : 0.18)
  })

  return (
    <group ref={ringRef} scale={elongated ? [0.78, 1.18, 1] : [1, 1, 1]}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        const x = Math.cos(angle) * radius
        const y = Math.sin(angle) * radius
        const longRune = index % 3 === 0
        return (
          <mesh key={index} position={[x, y, 0.035]} rotation={[0, 0, angle]}>
            <boxGeometry args={[longRune ? 0.12 : 0.055, 0.025, 0.035]} />
            <meshBasicMaterial
              color={longRune ? colors.secondary : colors.primary}
              transparent
              opacity={inert ? 0.22 : 0.74}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function CrystalHalo({ mood, inert, radius = 1.18, count = 8 }: { mood: PortalMood; inert?: boolean; radius?: number; count?: number }) {
  const haloRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!haloRef.current) return
    haloRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.3) * 0.12
  })

  return (
    <group ref={haloRef}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2
        const x = Math.cos(angle) * radius
        const y = Math.sin(angle) * radius
        const size = index % 2 === 0 ? 0.18 : 0.11
        return (
          <mesh key={index} position={[x, y, 0.06]} rotation={[0.4, 0.2, angle]}>
            <octahedronGeometry args={[size, 0]} />
            <meshBasicMaterial
              color={index % 2 === 0 ? colors.primary : colors.secondary}
              transparent
              opacity={inert ? 0.28 : 0.78}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function SmokeWisps({ mood, inert }: { mood: PortalMood; inert?: boolean }) {
  const smokeRef = useRef<THREE.Group>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!smokeRef.current) return
    const t = clock.elapsedTime
    smokeRef.current.rotation.z = Math.sin(t * 0.28) * 0.06
    smokeRef.current.scale.set(1 + Math.sin(t * 0.6) * 0.025, 1 + Math.cos(t * 0.42) * 0.018, 1)
  })

  return (
    <group ref={smokeRef} position={[0, -0.08, -0.01]}>
      {[-0.78, -0.48, -0.16, 0.2, 0.52, 0.82].map((x, index) => (
        <mesh
          key={index}
          position={[x, -0.76 + index * 0.15, -0.02 - index * 0.012]}
          scale={[0.42 + index * 0.065, 0.2 + (index % 2) * 0.08, 1]}
          rotation={[0, 0, x + index * 0.22]}
        >
          <circleGeometry args={[0.5, 36]} />
          <meshBasicMaterial
            color={index % 3 === 0 ? colors.secondary : index % 2 ? colors.primary : colors.dark}
            transparent
            opacity={inert ? 0.06 : 0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

function StoneSegmentRing({ mood, inert, elongated = false }: { mood: PortalMood; inert?: boolean; elongated?: boolean }) {
  const colors = MOOD_COLORS[mood]
  return (
    <group scale={elongated ? [0.82, 1.22, 1] : [1, 1, 1]}>
      {Array.from({ length: 20 }, (_, index) => {
        const angle = (index / 20) * Math.PI * 2
        const x = Math.cos(angle) * 1.02
        const y = Math.sin(angle) * 1.02
        return (
          <mesh key={index} position={[x, y, -0.02]} rotation={[0, 0, angle]}>
            <boxGeometry args={[index % 4 === 0 ? 0.3 : 0.2, 0.11, 0.2]} />
            <meshStandardMaterial
              color={index % 5 === 0 ? colors.primary : colors.stone}
              emissive={index % 5 === 0 ? colors.primary : colors.dark}
              emissiveIntensity={inert ? 0.06 : index % 5 === 0 ? 0.58 : 0.12}
              metalness={mood === 'clockwork' ? 0.78 : 0.34}
              roughness={mood === 'forest' ? 0.62 : 0.26}
              transparent
              opacity={inert ? 0.48 : 0.9}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function ThresholdRing({ inert }: { inert?: boolean }) {
  const color = inert ? '#7f8ea3' : MOOD_COLORS.arcane.primary
  return (
    <group position={[0, 1.55, 0]}>
      <SmokeWisps mood="arcane" inert={inert} />
      <StoneSegmentRing mood="arcane" inert={inert} />
      <PortalAperture mood="arcane" seed={211} shape="ellipse" size={[1.24, 2.08]} intensity={1.08} organic={0.38} inert={inert} />
      <PortalWorldGlimpse mood="arcane" profile="starwell" size={[1.04, 1.72]} inert={inert} />
      <PortalSkyAperture mood="arcane" seed={7211} shape="ellipse" size={[1.55, 2.05]} intensity={1.05} inert={inert} />
      <PortalDepthTunnel mood="arcane" inert={inert} elongated rings={8} radius={0.58} zStep={0.075} />
      <MirrorGlassSkin mood="arcane" shape="ellipse" size={[1.08, 1.86]} opacity={0.18} inert={inert} />
      <RimHalo mood="arcane" inert={inert} scale={[0.78, 1.18, 1]} radius={0.82} thickness={0.16} opacity={0.28} />
      <mesh>
        <torusGeometry args={[0.9, 0.09, 16, 96]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={inert ? 0.22 : 1.05}
          metalness={0.62}
          roughness={0.16}
          transparent
          opacity={inert ? 0.62 : 0.98}
        />
      </mesh>
      <mesh scale={[0.72, 1.18, 1]}>
        <torusGeometry args={[0.88, 0.022, 8, 72]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={inert ? 0.18 : 0.7} blending={THREE.AdditiveBlending} />
      </mesh>
      <EnergyVeil mood="arcane" scale={[0.82, 1.14, 1]} opacity={0.32} inert={inert} />
      <PortalStarfield seed={11} color="#d9fbff" accentColor="#fff5c2" width={1.38} height={1.9} count={132} depth={0.54} inert={inert} />
      <RuneRing mood="arcane" radius={0.74} count={24} inert={inert} elongated />
      <OrbitingParticles mood="arcane" inert={inert} radius={0.84} count={28} elongated seed={111} spinSpeed={0.72} buzz={0.045} />
      <FastParticleSwarm mood="arcane" inert={inert} profile="sparks" radius={0.9} count={42} elongated seed={1211} speed={1.45} chaos={0.5} />
      <PortalFlameJets mood="arcane" inert={inert} count={14} width={0.95} height={1.74} seed={4211} intensity={0.72} />
      <CrystalHalo mood="arcane" inert={inert} radius={1.22} count={6} />
      <EmissiveBolts mood="arcane" inert={inert} radius={0.98} count={16} elongated seed={2111} />
      <PortalLightningCrown mood="arcane" inert={inert} radius={1.05} elongated count={18} seed={8121} intensity={0.7} />
      <mesh position={[0, 0, 0.02]} scale={[0.52, 0.52, 1]}>
        <ringGeometry args={[0.44, 0.52, 72]} />
        <meshBasicMaterial color="#fff5c2" transparent opacity={inert ? 0.16 : 0.48} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[0, -1.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 1.28, 96]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.12 : 0.34} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function VoidDoor({ inert }: { inert?: boolean }) {
  const frameColor = inert ? '#6d7484' : MOOD_COLORS.void.primary
  // Obsidian-frame sky-aperture treatment.
  //
  // Material: meshPhysicalMaterial with clearcoat for that "polished volcanic
  // glass" look. Dark base, high metalness, near-zero roughness, IOR ~1.5.
  //
  // Z-fighting: every depth plane is unique. Pillars at z=0, accent strips at
  // z=0.085 (in front), lintels at z=0.012/0.018 (slightly in front to avoid
  // sharing a plane with the pillars), octahedron studs at z=0.16. Sky aperture
  // sits at z=-0.04 so the frame always occludes its rim cleanly.
  return (
    <group position={[0, 1.45, 0]}>
      <PortalSkyAperture mood="void" seed={7329} shape="door" size={[1.34, 2.62]} position={[0, 0, -0.04]} intensity={1.32} inert={inert} />
      <RimHalo mood="void" inert={inert} scale={[0.78, 1.42, 1]} radius={0.5} thickness={0.11} opacity={0.38} />

      {/* Pillars — obsidian, polished glassy black */}
      {[-0.62, 0.62].map((x, i) => (
        <mesh key={`pillar-${i}`} position={[x, 0, 0]}>
          <boxGeometry args={[0.18, 2.82, 0.24]} />
          <meshPhysicalMaterial
            color="#0a0612"
            metalness={0.92}
            roughness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.05}
            ior={1.55}
            reflectivity={0.92}
            envMapIntensity={1.4}
            emissive="#1a0628"
            emissiveIntensity={inert ? 0.04 : 0.16}
          />
        </mesh>
      ))}

      {/* Inner accent strips — slightly forward (z=0.085) so they don't share
          a plane with the pillars (z=0) */}
      {[-0.64, 0.64].map((x, i) => (
        <mesh key={`accent-${i}`} position={[x, 0, 0.085]}>
          <boxGeometry args={[0.05, 2.58, 0.08]} />
          <meshStandardMaterial
            color={frameColor}
            emissive={frameColor}
            emissiveIntensity={inert ? 0.32 : 1.1}
            metalness={0.85}
            roughness={0.06}
            transparent
            opacity={0.92}
          />
        </mesh>
      ))}

      {/* Top lintel — slightly forward (z=0.012) so it doesn't share z=0 with pillars */}
      <mesh position={[0, 1.34, 0.012]}>
        <boxGeometry args={[1.42, 0.2, 0.26]} />
        <meshPhysicalMaterial
          color="#0e0816"
          metalness={0.9}
          roughness={0.1}
          clearcoat={0.9}
          clearcoatRoughness={0.08}
          ior={1.55}
          envMapIntensity={1.3}
          emissive="#160020"
          emissiveIntensity={0.08}
        />
      </mesh>

      {/* Bottom lintel — z=0.018 to keep its own plane */}
      <mesh position={[0, -1.34, 0.018]}>
        <boxGeometry args={[1.5, 0.18, 0.26]} />
        <meshPhysicalMaterial
          color="#080510"
          metalness={0.95}
          roughness={0.12}
          clearcoat={0.85}
          clearcoatRoughness={0.1}
          ior={1.55}
          envMapIntensity={1.2}
          emissive="#0a0014"
          emissiveIntensity={0.04}
        />
      </mesh>

      {/* Decorative crown studs — emissive octahedrons, additive-blended */}
      {[-0.42, 0, 0.42].map((x, index) => (
        <mesh key={`stud-${index}`} position={[x, 1.36, 0.16 + index * 0.001]} rotation={[0, 0, index * 0.4]}>
          <octahedronGeometry args={[0.1, 0]} />
          <meshBasicMaterial color={index === 1 ? '#5ff0ff' : frameColor} transparent opacity={inert ? 0.24 : 0.72} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  )
}

function GreekTempleGate({ inert }: { inert?: boolean }) {
  // Pantheon-flavored. Doric column flutes (8 each, deeper than before),
  // 3-tier stepped stylobate base, full architrave + frieze + cornice
  // entablature, triangular pediment with sculpted tympanum infill, plus
  // central rosette and palmette acroteria.
  const stoneColor = inert ? '#8a877e' : '#d7d0c0'
  const stoneDark = inert ? '#65605a' : '#a09684'
  const stoneAccent = inert ? '#5a554d' : '#7d7363'

  return (
    <group position={[0, 1.42, 0]}>
      <PortalSkyAperture mood="clockwork" seed={9441} shape="door" size={[1.7, 2.55]} intensity={0.86} inert={inert} />

      {/* Two columns. Each: shaft, capital block (echinus + abacus), base
          torus, and 8 fluted grooves running the height of the shaft. */}
      {[-0.96, 0.96].map((x, index) => (
        <group key={`column-${index}`} position={[x, -0.12, 0.06]}>
          {/* Tapered shaft (Doric proportion: top 0.86× base diameter) */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.16, 0.2, 2.55, 24]} />
            <StoneTexturedMaterial seed={440 + index} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
          </mesh>
          {/* Capital — echinus (rounded cushion) + abacus (square slab) */}
          <mesh position={[0, 1.34, 0]}>
            <cylinderGeometry args={[0.22, 0.16, 0.12, 20]} />
            <StoneTexturedMaterial seed={540 + index * 2} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
          </mesh>
          <mesh position={[0, 1.43, 0]}>
            <boxGeometry args={[0.58, 0.08, 0.36]} />
            <StoneTexturedMaterial seed={541 + index * 2} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
          </mesh>
          {/* Base — torus + plinth */}
          <mesh position={[0, -1.32, 0]}>
            <cylinderGeometry args={[0.24, 0.24, 0.08, 18]} />
            <StoneTexturedMaterial seed={640 + index} palette={GREEK_STONE_PALETTE} color={stoneAccent} inert={inert} />
          </mesh>
          <mesh position={[0, -1.41, 0]}>
            <boxGeometry args={[0.6, 0.1, 0.4]} />
            <StoneTexturedMaterial seed={641 + index} palette={GREEK_STONE_PALETTE} color={stoneAccent} inert={inert} />
          </mesh>
          {/* 8 deeper flutes */}
          {Array.from({ length: 8 }, (_, groove) => {
            const a = (groove / 8) * Math.PI * 2
            return (
              <mesh key={groove} position={[Math.cos(a) * 0.175, 0, Math.sin(a) * 0.175 + 0.05]} rotation={[0, -a, 0]}>
                <boxGeometry args={[0.024, 2.32, 0.04]} />
                <meshStandardMaterial color={stoneAccent} roughness={0.78} metalness={0.05} transparent opacity={inert ? 0.6 : 0.85} />
              </mesh>
            )
          })}
        </group>
      ))}

      {/* Entablature — three stacked horizontal members above the columns. */}
      {/* 1. Architrave (smooth bottom band) */}
      <mesh position={[0, 1.32, 0.02]}>
        <boxGeometry args={[2.46, 0.18, 0.42]} />
        <StoneTexturedMaterial seed={742} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
      </mesh>
      {/* 2. Frieze (slightly recessed, with triglyph blocks for Doric vibe) */}
      <mesh position={[0, 1.46, 0.0]}>
        <boxGeometry args={[2.46, 0.16, 0.4]} />
        <StoneTexturedMaterial seed={743} palette={GREEK_STONE_PALETTE} color={stoneAccent} inert={inert} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => {
        const x = -1.05 + (i / 6) * 2.1
        return (
          <mesh key={`triglyph-${i}`} position={[x, 1.46, 0.21]}>
            <boxGeometry args={[0.1, 0.14, 0.04]} />
            <StoneTexturedMaterial seed={744 + i} palette={GREEK_STONE_PALETTE} color={stoneDark} inert={inert} />
          </mesh>
        )
      })}
      {/* 3. Cornice (overhanging cap) */}
      <mesh position={[0, 1.6, 0.04]}>
        <boxGeometry args={[2.66, 0.1, 0.5]} />
        <StoneTexturedMaterial seed={745} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
      </mesh>

      {/* Triangular pediment — front face is a flat triangular plate; the
          existing cone is the side ridge profile. */}
      <mesh position={[0, 1.92, 0.06]} rotation={[0, 0, 0]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-1.33, 0, 0, 1.33, 0, 0, 0, 0.6, 0]), 3]}
          />
          <bufferAttribute attach="attributes-normal" args={[new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3]} />
        </bufferGeometry>
        <StoneTexturedMaterial seed={841} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
      </mesh>
      {/* Pediment ridge profile (the original cone, slightly smaller now) */}
      <mesh position={[0, 1.92, 0]} scale={[1.33, 0.36, 0.3]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.8, 1.12, 3]} />
        <StoneTexturedMaterial seed={842} palette={GREEK_STONE_PALETTE} color={stoneColor} emissive="#17120a" emissiveIntensity={0.04} inert={inert} />
      </mesh>

      {/* Central rosette on tympanum */}
      <mesh position={[0, 2.08, 0.13]}>
        <torusGeometry args={[0.13, 0.04, 8, 18]} />
        <meshStandardMaterial color={stoneAccent} roughness={0.6} metalness={0.08} />
      </mesh>
      <mesh position={[0, 2.08, 0.16]}>
        <circleGeometry args={[0.07, 18]} />
        <meshStandardMaterial color={stoneDark} roughness={0.7} metalness={0.05} />
      </mesh>

      {/* Acroteria — three palmette ornaments along the pediment ridge */}
      {[
        { x: 0, y: 2.55, scale: 1.0 },
        { x: -1.32, y: 1.66, scale: 0.7 },
        { x: 1.32, y: 1.66, scale: 0.7 },
      ].map((a, i) => (
        <group key={`acroterion-${i}`} position={[a.x, a.y, 0.04]} scale={a.scale}>
          <mesh>
            <coneGeometry args={[0.09, 0.22, 6]} />
            <StoneTexturedMaterial seed={900 + i} palette={GREEK_STONE_PALETTE} color={stoneAccent} inert={inert} />
          </mesh>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[0.16, 0.05, 0.16]} />
            <StoneTexturedMaterial seed={910 + i} palette={GREEK_STONE_PALETTE} color={stoneAccent} inert={inert} />
          </mesh>
        </group>
      ))}

      {/* Stylobate — three stepped slabs at the base, increasing in width */}
      <mesh position={[0, -1.52, 0.08]}>
        <boxGeometry args={[2.65, 0.16, 0.5]} />
        <StoneTexturedMaterial seed={951} palette={GREEK_STONE_PALETTE} color={stoneColor} inert={inert} />
      </mesh>
      <mesh position={[0, -1.66, 0.12]}>
        <boxGeometry args={[2.85, 0.12, 0.62]} />
        <StoneTexturedMaterial seed={952} palette={GREEK_STONE_PALETTE} color={stoneAccent} inert={inert} />
      </mesh>
      <mesh position={[0, -1.78, 0.16]}>
        <boxGeometry args={[3.08, 0.12, 0.74]} />
        <StoneTexturedMaterial seed={953} palette={GREEK_STONE_PALETTE} color={stoneDark} inert={inert} />
      </mesh>
    </group>
  )
}

function _HologramGate({ inert }: { inert?: boolean }) {
  const color = inert ? '#8a94a6' : MOOD_COLORS.hologram.primary
  return (
    <group position={[0, 1.48, 0]}>
      <PortalAperture mood="hologram" seed={441} shape="door" size={[1.46, 2.5]} intensity={0.94} organic={0.08} inert={inert} />
      <PortalWorldGlimpse mood="hologram" profile="grid" size={[1.22, 2.16]} inert={inert} />
      <PortalDepthTunnel mood="hologram" inert={inert} elongated rings={6} radius={0.7} zStep={0.07} />
      <MirrorGlassSkin mood="hologram" shape="door" size={[1.32, 2.32]} opacity={0.12} inert={inert} />
      <PortalStarfield seed={41} color="#eaffff" accentColor="#6effe8" width={1.48} height={2.34} count={108} depth={0.48} inert={inert} />
      <mesh>
        <boxGeometry args={[1.7, 2.78, 0.035]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={inert ? 0.42 : 0.78} />
      </mesh>
      <mesh position={[0, 0, -0.018]}>
        <planeGeometry args={[1.5, 2.46]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.08 : 0.18} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {[-0.48, 0, 0.48].map(x => (
        <mesh key={`h-v-${x}`} position={[x, 0, 0.018]}>
          <boxGeometry args={[0.018, 2.58, 0.03]} />
          <meshBasicMaterial color={color} transparent opacity={0.34} />
        </mesh>
      ))}
      {[-0.72, 0, 0.72].map(y => (
        <mesh key={`h-h-${y}`} position={[0, y, 0.02]}>
          <boxGeometry args={[1.52, 0.018, 0.03]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={inert ? 0.18 : 0.34} />
        </mesh>
      ))}
      <RuneRing mood="hologram" radius={0.88} count={20} inert={inert} elongated />
      <OrbitingParticles mood="hologram" inert={inert} radius={0.78} count={18} elongated seed={341} spinSpeed={0.95} buzz={0.038} />
      <FastParticleSwarm mood="hologram" inert={inert} profile="sparks" radius={0.98} count={32} elongated seed={3341} speed={1.7} chaos={0.34} />
      <EmissiveBolts mood="hologram" inert={inert} radius={0.98} count={14} elongated seed={3441} />
      {[-0.72, 0.72].map((x, index) => (
        <mesh key={`side-node-${index}`} position={[x, 0.72 - index * 1.44, 0.06]}>
          <icosahedronGeometry args={[0.16, 0]} />
          <meshBasicMaterial color={index === 0 ? '#ffffff' : color} transparent opacity={inert ? 0.24 : 0.68} wireframe />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.04]} scale={[0.92, 1.28, 1]}>
        <ringGeometry args={[0.5, 0.56, 6]} />
        <meshBasicMaterial color={color} transparent opacity={inert ? 0.16 : 0.52} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <RimHalo mood="hologram" inert={inert} scale={[0.92, 1.28, 1]} radius={0.58} thickness={0.1} opacity={0.24} />
    </group>
  )
}

function SolarArch({ inert }: { inert?: boolean }) {
  const color = inert ? '#8c8370' : MOOD_COLORS.solar.primary
  const rays = Array.from({ length: 15 }, (_, index) => index)
  return (
    <group position={[0, 1.42, 0]}>
      <SmokeWisps mood="solar" inert={inert} />
      <StoneSegmentRing mood="solar" inert={inert} elongated />
      <PortalAperture mood="solar" seed={559} shape="ellipse" size={[1.14, 1.92]} intensity={1.25} organic={0.32} inert={inert} />
      <PortalWorldGlimpse mood="solar" profile="sun" size={[0.96, 1.58]} inert={inert} />
      <PortalDepthTunnel mood="solar" inert={inert} elongated rings={7} radius={0.56} zStep={0.065} />
      <MirrorGlassSkin mood="solar" shape="ellipse" size={[1, 1.74]} opacity={0.14} inert={inert} />
      <RimHalo mood="solar" inert={inert} scale={[0.9, 1.3, 1]} radius={0.76} thickness={0.18} opacity={0.34} />
      <mesh scale={[0.9, 1.3, 1]}>
        <torusGeometry args={[0.82, 0.09, 16, 96]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={inert ? 0.28 : 1.35} metalness={0.68} roughness={0.14} transparent opacity={0.94} />
      </mesh>
      <PortalStarfield seed={59} color="#fff0bf" accentColor="#ff6a2b" width={1.2} height={1.94} count={118} depth={0.48} inert={inert} />
      <EnergyVeil mood="solar" scale={[0.72, 1.02, 1]} opacity={0.34} inert={inert} />
      <mesh position={[0, -1.08, 0]}>
        <boxGeometry args={[1.9, 0.16, 0.22]} />
        <meshBasicMaterial color="#ffe7a1" transparent opacity={inert ? 0.36 : 0.7} />
      </mesh>
      {rays.map(index => {
        const angle = Math.PI * (0.02 + index * 0.068)
        const x = Math.cos(angle) * 1.08
        const y = Math.sin(angle) * 1.38
        return (
          <mesh key={index} position={[x, y, 0]} rotation={[0, 0, angle]}>
            <coneGeometry args={[0.045, index % 2 ? 0.36 : 0.56, 4]} />
            <meshBasicMaterial color={index % 2 ? '#fff3b0' : '#ff6a2b'} transparent opacity={inert ? 0.28 : 0.74} blending={THREE.AdditiveBlending} />
          </mesh>
        )
      })}
      {Array.from({ length: 22 }, (_, index) => {
        const angle = (index / 22) * Math.PI * 2
        const radius = 0.42 + (index % 5) * 0.12
        return (
          <mesh key={`ember-${index}`} position={[Math.cos(angle) * radius, Math.sin(angle) * radius * 1.28, 0.055]}>
            <sphereGeometry args={[index % 3 === 0 ? 0.026 : 0.016, 8, 8]} />
            <meshBasicMaterial color={index % 2 ? '#fff3b0' : '#ff6a2b'} transparent opacity={inert ? 0.18 : 0.72} blending={THREE.AdditiveBlending} />
          </mesh>
        )
      })}
      <PortalFlameJets mood="solar" inert={inert} count={30} width={1.36} height={2.05} seed={1559} intensity={1.52} />
      <FastParticleSwarm mood="solar" inert={inert} profile="embers" radius={1.08} count={68} elongated seed={2559} speed={2.35} chaos={0.72} />
      <OrbitingParticles mood="solar" inert={inert} radius={0.74} count={30} elongated seed={459} spinSpeed={0.88} buzz={0.05} />
      <EmissiveBolts mood="solar" inert={inert} radius={0.92} count={18} elongated seed={4559} />
      <mesh position={[0, -0.02, 0.02]}>
        <circleGeometry args={[0.66, 64]} />
        <meshBasicMaterial color="#ff6a2b" transparent opacity={inert ? 0.1 : 0.28} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

function RiftSlit({ inert }: { inert?: boolean }) {
  const color = inert ? '#87909e' : '#ff4fd8'
  const segments = [
    [-0.05, 0.96, -0.18],
    [0.08, 0.56, 0.14],
    [-0.04, 0.18, -0.1],
    [0.07, -0.22, 0.12],
    [-0.08, -0.64, -0.16],
    [0.02, -1.04, 0.08],
  ] as const
  return (
    <group position={[0, 1.52, 0]}>
      <SmokeWisps mood="rift" inert={inert} />
      <PortalAperture mood="rift" seed={673} shape="slit" size={[0.78, 2.86]} intensity={1.34} organic={1.0} inert={inert} />
      <PortalWorldGlimpse mood="rift" profile="rift" size={[0.48, 2.52]} inert={inert} />
      <PortalSkyAperture mood="rift" seed={7673} shape="slit" size={[0.62, 2.78]} intensity={1.5} inert={inert} />
      <PortalDepthTunnel mood="rift" inert={inert} elongated rings={8} radius={0.36} zStep={0.09} />
      <MirrorGlassSkin mood="rift" shape="slit" size={[0.38, 2.6]} opacity={0.2} inert={inert} />
      <PortalStarfield seed={73} color="#f8d6ff" accentColor="#76f8ff" width={0.88} height={2.82} count={126} depth={0.64} inert={inert} />
      <EnergyVeil mood="rift" shape="plane" scale={[0.38, 1.35, 1]} opacity={0.22} inert={inert} />
      {segments.map(([x, y, rot], index) => (
        <mesh key={index} position={[x, y, 0]} rotation={[0, 0, rot]}>
          <boxGeometry args={[index % 2 ? 0.07 : 0.14, 0.64, 0.065]} />
          <meshBasicMaterial color={index % 2 ? '#ffffff' : color} transparent opacity={inert ? 0.45 : 0.94} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.02]} scale={[0.45, 1.55, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#17001f" transparent opacity={inert ? 0.14 : 0.42} side={THREE.DoubleSide} />
      </mesh>
      {[-0.54, 0.52, -0.38, 0.42, -0.22, 0.24].map((x, index) => (
        <mesh key={`shard-${index}`} position={[x, 1.02 - index * 0.4, 0.04]} rotation={[0.4, 0.2, x]}>
          <tetrahedronGeometry args={[index % 2 ? 0.13 : 0.18, 0]} />
          <meshBasicMaterial color={index % 2 ? '#76f8ff' : color} transparent opacity={inert ? 0.28 : 0.72} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <mesh position={[0, 0.02, 0.055]} scale={[0.2, 1.62, 1]}>
        <ringGeometry args={[0.68, 0.78, 48]} />
        <meshBasicMaterial color="#76f8ff" transparent opacity={inert ? 0.1 : 0.34} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <RimHalo mood="rift" inert={inert} scale={[0.24, 1.64, 1]} radius={0.72} thickness={0.14} opacity={0.36} />
      <PortalLightningCrown mood="rift" inert={inert} radius={0.82} elongated count={44} seed={4673} intensity={1.75} />
      <PortalFlameJets mood="rift" inert={inert} count={16} width={0.66} height={2.1} seed={3673} intensity={0.86} />
      <FastParticleSwarm mood="rift" inert={inert} profile="shards" radius={0.9} count={76} elongated seed={5673} speed={3.15} chaos={1.08} />
      <OrbitingParticles mood="rift" inert={inert} radius={0.56} count={26} elongated seed={573} spinSpeed={1.42} buzz={0.075} />
      <EmissiveBolts mood="rift" inert={inert} radius={0.58} count={12} elongated seed={6673} />
    </group>
  )
}

function StargateVortex({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.48, 0]}>
      <SmokeWisps mood="arcane" inert={inert} />
      <StoneSegmentRing mood="arcane" inert={inert} />
      <PortalAperture mood="arcane" seed={789} shape="circle" size={[1.7, 1.7]} intensity={1.46} organic={0.25} inert={inert} />
      <PortalWorldGlimpse mood="arcane" profile="galaxy" size={[1.44, 1.44]} inert={inert} />
      <PortalSkyAperture mood="arcane" seed={7789} shape="circle" size={[1.78, 1.78]} intensity={1.32} inert={inert} />
      <PortalDepthTunnel mood="arcane" inert={inert} rings={11} radius={0.72} zStep={0.055} />
      <MirrorGlassSkin mood="arcane" shape="circle" size={[1.48, 1.48]} opacity={0.16} inert={inert} />
      <RimHalo mood="arcane" inert={inert} radius={0.96} thickness={0.2} opacity={0.38} />
      <PortalStarfield seed={89} color="#f8fbff" accentColor="#38bdf8" width={1.7} height={1.7} count={176} depth={0.9} inert={inert} />
      <mesh>
        <torusGeometry args={[1.02, 0.11, 18, 128]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={inert ? 0.22 : 1.25} metalness={0.72} roughness={0.12} transparent opacity={inert ? 0.56 : 0.98} />
      </mesh>
      <mesh scale={[0.82, 0.82, 1]} rotation={[0, 0, Math.PI / 8]}>
        <torusGeometry args={[0.95, 0.028, 10, 96]} />
        <meshBasicMaterial color="#f8fafc" transparent opacity={inert ? 0.18 : 0.72} blending={THREE.AdditiveBlending} />
      </mesh>
      <RuneRing mood="arcane" radius={0.96} count={32} inert={inert} />
      <PortalLightningCrown mood="arcane" inert={inert} radius={1.34} count={48} seed={778} intensity={1.6} />
      <FastParticleSwarm mood="arcane" inert={inert} profile="sparks" radius={1.24} count={82} seed={1789} speed={2.85} chaos={0.7} />
      <OrbitingParticles mood="arcane" inert={inert} radius={1.05} count={36} seed={789} spinSpeed={1.18} buzz={0.052} />
      <EmissiveBolts mood="arcane" inert={inert} radius={1.12} count={24} seed={7789} />
      <mesh position={[0, -1.42, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.82, 1.36, 120]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={inert ? 0.1 : 0.3} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function CrystalCavern({ inert }: { inert?: boolean }) {
  // Sky-aperture treatment: frame + crystal shards only. The middle of the
  // gate is a punched-out window into a procedural starfield, sampled by
  // world-space view direction so the sky rotates with the camera.
  return (
    <group position={[0, 1.48, 0]}>
      <StoneCaveMouth mood="rift" inert={inert} scale={[1.55, 1.42, 1]} seed={9897} count={44} showBacking={false} />
      <PortalSkyAperture mood="rift" seed={7897} shape="ellipse" size={[3.12, 3.9]} intensity={1.16} inert={inert} />
      <CrystalHalo mood="rift" inert={inert} radius={1.04} count={12} />
      {Array.from({ length: 9 }, (_, index) => {
        const side = index % 2 === 0 ? -1 : 1
        const y = -1.1 + index * 0.28
        const x = side * (0.9 + (index % 3) * 0.13)
        return (
          <mesh key={index} position={[x, y, 0.04]} rotation={[0.2, 0.3, side * 0.42]}>
            <octahedronGeometry args={[index % 3 === 0 ? 0.24 : 0.17, 0]} />
            <meshBasicMaterial
              color={index % 2 ? '#c084fc' : '#bae6fd'}
              transparent
              opacity={inert ? 0.32 : 0.82}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
      <RimHalo mood="rift" inert={inert} scale={[0.72, 1.34, 1]} radius={0.76} thickness={0.12} opacity={0.3} />
    </group>
  )
}

function _VerdantArch({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.42, 0]}>
      <RootTendrilWreath mood="forest" inert={inert} seed={1907} />
      <PortalSkyAperture mood="forest" seed={5907} shape="ellipse" size={[1.02, 1.96]} intensity={0.92} inert={inert} />
      {[-0.78, 0.78].map((x, index) => (
        <group key={index} position={[x, -0.05, 0]}>
          <mesh rotation={[0, 0, x * 0.18]}>
            <cylinderGeometry args={[0.09, 0.17, 2.55, 10]} />
            <meshBasicMaterial color="#36533b" transparent opacity={inert ? 0.54 : 0.9} />
          </mesh>
          <mesh position={[0, 1.22, 0.02]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshBasicMaterial color="#22c55e" transparent opacity={inert ? 0.28 : 0.68} />
          </mesh>
        </group>
      ))}
      {Array.from({ length: 13 }, (_, index) => {
        const angle = Math.PI * (0.06 + index * 0.07)
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.78, Math.sin(angle) * 1.08, 0.04]} rotation={[0, 0, angle]}>
            <boxGeometry args={[0.2, 0.055, 0.09]} />
            <meshBasicMaterial color={index % 2 ? '#86efac' : '#36533b'} transparent opacity={inert ? 0.34 : 0.76} />
          </mesh>
        )
      })}
      <RimHalo mood="forest" inert={inert} scale={[0.76, 1.22, 1]} radius={0.76} thickness={0.1} opacity={0.28} />
    </group>
  )
}

function EastAsianGate({ inert }: { inert?: boolean }) {
  const lacquer = inert ? '#7f5146' : '#b91c1c'
  const roof = inert ? '#334155' : '#111827'
  const gold = inert ? '#8a7a45' : '#facc15'
  return (
    <group position={[0, 1.42, 0]}>
      <PortalSkyAperture mood="solar" seed={5907} shape="door" size={[1.6, 2.35]} intensity={0.92} inert={inert} />

      {[-0.82, 0.82].map((x, index) => (
        <group key={index} position={[x, -0.1, 0.08]}>
          <mesh>
            <cylinderGeometry args={[0.12, 0.15, 2.62, 16]} />
            <meshStandardMaterial color={lacquer} emissive={lacquer} emissiveIntensity={inert ? 0.05 : 0.18} roughness={0.42} metalness={0.16} />
          </mesh>
          <mesh position={[0, -1.42, 0]}>
            <cylinderGeometry args={[0.22, 0.26, 0.2, 16]} />
            <meshStandardMaterial color="#1f1714" roughness={0.62} />
          </mesh>
          <mesh position={[0, 1.36, 0.02]}>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshStandardMaterial color={gold} emissive={gold} emissiveIntensity={inert ? 0.08 : 0.42} roughness={0.28} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 1.23, 0.08]}>
        <boxGeometry args={[2.16, 0.22, 0.34]} />
        <meshStandardMaterial color={lacquer} emissive={lacquer} emissiveIntensity={inert ? 0.04 : 0.14} roughness={0.38} metalness={0.12} />
      </mesh>
      <mesh position={[0, 1.54, 0.08]}>
        <boxGeometry args={[2.72, 0.18, 0.46]} />
        <meshStandardMaterial color={roof} emissive="#020617" roughness={0.72} metalness={0.18} />
      </mesh>
      {[-1.22, 1.22].map((x, index) => (
        <mesh key={`eave-${index}`} position={[x, 1.48, 0.08]} rotation={[0, 0, index === 0 ? -0.25 : 0.25]}>
          <boxGeometry args={[0.56, 0.16, 0.46]} />
          <meshStandardMaterial color={roof} roughness={0.72} metalness={0.18} />
        </mesh>
      ))}
      <mesh position={[0, 0.88, 0.1]}>
        <boxGeometry args={[1.52, 0.08, 0.2]} />
        <meshStandardMaterial color={gold} emissive={gold} emissiveIntensity={inert ? 0.08 : 0.32} roughness={0.35} />
      </mesh>
      <mesh position={[0, -1.34, 0.05]}>
        <boxGeometry args={[2.2, 0.18, 0.42]} />
        <meshStandardMaterial color="#1f1714" roughness={0.64} metalness={0.06} />
      </mesh>
    </group>
  )
}

function MoonCavernPool({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.4, 0]}>
      <SmokeWisps mood="water" inert={inert} />
      <StoneCaveMouth mood="water" inert={inert} scale={[1.42, 1.28, 1]} seed={5919} count={38} />
      <PortalAperture mood="water" seed={919} shape="pool" size={[1.24, 2.16]} intensity={1.22} organic={0.82} inert={inert} />
      <PortalWorldGlimpse mood="water" profile="ocean" size={[1.04, 1.86]} inert={inert} />
      <PortalDepthTunnel mood="water" inert={inert} elongated rings={10} radius={0.54} zStep={0.06} />
      <MirrorGlassSkin mood="water" shape="pool" size={[1.08, 1.96]} opacity={0.32} inert={inert} />
      <PortalStarfield seed={119} color="#e0f2fe" accentColor="#7dd3fc" width={1.18} height={2.25} count={104} depth={0.45} inert={inert} />
      <mesh position={[0, 0, -0.025]} scale={[0.76, 1.32, 1]}>
        <circleGeometry args={[0.88, 96]} />
        <meshBasicMaterial color="#082f49" transparent opacity={inert ? 0.32 : 0.68} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3].map(index => (
        <mesh key={index} position={[0, 0, 0.03 + index * 0.01]} scale={[0.72 + index * 0.12, 1.14 + index * 0.16, 1]}>
          <ringGeometry args={[0.42 + index * 0.08, 0.45 + index * 0.08, 96]} />
          <meshBasicMaterial color={index % 2 ? '#e0f2fe' : '#7dd3fc'} transparent opacity={inert ? 0.08 : 0.26} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <RimHalo mood="water" inert={inert} scale={[0.78, 1.28, 1]} radius={0.82} thickness={0.08} opacity={0.4} />
      <FastParticleSwarm mood="water" inert={inert} profile="spray" radius={0.94} count={38} elongated seed={2919} speed={1.35} chaos={0.46} />
      <PortalLightningCrown mood="water" inert={inert} radius={0.94} elongated count={14} seed={3919} intensity={0.55} />
      <mesh position={[0, -1.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.94, 96]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={inert ? 0.08 : 0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

function _MirrorPool({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.4, 0]}>
      <SmokeWisps mood="water" inert={inert} />
      <PortalAperture mood="water" seed={919} shape="pool" size={[1.36, 2.3]} intensity={1.18} organic={0.72} inert={inert} />
      <PortalWorldGlimpse mood="water" profile="ocean" size={[1.12, 1.92]} inert={inert} />
      <PortalDepthTunnel mood="water" inert={inert} elongated rings={10} radius={0.54} zStep={0.06} />
      <MirrorGlassSkin mood="water" shape="pool" size={[1.18, 2.02]} opacity={0.3} inert={inert} />
      <PortalStarfield seed={119} color="#e0f2fe" accentColor="#7dd3fc" width={1.18} height={2.25} count={104} depth={0.45} inert={inert} />
      <mesh position={[0, 0, -0.025]} scale={[0.76, 1.32, 1]}>
        <circleGeometry args={[0.88, 96]} />
        <meshBasicMaterial color="#082f49" transparent opacity={inert ? 0.32 : 0.68} side={THREE.DoubleSide} />
      </mesh>
      {[0, 1, 2, 3].map(index => (
        <mesh key={index} position={[0, 0, 0.03 + index * 0.01]} scale={[0.72 + index * 0.12, 1.14 + index * 0.16, 1]}>
          <ringGeometry args={[0.42 + index * 0.08, 0.45 + index * 0.08, 96]} />
          <meshBasicMaterial color={index % 2 ? '#e0f2fe' : '#7dd3fc'} transparent opacity={inert ? 0.08 : 0.26} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <RimHalo mood="water" inert={inert} scale={[0.78, 1.28, 1]} radius={0.82} thickness={0.08} opacity={0.4} />
      <FastParticleSwarm mood="water" inert={inert} profile="spray" radius={0.94} count={38} elongated seed={2919} speed={1.35} chaos={0.46} />
      <PortalLightningCrown mood="water" inert={inert} radius={0.94} elongated count={14} seed={3919} intensity={0.55} />
      <OrbitingParticles mood="water" inert={inert} radius={0.78} count={24} elongated seed={919} spinSpeed={0.68} buzz={0.038} />
      <EmissiveBolts mood="water" inert={inert} radius={0.9} count={12} elongated seed={9919} />
      <mesh position={[0, -1.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.94, 96]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={inert ? 0.08 : 0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

// Cheap cloth flag. planeGeometry with vertex-shader displacement so the
// flag ripples like fabric in heavy wind. The root edge (uv.x=0) is pinned;
// the trailing edge (uv.x=1) flaps with full amplitude. High-freq overlay
// gives that snappy "rapid-flap" feel rather than slow undulation.
const FLAG_VERTEX_SHADER = `
varying vec2 vUv;
varying float vWave;
uniform float uTime;
uniform float uFreq;
uniform float uAmp;

void main() {
  vUv = uv;
  // Distance from the pole — pinned end is uv.x=0.
  float d = uv.x;
  // Primary flap: low-frequency standing wave that grows with distance.
  float w = sin(uTime * uFreq + d * 6.0) * uAmp;
  // High-frequency ripple riding on top — gives the snappy fabric tic.
  w += sin(uTime * uFreq * 1.7 + uv.y * 5.0 + d * 12.0) * uAmp * 0.34;
  // Vertical sway so it's not a flat sheet.
  w += sin(uTime * uFreq * 0.7 + uv.y * 3.0) * uAmp * 0.18 * d;
  vWave = w;
  vec3 displaced = position + vec3(0.0, w * 0.4 * d, w);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`

const FLAG_FRAGMENT_SHADER = `
varying vec2 vUv;
varying float vWave;
uniform vec3 uColor;
uniform vec3 uTrim;
uniform float uOpacity;

void main() {
  // Trim at the leading + trailing edges — paints a contrasting band, gives
  // the eye a flag-like silhouette instead of a uniform rectangle.
  float trimEdge = smoothstep(0.92, 1.0, vUv.x);
  vec3 col = mix(uColor, uTrim, trimEdge);
  // Shade by displacement so the wave reads as actual cloth volume.
  col *= 0.78 + vWave * 0.55;
  gl_FragColor = vec4(col, uOpacity);
}
`

function FlappingFlag({
  position,
  rotation,
  size = [0.6, 0.36],
  color = '#facc15',
  trim = '#7c2d12',
  freq = 8,
  amp = 0.16,
  opacity = 0.92,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  size?: [number, number]
  color?: string
  trim?: string
  freq?: number
  amp?: number
  opacity?: number
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime
  })
  // Plane needs enough subdivisions for the vertex displacement to look smooth.
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[size[0], size[1], 24, 10]} />
      <shaderMaterial
        ref={matRef}
        uniforms={{
          uTime: { value: 0 },
          uFreq: { value: freq },
          uAmp: { value: amp },
          uColor: { value: new THREE.Color(color) },
          uTrim: { value: new THREE.Color(trim) },
          uOpacity: { value: opacity },
        }}
        vertexShader={FLAG_VERTEX_SHADER}
        fragmentShader={FLAG_FRAGMENT_SHADER}
        side={THREE.DoubleSide}
        transparent
      />
    </mesh>
  )
}

function ClockworkIris({ inert }: { inert?: boolean }) {
  return (
    <group position={[0, 1.48, 0]}>
      <PortalAperture mood="clockwork" seed={931} shape="circle" size={[1.42, 1.42]} intensity={0.9} organic={0.04} inert={inert} />
      <PortalWorldGlimpse mood="clockwork" profile="machine" size={[1.16, 1.16]} inert={inert} />
      <PortalDepthTunnel mood="clockwork" inert={inert} rings={8} radius={0.58} zStep={0.065} />
      <MirrorGlassSkin mood="clockwork" shape="circle" size={[1.16, 1.16]} opacity={0.16} inert={inert} />
      <PortalStarfield seed={131} color="#fef3c7" accentColor="#facc15" width={1.22} height={1.72} count={88} depth={0.42} inert={inert} />
      <StoneSegmentRing mood="clockwork" inert={inert} />
      <RimHalo mood="clockwork" inert={inert} radius={0.86} thickness={0.14} opacity={0.34} />
      <mesh>
        <torusGeometry args={[0.88, 0.075, 10, 96]} />
        <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={inert ? 0.18 : 0.96} metalness={0.88} roughness={0.12} transparent opacity={inert ? 0.5 : 0.94} />
      </mesh>
      {Array.from({ length: 18 }, (_, index) => {
        const angle = (index / 18) * Math.PI * 2
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.96, Math.sin(angle) * 0.96, 0.04]} rotation={[0, 0, angle]}>
            <boxGeometry args={[0.1, 0.24, 0.08]} />
            <meshBasicMaterial color={index % 2 ? '#fef3c7' : '#8a642c'} transparent opacity={inert ? 0.36 : 0.78} />
          </mesh>
        )
      })}
      {Array.from({ length: 7 }, (_, index) => (
        <mesh key={`iris-${index}`} position={[0, 0, 0.08]} rotation={[0, 0, (index / 7) * Math.PI * 2]}>
          <coneGeometry args={[0.22, 0.76, 3]} />
          <meshBasicMaterial color="#422006" transparent opacity={inert ? 0.34 : 0.72} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <PortalLightningCrown mood="clockwork" inert={inert} radius={1.05} seed={4931} intensity={0.7} />
      <FastParticleSwarm mood="clockwork" inert={inert} profile="sparks" radius={0.98} count={36} seed={2931} speed={1.55} chaos={0.35} />
      <OrbitingParticles mood="clockwork" inert={inert} radius={0.78} count={20} seed={931} spinSpeed={0.86} buzz={0.032} />
      <EmissiveBolts mood="clockwork" inert={inert} radius={1.02} count={22} seed={9931} />
      {/* Flapping pennants — left + right pair flanking the iris, plus a
          center banner above. Each rooted at the pole-end (closer to gate
          axis) and trailing outward. Different frequencies/amplitudes so
          they don't visually sync. */}
      {!inert && (
        <>
          <FlappingFlag
            position={[-1.2, 0.3, 0.05]}
            size={[0.62, 0.34]}
            color="#facc15"
            trim="#7c2d12"
            freq={9}
            amp={0.18}
          />
          <FlappingFlag
            position={[0.58, 0.3, 0.05]}
            size={[0.62, 0.34]}
            color="#fef3c7"
            trim="#a16207"
            freq={11}
            amp={0.16}
          />
          <FlappingFlag
            position={[-0.42, 1.1, 0.07]}
            size={[0.84, 0.22]}
            color="#fde68a"
            trim="#92400e"
            freq={7.5}
            amp={0.12}
          />
        </>
      )}
    </group>
  )
}

function PortalGateVisualComponent({ gate }: PortalGateVisualProps) {
  return (
    <group position={gate.position} rotation={[0, gate.rotationY ?? 0, 0]} scale={gate.inert ? 0.94 : 1}>
      {gate.variant === 'threshold-ring' && <ThresholdRing inert={gate.inert} />}
      {gate.variant === 'void-door' && <VoidDoor inert={gate.inert} />}
      {gate.variant === 'hologram-gate' && <GreekTempleGate inert={gate.inert} />}
      {gate.variant === 'solar-arch' && <SolarArch inert={gate.inert} />}
      {gate.variant === 'rift-slit' && <RiftSlit inert={gate.inert} />}
      {gate.variant === 'stargate-vortex' && <StargateVortex inert={gate.inert} />}
      {gate.variant === 'crystal-cavern' && <CrystalCavern inert={gate.inert} />}
      {gate.variant === 'verdant-arch' && <EastAsianGate inert={gate.inert} />}
      {gate.variant === 'mirror-pool' && <MoonCavernPool inert={gate.inert} />}
      {gate.variant === 'clockwork-iris' && <ClockworkIris inert={gate.inert} />}
      <PortalLabel gate={gate} />
    </group>
  )
}

export const PortalGateVisual = memo(PortalGateVisualComponent)

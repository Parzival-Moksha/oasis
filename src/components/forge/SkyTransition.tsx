'use client'

// Sky transitions (the owner, 2026-11-19: "one melts away to give way to the next in patches, or rips apart, and
// maybe glitches out into the new one"). Whatever changes the sky (the sky picker, an agent's set_sky, a world
// load), the scene's background image changes; this notices it, keeps the old image, and lays it on a sky dome
// in front of the new one, eaten away by one of three masks over about 1.6 seconds.
//
// Cost: one comparison a frame while nothing happens. During a transition, one sphere drawn first (it writes no
// depth, so the world draws over it as usual) with one texture read and a little noise per pixel.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useFrameWhen } from '@/lib/use-frame-when'

export type SkyTransitionStyle = 'melt' | 'rip' | 'glitch' | 'off'
export const SKY_TRANSITION_STYLES: Array<{ id: SkyTransitionStyle; label: string; blurb: string }> = [
  { id: 'melt', label: 'Melt', blurb: 'The old sky melts away in patches, with a glowing edge.' },
  { id: 'rip', label: 'Rip', blurb: 'The old sky tears open where you look and the halves fall apart.' },
  { id: 'glitch', label: 'Glitch', blurb: 'Blocks of the old sky glitch out, split in colour, and drop away.' },
  { id: 'off', label: 'Off', blurb: 'The new sky appears at once.' },
]

const KEY = 'oasis-sky-transition'
const DURATION = 1.6
let current: SkyTransitionStyle | null = null
const listeners = new Set<() => void>()

export function getSkyTransitionStyle(): SkyTransitionStyle {
  if (current) return current
  if (typeof window === 'undefined') return 'melt'
  let saved: string | null = null
  try { saved = window.localStorage.getItem(KEY) } catch { /* no storage */ }
  current = SKY_TRANSITION_STYLES.some(s => s.id === saved) ? (saved as SkyTransitionStyle) : 'melt'
  return current
}

export function setSkyTransitionStyle(style: SkyTransitionStyle): void {
  current = style
  try { window.localStorage.setItem(KEY, style) } catch { /* no storage */ }
  listeners.forEach(fn => fn())
}

export function useSkyTransitionStyle(): SkyTransitionStyle {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, getSkyTransitionStyle, () => 'melt')
}

const STYLE_INDEX: Record<Exclude<SkyTransitionStyle, 'off'>, number> = { melt: 0, rip: 1, glitch: 2 }

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D uOld;
uniform float uHasOld;
uniform vec3 uFlat;
uniform float uProgress;
uniform float uStyle;
uniform float uTime;
uniform vec3 uLook;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

vec2 equirect(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
}
vec3 oldSky(vec2 uv) { return uHasOld > 0.5 ? texture2D(uOld, uv).rgb : uFlat; }

void main() {
  vec3 d = normalize(vDir);
  vec2 uv = equirect(d);
  float p = clamp(uProgress, 0.0, 1.0);
  vec3 color;
  float keep;      // 1: the old sky shows here, 0: the new one
  float edge = 0.0;

  if (uStyle < 0.5) {
    // Melt: patches of noise fall below a rising threshold; a hot rim on each patch.
    float n = fbm(uv * vec2(9.0, 5.0) + uTime * 0.05);
    float t = mix(0.2, 0.86, p); // fbm lies mostly between 0.2 and 0.8
    keep = step(t, n);
    edge = (1.0 - smoothstep(0.0, 0.035, abs(n - t))) * step(0.001, p) * (1.0 - step(0.999, p));
    color = oldSky(uv);
  } else if (uStyle < 1.5) {
    // Rip: a jagged tear opens from where the camera looks; the two halves slide away from it and fall.
    vec3 f = normalize(vec3(uLook.x, 0.0, uLook.z) + vec3(1e-4, 0.0, 0.0));
    float side = dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-4, 0.0, 0.0)), vec3(-f.z, 0.0, f.x)); // -1..1 across the view
    float along = dot(normalize(vec3(d.x, 0.0, d.z) + vec3(1e-4, 0.0, 0.0)), f);
    float jag = (fbm(vec2(d.y * 9.0, 3.1)) - 0.5) * 0.35 + (noise(vec2(d.y * 40.0, 7.0)) - 0.5) * 0.06;
    float open = p * 2.2; // reaches the back of the sky at the end
    float dist = abs(side + jag) + (along < 0.0 ? 2.0 - abs(side) : 0.0);
    keep = step(open, dist);
    edge = (1.0 - smoothstep(0.0, 0.03, abs(dist - open))) * step(0.001, p);
    vec2 slide = vec2(sign(side) * open * 0.05, -p * p * 0.2);
    color = oldSky(fract(uv - slide));
  } else {
    // Glitch: the old sky breaks into blocks; each drops out at its own moment, with a colour split and scan lines.
    vec2 cells = vec2(48.0, 24.0);
    vec2 cell = floor(uv * cells);
    float when = hash(cell + floor(uTime * 12.0) * 0.0) * 0.85;
    keep = step(p, when);
    float jitter = (hash(cell + floor(uTime * 20.0)) - 0.5) * 0.02 * p;
    float split = 0.004 + 0.02 * p;
    vec2 g = uv + vec2(jitter, 0.0);
    color = vec3(oldSky(g + vec2(split, 0.0)).r, oldSky(g).g, oldSky(g - vec2(split, 0.0)).b);
    color *= 0.85 + 0.15 * step(0.5, fract(uv.y * 360.0 + uTime * 30.0));
    edge = step(p, when) * step(when - 0.06, p) * 0.8;
  }

  if (keep < 0.5) discard;
  vec3 glow = uStyle < 0.5 ? vec3(1.0, 0.55, 0.15) : uStyle < 1.5 ? vec3(1.0, 0.95, 0.85) : vec3(0.3, 1.0, 0.9);
  gl_FragColor = vec4(color + glow * edge * 2.2, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

interface Run { old: THREE.Texture | null; start: number; style: Exclude<SkyTransitionStyle, 'off'> }

export function SkyTransition() {
  const scene = useThree(s => s.scene)
  const camera = useThree(s => s.camera)
  const style = useSkyTransitionStyle()
  const last = useRef<THREE.Texture | THREE.Color | null | undefined>(undefined)
  const [run, setRun] = useState<Run | null>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uOld: { value: null },
      uHasOld: { value: 0 },
      uFlat: { value: new THREE.Color('#05070c') },
      uProgress: { value: 0 },
      uStyle: { value: 0 },
      uTime: { value: 0 },
      uLook: { value: new THREE.Vector3(0, 0, -1) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  }), [])
  useEffect(() => () => material.dispose(), [material])

  // Notice the background changing (one comparison a frame).
  useFrame(() => {
    const bg = scene.background as THREE.Texture | THREE.Color | null
    if (last.current === undefined) { last.current = bg; return }
    if (bg === last.current) return
    const previous = last.current
    last.current = bg
    if (style === 'off') return
    const oldTexture = previous && (previous as THREE.Texture).isTexture ? (previous as THREE.Texture) : null
    // An equirect image is what the dome can show; a cube map or a flat colour fades from dark instead.
    const usable = oldTexture && oldTexture.mapping === THREE.EquirectangularReflectionMapping ? oldTexture : null
    setRun({ old: usable, start: performance.now(), style })
  })

  useFrameWhen(run !== null, () => {
    const m = mesh.current
    if (!run || !m) return
    const elapsed = (performance.now() - run.start) / 1000
    const p = elapsed / DURATION
    if (p >= 1) { setRun(null); return }
    // Ease: slow start, quick middle, soft end.
    const eased = p * p * (3 - 2 * p) // smoothstep: gentle at both ends, even in the middle
    const u = material.uniforms
    u.uOld.value = run.old
    u.uHasOld.value = run.old ? 1 : 0
    u.uProgress.value = eased
    u.uStyle.value = STYLE_INDEX[run.style]
    u.uTime.value = elapsed
    camera.getWorldDirection(u.uLook.value)
    m.position.copy(camera.position)
  })

  if (!run) return null
  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[400, 64, 32]} />
    </mesh>
  )
}

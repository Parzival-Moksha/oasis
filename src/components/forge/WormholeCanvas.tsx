'use client'

// ░▒▓ WORMHOLE CANVAS ▓▒░
// Standalone WebGL fullscreen overlay for portal-transition tunnel effects.
// Lives outside the main R3F Canvas so it can't break world rendering.
// Four variants, all GPU-cheap, all share one Three.js context per mount:
//
//   bobbyroe-wormhole — noise-displaced cylinder rendered as Points
//                       (https://github.com/bobbyroe/wormhole-effect)
//   infinite-tubes    — TubeGeometry along a CatmullRom curve, scrolling texture
//                       (Codrops 2017, https://tympanus.net/codrops/2017/05/09/infinite-tubes-with-three-js/)
//   wormhole-extreme  — Stripped from rainner/wormhole-extreme: a conical
//                       backfaced cylinder with an additive scrolling texture
//   tsl-vortex        — Fullscreen GLSL fragment shader (procedural vortex,
//                       Codrops Mar 2025 vibe)
//
// Each variant exposes the same per-frame update interface and is hot-swappable
// without restarting the canvas — but variants currently re-mount on prop change.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export type WormholeVariant =
  | 'bobbyroe-wormhole'
  | 'infinite-tubes'
  | 'wormhole-extreme'
  | 'tsl-vortex'

export interface WormholeCanvasProps {
  variant: WormholeVariant
  intensity?: number
  speed?: number
  /** 0..1 — base hue for color-tinted variants */
  hue?: number
  /** 0..1.5 — bobbyroe wall noise amplitude */
  noiseAmp?: number
  /** 1..6 — tunnel radius (bobbyroe + tube + extreme) */
  radius?: number
  /** 0..3 — camera bob amplitude (parallax sway) */
  bob?: number
}

interface Variant {
  update: (elapsedSeconds: number, deltaSeconds: number) => void
  dispose: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant 1 — bobbyroe-wormhole
// Cylinder geometry, noise-displaced verts, rendered as THREE.Points. Two
// leapfrogging tubes give infinite forward illusion. Camera bobs in a circle.
// ─────────────────────────────────────────────────────────────────────────────

// Tiny hand-rolled value-noise (avoids importing ImprovedNoise).
function noise3(x: number, y: number, z: number): number {
  const sx = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  const sy = Math.sin(x * 39.346 + y * 11.135 + z * 83.155) * 28934.5821
  return ((sx - Math.floor(sx)) + (sy - Math.floor(sy))) * 0.5 - 0.5
}

function smoothNoise3(x: number, y: number, z: number): number {
  // Trilinear interpolation across an integer-cell grid.
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const n000 = noise3(xi, yi, zi)
  const n100 = noise3(xi + 1, yi, zi)
  const n010 = noise3(xi, yi + 1, zi)
  const n110 = noise3(xi + 1, yi + 1, zi)
  const n001 = noise3(xi, yi, zi + 1)
  const n101 = noise3(xi + 1, yi, zi + 1)
  const n011 = noise3(xi, yi + 1, zi + 1)
  const n111 = noise3(xi + 1, yi + 1, zi + 1)
  const a = n000 * (1 - u) + n100 * u
  const b = n010 * (1 - u) + n110 * u
  const c = n001 * (1 - u) + n101 * u
  const d = n011 * (1 - u) + n111 * u
  const ab = a * (1 - v) + b * v
  const cd = c * (1 - v) + d * v
  return ab * (1 - w) + cd * w
}

function setupBobbyroe(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { speed: number; hue: number; noiseAmp: number; radius: number; bob: number }): Variant {
  const radius = opts.radius
  const tubeLength = 200
  // 64 × 1024 = ~65k verts per tube — about 1/8 of bobbyroe's original. Plenty
  // of points for the look, way cheaper to displace and upload.
  const tubeGeo = new THREE.CylinderGeometry(radius, radius, tubeLength, 64, 1024, true)
  const tubeVerts = tubeGeo.attributes.position
  const colors: number[] = []
  const noisefreq = 0.1
  const noiseAmp = opts.noiseAmp
  const hueNoiseFreq = 0.005
  const baseHue = opts.hue
  const p = new THREE.Vector3()
  const v3 = new THREE.Vector3()
  const color = new THREE.Color()
  for (let i = 0; i < tubeVerts.count; i++) {
    p.fromBufferAttribute(tubeVerts, i)
    v3.copy(p)
    const vNoise = smoothNoise3(v3.x * noisefreq, v3.y * noisefreq, v3.z * noisefreq * 0.05)
    v3.addScaledVector(p, vNoise * noiseAmp)
    tubeVerts.setXYZ(i, v3.x, p.y, v3.z)
    const cNoise = smoothNoise3(v3.x * hueNoiseFreq, v3.y * hueNoiseFreq, i * 0.001 * hueNoiseFreq)
    color.setHSL((baseHue - cNoise + 1) % 1, 1, 0.5)
    colors.push(color.r, color.g, color.b)
  }
  const mat = new THREE.PointsMaterial({ size: 0.04, vertexColors: true, transparent: true, opacity: 0.95 })

  function makeTube(index: number) {
    const startPosZ = -tubeLength * index
    const endPosZ = tubeLength
    const resetPosZ = -tubeLength
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', tubeVerts)
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const points = new THREE.Points(geo, mat)
    points.rotation.x = Math.PI * 0.5
    points.position.z = startPosZ
    return { points, endPosZ, resetPosZ }
  }
  const tubeA = makeTube(0)
  const tubeB = makeTube(1)
  scene.add(tubeA.points, tubeB.points)
  scene.fog = new THREE.FogExp2(0x000000, 0.025)

  return {
    update(elapsed, delta) {
      const stride = 60 * delta * 0.2 * opts.speed
      for (const t of [tubeA, tubeB]) {
        t.points.rotation.y += 0.005 * 60 * delta
        t.points.position.z += stride
        if (t.points.position.z > t.endPosZ) t.points.position.z = t.resetPosZ
      }
      camera.position.x = Math.cos(elapsed) * opts.bob
      camera.position.y = Math.sin(elapsed) * opts.bob
      camera.lookAt(0, 0, -10)
    },
    dispose() {
      scene.remove(tubeA.points)
      scene.remove(tubeB.points)
      scene.fog = null
      tubeA.points.geometry.dispose()
      tubeB.points.geometry.dispose()
      mat.dispose()
      tubeGeo.dispose()
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant 2 — infinite-tubes (Codrops 2017)
// CatmullRomCurve3 → TubeGeometry, BackSide, scrolling texture for motion.
// Procedural seamless texture so we don't need a remote asset.
// ─────────────────────────────────────────────────────────────────────────────

function makeInfiniteTubeTexture(): THREE.CanvasTexture {
  // Holographic-grid seamless tile. 256×256 fits nicely on a tube.
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  // Dark space backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#04081a')
  grad.addColorStop(0.5, '#1a0840')
  grad.addColorStop(1, '#04081a')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 256, 256)
  // Cyan / magenta neon grid
  for (let i = 0; i < 8; i++) {
    const t = i / 8
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(34,211,238,0.85)' : 'rgba(236,72,153,0.55)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(0, t * 256); ctx.lineTo(256, t * 256); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(t * 256, 0); ctx.lineTo(t * 256, 256); ctx.stroke()
  }
  // Sprinkle stars
  ctx.fillStyle = 'white'
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    const r = Math.random() < 0.85 ? 0.7 : 1.6
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(30, 6)
  return tex
}

function setupInfiniteTubes(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { speed: number; hue: number }): Variant {
  // Curve: a wavy CatmullRom path stretching forward in -Z (camera default
  // forward direction). Larger XY amplitude so the tube actually winds.
  const points: THREE.Vector3[] = []
  const SEG = 24
  for (let i = 0; i < SEG; i++) {
    points.push(new THREE.Vector3(
      Math.sin(i * 0.55) * 4,
      Math.cos(i * 0.4) * 3,
      -i * 8, // -Z forward
    ))
  }
  const curve = new THREE.CatmullRomCurve3(points)
  // Radius 2.5 — large enough that the camera sits comfortably inside.
  const tubeGeo = new THREE.TubeGeometry(curve, 200, 2.5, 32, false)
  const tex = makeInfiniteTubeTexture()
  // Repeat the texture down the tube length so the grid pattern reads small.
  tex.repeat.set(60, 4)
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide, // we render the tube's inside walls
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const tube = new THREE.Mesh(tubeGeo, mat)
  scene.add(tube)
  // Camera at the curve's first point + look at the third point (down the tube).
  const lookAt = new THREE.Vector3()
  camera.position.set(points[0].x, points[0].y, points[0].z)

  return {
    update(elapsed, delta) {
      // Scrolling UVs → forward-motion illusion (the Codrops trick).
      tex.offset.x += delta * 0.35 * opts.speed
      // March the camera through the curve at parameter t∈[0..1] looping.
      const t = (elapsed * 0.012 * opts.speed) % 1
      const here = curve.getPointAt(t)
      const ahead = curve.getPointAt((t + 0.02) % 1)
      camera.position.copy(here)
      lookAt.copy(ahead)
      camera.lookAt(lookAt)
    },
    dispose() {
      scene.remove(tube)
      tubeGeo.dispose()
      mat.dispose()
      tex.dispose()
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant 3 — wormhole-extreme (rainner's hyperspace cone)
// Conical CylinderGeometry, BackSide, additive blend, scrolling water-like
// procedural texture. Camera-locked group rotation + scale-down for thrust.
// ─────────────────────────────────────────────────────────────────────────────

function makeWaterTexture(): THREE.CanvasTexture {
  // Procedural "water-flow" stripes — diagonal noise streaks.
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 512, 512)
  // Layered streaks
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const len = 30 + Math.random() * 120
    const angle = Math.random() * 0.3 + 1.4
    const hue = 200 + Math.random() * 60
    const alpha = 0.25 + Math.random() * 0.5
    ctx.strokeStyle = `hsla(${hue}, 80%, 70%, ${alpha})`
    ctx.lineWidth = 0.6 + Math.random() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  // Bright sparks
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.random() * 0.4})`
    const r = 1 + Math.random() * 1.5
    ctx.beginPath()
    ctx.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function setupWormholeExtreme(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { speed: number; hue: number }): Variant {
  // Conical tube. Wide opening at +Z (behind us / above), vanishing point at
  // -Z (in front, where the camera looks). After rotateX(pi/2): top (radius
  // small) lands at -Z, bottom (radius wide) lands at +Z.
  const geo = new THREE.CylinderGeometry(0.5, 30, 200, 40, 40, true)
  geo.rotateX(Math.PI / 2)
  const tex = makeWaterTexture()
  tex.repeat.set(2, 4)
  const tint = new THREE.Color().setHSL(opts.hue, 0.85, 0.7)
  // MeshBasicMaterial avoids needing scene lights — additive blending +
  // bright tint reads like glowing energy walls without lighting cost.
  const mat = new THREE.MeshBasicMaterial({
    color: tint,
    map: tex,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  })
  const cyl = new THREE.Mesh(geo, mat)
  scene.add(cyl)
  // Camera sits inside the wide end of the cone, looking toward the
  // vanishing point at -Z.
  camera.position.set(0, 0, 20)

  return {
    update(elapsed, delta) {
      // Scroll the texture along the tube length for warp-speed motion.
      tex.offset.y -= delta * 0.55 * opts.speed
      // Slow rotation around the tube axis for parallax.
      cyl.rotation.z -= 0.01 * 60 * delta * opts.speed
      // Slight camera sway.
      camera.position.x = Math.sin(elapsed * 0.5) * 0.6
      camera.position.y = Math.cos(elapsed * 0.4) * 0.5
      camera.lookAt(0, 0, -50)
    },
    dispose() {
      scene.remove(cyl)
      geo.dispose()
      mat.dispose()
      tex.dispose()
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant 4 — tsl-vortex (procedural vortex shader on a fullscreen quad)
// Flat plane facing the camera with a fragment shader that builds the vortex
// from polar coordinates + animated noise. No geometry tunnel — pure shader.
// ─────────────────────────────────────────────────────────────────────────────

const VORTEX_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const VORTEX_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uHue;
uniform float uSpeed;
uniform float uIntensity;

// Hash + value-noise pair, chunked for the vortex rim work below.
float h2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h2(i);
  float b = h2(i + vec2(1.0, 0.0));
  float c = h2(i + vec2(0.0, 1.0));
  float d = h2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * n2(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

vec3 hsl2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 1.0/3.0, 2.0/3.0)) * 6.0 - 3.0);
  return c.z + c.y * (clamp(p - 1.0, 0.0, 1.0) - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  // Map uv → centered [-1, 1].
  vec2 p = (vUv - 0.5) * 2.0;
  // Aspect-correct.
  float aspect = 1.0;
  p.x *= aspect;

  // Polar coords — angle θ, radius r. Vortex twists θ with r-dependent rotation.
  float r = length(p);
  float theta = atan(p.y, p.x);
  // Boosted base speed: x4 vs the original. uSpeed slider still scales it.
  float t = uTime * uSpeed * 4.0;

  // Vortex swirl. Sign reversed on the time term so bands sweep INWARD toward
  // the center (zooming IN to the singularity), instead of sweeping outward.
  float swirl = theta + 4.0 / max(r, 0.05) + t * 1.2;
  // tunnelUv.y also reversed for inward-flow.
  vec2 tunnelUv = vec2(swirl * 0.5 / 3.14159, 1.5 / max(r, 0.001) + t * 0.9);

  // Noise + bands.
  float n = fbm(tunnelUv * 1.4);
  float bands = sin(tunnelUv.y * 2.0 + n * 5.0) * 0.5 + 0.5;
  float depth = smoothstep(0.0, 1.4, r);

  // Hue gradient — outer warm, inner cool.
  float hue = fract(uHue + n * 0.15 + r * -0.2);
  vec3 col = hsl2rgb(vec3(hue, 0.85, 0.5)) * bands * (1.0 - depth * 0.6);
  // Bright vanishing-point core.
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.18, 0.0, r) * 1.4;
  // Vignette edge fade.
  col *= smoothstep(1.4, 0.6, r);
  col *= uIntensity;

  gl_FragColor = vec4(col, 1.0);
}
`

function setupTslVortex(scene: THREE.Scene, _camera: THREE.PerspectiveCamera, opts: { speed: number; hue: number; intensity: number }): Variant {
  // Single fullscreen triangle (3 verts) — cheaper than a quad, samples every
  // pixel exactly once.
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHue: { value: opts.hue },
      uSpeed: { value: opts.speed },
      uIntensity: { value: opts.intensity },
    },
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)

  return {
    update(elapsed) {
      mat.uniforms.uTime.value = elapsed
    },
    dispose() {
      scene.remove(mesh)
      geo.dispose()
      mat.dispose()
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function WormholeCanvas({
  variant,
  intensity = 1,
  speed = 1,
  hue = 0.55,
  noiseAmp = 0.5,
  radius = 3,
  bob = 1.5,
}: WormholeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000)
    camera.position.set(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 1)
    container.appendChild(renderer.domElement)

    let v: Variant
    if (variant === 'bobbyroe-wormhole') v = setupBobbyroe(scene, camera, { speed, hue, noiseAmp, radius, bob })
    else if (variant === 'infinite-tubes') v = setupInfiniteTubes(scene, camera, { speed, hue })
    else if (variant === 'wormhole-extreme') v = setupWormholeExtreme(scene, camera, { speed, hue })
    else v = setupTslVortex(scene, camera, { speed, hue, intensity })

    let raf = 0
    let lastMs = performance.now()
    const startMs = lastMs
    const animate = () => {
      const nowMs = performance.now()
      const delta = Math.min(0.05, (nowMs - lastMs) / 1000)
      const elapsed = (nowMs - startMs) / 1000
      lastMs = nowMs
      v.update(elapsed, delta)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      const nw = container.clientWidth || window.innerWidth
      const nh = container.clientHeight || window.innerHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
      v.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
  }, [variant, speed, hue, intensity, noiseAmp, radius, bob])

  return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />
}

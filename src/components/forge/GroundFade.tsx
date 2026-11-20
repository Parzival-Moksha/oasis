'use client'

// The ground melts into the next one, like the sky (the owner, 2026-11-20: "it would be super cool if it could
// be the same as for changing the sky where it kind of melts from one to the other"). BaseGround mounts this for
// 1.6 s with the OLD ground texture on a plane over the new one; a noise mask in world space eats it away, with
// a hot rim on each patch (Glitch: square blocks). The style follows Settings > World VFX > Sky change; Off skips.
// Lit like the ground (a MeshStandardMaterial with a discard added), so the old ground does not jump in brightness.

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SkyTransitionStyle } from './SkyTransition'

const DURATION = 1.6

export function GroundFade({ texture, color, size, y, style, onDone }: {
  texture: THREE.Texture | null
  color: string
  size: number
  y: number
  style: Exclude<SkyTransitionStyle, 'off'>
  onDone: () => void
}) {
  const start = useRef(performance.now())
  const uniforms = useMemo(() => ({ uProgress: { value: 0 }, uStyle: { value: style === 'glitch' ? 1 : 0 } }), [style])
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: texture, color: texture ? '#ffffff' : color, roughness: 1, metalness: 0, envMapIntensity: 0.15, side: THREE.DoubleSide })
    m.onBeforeCompile = shader => {
      shader.uniforms.uProgress = uniforms.uProgress
      shader.uniforms.uStyle = uniforms.uStyle
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vGroundXZ;
uniform float uProgress;
uniform float uStyle;
float gfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gfNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gfHash(i), gfHash(i + vec2(1.0, 0.0)), u.x), mix(gfHash(i + vec2(0.0, 1.0)), gfHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float gfFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * gfNoise(p); p *= 2.03; a *= 0.5; } return v; }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  float n = uStyle < 0.5 ? gfFbm(vGroundXZ * 0.12) : gfHash(floor(vGroundXZ / 2.0)) * 0.6 + 0.2;
  float t = mix(0.2, 0.86, clamp(uProgress, 0.0, 1.0));
  if (n < t) discard;
  float rim = 1.0 - smoothstep(0.0, 0.03, n - t);
  gl_FragColor.rgb += (uStyle < 0.5 ? vec3(1.0, 0.55, 0.15) : vec3(0.3, 1.0, 0.9)) * rim * 1.6;
}`)
    }
    return m
  }, [texture, color, uniforms])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const p = (performance.now() - start.current) / 1000 / DURATION
    if (p >= 1) { onDone(); return }
    uniforms.uProgress.value = p * p * (3 - 2 * p)
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} material={material} raycast={() => null} receiveShadow>
      <planeGeometry args={[size, size]} />
    </mesh>
  )
}

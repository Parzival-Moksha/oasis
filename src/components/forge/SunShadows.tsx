'use client'

// ░▒▓ SUN SHADOWS — soft shadows from the world's sun (Settings → Graphics → Shadows) ▓▒░
// Off / Avatars only / All, with quality (map resolution), softness, strength and refresh rate.
// The world's first directional light casts; one shadow map covers a 64 m square ahead of the
// camera. See src/lib/forge/sun-shadow.ts for the rules. Nothing here changes how the world is
// lit: the light keeps its direction and strength, it only moves along with the view so that its
// shadow map covers what is on screen.

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { useGraphicsPrefs } from '../../lib/use-graphics-prefs'
import { useFrameWhen } from '../../lib/use-frame-when'
import type { ShadowMode } from '../../lib/graphics-prefs'
import {
  shadowAmbientDim, shadowRadiusTexels, shadowRefreshDue, shadowTexelMetres, snapShadowCenter, sunDirection, sunShadowAmbientChunks,
  wantedShadowCenter, SUN_SHADOW_DIM_UNIFORM, SUN_SHADOW_DISTANCE, SUN_SHADOW_HALF_SIZE, SUN_SHADOW_MAP_SIZES, SUN_SHADOW_MOVING_HOLD_MS,
} from '../../lib/forge/sun-shadow'

// ── A sun shadow also dims the ambient and sky light (see sunShadowAmbientChunks) ───────────────
// The GLSL is added to three's shader chunks once, before any material compiles. How much it
// dims is one shared uniform, handed to every material as it compiles, so the Strength slider
// works without recompiling anything.

/** The shared uniform: 0 (no extra dim) .. 0.9. */
export const sunShadowDimUniform = { value: 0 }

const CHUNK_MARK = '/* oasis-sun-shadow */'
function patchChunk(name: 'shadowmap_pars_fragment' | 'lights_fragment_end', glsl: string): void {
  // Drop what an earlier version of this module appended (hot reload), then append.
  const current = THREE.ShaderChunk[name]
  const legacy = current.indexOf('/* oasis-sun-shadow')
  THREE.ShaderChunk[name] = `${legacy >= 0 ? current.slice(0, legacy).trimEnd() : current}\n${CHUNK_MARK}${glsl}`
}
const chunks = sunShadowAmbientChunks()
patchChunk('shadowmap_pars_fragment', chunks.declare)
patchChunk('lights_fragment_end', chunks.apply)

// Every material that keeps three's default `onBeforeCompile` gets the uniform. A material with
// its own hook (the ground's detail layer) adds it itself, or is left at 0: no extra dim.
type CompiledShader = { uniforms: Record<string, { value: unknown }> }
const materialProto = THREE.Material.prototype as unknown as { onBeforeCompile: (shader: CompiledShader) => void; __oasisSunShadow?: boolean }
if (!materialProto.__oasisSunShadow) {
  materialProto.__oasisSunShadow = true
  materialProto.onBeforeCompile = function (shader: CompiledShader) {
    shader.uniforms[SUN_SHADOW_DIM_UNIFORM] = sunShadowDimUniform
  }
}

/** Set on the directional lights the world owns (WorldLightsSection), with their stored position. */
export const WORLD_SUN_FLAG = 'oasisWorldSun'
/** Set on an avatar's scene root (VRM bodies, the player): its meshes cast in "Avatars only". */
export const AVATAR_FLAG = 'oasisAvatar'

const CAST_HOME = 'oasisCastHome'
const RECEIVE_HOME = 'oasisReceiveHome'
/** Casters and the sun are looked up again this often (new objects join within a second). */
const RESCAN_MS = 1000

type ShadowMesh = THREE.Mesh & { userData: Record<string, unknown> }

function isSolid(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.every(material => material && material.visible !== false && !material.transparent && material.depthWrite !== false)
}

/**
 * Sets every mesh's castShadow / receiveShadow for the mode ('off' puts back what each mesh had),
 * and collects into `movers` the roots whose movement should redraw the map: avatars always,
 * placed world objects when they cast.
 */
function assignCasters(scene: THREE.Scene, mode: ShadowMode, movers: THREE.Object3D[]): void {
  movers.length = 0
  const visit = (object: THREE.Object3D, avatar: boolean, worldObject: boolean) => {
    if (object.userData[AVATAR_FLAG] && !avatar) {
      avatar = true
      movers.push(object)
    }
    if (typeof object.userData.oasisObjectId === 'string' && !worldObject) {
      worldObject = true
      if (mode === 'all' && !avatar) movers.push(object)
    }
    const mesh = object as ShadowMesh
    if (mesh.isMesh) {
      if (mesh.userData[CAST_HOME] === undefined) {
        mesh.userData[CAST_HOME] = mesh.castShadow
        mesh.userData[RECEIVE_HOME] = mesh.receiveShadow
      }
      const castHome = mesh.userData[CAST_HOME] as boolean
      const receiveHome = mesh.userData[RECEIVE_HOME] as boolean
      let cast = castHome
      let receive = receiveHome
      if (mode === 'off') {
        // as each mesh was
      } else if (avatar) {
        cast = castHome
      } else if (mode === 'avatars') {
        cast = false
      } else if (worldObject) {
        const solid = isSolid(mesh)
        cast = solid
        receive = receiveHome || solid
      }
      if (mesh.castShadow !== cast) mesh.castShadow = cast
      if (mesh.receiveShadow !== receive) mesh.receiveShadow = receive
    }
    for (const child of object.children) visit(child, avatar, worldObject)
  }
  visit(scene, false, false)
}

function findSun(scene: THREE.Scene): THREE.DirectionalLight | null {
  let sun: THREE.DirectionalLight | null = null
  scene.traverse(object => {
    if (!sun && (object as THREE.DirectionalLight).isDirectionalLight && object.userData[WORLD_SUN_FLAG] && object.visible) sun = object as THREE.DirectionalLight
  })
  return sun
}

/** Hands a light back as the world stored it. */
function releaseSun(sun: THREE.DirectionalLight | null): void {
  if (!sun) return
  const home = sun.userData[WORLD_SUN_FLAG] as [number, number, number] | undefined
  sun.castShadow = false
  if (home) sun.position.set(home[0], home[1], home[2])
  sun.target.position.set(0, 0, 0)
  sun.target.updateMatrixWorld()
  sun.target.removeFromParent()
}

/** Whether any of `movers` changed place since the last call (their world positions, to a millimetre). */
function anyMoved(movers: readonly THREE.Object3D[], last: { places: Float32Array; count: number }): boolean {
  if (last.places.length < movers.length * 3) last.places = new Float32Array(movers.length * 3 + 96)
  let moved = last.count !== movers.length
  last.count = movers.length
  const places = last.places
  for (let i = 0; i < movers.length; i++) {
    const e = movers[i].matrixWorld.elements
    const o = i * 3
    if (Math.abs(places[o] - e[12]) > 0.001 || Math.abs(places[o + 1] - e[13]) > 0.001 || Math.abs(places[o + 2] - e[14]) > 0.001) moved = true
    places[o] = e[12]; places[o + 1] = e[13]; places[o + 2] = e[14]
  }
  return moved
}

export function SunShadows() {
  const { shadows: mode, shadowQuality, shadowSoftness, shadowStrength, shadowRefresh } = useGraphicsPrefs()
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const mapSize = SUN_SHADOW_MAP_SIZES[shadowQuality]
  const state = useRef({
    sun: null as THREE.DirectionalLight | null,
    scannedAt: -Infinity,
    drawnAt: -Infinity,
    movedAt: -Infinity,
    center: new THREE.Vector3(Number.NaN, 0, 0),
    wanted: new THREE.Vector3(),
    snapped: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    movers: [] as THREE.Object3D[],
    places: { places: new Float32Array(96), count: 0 },
    /** Redraws in the last second (dev readout). */
    draws: 0, drawsWindowAt: 0, drawsPerSecond: 0,
  })

  // Strength: one uniform, no recompile.
  useEffect(() => {
    sunShadowDimUniform.value = mode === 'off' ? 0 : shadowAmbientDim(shadowStrength)
  }, [mode, shadowStrength])

  // Shadows on or off is part of every lit material's shader: switching recompiles them once.
  useEffect(() => {
    const on = mode !== 'off'
    const changed = gl.shadowMap.enabled !== on || gl.shadowMap.type !== THREE.PCFShadowMap
    gl.shadowMap.enabled = on
    gl.shadowMap.type = THREE.PCFShadowMap // the filter whose width `shadow.radius` sets (softness)
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    state.current.scannedAt = -Infinity
    state.current.center.x = Number.NaN
    if (!on) {
      releaseSun(state.current.sun)
      state.current.sun = null
      assignCasters(scene, 'off', state.current.movers)
    }
    if (changed) {
      scene.traverse(object => {
        const material = (object as THREE.Mesh).material
        if (!material) return
        for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true
      })
    }
  }, [mode, gl, scene])

  // Quality and softness: the map's size and the filter radius, applied to the light in the frame callback.
  useEffect(() => {
    const sun = state.current.sun
    if (sun && sun.castShadow) releaseSun(sun) // set up again next frame at the new size
    state.current.center.x = Number.NaN
    if (sun?.shadow.map) {
      sun.shadow.map.dispose()
      ;(sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null
    }
  }, [mapSize])

  useEffect(() => () => {
    releaseSun(state.current.sun)
    state.current.sun = null
    assignCasters(scene, 'off', state.current.movers)
    gl.shadowMap.enabled = false
    sunShadowDimUniform.value = 0
  }, [gl, scene])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const host = window as unknown as { __oasisSunShadows?: unknown }
    host.__oasisSunShadows = { drawsPerSecond: () => state.current.drawsPerSecond, movers: () => state.current.movers.length }
    return () => { delete host.__oasisSunShadows }
  }, [])

  useFrameWhen(mode !== 'off', ({ camera }) => {
    if (mode === 'off') return
    const s = state.current
    const now = performance.now()

    // R3F sets shadowMap.enabled from the Canvas's `shadows` prop each time the Canvas re-renders
    // (to false here): put it back before this frame draws.
    if (!gl.shadowMap.enabled || gl.shadowMap.autoUpdate) {
      gl.shadowMap.enabled = true
      gl.shadowMap.type = THREE.PCFShadowMap
      gl.shadowMap.autoUpdate = false
      gl.shadowMap.needsUpdate = true
    }

    if (now - s.scannedAt >= RESCAN_MS) {
      s.scannedAt = now
      const sun = findSun(scene)
      if (sun !== s.sun) {
        releaseSun(s.sun)
        s.sun = sun
        s.center.x = Number.NaN
      }
      assignCasters(scene, mode, s.movers)
    }

    const sun = s.sun
    if (!sun) return
    const toSun = sunDirection(sun.userData[WORLD_SUN_FLAG] as [number, number, number])
    if (!toSun) {
      // A sun at the horizon: shadows would run across the whole world. None.
      if (sun.castShadow) releaseSun(sun)
      return
    }

    if (!sun.castShadow) {
      sun.castShadow = true
      sun.shadow.mapSize.set(mapSize, mapSize)
      const box = sun.shadow.camera
      box.left = -SUN_SHADOW_HALF_SIZE
      box.right = SUN_SHADOW_HALF_SIZE
      box.top = SUN_SHADOW_HALF_SIZE
      box.bottom = -SUN_SHADOW_HALF_SIZE
      box.near = 1
      box.far = SUN_SHADOW_DISTANCE * 2
      box.updateProjectionMatrix()
      if (!sun.target.parent) scene.add(sun.target)
      s.center.x = Number.NaN
    }
    const radius = shadowRadiusTexels(shadowSoftness, mapSize)
    if (sun.shadow.radius !== radius) {
      sun.shadow.radius = radius
      // A wider filter reads depth further from the pixel: lift the bias with it, or flat ground shades itself.
      sun.shadow.bias = -0.00025 - 0.00008 * radius
      sun.shadow.normalBias = Math.max(0.03, shadowTexelMetres(mapSize) * (1.5 + radius * 0.5))
    }

    camera.getWorldDirection(s.forward)
    wantedShadowCenter(camera.position, s.forward, s.wanted)
    snapShadowCenter(s.wanted, toSun, shadowTexelMetres(mapSize), s.snapped)
    const recentred = !(s.snapped.distanceToSquared(s.center) < 1e-8)
    if (recentred) {
      s.center.copy(s.snapped)
      sun.target.position.copy(s.center)
      sun.position.copy(s.center).addScaledVector(toSun, SUN_SHADOW_DISTANCE)
      sun.target.updateMatrixWorld()
      sun.updateMatrixWorld()
    }

    if (anyMoved(s.movers, s.places)) s.movedAt = now
    const moving = now - s.movedAt < SUN_SHADOW_MOVING_HOLD_MS
    if (shadowRefreshDue({ refresh: shadowRefresh, msSinceDraw: now - s.drawnAt, recentred, moving })) {
      gl.shadowMap.needsUpdate = true
      s.drawnAt = now
      s.draws += 1
    }
    if (now - s.drawsWindowAt >= 1000) {
      s.drawsPerSecond = Math.round((s.draws * 1000) / (now - s.drawsWindowAt))
      s.draws = 0
      s.drawsWindowAt = now
    }
  })

  return null
}

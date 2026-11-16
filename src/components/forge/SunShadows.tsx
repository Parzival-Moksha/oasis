'use client'

// ░▒▓ SUN SHADOWS — soft shadows from the world's sun (Config → Graphics → Shadows) ▓▒░
// Off / Avatars only / All. The world's first directional light casts; one 2048 px shadow map
// covers a 64 m square ahead of the camera. See src/lib/forge/sun-shadow.ts for what keeps it
// cheap. Nothing here changes how the world is lit: the light keeps its direction and strength,
// it only moves along with the view so that its shadow map covers what is on screen.

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { useGraphicsPrefs } from '../../lib/use-graphics-prefs'
import { useFrameWhen } from '../../lib/use-frame-when'
import type { ShadowMode } from '../../lib/graphics-prefs'
import {
  shadowRefreshDue, snapShadowCenter, sunDirection, sunShadowAmbientChunk, wantedShadowCenter,
  SUN_SHADOW_DISTANCE, SUN_SHADOW_HALF_SIZE, SUN_SHADOW_MAP_SIZE,
} from '../../lib/forge/sun-shadow'

// A sun shadow also dims the ambient and sky light there (see sunShadowAmbientChunk). Added to
// three's shader chunk once, before any material compiles; inert in shaders without a sun shadow.
const AMBIENT_MARK = '/* oasis-sun-shadow-ambient */'
if (!THREE.ShaderChunk.lights_fragment_end.includes(AMBIENT_MARK)) {
  THREE.ShaderChunk.lights_fragment_end += `
${AMBIENT_MARK}${sunShadowAmbientChunk()}`
}

/** Set on the directional lights the world owns (WorldLightsSection), with their stored position. */
export const WORLD_SUN_FLAG = 'oasisWorldSun'
/** Set on an avatar's scene root (VRM bodies, the player): its meshes cast in "Avatars only". */
export const AVATAR_FLAG = 'oasisAvatar'

const CAST_HOME = 'oasisCastHome'
const RECEIVE_HOME = 'oasisReceiveHome'
const TEXEL = (SUN_SHADOW_HALF_SIZE * 2) / SUN_SHADOW_MAP_SIZE
/** Casters and the sun are looked up again this often (new objects join within a second). */
const RESCAN_MS = 1000

type ShadowMesh = THREE.Mesh & { userData: Record<string, unknown> }

function isSolid(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.every(material => material && material.visible !== false && !material.transparent && material.depthWrite !== false)
}

/** Sets every mesh's castShadow / receiveShadow for the mode. 'off' puts back what each mesh had. */
function assignCasters(scene: THREE.Scene, mode: ShadowMode): void {
  const visit = (object: THREE.Object3D, avatar: boolean, worldObject: boolean) => {
    if (object.userData[AVATAR_FLAG]) avatar = true
    if (typeof object.userData.oasisObjectId === 'string') worldObject = true
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

export function SunShadows() {
  const { shadows: mode } = useGraphicsPrefs()
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const state = useRef({
    sun: null as THREE.DirectionalLight | null,
    scannedAt: -Infinity,
    drawnAt: -Infinity,
    center: new THREE.Vector3(Number.NaN, 0, 0),
    wanted: new THREE.Vector3(),
    snapped: new THREE.Vector3(),
    forward: new THREE.Vector3(),
  })

  // Shadows on or off is part of every lit material's shader: switching recompiles them once.
  useEffect(() => {
    const on = mode !== 'off'
    const changed = gl.shadowMap.enabled !== on
    gl.shadowMap.enabled = on
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    state.current.scannedAt = -Infinity
    state.current.center.x = Number.NaN
    if (!on) {
      releaseSun(state.current.sun)
      state.current.sun = null
      assignCasters(scene, 'off')
    }
    if (changed) {
      scene.traverse(object => {
        const material = (object as THREE.Mesh).material
        if (!material) return
        for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true
      })
    }
  }, [mode, gl, scene])

  useEffect(() => () => {
    releaseSun(state.current.sun)
    state.current.sun = null
    assignCasters(scene, 'off')
    gl.shadowMap.enabled = false
  }, [gl, scene])

  useFrameWhen(mode !== 'off', ({ camera }) => {
    if (mode === 'off') return
    const s = state.current
    const now = performance.now()

    // R3F sets shadowMap.enabled from the Canvas's `shadows` prop each time the Canvas re-renders
    // (to false here): put it back before this frame draws.
    if (!gl.shadowMap.enabled || gl.shadowMap.autoUpdate) {
      gl.shadowMap.enabled = true
      gl.shadowMap.type = THREE.PCFSoftShadowMap
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
      assignCasters(scene, mode)
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
      sun.shadow.mapSize.set(SUN_SHADOW_MAP_SIZE, SUN_SHADOW_MAP_SIZE)
      const box = sun.shadow.camera
      box.left = -SUN_SHADOW_HALF_SIZE
      box.right = SUN_SHADOW_HALF_SIZE
      box.top = SUN_SHADOW_HALF_SIZE
      box.bottom = -SUN_SHADOW_HALF_SIZE
      box.near = 1
      box.far = SUN_SHADOW_DISTANCE * 2
      box.updateProjectionMatrix()
      sun.shadow.bias = -0.0004
      sun.shadow.normalBias = 0.05
      if (!sun.target.parent) scene.add(sun.target)
      s.center.x = Number.NaN
    }

    camera.getWorldDirection(s.forward)
    wantedShadowCenter(camera.position, s.forward, s.wanted)
    snapShadowCenter(s.wanted, toSun, TEXEL, s.snapped)
    const recentred = !(s.snapped.distanceToSquared(s.center) < 1e-8)
    if (recentred) {
      s.center.copy(s.snapped)
      sun.target.position.copy(s.center)
      sun.position.copy(s.center).addScaledVector(toSun, SUN_SHADOW_DISTANCE)
      sun.target.updateMatrixWorld()
      sun.updateMatrixWorld()
    }

    if (shadowRefreshDue({ mode, msSinceDraw: now - s.drawnAt, recentred })) {
      gl.shadowMap.needsUpdate = true
      s.drawnAt = now
    }
  })

  return null
}

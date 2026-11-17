'use client'

// ░▒▓ VILLAGE EYES — a picture from an agent's own avatar, taken when the owner talks to it ▓▒░
// Mounted inside the R3F <Canvas> with the village. The agent engine asks for a picture over its socket
// (agent-engine-client.ts, `eyes.request`) when a message goes to an agent whose eyes are on; this renders
// the scene once from that agent's desk into a small off-screen target and answers with a JPEG.
// Cost: one extra 800x450 render and a pixel read-back per message sent, nothing per frame.
//
// The same camera work answers `view.request`: pictures an agent asked for itself (scripts/me.mjs look | around).
// "look" is its own avatar from the front, "around" four pictures from where it stands, one per side.

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getAgentEngineClient, type EyesPicture, type ViewPicture } from '../../lib/agent-engine-client'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { useInputManager } from '../../lib/input-manager'
import { AROUND_PICTURE, EYES_PICTURE, LOOK_PICTURE, computeAroundPoses, computeEyesPose, computeLookPose, type EyesPose } from '../../lib/village/village-eyes'
import type { Vec3 } from '../../lib/village/village-layout'
import { getVillageStation, isFocusInputState } from './village-actions'

/** The owner's head: the avatar's in third person or orbit, the camera itself in noclip. */
function ownerHead(): Vec3 | null {
  const input = useInputManager.getState()
  const base = isFocusInputState(input.inputState) || input.inputState === 'placement' || input.inputState === 'paint'
    ? input._previousCameraState
    : input.inputState
  const camera = getCameraSnapshot()?.position || null
  const avatar = base === 'noclip' ? null : getPlayerAvatarPose()?.position || null
  if (avatar) return [avatar[0], avatar[1] + 1.5, avatar[2]]
  return camera ? [camera[0], camera[1], camera[2]] : null
}

export function VillageEyes() {
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)

  useEffect(() => {
    const { width, height, fov, quality } = EYES_PICTURE
    const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false })
    target.texture.colorSpace = THREE.SRGBColorSpace
    const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 500)
    const pixels = new Uint8Array(width * height * 4)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    const image = context ? context.createImageData(width, height) : null

    const capture = (agentId: string): EyesPicture | null => {
      const station = getVillageStation(agentId)
      if (!station || !context || !image) return null
      const pose = computeEyesPose(station, ownerHead())
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      camera.updateMatrixWorld(true)

      const previousTarget = gl.getRenderTarget()
      const previousXr = gl.xr.enabled
      try {
        gl.xr.enabled = false
        gl.setRenderTarget(target)
        gl.render(scene, camera)
        gl.readRenderTargetPixels(target, 0, 0, width, height, pixels)
      } finally {
        gl.setRenderTarget(previousTarget)
        gl.xr.enabled = previousXr
      }
      // WebGL rows run bottom to top.
      const row = width * 4
      for (let y = 0; y < height; y += 1) {
        image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row)
      }
      context.putImageData(image, 0, 0)
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1] || ''
      return data ? { data, mediaType: 'image/jpeg' } : null
    }

    // Pictures on request: other sizes than the eyes picture, so each gets what it needs for the one call.
    const shoot = (pose: EyesPose, shot: { width: number; height: number; fov: number; quality: number }): string => {
      const shotTarget = new THREE.WebGLRenderTarget(shot.width, shot.height, { format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false })
      shotTarget.texture.colorSpace = THREE.SRGBColorSpace
      const shotCamera = new THREE.PerspectiveCamera(shot.fov, shot.width / shot.height, 0.1, 500)
      shotCamera.position.set(...pose.position)
      shotCamera.lookAt(...pose.target)
      shotCamera.updateMatrixWorld(true)
      const shotPixels = new Uint8Array(shot.width * shot.height * 4)
      const previousTarget = gl.getRenderTarget()
      const previousXr = gl.xr.enabled
      try {
        gl.xr.enabled = false
        gl.setRenderTarget(shotTarget)
        gl.render(scene, shotCamera)
        gl.readRenderTargetPixels(shotTarget, 0, 0, shot.width, shot.height, shotPixels)
      } finally {
        gl.setRenderTarget(previousTarget)
        gl.xr.enabled = previousXr
        shotTarget.dispose()
      }
      const shotCanvas = document.createElement('canvas')
      shotCanvas.width = shot.width
      shotCanvas.height = shot.height
      const shotContext = shotCanvas.getContext('2d')
      if (!shotContext) return ''
      const shotImage = shotContext.createImageData(shot.width, shot.height)
      const row = shot.width * 4
      for (let y = 0; y < shot.height; y += 1) {
        shotImage.data.set(shotPixels.subarray((shot.height - 1 - y) * row, (shot.height - y) * row), y * row)
      }
      shotContext.putImageData(shotImage, 0, 0)
      return shotCanvas.toDataURL('image/jpeg', shot.quality).split(',')[1] || ''
    }

    const captureView = (agentId: string, view: 'look' | 'around'): ViewPicture[] => {
      const station = getVillageStation(agentId) // where its body is right now, at its desk or beside the owner
      if (!station) return []
      const shots = view === 'look'
        ? [{ label: 'front', data: shoot(computeLookPose(station), LOOK_PICTURE) }]
        : computeAroundPoses(station).map(pose => ({ label: pose.label, data: shoot(pose, AROUND_PICTURE) }))
      return shots.filter(shot => shot.data).map(shot => ({ label: shot.label, data: shot.data, mediaType: 'image/jpeg' as const }))
    }

    const unregister = getAgentEngineClient().setEyesCapturer(capture)
    const unregisterView = getAgentEngineClient().setViewCapturer(captureView)
    return () => {
      unregister()
      unregisterView()
      target.dispose()
    }
  }, [gl, scene])

  return null
}

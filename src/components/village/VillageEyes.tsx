'use client'

// ░▒▓ VILLAGE EYES — a picture from an agent's own avatar, taken when the owner talks to it ▓▒░
// Mounted inside the R3F <Canvas> with the village. The agent engine asks for a picture over its socket
// (agent-engine-client.ts, `eyes.request`) when a message goes to an agent whose eyes are on; this renders
// the scene once from that agent's desk into a small off-screen target and answers with a JPEG.
// Cost: one extra 800x450 render and a pixel read-back per message sent, nothing per frame.

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getAgentEngineClient, type EyesPicture } from '../../lib/agent-engine-client'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { useInputManager } from '../../lib/input-manager'
import { EYES_PICTURE, computeEyesPose } from '../../lib/village/village-eyes'
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

    const unregister = getAgentEngineClient().setEyesCapturer(capture)
    return () => {
      unregister()
      target.dispose()
    }
  }, [gl, scene])

  return null
}

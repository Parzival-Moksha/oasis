import * as THREE from 'three'

export interface CameraSnapshot {
  position: [number, number, number]
  forward: [number, number, number]
}

let latestCameraSnapshot: CameraSnapshot | null = null

export function setCameraSnapshot(camera: THREE.Camera): void {
  const direction = camera.getWorldDirection(new THREE.Vector3())
  latestCameraSnapshot = {
    position: [camera.position.x, camera.position.y, camera.position.z],
    forward: [direction.x, direction.y, direction.z],
  }
}

export function getCameraSnapshot(): CameraSnapshot | null {
  if (!latestCameraSnapshot) return null
  return {
    position: [...latestCameraSnapshot.position] as [number, number, number],
    forward: [...latestCameraSnapshot.forward] as [number, number, number],
  }
}

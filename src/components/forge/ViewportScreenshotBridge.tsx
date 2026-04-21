'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useOasisStore } from '@/store/oasisStore'
import { readEmbodiedAgentSettingsFromStorage } from '@/lib/agent-action-settings'
import { getLiveObjectTransform } from '@/lib/live-object-transforms'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'

type ScreenshotFormat = 'jpeg' | 'png' | 'webp'

const ACTIVE_POLL_MS = 250
const IDLE_POLL_MS = 2000
const HIDDEN_POLL_MS = 5000

interface ScreenshotViewRequest {
  id: string
  mode: 'current' | 'agent-avatar-phantom' | 'look-at' | 'external-orbit' | 'third-person-follow' | 'avatar-portrait'
  agentType?: string
  position?: [number, number, number]
  target?: [number, number, number]
  fov?: number
  distance?: number
  heightOffset?: number
  lookAhead?: number
}

interface PendingScreenshotRequest {
  id: string
  worldId?: string
  requesterAgentType?: string
  requestedAt?: number
  format: ScreenshotFormat
  quality: number
  width: number
  height: number
  settleMs?: number
  views: ScreenshotViewRequest[]
}

function waitForAnimationFrame() {
  return new Promise<void>(resolve => {
    window.requestAnimationFrame(() => resolve())
  })
}

function createDataUrlFromPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  format: ScreenshotFormat,
  quality: number,
): string {
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height
  sourceCanvas.getContext('2d')!.putImageData(imageData, 0, 0)

  const flippedCanvas = document.createElement('canvas')
  flippedCanvas.width = width
  flippedCanvas.height = height
  const ctx = flippedCanvas.getContext('2d')!
  ctx.translate(0, height)
  ctx.scale(1, -1)
  ctx.drawImage(sourceCanvas, 0, 0)

  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg'
  return flippedCanvas.toDataURL(mime, quality)
}

export function ViewportScreenshotBridge() {
  const { gl, scene, camera, size } = useThree()
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const placedAgentAvatars = useOasisStore(state => state.placedAgentAvatars)
  const transforms = useOasisStore(state => state.transforms)
  const busyRef = useRef(false)

  const buildCaptureCamera = useCallback((view: ScreenshotViewRequest, width: number, height: number) => {
    const aspect = Math.max(0.1, width / Math.max(height, 1))
    const normalizeAgentIdentity = (value?: string | null) => (value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
    const resolveAgentAvatar = (subject?: string) => {
      const normalizedSubject = normalizeAgentIdentity(subject)
      if (!normalizedSubject) return null

      const candidateKeys = new Set([normalizedSubject])
      if (normalizedSubject === 'clawdling') candidateKeys.add('openclaw')
      if (normalizedSubject === 'openclaw') candidateKeys.add('clawdling')

      const byAgentType = placedAgentAvatars.find(entry => candidateKeys.has(normalizeAgentIdentity(entry.agentType)))
      if (byAgentType) return byAgentType

      return placedAgentAvatars.find(entry => candidateKeys.has(normalizeAgentIdentity(entry.label)))
    }

    const resolveSubjectPose = () => {
      const playerPose = !view.agentType || view.agentType === 'player'
        ? getPlayerAvatarPose()
        : null
      if (playerPose) {
        return {
          position: playerPose.position,
          yaw: playerPose.yaw,
          forward: new THREE.Vector3(playerPose.forward[0], playerPose.forward[1], playerPose.forward[2]).normalize(),
        }
      }

      const avatar = resolveAgentAvatar(view.agentType)
      if (!avatar) return null
      const transform = getLiveObjectTransform(avatar.id) || transforms[avatar.id]
      const position = transform?.position || avatar.position
      const yaw = (Array.isArray(transform?.rotation) ? transform.rotation[1] : avatar.rotation?.[1]) || 0
      return {
        position,
        yaw,
        forward: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize(),
      }
    }

    if (view.mode === 'current') {
      const sourceCamera = camera as THREE.PerspectiveCamera
      const captureCamera = new THREE.PerspectiveCamera(sourceCamera.fov, aspect, sourceCamera.near, sourceCamera.far)
      captureCamera.position.copy(sourceCamera.position)
      captureCamera.quaternion.copy(sourceCamera.quaternion)
      captureCamera.updateProjectionMatrix()
      captureCamera.updateMatrixWorld(true)
      return captureCamera
    }

    if (view.mode === 'look-at') {
      if (!view.position || !view.target) return null
      const captureCamera = new THREE.PerspectiveCamera(view.fov || 75, aspect, 0.1, 500)
      captureCamera.position.set(view.position[0], view.position[1], view.position[2])
      captureCamera.lookAt(view.target[0], view.target[1], view.target[2])
      captureCamera.updateProjectionMatrix()
      captureCamera.updateMatrixWorld(true)
      return captureCamera
    }

    if (view.mode === 'external-orbit') {
      const anchor = view.target
        ? new THREE.Vector3(view.target[0], view.target[1], view.target[2])
        : (() => {
            const avatar = resolveAgentAvatar(view.agentType)
            if (!avatar) return new THREE.Vector3(0, 0, 0)
            const transform = getLiveObjectTransform(avatar.id) || transforms[avatar.id]
            const position = transform?.position || avatar.position
            return new THREE.Vector3(position[0], position[1], position[2])
          })()
      const distance = view.distance ?? 16
      const heightOffset = view.heightOffset ?? 9
      const captureCamera = new THREE.PerspectiveCamera(view.fov || 60, aspect, 0.1, 800)
      captureCamera.position.set(
        anchor.x + distance * 0.72,
        anchor.y + heightOffset,
        anchor.z + distance * 0.72,
      )
      captureCamera.lookAt(anchor)
      captureCamera.updateProjectionMatrix()
      captureCamera.updateMatrixWorld(true)
      return captureCamera
    }

    if (view.mode === 'third-person-follow') {
      const subjectPose = resolveSubjectPose()
      if (!subjectPose) return null
      const basePosition = subjectPose.position
      const forward = subjectPose.forward
      const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize()
      const base = new THREE.Vector3(basePosition[0], basePosition[1], basePosition[2])
      const distance = view.distance ?? 4.4
      const heightOffset = view.heightOffset ?? 2.1
      const lookAhead = view.lookAhead ?? 4
      const shoulderOffset = Math.max(0.45, Math.min(1.4, distance * 0.2))
      const eye = base.clone().add(new THREE.Vector3(0, heightOffset, 0))
      const target = eye.clone().addScaledVector(forward, lookAhead)
      const origin = eye
        .clone()
        .addScaledVector(forward, -distance)
        .addScaledVector(right, shoulderOffset)
      const captureCamera = new THREE.PerspectiveCamera(view.fov || 72, aspect, 0.1, 500)
      captureCamera.position.copy(origin)
      captureCamera.lookAt(target)
      captureCamera.updateProjectionMatrix()
      captureCamera.updateMatrixWorld(true)
      return captureCamera
    }

    if (view.mode === 'avatar-portrait') {
      const subjectPose = resolveSubjectPose()
      if (!subjectPose) return null
      const base = new THREE.Vector3(subjectPose.position[0], subjectPose.position[1], subjectPose.position[2])
      const forward = subjectPose.forward
      const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize()
      const distance = view.distance ?? 2.75
      const heightOffset = view.heightOffset ?? 1.55
      const eye = base.clone().add(new THREE.Vector3(0, heightOffset, 0))
      const target = eye.clone().addScaledVector(right, -0.12)
      const origin = eye
        .clone()
        .addScaledVector(forward, distance)
        .addScaledVector(right, 0.22)
      const captureCamera = new THREE.PerspectiveCamera(view.fov || 34, aspect, 0.1, 500)
      captureCamera.position.copy(origin)
      captureCamera.lookAt(target)
      captureCamera.updateProjectionMatrix()
      captureCamera.updateMatrixWorld(true)
      return captureCamera
    }

    const avatar = resolveAgentAvatar(view.agentType)
    if (!avatar) return null

    const transform = getLiveObjectTransform(avatar.id) || transforms[avatar.id]
    const position = transform?.position || avatar.position
    const rotation = Array.isArray(transform?.rotation) ? transform.rotation : avatar.rotation
    const yaw = rotation?.[1] || 0
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const heightOffset = view.heightOffset ?? 1.55
    const distance = view.distance ?? 1
    const lookAhead = view.lookAhead ?? 5
    const eye = new THREE.Vector3(position[0], position[1] + heightOffset, position[2])
    const target = eye.clone().addScaledVector(forward, lookAhead)
    const origin = eye.clone().addScaledVector(forward, distance)
    const captureCamera = new THREE.PerspectiveCamera(view.fov || 100, aspect, 0.1, 500)
    captureCamera.position.copy(origin)
    captureCamera.lookAt(target)
    captureCamera.updateProjectionMatrix()
    captureCamera.updateMatrixWorld(true)
    return captureCamera
  }, [camera, placedAgentAvatars, transforms])

  useEffect(() => {
    if (!activeWorldId) return

    let cancelled = false
    let timeoutId: number | null = null
    let lastPayload = ''
    const abortController = new AbortController()

    const publishActiveWorld = async () => {
      try {
        const pose = getPlayerAvatarPose()
        const cameraPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
        const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
        const cameraForwardTuple: [number, number, number] = [cameraForward.x, cameraForward.y, cameraForward.z]
        const payload = JSON.stringify({
          worldId: activeWorldId,
          player: {
            ...(pose ? { avatar: pose } : {}),
            camera: { position: cameraPos, forward: cameraForwardTuple },
          },
        })
        // Skip no-op publishes — nothing to say if the pose hasn't budged.
        if (payload === lastPayload) return
        lastPayload = payload
        await fetch('/api/world-active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: abortController.signal,
        })
      } catch (error) {
        if (cancelled) return
        // AbortError on unmount is expected — don't spam the console.
        if ((error as Error)?.name === 'AbortError') return
        console.warn('[ViewportScreenshotBridge] Failed to publish active world:', error)
      }
    }

    // Tight heartbeat (500ms) when tab visible — keeps pose fresh for MCP consumers
    // (so agents like OpenClaw can "walk to the user"). Slow to 15s when hidden to
    // avoid spam while tab is backgrounded.
    const schedule = () => {
      if (cancelled) return
      const visible = typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true
      const delay = visible ? 500 : 15000
      timeoutId = window.setTimeout(() => {
        void publishActiveWorld().finally(schedule)
      }, delay)
    }

    void publishActiveWorld()
    schedule()

    return () => {
      cancelled = true
      abortController.abort()
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activeWorldId, camera])

  const captureView = useCallback((request: PendingScreenshotRequest, view: ScreenshotViewRequest) => {
    const width = Math.max(320, Math.round(request.width || size.width || 480))
    const height = Math.max(180, Math.round(request.height || size.height || 270))
    const captureCamera = buildCaptureCamera(view, width, height)
    if (!captureCamera) return null

    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
    })

    const previousTarget = gl.getRenderTarget()
    const previousXr = gl.xr.enabled
    const previousShadowUpdate = gl.shadowMap.autoUpdate

    try {
      scene.updateMatrixWorld(true)
      captureCamera.updateMatrixWorld(true)
      gl.xr.enabled = false
      gl.shadowMap.autoUpdate = true
      gl.setRenderTarget(renderTarget)
      gl.render(scene, captureCamera)

      const pixels = new Uint8Array(width * height * 4)
      gl.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)
      const dataUrl = createDataUrlFromPixels(pixels, width, height, request.format, request.quality)
      return {
        viewId: view.id,
        base64: dataUrl.split(',')[1] || '',
        format: request.format,
      }
    } catch (error) {
      console.warn('[ViewportScreenshotBridge] Capture failed:', error)
      return null
    } finally {
      gl.setRenderTarget(previousTarget)
      gl.xr.enabled = previousXr
      gl.shadowMap.autoUpdate = previousShadowUpdate
      renderTarget.dispose()
    }
  }, [buildCaptureCamera, gl, scene, size.height, size.width])

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null

    const scheduleNext = (delay: number) => {
      if (cancelled) return
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      timeoutId = window.setTimeout(() => {
        void poll()
      }, delay)
    }

    const poll = async () => {
      if (cancelled) return

      let nextDelay = typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? HIDDEN_POLL_MS
        : IDLE_POLL_MS

      if (busyRef.current) {
        scheduleNext(nextDelay)
        return
      }

      try {
        const response = await fetch(`/api/oasis-tools${activeWorldId ? `?worldId=${encodeURIComponent(activeWorldId)}` : ''}`, { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json().catch(() => null) as {
          screenshotPending?: boolean
          screenshotRequest?: PendingScreenshotRequest | null
        } | null

        const request = payload?.screenshotPending ? payload.screenshotRequest : null
        if (!request || !request.id || !Array.isArray(request.views) || request.views.length === 0) return

        nextDelay = ACTIVE_POLL_MS
        busyRef.current = true
        const configuredSettleMs = readEmbodiedAgentSettingsFromStorage().agentScreenshotSettleMs
        const settleMs = Math.max(0, Math.max(Number(request.settleMs) || 0, configuredSettleMs))
        const requestedAt = Number(request.requestedAt) || Date.now()
        const remainingSettleMs = Math.max(0, settleMs - Math.max(0, Date.now() - requestedAt))
        if (remainingSettleMs > 0) {
          await new Promise(resolve => window.setTimeout(resolve, remainingSettleMs))
        }
        await waitForAnimationFrame()
        await waitForAnimationFrame()
        const captures = request.views
          .map(view => captureView(request, view))
          .filter((capture): capture is { viewId: string; base64: string; format: ScreenshotFormat } => !!capture && !!capture.base64)

        await fetch('/api/oasis-tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: request.id,
            requesterAgentType: request.requesterAgentType,
            views: request.views.map(view => ({
              agentType: view.agentType,
            })),
            screenshotCaptures: captures,
          }),
        })
      } catch (error) {
        console.warn('[ViewportScreenshotBridge] Poll failed:', error)
      } finally {
        busyRef.current = false
        scheduleNext(nextDelay)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activeWorldId, captureView])

  return null
}

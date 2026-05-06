'use client'

import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { useOasisStore } from '@/store/oasisStore'
import { getCameraSnapshot } from '@/lib/camera-bridge'
import { flushPendingSaveWorld } from '@/lib/forge/world-persistence'
import { hasActiveUILayer, getInputState } from '@/lib/input-manager'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { useIsHostedOasis } from '@/lib/oasis-mode-client'
import { WELCOME_HUB_WORLD_ID } from '@/lib/portal-gates'

const BUTTON_POSITION: [number, number, number] = [2.35, 0.18, 2.15]
const INTERACTION_RADIUS = 3
const DISTANCE_EPSILON = 0.05
const STATUS_RESET_MS = 4200

type ExportStatus = 'idle' | 'saving' | 'success' | 'error'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function resolveInteractionOrigin(): [number, number, number] | null {
  const inputState = getInputState()
  const avatarPose = getPlayerAvatarPose()
  const camera = getCameraSnapshot()

  if (inputState === 'third-person') {
    return avatarPose?.position || camera?.position || null
  }

  return camera?.position || avatarPose?.position || null
}

function distanceToButton(origin: [number, number, number]): number {
  return Math.hypot(
    origin[0] - BUTTON_POSITION[0],
    origin[1] - BUTTON_POSITION[1],
    origin[2] - BUTTON_POSITION[2],
  )
}

function exportApiUrl(): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  if (typeof window === 'undefined') return `${basePath}/api/default-worlds/portal-zero/export`
  return `${window.location.origin}${basePath}/api/default-worlds/portal-zero/export`
}

export function PortalZeroCanonicalButton() {
  const hostedMode = useIsHostedOasis()
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const worldReady = useOasisStore(state => state._worldReady)
  const saveWorldState = useOasisStore(state => state.saveWorldState)
  const [distance, setDistance] = useState(Number.POSITIVE_INFINITY)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [message, setMessage] = useState('')
  const distanceRef = useRef(Number.POSITIVE_INFINITY)
  const inRangeRef = useRef(false)
  const busyRef = useRef(false)
  const frameCountRef = useRef(0)
  const statusResetRef = useRef<number | null>(null)
  const enabled = !hostedMode && activeWorldId === WELCOME_HUB_WORLD_ID
  const inRange = distance <= INTERACTION_RADIUS
  const canInteract = enabled && worldReady && inRange && status !== 'saving'

  useFrame(() => {
    if (!enabled) return
    frameCountRef.current += 1
    if (frameCountRef.current % 6 !== 0) return

    const origin = resolveInteractionOrigin()
    const nextDistance = origin ? distanceToButton(origin) : Number.POSITIVE_INFINITY
    const nextInRange = nextDistance <= INTERACTION_RADIUS
    if (
      Math.abs(nextDistance - distanceRef.current) > DISTANCE_EPSILON
      || nextInRange !== inRangeRef.current
    ) {
      distanceRef.current = nextDistance
      inRangeRef.current = nextInRange
      setDistance(nextDistance)
    }
  })

  const resetStatusLater = useCallback(() => {
    if (statusResetRef.current !== null) {
      window.clearTimeout(statusResetRef.current)
    }
    statusResetRef.current = window.setTimeout(() => {
      setStatus('idle')
      setMessage('')
      statusResetRef.current = null
    }, STATUS_RESET_MS)
  }, [])

  const runExport = useCallback(async () => {
    if (!enabled || !worldReady || !inRangeRef.current || busyRef.current) return
    busyRef.current = true
    setStatus('saving')
    setMessage('Saving Portal Zero')

    try {
      saveWorldState()
      const saveResult = await flushPendingSaveWorld(WELCOME_HUB_WORLD_ID)
      if (!saveResult) {
        throw new Error('Could not save the current Portal Zero world before exporting.')
      }

      setMessage('Writing seed files')
      const response = await fetch(exportApiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) {
        throw new Error(data?.error || `Export failed with HTTP ${response.status}`)
      }

      setStatus('success')
      setMessage('Canonical Portal Zero saved')
      resetStatusLater()
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Portal Zero export failed')
      resetStatusLater()
    } finally {
      busyRef.current = false
    }
  }, [enabled, resetStatusLater, saveWorldState, worldReady])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyF') return
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return
      if (hasActiveUILayer()) return
      if (!worldReady || !inRangeRef.current) return

      event.preventDefault()
      void runExport()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, runExport, worldReady])

  useEffect(() => {
    return () => {
      if (statusResetRef.current !== null) {
        window.clearTimeout(statusResetRef.current)
      }
    }
  }, [])

  if (!enabled) return null

  const buttonColor = status === 'error'
    ? '#ef4444'
    : status === 'success'
      ? '#22c55e'
      : canInteract
        ? '#facc15'
        : '#38bdf8'
  const emissive = new THREE.Color(buttonColor)
  const promptText = !worldReady
    ? 'World loading'
    : status === 'idle'
      ? canInteract
        ? 'F'
        : `${Math.max(0, distance - INTERACTION_RADIUS).toFixed(1)}m`
      : status === 'saving'
        ? 'Saving'
        : status === 'success'
          ? 'Saved'
          : 'Error'

  return (
    <group position={BUTTON_POSITION} rotation={[0, -0.35, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.62, 0.72, 0.2, 48]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh
        castShadow
        position={[0, status === 'saving' ? 0.15 : 0.22, 0]}
        scale={[1, status === 'saving' ? 0.65 : 1, 1]}
        onClick={(event) => {
          event.stopPropagation()
          if (canInteract) void runExport()
        }}
      >
        <cylinderGeometry args={[0.42, 0.48, 0.16, 48]} />
        <meshStandardMaterial
          color={buttonColor}
          emissive={emissive}
          emissiveIntensity={canInteract || status !== 'idle' ? 0.45 : 0.18}
          roughness={0.32}
          metalness={0.18}
        />
      </mesh>
      <mesh position={[0, 0.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.56, 64]} />
        <meshBasicMaterial color={buttonColor} transparent opacity={canInteract ? 0.78 : 0.34} />
      </mesh>
      <pointLight color={buttonColor} intensity={canInteract ? 0.95 : 0.35} distance={4} position={[0, 0.8, 0]} />
      <Html position={[0, 1.1, 0]} center transform distanceFactor={4.5} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            minWidth: 132,
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${buttonColor}`,
            background: 'rgba(7, 10, 18, 0.86)',
            color: '#f8fafc',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: 13,
            lineHeight: 1.2,
            textAlign: 'center',
            boxShadow: `0 0 22px ${buttonColor}55`,
            userSelect: 'none',
            whiteSpace: 'normal',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: canInteract && status === 'idle' ? 22 : 13 }}>
            {promptText}
          </div>
          <div style={{ marginTop: 4, color: '#cbd5e1' }}>
            {message || 'Make Canonical Portal Zero'}
          </div>
        </div>
      </Html>
    </group>
  )
}

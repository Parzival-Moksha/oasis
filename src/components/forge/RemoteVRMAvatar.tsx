'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// REMOTE VRM AVATAR — Other players' bodies, seen across the wire
// ─═̷─═̷─ॐ─═̷─═̷─ Same pipeline as PlayerAvatar, but pose-driven ─═̷─═̷─ॐ─═̷─═̷─
//
// MultiplayerPresenceLayer owns the snapshot buffer + interpolation. It hands
// us an interpolated { position, yaw, speed } target each frame; we lerp the
// outer group toward it via the forwarded ref (parent does the lerp) and pick
// an animation state from the velocity magnitude.
//
// If avatarUrl is empty (no profile picture yet) OR the VRM fails to load, we
// fall back to the original pill capsule + sphere head so the remote player
// is always visible.
//
// Memory: each player gets its own VRM parse via a sessionId-keyed URL
// fragment. drei caches by URL; this gives each remote a fresh skeleton +
// expressionManager without us writing a custom VRM clone helper. With an
// expected 8-player ceiling this is fine; if we ever go higher we can swap in
// VRMUtils.deepCloneVrm when @pixiv/three-vrm ships it (3.5 does not).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { forwardRef, Suspense, useEffect, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'

import { AnimationController } from '../../lib/animation-state-machine'

// ═══════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════

export interface RemoteVRMAvatarProps {
  /** VRM URL. Empty string -> pill fallback. */
  avatarUrl: string
  /** Stable identifier used to keep the per-player VRM cache entry unique. */
  cacheKey: string
  displayName: string
  /** Ring + nametag tint. */
  color: string
  /** m/s, inferred from position deltas by the parent. */
  speed: number
}

// Animation thresholds aligned with PlayerAvatar's TPS speeds:
//   default WASD = 3.0 m/s (TPS_BASE_SPEED), shift = 12.0 (sprint x4),
//   space = 0.75 (walk x0.25). Default run is 3.0, so the run threshold
//   must sit below it; otherwise remotes look like they're tip-toeing.
const WALK_SPEED = 0.1
const RUN_SPEED = 2
const SPRINT_SPEED = 7
const CROSSFADE_SECONDS = 0.15

// ═══════════════════════════════════════════════════════════════════════════
// PILL FALLBACK — capsule + sphere head + ring + nametag
// Pulled out of the old RemotePresenceAvatar so both the empty-URL path and
// the VRM-failure path render identically.
// ═══════════════════════════════════════════════════════════════════════════

function PillBody({ color, displayName }: { color: string; displayName: string }) {
  return (
    <>
      <mesh castShadow position={[0, 0.88, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.9, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.52} metalness={0.12} />
      </mesh>
      <mesh castShadow position={[0, 1.46, 0]}>
        <sphereGeometry args={[0.22, 18, 12]} />
        <meshStandardMaterial color="#f8fafc" emissive={color} emissiveIntensity={0.08} roughness={0.48} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.15, 0.28]}>
        <boxGeometry args={[0.42, 0.08, 0.06]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.54} />
      </mesh>
      <NameTag displayName={displayName} />
    </>
  )
}

function NameTag({ displayName }: { displayName: string }) {
  return (
    <Billboard position={[0, 1.86, 0]}>
      <Text
        fontSize={0.16}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#020617"
      >
        {displayName}
        <meshBasicMaterial color="#e0f2fe" />
      </Text>
    </Billboard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VRM BODY — actual three-vrm rendering + animation
// Suspends on first load via useLoader; the parent wraps us in Suspense with
// a pill fallback.
// ═══════════════════════════════════════════════════════════════════════════

function VRMBody({
  avatarUrl,
  cacheKey,
  displayName,
  color,
  speedRef,
}: {
  avatarUrl: string
  cacheKey: string
  displayName: string
  color: string
  speedRef: React.MutableRefObject<number>
}) {
  const vrmRef = useRef<VRM | null>(null)
  const animControllerRef = useRef<AnimationController | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)

  // Per-player cache fragment — hash isn't sent to server, but it forces
  // useLoader to give us a unique parsed GLTF (so each remote owns its own
  // skeleton + expression manager).
  const vrmUrl = avatarUrl + '#vrm-remote-' + cacheKey
  const gltf = useLoader(GLTFLoader, vrmUrl, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  useEffect(() => {
    const loaded = gltf.userData.vrm as VRM | undefined
    if (!loaded) {
      console.warn('[RemoteVRMAvatar] No VRM data in', avatarUrl)
      return
    }

    VRMUtils.rotateVRM0(loaded)

    // Material fixes — match PlayerAvatar so lighting + shadows look right.
    loaded.scene.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return
      const mesh = child as THREE.Mesh
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        const m = mat as unknown as Record<string, unknown>
        if ('giEqualizationFactor' in m) m.giEqualizationFactor = 0.9
        if (mat.type === 'MeshBasicMaterial') {
          const basic = mat as THREE.MeshBasicMaterial
          mesh.material = new THREE.MeshStandardMaterial({
            color: basic.color,
            map: basic.map,
            transparent: basic.transparent,
            opacity: basic.opacity,
            side: basic.side,
            roughness: 0.8,
            metalness: 0.0,
            envMapIntensity: 1.5,
          })
          continue
        }
        if ('envMapIntensity' in m) {
          ;(mat as THREE.MeshStandardMaterial).envMapIntensity = 1.5
        }
        mat.needsUpdate = true
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
    })

    vrmRef.current = loaded
    setVrm(loaded)

    // Cleanup: dispose the parsed VRM + GPU resources when this peer leaves
    // (sessionId churn, world swap, or remount). Without this, drei's
    // useLoader cache balloons across peer joins — each one's geometries,
    // textures, and material maps stay resident. Per-player cache fragment
    // ensures we're not stomping a VRM another peer still uses.
    return () => {
      try {
        VRMUtils.deepDispose(loaded.scene)
      } catch {}
      if (vrmRef.current === loaded) vrmRef.current = null
    }
  }, [gltf, avatarUrl])

  // Animation controller — task spec thresholds. AnimationController accepts
  // them via config so we don't fork the state machine.
  useEffect(() => {
    if (!vrm) return
    const controller = new AnimationController(vrm, {
      crossfadeDuration: CROSSFADE_SECONDS,
      walkSpeedThreshold: WALK_SPEED,
      runSpeedThreshold: RUN_SPEED,
      sprintSpeedThreshold: SPRINT_SPEED,
    })
    animControllerRef.current = controller
    // Kick off idle so the avatar isn't a T-pose while clips stream in.
    controller.preloadClip('idle').then(ok => {
      if (animControllerRef.current === controller && ok) {
        controller.transitionTo('idle')
      }
    })
    return () => {
      controller.dispose()
      if (animControllerRef.current === controller) animControllerRef.current = null
    }
  }, [vrm])

  useFrame((_, rawDelta) => {
    const v = vrmRef.current
    if (!v) return
    const delta = Math.min(rawDelta, 0.05)
    animControllerRef.current?.update(delta)
    v.update(delta)
    animControllerRef.current?.updateFromVelocity(speedRef.current)
  })

  if (!vrm) return null

  return (
    <>
      <primitive object={vrm.scene} />
      <NameTag displayName={displayName} />
      {/* Foot ring stays — tints the floor under the remote player so they
          read as "another presence" even when crowded. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY — falls back to the pill if useLoader throws (404, malformed
// VRM, etc.). Without this, a single bad avatarUrl crashes the whole scene.
// ═══════════════════════════════════════════════════════════════════════════

interface VRMBoundaryProps {
  fallback: React.ReactNode
  children: React.ReactNode
  avatarUrl: string
}

class VRMErrorBoundary extends React.Component<VRMBoundaryProps, { hasError: boolean }> {
  constructor(props: VRMBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error) {
    console.warn(`[RemoteVRMAvatar] VRM load failed for ${this.props.avatarUrl}: ${error.message}`)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC COMPONENT — forwardRef so the parent's interpolation can lerp the
// group's position/rotation directly into our ref.
// ═══════════════════════════════════════════════════════════════════════════

export const RemoteVRMAvatar = forwardRef<THREE.Group, RemoteVRMAvatarProps>(function RemoteVRMAvatar(
  { avatarUrl, cacheKey, displayName, color, speed },
  ref,
) {
  // Speed mirror — the body's useFrame reads from a ref so we don't re-render
  // the entire VRM subtree on every speed change.
  const speedRef = useRef(0)
  speedRef.current = speed

  // Empty URL -> straight to pill. No Suspense, no error boundary needed.
  if (!avatarUrl) {
    return (
      <group ref={ref}>
        <PillBody color={color} displayName={displayName} />
      </group>
    )
  }

  const pillFallback = <PillBody color={color} displayName={displayName} />

  return (
    <group ref={ref}>
      <VRMErrorBoundary fallback={pillFallback} avatarUrl={avatarUrl}>
        <Suspense fallback={pillFallback}>
          <VRMBody
            avatarUrl={avatarUrl}
            cacheKey={cacheKey}
            displayName={displayName}
            color={color}
            speedRef={speedRef}
          />
        </Suspense>
      </VRMErrorBoundary>
    </group>
  )
})

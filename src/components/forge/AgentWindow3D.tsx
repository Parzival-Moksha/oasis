'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// AGENT WINDOW 3D — Hybrid Focus/Texture rendering
// ─═̷─═̷─ॐ─═̷─═̷─ Unfocused: textured mesh (html2canvas). Focused: visible DOM overlay. ─═̷─═̷─ॐ─═̷─═̷─
// Content always lives in AgentWindowPortals (OffscreenPortal).
// This component handles: 3D mesh, frames, selection, focus state, CSS 3D positioning.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useEffect, memo, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentWindow } from '../../store/oasisStore'
import {
  FourBarFrame, NeonFrame, HologramFrame, VoidFrame,
  SpaghettiFrame, TriangleFrame, InfernoFrame, MatrixFrame, PlasmaFrame, BrutalistFrame
} from './FrameComponents'
import { getOffscreenUIManager } from '../../lib/forge/offscreen-ui-manager'

// drei <Html> maps CSS px to world units: PX_TO_WORLD = distanceFactor / 400
const DISTANCE_FACTOR = 8
const PX_TO_WORLD = DISTANCE_FACTOR / 400  // 0.02

// ═══════════════════════════════════════════════════════════════════════════
// FOCUS PROMPT — pulsing "HIT ENTER" bubble
// ═══════════════════════════════════════════════════════════════════════════

function FocusPrompt({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <Html position={[0, 2.2, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        className="select-none font-mono font-bold text-sm tracking-wider"
        style={{
          color: '#38bdf8',
          textShadow: '0 0 20px rgba(56,189,248,0.6), 0 0 40px rgba(56,189,248,0.3)',
          animation: 'focusPromptPulse 1.5s ease-in-out infinite',
        }}
      >
        HIT ENTER
      </div>
      <style>{`
        @keyframes focusPromptPulse {
          0%, 100% { opacity: 0.7; transform: scale(1) translateY(0); }
          50% { opacity: 1; transform: scale(1.1) translateY(-3px); }
        }
      `}</style>
    </Html>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CSS 3D TRANSFORM — project 3D window position to CSS matrix3d
// ═══════════════════════════════════════════════════════════════════════════

function computeCSSTransform(
  camera: THREE.Camera,
  worldMatrix: THREE.Matrix4,
  viewportWidth: number,
  viewportHeight: number,
  pixelWidth: number,
  pixelHeight: number,
): string {
  // Camera projection × view × world = clip-space matrix
  const mvp = new THREE.Matrix4()
  mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  mvp.multiply(worldMatrix)

  // Extract NDC position of the center point
  const center = new THREE.Vector4(0, 0, 0, 1).applyMatrix4(mvp)
  if (center.w <= 0) return 'scale(0)' // Behind camera

  // Screen position (0,0 = center of viewport)
  const sx = (center.x / center.w) * viewportWidth / 2
  const sy = -(center.y / center.w) * viewportHeight / 2

  // Scale: how big the window appears based on distance
  // At distanceFactor=8, 1 CSS px = 0.02 world units
  // The projected scale = (1/w) * projectionScale
  const worldScale = PX_TO_WORLD
  const projScale = (camera.projectionMatrix.elements[0] * viewportWidth / 2) * worldScale / center.w

  // Translate to screen center, then offset
  const tx = viewportWidth / 2 + sx - (pixelWidth * projScale) / 2
  const ty = viewportHeight / 2 + sy - (pixelHeight * projScale) / 2

  return `translate(${tx}px, ${ty}px) scale(${projScale})`
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT WINDOW 3D — main component
// ═══════════════════════════════════════════════════════════════════════════

export const AgentWindow3D = memo(function AgentWindow3D({ window: win }: { window: AgentWindow }) {
  const groupRef = useRef<THREE.Group>(null!)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const isSelected = selectedObjectId === win.id
  const isFocused = focusedAgentWindowId === win.id
  const prevFocusedRef = useRef(false)

  const winWidth = win.width || 800
  const winHeight = win.height || 600
  const winScale = win.scale || 1
  const worldWidth = winWidth * PX_TO_WORLD * winScale
  const worldHeight = winHeight * PX_TO_WORLD * winScale

  const agentColor = win.agentType === 'anorak' ? '#38bdf8'
    : win.agentType === 'anorak-pro' ? '#14b8a6'
    : win.agentType === 'merlin' ? '#f59e0b'
    : win.agentType === 'parzival' ? '#14b8a6'
    : '#22c55e'

  // ═══ TEXTURE for unfocused mode ═══
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)

  useEffect(() => {
    const mgr = getOffscreenUIManager()
    if (!mgr) return
    // Poll for texture availability (portal may mount slightly after us)
    const interval = setInterval(() => {
      const tex = mgr.getTexture(win.id)
      if (tex) { setTexture(tex); clearInterval(interval) }
    }, 100)
    const tex = mgr.getTexture(win.id)
    if (tex) { setTexture(tex); clearInterval(interval) }
    return () => clearInterval(interval)
  }, [win.id])

  // ═══ FOCUS MODE transitions ═══
  useEffect(() => {
    const mgr = getOffscreenUIManager()
    if (!mgr) return

    if (isFocused && !prevFocusedRef.current) {
      // Gaining focus: make container visible
      mgr.setFocused(win.id, true)
    } else if (!isFocused && prevFocusedRef.current) {
      // Losing focus: hide container, resume capture
      mgr.setFocused(win.id, false)
    }
    prevFocusedRef.current = isFocused
  }, [isFocused, win.id])

  // ═══ CSS 3D POSITIONING — update container transform each frame when focused ═══
  const { camera, gl } = useThree()
  useFrame(() => {
    if (!isFocused || !groupRef.current) return
    const mgr = getOffscreenUIManager()
    if (!mgr) return

    const rect = gl.domElement.getBoundingClientRect()
    const cssTransform = computeCSSTransform(
      camera,
      groupRef.current.matrixWorld,
      rect.width,
      rect.height,
      winWidth,
      winHeight,
    )
    mgr.setCSSTransform(win.id, cssTransform)
  })

  // ═══ TEXTURE UPDATE for unfocused windows ═══
  useFrame(() => {
    if (isFocused || !texture) return
    // Texture needsUpdate is set by OffscreenUIManager's capture loop
  })

  const windowOpacity = win.windowOpacity ?? 1

  return (
    <group ref={groupRef}>
      {/* ═══ TEXTURED PLANE — shown when NOT focused ═══ */}
      {!isFocused && (
        <mesh>
          <planeGeometry args={[worldWidth, worldHeight]} />
          {texture ? (
            <meshBasicMaterial
              map={texture}
              transparent
              opacity={windowOpacity}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          ) : (
            <meshBasicMaterial color="#0a0a0f" transparent opacity={windowOpacity} side={THREE.DoubleSide} />
          )}
        </mesh>
      )}

      {/* ═══ HITBOX — always present for raycasting (selection) ═══ */}
      <mesh>
        <planeGeometry args={[worldWidth, worldHeight]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* ═══ PICTURE FRAMES — all 14 styles ═══ */}
      {win.frameStyle && (() => {
        const fw = worldWidth, fh = worldHeight, fs = winScale
        const ft = win.frameThickness ?? 1
        return (
          <group position={[0, 0, -0.01]}>
            {win.frameStyle === 'gilded' && (<><group position={[0, 0, -0.004 * fs]}><FourBarFrame w={fw} h={fh} border={0.04 * fs * ft} depth={0.025 * fs * ft} color="#B8860B" roughness={0.25} metalness={0.85} /></group><group position={[0, 0, 0.004 * fs]}><FourBarFrame w={fw} h={fh} border={0.008 * fs * ft} depth={0.005 * fs * ft} color="#FFD700" roughness={0.1} metalness={1.0} emissive="#DAA520" emissiveIntensity={0.3} /></group></>)}
            {win.frameStyle === 'neon' && <NeonFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'thin' && <FourBarFrame w={fw} h={fh} border={0.006 * fs * ft} depth={0.003 * fs * ft} color="#1a1a1a" roughness={0.9} metalness={0.0} />}
            {win.frameStyle === 'baroque' && (<><group position={[0, 0, -0.005 * fs]}><FourBarFrame w={fw} h={fh} border={0.08 * fs * ft} depth={0.04 * fs * ft} color="#3E1C00" roughness={0.3} metalness={0.7} /></group><group position={[0, 0, 0.003 * fs]}><FourBarFrame w={fw} h={fh} border={0.02 * fs * ft} depth={0.015 * fs * ft} color="#FFD700" roughness={0.15} metalness={0.95} emissive="#DAA520" emissiveIntensity={0.2} /></group></>)}
            {win.frameStyle === 'hologram' && <HologramFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'rustic' && <FourBarFrame w={fw} h={fh} border={0.05 * fs * ft} depth={0.025 * fs * ft} color="#3E2723" roughness={0.95} metalness={0.0} />}
            {win.frameStyle === 'ice' && (<><FourBarFrame w={fw} h={fh} border={0.04 * fs * ft} depth={0.02 * fs * ft} color="#B3E5FC" roughness={0.05} metalness={0.1} transparent opacity={0.5} emissive="#81D4FA" emissiveIntensity={0.6} /></>)}
            {win.frameStyle === 'void' && (<><group position={[0, 0, -0.005 * fs]}><FourBarFrame w={fw} h={fh} border={0.05 * fs * ft} depth={0.035 * fs * ft} color="#050505" roughness={0.95} metalness={0.05} /></group><group position={[0, 0, 0.002 * fs]}><FourBarFrame w={fw} h={fh} border={0.006 * fs * ft} depth={0.003 * fs * ft} color="#14b8a6" roughness={0.0} metalness={1.0} emissive="#14b8a6" emissiveIntensity={3} /></group></>)}
            {win.frameStyle === 'spaghetti' && <SpaghettiFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'triangle' && <TriangleFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'fire' && <InfernoFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'matrix' && <MatrixFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'plasma' && <PlasmaFrame w={fw} h={fh} scale={fs * ft} />}
            {win.frameStyle === 'brutalist' && <BrutalistFrame w={fw} h={fh} scale={fs * ft} />}
          </group>
        )
      })()}

      {/* Selection glow ring on ground */}
      {isSelected && !isFocused && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -win.position[1] + 0.05, 0]}>
          <ringGeometry args={[1.2 * winScale, 1.5 * winScale, 32]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.4} />
        </mesh>
      )}

      {/* Focus glow plane */}
      {isFocused && (
        <mesh position={[0, 0, -0.05]}>
          <planeGeometry args={[worldWidth + 0.4, worldHeight + 0.4]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.08} />
        </mesh>
      )}

      {/* "HIT ENTER" prompt */}
      <FocusPrompt visible={isSelected && !isFocused} />
    </group>
  )
})

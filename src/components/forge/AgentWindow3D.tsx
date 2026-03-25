'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// AGENT WINDOW 3D — Interactive agent panels placed in the Oasis world
// ─═̷─═̷─ॐ─═̷─═̷─ Full DOM rendered via <Html transform> in true 3D ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useMemo, memo, useCallback, useState } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentWindow } from '../../store/oasisStore'
import { AnorakWindowContent } from './AnorakWindowContent'
import { ParzivalWindowContent } from './ParzivalWindowContent'
import { FourBarFrame, NeonFrame, HologramFrame, VoidFrame } from './FrameComponents'

// ═══════════════════════════════════════════════════════════════════════════
// FOCUS PROMPT — pulsing "HIT ENTER" bubble when window is selected
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
// RESIZE HANDLE — bottom-right corner drag to resize window
// ═══════════════════════════════════════════════════════════════════════════

function ResizeHandle({ windowId, currentWidth, currentHeight }: {
  windowId: string
  currentWidth: number
  currentHeight: number
}) {
  const updateAgentWindow = useOasisStore(s => s.updateAgentWindow)
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startRef.current = { x: e.clientX, y: e.clientY, w: currentWidth, h: currentHeight }

    const onMouseMove = (ev: MouseEvent) => {
      if (!startRef.current) return
      const dx = ev.clientX - startRef.current.x
      const dy = ev.clientY - startRef.current.y
      const newW = Math.max(400, Math.min(1600, startRef.current.w + dx))
      const newH = Math.max(300, Math.min(1200, startRef.current.h + dy))
      updateAgentWindow(windowId, { width: Math.round(newW), height: Math.round(newH) })
    }
    const onMouseUp = () => {
      startRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [windowId, currentWidth, currentHeight, updateAgentWindow])

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 16,
        height: 16,
        cursor: 'nwse-resize',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.3 }}>
        <line x1="7" y1="1" x2="1" y2="7" stroke="#888" strokeWidth="1" />
        <line x1="7" y1="4" x2="4" y2="7" stroke="#888" strokeWidth="1" />
        <line x1="7" y1="7" x2="7" y2="7" stroke="#888" strokeWidth="1" />
      </svg>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT WINDOW 3D — the R3F component
// ═══════════════════════════════════════════════════════════════════════════

// drei <Html transform distanceFactor={D}> maps CSS pixels to world units at ratio D/400.
// Source: drei Html.js line 300 — used for its own occlusion mesh sizing.
// Confirmed by matrix3d scale factor = 1/(D/400) = 400/D in transformInnerRef.
// With D=8: PX_TO_WORLD = 8/400 = 0.02. So 800px → 16 world units, 600px → 12 world units.
const DISTANCE_FACTOR = 8
const PX_TO_WORLD = DISTANCE_FACTOR / 400  // 0.02

export const AgentWindow3D = memo(function AgentWindow3D({ window: win }: { window: AgentWindow }) {
  const groupRef = useRef<THREE.Group>(null!)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const isSelected = selectedObjectId === win.id
  const isFocused = focusedAgentWindowId === win.id

  // Defaults for legacy windows saved before width/height/scale were added
  const winWidth = win.width || 800
  const winHeight = win.height || 600
  const winScale = win.scale || 1

  // World-space dimensions of the hitbox plane
  const worldWidth = winWidth * PX_TO_WORLD * winScale
  const worldHeight = winHeight * PX_TO_WORLD * winScale

  // Determine content based on agent type
  // isFocused is NOT in deps — AnorakWindowContent reads it as a prop, no need to remount
  const content = useMemo(() => {
    switch (win.agentType) {
      case 'anorak':
        return <AnorakWindowContent windowId={win.id} initialSessionId={win.sessionId} />
      case 'merlin':
        return (
          <div className="flex items-center justify-center h-full text-amber-400 font-mono text-sm">
            🧙 Merlin — coming soon
          </div>
        )
      case 'devcraft':
        return (
          <div className="flex items-center justify-center h-full text-green-400 font-mono text-sm">
            ⚡ DevCraft — coming soon
          </div>
        )
      case 'parzival':
        return <ParzivalWindowContent windowBlur={win.windowBlur ?? 0} />
    }
  }, [win.id, win.agentType, win.sessionId])

  // Border glow colors
  const agentColor = win.agentType === 'anorak' ? '#38bdf8' : win.agentType === 'anorak-pro' ? '#14b8a6' : win.agentType === 'merlin' ? '#f59e0b' : win.agentType === 'parzival' ? '#14b8a6' : '#22c55e'

  // Memoize Html style to prevent drei transform recalculation on child re-renders.
  // Without this, every streaming state update in AnorakContent propagates up,
  // creating a new style object → drei recalculates CSS 3D matrix → visible flicker.
  const windowOpacity = win.windowOpacity ?? 1
  const htmlStyle = useMemo(() => ({
    width: `${winWidth}px`,
    height: `${winHeight}px`,
    borderRadius: '12px',
    overflow: 'hidden' as const,
    opacity: windowOpacity,
  }), [winWidth, winHeight, windowOpacity])

  return (
    <group ref={groupRef}>
      {/* Interactive HTML content in 3D space
          distanceFactor controls perceived size: at distance=distanceFactor, HTML renders 1:1 pixels.
          Closer = bigger, further = smaller. 8 gives good readability at typical viewing distance. */}
      <Html
        transform
        distanceFactor={DISTANCE_FACTOR}
        pointerEvents="auto"
        occlude="blending"
        style={htmlStyle}
        className="agent-window-3d"
      >
        {content}
        {isFocused && <ResizeHandle windowId={win.id} currentWidth={winWidth} currentHeight={winHeight} />}
      </Html>

      {/* ═══ PICTURE FRAME — decorative 3D border around the window ═══ */}
      {win.frameStyle && (() => {
        // Frame dimensions match the Html content in world-space
        const fw = worldWidth
        const fh = worldHeight
        const fs = winScale  // scale factor for frame proportions
        const ft = win.frameThickness ?? 1  // user-controllable thickness multiplier
        return (
          <group position={[0, 0, -0.01]}>
            {win.frameStyle === 'gilded' && (
              <FourBarFrame w={fw} h={fh} border={0.04 * fs * ft} depth={0.02 * fs * ft} color="#8B6914" roughness={0.4} metalness={0.6} />
            )}
            {win.frameStyle === 'neon' && (
              <NeonFrame w={fw} h={fh} scale={fs * ft} />
            )}
            {win.frameStyle === 'thin' && (
              <FourBarFrame w={fw} h={fh} border={0.006 * fs * ft} depth={0.003 * fs * ft} color="#1a1a1a" roughness={0.9} metalness={0.0} />
            )}
            {win.frameStyle === 'baroque' && (
              <>
                <FourBarFrame w={fw} h={fh} border={0.07 * fs * ft} depth={0.035 * fs * ft} color="#5C3A0E" roughness={0.3} metalness={0.7} />
                <FourBarFrame w={fw + 0.01 * fs * ft} h={fh + 0.01 * fs * ft} border={0.015 * fs * ft} depth={0.04 * fs * ft} color="#DAA520" roughness={0.2} metalness={0.9} />
              </>
            )}
            {win.frameStyle === 'hologram' && (
              <HologramFrame w={fw} h={fh} scale={fs * ft} />
            )}
            {win.frameStyle === 'rustic' && (
              <FourBarFrame w={fw} h={fh} border={0.05 * fs * ft} depth={0.025 * fs * ft} color="#3E2723" roughness={0.95} metalness={0.0} />
            )}
            {win.frameStyle === 'ice' && (
              <FourBarFrame w={fw} h={fh} border={0.04 * fs * ft} depth={0.02 * fs * ft} color="#B3E5FC" roughness={0.05} metalness={0.1} transparent opacity={0.6} emissive="#81D4FA" emissiveIntensity={0.3} />
            )}
            {win.frameStyle === 'void' && (
              <VoidFrame w={fw} h={fh} scale={fs * ft} />
            )}
          </group>
        )
      })()}

      {/* Invisible hitbox plane for raycasting — Html transform doesn't participate in R3F raycasts */}
      <mesh>
        <planeGeometry args={[worldWidth, worldHeight]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Selection glow ring on the ground below the window */}
      {isSelected && !isFocused && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -win.position[1] + 0.05, 0]}>
          <ringGeometry args={[1.2 * winScale, 1.5 * winScale, 32]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.4} />
        </mesh>
      )}

      {/* Focus glow when focused — sized to match the Html content */}
      {isFocused && (
        <mesh position={[0, 0, -0.05]}>
          <planeGeometry args={[worldWidth + 0.4, worldHeight + 0.4]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.08} />
        </mesh>
      )}

      {/* "HIT ENTER" prompt when selected but not focused */}
      <FocusPrompt visible={isSelected && !isFocused} />
    </group>
  )
})

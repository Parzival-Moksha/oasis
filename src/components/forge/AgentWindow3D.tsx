'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// AGENT WINDOW 3D — Interactive agent panels placed in the Oasis world
// ─═̷─═̷─ॐ─═̷─═̷─ Full DOM rendered via <Html transform> in true 3D ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useMemo, memo } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentWindow } from '../../store/oasisStore'
import { AnorakWindowContent } from './AnorakWindowContent'

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
// AGENT WINDOW 3D — the R3F component
// ═══════════════════════════════════════════════════════════════════════════

// Scale: maps HTML pixels to world units for the hitbox plane
// distanceFactor on <Html> handles the visual size separately
const PX_TO_WORLD = 0.005

export const AgentWindow3D = memo(function AgentWindow3D({ window: win }: { window: AgentWindow }) {
  const groupRef = useRef<THREE.Group>(null!)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const isSelected = selectedObjectId === win.id
  const isFocused = focusedAgentWindowId === win.id

  // World-space dimensions of the hitbox plane
  const worldWidth = win.width * PX_TO_WORLD * win.scale
  const worldHeight = win.height * PX_TO_WORLD * win.scale

  // Determine content based on agent type
  // isFocused is NOT in deps — AnorakWindowContent reads it as a prop, no need to remount
  const content = useMemo(() => {
    switch (win.agentType) {
      case 'anorak':
        return <AnorakWindowContent windowId={win.id} initialSessionId={win.sessionId} />
      case 'merlin':
        return (
          <div className="flex items-center justify-center h-full text-purple-400 font-mono text-sm">
            🧙 Merlin — coming soon
          </div>
        )
      case 'devcraft':
        return (
          <div className="flex items-center justify-center h-full text-green-400 font-mono text-sm">
            ⚡ DevCraft — coming soon
          </div>
        )
    }
  }, [win.id, win.agentType, win.sessionId])

  // Border glow colors
  const agentColor = win.agentType === 'anorak' ? '#38bdf8' : win.agentType === 'merlin' ? '#a855f7' : '#22c55e'

  return (
    <group ref={groupRef}>
      {/* Interactive HTML content in 3D space
          distanceFactor controls perceived size: at distance=distanceFactor, HTML renders 1:1 pixels.
          Closer = bigger, further = smaller. 8 gives good readability at typical viewing distance. */}
      <Html
        transform
        distanceFactor={8}
        pointerEvents="auto"
        zIndexRange={[0, 0]}
        style={{
          width: `${win.width}px`,
          height: `${win.height}px`,
          borderRadius: '12px',
          overflow: 'hidden',
        }}
        className="agent-window-3d"
      >
        {content}
      </Html>

      {/* Invisible hitbox plane for raycasting — Html transform doesn't participate in R3F raycasts */}
      <mesh>
        <planeGeometry args={[worldWidth, worldHeight]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Selection glow ring on the ground below the window */}
      {isSelected && !isFocused && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -win.position[1] + 0.05, 0]}>
          <ringGeometry args={[worldWidth * 0.4, worldWidth * 0.5, 32]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.4} />
        </mesh>
      )}

      {/* Focus glow when focused */}
      {isFocused && (
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[worldWidth + 0.2, worldHeight + 0.2]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.08} />
        </mesh>
      )}

      {/* "HIT ENTER" prompt when selected but not focused */}
      <FocusPrompt visible={isSelected && !isFocused} />
    </group>
  )
})

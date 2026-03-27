'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// AGENT WINDOW PORTALS — Offscreen DOM containers for 3D agent windows
// ─═̷─═̷─ॐ─═̷─═̷─ Renders OUTSIDE Canvas, feeds textures to R3F ─═̷─═̷─ॐ─═̷─═̷─
// Each agent window's React content is portaled into a hidden container.
// OffscreenUIManager captures it to CanvasTexture for AgentWindow3D.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { memo } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentWindow } from '../../store/oasisStore'
import { OffscreenPortal } from './OffscreenPortal'
import { AnorakWindowContent } from './AnorakWindowContent'
import { ParzivalWindowContent } from './ParzivalWindowContent'

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE WINDOW PORTAL — renders one agent window's content offscreen
// ═══════════════════════════════════════════════════════════════════════════

const WindowPortal = memo(function WindowPortal({ win }: { win: AgentWindow }) {
  const winWidth = win.width || 800
  const winHeight = win.height || 600

  // Determine content based on agent type (mirrors AgentWindow3D's old content useMemo)
  let content: React.ReactNode
  switch (win.agentType) {
    case 'anorak':
      content = <AnorakWindowContent windowId={win.id} initialSessionId={win.sessionId} />
      break
    case 'merlin':
      content = (
        <div className="flex items-center justify-center h-full text-amber-400 font-mono text-sm"
          style={{ width: `${winWidth}px`, height: `${winHeight}px` }}>
          Merlin — coming soon
        </div>
      )
      break
    case 'devcraft':
      content = (
        <div className="flex items-center justify-center h-full text-green-400 font-mono text-sm"
          style={{ width: `${winWidth}px`, height: `${winHeight}px` }}>
          DevCraft — coming soon
        </div>
      )
      break
    case 'parzival':
      content = <ParzivalWindowContent windowBlur={win.windowBlur ?? 0} />
      break
    case 'anorak-pro':
      content = (
        <div className="flex items-center justify-center h-full text-teal-400 font-mono text-sm"
          style={{ width: `${winWidth}px`, height: `${winHeight}px` }}>
          Anorak Pro — use 2D panel for full experience
        </div>
      )
      break
    default:
      content = null
  }

  return (
    <OffscreenPortal windowId={win.id} width={winWidth} height={winHeight} agentType={win.agentType}>
      <div style={{ width: `${winWidth}px`, height: `${winHeight}px`, overflow: 'hidden' }}>
        {content}
      </div>
    </OffscreenPortal>
  )
}, (prev, next) => {
  const a = prev.win, b = next.win
  return a.id === b.id && a.agentType === b.agentType && a.width === b.width
    && a.height === b.height && a.sessionId === b.sessionId && a.windowBlur === b.windowBlur
})

// ═══════════════════════════════════════════════════════════════════════════
// AGENT WINDOW PORTALS — renders all agent window content offscreen
// Mount this OUTSIDE the R3F Canvas but INSIDE SettingsContext.Provider
// ═══════════════════════════════════════════════════════════════════════════

export function AgentWindowPortals() {
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)

  if (placedAgentWindows.length === 0) return null

  return (
    <>
      {placedAgentWindows.map(win => (
        <WindowPortal key={win.id} win={win} />
      ))}
    </>
  )
}

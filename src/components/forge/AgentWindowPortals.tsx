'use client'

// â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘
// AGENT WINDOW PORTALS â€” Offscreen DOM containers for 3D agent windows
// â”€â•Ì·â”€â•Ì·â”€à¥â”€â•Ì·â”€â•Ì·â”€ Renders OUTSIDE Canvas, feeds textures to R3F â”€â•Ì·â”€â•Ì·â”€à¥â”€â•Ì·â”€â•Ì·â”€
// Each hybrid-rendered agent window's React content is portaled into a hidden container.
// OffscreenUIManager captures it to CanvasTexture for AgentWindow3D.
// â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘

import { memo } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentWindow } from '../../store/oasisStore'
import { resolveAgentWindowRenderMode, isHybridAgentWindowRenderMode } from '../../lib/agent-window-renderers'
import { OffscreenPortal } from './OffscreenPortal'
import { AgentWindowSurface } from './AgentWindowSurface'

const WindowPortal = memo(function WindowPortal({ win }: { win: AgentWindow }) {
  const winWidth = win.width || 800
  const winHeight = win.height || 600
  const renderMode = resolveAgentWindowRenderMode(win.renderMode)

  if (!isHybridAgentWindowRenderMode(renderMode)) return null

  return (
    <OffscreenPortal
      windowId={win.id}
      width={winWidth}
      height={winHeight}
      agentType={win.agentType}
      captureMode={renderMode === 'hybrid-foreign-object' ? 'foreign-object' : 'snapdom'}
    >
      <div style={{ width: `${winWidth}px`, height: `${winHeight}px`, overflow: 'hidden' }}>
        <AgentWindowSurface win={win} />
      </div>
    </OffscreenPortal>
  )
}, (prev, next) => {
  const a = prev.win
  const b = next.win
  return a.id === b.id
    && a.agentType === b.agentType
    && a.width === b.width
    && a.height === b.height
    && a.sessionId === b.sessionId
    && a.windowBlur === b.windowBlur
    && a.windowOpacity === b.windowOpacity
    && a.renderMode === b.renderMode
    && a.browserSurfaceMode === b.browserSurfaceMode
    && a.surfaceUrl === b.surfaceUrl
    && a.captureSourceId === b.captureSourceId
    && a.captureSourceName === b.captureSourceName
    && a.captureFps === b.captureFps
})

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

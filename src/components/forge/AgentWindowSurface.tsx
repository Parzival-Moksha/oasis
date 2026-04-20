'use client'

import { memo } from 'react'
import type { AgentWindow } from '../../store/oasisStore'
import { resolveAgentWindowRenderMode } from '../../lib/agent-window-renderers'
import { AnorakWindowContent } from './AnorakWindowContent'
import { AnorakProPanel } from './AnorakProPanel'
import { BrowserWindowContent } from './BrowserWindowContent'
import { HermesPanel } from './HermesPanel'
import { MerlinPanel } from './MerlinPanel'
import { OpenclawPanel } from './OpenclawPanel'
import { ParzivalWindowContent } from './ParzivalWindowContent'

export const AgentWindowSurface = memo(function AgentWindowSurface({ win }: { win: AgentWindow }) {
  const winWidth = win.width || 800
  const winHeight = win.height || 600
  const windowOpacity = win.windowOpacity ?? 1
  const renderMode = resolveAgentWindowRenderMode(win.renderMode)
  const isLiveHtml = renderMode === 'live-html'

  let content: React.ReactNode
  switch (win.agentType) {
    case 'anorak':
      content = <AnorakWindowContent windowId={win.id} initialSessionId={win.sessionId} windowBlur={win.windowBlur ?? 0} />
      break
    case 'anorak-pro':
      content = <AnorakProPanel isOpen embedded hideCloseButton onClose={() => {}} />
      break
    case 'parzival':
      content = <ParzivalWindowContent windowBlur={win.windowBlur ?? 0} />
      break
    case 'browser':
      content = <BrowserWindowContent win={win} />
      break
    case 'hermes':
      content = <HermesPanel isOpen embedded hideCloseButton onClose={() => {}} />
      break
    case 'openclaw':
      content = <OpenclawPanel isOpen embedded hideCloseButton onClose={() => {}} />
      break
    case 'merlin':
      content = <MerlinPanel isOpen embedded hideCloseButton onClose={() => {}} />
      break
    case 'devcraft':
      content = (
        <div className="flex items-center justify-center h-full text-green-400 font-mono text-sm">
          DevCraft - coming soon
        </div>
      )
      break
    default:
      content = (
        <div className="flex items-center justify-center h-full text-sky-300 font-mono text-sm">
          Agent window surface unavailable
        </div>
      )
  }

  return (
    <div
      style={{
        width: `${winWidth}px`,
        height: `${winHeight}px`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {content}
      {isLiveHtml && windowOpacity < 1 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `rgba(0, 0, 0, ${Math.max(0, 1 - windowOpacity)})`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
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

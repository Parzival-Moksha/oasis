'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK WINDOW CONTENT — 3D window chrome for Claude Code Agent
// ─═̷─═̷─ॐ─═̷─═̷─ Thin wrapper. Content lives in AnorakContent. ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { MODELS } from '../../lib/anorak-engine'
import { AnorakContent } from './AnorakContent'

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK WINDOW CONTENT — the 3D wrapper
// ═══════════════════════════════════════════════════════════════════════════

export function AnorakWindowContent({ windowId, initialSessionId }: {
  windowId: string
  initialSessionId?: string
}) {
  // Read focus state directly from store — avoids parent rememo on focus change
  const isFocused = useOasisStore(s => s.focusedAgentWindowId === windowId)

  // State synced from AnorakContent via callbacks
  const [isStreaming, setIsStreaming] = useState(false)
  const [model, setModel] = useState('opus')
  const [totalCost, setTotalCost] = useState(0)
  const [sessionId, setSessionId] = useState(initialSessionId || '')

  const modelColor = MODELS.find(m => m.id === model)?.color || '#a855f7'

  return (
    <div
      className="flex flex-col w-full h-full rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'rgba(8, 10, 15, 0.95)',
        border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.6)' : 'rgba(56,189,248,0.2)'}`,
        boxShadow: isStreaming
          ? '0 0 40px rgba(56,189,248,0.2), inset 0 0 60px rgba(56,189,248,0.03)'
          : '0 8px 40px rgba(0,0,0,0.8)',
      }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation()
        const store = useOasisStore.getState()
        if (store.selectedObjectId !== windowId) {
          store.selectObject(windowId)
          store.setInspectedObject(windowId)
        }
      }}
    >
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 select-none"
        style={{ background: isStreaming ? 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, transparent 100%)' : 'rgba(20,20,30,0.5)' }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isStreaming ? 'animate-pulse' : ''}`}>💻</span>
          <span className="text-sky-400 font-bold text-xs tracking-wide">Anorak</span>
          {sessionId && <span className="text-[8px] text-gray-600 font-mono">{sessionId.slice(0, 8)}</span>}
          {isStreaming && <span className="text-[9px] text-sky-300 animate-pulse font-mono">● working</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select value={model} onChange={e => setModel(e.target.value)} disabled={isStreaming}
            className="text-[9px] font-mono px-1 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none"
            style={{ color: modelColor }}
          >
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {totalCost > 0 && <span className="text-[8px] text-gray-500 font-mono">${totalCost.toFixed(3)}</span>}
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <AnorakContent
        compact
        model={model}
        initialSessionId={initialSessionId}
        windowId={windowId}
        isFocused={isFocused}
        onStreamingChange={setIsStreaming}
        onModelChange={setModel}
        onCostChange={setTotalCost}
        onSessionChange={setSessionId}
      />
    </div>
  )
}

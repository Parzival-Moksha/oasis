'use client'

import { useEffect, useState } from 'react'
import { getWorldLoadState, subscribeWorldLoad, type WorldLoadState } from '../../lib/world-load-progress'

export function WorldLoadingBar() {
  const [state, setState] = useState<WorldLoadState>(() => getWorldLoadState())

  useEffect(() => subscribeWorldLoad(setState), [])

  if (!state.isLoading && state.progress >= 1) return null

  const exactSmallLoad = state.total > 0 && state.total < 25
  const estimatedTotal = exactSmallLoad
    ? Math.max(state.total, state.loaded)
    : Math.max(100, state.total, state.loaded)
  const pct = state.total > 0
    ? Math.max(0, Math.min(1, state.loaded / estimatedTotal))
    : Math.max(0, Math.min(0.95, state.progress))
  const counter = state.total > 0 ? `${state.loaded}/${estimatedTotal}` : '...'

  return (
    <div
      data-world-loading-bar=""
      data-world-loading-progress={pct.toFixed(3)}
      className="fixed bottom-0 left-0 right-0 z-[240] pointer-events-none"
    >
      <div className="h-[4px] bg-black/40 backdrop-blur-sm overflow-hidden">
        <div
          className="h-full transition-[width] duration-150 ease-out"
          style={{
            width: `${pct * 100}%`,
            background: 'linear-gradient(90deg, rgba(34,211,238,0.8) 0%, rgba(167,139,250,0.95) 50%, rgba(244,114,182,0.85) 100%)',
            boxShadow: '0 0 10px rgba(167,139,250,0.65), 0 0 20px rgba(34,211,238,0.45)',
          }}
        />
      </div>
      <div
        className="absolute bottom-2 left-3 text-[10px] font-mono text-cyan-200/80 px-2 py-0.5 rounded bg-black/65 backdrop-blur-sm border border-cyan-400/20 whitespace-nowrap select-none"
      >
        Loading {counter} - {(pct * 100).toFixed(0)}%
      </div>
    </div>
  )
}

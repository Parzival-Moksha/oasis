'use client'

// ░▒▓ VILLAGE HUD — engine status, the roster as chips, "E talk" / "N next" hints ▓▒░

import { useEffect, useState } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { selectAttentionQueue } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { focusVillageAgent, openVillagePicker } from './village-actions'
import { VILLAGE_OBSERVED_COLOR, statusColor } from './village-status'

interface ChipInfo {
  id: string
  name: string
  status: string
  unseen: boolean
  observed: boolean
}

const MAX_CHIPS = 9

function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(timer)
  }, [active, everyMs])
  return now
}

function EngineStatus() {
  const connection = useOasisStore(s => s.agentEngine.connection)
  const rate = useOasisStore(s => s.agentEngine.rateLimit)
  const now = useNow(connection.status === 'offline')
  if (connection.status === 'open') {
    const quota = typeof rate?.utilization === 'number' ? ` · 7-day ${Math.round(rate.utilization * 100)}%` : ''
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-100/85" title="Agent engine connected (ws://127.0.0.1:4530)">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
        <span className="max-[700px]:hidden">engine{quota}</span>
      </span>
    )
  }
  const retryIn = connection.nextRetryAt ? Math.max(0, Math.ceil((connection.nextRetryAt - now) / 1000)) : null
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-100" title={connection.error || 'agent engine not reachable'}>
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {connection.status === 'connecting' ? 'connecting to engine…' : 'engine offline'}
      {connection.status === 'offline' && (
        <>
          <span className="normal-case tracking-normal text-amber-100/70 max-[700px]:hidden">run <code className="rounded bg-black/40 px-1">pnpm dev:engine</code>{retryIn !== null ? ` · retry in ${retryIn}s` : ''}</span>
          <button type="button" className="rounded bg-amber-300/20 px-1.5 py-0.5 text-[9px] hover:bg-amber-300/35" onClick={() => getAgentEngineClient().retryNow()}>retry</button>
        </>
      )}
    </span>
  )
}

export function VillageHud() {
  const chipsKey = useOasisStore(s => s.agentEngine.order.map(id => {
    const agent = s.agentEngine.agents[id]
    if (!agent) return ''
    return [id, agent.name, agent.status, agent.unseen ? 1 : 0, agent.kind].join('\u0001')
  }).filter(Boolean).join('\u0002'))
  const attentionKey = useOasisStore(s => selectAttentionQueue(s.agentEngine).join(','))
  const focusedId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const nearbyId = useOasisStore(s => s.agentEngine.nearbyAgentId)
  const nearbyName = useOasisStore(s => (s.agentEngine.nearbyAgentId ? s.agentEngine.agents[s.agentEngine.nearbyAgentId]?.name : null))
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')

  const chips: ChipInfo[] = chipsKey ? chipsKey.split('\u0002').map(item => {
    const [id, name, status, unseen, kind] = item.split('\u0001')
    return { id, name, status, unseen: unseen === '1', observed: kind !== 'owned' }
  }) : []
  const attention = attentionKey ? attentionKey.split(',') : []
  const shown = chips.slice(0, MAX_CHIPS)

  return (
    <>
      <div
        data-ui-panel="village-hud"
        className="fixed left-1/2 top-3 z-[180] flex max-w-[min(820px,calc(100vw-400px))] -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/75 px-2 py-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md max-[700px]:left-[84px] max-[700px]:right-2 max-[700px]:top-2 max-[700px]:max-w-none max-[700px]:translate-x-0 max-[700px]:flex-wrap"
      >
        <span className="shrink-0 pl-1 pr-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/90 max-[700px]:hidden">Village</span>
        <EngineStatus />
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {shown.map(chip => {
            const color = statusColor(chip.status)
            const needs = attention.includes(chip.id)
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => focusVillageAgent(chip.id)}
                title={`${chip.name}: ${chip.status}${chip.observed ? ' (observed, read-only)' : ''}`}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold transition hover:bg-white/10 ${focusedId === chip.id ? 'bg-white/15' : 'bg-black/30'}`}
                style={{ borderColor: chip.observed ? `${VILLAGE_OBSERVED_COLOR}88` : `${color}66` }}
              >
                <span className={`h-2 w-2 rounded-full ${needs ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                <span className="max-w-[110px] truncate">{chip.name}</span>
                {chip.observed && <span className="text-[9px] font-normal text-cyan-200/80">obs</span>}
              </button>
            )
          })}
          {chips.length > shown.length && <span className="shrink-0 px-1 text-[10px] text-white/50">+{chips.length - shown.length}</span>}
        </div>
        {attention.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-100" title="N jumps to the next agent that needs you">
            <span className="mr-1 rounded bg-black/40 px-1 font-mono">N</span>{attention.length} need{attention.length === 1 ? 's' : ''} you
          </span>
        )}
        <button
          type="button"
          disabled={!connected}
          onClick={() => openVillagePicker(true)}
          className="shrink-0 rounded-md border border-emerald-300/40 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-black text-emerald-50 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-40"
          title={connected ? 'Summon a Claude Code session as an agent' : 'Start the agent engine first: pnpm dev:engine'}
        >
          + Summon
        </button>
      </div>

      {nearbyId && !focusedId && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[170] -translate-x-1/2 rounded-lg border border-white/15 bg-slate-950/85 px-3 py-2 text-[12px] font-bold text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur max-[700px]:bottom-28">
          <span className="mr-2 rounded bg-white/20 px-1.5 py-0.5 font-mono">E</span>
          Talk to {nearbyName || 'agent'}
        </div>
      )}
    </>
  )
}

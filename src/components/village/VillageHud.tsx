'use client'

// ░▒▓ VILLAGE HUD — engine status, summon, the Agents menu (VillageAgentsMenu), "T talk" / "N next" hints ▓▒░

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { selectAttentionQueue } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { isInVillagePlaza, openVillagePicker, subscribeVillagePlaza } from './village-actions'
import { isVillageSoundOn, setVillageSoundOn, subscribeVillageSound } from './village-sound'
import { VillageAgentsMenu } from './VillageAgentsMenu'
import { GAME_HUD_TEXT, GameKeycap } from '../forge/GameKeycap'

/** Bottom-centre game prompt: a chamfered banner, a title, and key prompts in a row. */
export function PromptBanner({ accent, title, children }: { accent: string; title: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed bottom-7 left-1/2 z-[170] -translate-x-1/2 max-[700px]:bottom-28" style={{ filter: `drop-shadow(0 8px 18px rgba(0,0,0,0.55)) drop-shadow(0 0 14px ${accent}33)` }}>
      <div
        className="relative px-7 pb-2.5 pt-1.5"
        style={{
          clipPath: 'polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%)',
          background: `linear-gradient(180deg, rgba(2,6,23,0.9), rgba(15,23,42,0.78) 60%, ${accent}22)`,
        }}
      >
        <span className="absolute inset-x-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
        <span className="absolute inset-x-10 bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}88, transparent)` }} />
        <div className="mb-1.5 max-w-[320px] truncate text-center text-[10px]" style={{ ...GAME_HUD_TEXT, color: accent, letterSpacing: '0.26em' }}>{title}</div>
        <div className="flex items-center justify-center gap-5">{children}</div>
      </div>
    </div>
  )
}

export function KeyPrompt({ k, label, accent, primary = false, className = '' }: { k: string; label: string; accent: string; primary?: boolean; className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <GameKeycap size="md" accent={accent} pulse={primary}>{k}</GameKeycap>
      <span className={primary ? 'text-[13px]' : 'text-[11.5px]'} style={{ ...GAME_HUD_TEXT, opacity: primary ? 1 : 0.88 }}>{label}</span>
    </span>
  )
}

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
  const attentionKey = useOasisStore(s => selectAttentionQueue(s.agentEngine).join(','))
  const focusedId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const nearbyId = useOasisStore(s => s.agentEngine.nearbyAgentId)
  const nearbyName = useOasisStore(s => (s.agentEngine.nearbyAgentId ? s.agentEngine.agents[s.agentEngine.nearbyAgentId]?.name : null))
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')
  const inPlaza = useSyncExternalStore(subscribeVillagePlaza, isInVillagePlaza, () => false)
  const soundOn = useSyncExternalStore(subscribeVillageSound, isVillageSoundOn, () => true)

  const attention = attentionKey ? attentionKey.split(',') : []

  return (
    <>
      {/* The roster lives in the Agents menu on the left: full names, status, model and thinking. */}
      <VillageAgentsMenu />
      <div
        data-ui-panel="village-hud"
        className="fixed left-1/2 top-3 z-[180] flex max-w-[min(820px,calc(100vw-400px))] -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/75 px-2 py-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md max-[700px]:left-[84px] max-[700px]:right-2 max-[700px]:top-2 max-[700px]:max-w-none max-[700px]:translate-x-0 max-[700px]:flex-wrap"
      >
        <span className="shrink-0 pl-1 pr-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/90 max-[700px]:hidden">Village</span>
        <EngineStatus />
        {attention.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-100" title="N jumps to the next agent that needs you">
            <span className="mr-1 rounded bg-black/40 px-1 font-mono">N</span>{attention.length} need{attention.length === 1 ? 's' : ''} you
          </span>
        )}
        <button
          type="button"
          onClick={() => setVillageSoundOn(!soundOn)}
          className="shrink-0 rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[12px] leading-none transition hover:bg-white/10"
          title={soundOn ? 'A chime plays when an agent needs you (click to mute)' : 'Muted: click for a chime when an agent needs you'}
          aria-label={soundOn ? 'Mute agent chimes' : 'Unmute agent chimes'}
        >
          {soundOn ? '🔔' : '🔕'}
        </button>
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
        <PromptBanner accent="#34d399" title={nearbyName || 'agent'}>
          <KeyPrompt k="T" label="Talk" accent="#34d399" primary />
          <KeyPrompt k="E" label="Write" accent="#38bdf8" className="max-[700px]:hidden" />
          <KeyPrompt k="F" label="Fullscreen" accent="#c084fc" className="max-[700px]:hidden" />
        </PromptBanner>
      )}

      {inPlaza && !nearbyId && !focusedId && (
        <PromptBanner accent="#fbbf24" title="Summoning circle">
          <KeyPrompt k="E" label="Summon an agent" accent="#fbbf24" primary />
        </PromptBanner>
      )}
    </>
  )
}

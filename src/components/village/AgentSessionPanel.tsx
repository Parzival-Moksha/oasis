'use client'

// ░▒▓ AGENT SESSION PANEL — the focused agent's session view + composer ▓▒░
// Opens when an agent is focused (E, click, N, roster chip). Right side on desktop, bottom sheet
// on phones. Typing never reaches the world: keydown stops here, keyup still bubbles so no
// movement key can get stuck (the WASD-stuck bug class).

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useUILayer } from '../../lib/input-manager'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'
import { AgentSessionView, StatusPill } from './AgentSessionView'
import { VILLAGE_SESSION_LAYER, getSessionPanelGeometry, leaveVillageFocus } from './village-actions'
import { agentDisplayName, cwdLabel, formatCost, modelLabel, statusColor, statusLabel } from './village-status'

const FALLBACK_MODELS = [
  { value: 'default', displayName: 'Default' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' },
]
const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']
const MOVEMENT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'])

function useViewport() {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Composer({ agentId }: { agentId: string }) {
  const status = useOasisStore(s => s.agentEngine.agents[agentId]?.status || 'idle')
  const pendingUser = useOasisStore(s => s.agentEngine.agents[agentId]?.pendingUser || 0)
  const [text, setText] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusedAtRef = useRef(0)
  const working = status === 'working' || status === 'needs-decision'

  // Focus the composer right after the agent is focused (after the E keydown has finished).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true })
      focusedAtRef.current = performance.now()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [agentId])

  const send = () => {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    getAgentEngineClient()
      .send(agentId, message, urgent ? 'now' : undefined)
      .then(() => {
        setText('')
        setUrgent(false)
      })
      .catch(error => showNotice(`Send failed: ${describeError(error)}`, 'error'))
      .finally(() => setSending(false))
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Never let typing reach KeyboardControls / world shortcuts. keyup is left alone on purpose.
    event.stopPropagation()
    // A movement key still held from walking up to the desk auto-repeats into the box: drop it.
    if (event.repeat && MOVEMENT_CODES.has(event.nativeEvent.code) && performance.now() - focusedAtRef.current < 1500) {
      event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // First Esc leaves the text box (N works again), the next one leaves the agent.
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 pt-2">
      <textarea
        ref={textareaRef}
        value={text}
        rows={3}
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={working ? 'Talk to it while it works: folds into the running turn…' : 'Message…'}
        className="min-h-[64px] w-full resize-none rounded-lg border border-white/15 bg-black/45 px-2.5 py-2 text-[13px] leading-snug text-white placeholder:text-white/30 focus:border-emerald-300/50 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-white/55" title='priority "now": stop at the next model request and answer this'>
          <input type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)} className="accent-amber-400" />
          urgent
        </label>
        <div className="flex items-center gap-1.5">
          {pendingUser > 0 && <span className="text-[10px] text-white/45">{pendingUser} queued</span>}
          <button
            type="button"
            disabled={!working}
            onClick={() => getAgentEngineClient().interrupt(agentId).catch(error => showNotice(`Interrupt failed: ${describeError(error)}`, 'error'))}
            className="rounded-md border border-rose-300/35 bg-rose-400/10 px-2.5 py-1 text-[11px] font-bold text-rose-100 transition hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-35"
          >
            interrupt
          </button>
          <button
            type="button"
            disabled={!text.trim() || sending}
            onClick={send}
            className="rounded-md border border-emerald-300/40 bg-emerald-400/20 px-3 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-emerald-50 transition hover:bg-emerald-400/35 disabled:cursor-not-allowed disabled:opacity-35"
          >
            send
          </button>
        </div>
      </div>
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-white/30 max-[700px]:hidden">Enter send · Shift+Enter newline · Esc leave box, Esc again back to the world · N next agent</div>
    </div>
  )
}

export function AgentSessionPanel() {
  const agentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const agent = useOasisStore(s => (s.agentEngine.focusedAgentId ? s.agentEngine.agents[s.agentEngine.focusedAgentId] : undefined))
  const zIndex = useOasisStore(s => s.getPanelZIndex('village-session', 9400))
  const bringToFront = useOasisStore(s => s.bringPanelToFront)
  const viewport = useViewport()
  useUILayer(VILLAGE_SESSION_LAYER, Boolean(agentId))
  const [busy, setBusy] = useState(false)

  if (!agentId || !agent) return null
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const color = statusColor(agent.status)
  const models = agent.models?.length ? agent.models : FALLBACK_MODELS
  const currentModel = agent.model || 'default'
  const style = geometry.side === 'right'
    ? { top: geometry.margin, right: geometry.margin, bottom: geometry.margin, width: geometry.width, zIndex }
    : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height, zIndex }

  const dismiss = () => {
    const owned = agent.owned
    const label = agentDisplayName(agent)
    if (owned && !window.confirm(`Dismiss ${label}?\n\nThis stops its Claude Code process and removes it from the village. The session transcript stays on disk; summon it again from the picker to resume.`)) return
    setBusy(true)
    const client = getAgentEngineClient()
    const action = owned ? client.kill(agent.id) : client.unobserve(agent.id)
    action
      .then(() => leaveVillageFocus())
      .catch(error => showNotice(`${owned ? 'Dismiss' : 'Unobserve'} failed: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div
      data-ui-panel="village-session"
      className="fixed flex flex-col gap-2 rounded-xl border bg-slate-950/95 p-3 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      style={{ ...style, borderColor: `${color}88` }}
      onPointerDown={() => bringToFront('village-session')}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            <span className="truncate text-[15px] font-black tracking-wide">{agentDisplayName(agent)}</span>
            <StatusPill status={agent.status} label={agent.readOnly ? `${statusLabel(agent)} · read-only` : statusLabel(agent)} />
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-white/45" title={`${agent.cwd || ''}\nsession ${agent.sessionId || '?'}`}>
            {cwdLabel(agent.cwd) || 'unknown folder'} · {agent.sessionId ? agent.sessionId.slice(0, 8) : 'new session'}
            {agent.statusReason ? ` · ${agent.statusReason}` : ''}
            {agent.usage.sessionCostUsd > 0 ? ` · ${formatCost(agent.usage.sessionCostUsd)} here` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={dismiss}
            title={agent.owned ? 'Stop this agent and remove it from the village' : 'Stop observing'}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white/70 transition hover:bg-rose-400/20 hover:text-rose-100"
          >
            {agent.owned ? 'dismiss' : 'unobserve'}
          </button>
          <button
            type="button"
            onClick={() => leaveVillageFocus()}
            title="Back to the world (Esc)"
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12px] font-bold text-white/70 transition hover:bg-white/15"
          >
            ✕
          </button>
        </div>
      </div>

      {agent.owned && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10.5px] text-white/60">
          <label className="flex items-center gap-1">
            model
            <select
              value={models.some(m => m.value === currentModel) ? currentModel : '__current'}
              onChange={event => {
                const model = event.target.value
                if (!model || model === '__current') return
                getAgentEngineClient().setModel(agent.id, model).catch(error => showNotice(`Model switch failed: ${describeError(error)}`, 'error'))
              }}
              onKeyDown={event => event.stopPropagation()}
              className="max-w-[150px] rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11px] text-white"
            >
              {!models.some(m => m.value === currentModel) && <option value="__current">{modelLabel(agent)}</option>}
              {models.map(model => <option key={model.value} value={model.value}>{model.displayName || model.value}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            mode
            <select
              value={agent.permissionMode || ''}
              onChange={event => {
                const mode = event.target.value
                if (!mode) return
                getAgentEngineClient().setPermissionMode(agent.id, mode).catch(error => showNotice(`Mode switch failed: ${describeError(error)}`, 'error'))
              }}
              onKeyDown={event => event.stopPropagation()}
              className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11px] text-white"
            >
              <option value="">{`settings (${agent.effectivePermissionMode || '?'})`}</option>
              {PERMISSION_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
          <span className="ml-auto truncate text-white/40">{modelLabel(agent)}</span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <AgentSessionView agentId={agent.id} variant="2d" />
      </div>

      {agent.owned ? (
        agent.alive || agent.status !== 'error' ? <Composer agentId={agent.id} /> : (
          <div className="shrink-0 border-t border-white/10 pt-2 text-[11.5px] text-rose-100/80">
            The process stopped. Sending a message restarts it.
            <Composer agentId={agent.id} />
          </div>
        )
      ) : (
        <div className="shrink-0 border-t border-white/10 pt-2 text-[11.5px] leading-snug text-cyan-100/70">
          Read-only: this session runs somewhere else (desktop app, terminal). Answer prompts there, or summon it
          as an agent from the picker once it is closed.
        </div>
      )}
    </div>
  )
}

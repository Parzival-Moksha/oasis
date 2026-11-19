'use client'

// ░▒▓ AGENT SESSION PANEL — the focused agent's session view + composer ▓▒░
// Opens when an agent is focused (E, click, N, roster chip). Right side on desktop, bottom sheet
// on phones. Typing never reaches the world: keydown stops here, keyup still bubbles so no
// movement key can get stuck (the WASD-stuck bug class).

import { useEffect, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { CUSTOM_MODEL_VALUE, cleanModelId, mergeModelLists, type ModelOption } from '../../lib/village/village-models'
import { useOasisStore } from '../../store/oasisStore'
import { useUILayer } from '../../lib/input-manager'
import { effectiveStatus } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'
import { AgentSessionView, StatusPill } from './AgentSessionView'
import {
  VILLAGE_SESSION_LAYER,
  focusVillageAgent,
  getSessionPanelGeometry,
  getSessionPanelWidth,
  getVillageScreen,
  leaveVillageFocus,
  sessionPanelMaxWidth,
  setSessionPanelWidth,
  subscribeSessionPanelWidth,
  subscribeVillageScreen,
  toggleVillageScreen,
} from './village-actions'
import { VillageComposer } from './VillageComposer'
import { EffortSelect } from './EffortSelect'
import { AccountSelect } from './AccountSelect'
import { EyesToggle } from './EyesToggle'
import { ChromeToggle } from './ChromeToggle'
import { FollowToggle, VoiceToggle } from './CompanionToggles'
import { AgentSettingsButton } from './AgentSettingsMenu'
import { AcademyTrainToggle } from './VillageAcademyTrainee'
import { usePanelLook } from './PanelLook'
import { dismissVillageAgent } from './village-leave'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS, agentDisplayName, canTalkTo, cwdLabel, formatCost, modelLabel, statusColor, statusLabel } from './village-status'

const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']
/** A Hermes agent's modes (ACP session/set_mode): ask before edits, allow workspace edits, allow edits except sensitive paths. */
const HERMES_MODES = ['default', 'accept_edits', 'dont_ask']

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

/**
 * Watching a session that runs somewhere else. "Move it here" makes it yours: the same session, not a copy.
 * If it is still open elsewhere (the desktop app, a terminal), the engine stops that idle process first; when the
 * owner types there again, the engine lets go and the Oasis goes back to watching.
 */
function ObservedFooter({ agentId }: { agentId: string }) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  const [busy, setBusy] = useState(false)
  if (!agent) return null
  const takeOver = async () => {
    if (!agent.cwd || !agent.sessionId) {
      showNotice('This session has no folder or id to resume from.', 'error')
      return
    }
    setBusy(true)
    const client = getAgentEngineClient()
    try {
      const live = await client.listLive().catch(() => [])
      const openElsewhere = live.some(entry => entry.sessionId === agent.sessionId)
      if (openElsewhere && !window.confirm(
        `Move "${agentDisplayName(agent)}" here?

` +
        'Same conversation, not a copy. It is open in the desktop app or a terminal, so that window stops holding it. ' +
        'When you type there again, it moves back and the Oasis goes to watching. ' +
        'The desktop app may only show what you said here after you reopen the session there.',
      )) return
      const spawned = await client.spawnAgent({ name: agentDisplayName(agent).slice(0, 32), cwd: agent.cwd, sessionId: agent.sessionId, move: openElsewhere })
      await client.unobserve(agent.id).catch(() => {})
      focusVillageAgent(spawned.id)
    } catch (error) {
      showNotice(`Could not move it here: ${describeError(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 pt-2 text-[11.5px] leading-snug text-cyan-100/90">
      <div>
        Watching only: this session runs somewhere else (desktop app, terminal), so you can read along but not type here.
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => { void takeOver() }}
        className="self-start rounded-md border border-emerald-300/45 bg-emerald-400/20 px-3 py-1 text-[11.5px] font-black text-emerald-50 transition hover:bg-emerald-400/35 disabled:opacity-40"
      >
        {busy ? 'moving it here…' : 'Move it here'}
      </button>
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
  const screenAgentId = useSyncExternalStore(subscribeVillageScreen, getVillageScreen, () => null)
  // The remembered width (the owner drags the left edge); geometry reads it, this re-renders on a change.
  useSyncExternalStore(subscribeSessionPanelWidth, getSessionPanelWidth, () => null)
  // Every agent's model list merged (village-models.ts): an agent started before a release still offers the new model.
  const mergedModelsKey = useOasisStore(s => JSON.stringify(mergeModelLists(Object.values(s.agentEngine.agents).map(a => a.models))))
  const mergedModels = useMemo(() => JSON.parse(mergedModelsKey) as ModelOption[], [mergedModelsKey])
  // Transparency + blur for all agent chats, this agent's colour (PanelLook.tsx).
  const { accent: panelAccent, ...panelLook } = usePanelLook(agent?.sessionId || agentId || '')

  // F: the agent's own screen took over (camera + composer in the world); the layer above stays pushed.
  if (!agentId || !agent || screenAgentId === agentId) return null
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const shownStatus = effectiveStatus(agent)
  const color = statusColor(shownStatus)
  const models = mergeModelLists([agent.models, mergedModels])
  const currentModel = agent.model || 'default'
  const style = geometry.side === 'right'
    ? { top: geometry.margin, right: geometry.margin, bottom: geometry.margin, width: geometry.width, zIndex }
    : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height, zIndex }

  const composer = <VillageComposer key={agent.id} agentId={agent.id} containerHeight={geometry.height} />

  // Asks in the village's dialog, plays its leaving effect, then stops it (village-leave.ts; Delete does the same).
  const dismiss = () => {
    setBusy(true)
    void dismissVillageAgent(agent.id, () => leaveVillageFocus()).finally(() => setBusy(false))
  }

  // Drag the left edge: wider to the left (remembered); double-click: the automatic width again.
  const startWidthDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = geometry.width
    const max = sessionPanelMaxWidth(viewport.width)
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => setSessionPanelWidth(Math.min(max, startWidth + (startX - move.clientX)))
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      data-ui-panel="village-session"
      className={`fixed flex flex-col gap-2 rounded-xl border bg-slate-950/95 p-3 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl ${VILLAGE_TYPE_CLASS}`}
      style={{ ...style, ...panelLook, borderColor: `${color}88`, boxShadow: `inset 0 3px 0 ${panelAccent}, 0 24px 70px rgba(0,0,0,0.55)`, fontFamily: VILLAGE_FONT_BODY }}
      onPointerDown={() => bringToFront('village-session')}
    >
      {geometry.side === 'right' && (
        <div
          onPointerDown={startWidthDrag}
          onDoubleClick={() => setSessionPanelWidth(null)}
          title="Drag to make the panel wider or narrower (double-click: automatic)"
          className="group absolute -left-1.5 bottom-6 top-6 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center"
        >
          <span className="h-16 w-1 rounded-full bg-white/15 transition group-hover:bg-white/50" />
        </div>
      )}
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            <span className="min-w-0 break-words text-[17px] font-bold leading-tight tracking-wide" style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{agentDisplayName(agent)}</span>
            <StatusPill
              status={shownStatus}
              label={`${statusLabel({ status: shownStatus, unseen: agent.unseen, parked: agent.parked })}${agent.bridged ? ' · desktop app' : agent.readOnly ? ' · read-only' : ''}`}
            />
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-white/70" title={`${agent.cwd || ''}\nsession ${agent.sessionId || '?'}`}>
            {cwdLabel(agent.cwd) || 'unknown folder'} · {agent.sessionId ? agent.sessionId.slice(0, 8) : 'new session'}
            {agent.statusReason ? ` · ${agent.statusReason}` : ''}
            {agent.usage.sessionCostUsd > 0 ? ` · ${formatCost(agent.usage.sessionCostUsd)} here` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* One settings menu per agent: voice and speed, avatar, colour, and the look of all chats. */}
          <AgentSettingsButton agent={agent} />
          {/* Watched sessions have no settings row: their Follow me switch sits here. */}
          {!agent.owned && <FollowToggle agent={agent} />}
          <button
            type="button"
            disabled={busy}
            onClick={dismiss}
            title={agent.owned ? 'Stop this agent and remove it from the village' : 'Stop observing'}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white/85 transition hover:bg-rose-400/20 hover:text-rose-100"
          >
            {agent.owned ? 'dismiss' : 'unobserve'}
          </button>
          <button
            type="button"
            onClick={() => toggleVillageScreen()}
            title="Zoom into the agent's screen and talk there (F)"
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10.5px] font-bold text-white/85 transition hover:bg-white/15"
          >
            F screen
          </button>
          <button
            type="button"
            onClick={() => leaveVillageFocus()}
            title="Back to the world (Esc)"
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12px] font-bold text-white/85 transition hover:bg-white/15"
          >
            ✕
          </button>
        </div>
      </div>

      {/* An agent you only watch can be a trainee too. */}
      {!agent.owned && <div className="flex shrink-0"><AcademyTrainToggle agent={agent} /></div>}
      {agent.owned && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10.5px] text-white/75">
          <label className="flex items-center gap-1">
            model
            <select
              value={models.some(m => m.value === currentModel) ? currentModel : '__current'}
              onChange={event => {
                let model: string | null = event.target.value
                if (!model || model === '__current') return
                if (model === CUSTOM_MODEL_VALUE) {
                  model = cleanModelId(window.prompt('Model id (any the Claude Code CLI takes, e.g. claude-fable-5-2)', ''))
                  if (!model) return
                }
                getAgentEngineClient().setModel(agent.id, model).catch(error => showNotice(`Model switch failed: ${describeError(error)}`, 'error'))
              }}
              onKeyDown={event => event.stopPropagation()}
              className="max-w-[150px] rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11px] text-white"
            >
              {!models.some(m => m.value === currentModel) && <option value="__current">{modelLabel(agent)}</option>}
              {models.map(model => <option key={model.value} value={model.value}>{model.displayName || model.value}</option>)}
              <option value={CUSTOM_MODEL_VALUE}>Other model id…</option>
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
              {(agent.runtime === 'hermes' ? HERMES_MODES : PERMISSION_MODES).map(mode => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
          <EffortSelect agent={agent} />
          {/* Its Claude account (engine accounts.js), when there is more than one. */}
          <AccountSelect agent={agent} />
          <EyesToggle agent={agent} />
          <ChromeToggle agent={agent} />
          <AcademyTrainToggle agent={agent} />
          <FollowToggle agent={agent} />
          <VoiceToggle agent={agent} />
          <span className="ml-auto truncate text-white/60">{agent.runtime === 'hermes' ? `Hermes${agent.remoteHost ? ` on ${agent.remoteHost}` : ''} · ` : ''}{modelLabel(agent)}</span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <AgentSessionView agentId={agent.id} variant="2d" />
      </div>

      {/* Keyed by agent: N to the next agent gets a fresh box, and T's "mic on" request finds it. */}
      {agent.owned ? (
        agent.alive || agent.status !== 'error' ? composer : (
          <div className="shrink-0 border-t border-white/10 pt-2 text-[11.5px] text-rose-100/90">
            The process stopped. Sending a message restarts it.
            {composer}
          </div>
        )
      ) : canTalkTo(agent) ? composer : (
        <ObservedFooter agentId={agent.id} />
      )}
    </div>
  )
}

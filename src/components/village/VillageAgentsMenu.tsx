'use client'

// ░▒▓ VILLAGE AGENTS MENU — every agent on the left: full name, status colour, model, thinking ▓▒░
// Sits under the game rail (Profile … Help), scrolls, folds up to its header. Clicking an agent walks
// the camera to it (focusVillageAgent). It stays clear of the session panel on the right: on a
// desktop the two never share a column, on a phone it stops above the bottom sheet.

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { effectiveStatus, selectAttentionQueue, type EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { focusVillageAgent, getSessionPanelGeometry, getVillageScreen, subscribeVillageScreen } from './village-actions'
import { VILLAGE_OBSERVED_COLOR, modelLabel, statusColor, statusLabel } from './village-status'
import { CUT_NAME_LENGTH, fullAgentName, sessionTitles, thinkingLabel } from './village-agent-labels'

const COLLAPSED_KEY = 'oasis.village.agentsMenu.collapsed'
const MARGIN = 16
const WIDTH = 264
const FALLBACK_TOP = 336

interface Row {
  id: string
  name: string
  status: string
  label: string
  color: string
  observed: boolean
  model: string
  thinking: string
}

function rowKey(agent: EngineAgentState, titles: Map<string, string>): string {
  const status = effectiveStatus(agent)
  const label = statusLabel({ status, unseen: agent.unseen })
  return [agent.id, fullAgentName(agent, titles), status, label, agent.owned ? '' : '1', modelLabel(agent), thinkingLabel(agent)].join('\u0001')
}

function parseRow(item: string): Row {
  const [id, name, status, label, observed, model, thinking] = item.split('\u0001')
  return { id, name, status, label, color: statusColor(status), observed: observed === '1', model, thinking }
}

function useViewport() {
  const [size, setSize] = useState({ width: 1280, height: 800 })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Bottom edge of the game rail (Profile … Help), so the menu starts right under it. */
function useRailBottom(): number {
  const [bottom, setBottom] = useState(FALLBACK_TOP - 12)
  useLayoutEffect(() => {
    const rail = document.querySelector('[aria-label="Spells menu"]')?.parentElement
    if (!rail) return
    const measure = () => setBottom(Math.round(rail.getBoundingClientRect().bottom))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return bottom
}

function useCollapsed(defaultValue: boolean): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean | null>(null)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSED_KEY)
      if (saved === '1' || saved === '0') setCollapsed(saved === '1')
    } catch { /* storage blocked */ }
  }, [])
  const set = (next: boolean) => {
    setCollapsed(next)
    try { window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* storage blocked */ }
  }
  return [collapsed ?? defaultValue, set]
}

/** Agents summoned with a cut name get their full title back from the session list (one cheap engine call). */
function useSessionTitlesWhenNamesAreCut() {
  const needed = useOasisStore(s => s.agentEngine.connection.status === 'open'
    && s.agentEngine.sessions.status === 'idle'
    && s.agentEngine.order.some(id => {
      const agent = s.agentEngine.agents[id]
      return Boolean(agent?.owned && agent.sessionId && agent.name.length >= CUT_NAME_LENGTH)
    }))
  useEffect(() => {
    if (!needed) return
    const { agentEngineDispatch: dispatch } = useOasisStore.getState()
    dispatch({ type: 'sessions/loading' })
    getAgentEngineClient()
      .listSessions(300)
      .then(items => dispatch({ type: 'sessions/loaded', items, at: Date.now() }))
      .catch(error => dispatch({ type: 'sessions/error', error: error instanceof Error ? error.message : String(error) }))
  }, [needed])
}

export function VillageAgentsMenu() {
  useSessionTitlesWhenNamesAreCut()
  const rowsKey = useOasisStore(s => {
    const titles = sessionTitles(s.agentEngine.sessions.items)
    return s.agentEngine.order.map(id => {
      const agent = s.agentEngine.agents[id]
      return agent ? rowKey(agent, titles) : ''
    }).filter(Boolean).join('\u0002')
  })
  const attentionKey = useOasisStore(s => selectAttentionQueue(s.agentEngine).join(','))
  const focusedId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const screenAgentId = useSyncExternalStore(subscribeVillageScreen, getVillageScreen, () => null)
  const viewport = useViewport()
  const railBottom = useRailBottom()
  const phone = viewport.width < 700
  const [collapsed, setCollapsed] = useCollapsed(phone)

  // F: the agent's screen fills the view; the menu would sit on top of it.
  if (screenAgentId) return null

  const rows = rowsKey ? rowsKey.split('\u0002').map(parseRow) : []
  const attention = new Set(attentionKey ? attentionKey.split(',') : [])
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const top = railBottom + 12
  // A phone's session sheet covers the bottom of the screen: stop above it.
  const bottomGap = phone && focusedId ? geometry.height + geometry.margin * 2 + 8 : MARGIN
  const maxHeight = Math.max(120, viewport.height - top - bottomGap)
  const width = phone ? Math.min(WIDTH, viewport.width - MARGIN * 2) : WIDTH

  return (
    <div
      data-ui-panel="village-agents"
      className="fixed z-[185] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/80 text-white shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md"
      style={{ left: phone ? 8 : MARGIN, top, width, maxHeight: collapsed ? undefined : maxHeight }}
      onPointerDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show the agents' : 'Fold the list up'}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left transition hover:bg-white/5"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/90">Agents</span>
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-white/70">{rows.length}</span>
        {attention.size > 0 && (
          <span className="rounded-full bg-amber-400/20 px-1.5 text-[10px] font-bold text-amber-100" title="Agents that need you (N jumps to the next)">
            {attention.size} need{attention.size === 1 ? 's' : ''} you
          </span>
        )}
        <span className="ml-auto text-[11px] text-white/50">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/10 px-1.5 py-1.5 [scrollbar-width:thin]">
          {rows.length === 0 && (
            <div className="px-2 py-2 text-[11px] leading-snug text-white/50">No agents yet. Summon one from the circle (E) or with + Summon.</div>
          )}
          {rows.map(row => {
            const focused = row.id === focusedId
            const needs = attention.has(row.id)
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => focusVillageAgent(row.id)}
                title={`${row.name}: ${row.label}${row.observed ? ' (watching, read-only)' : ''}`}
                className={`mb-1 flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition last:mb-0 hover:bg-white/10 ${focused ? 'bg-white/15' : 'bg-black/25'}`}
                style={{ borderColor: focused ? `${row.color}cc` : row.observed ? `${VILLAGE_OBSERVED_COLOR}40` : 'rgba(255,255,255,0.06)' }}
              >
                <span
                  className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${needs ? 'animate-pulse' : ''}`}
                  style={{ background: row.color, boxShadow: `0 0 8px ${row.color}` }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-normal break-words text-[12.5px] font-bold leading-snug text-white">{row.name}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug" style={{ color: needs || row.status === 'error' ? row.color : 'rgba(255,255,255,0.55)' }}>
                    {row.label}
                  </span>
                  <span className="block break-words text-[10.5px] leading-snug text-white/45">
                    {row.model}
                    {row.thinking ? <> · thinking <span className="text-white/70">{row.thinking}</span></> : null}
                    {row.observed ? <span className="text-cyan-200/70"> · watching</span> : null}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

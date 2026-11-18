'use client'

// ░▒▓ VILLAGE AGENTS MENU — every agent on the left, in the game rail's style ▓▒░
// Under the rail (Profile … Help): a header like the rail's buttons, then each agent with its session
// name, its repo (the cwd's folder) and its status colour, and under it the helpers (subagents) at work
// with how long each has been at it. A click walks the camera to the agent, or opens a helper's work.
// It scrolls, folds up, and stays clear of the talk panel on the right (on a phone, of the bottom sheet).

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { GameMenuButton } from '@/components/forge/GameMenuButton'
import { useOasisStore } from '../../store/oasisStore'
import { selectAttentionQueue, type EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { formatElapsed, subagentLook, visibleSubagents, type SubagentLook } from '../../lib/village/village-subagents'
import { focusVillageAgent, focusVillageSubagent, getSessionPanelGeometry, getVillageScreen, subscribeVillageScreen } from './village-actions'
import { VILLAGE_HELPERS_COLOR, VILLAGE_OBSERVED_COLOR, cwdLabel, statusColor, villageAgentLook } from './village-status'
import { wakeLine } from '../../lib/village/village-schedule'
import { CUT_NAME_LENGTH, fullAgentName, sessionTitles } from './village-agent-labels'
import { SUBAGENT_LOOK_COLOR } from './VillageSubagentMinis'
import { getCouncilVersion, getStageCast, isStageWorldNow, subscribeCouncil } from './village-council'

const COLLAPSED_KEY = 'oasis.village.agentsMenu.collapsed'
const MARGIN = 16
const WIDTH = 272
const FALLBACK_TOP = 336
const ACCENT = '#34D399'
/** "Needs you": the amber of the attention badge. */
const ATTENTION = '#fbbf24'
/** Same width as the rail's buttons (GameMenuButton max-w-[142px]) when they can't be measured. */
const FALLBACK_RAIL_WIDTH = 126
/** Desktop: the list opens to the right of the rail, like the other menus (their carets point right). */
const LIST_WIDTH = 252
const LIST_GAP = 10
/** The open list's border and padding around its rows (p-1.5, border). */
const LIST_CHROME = 14
/** Pulses opacity only (compositor-cheap); reduced motion gets a steady glow. */
const ATTENTION_GLOW_CSS = `@keyframes oasisAttnGlow{0%,100%{opacity:.3}50%{opacity:1}}.oasis-attn-glow{animation:oasisAttnGlow 1.4s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.oasis-attn-glow{animation:none;opacity:.8}}`
/** The rail's own face (GameMenuButton). */
const GAME_MENU_FONT = '"Arial Black", Impact, "Segoe UI Black", "Trebuchet MS", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
/** Helper descriptions are sentences: a plain readable sans, not the wide mono of the status lines. */
const HELPER_FONT = '"Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const LOOK_WORD: Record<SubagentLook, string> = { running: '', done: 'done', failed: 'failed', stopped: 'stopped' }

interface HelperRow {
  key: string
  look: SubagentLook
  description: string
  startedAt: number
}

interface Row {
  id: string
  name: string
  status: string
  label: string
  color: string
  observed: boolean
  repo: string
  helpers: HelperRow[]
  /** "wakes 14:00" (engine schedule.js), or '' when nothing wakes it. */
  wake: string
}

function rowKey(agent: EngineAgentState, titles: Map<string, string>, now: number): string {
  const look = villageAgentLook(agent, now)
  const helpers = visibleSubagents(agent, now).map(sub => [sub.key, subagentLook(sub), sub.description, sub.startedAt].join('\u0003')).join('\u0004')
  return [agent.id, fullAgentName(agent, titles), look.status, look.label, agent.owned ? '' : '1', cwdLabel(agent.cwd), helpers, wakeLine(agent.nextWake, now) || ''].join('\u0001')
}

function parseRow(item: string): Row {
  const [id, name, status, label, observed, repo, helpers, wake] = item.split('\u0001')
  return {
    id, name, status, label, repo, observed: observed === '1', wake: wake || '',
    color: statusColor(status),
    helpers: helpers ? helpers.split('\u0004').map(part => {
      const [key, subLook, description, startedAt] = part.split('\u0003')
      return { key, look: subLook as SubagentLook, description, startedAt: Number(startedAt) }
    }) : [],
  }
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

/** Width of the rail's buttons, so the Agents tab and list line up with Profile … Help. */
function useRailButtonWidth(): number {
  const [width, setWidth] = useState(FALLBACK_RAIL_WIDTH)
  useLayoutEffect(() => {
    const button = document.querySelector('[aria-label="Spells menu"]')
    if (!button) return
    const measure = () => {
      const next = Math.round(button.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    return () => observer.disconnect()
  }, [])
  return width
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

/** A clock for the helpers' elapsed times; it only ticks while some are listed. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
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

function HelperLine({ agentId, helper, now, focused, onPicked }: { agentId: string; helper: HelperRow; now: number; focused: boolean; onPicked: () => void }) {
  const color = SUBAGENT_LOOK_COLOR[helper.look]
  const running = helper.look === 'running'
  return (
    <button
      type="button"
      onClick={() => { if (focusVillageSubagent(agentId, helper.key)) onPicked() }}
      title={`${helper.description}: ${running ? 'working' : helper.look}. Click to see its work.`}
      className={`flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left transition hover:bg-white/10 ${focused ? 'bg-white/15' : ''}`}
    >
      <span className="mt-[5px] text-[9px] leading-none text-white/35">↳</span>
      <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="min-w-0 flex-1 whitespace-normal break-words text-[11px] leading-snug text-white/90" style={{ fontFamily: HELPER_FONT }}>{helper.description || 'helper'}</span>
      <span className="mt-[1px] shrink-0 text-[9.5px] uppercase tracking-[0.08em] tabular-nums" style={{ color: running ? 'rgba(255,255,255,0.55)' : color }}>
        {running ? formatElapsed(now - helper.startedAt) : LOOK_WORD[helper.look]}
      </span>
    </button>
  )
}

export function VillageAgentsMenu() {
  useSessionTitlesWhenNamesAreCut()
  const hasHelpers = useOasisStore(s => s.agentEngine.order.some(id => (s.agentEngine.agents[id]?.subagents.length || 0) > 0))
  const now = useClock(hasHelpers)
  // On a stage (the Council's world) only the agents who are there: its cast (village-council.ts).
  const castVersion = useSyncExternalStore(subscribeCouncil, getCouncilVersion, () => 0)
  const rowsKey = useOasisStore(s => {
    const titles = sessionTitles(s.agentEngine.sessions.items)
    const stage = isStageWorldNow()
    return s.agentEngine.order.map(id => {
      const agent = s.agentEngine.agents[id]
      if (stage && !getStageCast().has(id)) return ''
      return agent ? rowKey(agent, titles, now) : ''
    }).filter(Boolean).join('\u0002')
  })
  void castVersion
  const attentionKey = useOasisStore(s => selectAttentionQueue(s.agentEngine).join(','))
  const focusedId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const focusedHelper = useOasisStore(s => (s.agentEngine.focusedSubagent ? `${s.agentEngine.focusedSubagent.agentId}\u0001${s.agentEngine.focusedSubagent.key}` : ''))
  const screenAgentId = useSyncExternalStore(subscribeVillageScreen, getVillageScreen, () => null)
  const viewport = useViewport()
  const railBottom = useRailBottom()
  const railWidth = useRailButtonWidth()
  const phone = viewport.width < 700
  const [collapsed, setCollapsed] = useCollapsed(phone)
  // The rows' own height, so the open list can rise above its tab instead of scrolling (desktop).
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => setContentHeight(Math.ceil(content.getBoundingClientRect().height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [collapsed, screenAgentId])

  // F: the agent's screen fills the view; the menu would sit on top of it.
  if (screenAgentId) return null

  const rows = rowsKey ? rowsKey.split('\u0002').map(parseRow) : []
  const attention = new Set(attentionKey ? attentionKey.split(',') : [])
  const helpersWorking = rows.reduce((sum, row) => sum + row.helpers.filter(helper => helper.look === 'running').length, 0)
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const top = railBottom + 12
  // A phone's session sheet covers the bottom of the screen: stop above it.
  const bottomGap = phone && focusedId ? geometry.height + geometry.margin * 2 + 8 : MARGIN
  const maxHeight = Math.max(120, viewport.height - top - bottomGap)
  // Desktop: the list opens beside the rail. When the rows don't fit below the tab's top it rises (up to the top
  // margin), so it only scrolls when the whole screen height isn't enough (owner, 2026-11-16).
  const naturalHeight = contentHeight ? contentHeight + LIST_CHROME : 0
  const lift = phone || !naturalHeight ? 0 : Math.max(0, Math.min(naturalHeight - maxHeight, top - MARGIN))
  const listMaxHeight = maxHeight + lift
  // Desktop: the tab is as wide as the rail's buttons above it and the list opens to its right.
  // A phone's rail is too narrow for that: tab and list stack under it, full width.
  const width = phone ? Math.min(WIDTH, viewport.width - MARGIN * 2) : railWidth
  const left = phone ? 8 : MARGIN
  const listWidth = phone ? width : Math.min(LIST_WIDTH, viewport.width - left - railWidth - LIST_GAP - MARGIN)
  const summary = [
    `${rows.length} in the village`,
    attention.size ? `${attention.size} need${attention.size === 1 ? 's' : ''} you` : '',
    helpersWorking ? `${helpersWorking} helper${helpersWorking === 1 ? '' : 's'} at work` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div
      data-ui-panel="village-agents"
      className={`pointer-events-none fixed z-[185] flex select-none ${phone ? 'flex-col gap-2' : 'flex-row items-start'}`}
      style={{ left, top, width: phone ? width : undefined, maxHeight: collapsed ? undefined : maxHeight, gap: phone ? undefined : LIST_GAP }}
      onPointerDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <style>{ATTENTION_GLOW_CSS}</style>
      {/* the header, like the rail's buttons; it glows amber while an agent needs you */}
      <div className="pointer-events-auto relative shrink-0" style={{ width }}>
      {attention.size > 0 && (
        <span className="oasis-attn-glow pointer-events-none absolute inset-0 rounded-lg" style={{ boxShadow: `0 0 18px 2px ${ATTENTION}, inset 0 0 14px ${ATTENTION}88`, border: `1px solid ${ATTENTION}` }} />
      )}
      {/* The rail's own button, so it wears whichever rail look is picked (Settings > Experiments). */}
      <GameMenuButton
        type="button"
        label="Agents"
        sublabel={attention.size ? (attention.size === 1 ? 'needs you' : `${attention.size} need you`) : `${rows.length} here`}
        sublabelColor={attention.size ? ATTENTION : undefined}
        accent={ACCENT}
        active={!collapsed}
        widthClassName="w-full"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        title={`${summary}. ${collapsed ? 'Show the agents' : 'Hide the list'}.`}
      />
      </div>

      {!collapsed && (
        <div
          className="pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-black/[0.92] p-1.5 text-white shadow-[0_0_54px_rgba(0,0,0,0.65),0_0_38px_rgba(52,211,153,0.14)] backdrop-blur-md [scrollbar-width:thin]"
          style={{ width: listWidth, maxHeight: listMaxHeight, marginTop: lift ? -lift : undefined, flex: phone ? undefined : '0 0 auto' }}
          data-agents-list
        >
          <div ref={contentRef}>
          {rows.length === 0 && (
            <div className="px-2 py-2 text-[11px] leading-snug text-white/55">No agents yet. Stand in the circle and press E, or use + Summon.</div>
          )}
          {rows.map(row => {
            const focused = row.id === focusedId
            const needs = attention.has(row.id)
            return (
              <div key={row.id} className="mb-1.5 last:mb-0">
                <div className="relative">
                {needs && (
                  <span className="oasis-attn-glow pointer-events-none absolute inset-0 rounded-md" style={{ boxShadow: `0 0 12px 1px ${ATTENTION}, inset 0 0 10px ${ATTENTION}66`, border: `1px solid ${ATTENTION}` }} />
                )}
                <button
                  type="button"
                  onClick={() => { if (focusVillageAgent(row.id)) setCollapsed(true) }}
                  title={`${row.name}${row.repo ? ` (${row.repo})` : ''}: ${row.label}${row.observed ? ', watched (runs elsewhere)' : ''}`}
                  className={`relative w-full overflow-hidden rounded-md border py-1.5 pl-3 pr-2 text-left transition hover:bg-white/10 ${focused ? 'bg-white/[0.12]' : 'bg-white/[0.04]'}`}
                  style={{ borderColor: focused ? `${row.color}cc` : row.observed ? `${VILLAGE_OBSERVED_COLOR}40` : 'rgba(255,255,255,0.08)' }}
                >
                  <span className={`absolute bottom-0 left-0 top-0 w-[3px] ${needs ? 'animate-pulse' : ''}`} style={{ background: row.color, boxShadow: `0 0 10px ${row.color}` }} />
                  <span
                    className="block whitespace-normal break-words text-[11.5px] font-black uppercase leading-[1.3] tracking-[0.05em] text-white"
                    style={{ fontFamily: GAME_MENU_FONT, textShadow: '0 1px 0 rgba(0,0,0,0.9)' }}
                  >
                    {row.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] uppercase tracking-[0.1em]">
                    <span style={{ color: row.color }}>{row.label}</span>
                    {row.repo && <span className="text-cyan-100/60">· {row.repo}</span>}
                    {row.observed && <span className="text-cyan-200/60">· watched</span>}
                    {row.wake && <span className="text-amber-100/70" data-agent-wake-line title="It wakes up on its own then (its settings menu: Schedule)">· {row.wake}</span>}
                  </span>
                </button>
                </div>
                {row.helpers.length > 0 && (
                  <div className="ml-2 mt-0.5 border-l pl-1" style={{ borderColor: `${VILLAGE_HELPERS_COLOR}55` }}>
                    {row.helpers.map(helper => (
                      <HelperLine key={helper.key} agentId={row.id} helper={helper} now={now} focused={focusedHelper === `${row.id}\u0001${helper.key}`} onPicked={() => setCollapsed(true)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

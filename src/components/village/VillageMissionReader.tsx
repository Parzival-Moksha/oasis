'use client'

// ░▒▓ VILLAGE MISSION READER — "E read / F full screen" next to a mission panel, and the mission's full text ▓▒░
// Plain DOM over the canvas (mounted by VillageController): the prompt reuses the agents' game banner,
// the text the thread's markdown renderer and the agent panel's look. Esc closes it.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { renderMarkdown } from '../../lib/anorak-renderers'
import { MISSION_COLUMN_COLOR, missionKeyAction, type Mission } from '../../lib/village/village-missions'
import { getSessionPanelGeometry, isTypingTarget, setVillageProximityRival } from './village-actions'
import {
  VILLAGE_MISSION_LAYER,
  closeMissionReader,
  getMissionState,
  openMissionReader,
  startMissionRefresh,
  subscribeMissions,
  toggleMissionReaderMode,
  updateMissionProximity,
} from './village-mission-store'
import { KeyPrompt, PromptBanner } from './VillageHud'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS } from './village-status'

/** The text under the header lines: they are shown as chips instead. */
function missionBody(mission: Mission): string {
  const lines = mission.markdown.split('\n')
  const title = lines.findIndex(line => line.startsWith('# '))
  return lines.slice(title >= 0 ? title + 1 : 0).join('\n').trim()
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
      <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">{label}</span>
      <span className="font-bold" style={color ? { color } : undefined}>{value}</span>
    </span>
  )
}

function Reader({ mission, mode }: { mission: Mission; mode: 'side' | 'full' }) {
  const zIndex = useOasisStore(s => s.getPanelZIndex('village-mission', 9400))
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // The keyboard scrolls the text (arrows, Page Down, Space) as soon as it opens.
  useEffect(() => {
    scroller.current?.focus({ preventScroll: true })
  }, [mission.file, mode])
  const body = useMemo(() => renderMarkdown(missionBody(mission)), [mission])
  const color = MISSION_COLUMN_COLOR[mission.column]
  const full = mode === 'full'
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const style = full
    ? { left: '50%', top: '4%', bottom: '4%', width: `min(980px, ${viewport.width - 32}px)`, transform: 'translateX(-50%)' }
    : geometry.side === 'right'
      ? { right: geometry.margin, top: geometry.margin, width: geometry.width, height: geometry.height }
      : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height }
  return (
    <>
      {full && <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" style={{ zIndex }} onClick={closeMissionReader} />}
      <div
        data-ui-panel="village-mission"
        className={`fixed flex flex-col gap-2.5 rounded-xl border bg-slate-950/95 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl ${full ? 'p-6' : 'p-3.5'} ${VILLAGE_TYPE_CLASS}`}
        style={{ ...style, zIndex, borderColor: `${color}88`, fontFamily: VILLAGE_FONT_BODY }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-[0.26em]" style={{ color }}>Mission · {mission.column}</div>
            <div className={`break-words font-bold leading-tight tracking-wide ${full ? 'text-[26px]' : 'text-[18px]'}`} style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{mission.title}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleMissionReaderMode}
              title={full ? 'Back beside the world (F)' : 'Read it over the whole screen (F)'}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10.5px] font-bold text-white/85 transition hover:bg-white/15"
            >
              {full ? 'F side' : 'F full screen'}
            </button>
            <button
              type="button"
              onClick={closeMissionReader}
              title="Back to the world (Esc)"
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12px] font-bold text-white/85 transition hover:bg-white/15"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11.5px]">
          <Chip label="priority" value={mission.priority === null ? '–' : mission.priority.toFixed(2)} color={color} />
          <Chip label="state" value={mission.state} />
          {mission.ease !== null && <Chip label="ease" value={String(mission.ease)} />}
          {mission.impact !== null && <Chip label="impact" value={String(mission.impact)} />}
          {mission.urgency !== null && <Chip label="urgency" value={String(mission.urgency)} />}
          {mission.who && <Chip label="who" value={mission.who} />}
        </div>
        {mission.doneWhen && (
          <div className={`shrink-0 rounded-lg border-l-2 bg-white/5 px-3 py-2 leading-snug ${full ? 'text-[15px]' : 'text-[12.5px]'}`} style={{ borderColor: color }}>
            <span className="mr-1.5 text-[9.5px] uppercase tracking-[0.14em] text-white/50">done when</span>
            {mission.doneWhen}
          </div>
        )}
        <div
          ref={scroller}
          tabIndex={-1}
          className={`min-h-0 flex-1 overflow-y-auto break-words pr-2 leading-relaxed text-white/90 outline-none ${full ? 'text-[15px]' : 'text-[12.5px]'}`}
        >
          {body}
        </div>
        <div className="shrink-0 border-t border-white/10 pt-1.5 text-[10px] text-white/45">{mission.file} · read-only: edit the file, it updates here within half a minute</div>
      </div>
    </>
  )
}

export function VillageMissionReader() {
  const { missions, nearby, reader } = useSyncExternalStore(subscribeMissions, getMissionState, getMissionState)
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const open = reader ? missions.find(mission => mission.file === reader.file) || null : null
  const near = nearby ? missions.find(mission => mission.file === nearby) || null : null
  useUILayer(VILLAGE_MISSION_LAYER, Boolean(open))

  // The list: every 30 s and when the window is looked at again.
  useEffect(() => startMissionRefresh(), [])

  // Which panel is within reach: the village's proximity tick asks, a nearer agent wins.
  useEffect(() => {
    setVillageProximityRival(updateMissionProximity)
    return () => {
      setVillageProximityRival(null)
      updateMissionProximity(null, null)
    }
  }, [])

  // Reading needs a free mouse (scroll, buttons).
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])

  // An agent was opened (N, a click): its panel takes the place.
  useEffect(() => {
    if (focusedAgentId) closeMissionReader()
  }, [focusedAgentId])

  // A canvas click pops every UI layer: that closes the reader too.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(VILLAGE_MISSION_LAYER) && !state._uiLayerStack.includes(VILLAGE_MISSION_LAYER)) closeMissionReader()
  }), [])

  // E / F next to a panel, F / Esc while reading: before the world's own bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = getMissionState()
      const village = useOasisStore.getState().agentEngine
      const action = missionKeyAction({
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        reader: current.reader?.mode || null,
        nearby: Boolean(current.nearby),
        agent: Boolean(village.focusedAgentId || village.nearbyAgentId),
        worldKeysFree: useInputManager.getState().can().enterFocuses,
      })
      if (!action) return
      if (action === 'close') closeMissionReader()
      else if (action === 'toggle-full') toggleMissionReaderMode()
      else if (current.nearby) openMissionReader(current.nearby, action === 'full' ? 'full' : 'side')
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  if (focusedAgentId) return null
  return (
    <>
      {near && !open && (
        <PromptBanner accent={MISSION_COLUMN_COLOR[near.column]} title={near.title}>
          <KeyPrompt k="E" label="Read" accent="#38bdf8" primary />
          <KeyPrompt k="F" label="Full screen" accent="#c084fc" className="max-[700px]:hidden" />
        </PromptBanner>
      )}
      {open && reader && <Reader mission={open} mode={reader.mode} />}
    </>
  )
}

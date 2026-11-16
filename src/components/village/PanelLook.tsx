'use client'

// ░▒▓ PANEL LOOK — transparency and blur for every agent chat, a background colour per agent ▓▒░
// A button in the agent panel's header opens the settings; the side panel (E) and the agent's full
// screen (F) both follow them (lib/village/panel-look.ts).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  DEFAULT_LOOK,
  DEFAULT_PANEL_COLOR,
  PANEL_SWATCHES,
  getAgentPanelColor,
  getPanelLook,
  getPanelLookVersion,
  panelStyle,
  setAgentPanelColor,
  setPanelLook,
  subscribePanelLook,
} from '../../lib/village/panel-look'
import { VoiceSpeedSlider } from './CompanionToggles'

/** Background and blur for an agent's chat surface. */
export function usePanelLook(agentKey: string) {
  useSyncExternalStore(subscribePanelLook, getPanelLookVersion, () => 0)
  return panelStyle(getAgentPanelColor(agentKey), getPanelLook())
}

export function PanelLookButton({ agentKey, agentName }: { agentKey: string; agentName: string }) {
  const [open, setOpen] = useState(false)
  useSyncExternalStore(subscribePanelLook, getPanelLookVersion, () => 0)
  const look = getPanelLook()
  const color = getAgentPanelColor(agentKey) || DEFAULT_PANEL_COLOR
  const boxRef = useRef<HTMLDivElement>(null)

  // A click outside closes it.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  }, [open])

  return (
    <div ref={boxRef} className="relative" onKeyDown={event => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Panel look: transparency and blur for all agent chats, a colour for this one"
        aria-label="Panel look"
        aria-expanded={open}
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-md border text-white/80 transition hover:bg-white/15 ${open ? 'border-white/45 bg-white/15' : 'border-white/15 bg-white/5'}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.9-.4-1 .3-2.1 1.4-2.1H17a4 4 0 0 0 4-4c0-5-4-10-9-10Z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" /><circle cx="10.5" cy="7" r="1.2" fill="currentColor" /><circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-[250px] rounded-lg border border-white/15 bg-slate-950/95 p-3 text-[11px] text-white shadow-[0_18px_50px_rgba(0,0,0,0.6)]">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">All agent chats</div>
          <label className="mb-2 block">
            <span className="flex justify-between"><span>Transparency</span><span className="text-white/55">{Math.round((1 - look.opacity) * 100)}%</span></span>
            <input type="range" min={0} max={85} value={Math.round((1 - look.opacity) * 100)} onChange={event => setPanelLook({ opacity: 1 - Number(event.target.value) / 100 })} className="w-full accent-sky-300" />
          </label>
          <label className="mb-3 block">
            <span className="flex justify-between"><span>Blur</span><span className="text-white/55">{look.blur}px</span></span>
            <input type="range" min={0} max={24} value={look.blur} onChange={event => setPanelLook({ blur: Number(event.target.value) })} className="w-full accent-sky-300" />
          </label>
          {/* How fast agents talk (village-companion.ts): the same setting as the select next to the Voice switch. */}
          <VoiceSpeedSlider />
          <div className="mb-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">Colour · {agentName}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PANEL_SWATCHES.map(swatch => (
              <button
                key={swatch}
                type="button"
                onClick={() => setAgentPanelColor(agentKey, swatch === DEFAULT_PANEL_COLOR ? null : swatch)}
                aria-label={`Background ${swatch}`}
                className={`h-5 w-5 rounded border ${swatch === color ? 'border-white' : 'border-white/25'}`}
                style={{ background: swatch }}
              />
            ))}
            <input type="color" value={color} onChange={event => setAgentPanelColor(agentKey, event.target.value)} aria-label="Custom background colour" className="h-5 w-7 cursor-pointer rounded border border-white/25 bg-transparent p-0" />
          </div>
          <button type="button" onClick={() => { setPanelLook(DEFAULT_LOOK); setAgentPanelColor(agentKey, null) }} className="mt-3 text-[10.5px] text-white/55 underline-offset-2 hover:text-white hover:underline">
            back to the defaults
          </button>
        </div>
      )}
    </div>
  )
}

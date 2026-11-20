'use client'

// ░▒▓ AGENT PANEL TABS — the agent's panel has two pages: its thread, and its settings ▓▒░
// The owner (2026-11-20 play-through, 0:22 to 1:25): the strip of controls on top (model, mode and the rest) "could
// just become an alternative page, a different tab of the agent panel. Same thing with F screen", with model and mode
// at its top, and a font-size control for the text. The tab chosen is the same in the side panel (E) and on the full
// screen (F). Built from the shared UI kit (Hipster's); the panel's frame and colours are the kit's, not set here.

import { useSyncExternalStore, type ReactNode } from 'react'
import { KitSlider, KitTabs } from '@/components/ui-kit'

export type AgentPanelTab = 'thread' | 'settings'

let tab: AgentPanelTab = 'thread'
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setAgentPanelTab(next: AgentPanelTab): void {
  if (tab === next) return
  tab = next
  notify()
}

export function useAgentPanelTab(): AgentPanelTab {
  return useSyncExternalStore(subscribe, () => tab, () => 'thread' as AgentPanelTab)
}

export function AgentPanelTabBar() {
  const active = useAgentPanelTab()
  return (
    <div data-agent-panel-tabs={active} className="shrink-0">
      <KitTabs<AgentPanelTab>
        tabs={[
          { id: 'thread', label: 'Thread', title: 'The conversation' },
          { id: 'settings', label: 'Settings', title: 'Model, mode, and how it works with you' },
        ]}
        active={active}
        onChange={setAgentPanelTab}
      />
    </div>
  )
}

// ─── the thread's text size ───────────────────────────────────────────────────────────────────────

const FONT_KEY = 'oasis.village.threadFont.v1'
export const THREAD_FONT = { min: 0.8, max: 1.6, step: 0.05, default: 1 } as const
let fontScale: number | null = null

function clampFont(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : THREAD_FONT.default
  return Math.round(Math.min(THREAD_FONT.max, Math.max(THREAD_FONT.min, n)) * 100) / 100
}

export function getThreadFontScale(): number {
  if (fontScale === null) {
    let raw: unknown = null
    if (typeof window !== 'undefined') {
      try { raw = JSON.parse(window.localStorage.getItem(FONT_KEY) || 'null') } catch { raw = null }
    }
    fontScale = clampFont(raw)
  }
  return fontScale
}

export function setThreadFontScale(value: number): void {
  fontScale = clampFont(value)
  try { window.localStorage.setItem(FONT_KEY, JSON.stringify(fontScale)) } catch { /* storage blocked */ }
  notify()
}

export function useThreadFontScale(): number {
  return useSyncExternalStore(subscribe, getThreadFontScale, () => THREAD_FONT.default)
}

/** The thread at the chosen text size (one scale on the whole thread, so every part grows together). */
export function ThreadFontScale({ children }: { children: ReactNode }) {
  const scale = useThreadFontScale()
  // It must fill the space it is given (the thread inside scrolls): full height, whatever its parent is. Zoomed, its
  // own height is divided by the zoom so it still ends where the space ends.
  return (
    <div data-thread-font={scale} className="flex h-full min-h-0 flex-1 flex-col" style={scale === 1 ? undefined : { zoom: scale, height: `${100 / scale}%` }}>
      {children}
    </div>
  )
}

export function ThreadFontSlider() {
  const scale = useThreadFontScale()
  return (
    <KitSlider
      label="Text size"
      value={Math.round(scale * 100)}
      min={THREAD_FONT.min * 100}
      max={THREAD_FONT.max * 100}
      step={THREAD_FONT.step * 100}
      onChange={value => setThreadFontScale(value / 100)}
      format={value => `${value}%`}
      hint="The thread's text, in the side panel and on the full screen"
    />
  )
}

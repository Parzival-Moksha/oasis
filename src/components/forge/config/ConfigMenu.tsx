'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG MENU — tabbed game-style settings panel. Mounted inside SettingsMenu
// in Scene.tsx. Replaces the old monolithic SettingsContent pile.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { CONFIG_TABS, type ConfigTabId } from './types'
import { GraphicsTab } from './tabs/GraphicsTab'
import { FontsTab } from './tabs/FontsTab'
import { SoundTab } from './tabs/SoundTab'
import { ControlsTab } from './tabs/ControlsTab'
import { BoltsTab } from './tabs/BoltsTab'
import { WorldVfxTab } from './tabs/WorldVfxTab'
import { AgentsTab } from './tabs/AgentsTab'
import { ExperimentsTab } from './tabs/ExperimentsTab'
import { MiscTab } from './tabs/MiscTab'
import { SettingsLookControls } from './SettingsLookControls'

export interface ConfigMenuProps {
  /** Settings menu opacity slider (lives in Scene.tsx state). */
  menuOpacity: number
  onMenuOpacityChange: (opacity: number) => void
  /** Optional admin-only console hook (rendered in Misc). */
  consoleControl?: React.ReactNode
  /** Optional initial active tab. */
  initialTab?: ConfigTabId
}

// Wide panel (the owner, 2026-11-18: "twice as wide would be fine"): once the panel is wide enough the tabs share
// the top row and each tab's sections flow into two columns, like two of the old panels side by side. A container
// query, so it follows the panel's own width (a narrow window or a phone keeps one column).
const WIDE_CSS = `
.oasis-settings { container-type: inline-size; }
@container (min-width: 760px) {
  .oasis-settings-tabs > button { flex: 1 1 0; justify-content: center; padding-top: 8px; padding-bottom: 8px; }
  .oasis-settings-tabs > button > span:last-child { display: inline; font-size: 11px; white-space: nowrap; }
  .oasis-settings-body[data-flow="columns"] > div { columns: 2; column-gap: 32px; column-rule: 1px solid rgba(255,255,255,0.06); }
  .oasis-settings-body[data-flow="columns"] > div > section,
  .oasis-settings-body[data-flow="columns"] > div > :not(section) > * { break-inside: avoid; }
  .oasis-settings-body[data-flow="columns"] > div > * { margin-top: 0 !important; margin-bottom: 14px; }
  .oasis-settings-body { padding: 16px 22px 24px; }
}
`

/** Tabs whose content is wide by itself (grids of pictures) keep one column. */
const ONE_COLUMN_TABS = new Set<ConfigTabId>(['experiments'])

/** The emblem in the top left: a gilded gear on a dark medallion, drawn (no font or emoji to go missing). */
function SettingsCrest() {
  const teeth = 10
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2
    for (const [r, da] of [[11.5, -0.17], [15.5, -0.1], [15.5, 0.1], [11.5, 0.17]] as const) {
      d += `${d ? 'L' : 'M'}${(20 + Math.cos(a + da) * r).toFixed(2)} ${(20 + Math.sin(a + da) * r).toFixed(2)}`
    }
  }
  d += 'Z'
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
      <defs>
        <radialGradient id="settingsCrestBg" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stopColor="#2c2f38" /><stop offset="1" stopColor="#0d0e12" /></radialGradient>
        <linearGradient id="settingsCrestGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff1c6" /><stop offset="0.55" stopColor="#e2b85e" /><stop offset="1" stopColor="#9a6a24" /></linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill="url(#settingsCrestBg)" stroke="#c9a256" strokeWidth="1.2" />
      <circle cx="20" cy="20" r="17" fill="none" stroke="#c9a256" strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="1.4 2.2" />
      <path d={d} fill="url(#settingsCrestGold)" stroke="#5a3d12" strokeWidth="0.6" />
      <circle cx="20" cy="20" r="5.2" fill="#14161b" stroke="#5a3d12" strokeWidth="0.8" />
      <circle cx="20" cy="20" r="2" fill="#8fd3ff" />
    </svg>
  )
}

export function ConfigMenu({ menuOpacity, onMenuOpacityChange, consoleControl, initialTab = 'graphics' }: ConfigMenuProps) {
  const [activeTab, setActiveTab] = useState<ConfigTabId>(initialTab)

  const tabProps = { menuOpacity, onMenuOpacityChange, consoleControl }

  return (
    <div className="oasis-settings flex min-h-0 w-full max-h-[inherit] flex-col max-[700px]:w-full">
      <style>{WIDE_CSS}</style>
      {/* ─═̷─═̷─ HEADER ─═̷─═̷─ */}
      <div className="shrink-0 bg-black/20 border-b border-white/10 px-3 pt-3 pb-2 max-[700px]:px-2 max-[700px]:pt-2">
        <div className="flex items-center gap-3 mb-2">
          <SettingsCrest />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-black uppercase tracking-[0.18em] text-white">Settings</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/42 truncate">
              {CONFIG_TABS.find(t => t.id === activeTab)?.tooltip}
            </div>
          </div>
          <SettingsLookControls />
          <button
            type="button"
            data-settings-close
            title="Close Settings"
            aria-label="Close Settings"
            onClick={() => window.dispatchEvent(new CustomEvent('oasis:close-config'))}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-md border border-white/20 bg-white/5 text-[15px] font-bold text-white/80 transition hover:scale-110 hover:border-white/50 hover:bg-white/15 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* ─═̷─═̷─ TAB ROW ─═̷─═̷─ */}
        <div className="oasis-settings-tabs flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          {CONFIG_TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.tooltip}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all cursor-pointer ${
                  active
                    ? 'border-amber-300/60 bg-amber-300/10 text-amber-100 shadow-[0_0_12px_rgba(252,211,77,0.25)]'
                    : 'border-white/10 bg-black/30 text-white/55 hover:border-white/25 hover:text-white/85'
                }`}
              >
                <span className="text-sm leading-none">{tab.emoji}</span>
                <span className="hidden min-[500px]:inline text-[10px] font-bold uppercase tracking-[0.1em]">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─═̷─═̷─ CONTENT ─═̷─═̷─ */}
      <div data-flow={ONE_COLUMN_TABS.has(activeTab) ? 'one' : 'columns'} className="oasis-settings-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-5 max-[700px]:p-2 max-[700px]:pb-[calc(env(safe-area-inset-bottom)+1rem)]" style={{ scrollbarWidth: 'thin' }}>
        {activeTab === 'graphics' && <GraphicsTab {...tabProps} />}
        {activeTab === 'fonts' && <FontsTab />}
        {activeTab === 'sound' && <SoundTab />}
        {activeTab === 'controls' && <ControlsTab />}
        {activeTab === 'bolts' && <BoltsTab />}
        {activeTab === 'world-vfx' && <WorldVfxTab />}
        {activeTab === 'agents' && <AgentsTab />}
        {activeTab === 'experiments' && <ExperimentsTab />}
        {activeTab === 'misc' && <MiscTab {...tabProps} />}
      </div>
    </div>
  )
}

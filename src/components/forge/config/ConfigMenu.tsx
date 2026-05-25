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

export interface ConfigMenuProps {
  /** Settings menu opacity slider (lives in Scene.tsx state). */
  menuOpacity: number
  onMenuOpacityChange: (opacity: number) => void
  /** Optional admin-only console hook (rendered in Misc). */
  consoleControl?: React.ReactNode
  /** Optional initial active tab. */
  initialTab?: ConfigTabId
}

export function ConfigMenu({ menuOpacity, onMenuOpacityChange, consoleControl, initialTab = 'graphics' }: ConfigMenuProps) {
  const [activeTab, setActiveTab] = useState<ConfigTabId>(initialTab)

  const tabProps = { menuOpacity, onMenuOpacityChange, consoleControl }

  return (
    <div className="flex min-h-0 w-full max-h-[inherit] flex-col max-[700px]:w-full">
      {/* ─═̷─═̷─ HEADER ─═̷─═̷─ */}
      <div className="shrink-0 bg-black/[0.92] backdrop-blur-md border-b border-white/10 px-3 pt-3 pb-2 max-[700px]:px-2 max-[700px]:pt-2">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-violet-300/35 bg-violet-300/10 text-[11px] font-black text-violet-100">
            SYS
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-black uppercase tracking-[0.18em] text-white">Config</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/42 truncate">
              {CONFIG_TABS.find(t => t.id === activeTab)?.tooltip}
            </div>
          </div>
        </div>

        {/* ─═̷─═̷─ TAB ROW ─═̷─═̷─ */}
        <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-5 max-[700px]:p-2 max-[700px]:pb-[calc(env(safe-area-inset-bottom)+1rem)]" style={{ scrollbarWidth: 'thin' }}>
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

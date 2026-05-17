'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// FONTS TAB — picks the active UI font. v1 only retargets the spellbook
// (the worst offender), but the setting + catalog is wired globally so
// expanding to the wider UI is a one-edit follow-up.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { FONT_DEFS, FONT_IDS, type FontId } from '@/lib/fonts'

export function FontsTab() {
  const { settings, updateSetting } = useContext(SettingsContext)
  const activeId = (settings.uiFont || 'cinzel') as FontId

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-mono">Spellbook font</div>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
          Picks the font for the spellbook today. The picker will expand to other panels (HUD, menus) in a follow-up — same setting, different surfaces.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FONT_IDS.map(id => {
          const font = FONT_DEFS[id]
          const active = activeId === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => updateSetting('uiFont', id)}
              className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition ${
                active
                  ? 'border-amber-300/60 bg-amber-300/10 shadow-[0_0_18px_rgba(252,211,77,0.22)]'
                  : 'border-white/10 bg-black/30 hover:border-white/25'
              }`}
            >
              <div
                className="text-base text-white/90"
                style={{ fontFamily: font.cssFamily }}
              >
                {font.sample}
              </div>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-white/80">{font.name}</div>
                {active && <div className="text-[9px] uppercase tracking-[0.14em] text-amber-200/85">Active</div>}
              </div>
              <div className="text-[10px] leading-snug text-gray-400">{font.vibe}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// MISC TAB — RP1 toggle, console control, and any other advanced/odd settings.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import type { SharedTabProps } from '../types'

export function MiscTab({ consoleControl }: SharedTabProps) {
  const { settings, effectiveRp1Mode, rp1Locked, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-3">
      {consoleControl && (
        <section>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Console</div>
          <div className="rounded-lg border border-amber-300/15 bg-amber-300/5 p-2">
            {consoleControl}
          </div>
        </section>
      )}

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Modes</div>
        <label className={`flex items-center gap-3 py-1.5 rounded px-1 -mx-1 transition-colors ${rp1Locked ? 'cursor-default opacity-90' : 'cursor-pointer group hover:bg-white/5'}`}>
          <div
            onClick={() => {
              if (!rp1Locked) updateSetting('rp1Mode', !settings.rp1Mode)
            }}
            className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
              effectiveRp1Mode ? 'bg-teal-600 shadow-lg shadow-teal-500/30' : 'bg-gray-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
              effectiveRp1Mode ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Ready Player 1</div>
            <div className="text-[10px] text-gray-500">
              {rp1Locked
                ? 'Locked for this world — exploration-only.'
                : effectiveRp1Mode
                  ? 'Hide all editing UI — exploration mode.'
                  : 'Builder mode — full editing UI visible.'}
            </div>
          </div>
        </label>
      </section>

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Resources</div>
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all duration-200 border border-teal-500/30 bg-teal-500/5 hover:border-teal-500/50 hover:bg-teal-500/10 w-full"
        >
          <span className="text-lg">📖</span>
          <div>
            <div className="text-[11px] font-medium text-teal-400">Oasis Documentation</div>
            <div className="text-[9px] text-gray-400">Guides, API reference, architecture</div>
          </div>
        </a>
      </section>
    </div>
  )
}

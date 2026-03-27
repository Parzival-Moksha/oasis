// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS TAB — VFX, placement, opacity, model selector
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useContext } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import type { PlacementVfxType } from '../../../store/oasisStore'
import { SettingsContext } from '../../scene-lib/contexts'

export function SettingsTab() {
  const conjureVfxType = useOasisStore(s => s.conjureVfxType)
  const setConjureVfxType = useOasisStore(s => s.setConjureVfxType)
  const placementVfxType = useOasisStore(s => s.placementVfxType)
  const setPlacementVfxType = useOasisStore(s => s.setPlacementVfxType)
  const placementVfxDuration = useOasisStore(s => s.placementVfxDuration)
  const setPlacementVfxDuration = useOasisStore(s => s.setPlacementVfxDuration)
  const previewPlacementSpell = useOasisStore(s => s.previewPlacementSpell)
  const startConjurePreview = useOasisStore(s => s.startConjurePreview)
  const craftModel = useOasisStore(s => s.craftModel)
  const setCraftModel = useOasisStore(s => s.setCraftModel)

  const { settings, updateSetting } = useContext(SettingsContext)
  const opacity = settings.uiOpacity

  return (
    <>
      {/* ─═̷─═̷─ SETTINGS TAB — VFX, placement, opacity ─═̷─═̷─ */}
      <div className="space-y-4">

        {/* ░▒▓ Conjuration VFX ▓▒░ */}
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Conjuration Effect</div>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { id: 'random' as const, label: 'Random', desc: 'Different effect each time', icon: '\u{1F3B2}' },
              { id: 'textswirl' as const, label: 'Text Swirl', desc: 'Prompt tokens orbit and collapse', icon: '\u2728' },
              { id: 'arcane' as const, label: 'Arcane Circle', desc: 'Sacred geometry + light pillars', icon: '\u26E2' },
              { id: 'vortex' as const, label: 'Particle Vortex', desc: 'Atom storm converges into form', icon: '\u{1F300}' },
              { id: 'quantumassembly' as const, label: 'Quantum Assembly', desc: 'Cube wireframe morphs to sphere', icon: '\u269B' },
              { id: 'primordialcauldron' as const, label: 'Primordial Cauldron', desc: 'Bubbling potion overflows', icon: '\u2697' },
              { id: 'stellarnursery' as const, label: 'Stellar Nursery', desc: 'Nebula births a star', icon: '\u2B50' },
              { id: 'chronoforge' as const, label: 'Chrono-Forge', desc: 'Hourglass bends time itself', icon: '\u231B' },
              { id: 'abyssalemergence' as const, label: 'Abyssal Emergence', desc: 'Dark tentacles from the void', icon: '\u{1F419}' },
            ]).map(fx => (
              <button
                key={fx.id}
                onClick={() => { setConjureVfxType(fx.id); startConjurePreview(fx.id) }}
                className={`rounded-lg px-2 py-1.5 text-left transition-all duration-200 border ${
                  conjureVfxType === fx.id
                    ? 'border-orange-500/50 bg-orange-500/10'
                    : 'border-gray-700/30 bg-black/40 hover:border-gray-600/50'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="text-sm">{fx.icon}</span>
                  <span className={`text-[10px] font-medium ${conjureVfxType === fx.id ? 'text-orange-400' : 'text-gray-400'}`}>
                    {fx.label}
                  </span>
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{fx.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ░▒▓ Placement VFX ▓▒░ */}
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Placement Spell Effect</div>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { id: 'random' as PlacementVfxType, label: 'Random', desc: 'Different spell each time', icon: '\u{1F3B2}' },
              { id: 'runeflash' as PlacementVfxType, label: 'Rune Flash', desc: 'Arcane circle glows on ground', icon: '\u2726' },
              { id: 'sparkburst' as PlacementVfxType, label: 'Spark Burst', desc: '200 particles shower outward', icon: '\u2604' },
              { id: 'portalring' as PlacementVfxType, label: 'Portal Ring', desc: 'Glowing ring rises through object', icon: '\u25CE' },
              { id: 'sigilpulse' as PlacementVfxType, label: 'Sigil Pulse', desc: '3 expanding ripple rings', icon: '\u25C9' },
              { id: 'quantumcollapse' as PlacementVfxType, label: 'Quantum Collapse', desc: '500 particles collapse from uncertainty', icon: '\u269B' },
              { id: 'phoenixascension' as PlacementVfxType, label: 'Phoenix Ascension', desc: 'Fire column + wings of light', icon: '\u2748' },
              { id: 'dimensionalrift' as PlacementVfxType, label: 'Dimensional Rift', desc: 'Void slash tears open space', icon: '\u2301' },
              { id: 'crystalgenesis' as PlacementVfxType, label: 'Crystal Genesis', desc: 'Crystals erupt and shatter', icon: '\u2B20' },
              { id: 'meteorimpact' as PlacementVfxType, label: 'Meteor Impact', desc: 'Fireball descends + shockwave', icon: '\u2622' },
              { id: 'arcanebloom' as PlacementVfxType, label: 'Arcane Bloom', desc: 'Magic flower unfolds with pollen', icon: '\u2740' },
              { id: 'voidanchor' as PlacementVfxType, label: 'Void Anchor', desc: 'Dark sphere slams + chains lock', icon: '\u2693' },
              { id: 'stellarforge' as PlacementVfxType, label: 'Stellar Forge', desc: 'Nebula spirals birth a star', icon: '\u2605' },
            ]).map(fx => (
              <button
                key={fx.id}
                onClick={() => { setPlacementVfxType(fx.id); previewPlacementSpell(fx.id) }}
                className={`rounded-lg px-2 py-1.5 text-left transition-all duration-200 border ${
                  placementVfxType === fx.id
                    ? 'border-yellow-500/50 bg-yellow-500/10'
                    : 'border-gray-700/30 bg-black/40 hover:border-gray-600/50'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="text-sm">{fx.icon}</span>
                  <span className={`text-[10px] font-medium ${placementVfxType === fx.id ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {fx.label}
                  </span>
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{fx.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ░▒▓ Placement duration slider ▓▒░ */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">Spell Duration</span>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={placementVfxDuration}
              onChange={(e) => setPlacementVfxDuration(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-yellow-500 cursor-pointer"
            />
            <span className="text-[10px] text-gray-500 font-mono w-8 text-right">{placementVfxDuration.toFixed(1)}s</span>
          </div>
        </div>

        {/* ░▒▓ Panel opacity — driven by system uiOpacity setting ▓▒░ */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono whitespace-nowrap">Panel Opacity</span>
            <div
              className="flex-1 h-4 rounded-full bg-gray-800 cursor-pointer relative select-none"
              onMouseDown={(e) => {
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                const update = (clientX: number) => {
                  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                  const v = Math.round((0.1 + pct * 0.9) * 20) / 20 // 0.1-1.0 in 0.05 steps
                  updateSetting('uiOpacity', v)
                }
                update(e.clientX)
                const onMove = (ev: MouseEvent) => update(ev.clientX)
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
            >
              {/* Track fill */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-orange-500/60"
                style={{ width: `${((opacity - 0.1) / 0.9) * 100}%` }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-orange-400 border-2 border-orange-300 shadow-md"
                style={{ left: `calc(${((opacity - 0.1) / 0.9) * 100}% - 6px)` }}
              />
            </div>
            <span className="text-[10px] text-gray-500 font-mono w-8 text-right">{Math.round(opacity * 100)}%</span>
          </div>
        </div>

        {/* ░▒▓█ CRAFT MODEL SELECTOR — The silicon tongue █▓▒░ */}
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Craft / Terrain Model</div>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Best balance of speed + quality', icon: '\u2728' },
              { id: 'anthropic/claude-haiku-4-5', label: 'Haiku 4.5', desc: 'Fast + cheap, good for iteration', icon: '\u26A1' },
              { id: 'z-ai/glm-5', label: 'GLM-5', desc: 'ZhipuAI frontier model', icon: '\u{1F30F}' },
              { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', desc: 'Moonshot\'s reasoning model', icon: '\u{1F319}' },
            ] as const).map(m => (
              <button
                key={m.id}
                onClick={() => setCraftModel(m.id)}
                className={`rounded-lg px-2 py-1.5 text-left transition-all duration-200 border ${
                  craftModel === m.id
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-gray-700/30 bg-black/40 hover:border-blue-500/30 hover:bg-blue-500/5'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="text-sm">{m.icon}</span>
                  <span className={`text-[10px] font-medium ${craftModel === m.id ? 'text-blue-300' : 'text-gray-400'}`}>
                    {m.label}
                  </span>
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ░▒▓█ VOICE MODEL — Merlin placeholder █▓▒░ */}
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Voice Model</div>
          <div className="rounded-lg border border-gray-700/30 bg-black/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{'\u{1F9D9}'}</span>
              <div>
                <div className="text-[11px] text-purple-300/80 font-medium">Merlin v1</div>
                <div className="text-[9px] text-gray-400">Voice-to-tool pipeline — coming soon</div>
              </div>
            </div>
            <div className="mt-2 text-[9px] text-gray-500 font-mono italic">
              &quot;Speak thy will and the forge shall obey&quot;
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

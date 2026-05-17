'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD VFX TAB — Conjuration VFX picker, Placement VFX picker, placement
// duration, and the Portal Transition lab. Also surfaces the agent walk +
// embodied-action toggles since they affect how spell pipelines play out in
// world.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { useOasisStore } from '@/store/oasisStore'
import type { PlacementVfxType } from '@/store/oasisStore'
import { PortalTransitionSettingsPanel } from '../../PortalTransitionSettingsPanel'

const CONJURE_VFX_OPTIONS = [
  { id: 'random' as const, label: 'Random', desc: 'Different effect each time', icon: '\u{1F3B2}' },
  { id: 'realitystorm' as const, label: 'Reality Storm', desc: 'Smoke, lightning, shards, morphing core', icon: '\u{1F4A5}' },
  { id: 'riftstorm' as const, label: 'Riftstorm', desc: 'Space tear, haze, violet arcs', icon: '⧉' },
  { id: 'cataclysm' as const, label: 'Cataclysm', desc: 'Explosive forge smoke and shockwaves', icon: '☄' },
  { id: 'textswirl' as const, label: 'Text Swirl', desc: 'Prompt tokens orbit and collapse', icon: '✨' },
  { id: 'arcane' as const, label: 'Arcane Circle', desc: 'Sacred geometry + light pillars', icon: '⛢' },
  { id: 'vortex' as const, label: 'Particle Vortex', desc: 'Atom storm converges into form', icon: '\u{1F300}' },
  { id: 'quantumassembly' as const, label: 'Quantum Assembly', desc: 'Cube wireframe morphs to sphere', icon: '⚛' },
  { id: 'primordialcauldron' as const, label: 'Primordial Cauldron', desc: 'Bubbling potion overflows', icon: '⚗' },
  { id: 'stellarnursery' as const, label: 'Stellar Nursery', desc: 'Nebula births a star', icon: '⭐' },
  { id: 'chronoforge' as const, label: 'Chrono-Forge', desc: 'Hourglass bends time itself', icon: '⌛' },
  { id: 'abyssalemergence' as const, label: 'Abyssal Emergence', desc: 'Dark tentacles from the void', icon: '\u{1F419}' },
]

const PLACEMENT_VFX_OPTIONS: Array<{ id: PlacementVfxType; label: string; desc: string; icon: string }> = [
  { id: 'random', label: 'Random', desc: 'Different spell each time', icon: '\u{1F3B2}' },
  { id: 'realitydetonation', label: 'Reality Detonation', desc: 'Blast, smoke, shards, lightning flash', icon: '\u{1F4A5}' },
  { id: 'dimensionalmaw', label: 'Dimensional Maw', desc: 'Vertical rift tears the object in', icon: '⧉' },
  { id: 'hexstorm', label: 'Hex Storm', desc: 'Impossible glyph rings and polyhedra', icon: '⚡' },
  { id: 'singularitydrop', label: 'Singularity Drop', desc: 'Black core impact with gravity smoke', icon: '●' },
  { id: 'runeflash', label: 'Rune Flash', desc: 'Arcane circle glows on ground', icon: '✦' },
  { id: 'sparkburst', label: 'Spark Burst', desc: '200 particles shower outward', icon: '☄' },
  { id: 'portalring', label: 'Portal Ring', desc: 'Glowing ring rises through object', icon: '◎' },
  { id: 'sigilpulse', label: 'Sigil Pulse', desc: '3 expanding ripple rings', icon: '◉' },
  { id: 'quantumcollapse', label: 'Quantum Collapse', desc: '500 particles collapse from uncertainty', icon: '⚛' },
  { id: 'phoenixascension', label: 'Phoenix Ascension', desc: 'Fire column + wings of light', icon: '❈' },
  { id: 'dimensionalrift', label: 'Dimensional Rift', desc: 'Void slash tears open space', icon: '⌁' },
  { id: 'crystalgenesis', label: 'Crystal Genesis', desc: 'Crystals erupt and shatter', icon: '⬠' },
  { id: 'meteorimpact', label: 'Meteor Impact', desc: 'Fireball descends + shockwave', icon: '☢' },
  { id: 'arcanebloom', label: 'Arcane Bloom', desc: 'Magic flower unfolds with pollen', icon: '❀' },
  { id: 'voidanchor', label: 'Void Anchor', desc: 'Dark sphere slams + chains lock', icon: '⚓' },
  { id: 'stellarforge', label: 'Stellar Forge', desc: 'Nebula spirals birth a star', icon: '★' },
]

export function WorldVfxTab() {
  const { settings, updateSetting } = useContext(SettingsContext)
  const conjureVfxType = useOasisStore(s => s.conjureVfxType)
  const setConjureVfxType = useOasisStore(s => s.setConjureVfxType)
  const placementVfxType = useOasisStore(s => s.placementVfxType)
  const setPlacementVfxType = useOasisStore(s => s.setPlacementVfxType)
  const placementVfxDuration = useOasisStore(s => s.placementVfxDuration)
  const setPlacementVfxDuration = useOasisStore(s => s.setPlacementVfxDuration)
  const previewPlacementSpell = useOasisStore(s => s.previewPlacementSpell)
  const startConjurePreview = useOasisStore(s => s.startConjurePreview)

  return (
    <div className="space-y-4">
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Conjuration Effect</div>
        <div className="grid grid-cols-2 gap-1.5">
          {CONJURE_VFX_OPTIONS.map(fx => (
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
      </section>

      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Placement Spell Effect</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PLACEMENT_VFX_OPTIONS.map(fx => (
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
      </section>

      <section>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">Spell Duration</span>
          <input
            type="range"
            min="0.5" max="4.5" step="0.1"
            value={placementVfxDuration}
            onChange={e => setPlacementVfxDuration(parseFloat(e.target.value))}
            className="flex-1 h-1 accent-yellow-500 cursor-pointer"
          />
          <span className="text-[10px] text-gray-500 font-mono w-8 text-right">{placementVfxDuration.toFixed(1)}s</span>
        </div>
      </section>

      <section>
        <PortalTransitionSettingsPanel />
      </section>

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Agent Embodiment</div>

        <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
          <div
            onClick={() => updateSetting('agentActionMode', settings.agentActionMode === 'embodied' ? 'instant' : 'embodied')}
            className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
              settings.agentActionMode === 'embodied' ? 'bg-cyan-600 shadow-lg shadow-cyan-500/30' : 'bg-gray-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
              settings.agentActionMode === 'embodied' ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Embodied Agent Actions</div>
            <div className="text-[10px] text-gray-500">
              {settings.agentActionMode === 'embodied'
                ? 'Agents walk, cast, and settle before manifestations visibly land.'
                : 'Agent world changes apply immediately without slow-mo staging.'}
            </div>
          </div>
        </label>

        <div className="py-1.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-gray-300">Agent Walk Speed</span>
            <span className="text-xs text-cyan-300 font-mono">{settings.agentWalkSpeed.toFixed(1)} m/s</span>
          </div>
          <input
            type="range"
            min={0.5} max={12} step={0.5}
            value={settings.agentWalkSpeed}
            onChange={e => updateSetting('agentWalkSpeed', parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
        </div>
      </section>
    </div>
  )
}

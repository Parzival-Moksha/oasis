'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// SPELL SOUNDS SELECTOR — pick a custom sound per spell from manifest.json
// Wires into settings.spellSounds[spellId]; actual playback hookup is a
// follow-up task (see CLAUDE notes).
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext, useEffect, useMemo, useState } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { SPELL_IDS, SPELL_DEFS, SPELLBOOK_PAGES, type SpellbookPageId, type SpellId } from '@/lib/spellbook'

interface ManifestEntry {
  id: string
  file: string
  label: string
  vibe?: string
}

interface SpellSoundsManifest {
  library?: ManifestEntry[]
}

const MANIFEST_URL = '/audio/spells/manifest.json'

function useSpellSoundsManifest() {
  const [entries, setEntries] = useState<ManifestEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
    fetch(`${base}${MANIFEST_URL}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data: SpellSoundsManifest) => {
        if (cancelled) return
        setEntries(Array.isArray(data.library) ? data.library : [])
      })
      .catch(err => {
        if (cancelled) return
        setError(err?.message || 'load failed')
      })
    return () => { cancelled = true }
  }, [])

  return { entries, error }
}

function previewSound(file: string) {
  if (typeof window === 'undefined') return
  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
    const audio = new Audio(`${base}${file}`)
    audio.volume = 0.7
    audio.play().catch(() => { /* swallow autoplay blocks */ })
  } catch { /* noop */ }
}

export function SpellSoundsSelector() {
  const { settings, updateSetting } = useContext(SettingsContext)
  const { entries, error } = useSpellSoundsManifest()
  const [expandedPages, setExpandedPages] = useState<Set<SpellbookPageId>>(() => new Set(['combat']))

  const grouped = useMemo(() => {
    const byPage: Partial<Record<SpellbookPageId, SpellId[]>> = {}
    for (const id of SPELL_IDS) {
      const def = SPELL_DEFS[id]
      if (!def) continue
      const page = def.category
      if (!byPage[page]) byPage[page] = []
      byPage[page]!.push(id)
    }
    return byPage
  }, [])

  const togglePage = (page: SpellbookPageId) => {
    setExpandedPages(prev => {
      const next = new Set(prev)
      if (next.has(page)) next.delete(page); else next.add(page)
      return next
    })
  }

  const setSpellSound = (spellId: SpellId, soundId: string) => {
    const current = settings.spellSounds || {}
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === 'string') next[k] = v
    }
    if (!soundId) {
      delete next[spellId]
    } else {
      next[spellId] = soundId
    }
    updateSetting('spellSounds', next)
  }

  return (
    <div className="rounded-lg border border-sky-400/15 bg-black/30 p-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] text-sky-300/80 uppercase tracking-wider font-mono">Spell Sounds</div>
        <div className="text-[9px] text-gray-500">{entries.length} sounds</div>
      </div>
      {error && (
        <div className="text-[10px] text-red-300/80 mb-1.5">Failed to load manifest: {error}</div>
      )}
      <div className="space-y-1.5">
        {Object.entries(grouped).map(([pageId, spellIds]) => {
          if (!spellIds || spellIds.length === 0) return null
          const page = SPELLBOOK_PAGES[pageId as SpellbookPageId]
          const expanded = expandedPages.has(pageId as SpellbookPageId)
          return (
            <div key={pageId} className="rounded border border-white/5 bg-white/[0.02]">
              <button
                type="button"
                onClick={() => togglePage(pageId as SpellbookPageId)}
                className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-white/[0.04] transition-colors text-left"
              >
                <span className="text-[11px] font-bold text-white/80">{expanded ? '▼' : '▸'} {page?.name || pageId}</span>
                <span className="text-[9px] text-gray-500">{spellIds.length}</span>
              </button>
              {expanded && (
                <div className="space-y-1 px-2 pb-2 pt-0.5">
                  {spellIds.map(spellId => {
                    const def = SPELL_DEFS[spellId]
                    const selected = settings.spellSounds?.[spellId] || ''
                    const selectedEntry = entries.find(e => e.id === selected)
                    return (
                      <div key={spellId} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-300 truncate flex-shrink-0 w-28" title={def?.name || spellId}>
                          {def?.name || spellId}
                        </span>
                        <select
                          value={selected}
                          onChange={e => setSpellSound(spellId, e.target.value)}
                          className="flex-1 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-300 hover:border-sky-500 focus:border-sky-500 focus:outline-none transition-colors cursor-pointer"
                        >
                          <option value="">Default</option>
                          {entries.map(entry => (
                            <option key={entry.id} value={entry.id}>{entry.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedEntry}
                          onClick={() => selectedEntry && previewSound(selectedEntry.file)}
                          className="rounded border border-sky-300/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-gray-500 hover:border-sky-300/45 hover:text-sky-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          title="Preview"
                        >
                          Test
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  SPELLBOOK_PAGES,
  SPELL_DEFS,
  isSpellId,
  type SpellDefinition,
  type SpellId,
  type SpellbookPageId,
} from '@/lib/spellbook'

type SpellUnlock = {
  spellId: string
  level?: number
  uses?: number
  definition?: SpellDefinition | null
}

type PlayerProgressionState = {
  spells?: SpellUnlock[]
}

type SpellbookOpenDetail = {
  spellId?: string
}

type KnownSpell = {
  id: string
  level: number
  uses: number
  definition: SpellDefinition
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function normalizeSpells(spells: SpellUnlock[] | undefined): KnownSpell[] {
  return (spells || [])
    .filter((spell): spell is SpellUnlock & { spellId: SpellId } => isSpellId(spell.spellId))
    .map(spell => {
      const definition = SPELL_DEFS[spell.spellId]
      return {
        id: spell.spellId,
        level: typeof spell.level === 'number' ? spell.level : 1,
        uses: typeof spell.uses === 'number' ? spell.uses : 0,
        definition,
      }
    })
}

export function PlayerSpellbookPanel({ visible }: { visible: boolean }) {
  const [progression, setProgression] = useState<PlayerProgressionState | null>(null)
  const [open, setOpen] = useState(false)
  const [highlightSpellId, setHighlightSpellId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/player/progression', { cache: 'no-store' })
      if (!response.ok) return null
      const data = await response.json()
      setProgression(data)
      return data as PlayerProgressionState
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (visible) void refresh()
  }, [refresh, visible])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onProgression = (event: Event) => {
      const detail = (event as CustomEvent<PlayerProgressionState>).detail
      if (detail) setProgression(detail)
    }
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SpellbookOpenDetail>).detail
      if (detail?.spellId) setHighlightSpellId(detail.spellId)
      setOpen(true)
      void refresh()
      window.setTimeout(() => setHighlightSpellId(null), 2600)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visible || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'KeyB') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      setOpen(value => !value)
      void refresh()
    }
    window.addEventListener('oasis:player-progression', onProgression)
    window.addEventListener('oasis:spellbook-open', onOpen)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('oasis:player-progression', onProgression)
      window.removeEventListener('oasis:spellbook-open', onOpen)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [refresh, visible])

  const unlockedSpells = useMemo(() => normalizeSpells(progression?.spells), [progression?.spells])
  const spellsByPage = useMemo(() => {
    const map = new Map<SpellbookPageId, KnownSpell[]>()
    for (const spell of unlockedSpells) {
      const page = spell.definition.category
      map.set(page, [...(map.get(page) || []), spell])
    }
    return map
  }, [unlockedSpells])

  if (!visible) return null

  const hasSpells = unlockedSpells.length > 0

  return (
    <>
      {hasSpells && (
        <button
          type="button"
          className="fixed bottom-[8.1rem] left-4 z-[188] rounded-md border border-amber-200/35 bg-black/68 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 shadow-[0_0_28px_rgba(251,191,36,0.16)] backdrop-blur-md max-[700px]:bottom-[9.6rem]"
          onClick={() => {
            setOpen(value => !value)
            void refresh()
          }}
        >
          Spellbook
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/38 px-4 py-4 backdrop-blur-[2px]">
          <style>{`
            @keyframes oasisSpellLearnedPulse {
              0%, 100% { box-shadow: 0 0 24px rgba(251,146,60,0.26); transform: translateY(0); }
              35% { box-shadow: 0 0 58px rgba(251,191,36,0.72); transform: translateY(-2px); }
            }
          `}</style>
          <div className="w-[min(680px,calc(100vw-1.5rem))] max-h-[min(620px,calc(100vh-2rem))] overflow-hidden rounded-lg border border-amber-200/28 bg-[#050403]/92 text-white shadow-[0_0_70px_rgba(251,146,60,0.22)]">
            <div className="flex items-center justify-between gap-3 border-b border-amber-100/14 px-4 py-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/70">Spellbook</div>
                <div className="mt-1 text-lg font-black tracking-[0.02em] text-amber-50">Learned Spells</div>
              </div>
              <button
                type="button"
                className="rounded-md border border-white/15 bg-white/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/80 hover:bg-white/14"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(min(620px,100vh-2rem)-74px)] overflow-y-auto p-4">
              {!hasSpells ? (
                <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  No spells learned yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {Array.from(spellsByPage.entries()).map(([pageId, spells]) => (
                    <section key={pageId}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-100/75">
                          {SPELLBOOK_PAGES[pageId].name}
                        </h3>
                        <span className="font-mono text-[10px] text-white/40">{spells.length}</span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {spells.map(spell => {
                          const highlighted = highlightSpellId === spell.id
                          return (
                            <article
                              key={spell.id}
                              className="rounded-lg border border-orange-200/28 bg-gradient-to-br from-orange-950/44 via-black/60 to-black/88 p-3"
                              style={highlighted ? { animation: 'oasisSpellLearnedPulse 1300ms ease-in-out 2' } : undefined}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[15px] font-black text-orange-50">{spell.definition.name}</div>
                                  <div className="mt-1 text-xs leading-5 text-white/65">{spell.definition.summary}</div>
                                </div>
                                <div className="rounded border border-orange-200/24 bg-orange-300/10 px-2 py-1 font-mono text-[10px] font-black text-orange-100">
                                  Lv {spell.level}
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {spell.definition.stats.map(stat => (
                                  <span
                                    key={stat}
                                    className="rounded border border-white/10 bg-white/7 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white/64"
                                  >
                                    {stat}
                                  </span>
                                ))}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

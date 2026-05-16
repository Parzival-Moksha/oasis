'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUILayer } from '@/lib/input-manager'
import {
  SPELLBOOK_PAGE_IDS,
  SPELLBOOK_PAGES,
  SPELL_DEFS,
  SPELL_IDS,
  isSpellDefaultUnlocked,
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
  id: SpellId
  level: number
  uses: number
  definition: SpellDefinition
}

type PlayerSpellbookPanelProps = {
  visible: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onCastSpell?: (spellId: SpellId) => void
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

function commandLabel(definition: SpellDefinition): string {
  switch (definition.actionId) {
    case 'cast-firebolt':
      return 'Cast'
    case 'open-place-menu':
      return 'Open'
    case 'open-wizard':
      return 'Craft'
    case 'open-sky-panel':
    case 'open-ground-texture':
    case 'open-ground-elevation':
    case 'open-lights-panel':
    case 'open-paint-wand':
    case 'open-text-3d':
      return 'Open'
    case 'open-agent-launcher':
    case 'place-merlin':
    case 'place-openclaw':
    case 'place-hermes':
      return 'Summon'
    default:
      return 'Open'
  }
}

export function PlayerSpellbookPanel({
  visible,
  isOpen,
  onOpenChange,
  onCastSpell,
}: PlayerSpellbookPanelProps) {
  const [progression, setProgression] = useState<PlayerProgressionState | null>(null)
  const [activePage, setActivePage] = useState<SpellbookPageId>('recipe-catalog')
  const [highlightSpellId, setHighlightSpellId] = useState<SpellId | null>(null)
  useUILayer('spellbook-menu', Boolean(visible && isOpen))

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
    if (isOpen) void refresh()
  }, [isOpen, refresh])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onProgression = (event: Event) => {
      const detail = (event as CustomEvent<PlayerProgressionState>).detail
      if (detail) setProgression(detail)
    }
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SpellbookOpenDetail>).detail
      if (detail?.spellId && isSpellId(detail.spellId)) {
        setActivePage(SPELL_DEFS[detail.spellId].category)
        setHighlightSpellId(detail.spellId)
        window.setTimeout(() => setHighlightSpellId(null), 2600)
      }
      onOpenChange(true)
      void refresh()
    }
    window.addEventListener('oasis:player-progression', onProgression)
    window.addEventListener('oasis:spellbook-open', onOpen)
    return () => {
      window.removeEventListener('oasis:player-progression', onProgression)
      window.removeEventListener('oasis:spellbook-open', onOpen)
    }
  }, [onOpenChange, refresh])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visible || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'KeyB') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      onOpenChange(!isOpen)
      void refresh()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onOpenChange, refresh, visible])

  const knownSpellMap = useMemo(() => {
    const map = new Map<SpellId, KnownSpell>()
    for (const spell of normalizeSpells(progression?.spells)) {
      map.set(spell.id, spell)
    }
    return map
  }, [progression?.spells])

  const spellsByPage = useMemo(() => {
    const map = new Map<SpellbookPageId, SpellDefinition[]>()
    for (const spellId of SPELL_IDS) {
      const definition = SPELL_DEFS[spellId]
      const pageSpells = map.get(definition.category) || []
      pageSpells.push(definition)
      map.set(definition.category, pageSpells)
    }
    return map
  }, [])

  if (!visible || !isOpen) return null

  const activeSpells = spellsByPage.get(activePage) || []

  return (
    <div
      data-ui-panel
      data-spellbook-menu-panel
      className="fixed left-[10.25rem] top-4 z-[285] w-[min(760px,calc(100vw-11.5rem))] max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-amber-200/28 bg-[#050403]/94 font-mono text-white shadow-[0_0_70px_rgba(251,146,60,0.24),0_0_28px_rgba(0,0,0,0.78)] backdrop-blur-md max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:w-auto max-[700px]:max-h-[calc(100vh-70px)]"
      onMouseDown={event => event.stopPropagation()}
    >
      <style>{`
        @keyframes oasisSpellLearnedPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(251,146,60,0.26); transform: translateY(0); }
          35% { box-shadow: 0 0 58px rgba(251,191,36,0.72); transform: translateY(-2px); }
        }
      `}</style>
      <div className="flex items-center justify-between gap-3 border-b border-amber-100/14 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/70">Spells</div>
          <div className="mt-1 truncate text-lg font-black tracking-[0.02em] text-amber-50">Spellbook</div>
        </div>
        <button
          type="button"
          className="rounded-md border border-white/15 bg-white/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/80 hover:bg-white/14"
          onClick={() => onOpenChange(false)}
        >
          Close
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-white/10 bg-white/[0.035] px-2 py-2">
        {SPELLBOOK_PAGE_IDS.map(pageId => {
          const page = SPELLBOOK_PAGES[pageId]
          const selected = pageId === activePage
          return (
            <button
              key={pageId}
              type="button"
              className={[
                'shrink-0 rounded-md border px-2.5 py-2 text-[10px] font-black uppercase tracking-[0.1em] transition',
                selected
                  ? 'border-amber-200/55 bg-amber-200/16 text-amber-50 shadow-[0_0_20px_rgba(251,191,36,0.14)]'
                  : 'border-white/10 bg-black/24 text-white/48 hover:border-white/24 hover:text-white/72',
              ].join(' ')}
              onClick={() => setActivePage(pageId)}
            >
              {page.shortName}
            </button>
          )
        })}
      </div>

      <div className="max-h-[calc(100vh-11rem)] overflow-y-auto p-4 max-[700px]:max-h-[calc(100vh-176px)] max-[700px]:p-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[12px] font-black uppercase tracking-[0.18em] text-amber-100/75">
              {SPELLBOOK_PAGES[activePage].name}
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-white/45">
              Combat bolts are learned through quests. The other spell paths are available now.
            </p>
          </div>
          <span className="rounded border border-white/10 bg-white/6 px-2 py-1 font-mono text-[10px] text-white/50">
            {activeSpells.length}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {activeSpells.map(definition => {
            const knownSpell = knownSpellMap.get(definition.id)
            const unlocked = isSpellDefaultUnlocked(definition.id) || Boolean(knownSpell)
            const highlighted = highlightSpellId === definition.id
            const actionable = unlocked && Boolean(definition.actionId && onCastSpell)
            const status = unlocked ? (knownSpell ? `Lv ${knownSpell.level}` : 'Known') : 'Locked'
            return (
              <article
                key={definition.id}
                className={[
                  'rounded-lg border p-3 transition',
                  unlocked
                    ? 'border-orange-200/28 bg-gradient-to-br from-orange-950/44 via-black/60 to-black/88'
                    : 'border-white/10 bg-white/[0.035] opacity-72',
                ].join(' ')}
                style={highlighted ? { animation: 'oasisSpellLearnedPulse 1300ms ease-in-out 2' } : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={unlocked ? 'text-[15px] font-black text-orange-50' : 'text-[15px] font-black text-white/45'}>
                      {definition.name}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-white/65">
                      {unlocked ? definition.summary : definition.lockedSummary || definition.summary}
                    </div>
                  </div>
                  <div className={unlocked
                    ? 'rounded border border-orange-200/24 bg-orange-300/10 px-2 py-1 font-mono text-[10px] font-black text-orange-100'
                    : 'rounded border border-white/10 bg-white/6 px-2 py-1 font-mono text-[10px] font-black text-white/45'
                  }>
                    {status}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {definition.stats.map(stat => (
                    <span
                      key={stat}
                      className="rounded border border-white/10 bg-white/7 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white/64"
                    >
                      {stat}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!actionable}
                  className="mt-3 w-full rounded-md border border-amber-200/26 bg-amber-200/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-50 transition hover:border-amber-100/55 hover:bg-amber-200/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.035] disabled:text-white/32"
                  onClick={() => onCastSpell?.(definition.id)}
                >
                  {unlocked ? commandLabel(definition) : 'Locked'}
                </button>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}

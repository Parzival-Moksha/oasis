'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUILayer } from '@/lib/input-manager'
import { useAudioManager } from '@/lib/audio-manager'
import { useOasisStore } from '@/store/oasisStore'
import { useRailMenuExclusion } from '@/hooks/useRailMenuExclusion'
import {
  SPELLBOOK_PAGE_IDS,
  SPELLBOOK_PAGES,
  SPELL_DEFS,
  SPELL_IDS,
  isSpellId,
  type SpellDefinition,
  type SpellId,
  type SpellbookPageId,
} from '@/lib/spellbook'

type SpellbookOpenDetail = {
  spellId?: string
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

function spellTileSrc(spellId: SpellId): string {
  return `/ui/spellbook/tiles/${spellId}.gpt2.webp`
}

export function PlayerSpellbookPanel({
  visible,
  isOpen,
  onOpenChange,
  onCastSpell,
}: PlayerSpellbookPanelProps) {
  const [activePage, setActivePage] = useState<SpellbookPageId>('recipe-catalog')
  const [highlightSpellId, setHighlightSpellId] = useState<SpellId | null>(null)
  const selectedSpellId = useOasisStore(s => s.selectedSpellId)
  useUILayer('spellbook-menu', Boolean(visible && isOpen))
  // Rail-menu mutual exclusion: opening any other rail menu (CONFIG/AGENTS/etc)
  // closes the spellbook; opening the spellbook closes them.
  const closeSpellbook = useCallback(() => onOpenChange(false), [onOpenChange])
  useRailMenuExclusion('spellbook', isOpen, closeSpellbook)

  const handleCardClick = useCallback((spellId: SpellId) => {
    useAudioManager.getState().play('buttonClick')
    onCastSpell?.(spellId)
  }, [onCastSpell])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SpellbookOpenDetail>).detail
      if (detail?.spellId && isSpellId(detail.spellId)) {
        setActivePage(SPELL_DEFS[detail.spellId].category)
        setHighlightSpellId(detail.spellId)
        window.setTimeout(() => setHighlightSpellId(null), 2600)
      }
      onOpenChange(true)
    }
    window.addEventListener('oasis:spellbook-open', onOpen)
    return () => {
      window.removeEventListener('oasis:spellbook-open', onOpen)
    }
  }, [onOpenChange])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visible || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'KeyB') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      onOpenChange(!isOpen)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onOpenChange, visible])

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
      className="fixed left-[10.25rem] top-4 z-[285] w-[min(760px,calc(100vw-11.5rem))] max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-amber-200/28 bg-[#050403]/82 font-mono text-white shadow-[0_0_70px_rgba(251,146,60,0.24),0_0_28px_rgba(0,0,0,0.78)] max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:w-auto max-[700px]:max-h-[calc(100vh-70px)]"
      onMouseDown={event => event.stopPropagation()}
    >
      <style>{`
        @keyframes oasisSpellLearnedPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(251,146,60,0.26); transform: translateY(0); }
          35% { box-shadow: 0 0 58px rgba(251,191,36,0.72); transform: translateY(-2px); }
        }
        @keyframes oasisSpellSelectPulse {
          0% { box-shadow: 0 0 0 rgba(251,191,36,0.0); }
          50% { box-shadow: 0 0 38px rgba(251,191,36,0.65); }
          100% { box-shadow: 0 0 18px rgba(251,191,36,0.32); }
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

      <div
        className="relative max-h-[calc(100vh-11rem)] overflow-y-auto p-4 max-[700px]:max-h-[calc(100vh-176px)] max-[700px]:p-2"
        style={{
          backgroundImage: `url(/ui/spellbook/frame/page-bg-${activePage}.jpg)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/15 via-black/10 to-black/25" />
        <div className="relative mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[12px] font-black uppercase tracking-[0.18em] text-amber-100/85">
            {SPELLBOOK_PAGES[activePage].name}
          </h3>
          <span className="rounded border border-white/10 bg-white/6 px-2 py-1 font-mono text-[10px] text-white/55">
            {activeSpells.length}
          </span>
        </div>

        <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {activeSpells.map(definition => {
            const highlighted = highlightSpellId === definition.id
            const selected = selectedSpellId === definition.id
            const animation = highlighted
              ? 'oasisSpellLearnedPulse 1300ms ease-in-out 2'
              : selected
                ? 'oasisSpellSelectPulse 520ms ease-out 1'
                : undefined
            return (
              <article
                key={definition.id}
                onClick={() => handleCardClick(definition.id)}
                className={[
                  'group relative cursor-pointer overflow-hidden rounded-lg border p-2 transition-all duration-200',
                  'hover:scale-[1.025] hover:border-amber-200/55 hover:shadow-[0_0_22px_rgba(251,191,36,0.32)]',
                  'active:scale-[0.985]',
                  selected
                    ? 'border-amber-200/75 bg-gradient-to-br from-amber-900/42 via-orange-950/62 to-black/92 shadow-[0_0_22px_rgba(251,191,36,0.42)]'
                    : 'border-orange-200/28 bg-gradient-to-br from-orange-950/44 via-black/60 to-black/88',
                ].join(' ')}
                style={animation ? { animation } : undefined}
              >
                <div className="mb-2 aspect-[3/4] w-full overflow-hidden rounded-md border border-white/10 bg-gradient-to-b from-black/30 to-black/70">
                  <img
                    src={spellTileSrc(definition.id)}
                    alt={definition.name}
                    loading="lazy"
                    className="h-full w-full object-cover opacity-0 transition-all duration-300 group-hover:scale-105"
                    onLoad={event => { event.currentTarget.style.opacity = '1' }}
                    onError={event => { event.currentTarget.style.display = 'none' }}
                  />
                </div>
                <div className="text-[12px] font-black leading-tight text-orange-50 sm:text-[13px]">
                  {definition.name}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/60 sm:text-[11px]">
                  {definition.summary}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
